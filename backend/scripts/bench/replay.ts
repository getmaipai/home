// U0a (docs/plans/simple-turn-pipeline-2026-09-22.md, point 4 and unit
// U0a): the owner's replay set. Mirrors conversation.ts's own runner
// shape (a pure, importable fixture-scoring core; a dual offline/
// --live entry point; the live half's import-order rule that the
// engine's env vars are set before anything reaches "@/db") but for
// backend/scripts/bench/datasets/owner-replay.json instead of
// conversationFixture.ts's CONVERSATIONS, run three times per row (the
// plan's own pass bar: "on all three repeats"), and reported as two
// blocks - the owner's failed turns (must pass) and the controls (must
// not regress) - rather than one table.
//
// Two modes, both through the exact same runner and scorer
// (conversationRunner.ts, conversationScore.ts - one definition, never
// a second harness):
//
//   bun run backend/scripts/bench/replay.ts                     scripted (default), old path
//   bun run backend/scripts/bench/replay.ts --live               a side engine, a spare port
//   bun run backend/scripts/bench/replay.ts --hub-live           U2d's own acceptance run only
//   bun run backend/scripts/bench/replay.ts --hub-live --new     ...on the new path (turn.pipeline.next)
//   bun run backend/scripts/bench/replay.ts --hub-live --keep-data   ...and keep the isolated data dir's turn traces after
//   bun run backend/scripts/bench/replay.ts --hub-live --interleaved   RERUN-PROTOCOL-01: both paths, old/new/old/new per row, the bar's five conditions as pass/fail lines
//
// Scripted mode needs no engine at all: it starts one in-process stub
// (@maipai/spec's own stubServer, the same double
// tests/conversationBench.test.ts's `withStubBench` uses) that answers
// both the chat and the embedding endpoints, so it satisfies
// setup.ts's own health probe with nothing running. The stub never
// calls a tool on its own (no scriptedToolCalls given), so only the
// pipeline's OWN deterministic decisions - the pre-model lookup ladder,
// routing, guards - are exercised for real; a row whose fate depends on
// the live model's own tool choice cannot be measured this way. That
// is a real limitation, printed in the header, never hidden: it is not
// a substitute for the live run, only what is honest to report when no
// engine can be spared (two other sessions were already benchmarking
// on 2026-09-22, and 8788 is the household's own chat engine, never a
// bench's). `--live` needs MAIPAI_LLAMA_SERVER_URL (a side instance, a
// spare port, never 8788) and MAIPAI_EMBED_URL already set to a
// running engine, the same contract every live bench in this
// directory holds. `--hub-live` is the one exception, U2d's own
// acceptance run: it targets 127.0.0.1:8788 (defaultable, no env var
// required) under the task brief's protocol (liveHubQuiet.ts - a gate
// check before starting, one request at a time, a 30s quiet wait after
// any real household [turn] line), never used for an ordinary bench.
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir, loadavg } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import type { BenchConversation, TurnExpectation } from "./conversationFixture";
import { HONESTY_LINES } from "./conversationFixture";
import type { TurnScore, TurnObserved } from "./conversationScore";
import type { RecordingProxy } from "./recordingProxy";

export interface ReplayFixture {
  failed: readonly BenchConversation[];
  control: readonly BenchConversation[];
}

const CATEGORIES: ReadonlySet<BenchConversation["category"]> = new Set(["memory", "correction", "knowledge", "tools", "etiquette", "safety", "privacy", "honesty"]);

// Keep the retired stuck-reply phrases forbidden in replay output so
// removing the old guard cannot accidentally reintroduce them elsewhere.
const STUCK_LINES = "keep landing on the same answer|going in circles|stuck on that one";
/** The plan's own pass-bar clause, shared by every row: "no stuck or
 * honesty line" (point 4). Merged into every turn's mustNotContain by
 * loadFixture() below so the JSON never repeats it, and so a turn with
 * no other expectation still gets one real, scored check instead of
 * reading as a free-text row (TurnScore.pass stays null with zero
 * checks - conversationScore.ts's own convention for a humanVerdict
 * row, not what an unscored replay turn should look like). */
const UNIVERSAL_MUST_NOT_CONTAIN = `${STUCK_LINES}|${HONESTY_LINES}`;

function validateExpect(expect: unknown, where: string): asserts expect is TurnExpectation {
  if (typeof expect !== "object" || expect === null) throw new Error(`${where}: turn.expect must be an object`);
}

function mergeUniversalCheck(expect: TurnExpectation): TurnExpectation {
  return { ...expect, mustNotContain: expect.mustNotContain ? `${expect.mustNotContain}|${UNIVERSAL_MUST_NOT_CONTAIN}` : UNIVERSAL_MUST_NOT_CONTAIN };
}

