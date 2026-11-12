// HOST-GUARD-08: the recovery check a dev hub runs after the file-event service restart (scripts/fseventsRecovery.ts).
import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkRecovery } from "./fseventsRecovery";

const scratch = mkdtempSync(join(tmpdir(), "maipai-fsev-recovery-"));
afterAll(() => { rmSync(scratch, { recursive: true, force: true }); });

test("pass: a change made now is seen by a real watcher and the restart-window file is there", async () => {
  const probe = join(scratch, "pass"); mkdirSync(probe);
  writeFileSync(join(probe, "window.txt"), "1800000000\n");
  const result = await checkRecovery({ probe, restartedAt: 1_800_000_000, token: "1800000000", timeoutMs: 10_000 });
  expect(result).toMatchObject({ result: "pass", window_seen: true, restarted_at: 1_800_000_000 });
  expect(result.live_event_ms).toBeGreaterThanOrEqual(0);
});

test("fail: no change seen within the limit", async () => {
  const probe = join(scratch, "slow"); mkdirSync(probe);
  writeFileSync(join(probe, "window.txt"), "7\n");
  expect(await checkRecovery({ probe, restartedAt: 7, token: "7", timeoutMs: 0 })).toMatchObject({ result: "fail", live_event_ms: -1, window_seen: true });
});

test("fail: the file written during the restart window is missing or stale", async () => {
  const probe = join(scratch, "window"); mkdirSync(probe);
  writeFileSync(join(probe, "window.txt"), "6\n");
  expect(await checkRecovery({ probe, restartedAt: 7, token: "7", timeoutMs: 10_000 })).toMatchObject({ result: "fail", window_seen: false });
});

test("the command writes the result and its copy for the host guard, and exits 1 on a fail", () => {
  const probe = join(scratch, "cli"); const out = join(scratch, "cli-out.json"); const copy = join(scratch, "guard", "host-guard", "recovery", "k.json");
  const run = Bun.spawnSync(["bun", join(import.meta.dir, "fseventsRecovery.ts"), "--probe", probe, "--restarted-at", "9", "--token", "9", "--out", out, "--copy-to", copy, "--timeout-ms", "5000"], { stdout: "pipe", stderr: "pipe" });
  expect(run.exitCode).toBe(1);
  expect(run.stdout.toString()).toContain("Restart this dev hub");
  expect(JSON.parse(readFileSync(copy, "utf8"))).toMatchObject({ restarted_at: 9, result: "fail", window_seen: false });
  expect(readFileSync(out, "utf8")).toBe(readFileSync(copy, "utf8"));
});
