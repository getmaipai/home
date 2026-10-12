import { describe, expect, test } from "bun:test";
import { resolveEaseAttributes } from "@/shell/easeResolve";

describe("resolving the ease attributes", () => {
  test("no settings yet resolves to the standard preset", () => {
    expect(resolveEaseAttributes({})).toEqual({
      "data-ease-text": "100", "data-ease-spacing": "standard", "data-ease-targets": "standard",
      "data-ease-contrast": "standard", "data-ease-motion": "standard",
    });
  });

  test("a key set to preset follows the resolved ease.preset", () => {
    const large = resolveEaseAttributes({ "ease.preset": "large", "ease.text_size": "preset" });
    expect(large["data-ease-text"]).toBe("140");
    expect(large["data-ease-targets"]).toBe("large");
    expect(large["data-ease-contrast"]).toBe("more");
  });

  test("one change keeps the rest of the preset (Large + calm motion)", () => {
    const result = resolveEaseAttributes({ "ease.preset": "large", "ease.motion": "calm" });
    expect(result["data-ease-motion"]).toBe("calm");
    expect(result["data-ease-text"]).toBe("140");
  });

  test("an unknown preset falls back to standard", () => {
    expect(resolveEaseAttributes({ "ease.preset": "bogus" })["data-ease-text"]).toBe("100");
  });
});
