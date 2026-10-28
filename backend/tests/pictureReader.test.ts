// The finished-picture and clip check reads pictures on the chat role when chat declares picture input, else on the Stack's separate
// vision role (so Splash chat, which loads no projector, keeps its speed). With neither, the check fails closed (no_vision).
import { afterEach, describe, expect, test } from "bun:test";
import { pictureReader, checkImages, __setAgeCheckRunnerForTests } from "@/lib/pictures/ageCheck";
import { checkChildSafety, __setChildSafetyRunnerForTests } from "@/lib/pictures/laneGate";
import { __setStackClientForTests } from "@/lib/stackEngine";

type Row = { id: string; state: { state: string }; model?: { imageInput: boolean } };
const row = (id: string, state: string, imageInput?: boolean): Row => ({ id, state: { state }, ...(imageInput === undefined ? {} : { model: { imageInput } }) });
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
