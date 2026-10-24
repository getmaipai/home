import { afterAll, describe, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const roots: string[] = [];
const sourceScripts = ["watcher.sh", "pipeline.sh"];

function git(dir: string, ...args: string[]) {
  const out = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  if (out.status !== 0) throw new Error(`git ${args.join(" ")} failed (${out.status}): ${out.stderr}`);
  return out.stdout.trim();
}

function fixture() {
  const scratch = mkdtempSync(join(tmpdir(), "maipai-watcher-"));
  roots.push(scratch);
  const origin = join(scratch, "origin.git");
  const main = join(scratch, "main");
  const data = join(scratch, "watch-data");
  const warm = join(scratch, "home-watcher");
  const env = {
    ...process.env,
    MAIPAI_WATCH_DATA: data,
    MAIPAI_WATCH_CHECKOUT: warm,
    MAIPAI_WATCH_SKIP_INSTALL: "1",
    MAIPAI_WATCH_LEGS: "backend frontend",
    MAIPAI_LAND_GIT_ENV: "",
    MAIPAI_WATCH_SUITE_CMD: "bash scripts/suite.sh",
    MAIPAI_WATCH_RERUN_CMD: "bash scripts/rerun.sh",
    MAIPAI_WATCH_ISSUE_CMD: `bash ${join(scratch, "issue.sh")}`,
  };
  spawnSync("git", ["init", "--bare", "--initial-branch=main", origin], { encoding: "utf8" });
  spawnSync("git", ["clone", origin, main], { encoding: "utf8" });
  git(main, "config", "user.name", "Watcher Test");
  git(main, "config", "user.email", "watcher@example.test");
  mkdirSync(join(main, "scripts"), { recursive: true });
  for (const name of sourceScripts) copyFileSync(join(import.meta.dir, name), join(main, "scripts", name));
  writeFileSync(join(main, "scripts", "suite.sh"), "#!/usr/bin/env bash\nif [[ -f RED ]]; then echo '(fail) breaks [1ms]'; echo 'shard: failing files: backend/tests/broken.test.ts'; exit 1; fi\necho 'all green'\n");
  writeFileSync(join(main, "scripts", "rerun.sh"), "#!/usr/bin/env bash\nif [[ -f RED && ! -f FLAKY ]]; then exit 1; fi\nexit 0\n");
  writeFileSync(join(scratch, "issue.sh"), `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> '${join(scratch, "issue.calls")}'\n`);
  writeFileSync(join(main, "base.txt"), "base\n");
  git(main, "add", "-A");
  git(main, "commit", "-m", "fixture base");
  git(main, "push", "-u", "origin", "main");
  return { scratch, origin, main, data, warm, env };
}

function commit(f: ReturnType<typeof fixture>, message: string, files: Record<string, string>) {
  for (const [name, value] of Object.entries(files)) writeFileSync(join(f.main, name), value);
  git(f.main, "add", "-A");
  git(f.main, "commit", "-m", message);
  const sha = git(f.main, "rev-parse", "HEAD");
  git(f.main, "push", "origin", "main");
  return sha;
}

function run(f: ReturnType<typeof fixture>, script: string, args: string[] = []) {
  return spawnSync("bash", [join(f.main, "scripts", script), ...args], {
    cwd: f.main,
    env: f.env,
    encoding: "utf8",
    timeout: 60_000,
  });
}

function records(f: ReturnType<typeof fixture>) {
  return readFileSync(join(f.data, "runs.jsonl"), "utf8").trim().split(/\r?\n/).map((line) => JSON.parse(line));
}

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

  test("marks a failure flaky when the isolated rerun passes", () => {
    const f = fixture();
    expect(run(f, "watcher.sh", ["run-once"]).status).toBe(0);
    const sha = commit(f, "flaky tests", { RED: "red\n", FLAKY: "yes\n" });
    expect(run(f, "watcher.sh", ["run-once"]).status).toBe(0);
    expect(records(f).at(-1).result).toBe("flaky");
    expect(existsSync(join(f.data, "green", sha))).toBe(true);
    expect(existsSync(join(f.scratch, "issue.calls"))).toBe(false);
  }, 60_000);

  test("pipeline status reports watcher and latest green or red main result", () => {
    const green = fixture();
    expect(run(green, "watcher.sh", ["run-once"]).status).toBe(0);
    const greenStatus = run(green, "pipeline.sh", ["status"]).stdout;
    expect(greenStatus).toContain("watcher: stopped");
    expect(greenStatus).toContain("main: green at");

    const red = fixture();
    expect(run(red, "watcher.sh", ["run-once"]).status).toBe(0);
    const sha = commit(red, "break tests", { RED: "red\n" });
    expect(run(red, "watcher.sh", ["run-once"]).status).toBe(0);
    const redStatus = run(red, "pipeline.sh", ["status"]).stdout;
    expect(redStatus).toContain("watcher: stopped");
    expect(redStatus).toContain(`main: red at ${sha.slice(0, 7)}`);
    expect(redStatus).toContain(sha.slice(0, 7));
  }, 60_000);

  test("pipeline stop succeeds when neither service has a pid file", () => {
    const f = fixture();
    const out = run(f, "pipeline.sh", ["stop"]);
    expect(out.status).toBe(0);
    expect(out.stdout).toContain("lander already stopped");
    expect(out.stdout).toContain("watcher already stopped");
  });
});

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});
