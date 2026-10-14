import { afterEach, describe, expect, test } from "bun:test";
import { readShellCache, writeShellCache } from "@/shell/shellCache";
import { DEFAULT_LOOK } from "@/shell/useLookSetting";
import { applyFirstPaintPalette } from "@/shell/firstPaintPalette";

const originalMatchMedia = window.matchMedia;

afterEach(() => {
  localStorage.clear();
  document.body.className = "";
  document.documentElement.className = "";
  window.matchMedia = originalMatchMedia;
});

describe("first paint palette", () => {
  test("fresh browser uses the default look and OS dark appearance without caching it", async () => {
    localStorage.clear();
    window.matchMedia = (() => ({ matches: true })) as unknown as typeof window.matchMedia;

    applyFirstPaintPalette();

    expect(document.body.classList.contains(`style-${DEFAULT_LOOK}`)).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("light")).toBe(false);
    expect(readShellCache()).toBeNull();
  });

  test("cached look and appearance win over the OS preference", async () => {
    writeShellCache({ look: "olive", dark: false });
    window.matchMedia = (() => ({ matches: true })) as unknown as typeof window.matchMedia;

    applyFirstPaintPalette();

    expect(document.body.classList.contains("style-olive")).toBe(true);
    expect(document.body.classList.contains(`style-${DEFAULT_LOOK}`)).toBe(false);
    expect(document.documentElement.classList.contains("light")).toBe(true);
  });
});
