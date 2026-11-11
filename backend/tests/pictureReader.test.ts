// The finished-picture and clip check reads pictures on the chat role when chat declares picture input, else on the Stack's separate
// vision role (so Splash chat, which loads no projector, keeps its speed). With neither, the check fails closed (no_vision).
import { afterEach, describe, expect, test } from "bun:test";
import { pictureReader, checkImages, __setAgeCheckRunnerForTests } from "@/lib/pictures/ageCheck";
import { checkChildSafety, __setChildSafetyRunnerForTests } from "@/lib/pictures/laneGate";
import { __setStackClientForTests } from "@/lib/stackEngine";

type Row = { id: string; state: { state: string; reason?: string }; model?: { imageInput: boolean } };
const row = (id: string, state: string, imageInput?: boolean, reason?: string): Row => ({ id, state: { state, ...(reason ? { reason } : {}) }, ...(imageInput === undefined ? {} : { model: { imageInput } }) });
const MEMORY_PAUSE = "Picture and video making is paused for a moment while this computer frees up memory. The vision engine waited 15 s for memory and gave up.";
const stack = (roles: Row[]) => __setStackClientForTests({ roles: async () => ({ roles }), budget: async () => ({ pressure: "normal" }) } as never);
afterEach(() => __setStackClientForTests(null));

describe("pictureReader", () => {
  test("chat reads pictures: chat is used", async () => {
    stack([row("chat", "ready", true), row("vision", "ready", true)]);
    expect(await pictureReader()).toBe("chat");
  });
  test("chat is language-only (Splash): the installed vision role is used", async () => {
    stack([row("chat", "ready", false), row("vision", "installed", true)]);
    expect(await pictureReader()).toBe("vision");
  });
  test("vision not installed or not a picture reader: no reader", async () => {
    stack([row("chat", "ready", false), row("vision", "notInstalled")]);
    expect(await pictureReader()).toBeNull();
    stack([row("chat", "ready", false), row("vision", "ready", false)]);
    expect(await pictureReader()).toBeNull();
  });
  test("vision offline after a memory pause is still asked (nothing else wakes it); chat that cannot read pictures is not", async () => {
    stack([row("chat", "ready", false), row("vision", "offline", true, MEMORY_PAUSE)]);
    expect(await pictureReader()).toBe("vision");
    stack([row("chat", "ready", false), row("vision", "offline", false, MEMORY_PAUSE)]);
    expect(await pictureReader()).toBeNull();
  });
  test("vision offline for any other reason (a mode change, a restart, no reason) is no reader", async () => {
    for (const reason of ["Coding mode keeps the picture model switched off.", "The vision engine is restarting.", undefined]) {
      stack([row("chat", "ready", false), row("vision", "offline", true, reason)]);
      expect(await pictureReader()).toBeNull();
    }
  });
  test("an offline vision role that cannot answer still fails closed through both checks", async () => {
    __setAgeCheckRunnerForTests(null); __setChildSafetyRunnerForTests(null);
    __setStackClientForTests({ roles: async () => ({ roles: [row("chat", "ready", false), row("vision", "offline", true, MEMORY_PAUSE)] }), budget: async () => ({ pressure: "normal" }) } as never);
    const age = await checkImages([new Uint8Array([1])], "video"), child = await checkChildSafety([new Uint8Array([1])]);
    expect(age.every((c) => !c.ok)).toBe(true); expect(child.every((c) => !c.ok)).toBe(true);
  });
  test("an unreadable Stack is no reader", async () => {
    __setStackClientForTests({ roles: async () => { throw new Error("down"); } } as never);
    expect(await pictureReader()).toBeNull();
  });
  test("both checks fail closed with no_vision when there is no reader", async () => {
    __setAgeCheckRunnerForTests(null); __setChildSafetyRunnerForTests(null); // the real path, not the preload's scripted runners
    stack([row("chat", "ready", false)]);
    expect(await checkImages([new Uint8Array([1])], "video")).toEqual([{ ok: false, why: "no_vision" }]);
    expect(await checkChildSafety([new Uint8Array([1])])).toEqual([{ ok: false, why: "no_vision" }]);
  });
});
