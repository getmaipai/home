import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useMusicKeys, type MusicShortcutActions } from "./MusicPlayerBar";

afterEach(cleanup);

describe("Music shortcuts", () => {
  test("maps modifier and letter keys to the Music actions", () => {
    const calls: string[] = [];
    const actions: MusicShortcutActions = {
      next: () => calls.push("next"), previous: () => calls.push("previous"), like: () => calls.push("like"),
      shuffle: () => calls.push("shuffle"), repeat: () => calls.push("repeat"), equalizer: () => calls.push("equalizer"),
      shortcuts: () => calls.push("shortcuts"),
    };
    renderHook(() => useMusicKeys(true, actions));
    const key = (value: string, shiftKey = false) => window.dispatchEvent(new KeyboardEvent("keydown", { key: value, shiftKey, bubbles: true, cancelable: true }));

    act(() => {
      key("ArrowLeft", true); key("ArrowRight", true); key("l"); key("s"); key("r"); key("e"); key("?");
    });
    expect(calls).toEqual(["previous", "next", "like", "shuffle", "repeat", "equalizer", "shortcuts"]);
  });

  test("leaves shortcuts alone while a text field has focus", () => {
    const actions: MusicShortcutActions = {
      next: () => { throw new Error("shortcut fired"); }, previous: () => { throw new Error("shortcut fired"); },
      like: () => { throw new Error("shortcut fired"); }, shuffle: () => { throw new Error("shortcut fired"); },
      repeat: () => { throw new Error("shortcut fired"); }, equalizer: () => { throw new Error("shortcut fired"); },
      shortcuts: () => { throw new Error("shortcut fired"); },
    };
    renderHook(() => useMusicKeys(true, actions));
    const input = document.createElement("input");
    document.body.append(input);
    act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "s", bubbles: true, cancelable: true })));
    input.remove();
  });
});
