import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, appendFileSync, mkdirSync, cpSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// check.sh's own compute_scope() (bash, not TypeScript) is what
// actually decides a real gate run's scope - gateScope.test.ts proves
// classifyScope() is correct for whatever file list it's handed, but
// the bug this file exists to catch (another session's own untracked
// file widening a --docs run) lived entirely in check.sh's own
// gathering step, upstream of classifyScope() - a suite that only
// tests classifyScope() would stay green if that gathering step ever
// regressed. Runs the real gate_diff_base()/compute_scope() functions,
// extracted live from the real scripts/check.sh (never a hand-kept
// copy that can drift from it), against a real scratch git repo.

function extractComputeScope(): string {
  const checkSh = readFileSync(join(import.meta.dir, "check.sh"), "utf-8");
  const gateDiffBase = checkSh.match(/^gate_diff_base\(\) \{[\s\S]*?\n\}\n/m)?.[0];
  const computeScope = checkSh.match(/^compute_scope\(\) \{[\s\S]*?\n\}\n/m)?.[0];
  if (!gateDiffBase || !computeScope) {
    throw new Error("could not extract gate_diff_base()/compute_scope() from check.sh - did its own function shape change?");
  }
  return gateDiffBase + computeScope;
}

function runScope(repoDir: string): { scope: string; why: string } {
  const script = `#!/usr/bin/env bash
set -euo pipefail
cd "${repoDir}"
${extractComputeScope()}
SCOPE=""; SCOPE_WHY=""
compute_scope
echo "$SCOPE"
echo "$SCOPE_WHY"
`;
  const scriptPath = join(repoDir, "..", "run-scope.sh");
  writeFileSync(scriptPath, script);
  const proc = Bun.spawnSync(["bash", scriptPath]);
  if (proc.exitCode !== 0) {
    throw new Error(`compute_scope() script failed: ${proc.stderr.toString()}`);
  }
  const [scope, ...whyParts] = proc.stdout.toString().trim().split("\n");
  return { scope: scope ?? "", why: whyParts.join("\n") };
}

function git(repoDir: string, ...args: string[]): void {
  const proc = Bun.spawnSync(["git", "-C", repoDir, ...args], { env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t.com" } });
  if (proc.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${proc.stderr.toString()}`);
  }
}

describe("check.sh's own compute_scope() (real bash, real git, not classifyScope() in isolation)", () => {
  let root: string;
  let origin: string;
  let repo: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "check-scope-test-"));
    origin = join(root, "origin.git");
    repo = join(root, "repo");
    git(root, "init", "-q", "--bare", origin);
    mkdirSync(repo);
    git(repo, "init", "-q");
    git(repo, "checkout", "-q", "-b", "main");
    mkdirSync(join(repo, "docs"), { recursive: true });
    mkdirSync(join(repo, "frontend", "src"), { recursive: true });
    mkdirSync(join(repo, "backend", "scripts", "bench"), { recursive: true });
    mkdirSync(join(repo, "scripts"), { recursive: true });
    writeFileSync(join(repo, "docs", "dev.md"), "root doc\n");
    writeFileSync(join(repo, "frontend", "src", "a.tsx"), "hi\n");
    writeFileSync(join(repo, "backend", "scripts", "bench", "existing.ts"), "hi\n");
    cpSync(join(import.meta.dir, "gateScope.ts"), join(repo, "scripts", "gateScope.ts"));
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "init");
    git(repo, "remote", "add", "origin", origin);
    git(repo, "push", "-q", "origin", "main", "-u");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("a tracked docs change plus an untracked file elsewhere still scopes to docs - the untracked file never widens it", () => {
    // The exact live bug (2026-09-23): another session's own stray
    // output (backend/scripts/bench/query-rewrite.ts, untracked) sat
    // in the same shared checkout during a `--docs` run and widened
    // the computed scope to `backend`, costing the full four-minute
    // suite for a docs-only change.
    appendFileSync(join(repo, "docs", "dev.md"), "a real doc change\n");
    writeFileSync(join(repo, "backend", "scripts", "bench", "stray-from-another-session.ts"), "// not part of this commit\n");
    const result = runScope(repo);
    expect(result.scope).toBe("docs");
  });

  test("a brand-new untracked file, with nothing tracked changed at all, still scopes narrowly - not full", () => {
    // A review of the fix above caught this: dropping untracked files
    // unconditionally broke the ordinary case of creating a file and
    // running check.sh before the first `git add` (this file's own
    // header comment: "at the moment check.sh actually runs there is
    // usually nothing staged"), forcing `full` on every new-file-only
    // change - exactly the cost GATE-SCOPE-01 exists to eliminate.
    writeFileSync(join(repo, "frontend", "src", "newPanel.tsx"), "export const x = 1;\n");
    const result = runScope(repo);
    expect(result.scope).toBe("frontend");
  });

  test("a clean tree (nothing tracked or untracked changed) scopes to full, verifying the full state", () => {
    const result = runScope(repo);
    expect(result.scope).toBe("full");
  });

  test("a tracked change plus a co-occurring untracked file in a DIFFERENT area narrows to the tracked area only - a documented, accepted gap, not an oversight", () => {
    // A second review round caught this directly: since compute_scope()
    // can't tell "another session's unrelated stray file" apart from
    // "my own new file for this same commit, just not staged yet",
    // this case (a real docs edit plus a brand-new frontend file, both
    // meant for one commit) narrows to `docs` only - the frontend file
    // is silently dropped from THIS run's own scope. That's accepted,
    // not a bug: check.sh's own compute_scope() is a fast, best-effort
    // convenience, never the actual safety boundary - require-gate-
    // before-commit.sh (GATE-HOOK-01, getmaipai/.github) recomputes
    // the required scope from the REAL staged diff at commit time and
    // denies a commit whose stamp doesn't cover it, so this narrower
    // scope can delay a commit (an honest denial naming the real scope
    // needed) but can never let it land unverified. Confirmed live
    // (not asserted here, since GATE-HOOK-01 lives in a different
    // repo): staging both files and attempting the commit against a
    // stale `docs` stamp denies with "needs 'frontend'", every time.
    appendFileSync(join(repo, "docs", "dev.md"), "a real doc change\n");
    writeFileSync(join(repo, "frontend", "src", "newPanel.tsx"), "export const x = 1;\n");
    const result = runScope(repo);
    expect(result.scope).toBe("docs");
  });
});
