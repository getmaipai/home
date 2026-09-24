// U4/RESP-01 (docs/plans/turn-machine-state-record-2026-09-22.md;
// BACKLOG.md's U4 row: "Tests: the written-set bench, the seeded voice
// set"): twenty typed questions on the written register - a fact, a
// how-to, a comparison, a list, and small talk - run on the new path
// (turn.pipeline.next) at surface "chat", judged for completeness by a
// reader rather than a deterministic check (`humanVerdict: true`,
// conversationScore.ts's own convention for a row no regex can grade:
// "complete for a typed reader, structured where it helps, not padded"
// is a human judgment, the same reason the coherence review's own rows
// use it). Mirrors replay.ts's own runner/scorer/dual-mode shape
// exactly - conversationRunner.ts, conversationScore.ts, one definition,
// never a second harness.
//
//   bun run backend/scripts/bench/written-set.ts            scripted (no live model)
//   bun run backend/scripts/bench/written-set.ts --live      a side engine, a spare port
//
// Scripted mode proves the bench runs the right rows through the right
// path and prints a real table; it cannot judge completeness (the stub
// never writes a real answer), so every row's `humanVerdict` line reads
// "printed, not machine-scored" there - the same honest limitation
// replay.ts's own header states for its scripted mode. `--live` is
// where a reader actually judges the twenty replies against the ChatGPT
// bar this item's acceptance names.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BenchConversation } from "./conversationFixture";
import type { RecordingProxy } from "./recordingProxy";
import type { TurnScore } from "./conversationScore";

const LIVE = process.argv.includes("--live");

// A spread across the five kinds RESP-01 names, five questions each -
// self-contained (never a household or world fact this bench would
// need to seed), so `toolRan: null` and `humanVerdict: true` apply to
// every row uniformly. WRITTEN-PARITY-01 adds two more past the
// spread, the interim rule's own row pair (below) - one still
// self-contained, one that needs `startFakeSearxng()`'s own fixture
// and carries a real scored check (`groundedNames`) alongside
// `humanVerdict`, not `toolRan: null` uniformly any more.
const WRITTEN_QUESTIONS: readonly { id: string; kind: "fact" | "how-to" | "comparison" | "list" | "small-talk"; say: string; groundedNames?: boolean }[] = [
  { id: "written-fact-1", kind: "fact", say: "what's the boiling point of water in fahrenheit" },
  { id: "written-fact-2", kind: "fact", say: "how many bones are in the human hand" },
  { id: "written-fact-3", kind: "fact", say: "what's the capital of australia" },
  { id: "written-fact-4", kind: "fact", say: "how far is the moon from earth" },
  { id: "written-fact-5", kind: "fact", say: "what year did the berlin wall come down" },
  { id: "written-howto-1", kind: "how-to", say: "how do I make a paper airplane" },
  { id: "written-howto-2", kind: "how-to", say: "how do I get a red wine stain out of a carpet" },
  { id: "written-howto-3", kind: "how-to", say: "how do I tie a bow tie" },
  { id: "written-howto-4", kind: "how-to", say: "how do I jump-start a car battery" },
  { id: "written-howto-5", kind: "how-to", say: "how do I fold a fitted sheet" },
  { id: "written-comparison-1", kind: "comparison", say: "what's the difference between a crocodile and an alligator" },
  { id: "written-comparison-2", kind: "comparison", say: "what's the difference between baking soda and baking powder" },
  { id: "written-comparison-3", kind: "comparison", say: "what's the difference between a hurricane and a typhoon" },
  { id: "written-comparison-4", kind: "comparison", say: "what's the difference between a virus and a bacteria" },
  { id: "written-comparison-5", kind: "comparison", say: "what's the difference between rent and lease" },
  { id: "written-list-1", kind: "list", say: "what are some good beginner houseplants" },
  { id: "written-list-2", kind: "list", say: "what should I pack for a weekend camping trip" },
  { id: "written-list-3", kind: "list", say: "what are the primary colors" },
  { id: "written-small-talk-1", kind: "small-talk", say: "hi" },
  { id: "written-small-talk-2", kind: "small-talk", say: "how's it going" },
  // WRITTEN-PARITY-01's own row pair for the interim rule's trigger
  // (dev.md "The interim rule's trigger, decided"): the benchmarking
  // question is OPENER-01's own replay row's exact words
  // (`owner-replay.json`, `benchmarking-typed-adult`) - a plain
  // conceptual question that must reach the model rather than a
  // pattern, judged the same generic bare-floor way as every row
  // above. The France question is forced-search and judged
  // differently: `groundedNames: true` below fails the row if the
  // reply names anyone not present in the tool results or the
  // utterance itself, so a reply that "wins" only by guessing from the
  // model's own (possibly stale) training data fails it exactly like
  // one that invents a name outright - `startFakeSearxng()`'s own
  // fixture answers with a name no model could already know, the only
  // way to tell "grounded in the results" apart from "got lucky."
  { id: "written-conceptual-benchmarking", kind: "fact", say: "what is technical benchmarking and why do you need it" },
  { id: "written-fresh-president-france", kind: "fact", say: "who is the president of France", groundedNames: true },
];

function conversationFor(row: (typeof WRITTEN_QUESTIONS)[number]): BenchConversation {
  // No `toolRan` or `signal` assertion: this bench judges the written
  // register's own effect (length, completeness), not routing or act
  // classification (turnSignal.test.ts's job) - a fact row answered by
  // a deterministic knowledge package, or "how's it going" classified
  // as a question rather than a greeting, is real behavior this bench
  // has no opinion on.
  return {
    id: row.id,
    category: "knowledge",
    note: `written register, ${row.kind}`,
    turns: [{ say: row.say, expect: { guard: null, humanVerdict: true, ...(row.groundedNames ? { groundedNames: true } : {}) } }],
  };
}

