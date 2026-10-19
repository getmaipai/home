// RELEASE-GATE-01: decides whether a release can reuse a green full gate run
// instead of running scripts/check.sh again (about 8 minutes, most of it the
// backend tests). A run is reusable when it is a full-scope gate that exited 0
// within the last 4 hours, tested exactly a commit (`clean`, see check.sh), and
// the difference between that commit's tree and the release working tree is
// docs-only by the gate's own scope rules (scripts/gateScope.ts). The test is
// on content, not history: a branch gated and then rebased by `wt.sh land`
// still counts when nothing else changed the code. The release then runs `check.sh --docs` for those
// docs changes. The release commit's own version bump (root package.json with
// only "version" changed) is release metadata, not code. Anything else runs the
// full gate. scripts/release-gate.sh is
// the one command the release skill calls.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { classifyScope } from "../gateScope";
import type { GateRun } from "./stats";

export const DEFAULT_MAX_AGE_SECONDS = 4 * 60 * 60;

export type ReuseDecision =
  | { reuse: true; run: GateRun; changed: string[]; why: string }
  | { reuse: false; why: string };

export interface ReuseDeps {
  /** True when `sha` names a commit in this repository. */
  exists(sha: string): boolean;
  /** Files that differ between `sha` and the working tree, committed or not. */
  changedSince(sha: string): string[];
  /** True when root package.json differs from `sha` only in its "version" field. */
  versionOnlyBump(sha: string): boolean;
}

export function sameExceptVersion(before: string, after: string): boolean {
  try {
    const a = JSON.parse(before) as Record<string, unknown>;
    const b = JSON.parse(after) as Record<string, unknown>;
    delete a.version;
    delete b.version;
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

export function parseRuns(source: string): GateRun[] {
  return source.split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try {
      return [JSON.parse(line) as GateRun];
    } catch {
      return [];
    }
  });
}

export function decideReuse(runs: GateRun[], deps: ReuseDeps, now: Date, maxAgeSeconds = DEFAULT_MAX_AGE_SECONDS): ReuseDecision {
  const oldest = now.getTime() - maxAgeSeconds * 1000;
  const green = runs
    .filter((r) => r.run_kind === "gate" && r.scope === "full" && r.exit === 0)
    .filter((r) => Date.parse(r.ended_at) >= oldest)
    .sort((a, b) => Date.parse(b.ended_at) - Date.parse(a.ended_at));
  if (green.length === 0) {
    return { reuse: false, why: `no green full gate run in the last ${Math.round(maxAgeSeconds / 3600)} h` };
  }
  let lastWhy = "";
  for (const run of green) {
    if (run.clean !== true) {
      lastWhy = lastWhy || `green run ${run.head.slice(0, 8)} had uncommitted files or moved HEAD, so it did not test a commit`;
      continue;
    }
    if (!deps.exists(run.head)) {
      lastWhy = lastWhy || `green run ${run.head.slice(0, 8)} is not a commit in this repository`;
      continue;
    }
    const changed = deps.changedSince(run.head).filter((f) => f !== "package.json" || !deps.versionOnlyBump(run.head));
    if (changed.length === 0) {
      return { reuse: true, run, changed, why: `green full gate at ${run.head.slice(0, 8)} (${run.ended_at}), nothing changed since` };
    }
    const scope = classifyScope(changed);
    if (scope.scope === "docs") {
      return { reuse: true, run, changed, why: `green full gate at ${run.head.slice(0, 8)} (${run.ended_at}), only docs changed since (${changed.length} file(s))` };
    }
    lastWhy = lastWhy || `code differs from the newest usable green run (${run.head.slice(0, 8)}): ${scope.why}`;
  }
  return { reuse: false, why: lastWhy };
}

function git(root: string, args: string[]): { ok: boolean; out: string } {
  const res = Bun.spawnSync(["git", "-C", root, ...args], { stdout: "pipe", stderr: "pipe" });
  return { ok: res.exitCode === 0, out: res.stdout.toString() };
}

if (import.meta.main) {
  const root = git(process.cwd(), ["rev-parse", "--show-toplevel"]).out.trim();
  const common = git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).out.trim();
  const runsPath = process.env.MAIPAI_GATE_STATS_OUTPUT ?? join(common, "..", "data-scratch", "gate-stats", "runs.jsonl");
  let source = "";
  try {
    source = readFileSync(runsPath, "utf8");
  } catch {
    // No stats file yet: nothing to reuse.
  }
  const maxAge = Number(process.env.MAIPAI_RELEASE_GATE_MAX_AGE ?? DEFAULT_MAX_AGE_SECONDS);
  const decision = decideReuse(parseRuns(source), {
    exists: (sha) => git(root, ["cat-file", "-e", `${sha}^{commit}`]).ok,
    changedSince: (sha) => {
      const committed = git(root, ["diff", "--name-only", sha]).out;
      const untracked = git(root, ["ls-files", "--others", "--exclude-standard"]).out;
      return [...new Set(`${committed}\n${untracked}`.split("\n").filter(Boolean))];
    },
    versionOnlyBump: (sha) => {
      const before = git(root, ["show", `${sha}:package.json`]);
      return before.ok && sameExceptVersion(before.out, readFileSync(join(root, "package.json"), "utf8"));
    },
  }, new Date(), Number.isFinite(maxAge) ? maxAge : DEFAULT_MAX_AGE_SECONDS);
  console.log(`release gate: ${decision.reuse ? "reuse" : "full run"}: ${decision.why}`);
  process.exit(decision.reuse ? 0 : 1);
}
