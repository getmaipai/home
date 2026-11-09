import { beforeEach, describe, expect, test } from "bun:test";
import { chooseNext, getPlayMode, nextRepeat, setPlayMode } from "@/shell/media/playMode";

beforeEach(() => { setPlayMode({ shuffle: false, repeat: "off" }); });

describe("play mode", () => {
  test("repeat cycles off, all, one, off and is remembered", () => {
    expect([nextRepeat("off"), nextRepeat("all"), nextRepeat("one")]).toEqual(["all", "one", "off"]);
    setPlayMode({ shuffle: true, repeat: "one" });
    expect(JSON.parse(localStorage.getItem("music.playmode")!)).toEqual({ shuffle: true, repeat: "one" });
    expect(getPlayMode()).toEqual({ shuffle: true, repeat: "one" });
  });
  test("chooseNext follows the queue, shuffles among later songs, and repeat all starts over", () => {
    const base = { currentId: "c", ahead: ["x", "y"] };
    expect(chooseNext({ ...base, nextId: "x", mode: { shuffle: false, repeat: "off" } })).toBe("x");
    expect(chooseNext({ ...base, nextId: "x", mode: { shuffle: true, repeat: "off" }, random: () => 0.99 })).toBe("y");
    expect(chooseNext({ currentId: "c", ahead: [], nextId: null, mode: { shuffle: false, repeat: "off" } })).toBeNull();
    expect(chooseNext({ currentId: "c", ahead: [], nextId: null, first: "a", mode: { shuffle: false, repeat: "all" } })).toBe("a");
    expect(chooseNext({ currentId: "c", ahead: [], nextId: null, mode: { shuffle: false, repeat: "all" } })).toBe("c");
  });
});
