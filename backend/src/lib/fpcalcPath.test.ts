import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findFpcalc } from "@/lib/fpcalcPath";
import { identifyReadinessFor } from "@/lib/music/identifyCore";
import { shippedDiskPlan } from "@/lib/diskPlan";

const previousPath = process.env.PATH;
const previousOverride = process.env.MAIPAI_FPCALC_PATH;
const dirs: string[] = [];
afterEach(() => {
  if (previousPath === undefined) delete process.env.PATH; else process.env.PATH = previousPath;
  if (previousOverride === undefined) delete process.env.MAIPAI_FPCALC_PATH; else process.env.MAIPAI_FPCALC_PATH = previousOverride;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function temp(): string { const dir = mkdtempSync(join(tmpdir(), "fpcalc-test-")); dirs.push(dir); return dir; }

describe("fpcalc discovery", () => {
  test("finds a binary on PATH", () => {
    const bin = join(temp(), "fpcalc"); writeFileSync(bin, "", { mode: 0o755 });
    expect(findFpcalc(temp(), bin.slice(0, bin.lastIndexOf("/")))).toBe(bin);
  });
  test("finds the newest Stack version", () => {
    const data = temp();
    for (const version of ["1.0", "2.0"]) { const folder = join(data, "engines", "fpcalc", version); mkdirSync(folder, { recursive: true }); writeFileSync(join(folder, "fpcalc"), ""); }
    expect(findFpcalc(data, "")).toBe(join(data, "engines", "fpcalc", "2.0", "fpcalc"));
  });
  test("returns null when no binary exists", () => {
    delete process.env.MAIPAI_FPCALC_PATH;
    expect(findFpcalc(temp(), "")).toBeNull();
  });
});

test("the shipped disk plan includes the optional default fpcalc row", () => {
  for (const tier of ["p16", "p32", "p64", "p128"] as const) {
    const plan = shippedDiskPlan(tier);
    expect(plan.rows.find((row) => row.id === "fpcalc")).toMatchObject({ label: "Song naming tool (chromaprint)", need: "recommended", selectable: true, download_bytes: 1_300_000 });
    expect(plan.default_selected).toContain("fpcalc");
    expect(plan.rows.find((row) => row.id === "shazam-signature")).toMatchObject({ label: "Song signature tool (shazamio-core)", need: "recommended", selectable: true, download_bytes: 1_700_000 });
    expect(plan.default_selected).toContain("shazam-signature");
  }
});

test("missing fpcalc readiness names the Settings page", () => {
  expect(identifyReadinessFor({ hasKey: false, hasFpcalc: false, hasLocalFingerprints: true, setting: "off" }).line).toBe("The song naming tool is not installed. Install it under Settings, AI and models.");
  expect(identifyReadinessFor({ hasKey: false, hasFpcalc: true, hasShazamHelper: false, hasLocalFingerprints: false, setting: "on" }).line).toContain("The song signature tool is not installed. Install it under Settings, AI and models.");
});
