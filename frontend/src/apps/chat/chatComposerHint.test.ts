import { afterEach, describe, expect, test } from "bun:test";
import { consumeComposerHint, pickedComposerMode, resetComposerMode, setComposerPick, subscribeComposerMode } from "@/apps/chat/chatComposerHint";

afterEach(() => resetComposerMode());

describe("the chat composer's hint for one send (COMPOSER-04)", () => {
  test("plain chat carries no hint", () => {
    setComposerPick("ask", {});
    expect(consumeComposerHint()).toBeUndefined();
  });

  test("a picked mode rides the next send once, then the composer is back on chat", () => {
    const heard: string[] = [];
    const stop = subscribeComposerMode(() => heard.push(pickedComposerMode()));
    setComposerPick("picture", { shape: "landscape", count: 1, quality: "standard" });
    expect(pickedComposerMode()).toBe("picture");
    expect(consumeComposerHint()).toEqual({ mode: "picture", settings: { shape: "landscape", count: 1, quality: "standard" } });
    expect(pickedComposerMode()).toBe("ask");
    expect(consumeComposerHint()).toBeUndefined();
    expect(heard).toEqual(["picture", "ask"]);
    stop();
  });

  test("changing a chip inside the same mode does not announce a mode change", () => {
    let calls = 0;
    const stop = subscribeComposerMode(() => { calls += 1; });
    setComposerPick("picture", { shape: "square" });
    setComposerPick("picture", { shape: "wide" });
    expect(calls).toBe(1);
    expect(consumeComposerHint()?.settings).toEqual({ shape: "wide" });
    stop();
  });
});
