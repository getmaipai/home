import { execFileSync } from "node:child_process";
import {
  cssKeys,
  decisionProblem,
  ledgerRows,
  NO_REASON_ED,
  overrideKeys,
  wrapperKeys,
  type CssOverrideBaseline,
  type OverrideBaseline,
  type WrapperBaseline,
} from "./kitElementLints";
import { normalizeOldBaseline, renamedEntryProblems, type NestedBaseline } from "./baselineRenames";
import type { HandBuiltBaseline } from "./handBuiltChat";

// PRECOMMIT-RULES-01: the fast half of the pre-commit check. The scans
// themselves are the existing tests (`bun run lint:ui-rules`); this compares
// what is STAGED against HEAD, so an edit that grows a shrink-only baseline or
// drops a ledger row or reason is refused before the scan even runs.
const DIR = "frontend/src/dev/";
export const LEDGER = "docs/design/ELEMENTS-DECISIONS.md";
export const BASELINES = {
  override: `${DIR}kit-classname-override-baseline.json`,
  css: `${DIR}kit-css-override-baseline.json`,
  wrapper: `${DIR}kit-wrapper-baseline.json`,
  handBuilt: `${DIR}hand-built-chat-baseline.json`,
};

/** Reads a repo path as staged or as HEAD has it; null when absent. */
export type Reader = (path: string, side: "staged" | "head") => string | null;

type Entry = { ed?: string; reason?: string };
const entriesOf = (json: Record<string, Record<string, unknown>>) =>
  new Map(Object.entries(json).flatMap(([file, by]) => Object.entries(by).map(([name, e]) => [`${file}: ${name}`, e as Entry] as const)));

/** Apply the pure NEXT-RETIRE-01 git-mv path/symbol mapping to the old
 * baseline so the shrink-only check compares the same entries by identity. */
const normalizeMovedKeys = normalizeOldBaseline;

export function guardProblems(read: Reader, staged: string[]): string[] {
  const out: string[] = [];
  const both = <T>(path: string): [T | null, T | null] => {
    const s = read(path, "staged"), h = read(path, "head");
    return [s ? (JSON.parse(s) as T) : null, h ? (JSON.parse(h) as T) : null];
  };
  const grew = (path: string, now: string[], was: string[]) => {
    const added = now.filter((k) => !was.includes(k));
    if (added.length) out.push(`${path} grew (baselines only shrink): ${added.slice(0, 5).join("; ")}${added.length > 5 ? ` (+${added.length - 5} more)` : ""}. Remove the violation from the code instead of listing it.`);
  };
  const isStaged = (p: string) => staged.includes(p);
  if (isStaged(BASELINES.override)) { const [s, h] = both<OverrideBaseline>(BASELINES.override); if (s && h) grew(BASELINES.override, overrideKeys(s), overrideKeys(normalizeMovedKeys(h) as OverrideBaseline)); }
  if (isStaged(BASELINES.css)) { const [s, h] = both<CssOverrideBaseline>(BASELINES.css); if (s && h) grew(BASELINES.css, cssKeys(s), cssKeys(normalizeMovedKeys(h) as CssOverrideBaseline)); }
  if (isStaged(BASELINES.wrapper)) { const [s, h] = both<WrapperBaseline>(BASELINES.wrapper); if (s && h) grew(BASELINES.wrapper, wrapperKeys(s), wrapperKeys(normalizeMovedKeys(h) as WrapperBaseline)); }
  // NEXT-RETIRE-02E-GUARD: a renamed entry keeps its reason, ed and properties.
  for (const path of [BASELINES.override, BASELINES.css, BASELINES.wrapper]) {
    if (!isStaged(path)) continue;
    const [s, h] = both<NestedBaseline>(path);
    if (s && h) for (const p of renamedEntryProblems(h, s)) out.push(`${path} ${p}.`);
  }
  if (isStaged(BASELINES.handBuilt)) {
    const [s, h] = both<HandBuiltBaseline>(BASELINES.handBuilt);
    const flat = (b: HandBuiltBaseline) => Object.entries(b).flatMap(([f, names]) => names.map((n) => `${f}: ${n}`));
    if (s && h) grew(BASELINES.handBuilt, flat(s), flat(normalizeMovedKeys(h) as HandBuiltBaseline));
  }
  // Reasons: an entry that had a real reason may not lose it or fall back to NO-REASON-REMOVE.
  const stagedLedger = read(LEDGER, "staged");
  for (const [path] of [[BASELINES.override], [BASELINES.css], [BASELINES.wrapper]]) {
    if (!isStaged(path!) && !isStaged(LEDGER)) continue;
    const [s, h] = both<Record<string, Record<string, unknown>>>(path!);
    if (!s) continue;
    const before = h ? entriesOf(normalizeMovedKeys(h) as Record<string, Record<string, unknown>>) : new Map<string, Entry>();
    const ledger = stagedLedger ? ledgerRows(stagedLedger) : null;
    for (const [key, e] of entriesOf(s)) {
      const was = before.get(key);
      if (was?.reason?.trim() && !e.reason?.trim()) out.push(`${path} ${key} lost its reason. Every exception keeps a reason and an ED row in ${LEDGER}.`);
      else if (was && was.ed !== NO_REASON_ED && e.ed === NO_REASON_ED) out.push(`${path} ${key} was downgraded to ${NO_REASON_ED}. Keep its ED row.`);
      else if (ledger) {
        const p = decisionProblem(e, ledger);
        if (p) out.push(`${path} ${key} ${p}. Add or cite its row in ${LEDGER}.`);
      }
    }
  }
  if (isStaged(LEDGER)) {
    const h = read(LEDGER, "head");
    if (stagedLedger && h) {
      const now = ledgerRows(stagedLedger), was = ledgerRows(h);
      const dropped = [...was.keys()].filter((id) => !now.has(id));
      if (dropped.length) out.push(`${LEDGER} lost row(s) ${dropped.join(", ")}. Mark a finished row "removed" instead of deleting it.`);
    }
  }
  return out;
}

const git = (args: string[]) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const gitReader: Reader = (path, side) => {
  try { return git(["show", `${side === "staged" ? ":" : "HEAD:"}${path}`]); } catch { return null; }
};

if (import.meta.main) {
  const staged = git(["diff", "--cached", "--name-only", "--diff-filter=ACMR"]).split("\n").filter(Boolean);
  const problems = guardProblems(gitReader, staged);
  if (problems.length) {
    console.error(`ui-rules: commit refused (RULES.md rule 9)\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
}
