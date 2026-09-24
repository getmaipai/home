import { describe, expect, test } from "bun:test";
import { hslToHex } from "./verifyTokensCascade";

describe("hslToHex()", () => {
  test("converts Home's own declared --primary values (frontend/src/shell/tokens.css) to their real hex equivalents", () => {
    expect(hslToHex("hsl(189 94% 26%)")).toBe("#046e81");
    expect(hslToHex("hsl(189 84% 55%)")).toBe("#2cd0ed");
  });

  test("black, white and a pure hue round-trip correctly", () => {
    expect(hslToHex("hsl(0 0% 0%)")).toBe("#000000");
    expect(hslToHex("hsl(0 0% 100%)")).toBe("#ffffff");
    expect(hslToHex("hsl(0 100% 50%)")).toBe("#ff0000");
  });

  test("rejects anything that isn't a plain space-separated hsl() string", () => {
    expect(() => hslToHex("hsl(0, 0%, 0%)")).toThrow();
    expect(() => hslToHex("#046e81")).toThrow();
    expect(() => hslToHex("oklch(0.205 0 0)")).toThrow();
  });
});
