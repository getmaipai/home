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
//   bun run backend/scripts/bench/replay.ts          scripted (default)
//   bun run backend/scripts/bench/replay.ts --live    a real engine
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
// directory holds.
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BenchConversation, TurnExpectation } from "./conversationFixture";
import { HONESTY_LINES } from "./conversationFixture";
import type { TurnScore } from "./conversationScore";
import type { RecordingProxy } from "./recordingProxy";

export interface ReplayFixture {
  failed: readonly BenchConversation[];
  control: readonly BenchConversation[];
}

const CATEGORIES: ReadonlySet<BenchConversation["category"]> = new Set(["memory", "correction", "knowledge", "tools", "etiquette", "safety", "privacy", "honesty"]);

// guards.ts's CHAT_LOOP (module-private): the three stuck-reply lines
// the repeat guard falls back to (REPLY-FIND-01's own bug: the right
// answer to a repeated question, thrown away for this). Named here by
// their distinguishing fragments rather than importing a private
// constant.
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

interface RowVerdict {
  id: string;
  category: "failed" | "control";
  passRepeats: number;
  failures: string[];
}

/** Groups per-turn scores (one run's worth, already repeated REPEATS
 * times) back into one verdict per fixture row: a row counts as
 * passing a repeat only when every one of its turns passed that
 * repeat (the plan's own bar, "on all three repeats"). */
export function summarizeRepeats(rows: readonly { id: string; category: "failed" | "control" }[], scoresByConversationId: ReadonlyMap<string, readonly { pass: boolean | null; turnIndex: number; checks: readonly { name: string; pass: boolean; detail: string }[] }[]>, repeats: number): RowVerdict[] {
  return rows.map((row) => {
    let passRepeats = 0;
    const failures: string[] = [];
    for (let r = 1; r <= repeats; r++) {
      const scores = scoresByConversationId.get(`${row.id}#${r}`) ?? [];
      const bad = scores.filter((s) => s.pass === false);
      if (bad.length === 0 && scores.length > 0) {
        passRepeats++;
      } else if (scores.length === 0) {
        // The conversation threw (a seed or a conversation-create
        // failure) - already logged to stderr where it was caught, but
        // a silent zero-score repeat read as a mysterious non-pass
        // without this line naming why.
        failures.push(`repeat ${r}: no scores (the conversation run threw - see the console log above)`);
      } else {
        for (const b of bad) failures.push(`repeat ${r} turn ${b.turnIndex + 1}: ${b.checks.filter((c) => !c.pass).map((c) => `${c.name} (${c.detail})`).join("; ")}`);
      }
    }
    return { id: row.id, category: row.category, passRepeats, failures };
  });
}

if (import.meta.main) {
  await runMain();
}

async function runMain(): Promise<void> {
  const fixture = loadFixture();

  let ownDataDir: string | null = null;
  if (!process.env.MAIPAI_DATA_DIR) {
    ownDataDir = mkdtempSync(join(tmpdir(), "owner-replay-"));
    process.env.MAIPAI_DATA_DIR = ownDataDir;
  }

  let stub: { url: string; stop: () => void } | null = null;
  let proxy: RecordingProxy | null = null;
  if (LIVE) {
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

  const setup = await import("./setup");
  const { startBench, finishBench } = setup;
  const runner = await import("./conversationRunner");
  const score = await import("./conversationScore");

  await startBench();

  console.log("\n## Run header\n");
  console.log(
    JSON.stringify(
      {
        mode: LIVE ? "live" : "scripted (no live model - see file header)",
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

  for (const label of ["failed", "control"] as const) {
    const labelRows = rows.filter((r) => r.category === label);
    const verdicts = summarizeRepeats(labelRows, scoresByConversationId, REPEATS);
    console.log(`\n## ${label === "failed" ? "Failed rows (must pass)" : "Control rows (must not regress)"}\n`);
    for (const v of verdicts) {
      console.log(`${v.passRepeats === REPEATS ? "ok  " : "FAIL"} ${v.id} (${v.passRepeats}/${REPEATS} repeats clean)`);
      for (const f of v.failures.slice(0, REPEATS)) console.log(`       ${f}`);
    }
    const cleanRows = verdicts.filter((v) => v.passRepeats === REPEATS).length;
    console.log(`\n${cleanRows}/${verdicts.length} ${label} rows clean on every repeat`);
  }

  console.log("\n## Full table\n");
  console.log(score.renderTable(allScores));

  runner.cleanupBenchPeople(people);
  if (proxy) proxy.stop();
  if (stub) stub.stop();
  if (ownDataDir) rmSync(ownDataDir, { recursive: true, force: true });

  finishBench({ executed: allScores.length, engine: LIVE ? `live: ${process.env.MAIPAI_LLAMA_SERVER_URL}` : "scripted (stub, no live model)" });
}
