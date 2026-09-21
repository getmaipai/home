import { describe, expect, test } from "bun:test";
import { readShellNextCache, writeShellNextCache } from "@/next/shellNextCache";

describe("shellNextCache", () => {
  test("round trip: write then read returns the same value", () => {
    const value = { on: true, look: "navy", dark: true };
    writeShellNextCache(value);
    expect(readShellNextCache()).toEqual(value);
  });

  test("read returns null when storage is empty", () => {
    localStorage.clear();
    expect(readShellNextCache()).toBeNull();
  });

  test("read returns null for malformed JSON", () => {
    localStorage.setItem("maipai.shell.next", "{not valid json");
    expect(readShellNextCache()).toBeNull();
  });

  test("read returns null for wrong shape", () => {
    localStorage.setItem("maipai.shell.next", JSON.stringify({ on: "yes", look: "x", dark: "no" }));
    expect(readShellNextCache()).toBeNull();
  });

  test("write does not throw when storage is blocked", () => {
    const original = window.localStorage;
    Object.defineProperty(window, "localStorage", {
      value: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
      },
      writable: true,
      configurable: true,
    });
    try {
      writeShellNextCache({ on: true, look: "neutral", dark: false });
      expect(readShellNextCache()).toBeNull();
    } finally {
      Object.defineProperty(window, "localStorage", { value: original, writable: true, configurable: true });
    }
  });
});
