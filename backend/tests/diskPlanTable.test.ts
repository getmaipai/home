import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import table from "../../shared/diskPlan.json";
import { selectionTotals, type DiskPlan } from "../../shared/diskPlanMath";

// shared/diskPlan.json is a verbatim copy of the Stack's docs/disk-plan.json (generated from the pins' byte counts and the
// measured table). The Stack's own tests hold the file to its pins; these hold Home's copy to the Stack that this Home pins.
const root = join(import.meta.dir, "..", "..");
const tiers = (table as unknown as { tiers: Record<string, DiskPlan> }).tiers;

describe("the disk plan table shipped with Home", () => {
  test("has every tier, each row once, sizes in bytes, and totals that add up from the rows", () => {
    expect(Object.keys(tiers)).toEqual(["p16", "p32", "p64", "p128"]);
    for (const plan of Object.values(tiers)) {
      const ids = plan.rows.map((row) => row.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const row of plan.rows) {
        expect(Number.isInteger(row.installed_bytes) && row.installed_bytes > 0).toBe(true);
        expect(row.installed_bytes).toBeGreaterThanOrEqual(row.download_bytes - 1);
        for (const engine of row.engines) expect(ids).toContain(engine);
      }
      expect(selectionTotals(plan, plan.default_selected)).toEqual(plan.default);
      expect(selectionTotals(plan, plan.rows.filter((row) => row.kind !== "engine").map((row) => row.id))).toEqual(plan.everything);
      expect(plan.margin_percent).toBe(20);
    }
  });

  test("the home table carries the installer's flat figures for the shell, the same as the tiers", () => {
    const flat = (table as unknown as { installer: Record<string, number> }).installer;
    for (const [id, plan] of Object.entries(tiers)) {
      expect(flat[`${id}.required_free_bytes`]).toBe(plan.default.required_free_bytes);
      expect(Math.abs(flat[`${id}.home_required_free_bytes`]! + flat[`${id}.ai_required_free_bytes`]! - plan.default.required_free_bytes)).toBeLessThanOrEqual(2);
    }
  });

  test("equals the Stack's own table at the Stack this Home pins (a pin bump copies docs/disk-plan.json here)", () => {
    const tag = /^STACK_TAG="([0-9a-f]{40})"/m.exec(readFileSync(join(root, "scripts", "install.sh"), "utf8"))?.[1];
    const stack = process.env.MAIPAI_STACK_DIR ?? join(root, "..", "stack");
    if (!tag || !existsSync(join(stack, ".git"))) return;
    const shown = Bun.spawnSync(["git", "-C", stack, "show", `${tag}:docs/disk-plan.json`], { stdout: "pipe", stderr: "ignore" });
    // A Stack older than the disk plan has no table to compare with; the first pin bump past it starts the check.
    if (shown.exitCode !== 0) return;
    expect(JSON.parse(shown.stdout.toString())).toEqual(table);
  });
});

describe("the docs quote the table", () => {
  const need = (tier: string, key: "default" | "everything") => Math.ceil((tiers[tier]![key].required_free_bytes + 2 * 1024 ** 3) / 1024 ** 3);
  for (const file of ["docs/user/install-upgrade-uninstall.md", "docs/site-fumadocs/content/docs/user/start-here/install-upgrade-uninstall.mdx"]) {
    test(`${file} gives each plan's free space and no stale 3 GB, 6 GB or 26 GB`, () => {
      const text = readFileSync(join(root, file), "utf8");
      expect(text).toContain(`| Recommended | 64 GB of memory or more | ${need("p64", "default")} GB |`);
      expect(text).toContain(`| Moderate | 32 GB | ${need("p32", "default")} GB |`);
      expect(text).toContain(`| Minimal | 16 or 24 GB | ${need("p16", "default")} GB |`);
      expect(text).toContain(`about ${need("p128", "everything")} GB`);
      expect(text).not.toMatch(/3 GB of free disk space for Home|needs 6 GB more|\| 26 GB \|/);
    });
  }
});
