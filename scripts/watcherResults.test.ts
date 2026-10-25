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
    writeFileSync(join(f.main, "scripts/suite.sh"), "#!/usr/bin/env bash\nif [[ -f RED ]]; then\n  echo '== leg: backend (exit 1, 12 s)'\n  echo 'shard: failing files: backend/tests/a.test.ts'\n  echo '== leg: frontend (exit 1, 8 s)'\n  echo 'shard: failing files: frontend/src/b.test.ts'\n  exit 1\nfi\necho 'all green'\n");
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