function validateConversation(raw: unknown, where: string): BenchConversation {
  if (typeof raw !== "object" || raw === null) throw new Error(`${where}: not an object`);
  const c = raw as Record<string, unknown>;
  if (typeof c.id !== "string" || c.id.length === 0) throw new Error(`${where}: missing string id`);
  if (typeof c.category !== "string" || !CATEGORIES.has(c.category as BenchConversation["category"])) throw new Error(`${where} (${c.id}): category "${String(c.category)}" is not one of ${[...CATEGORIES].join(", ")}`);
  if (!Array.isArray(c.turns) || c.turns.length === 0) throw new Error(`${where} (${c.id}): needs at least one turn`);
  const turns = (c.turns as unknown[]).map((turn, i) => {
    if (typeof turn !== "object" || turn === null || typeof (turn as Record<string, unknown>).say !== "string") {
      throw new Error(`${where} (${c.id}) turn ${i}: missing string "say"`);
    }
    const t = turn as Record<string, unknown>;
    validateExpect(t.expect, `${where} (${c.id}) turn ${i}`);
    return { ...t, expect: mergeUniversalCheck(t.expect) };
  });
  return { ...c, turns } as unknown as BenchConversation;
}

/** Loads and validates owner-replay.json. Pure (no engine, no
 * filesystem writes) so a test can call it directly, the same way
 * conversationScore.ts's scoring is proven offline. */
export function loadFixture(path: string = join(import.meta.dir, "datasets", "owner-replay.json")): ReplayFixture {
  const raw = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
  const failedRaw = raw.failed;
  const controlRaw = raw.control;
  if (!Array.isArray(failedRaw) || !Array.isArray(controlRaw)) throw new Error(`${path}: needs top-level "failed" and "control" arrays`);
  const failed = failedRaw.map((c, i) => validateConversation(c, `${path} failed[${i}]`));
  const control = controlRaw.map((c, i) => validateConversation(c, `${path} control[${i}]`));
  const ids = [...failed, ...control].map((c) => c.id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length > 0) throw new Error(`${path}: duplicate row ids: ${[...new Set(dupes)].join(", ")}`);
  return { failed, control };
}

const REPEATS = 3;
const LIVE = process.argv.includes("--live");
// U2d's own acceptance run only: the household's real, already-running
// engine at 127.0.0.1:8788, under the task brief's protocol (one
// request at a time - this script is inherently sequential - a gate
// check before starting, and a 30s quiet wait after any real household
// [turn] line), never the bare --live mode above, which stays pointed
// at a side instance on a spare port per this file's own header.
const HUB_LIVE = process.argv.includes("--hub-live");
// U2's own acceptance ("the replay set on the new path with the flag
// on"): flips the real household setting turn.pipeline.next, the same
// one conversationRunner.ts's driveTurn() already reads, rather than a
// bench-only branch - a replay run is either the old path's turn or
// the new path's turn, exactly as a real household turn would be.
const NEW_PATH = process.argv.includes("--new");
// U6 rerun (dev.md 2026-09-23, "the flip did not hold"): the bench's
// own isolated MAIPAI_DATA_DIR is a mkdtempSync temp dir, deleted once
// the run finishes - a real row failure that needs the turn's own
// stats.nodes[] trace to diagnose (an engine-classed miss whose own
// check also failed, the president-of-france-repeat case) had nothing
// left to read by the time anyone looked. `--keep-data` skips that
// deletion and prints the kept directory's path instead, so the next
// rerun that hits a case worth tracing doesn't lose it.
const KEEP_DATA = process.argv.includes("--keep-data");

interface RowVerdict {
  id: string;
  category: "failed" | "control";
  passRepeats: number;
  /** ENGINE-CONTRACT-01 (dev.md 2026-09-23): repeats whose only bad
   * checks are on a turn the engine itself never honoured
   * (`requiredHonored === false` on a `tool_choice: "required"` call) -
   * counted, but excluded from `passRepeats`/the grounding pass bar,
   * because the row measures whether the grounding check passes the
   * searches the model does make, not whether the engine makes one. */
  engineRepeats: number;
  /** How many of this row's own repeats made at least one
   * `tool_choice: "required"` call at all (`observed.requiredHonored`
   * is `true` or `false`, never `null`, on some turn) - the real
   * denominator for "engine miss share," never `repeats` itself (most
   * rows, and most turns within a forced row, never force a call). */
  forcedRepeats: number;
  failures: string[];
}

/** Groups per-turn scores (one run's worth, already repeated REPEATS
 * times) back into one verdict per fixture row: a row counts as
 * passing a repeat only when every one of its turns passed that
 * repeat (the plan's own bar, "on all three repeats"). */
export function summarizeRepeats(rows: readonly { id: string; category: "failed" | "control" }[], scoresByConversationId: ReadonlyMap<string, readonly { pass: boolean | null; turnIndex: number; checks: readonly { name: string; pass: boolean; detail: string }[]; observed: { requiredHonored?: boolean | null } }[]>, repeats: number): RowVerdict[] {
  return rows.map((row) => {
    let passRepeats = 0;
    let engineRepeats = 0;
    let forcedRepeats = 0;
    const failures: string[] = [];
    for (let r = 1; r <= repeats; r++) {
      const scores = scoresByConversationId.get(`${row.id}#${r}`) ?? [];
      if (scores.some((s) => s.observed.requiredHonored === true || s.observed.requiredHonored === false)) forcedRepeats++;
      const bad = scores.filter((s) => s.pass === false);
      if (bad.length === 0 && scores.length > 0) {
        passRepeats++;
      } else if (scores.length === 0) {
        // The conversation threw (a seed or a conversation-create
        // failure) - already logged to stderr where it was caught, but
        // a silent zero-score repeat read as a mysterious non-pass
        // without this line naming why.
        failures.push(`repeat ${r}: no scores (the conversation run threw - see the console log above)`);
      } else if (bad.every((b) => b.observed.requiredHonored === false)) {
        engineRepeats++;
        failures.push(`repeat ${r}: engine (ENGINE-CONTRACT-01) - tool_choice required not honoured on turn(s) ${bad.map((b) => b.turnIndex + 1).join(", ")}`);
      } else {
        for (const b of bad) failures.push(`repeat ${r} turn ${b.turnIndex + 1}: ${b.checks.filter((c) => !c.pass).map((c) => `${c.name} (${c.detail})`).join("; ")}`);
      }
    }
    return { id: row.id, category: row.category, passRepeats, engineRepeats, forcedRepeats, failures };
  });
}

