import { describe, expect, test } from "bun:test";
import { kindStyle, packageState } from "@/apps/library/appPresentation";

const row = (status: string, ok: boolean | null) => ({ status, smoke: { last_run_at: null, ok, message: null } }) as never;

describe("appPresentation", () => {
  test("kindStyle returns the known styles", () => {
    expect(kindStyle("plugin")).toEqual({ label: "Plugin", hue: "--hue-blue", icon: "puzzle" });
    expect(kindStyle("companion")).toEqual({ label: "Companion", hue: "--hue-violet", icon: "bot" });
    expect(kindStyle("skill")).toEqual({ label: "Skill", hue: "--hue-orange", icon: "sparkles" });
  });
  test("kindStyle capitalizes an unknown kind and uses the package icon", () => {
    expect(kindStyle("theme")).toEqual({ label: "Theme", hue: "--hue-blue", icon: "package" });
  });
  test("kindStyle copes with an empty kind", () => {
    expect(kindStyle("")).toEqual({ label: "", hue: "--hue-blue", icon: "package" });
  });
  test("packageState is Ready for an enabled package whose smoke check passed or never ran", () => {
    expect(packageState(row("enabled", true))).toBe("Ready");
    expect(packageState(row("enabled", null))).toBe("Ready");
  });
  test("packageState is Attention for a failed smoke check or a disabled package", () => {
    expect(packageState(row("enabled", false))).toBe("Attention");
    expect(packageState(row("disabled", true))).toBe("Attention");
  });
});
