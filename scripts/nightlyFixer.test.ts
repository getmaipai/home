import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as fixtures from "./tests/landerFixtures";
const { scratch, origin, main, env, git, setup, cleanup } = fixtures.createLanderFixtures();

// NIGHTLY-FIXER-01: off by default; budget cap from a config file; after the run the script (not the prompt) rejects a proposal that touches
// RULES.md, a safety surface, the gates or an existing test; the failing tests are re-run; nothing is landed, shipped or pushed.
const data = () => join(scratch, "fixer-data");
const wts = () => join(scratch, "fixer-wts");
const day = () => new Date().toLocaleDateString("sv");
const conf = () => join(data(), "fixer.conf");
const md = () => readFileSync(join(data(), day(), "fixer.md"), "utf8");
const stubArgs = () => join(scratch, "stub-args");
let base = "";

function writeConf(over: Record<string, string> = {}) {
  const c = { enabled: "1", max_run_usd: "3", max_total_usd: "10", timeout_seconds: "60", ...over };
  writeFileSync(conf(), Object.entries(c).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");
}
function fixer(mode: string, sub = "run") {
  const r = Bun.spawnSync(["bash", join(main, "scripts", "nightly-fixer.sh"), sub], {
    cwd: main, stdout: "pipe", stderr: "pipe",
    env: { ...env, STUB_MODE: mode, MAIPAI_NIGHTLY_DATA: data(), MAIPAI_FIXER_CLAUDE: join(scratch, "stub-claude.sh"), MAIPAI_FIXER_CONF: conf(), MAIPAI_FIXER_WORKTREES: wts(), MAIPAI_FIXER_SKIP_INSTALL: "1",
      MAIPAI_FIXER_TEST_CMD: 'test "$(cat src.txt)" = fixed' } as Record<string, string>,
  });
  return { status: r.exitCode, out: r.stdout.toString() + r.stderr.toString() };
}
const branchExists = () => Bun.spawnSync(["git", "-C", main, "rev-parse", "--verify", "-q", `refs/heads/wt/nightly-fix-${day()}`]).exitCode === 0;

beforeAll(() => {
  setup();
  copyFileSync(join(import.meta.dir, "nightly-fixer.sh"), join(main, "scripts", "nightly-fixer.sh"));
  writeFileSync(join(main, "scripts", "wt.sh"), 'export WT_T2_GLOBS="docs/design/RULES.md backend/src/lib/safety*.ts"\n');
  mkdirSync(join(main, "docs", "design"), { recursive: true }); mkdirSync(join(main, "backend", "src", "lib"), { recursive: true });
  writeFileSync(join(main, "docs", "design", "RULES.md"), "rules\n");
  writeFileSync(join(main, "backend", "src", "lib", "safetyGate.ts"), "gate\n");
  writeFileSync(join(main, "src.txt"), "broken\n");
  writeFileSync(join(main, "a.test.ts"), "test('a', () => {});\n");
  git(main, "add", "-A"); git(main, "commit", "-qm", "fixture"); base = git(main, "rev-parse", "HEAD");
  mkdirSync(join(data(), day()), { recursive: true });
  writeFileSync(join(data(), "latest.json"), JSON.stringify({ sha: base, result: "failed" }));
  writeFileSync(join(data(), day(), "suite.log"), "(fail) a.test.ts > it breaks\n");
  // The stand-in for `claude -p`: records its arguments, then edits the worktree the way STUB_MODE says.
  writeFileSync(join(scratch, "stub-claude.sh"), `#!/bin/bash
echo "$@" > ${stubArgs()}
case "$STUB_MODE" in
  fix) echo fixed > src.txt ;;
  fix-and-add-test) echo fixed > src.txt; echo "test('new', () => {});" > b.test.ts ;;
  weaken-test) echo "test.skip('a', () => {});" > a.test.ts; echo fixed > src.txt ;;
  delete-test) rm a.test.ts; echo fixed > src.txt ;;
  edit-rules) echo "weaker" >> docs/design/RULES.md; echo fixed > src.txt ;;
  edit-safety) echo "open" >> backend/src/lib/safetyGate.ts; echo fixed > src.txt ;;
  wrong) echo "still broken" > src.txt ;;
  nothing) : ;;
esac
echo '{"total_cost_usd": 0.42, "result": "done"}'
`);
  chmodSync(join(scratch, "stub-claude.sh"), 0o755);
}, 60_000);
afterEach(() => {
  Bun.spawnSync(["git", "-C", main, "worktree", "remove", "--force", join(wts(), `nightly-fix-${day()}`)]);
  Bun.spawnSync(["git", "-C", main, "branch", "-D", `wt/nightly-fix-${day()}`]);
  Bun.spawnSync(["rm", "-f", join(data(), "fixer-spend.jsonl"), stubArgs()]);
});
afterAll(() => cleanup());

describe("nightly-fixer.sh", () => {
  test("off by default: with no config nothing is tried", () => {
    const r = fixer("fix");
    expect(r.status).toBe(0);
    expect(md()).toContain("off");
    expect(existsSync(stubArgs())).toBe(false);
    expect(branchExists()).toBe(false);
  });
  test("init writes a disabled config", () => {
    fixer("fix", "init");
    expect(readFileSync(conf(), "utf8")).toContain("enabled=0");
  });
  test("enabled: a source fix is proposed on its own branch, tests re-run green, never landed, shipped or pushed", () => {
    writeConf();
    const mainBefore = git(origin, "rev-parse", "refs/heads/main");
    const r = fixer("fix");
    expect(r.status).toBe(0);
    expect(md()).toContain("PROPOSED FIX");
    expect(md()).toContain("NOT landed, NOT shipped");
    expect(branchExists()).toBe(true);
    expect(git(origin, "rev-parse", "refs/heads/main")).toBe(mainBefore);
    expect(Bun.spawnSync(["git", "-C", origin, "rev-parse", "--verify", "-q", `refs/heads/wt/nightly-fix-${day()}`]).exitCode).not.toBe(0);
    expect(git(main, "show", `wt/nightly-fix-${day()}:src.txt`)).toBe("fixed");
  });
  test("the budget cap from the config goes to claude, with the guard flags", () => {
    writeConf({ max_run_usd: "2.5" });
    fixer("fix");
    const args = readFileSync(stubArgs(), "utf8");
    expect(args).toContain("--max-budget-usd 2.5");
    expect(args).toContain("--disallowedTools");
    expect(args).toContain("Bash(git push:*)");
  });
  test("the ledger refuses a run that would pass the total cap", () => {
    writeConf({ max_run_usd: "3", max_total_usd: "5" });
    writeFileSync(join(data(), "fixer-spend.jsonl"), JSON.stringify({ day: "x", usd: 4 }) + "\n");
    fixer("fix");
    expect(md()).toContain("budget");
    expect(existsSync(stubArgs())).toBe(false);
  });
  test("a run records its spend so the next one sees it", () => {
    writeConf();
    fixer("fix");
    expect(readFileSync(join(data(), "fixer-spend.jsonl"), "utf8")).toContain("0.42");
  });
  for (const [mode, what] of [["weaken-test", "a.test.ts"], ["delete-test", "a.test.ts"], ["edit-rules", "docs/design/RULES.md"], ["edit-safety", "backend/src/lib/safetyGate.ts"]] as const) {
    test(`rejects a proposal that touches ${what} (${mode}) and keeps nothing`, () => {
      writeConf();
      fixer(mode);
      expect(md()).toContain("REJECTED");
      expect(md()).toContain(what);
      expect(branchExists()).toBe(false);
    });
  }
  test("a new regression test file alongside the fix is allowed", () => {
    writeConf();
    fixer("fix-and-add-test");
    expect(md()).toContain("PROPOSED FIX");
  });
  test("a proposal whose tests still fail is reported as did not fix", () => {
    writeConf();
    fixer("wrong");
    expect(md()).toContain("DID NOT FIX");
    expect(md()).not.toContain("PROPOSED FIX");
  });
  test("no change proposed: reported, branch removed", () => {
    writeConf();
    fixer("nothing");
    expect(md()).toContain("no change proposed");
    expect(branchExists()).toBe(false);
  });
  test("when the last nightly run did not fail there is nothing to fix", () => {
    writeConf();
    const saved = readFileSync(join(data(), "latest.json"), "utf8");
    writeFileSync(join(data(), "latest.json"), JSON.stringify({ sha: base, result: "passed" }));
    fixer("fix");
    writeFileSync(join(data(), "latest.json"), saved);
    expect(md()).toContain("did not fail");
    expect(existsSync(stubArgs())).toBe(false);
  });
});
