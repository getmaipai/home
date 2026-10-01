import { afterEach, describe, expect, test } from "bun:test";
import { engineWarmupsForStackRoles } from "@/lib/engineBoot";
import { __resetStackEngineForTests } from "@/lib/stackEngine";
import { resetDb } from "./reset-db";
import { setHouseholdSettingValue } from "@/lib/settings";
import { getChatClient, getEngineStatus, __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { getEmbedClient, getEmbedBackendKind, __resetEmbedSupervisorForTests } from "@/lib/embedSupervisor";
import { getTtsClient, getTtsBackendKind, __resetTtsSupervisorForTests } from "@/lib/ttsSupervisor";
import { getBackgroundClient, getBackgroundBackendKind, __resetBackgroundSupervisorForTests } from "@/lib/backgroundSupervisor";

afterEach(() => {
  resetDb();
  __resetStackEngineForTests();
  __resetLlmSupervisorForTests();
  __resetEmbedSupervisorForTests();
  __resetTtsSupervisorForTests();
  __resetBackgroundSupervisorForTests();
});

function setStackRoles(chat: boolean, embeddings: boolean, tts: boolean): void {
  setHouseholdSettingValue("engines.stack.url", "http://127.0.0.1:8780");
  setHouseholdSettingValue("engines.stack.use_chat", chat);
  setHouseholdSettingValue("engines.stack.use_embeddings", embeddings);
  setHouseholdSettingValue("engines.stack.use_tts", tts);
}

describe("engine boot warm-ups", () => {
  test("warms chat, embed, and tts when all Stack role switches are off", () => {
    setStackRoles(false, false, false);
    expect(engineWarmupsForStackRoles()).toEqual(["chat", "embed", "tts"]);
  });

  test("omits chat warm-up when Stack chat is on", () => {
    setStackRoles(true, false, false);
    expect(engineWarmupsForStackRoles()).toEqual(["embed", "tts"]);
  });

  test("omits embed warm-up when Stack embeddings are on", () => {
    setStackRoles(false, true, false);
    expect(engineWarmupsForStackRoles()).toEqual(["chat", "tts"]);
  });

  test("omits tts warm-up when Stack speech is on", () => {
    setStackRoles(false, false, true);
    expect(engineWarmupsForStackRoles()).toEqual(["chat", "embed"]);
  });

  test("warms no engines when all Stack role switches are on", () => {
    setStackRoles(true, true, true);
    expect(engineWarmupsForStackRoles()).toEqual([]);
  });
});

describe("Stack enabled client getters", () => {
  test("rejects the local chat client without starting a backend", async () => {
    setStackRoles(true, false, false);
    await expect(getChatClient()).rejects.toThrow("chat model unavailable");
    expect(getEngineStatus().kind).toBe("none");
  });

  test("rejects the local embedding client without starting a backend", async () => {
    setStackRoles(false, true, false);
    await expect(getEmbedClient()).rejects.toThrow("embedding model unavailable");
    expect(getEmbedBackendKind()).toBe("none");
  });

  test("rejects the local speech client without starting a backend", async () => {
    setStackRoles(false, false, true);
    await expect(getTtsClient()).rejects.toThrow("voice model unavailable");
    expect(getTtsBackendKind()).toBe("none");
  });

  test("rejects the local background client without starting a backend", async () => {
    setStackRoles(true, false, false);
    await expect(getBackgroundClient()).rejects.toThrow("Stack judge serves background");
    expect(getBackgroundBackendKind()).toBe("none");
  });
});