// RERUN-PROTOCOL-01 (dev.md "U6 rerun ruling" (c)): Fable's own
// acceptance protocol, built into the bench as its own mode rather than
// a manual procedure someone has to remember. `--interleaved` (with
// `--hub-live`) runs old, new, old, new - the same row, before moving
// to the next - so load cancels between the two paths instead of
// biasing whichever happened to run in the machine's own quieter half.
const INTERLEAVED = process.argv.includes("--interleaved");

export interface InterleavedStep {
  path: "old" | "new";
  row: { id: string; category: "failed" | "control"; conv: BenchConversation };
  repeat: number;
}

/** Pure (no engine, no filesystem) so a test drives it directly against
 * a small synthetic row list rather than a live run. */
export function interleavedPlan(rows: readonly { id: string; category: "failed" | "control"; conv: BenchConversation }[], repeats: number): InterleavedStep[] {
  const steps: InterleavedStep[] = [];
  for (const row of rows) {
    for (let repeat = 1; repeat <= repeats; repeat++) {
      steps.push({ path: "old", row, repeat });
      steps.push({ path: "new", row, repeat });
    }
  }
  return steps;
}

/** A best-effort, diagnostic-only line - never part of any scored
 * condition, never thrown over. `who` is POSIX (both macOS and Linux
 * carry it); a machine without it, or without a shell at all, gets
 * "unknown" instead of a crashed run. */
function systemLoadLine(): string {
  const load = loadavg().map((n) => n.toFixed(2)).join(", ");
  let users = "unknown";
  try {
    const out = execSync("who", { encoding: "utf-8", timeout: 2000 });
    users = String(out.split("\n").filter((l) => l.trim().length > 0).length);
  } catch {
    // No `who`, no shell, or it timed out - diagnostic only.
  }
  return `load average ${load}; ${users} logged-in user line(s)`;
}

/** RERUN-PROTOCOL-01 (c).1: "stats.nodes[] printed per turn: context,
 * each model generation with its thinking flag, prompt tokens, cached
 * tokens and wall time, the tool call with the package and its wall
 * time, answer." `generationTrace` is turn-scoped, not node-scoped (a
 * retry or a second round can add a generation without a second
 * `model` node entry, or vice versa), so it prints once per turn,
 * after every node's own line, rather than nested under one model
 * entry it might not line up with. */
function renderNodeTrace(observed: TurnObserved): string[] {
  const lines: string[] = [];
  for (const n of observed.nodeTrace ?? []) {
    const wallMs = n.endMs - n.startMs;
    const label = n.node === "tool" ? `tool (${observed.pluginId ?? "?"})` : n.node;
    lines.push(`       ${label}: ${wallMs}ms`);
  }
  for (const g of observed.generationTrace ?? []) {
    lines.push(`       generation "${g.reason}": thinking=${g.thinking} prompt_n=${g.prompt_n ?? "?"} cache_n=${g.cache_n ?? "?"} prompt_ms=${g.prompt_ms ?? "?"} predicted_n=${g.predicted_n ?? "?"} predicted_ms=${g.predicted_ms ?? "?"}`);
  }
  return lines;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : (sorted[mid] ?? 0);
}

export interface BarCondition {
  label: string;
  pass: boolean;
  detail: string;
}

// The bar's own named rows (dev.md "U6 rerun ruling" (d)): the five
// failed rows already clean before this protocol exists to prove
// (primetime-trailer-correction and the two chile rows stay out - real
// parity gaps, SIGNAL-01/CONFIRM-01's own scope, not this bar's), and
// the three controls regression B found. Named here, not derived from
// the fixture's own failed/control split, because that split is wider
// than the bar (8 failed rows, 13 controls) and the bar is explicit
// about which of each it means.
const BAR_CLEAN_FAILED_ROW_IDS = ["president-of-france-repeat", "apple-announce-this-week", "search-mariners-game", "chatgpt-6-luna", "corey-feldman-michael-jackson-friendship"];
const BAR_CONTROL_ROW_IDS = ["control-search-mariners-explicit", "control-negative-spiderman", "control-negative-feeling-down"];

/** The exact structural slice this function reads - never the full
 * TurnScore/TurnObserved (40-odd required fields) - the same narrowing
 * summarizeRepeats() above already uses, so a test builds a synthetic
 * row with `observed: { totalMs: 100, reply: "hi" }` instead of a full
 * fixture object. */
