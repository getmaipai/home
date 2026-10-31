import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const script = resolve(import.meta.dir, "pipeline.sh");

test("pipeline.sh stack off, on and status drive launchctl for the Stack label", () => {
  const dir = mkdtempSync(join(tmpdir(), "pipeline-stack-"));
  try {
    const log = join(dir, "calls"), state = join(dir, "loaded");
    const fake = join(dir, "launchctl");
    writeFileSync(fake, `#!/usr/bin/env bash\necho "$@" >> '${log}'\ncase "$1" in print) [ -f '${state}' ];; bootout) rm -f '${state}';; bootstrap) : > '${state}';; esac\n`);
    chmodSync(fake, 0o755);
    writeFileSync(state, "");
    const run = (arg: string) => Bun.spawnSync(["bash", script, "stack", arg], { env: { ...process.env, MAIPAI_LAUNCHCTL: fake, MAIPAI_STACK_LABEL: "test.stack", MAIPAI_STACK_PLIST: join(dir, "s.plist"), MAIPAI_LAND_DATA: join(dir, "land"), MAIPAI_WATCH_DATA: join(dir, "watch"), MAIPAI_LAND_GIT_ENV: "" }, cwd: resolve(import.meta.dir, "..") });
    expect(run("status").stdout.toString()).toContain("stack: running");
    expect(run("off").stdout.toString()).toContain("stack stopped");
    expect(run("status").stdout.toString()).toContain("stack: stopped");
    expect(run("off").stdout.toString()).toContain("already stopped");
    expect(run("on").stdout.toString()).toContain("stack started");
    expect(run("on").stdout.toString()).toContain("already running");
    const calls = readFileSync(log, "utf8");
    expect(calls).toContain("bootout gui/");
    expect(calls).toContain("bootstrap gui/");
    expect(run("bogus").exitCode).toBe(2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