if (import.meta.main) {
  await runMain();
}

async function runMain(): Promise<void> {
  let ownDataDir: string | null = null;
  if (!process.env.MAIPAI_DATA_DIR) {
    ownDataDir = mkdtempSync(join(tmpdir(), "written-set-"));
    process.env.MAIPAI_DATA_DIR = ownDataDir;
  }

  let stub: { url: string; stop: () => void } | null = null;
  let proxy: RecordingProxy | null = null;
  if (LIVE) {
    const upstream = process.env.MAIPAI_LLAMA_SERVER_URL;
    if (!upstream) {
      console.error("written-set --live refused: MAIPAI_LLAMA_SERVER_URL is not set; the live run connects only to an engine already running, on a spare port, never 8788's.");
      process.exit(2);
    }
    if (!process.env.MAIPAI_EMBED_URL) {
      console.error("written-set --live refused: MAIPAI_EMBED_URL is not set.");
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

  // U4's own acceptance: the written register only exists on the new
  // path (turnNext.ts) - conversationRunner.ts's driveTurn() already
  // reads this same setting (replay.ts's own "--new" flag flips it the
  // identical way), so this bench is never a --new toggle, always on.
  const { setHouseholdSettingValue } = await import("@/lib/settings");
  setHouseholdSettingValue("turn.pipeline.next", true);
  setHouseholdSettingValue("chat.model_id", process.env.MAIPAI_REPLAY_MODEL_ID ?? "qwen3-8b-instruct-q4-k-m");

  console.log("\n## Run header\n");
  console.log(
    JSON.stringify(
      {
        mode: LIVE ? "live" : "scripted (no live model - completeness is unjudged, see file header)",
        path: "new (turn.pipeline.next)",
        surface: "chat",
        date: new Date().toISOString(),
        chat: process.env.MAIPAI_LLAMA_SERVER_URL,
        embed: process.env.MAIPAI_EMBED_URL,
        rows: WRITTEN_QUESTIONS.length,
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
  const allScores: TurnScore[] = [];
  // WRITTEN-PARITY-01: the bare reply and its judge verdict are only
  // ever measured live (both need a real completion) - one entry per
  // row that produced a score, judged as a single batched call after
  // every row has run, the same "one call over the whole set" shape
  // replyParityJudge.ts mirrors from personaJudge.ts.
  const parityRows: { score: TurnScore; bareReply: string }[] = [];

  try {
    for (const row of WRITTEN_QUESTIONS) {
      console.log(`[written-set] ${row.id} (${row.kind}): "${row.say}"`);
      const run = await runner
        .runConversation(conversationFor(row), {
          people,
          proxy,
          log,
          drainJudge: async () => {},
          backdate: (days, turnIds) => runner.backdateBenchRows(people, days, turnIds),
          homeAssistant,
        })
        .catch((err: Error) => {
          console.error(`[written-set] ${row.id} threw: ${err.message}`);
          return { scores: [], turnIds: [] as string[] };
        });
      allScores.push(...run.scores);
      if (LIVE && run.scores[0]) {
        const bare = await runner.bareReply(row.say);
        parityRows.push({ score: run.scores[0], bareReply: bare });
      }
    }
  } finally {
    log.stop();
    homeAssistant.stop();
    searxng.stop();
  }

  if (LIVE && parityRows.length > 0) {
    const { judgeReplyParity } = await import("@/lib/replyParityJudge");
    const judged = await judgeReplyParity(parityRows.map((p) => ({ question: p.score.say, bareReply: p.bareReply, pathReply: p.score.observed.reply })));
    for (let i = 0; i < parityRows.length; i++) {
      const { score, bareReply } = parityRows[i]!;
      if (judged.ok) {
        const v = judged.verdicts.find((x) => x.index === i);
        score.observed.bareParity = { bareReply, carriesPoints: v?.carries_points ?? false, missingPoints: v?.missing_points ?? ["judge produced no verdict for this row"] };
      } else {
        score.observed.bareParity = { bareReply, carriesPoints: false, missingPoints: [`judge unavailable: ${judged.error}`] };
      }
    }
  } else {
    // Scripted mode: no live completion ran, so there is nothing to
    // judge yet - the column reads "unjudged" rather than blank, so a
    // reader can tell "not measured" from "measured and empty."
    for (const s of allScores) s.observed.bareParity = null;
  }

  console.log("\n## Full table (read the reply column for completeness against the ChatGPT bar - humanVerdict rows are never machine-scored; bare parity is a trend line, never a gate)\n");
  console.log(score.renderTable(allScores));

  const byKind = new Map<string, number>();
  for (const row of WRITTEN_QUESTIONS) byKind.set(row.kind, (byKind.get(row.kind) ?? 0) + 1);
  console.log("\n## Rows by kind\n");
  for (const [kind, count] of byKind) console.log(`${kind}: ${count}`);

  runner.cleanupBenchPeople(people);
  if (proxy) proxy.stop();
  if (stub) stub.stop();
  if (ownDataDir) rmSync(ownDataDir, { recursive: true, force: true });

  finishBench({ executed: allScores.length, engine: LIVE ? `live: ${process.env.MAIPAI_LLAMA_SERVER_URL}` : "scripted (stub, no live model)" });
}