export interface BarScore {
  pass: boolean | null;
  turnIndex: number;
  checks: readonly { name: string; pass: boolean; detail: string }[];
  observed: { requiredHonored?: boolean | null; totalMs: number; reply: string; generationTrace?: readonly { cache_n: number | null | undefined; predicted_n?: number | null; predicted_ms?: number | null }[] | null };
}

/** RERUN-PROTOCOL-01: the five conditions dev.md "U6 rerun ruling" (d)
 * names as what flips U6, each read straight off the interleaved run's
 * own scores - never re-derived by hand from a printed table again.
 * Pure, so a test drives it with synthetic rows the same way
 * summarizeRepeats() already is. */
export function computeBarSummary(oldScores: ReadonlyMap<string, readonly BarScore[]>, newScores: ReadonlyMap<string, readonly BarScore[]>, rows: readonly { id: string; category: "failed" | "control" }[], repeats: number): BarCondition[] {
  const conditions: BarCondition[] = [];
  const isForced = (s: BarScore) => s.observed.requiredHonored === true || s.observed.requiredHonored === false;

  const namedFailedRows = rows.filter((r) => BAR_CLEAN_FAILED_ROW_IDS.includes(r.id));
  const failedVerdicts = summarizeRepeats(namedFailedRows, newScores, repeats);
  const failedClean = failedVerdicts.every((v) => v.passRepeats === repeats);
  const noEngineRow = failedVerdicts.every((v) => v.engineRepeats === 0);
  const noEmptyReply = namedFailedRows.every((row) => {
    for (let r = 1; r <= repeats; r++) {
      if ((newScores.get(`${row.id}#${r}`) ?? []).some((s) => s.observed.reply.trim().length === 0)) return false;
    }
    return true;
  });
  conditions.push({
    label: "the five named failed rows stay clean, no engine-classed row, no empty reply",
    pass: failedClean && noEngineRow && noEmptyReply,
    detail: failedVerdicts.map((v) => `${v.id}: ${v.passRepeats}/${repeats} clean, ${v.engineRepeats} engine`).join("; "),
  });

  const namedControlRows = rows.filter((r) => BAR_CONTROL_ROW_IDS.includes(r.id));
  const controlVerdicts = summarizeRepeats(namedControlRows, newScores, repeats);
  const controlsClean = controlVerdicts.every((v) => v.passRepeats === repeats);
  conditions.push({
    label: "the three named controls are 3/3 clean",
    pass: controlsClean,
    detail: controlVerdicts.map((v) => `${v.id}: ${v.passRepeats}/${repeats}`).join("; "),
  });

  // U6: the flip, decided (dev.md) - the old-path-ratio condition is
  // retired, the same way PHRASE-01's own "within 2s of the old path"
  // bar was: it compared the new path's wall clock against a shortcut
  // the design deletes and a shorter reply the reply floor forbids, so
  // a miss against it never proved a defect. In its place: a longer
  // reply is not a regression, an idle gap inside a generation is - so
  // this measures each generation's OWN decode rate (predicted_n over
  // predicted_ms) against the engine's own rate this run, never one
  // path's total against the other's. The reference rate is this run's
  // own median generation rate (new path only, self-referential - no
  // hardcoded hardware assumption, the same "the configuration is
  // proposed, never fixed" posture the hardware-tiers record uses
  // elsewhere); the allowance (1.5x the expected decode time, or 500ms
  // over it, whichever is looser) is a deliberately generous floor
  // meant to catch a genuine multi-hundred-ms-or-worse stall, not
  // ordinary measurement noise between generations.
  const rates: number[] = [];
  for (const row of rows) {
    for (let r = 1; r <= repeats; r++) {
      for (const s of newScores.get(`${row.id}#${r}`) ?? []) {
        for (const g of s.observed.generationTrace ?? []) {
          if (typeof g.predicted_n === "number" && g.predicted_n > 0 && typeof g.predicted_ms === "number" && g.predicted_ms > 0) {
            rates.push(g.predicted_n / (g.predicted_ms / 1000));
          }
        }
      }
    }
  }
  const referenceRate = median(rates);
  let worstIdleGap: { row: string; repeat: number; excessMs: number; predictedMs: number; expectedMs: number } | null = null;
  let idleGapCount = 0;
  let generationCount = 0;
  if (referenceRate > 0) {
    for (const row of rows) {
      for (let r = 1; r <= repeats; r++) {
        for (const s of newScores.get(`${row.id}#${r}`) ?? []) {
          for (const g of s.observed.generationTrace ?? []) {
            if (typeof g.predicted_n !== "number" || g.predicted_n <= 0 || typeof g.predicted_ms !== "number" || g.predicted_ms <= 0) continue;
            generationCount++;
            const expectedMs = (g.predicted_n / referenceRate) * 1000;
            const allowedMs = Math.max(expectedMs * 1.5, expectedMs + 500);
            if (g.predicted_ms > allowedMs) {
              idleGapCount++;
              const excessMs = g.predicted_ms - expectedMs;
              if (!worstIdleGap || excessMs > worstIdleGap.excessMs) worstIdleGap = { row: row.id, repeat: r, excessMs, predictedMs: g.predicted_ms, expectedMs };
            }
          }
        }
      }
    }
  }
  conditions.push({
    label: "no generation's decode time exceeds the engine's own token rate for its length",
    pass: generationCount === 0 || idleGapCount === 0,
    detail:
      generationCount === 0
        ? "no timed generations this run"
        : `${generationCount - idleGapCount}/${generationCount} generations at rate, reference ${referenceRate.toFixed(1)} tok/s${worstIdleGap ? `; worst: ${worstIdleGap.row}#${worstIdleGap.repeat} predicted_ms=${worstIdleGap.predictedMs.toFixed(0)} expected_ms=${worstIdleGap.expectedMs.toFixed(0)} (${idleGapCount} over the allowance)` : ""}`,
  });

  const forcedTotals: number[] = [];
  for (const row of rows) {
    for (let r = 1; r <= repeats; r++) {
      for (const s of (newScores.get(`${row.id}#${r}`) ?? []).filter(isForced)) forcedTotals.push(s.observed.totalMs);
    }
  }
  const forcedMedian = median(forcedTotals);
  conditions.push({
    label: "every forced-search turn's total is under 10s median",
    pass: forcedTotals.length === 0 || forcedMedian < 10_000,
    detail: forcedTotals.length === 0 ? "no forced-search turns this run" : `median ${forcedMedian.toFixed(0)}ms across ${forcedTotals.length} forced turns`,
  });

  let multiTurnRows = 0;
  const cacheFailures: string[] = [];
  for (const row of rows) {
    for (let r = 1; r <= repeats; r++) {
      const newTurns = newScores.get(`${row.id}#${r}`) ?? [];
      if (newTurns.length < 2) continue;
      multiTurnRows++;
      let prevCache = -Infinity;
      for (const t of newTurns) {
        const cache = t.observed.generationTrace?.[0]?.cache_n;
        if (cache === undefined || cache === null) {
          // U6: the flip, decided (dev.md) - a turn with no cache_n
          // reading (a forced call's own interim_rule generation, when
          // the engine never reported one) is a gap in what was
          // measured, not evidence the prefix was evicted. The
          // checker used to bridge straight over it, comparing the
          // NEXT valid reading against the LAST one before the gap
          // (control-ten-turn-spoken-drift#1's own false failure,
          // turn 3 read against turn 1's cache_n across turn 2's own
          // missing one) - a scorer defect, not the mechanism PHRASE-02
          // fixes. Resetting the floor here instead means the next
          // valid reading is compared against nothing, always passes,
          // and becomes the new floor going forward - "compares
          // against the last turn that HAD a cache_n value," which
          // after a gap is no turn at all.
          prevCache = -Infinity;
          continue;
        }
        if (cache < prevCache) {
          cacheFailures.push(`${row.id}#${r}`);
          break;
        }
        prevCache = cache;
      }
    }
  }
  conditions.push({
    label: "cached_tokens rises across every multi-turn row",
    pass: multiTurnRows === 0 || cacheFailures.length === 0,
    detail: multiTurnRows === 0 ? "no multi-turn rows in this fixture" : `${multiTurnRows - cacheFailures.length}/${multiTurnRows} rows rising${cacheFailures.length > 0 ? `; failed: ${cacheFailures.join(", ")}` : ""}`,
  });

  return conditions;
}

