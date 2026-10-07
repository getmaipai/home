import { describe, expect, test } from "bun:test";
import { readShellCache, writeShellCache } from "@/shell/shellCache";

describe("shell palette cache", () => {
  test("round trip: write then read returns the same value", () => {
    const value = { look: "navy", dark: true };
    writeShellCache(value);
    expect(readShellCache()).toEqual(value);
  });

  test("read returns null when storage is empty", () => {
    localStorage.clear();
    expect(readShellCache()).toBeNull();
  });

  test("read returns null for malformed JSON", () => {
    localStorage.setItem("maipai.shell.palette", "{not valid json");
    expect(readShellCache()).toBeNull();
  });

  test("read returns null for wrong shape", () => {
    localStorage.setItem("maipai.shell.palette", JSON.stringify({ look: "x", dark: "no" }));
    expect(readShellCache()).toBeNull();
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
      writeShellCache({ look: "neutral", dark: false });
      expect(readShellCache()).toBeNull();
    } finally {
      Object.defineProperty(window, "localStorage", { value: original, writable: true, configurable: true });
    }
  });
});
