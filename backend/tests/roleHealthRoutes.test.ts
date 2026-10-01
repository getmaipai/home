import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { app } from "@/app";
import { db } from "@/db";
import { statusEvents } from "@/db/schema";
import { setHouseholdSettingValue } from "@/lib/settings";
import { __resetStackEngineForTests, __setStackClientForTests } from "@/lib/stackEngine";
import { recordStatusSample } from "@/lib/statusHistory";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { __setRoleHealthForTests } from "@/lib/roleHealth";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";

beforeEach(() => {
  resetDb();
  db.delete(statusEvents).run();
  setHouseholdSettingValue("engines.stack.url", "http://127.0.0.1:8770");
});
afterEach(() => { __resetStackEngineForTests(); __resetLlmSupervisorForTests(); __setRoleHealthForTests({}); });

function stack(state: string, reason: string | null = null, fail = false) {
  __setStackClientForTests({ roles: async () => {
    if (fail) throw new Error("offline");
    return { roles: [{ id: "chat", state: { state, since: "2026-10-01T00:00:00Z", reason }, reason }] };
  } } as never);
}

async function owner() {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  return client;
}

describe("Stack-aware role health consumers", () => {
  test("Stack chat offline reaches health, chat availability, history, apps, and preflight in household language", async () => {
    stack("offline", "model crashed");
    const client = await owner();
    const health = await (await client.get("/api/health")).json() as { engines: { chat: { availability: string; alive: boolean | null } } };
    expect(health.engines.chat).toMatchObject({ availability: "unavailable", alive: false });

    __setRoleHealthForTests({ chat: { availability: "unavailable", reason: "failed_start" } });
    await recordStatusSample(new Date("2026-10-01T12:00:00Z"));
    const chatEvents = db.select({ component: statusEvents.component, state: statusEvents.state }).from(statusEvents).all().filter((event) => event.component === "chat");
    expect(chatEvents.map(({ state }) => state)).toEqual(["outage"]);
    __setRoleHealthForTests({});

    const apps = await (await client.get("/api/status/apps")).json() as Array<{ id: string; state: string; reason: string | null; needs?: Array<{ id: string; state: string }> }>;
    const chat = apps.find((item) => item.id === "chat")!;
    expect(chat.state).toBe("down");
    expect(chat.reason).toBe("Chat isn't working: MaiPai's AI isn't running.");
    expect(chat.needs?.find((need) => need.id === "chat")?.state).toBe("down");

    const turn = await client.post("/api/turn", { text: "hello" });
    expect(await turn.json()).toMatchObject({ code: "engine_unavailable", error: "MaiPai's AI isn't running right now." });
    expect(JSON.stringify(health)).not.toContain("model crashed");
  });

  test("unreachable Stack is unavailable, ready Stack is healthy, and local roles remain supervisor-owned", async () => {
    const client = await owner();
    stack("ready");
    let health = await (await client.get("/api/health")).json() as { engines: { chat: { availability: string }; embed: { kind: string } } };
    expect(health.engines.chat.availability).toBe("ready");
    const localKind = health.engines.embed.kind;
    stack("offline", null, true);
    health = await (await client.get("/api/health")).json() as typeof health;
    expect(health.engines.chat.availability).toBe("unavailable");
    expect(health.engines.embed.kind).toBe(localKind);
  });
});
