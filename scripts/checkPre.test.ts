import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const scratch = mkdtempSync(join(tmpdir(), "check-pre-test-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

test("--pre queues through the heavy slot unless the caller already holds it", () => {
  const repo = resolve(import.meta.dir, "..");
  const stub = join(scratch, "gate-lock.sh");
  const record = join(scratch, "args");
  writeFileSync(stub, `#!/usr/bin/env bash\nprintf '%s\\n' "$@" > '${record}'\nexit 0\n`, { mode: 0o755 });

  const queued = spawnSync("bash", ["scripts/check.sh", "--pre"], {
    cwd: repo, encoding: "utf8", env: { ...process.env, MAIPAI_GATE_LOCK: stub, GATE_HEAVY_HELD: "0" },
  });
  expect(queued.status).toBe(0);
  const args = readFileSync(record, "utf8").trim().split("\n");
  expect(args[0]).toBe("heavy");
  expect(args[1]).toMatch(/^home-pre-/);
  expect(args.slice(2)).toEqual(["--", "bash", "scripts/check.sh", "--pre"]);

  rmSync(record);
  const header = readFileSync(join(repo, "scripts/check.sh"), "utf8");
  expect(header).toContain('if [ "$PRE_ONLY" = 1 ] && [ "${GATE_HEAVY_HELD:-0}" != 1 ]; then');
  expect(() => readFileSync(record, "utf8")).toThrow();
});
