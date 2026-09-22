// U0b (docs/plans/simple-turn-pipeline-2026-09-22.md, unit U0b): the
// no-new-rules lint. The old turn path grew about forty regexes and
// word lists deciding what to search and whether to trust the model's
// answer; the new path is built to have none. This counts every regex
// literal and every three-or-more-string-literal array ("a word list")
// in each turn-path file and fails the gate when a file's count grows
// past a committed baseline, unless the new line names itself: a
// `// rule: <ruleName> (<docs path or BACKLOG item id>)` comment where
// `<ruleName>` is a key in `src/lib/ruleNames.ts` (the counter row the
// `[turn]` line already prints hits for) AND `<docs path or BACKLOG
// item id>` names the accepted design record that allows it
// (`.github/docs/RULES-AND-LEARNED-COMPONENTS.md`, "No hacky rules,"
// 2026-09-22: "a new rule outside the protected modules fails the gate
// unless its marker names the design record that accepted it"). A
// marker with a rule name but no design reference still fails - it is
// not exempt, only named. A marked, referenced line is exempt from the
// budget - it is a named, counted, design-accepted rule, not a silent
// one. The baseline (`backend/rules-baseline.json`) may only go down:
// this script also fails when the working tree's baseline raises any
// file's number above what is committed at HEAD, so "just raise the
// number" is not a way past the gate. `turnNext.ts` (the rebuilt path,
// U2) starts at zero and stays there under the same rule.
//
// Run: `bun run backend/scripts/lint/rule-budget.ts` from the repo
// root or `backend/`. Exits 1 on any violation, printing every
// unmarked occurrence's file and line.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { execFileSync } from "node:child_process";
import ts from "typescript";
import { RULE_NAMES } from "../../src/lib/ruleNames.js";

/** The turn-path files the budget covers, relative to `backend/src/lib/`.
 * `turnNext.ts` does not exist yet (it is U2's file); it is listed here
 * so its baseline of 0 is enforced the moment it is created. */
export const TURN_PATH_FILES: readonly string[] = ["turnEngine.ts", "turnContext.ts", "guards.ts", "unknownNames.ts", "turnSignal.ts", "utteranceShape.ts", "routing.ts", "replyConstraints.ts", "unspokenArgs.ts", "composer.ts", "turnNext.ts"];

/** Modules the lint never scans at all, whatever they contain: the
 * safety floor and the other invariants RULES-AND-LEARNED-COMPONENTS.md
 * and the plan's point 1 name as staying deterministic on purpose.
 * These are outside `backend/src/lib/`, listed by their own repo-root
 * relative path (or, for commons, by name only - the lint never reads
 * outside this repo). */
export const PROTECTED_MODULES: readonly string[] = ["consentVocab.ts", "memoryContentPolicy.ts", "childDisclosure.ts", "contentCeiling.ts", "almanacCompute.ts", "commands.ts"];

// A marker names a rule and, in parentheses, the design record that
// accepted it: `// rule: lookup.forced (docs/plans/foo.md)` or
// `// rule: signal.rule (U2)`. The parenthesised group is optional in
// the pattern itself so a marker missing it is still recognised as
// "marked" (and reported as invalid), rather than treated as no marker
// at all.
const RULE_MARKER_RE = /\/\/\s*rule:\s*([A-Za-z0-9_.]+)(?:\s*\(([^)]*)\))?/;
const VALID_RULE_NAMES = new Set<string>(RULE_NAMES);

export interface Occurrence {
  kind: "regex" | "wordlist";
  line: number; // 1-based
  snippet: string;
  marked: boolean;
  markerName?: string;
  designRef?: string;
  markerValid: boolean;
}

export interface ScanResult {
  total: number;
  unmarked: number;
  occurrences: Occurrence[];
}

/** True when a string-literal-only array of 3+ elements would read as
 * a word list (`spec`'s own budget). Template literals with no
 * substitutions count the same as a plain string. */
function isWordListArray(node: ts.ArrayLiteralExpression): boolean {
  if (node.elements.length < 3) return false;
  return node.elements.every((el) => ts.isStringLiteralLike(el));
}

function isNewRegExpCall(node: ts.Node): node is ts.NewExpression {
  return ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "RegExp";
}

/** Whether any of the lines from `fromLine` to `toLine` (1-based,
 * inclusive) plus the line immediately before `fromLine` carries a
 * `// rule: <name>` marker. Checking one line back covers a marker
 * placed as its own comment line above the literal; checking through
 * `toLine` covers a trailing comment after a multi-line word list's
 * closing bracket. */
function findMarker(lines: readonly string[], fromLine: number, toLine: number): { marked: boolean; name?: string; designRef?: string } {
  for (let l = Math.max(1, fromLine - 1); l <= toLine; l++) {
    const text = lines[l - 1] ?? "";
    const m = RULE_MARKER_RE.exec(text);
    if (m) return { marked: true, name: m[1], designRef: m[2] };
  }
  return { marked: false };
}

/** A marker is valid only when its rule name is a real `ruleNames.ts`
 * key AND it carries a non-empty design reference in parentheses. */
function markerIsValid(marker: { marked: boolean; name?: string; designRef?: string }): boolean {
  if (!marker.marked || !marker.name) return false;
  if (!VALID_RULE_NAMES.has(marker.name)) return false;
  return !!marker.designRef && marker.designRef.trim().length > 0;
}

