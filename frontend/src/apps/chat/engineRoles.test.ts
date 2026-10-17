import { describe, expect, test } from "bun:test";
import { readyRole, usableRole } from "@/apps/chat/engineRoles";
import type { EnginesOverview } from "@/lib/api";

describe("readyRole", () => {
  const sttReady: EnginesOverview = {
    roles: [{ id: "stt", state: { state: "ready" } }],
  } as unknown as EnginesOverview;



  const ttsReady: EnginesOverview = {
    roles: [{ id: "tts", state: { state: "ready" } }],
  } as unknown as EnginesOverview;

  const ttsLoaded: EnginesOverview = {
    roles: [{ id: "tts", state: { state: "loaded" } }],
  } as unknown as EnginesOverview;

  const ttsStarting: EnginesOverview = {
    roles: [{ id: "tts", state: { state: "starting" } }],
  } as unknown as EnginesOverview;

  const noRoles: EnginesOverview = {
    roles: [],
  } as unknown as EnginesOverview;



  test("undefined overview is false", () => {
    expect(readyRole(undefined, "stt")).toBe(false);
  });

  test("an overview with no roles array is false", () => {
    expect(readyRole(noRoles, "stt")).toBe(false);
  });

  test("the named role in state ready is true", () => {
    expect(readyRole(sttReady, "stt")).toBe(true);
  });

  test("the named role in state loaded is false", () => {
    expect(readyRole(ttsLoaded, "tts")).toBe(false);
  });

  test("the named role in state starting is false", () => {
    expect(readyRole(ttsStarting, "tts")).toBe(false);
  });

  test("another role being ready does not make the named one true", () => {
    expect(readyRole(ttsReady, "stt")).toBe(false);
  });

  test("a different role that is ready does not make the named role ready", () => {
    expect(readyRole(ttsReady, "stt")).toBe(false);
  });

  test("each ready role is found by its own id", () => {
    expect(readyRole(sttReady, "stt")).toBe(true);
    expect(readyRole(ttsReady, "tts")).toBe(true);
  });
});

describe("usableRole", () => {
  const one = (state: string) => ({ roles: [{ id: "tts", state: { state } }] }) as unknown as EnginesOverview;
  for (const state of ["installed", "loaded", "ready"]) test(`${state} is usable`, () => expect(usableRole(one(state), "tts")).toBe(true));
  for (const state of ["notInstalled", "offline"]) test(`${state} is not usable`, () => expect(usableRole(one(state), "tts")).toBe(false));
  test("absent role and undefined overview are not usable", () => {
    expect(usableRole(one("ready"), "stt")).toBe(false);
    expect(usableRole(undefined, "tts")).toBe(false);
  });
});