/** The `--hub-live`/`--live`/scripted upstream selection every mode
 * shares - factored out so `runInterleaved()` doesn't duplicate it. */
async function resolveUpstream(): Promise<{ stub: { url: string; stop: () => void } | null; proxy: RecordingProxy | null }> {
  let stub: { url: string; stop: () => void } | null = null;
  let proxy: RecordingProxy | null = null;
  if (HUB_LIVE) {
    const upstream = process.env.MAIPAI_LLAMA_SERVER_URL ?? "http://127.0.0.1:8788";
    if (!process.env.MAIPAI_EMBED_URL) process.env.MAIPAI_EMBED_URL = "http://127.0.0.1:8794";
    const { startRecordingProxy } = await import("./recordingProxy");
    proxy = startRecordingProxy(upstream);
    process.env.MAIPAI_LLAMA_SERVER_URL = proxy.url;
  } else if (LIVE) {
    const upstream = process.env.MAIPAI_LLAMA_SERVER_URL;
    if (!upstream) {
      console.error("replay --live refused: MAIPAI_LLAMA_SERVER_URL is not set; the live run connects only to an engine already running, on a spare port, never 8788's.");
      process.exit(2);
    }
    if (!process.env.MAIPAI_EMBED_URL) {
      console.error("replay --live refused: MAIPAI_EMBED_URL is not set.");
      process.exit(2);
    }
    const { startRecordingProxy } = await import("./recordingProxy");
    proxy = startRecordingProxy(upstream);
    process.env.MAIPAI_LLAMA_SERVER_URL = proxy.url;
  } else {
    const { startStubLlmServer } = await import("@maipai/spec/llm/ts/stubServer.js");
    stub = startStubLlmServer(0);
    process.env.MAIPAI_LLAMA_SERVER_URL = stub.url;
    if (!process.env.MAIPAI_EMBED_URL) process.env.MAIPAI_EMBED_URL = stub.url;
  }
  return { stub, proxy };
}