/** Scans one file's TypeScript source and returns every regex literal,
 * `new RegExp(...)` call, and 3+-string-literal array, each flagged
 * marked/unmarked. Exported standalone (no filesystem access) so tests
 * can feed it a fixture string directly. */
export function scanSource(sourceText: string, fileName: string): ScanResult {
  const sourceFile = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const lines = sourceText.split("\n");
  const occurrences: Occurrence[] = [];

  function lineOf(pos: number): number {
    return sourceFile.getLineAndCharacterOfPosition(pos).line + 1;
  }

  function visit(node: ts.Node) {
    if (ts.isRegularExpressionLiteral(node) || isNewRegExpCall(node)) {
      const startLine = lineOf(node.getStart(sourceFile));
      const endLine = lineOf(node.getEnd());
      const marker = findMarker(lines, startLine, endLine);
      occurrences.push({
        kind: "regex",
        line: startLine,
        snippet: (lines[startLine - 1] ?? "").trim().slice(0, 120),
        marked: marker.marked,
        markerName: marker.name,
        designRef: marker.designRef,
        markerValid: markerIsValid(marker),
      });
    } else if (ts.isArrayLiteralExpression(node) && isWordListArray(node)) {
      const startLine = lineOf(node.getStart(sourceFile));
      const endLine = lineOf(node.getEnd());
      const marker = findMarker(lines, startLine, endLine);
      occurrences.push({
        kind: "wordlist",
        line: startLine,
        snippet: (lines[startLine - 1] ?? "").trim().slice(0, 120),
        marked: marker.marked,
        markerName: marker.name,
        designRef: marker.designRef,
        markerValid: markerIsValid(marker),
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  const unmarked = occurrences.filter((o) => !o.markerValid).length;
  return { total: occurrences.length, unmarked, occurrences };
}

export interface Baseline {
  [file: string]: number;
}

function readBaseline(path: string): Baseline {
  return JSON.parse(readFileSync(path, "utf-8")) as Baseline;
}

/** Reads `path`'s content at HEAD, or null when the file is untracked
 * (a first commit adding it) or git is unavailable - a missing history
 * never blocks the gate, only a real decrease-then-fail does. */
function readBaselineAtHead(repoRoot: string, path: string): Baseline | null {
  try {
    const rel = relative(repoRoot, path);
    const out = execFileSync("git", ["show", `HEAD:${rel}`], { cwd: repoRoot, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });
    return JSON.parse(out) as Baseline;
  } catch {
    return null;
  }
}

function findRepoRoot(start: string): string {
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}

export function main(): number {
  const backendDir = join(import.meta.dir, "..", "..");
  const libDir = join(backendDir, "src", "lib");
  const baselinePath = join(backendDir, "rules-baseline.json");
  const baseline = readBaseline(baselinePath);

  const repoRoot = findRepoRoot(backendDir);
  const headBaseline = readBaselineAtHead(repoRoot, baselinePath);
  let ok = true;

  if (headBaseline) {
    // The union of both files' keys, not just the working tree's: a
    // key dropped from rules-baseline.json entirely still defaults to
    // a budget of 0 in the scan below (as strict as it gets), but this
    // loop reports the drop explicitly rather than silently skipping
    // it, so a rise hidden behind a delete-then-reappear edit is still
    // read against its real HEAD value.
    const allFiles = new Set([...Object.keys(baseline), ...Object.keys(headBaseline)]);
    for (const file of allFiles) {
      const before = headBaseline[file];
      const after = baseline[file] ?? 0;
      if (typeof before === "number" && after > before) {
        console.error(`rule-budget: ${baselinePath}'s baseline for ${file} rose from ${before} to ${after} - the baseline may only go down.`);
        ok = false;
      }
    }
  }

  for (const file of TURN_PATH_FILES) {
    if (PROTECTED_MODULES.includes(file)) continue;
    const fullPath = join(libDir, file);
    const budget = baseline[file] ?? 0;
    if (!existsSync(fullPath)) {
      if (budget > 0) {
        console.error(`rule-budget: ${file} has a baseline of ${budget} but does not exist.`);
        ok = false;
      }
      continue;
    }
    const source = readFileSync(fullPath, "utf-8");
    const result = scanSource(source, file);
    if (result.unmarked > budget) {
      console.error(`rule-budget: ${file} has ${result.unmarked} unmarked rule literal(s), over its baseline of ${budget}:`);
      for (const occ of result.occurrences.filter((o) => !o.markerValid)) {
        let why: string;
        if (!occ.marked) {
          why = "no // rule: <name> (<design ref>) marker";
        } else if (!occ.markerName || !VALID_RULE_NAMES.has(occ.markerName)) {
          why = `marker names "${occ.markerName}", not a key in ruleNames.ts`;
        } else {
          why = "marker names a rule but no design reference in parentheses";
        }
        console.error(`  ${file}:${occ.line} (${occ.kind}, ${why}): ${occ.snippet}`);
      }
      console.error(`  Fix: name the new rule in src/lib/ruleNames.ts and mark its literal(s) with "// rule: <name> (<docs path or BACKLOG item id>)" naming the design record that accepted it, or remove it. A file's baseline never needs raising by design.`);
      ok = false;
    }
  }

  return ok ? 0 : 1;
}

if (import.meta.main) {
  process.exit(main());
}
