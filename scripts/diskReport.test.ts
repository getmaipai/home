import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const run = (home: string, ...args: string[]) => Bun.spawnSync(["bash", join(import.meta.dir, "disk-report.sh"), ...args], { env: { ...process.env, HOME: home } });

test("the report is read only and --links names a symlink that points into a folder", () => {
  const home = mkdtempSync(join(tmpdir(), "disk-report-"));
  const target = join(home, "scratch-models"); mkdirSync(target);
  const keep = join(target, "model.bin"); writeFileSync(keep, "weights");
  mkdirSync(join(home, "Developer"));
  symlinkSync(target, join(home, "Developer", "sibling-link"));
  const links = run(home, "--links", target);
  expect(links.stdout.toString()).toContain("sibling-link");
  const report = run(home);
  expect(report.exitCode).toBe(0);
  expect(report.stdout.toString()).toContain("Free space");
  expect(existsSync(keep) && readFileSync(keep, "utf8")).toBe("weights");
});

test("--links with a missing folder is refused with a plain line", () => {
  const out = run(tmpdir(), "--links", "/nonexistent-folder-xyz");
  expect(out.exitCode).toBe(2);
  expect(out.stderr.toString()).toContain("give an existing folder");
});
