import { afterAll, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

// The preflight typechecks run through run_parallel_stages() in scripts/check.sh. The real preflight needs a full
// checkout and pins, so this extracts that one function live from check.sh (never a hand-kept copy) and runs it with
// a stub `bunx` on PATH that sleeps 2 s per call.

const scratch = mkdtempSync(join(tmpdir(), "check-pre-parallel-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function run(failing: string | null) {
  const checkSh = readFileSync(join(import.meta.dir, "check.sh"), "utf8");
  const fn = checkSh.match(/^run_parallel_stages\(\) \{[\s\S]*?\n\}\n/m)?.[0];
  if (!fn) throw new Error("could not extract run_parallel_stages() from check.sh");
  const bin = join(scratch, `bin-${failing ?? "ok"}`);
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "bunx"), `#!/usr/bin/env bash\nsleep 2\necho "tsc $PWD $*"\n[ "$MARK" = "$(basename "$PWD")$*" ] && { echo "error TS1000"; exit 1; }\nexit 0\n`);
  chmodSync(join(bin, "bunx"), 0o755);
  for (const d of ["backend", "frontend"]) mkdirSync(join(scratch, d), { recursive: true });
  const script = `set -euo pipefail
stage() { echo "== $1"; }
${fn}
cd "${scratch}"
rc=0
run_parallel_stages \\
  "pre: backend and scripts typecheck" "cd backend && bunx tsc --noEmit" \\
  "pre: backend and scripts typecheck" "cd backend && bunx tsc --noEmit -p ../scripts/tsconfig.json" \\
  "pre: frontend typecheck" "cd frontend && bunx tsc --noEmit" || rc=$?
echo "rc=$rc"
`;
  const start = Date.now();
  const proc = spawnSync("bash", ["-c", script], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, MARK: failing ?? "none" },
  });
  return { out: proc.stdout, seconds: (Date.now() - start) / 1000 };
}

test("three 2 s typechecks run at once and all pass", () => {
  const r = run(null);
  expect(r.seconds).toBeLessThan(6);
  expect(r.out).toContain("rc=0");
  expect(r.out.match(/^== /gm)?.length).toBe(3);
});

test("one failing typecheck fails the run, prints every output, and its stage line comes last", () => {
  const r = run("frontendtsc --noEmit");
  expect(r.seconds).toBeLessThan(6);
  expect(r.out).toContain("rc=1");
  const stages = r.out.split("\n").filter((l) => l.startsWith("== "));
  expect(stages.length).toBe(3);
  expect(stages[stages.length - 1]).toBe("== pre: frontend typecheck");
  expect(r.out.indexOf("error TS1000")).toBeGreaterThan(r.out.lastIndexOf("== pre: backend"));
  expect(r.out.match(/^tsc /gm)?.length).toBe(3);
});