async function runInterleaved(): Promise<void> {
  if (HUB_LIVE) {
    const { refuseIfGateRunning } = await import("./liveHubQuiet");
    refuseIfGateRunning("replay --interleaved");
  }

  const fixture = loadFixture();
  let ownDataDir: string | null = null;
  if (!process.env.MAIPAI_DATA_DIR) {
    ownDataDir = mkdtempSync(join(tmpdir(), "owner-replay-interleaved-"));
    process.env.MAIPAI_DATA_DIR = ownDataDir;
  }

  const { stub, proxy } = await resolveUpstream();
  const setup = await import("./setup");
  const { startBench, finishBench } = setup;
  const runner = await import("./conversationRunner");
  const { setHouseholdSettingValue } = await import("@/lib/settings");

  await startBench();

  console.log("\n## Run header\n");
  console.log(
    JSON.stringify(
      {
        mode: HUB_LIVE ? "hub-live interleaved (127.0.0.1:8788, waits for household quiet)" : LIVE ? "live interleaved" : "scripted interleaved (no live model - see file header)",
        date: new Date().toISOString(),
        chat: process.env.MAIPAI_LLAMA_SERVER_URL,
        embed: process.env.MAIPAI_EMBED_URL,
        repeats: REPEATS,
        failedRows: fixture.failed.length,
        controlRows: fixture.control.length,
      },
      null,
      2,
    ),
  );

  const beforeTurn = HUB_LIVE ? (await import("./liveHubQuiet")).waitForHubQuiet.bind(null, undefined, (msg: string) => console.log(msg.replace("live-hub-quiet", "replay --interleaved"))) : undefined;

  const log = runner.captureTurnLog();
  const people = runner.createBenchPeople();
  const homeAssistant = runner.startFakeHomeAssistant();
  const searxng = runner.startFakeSearxng();
  const oldScoresByConversationId = new Map<string, TurnScore[]>();
  const newScoresByConversationId = new Map<string, TurnScore[]>();
  const rows: { id: string; category: "failed" | "control"; conv: BenchConversation }[] = [
    ...fixture.failed.map((conv) => ({ id: conv.id, category: "failed" as const, conv })),
    ...fixture.control.map((conv) => ({ id: conv.id, category: "control" as const, conv })),
  ];
  const plan = interleavedPlan(rows, REPEATS);

  try {
    for (const step of plan) {
      setHouseholdSettingValue("turn.pipeline.next", step.path === "new");
      if (step.path === "new") setHouseholdSettingValue("chat.model_id", process.env.MAIPAI_REPLAY_MODEL_ID ?? "qwen3-8b-instruct-q4-k-m");
      console.log(`\n[replay --interleaved] ${step.path} repeat ${step.repeat}/${REPEATS}: ${step.row.id}`);
      console.log(`       ${systemLoadLine()}`);
      const run = await runner
        .runConversation(step.row.conv, {
          people,
          proxy,
          log,
          drainJudge: async () => {},
          backdate: (days, turnIds) => runner.backdateBenchRows(people, days, turnIds),
          homeAssistant,
          beforeTurn,
        })
        .catch((err: Error) => {
          console.error(`[replay --interleaved] ${step.path} ${step.row.id} repeat ${step.repeat} threw: ${err.message}`);
          return { scores: [], turnIds: [] as string[] };
        });
      // Rerun 3 diagnostic (asked live, not part of the bar itself):
      // the interleaved log otherwise has no per-turn attribution for
      // a failed check or a cache_n reading - every generation and
      // node-trace line for every turn of a step printed back to back
      // with nothing naming which turn it belongs to. A "-- turn N --"
      // header makes renderNodeTrace's existing lines attributable
      // without re-deriving anything by hand; the failed-check and
      // reply-first-line lines read straight off the same TurnScore
      // the bar itself scores from.
      for (const s of run.scores) {
        console.log(`       -- turn ${s.turnIndex + 1} --`);
        for (const line of renderNodeTrace(s.observed)) console.log(line);
        const failed = s.checks.filter((c) => !c.pass);
        if (failed.length > 0) console.log(`       turn ${s.turnIndex + 1} FAILED: ${failed.map((c) => `${c.name} (${c.detail})`).join("; ")}`);
        const firstLine = (s.observed.reply ?? "").split("\n")[0]?.slice(0, 200) ?? "";
        console.log(`       turn ${s.turnIndex + 1} reply (totalMs=${s.observed.totalMs}): "${firstLine}"`);
      }
      const target = step.path === "old" ? oldScoresByConversationId : newScoresByConversationId;
      target.set(`${step.row.id}#${step.repeat}`, run.scores);
    }
  } finally {
    log.stop();
    homeAssistant.stop();
    searxng.stop();
  }

  console.log("\n## Bar summary\n");
  for (const c of computeBarSummary(oldScoresByConversationId, newScoresByConversationId, rows, REPEATS)) {
    console.log(`${c.pass ? "PASS" : "FAIL"} ${c.label}`);
    console.log(`     ${c.detail}`);
  }

  // Worst plain pair (RERUN-PROTOCOL-01 fix-up): diagnostic only, never
  // a bar condition (the ratio bar it used to feed is retired, above) -
  // named because a reader asking "which turn got slowest relative to
  // the old path" still needs an answer even though the ratio itself no
  // longer gates anything.
  const isForcedScore = (s: TurnScore) => s.observed.requiredHonored === true || s.observed.requiredHonored === false;
  let worstPlainPair: { row: string; repeat: number; turnIndex: number; oldMs: number; newMs: number; ratio: number } | null = null;
  for (const row of rows) {
    for (let r = 1; r <= REPEATS; r++) {
      const oldTurns = (oldScoresByConversationId.get(`${row.id}#${r}`) ?? []).filter((s) => !isForcedScore(s));
      const newTurns = (newScoresByConversationId.get(`${row.id}#${r}`) ?? []).filter((s) => !isForcedScore(s));
      for (let i = 0; i < Math.min(oldTurns.length, newTurns.length); i++) {
        const oldMs = oldTurns[i]!.observed.totalMs;
        const newMs = newTurns[i]!.observed.totalMs;
        if (oldMs <= 0) continue;
        const ratio = newMs / oldMs;
        if (!worstPlainPair || ratio > worstPlainPair.ratio) worstPlainPair = { row: row.id, repeat: r, turnIndex: newTurns[i]!.turnIndex + 1, oldMs, newMs, ratio };
      }
    }
  }
  if (worstPlainPair) console.log(`\nworst plain pair (diagnostic, not a bar condition): ${worstPlainPair.row}#${worstPlainPair.repeat} turn ${worstPlainPair.turnIndex} - old ${worstPlainPair.oldMs}ms, new ${worstPlainPair.newMs}ms (${worstPlainPair.ratio.toFixed(2)}x)`);

  // RERUN-PROTOCOL-01 fix-up (this session's own proposal, U6: the flip,
  // decided): the full per-conversation, per-repeat TurnScore set,
  // written beside the log every run - so a question like "what were
  // the exact old/new totals for this pair" or "what did cache_n do
  // across this row's own turns" is answered by reading this file, not
  // by re-deriving it from console text after the fact (the gap that
  // made rerun 3's own follow-up questions expensive to answer).
  const scoresOutDir = join(process.cwd(), "data-scratch");
  const scoresOutPath = join(scoresOutDir, `interleaved-scores-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  try {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(scoresOutDir, { recursive: true });
    writeFileSync(
      scoresOutPath,
      JSON.stringify({ old: Object.fromEntries(oldScoresByConversationId), new: Object.fromEntries(newScoresByConversationId) }, null, 2),
    );
    console.log(`interleaved scores written to ${scoresOutPath}`);
  } catch (err) {
    console.error(`[replay --interleaved] could not write the scores JSON: ${(err as Error).message}`);
  }

  runner.cleanupBenchPeople(people);
  if (proxy) proxy.stop();
  if (stub) stub.stop();
  // RERUN-PROTOCOL-01 (c).1: "--keep-data on for the run" - always,
  // this mode's own data dir is never deleted, unlike the single-path
  // modes above where --keep-data stays opt-in.
  if (ownDataDir) console.log(`\nturn traces kept at ${ownDataDir}`);

  finishBench({ executed: [...oldScoresByConversationId.values(), ...newScoresByConversationId.values()].flat().length, engine: HUB_LIVE ? `hub-live: ${process.env.MAIPAI_LLAMA_SERVER_URL}` : LIVE ? `live: ${process.env.MAIPAI_LLAMA_SERVER_URL}` : "scripted (stub, no live model)" });
}

if (import.meta.main) {
  await (INTERLEAVED ? runInterleaved() : runMain());
}

async function runMain(): Promise<void> {
  if (HUB_LIVE) {
    const { refuseIfGateRunning } = await import("./liveHubQuiet");
    refuseIfGateRunning("replay --hub-live");
  }

  const fixture = loadFixture();

  let ownDataDir: string | null = null;
  if (!process.env.MAIPAI_DATA_DIR) {
    ownDataDir = mkdtempSync(join(tmpdir(), "owner-replay-"));
    process.env.MAIPAI_DATA_DIR = ownDataDir;
  }

  const { stub, proxy } = await resolveUpstream();

  const setup = await import("./setup");
  const { startBench, finishBench } = setup;
  const runner = await import("./conversationRunner");
  const score = await import("./conversationScore");

  await startBench();

  if (NEW_PATH) {
    const { setHouseholdSettingValue } = await import("@/lib/settings");
    setHouseholdSettingValue("turn.pipeline.next", true);
    // A live run caught this missing entirely: resolveTurnBudget()
    // (turnMachine/budget.ts) reads the household's own chat.model_id
    // setting to find the model's measured turn_budget record in
    // modelCatalog.ts - with nothing set here, every --new run resolved
    // to NO_RECORD_BUDGET (rounds 0, tools_offered [], model_transitions
    // false), so the model was NEVER offered a single tool, on any row,
    // the whole time - not a turn-machine bug, a bench setup gap
    // (interimRuleMeasure.ts already set this correctly; replay.ts
    // never did). MAIPAI_REPLAY_MODEL_ID lets U2d's own second-model
    // acceptance run point this at a different catalog entry.
    setHouseholdSettingValue("chat.model_id", process.env.MAIPAI_REPLAY_MODEL_ID ?? "qwen3-8b-instruct-q4-k-m");
  }

  console.log("\n## Run header\n");
  console.log(
    JSON.stringify(
      {
        mode: HUB_LIVE ? "hub-live (127.0.0.1:8788, waits for household quiet)" : LIVE ? "live" : "scripted (no live model - see file header)",
        path: NEW_PATH ? "new (turn.pipeline.next)" : "old (turnEngine.ts)",
        date: new Date().toISOString(),
        chat: process.env.MAIPAI_LLAMA_SERVER_URL,
        embed: process.env.MAIPAI_EMBED_URL,
        repeats: REPEATS,
        failedRows: fixture.failed.length,
        controlRows: fixture.control.length,
      },
      null,
      2,
    ),
  );
  console.log("");

  const beforeTurn = HUB_LIVE ? (await import("./liveHubQuiet")).waitForHubQuiet.bind(null, undefined, (msg: string) => console.log(msg.replace("live-hub-quiet", "replay --hub-live"))) : undefined;

  const log = runner.captureTurnLog();
  const people = runner.createBenchPeople();
  const homeAssistant = runner.startFakeHomeAssistant();
  const searxng = runner.startFakeSearxng();
  const scoresByConversationId = new Map<string, TurnScore[]>();
  const allScores: TurnScore[] = [];
  const rows: { id: string; category: "failed" | "control"; conv: BenchConversation }[] = [
    ...fixture.failed.map((conv) => ({ id: conv.id, category: "failed" as const, conv })),
    ...fixture.control.map((conv) => ({ id: conv.id, category: "control" as const, conv })),
  ];

  try {
    for (let repeat = 1; repeat <= REPEATS; repeat++) {
      for (const row of rows) {
        console.log(`[replay] repeat ${repeat}/${REPEATS}: ${row.id}`);
        const run = await runner
          .runConversation(row.conv, {
            people,
            proxy,
            log,
            drainJudge: async () => {},
            backdate: (days, turnIds) => runner.backdateBenchRows(people, days, turnIds),
            homeAssistant,
            beforeTurn,
          })
          .catch((err: Error) => {
            console.error(`[replay] ${row.id} repeat ${repeat} threw: ${err.message}`);
            return { scores: [], turnIds: [] as string[] };
          });
        scoresByConversationId.set(`${row.id}#${repeat}`, run.scores);
        allScores.push(...run.scores);
      }
    }
  } finally {
    log.stop();
    homeAssistant.stop();
    searxng.stop();
  }

  let totalEngineRepeats = 0;
  let totalForcedRepeats = 0;
  for (const label of ["failed", "control"] as const) {
    const labelRows = rows.filter((r) => r.category === label);
    const verdicts = summarizeRepeats(labelRows, scoresByConversationId, REPEATS);
    console.log(`\n## ${label === "failed" ? "Failed rows (must pass)" : "Control rows (must not regress)"}\n`);
    for (const v of verdicts) {
      // ENGINE-CONTRACT-01: a row clean on the grounding bar is
      // passRepeats + engineRepeats === REPEATS (no REAL grounding
      // failure), reported separately from a row with zero engine
      // misses at all.
      const groundingClean = v.passRepeats + v.engineRepeats === REPEATS;
      const label2 = groundingClean && v.engineRepeats === 0 ? "ok  " : groundingClean ? "ok* " : "FAIL";
      console.log(`${label2} ${v.id} (${v.passRepeats}/${REPEATS} clean, ${v.engineRepeats}/${REPEATS} engine misses)`);
      for (const f of v.failures.slice(0, REPEATS)) console.log(`       ${f}`);
      totalEngineRepeats += v.engineRepeats;
      totalForcedRepeats += v.forcedRepeats;
    }
    const cleanRows = verdicts.filter((v) => v.passRepeats + v.engineRepeats === REPEATS).length;
    const trueCleanRows = verdicts.filter((v) => v.passRepeats === REPEATS).length;
    console.log(`\n${cleanRows}/${verdicts.length} ${label} rows clean on every repeat's grounding bar (${trueCleanRows}/${verdicts.length} with zero engine misses); ok* marks a row with at least one engine miss`);
  }
  if (totalForcedRepeats > 0) {
    console.log(`\n## ENGINE-CONTRACT-01 miss share\n`);
    console.log(`${totalEngineRepeats}/${totalForcedRepeats} repeats classified engine (tool_choice required not honoured)`);
  }

  console.log("\n## Full table\n");
  console.log(score.renderTable(allScores));

  runner.cleanupBenchPeople(people);
  if (proxy) proxy.stop();
  if (stub) stub.stop();
  if (ownDataDir && !KEEP_DATA) rmSync(ownDataDir, { recursive: true, force: true });
  if (ownDataDir && KEEP_DATA) console.log(`\n--keep-data: turn traces kept at ${ownDataDir}`);

  finishBench({ executed: allScores.length, engine: HUB_LIVE ? `hub-live: ${process.env.MAIPAI_LLAMA_SERVER_URL}` : LIVE ? `live: ${process.env.MAIPAI_LLAMA_SERVER_URL}` : "scripted (stub, no live model)" });
}
