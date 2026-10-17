import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { CHAT_ART, nextChatArt, timeHint } from "@/apps/chat/chatArt";

function setStorage(value: unknown) {
  Object.defineProperty(globalThis, "localStorage", { value, configurable: true, writable: true });
}

const noon = new Date(2026, 9, 17, 14, 0);
const morning = new Date(2026, 9, 17, 7, 0);
const night = new Date(2026, 9, 17, 23, 0);

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

beforeEach(() => {
  const data = new Map<string, string>();
  setStorage({
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  });
});

describe("chat art", () => {
  test("every pool file exists on disk", () => {
    for (const a of CHAT_ART) {
      expect(existsSync(join(import.meta.dir, "../../../public", a.src))).toBe(true);
      expect(a.alt.length).toBeGreaterThan(10);
    }
  });

  test("never the same image twice in a row and every image shows in one lap", () => {
    const rng = seeded(7);
    const seen: string[] = [];
    for (let i = 0; i < 200; i += 1) seen.push(nextChatArt({ now: noon, rng }).id);
    for (let i = 1; i < seen.length; i += 1) expect(seen[i]).not.toBe(seen[i - 1]);
    expect(new Set(seen.slice(0, CHAT_ART.length)).size).toBe(CHAT_ART.length);
  });

  test("time hint: morning and night lean to their image, noon never forces one", () => {
    expect(timeHint(morning)).toBe("morning");
    expect(timeHint(night)).toBe("night");
    expect(timeHint(new Date(2026, 9, 17, 3, 0))).toBe("night");
    expect(timeHint(noon)).toBeUndefined();
    const count = (now: Date, id: string) => {
      const rng = seeded(3);
      let n = 0;
      for (let i = 0; i < 300; i += 1) if (nextChatArt({ now, rng }).id === id) n += 1;
      return n;
    };
    expect(count(morning, "morning")).toBeGreaterThan(count(noon, "morning") * 2);
    expect(count(night, "good-night")).toBeGreaterThan(count(noon, "good-night") * 2);
    expect(count(morning, "morning")).toBeLessThan(200);
  });

  test("falls back to memory when localStorage throws", () => {
    setStorage({
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    const rng = seeded(11);
    let prev = "";
    for (let i = 0; i < 40; i += 1) {
      const id = nextChatArt({ now: noon, rng }).id;
      expect(id).not.toBe(prev);
      prev = id;
    }
  });
});
