import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import * as fixtures from "./tests/watcherFixtures";
const { roots, git, fixture, pushScriptChange, commit, run, records } = fixtures.createWatcherFixtures();

describe("main watcher", () => {
  test("records green, skips an unchanged main, and reports green status", () => {
    const f = fixture();
    const sha = git(f.main, "rev-parse", "HEAD");
    const first = run(f, "watcher.sh", ["run-once"]);
    expect(first.status).toBe(0);
    expect(existsSync(join(f.data, "green", sha))).toBe(true);
    expect(readFileSync(join(f.data, "last-green"), "utf8").trim()).toBe(sha);
    expect(records(f)[0].result).toBe("green");
    expect(run(f, "watcher.sh", ["run-once"]).stdout).toContain("up to date");
  }, 60_000);

  test("checked T2 wanted sha runs first, writes green, and clears wanted ancestors", () => {
    const f = fixture();
    const sha = git(f.main, "rev-parse", "HEAD");
    const wanted = join(f.data, "t2-wanted"); mkdirSync(wanted, { recursive: true });
    writeFileSync(join(wanted, sha), "wt/checked\nbackend/src/db/migrations/1000_test.sql\n2026-11-14T00:00:00Z\n");
    const out = run(f, "watcher.sh", ["run-once"], { ...f.env, MAIPAI_LAND_T2_CMD: "echo t2-pass" });
    expect(out.status).toBe(0); expect(out.stdout).toContain("checked T2 green");
    expect(existsSync(join(f.data, "t2-green", sha))).toBe(true);
    expect(existsSync(join(wanted, sha))).toBe(false);
  }, 60_000);

  test("LAND-FIRST-01: in direct mode a failing post-landing check (typecheck or boot) records red and skips the suite; gated and unset skip the check", () => {
    const f = fixture();
    expect(run(f, "watcher.sh", ["run-once"]).status).toBe(0);
    const modeFile = join(f.scratch, "mode");
    writeFileSync(modeFile, "direct\n");
    mkdirSync(join(f.main, "scripts", "lib"), { recursive: true });
    copyFileSync(join(import.meta.dir, "lib", "mode.sh"), join(f.main, "scripts", "lib", "mode.sh"));
    const env = { ...f.env, MAIPAI_MODE_FILE: modeFile, MAIPAI_WATCH_POST_CMD: "echo typecheck error TS2322; exit 1" };
    const sha = commit(f, "land a type error", { OK: "1\n" });
    const out = run(f, "watcher.sh", ["run-once"], env);
    expect(out.stdout).toContain("post-landing-check");
    const last = records(f).at(-1);
    expect(last.result).toBe("red");
    expect(last.failing).toEqual(["post-landing-check"]);
    expect(readFileSync(join(f.data, "reds", `${sha}.md`), "utf8")).toContain("TS2322");
    expect(existsSync(join(f.data, "green", sha))).toBe(false);
    // The same failing check in gated mode does not run: the suite decides.
    writeFileSync(modeFile, "gated\n");
    const sha2 = commit(f, "next landing", { OK2: "1\n" });
    expect(run(f, "watcher.sh", ["run-once"], env).stdout).toContain("green at");
    expect(existsSync(join(f.data, "green", sha2))).toBe(true);
  }, 90_000);

  test("records red, identifies the landing, writes a note and files one issue", () => {
    const f = fixture();
    expect(run(f, "watcher.sh", ["run-once"]).status).toBe(0);
    const sha = commit(f, "break tests", { RED: "red\n" });
    const out = run(f, "watcher.sh", ["run-once"]);
    expect(out.status).toBe(0);
    const last = records(f).at(-1);
    expect(last.result).toBe("red");
    expect(last.culprit).toBe(sha);
    expect(readFileSync(join(f.data, "reds", `${sha}.md`), "utf8")).toContain("backend/tests/broken.test.ts");
    expect(existsSync(join(f.scratch, "issue.calls"))).toBe(true);
    expect(readFileSync(join(f.scratch, "issue.calls"), "utf8")).toContain("backend/tests/broken.test.ts");
    expect(existsSync(join(f.data, "green", sha))).toBe(false);
  }, 60_000);

  test("records failing files from multiple leg sections", () => {
    const f = fixture();
    writeFileSync(join(f.main, "scripts/suite.sh"), "#!/usr/bin/env bash\nif [[ -f RED ]]; then\n  echo '== leg: backend (exit 1, 12 s)'\n  echo 'error: backend boom message'\n  echo '(fail) backend thing > breaks [3ms]'\n  echo 'shard: failing files: backend/tests/a.test.ts'\n  for i in $(seq 1 80); do echo \"(pass) filler $i\"; done\n  echo '== leg: frontend (exit 1, 8 s)'\n  echo 'shard: failing files: frontend/src/b.test.ts'\n  exit 1\nfi\necho 'all green'\n");
    writeFileSync(join(f.main, "scripts/rerun.sh"), "#!/usr/bin/env bash\nexit 1\n");
    git(f.main, "add", "-A");
    git(f.main, "commit", "-m", "fixture multi-leg suite");
    git(f.main, "push", "origin", "main");
    expect(run(f, "watcher.sh", ["run-once"]).status).toBe(0);
    const sha = commit(f, "break backend and frontend tests", { RED: "red\n" });
    expect(run(f, "watcher.sh", ["run-once"]).status).toBe(0);
    const last = records(f).at(-1);
    expect(last.result).toBe("red");
    expect(last.failing).toEqual(["backend/tests/a.test.ts", "frontend/src/b.test.ts"]);
    const note = readFileSync(join(f.data, "reds", `${sha}.md`), "utf8");
    expect(note).toContain("backend/tests/a.test.ts");
    expect(note).toContain("frontend/src/b.test.ts");
    expect(note).toContain("== leg: backend (exit 1, 12 s)");
    expect(note).toContain("== leg: frontend (exit 1, 8 s)");
    expect(note).toContain("error: backend boom message");
    expect(note).toContain("(fail) backend thing > breaks");
  }, 60_000);

  test("a red run with no failing-file lines still records red (bash 3.2 empty array)", () => {
    const f = fixture();
    writeFileSync(join(f.main, "scripts/suite.sh"), "#!/usr/bin/env bash\nif [[ -f RED ]]; then\n  echo 'bun install failed: link error'\n  exit 1\nfi\necho 'all green'\n");
    git(f.main, "add", "-A");
    git(f.main, "commit", "-m", "fixture suite without failing-file lines");
    git(f.main, "push", "origin", "main");
    expect(run(f, "watcher.sh", ["run-once"]).status).toBe(0);
    const sha = commit(f, "break the install", { RED: "red\n" });
    const out = run(f, "watcher.sh", ["run-once"]);
    expect(out.stderr).not.toContain("unbound variable");
    expect(out.status).toBe(0);
    const last = records(f).at(-1);
    expect(last.result).toBe("red");
    expect(last.sha).toBe(sha);
    expect(last.failing).toEqual([]);
  }, 60_000);

  test("bisects multiple landings to the commit that introduced RED", () => {
    const f = fixture();
    expect(run(f, "watcher.sh", ["run-once"]).status).toBe(0);
    commit(f, "harmless one", { "one.txt": "one\n" });
    const culprit = commit(f, "introduce RED", { RED: "red\n" });
    commit(f, "harmless two", { "two.txt": "two\n" });
    expect(run(f, "watcher.sh", ["run-once"]).status).toBe(0);
    expect(records(f).at(-1).culprit).toBe(culprit);
  }, 60_000);

  test("retries each isolated failure and only marks red when every rerun fails", () => {
    const flaky = fixture();
    expect(run(flaky, "watcher.sh", ["run-once"]).status).toBe(0);
    commit(flaky, "flaky reruns", { RED: "red\n" });
    const counter = join(flaky.scratch, "rerun.counter");
    const counterScript = join(flaky.scratch, "rerun-counter.sh");
    writeFileSync(counterScript, `#!/usr/bin/env bash\nn=0; [[ -f '${counter}' ]] && n=$(cat '${counter}'); n=$((n+1)); echo "$n" > '${counter}'; (( n >= 3 ))\n`);
    expect(run(flaky, "watcher.sh", ["run-once"], {
      ...flaky.env,
      MAIPAI_WATCH_RERUN_CMD: `bash ${counterScript}`,
      MAIPAI_WATCH_RERUNS: "3",
    }).status).toBe(0);
    expect(records(flaky).at(-1).result).toBe("flaky");

    const red = fixture();
    expect(run(red, "watcher.sh", ["run-once"]).status).toBe(0);
    commit(red, "always red alone", { RED: "red\n" });
    writeFileSync(join(red.main, "scripts/rerun.sh"), "#!/usr/bin/env bash\nexit 1\n");
    expect(run(red, "watcher.sh", ["run-once"], { ...red.env, MAIPAI_WATCH_RERUNS: "3" }).status).toBe(0);
    expect(records(red).at(-1).result).toBe("red");
  }, 60_000);
});

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});
