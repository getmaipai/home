// The baseline conversation bench, live mode (docs/plans/measure-first-
// 2026-09-13.md section 2; design in docs/dev/session-a.md): the twenty
// fixture conversations through the real runTurnStream() against the
// household engines by URL, every outcome read from the system's own
// state (conversationRunner.ts), one table, totals by category, the
// hard-row verdicts and the ranked failures. Not part of check.sh: a
// bench run on demand, `bun run scripts/bench/conversation.ts --live`,
// with MAIPAI_DATA_DIR (fresh, under the temp root), MAIPAI_LLAMA_SERVER_URL,
// MAIPAI_EMBED_URL and MAIPAI_BACKGROUND_URL (the judge) set. The
// sampler seed is pinned (BENCH-01, below): `--seed N` for another,
// `--seed none` for the household's own dice.
//
// Import order matters: the recording proxy has to sit in front of the
// chat engine before setup.ts reads MAIPAI_LLAMA_SERVER_URL, and
// setup.ts has to load before anything reaches "@/db". So this file
// starts the proxy, rewrites the URL, then loads setup and the runner
// dynamically.
import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { startRecordingProxy } from "./recordingProxy";

const upstream = process.env.MAIPAI_LLAMA_SERVER_URL;
if (!upstream) {
  console.error("bench setup refused: MAIPAI_LLAMA_SERVER_URL is not set; the live bench connects only to an engine already running.");
  process.exit(2);
}
const proxy = startRecordingProxy(upstream);
process.env.MAIPAI_LLAMA_SERVER_URL = proxy.url;

const setup = await import("./setup");
const { finishBench, startBench } = setup;
const runner = await import("./conversationRunner");
const score = await import("./conversationScore");
const { CONVERSATIONS } = await import("./conversationFixture");
const { runJudgeBatch } = await import("@/lib/memoryJudge");
const { __setTurnActivityClockForTests } = await import("@/lib/turnActivity");
const { getBackgroundClient, probeBackgroundEngine } = await import("@/lib/backgroundSupervisor");
const { loadAllManifests, ordinaryToolIds } = await import("@/lib/turnEngine");
const { CHAT_SAMPLING } = await import("@/lib/llm");
const { __setSamplingSeedForBench, __setPromptClockForBench } = await import("@/lib/benchSampling");

// BENCH-01 (docs/plans/baseline-fixes-2026-09-13.md item 5): the
// sampler seed is pinned for every chat and judge request, so two runs
// on the same commit answer the same way and a row that flips between
// them is a change in the code, not the dice. `--seed N` picks another
// one (a run with a different seed is allowed to differ, and the header
// says which seed it ran); `--seed none` runs unpinned, the way the
// household's own hub samples.
const DEFAULT_BENCH_SEED = 20260913;
function benchSeedFromArgv(argv: readonly string[]): number | null {
  const at = argv.indexOf("--seed");
  if (at === -1) return DEFAULT_BENCH_SEED;
  const raw = argv[at + 1];
  if (raw === "none") return null;
  // A whole non-negative integer only (the review of this diff: parseInt
  // took "12abc" as 12, and a negative seed is llama-server's own
  // "random" sentinel once it lands in a uint32, an unpinned run under a
  // header claiming a pin). A bare `--seed` is a mistake, not "none".
  if (raw === undefined || !/^\d+$/.test(raw) || Number(raw) > 0xfffffffe) {
    console.error(`bench setup refused: --seed wants a whole number below 4294967295, or "none"; got "${raw ?? ""}"`);
    process.exit(2);
  }
  return Number(raw);
}
const benchSeed = benchSeedFromArgv(process.argv);
/** `--only id,id`: the rows to run, for a rerun of the rows an item
 * changed after a set that was otherwise green (the coordinator's
 * rule); the header names them, so a partial run never reads as a
 * full one. */
function onlyFromArgv(argv: readonly string[]): Set<string> | null {
  const equals = argv.find((a) => a.startsWith("--only="));
  if (equals) throw new Error("--only takes its list as the next argument (--only a,b), not --only=a,b");
  const at = argv.indexOf("--only");
  if (at < 0) return null;
  const raw = argv[at + 1];
  const ids = new Set((raw ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  if (ids.size === 0) throw new Error("--only needs a comma-separated list of conversation ids");
  return ids;
}
const only = onlyFromArgv(process.argv);
const SELECTED = only ? CONVERSATIONS.filter((c) => only.has(c.id)) : CONVERSATIONS;
if (only && SELECTED.length !== only.size) throw new Error(`--only names an unknown conversation: ${[...only].filter((id) => !CONVERSATIONS.some((c) => c.id === id)).join(", ")}`);
// A row that recalls what an earlier row stored in the same bench
// household runs only with that row: a partial run without it would
// report the harness's miss as the retrieval's.
const DEPENDS_ON: Record<string, string> = { "copied-line-history": "copied-line" };
if (only) {
  for (const [row, on] of Object.entries(DEPENDS_ON)) {
    if (only.has(row) && !only.has(on)) throw new Error(`--only ${row} needs ${on} in the same run (it recalls what ${on} stored)`);
  }
}
__setSamplingSeedForBench(benchSeed);
// The prompt's "Local time" line is pinned with the seed (a run's
// prompts must be the same tokens as the last run's, or the seed buys
// nothing); the instant is the fixture's own day at noon, whatever day
// the run happens on. Unpinned when the seed is.
const BENCH_PROMPT_INSTANT = new Date(2026, 8, 13, 12, 0, 0);
if (benchSeed !== null) __setPromptClockForBench(() => BENCH_PROMPT_INSTANT);
const { __resetEmbedSupervisorForTests } = await import("@/lib/embedSupervisor");

interface EngineProps {
  build_info?: string;
  model_path?: string;
  default_generation_settings?: { params?: Record<string, unknown> };
}

async function engineProps(url: string): Promise<EngineProps> {
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/props`);
    return res.ok ? ((await res.json()) as EngineProps) : {};
  } catch {
    return {};
  }
}

async function sha256Of(path: string | undefined): Promise<string> {
  if (!path || !existsSync(path)) return "n/a";
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    createReadStream(path).on("data", (chunk) => hash.update(chunk)).on("end", resolve).on("error", reject);
  });
  return hash.digest("hex");
}

async function commitHash(): Promise<string> {
  try {
    const proc = Bun.spawn(["git", "rev-parse", "HEAD"], { cwd: import.meta.dir, stdout: "pipe", stderr: "ignore" });
    return (await new Response(proc.stdout).text()).trim();
  } catch {
    return "n/a";
  }
}

/** Runs the judge until its queue is empty, with the turn-activity
 * clock advanced past the judge's idle window (it declines to run
 * within five seconds of a turn), then restored. */
async function drainJudge(): Promise<void> {
  const base = Date.now();
  __setTurnActivityClockForTests(() => Date.now() + 60_000);
  try {
    for (let i = 0; i < 5; i++) {
      const batch = await runJudgeBatch();
      if (batch.processed === 0) break;
    }
  } finally {
    __setTurnActivityClockForTests(() => Date.now());
  }
  console.log(`[bench] judge drained in ${Date.now() - base} ms`);
}

async function main(): Promise<{ executed: number; engine: string }> {
  await startBench();
  await getBackgroundClient();
  const judge = await probeBackgroundEngine();
  if (!judge.alive) {
    console.error(`bench setup refused: no memory judge answers at MAIPAI_BACKGROUND_URL (${process.env.MAIPAI_BACKGROUND_URL}); the baseline bench needs the judge for its recall rows.`);
    process.exit(2);
  }

  const chat = await engineProps(upstream!);
  const background = await engineProps(process.env.MAIPAI_BACKGROUND_URL!);
  const embed = await engineProps(process.env.MAIPAI_EMBED_URL!);
  const header = {
    commit: await commitHash(),
    date: new Date().toISOString(),
    // The bench is the process that runs the turns (runTurnStream() in
    // process, as every bench through setup.ts does); no hub backend is
    // involved, only the engines by URL.
    pid: process.pid,
    chat: { url: upstream, build: chat.build_info ?? "n/a", model: chat.model_path ?? "n/a", sha256: await sha256Of(chat.model_path) },
    judge: { url: process.env.MAIPAI_BACKGROUND_URL, build: background.build_info ?? "n/a", model: background.model_path ?? "n/a", sha256: await sha256Of(background.model_path) },
    embed: { url: process.env.MAIPAI_EMBED_URL, build: embed.build_info ?? "n/a", model: embed.model_path ?? "n/a", sha256: await sha256Of(embed.model_path) },
    sampling: {
      hub: CHAT_SAMPLING,
      engineDefaults: chat.default_generation_settings?.params ?? {},
      // The pinned seed, on every chat and judge request of this run;
      // two runs with the same seed on the same commit are expected to
      // produce the same pass set, a different seed may differ.
      seed: benchSeed,
      promptClock: benchSeed === null ? "unpinned" : BENCH_PROMPT_INSTANT.toISOString(),
      // Memory and episode lines render their own created_at against
      // the real calendar ("as of Sep 13"), which the pin does not reach,
      // so the expectation holds for runs on the same day.
      seedNote:
        benchSeed === null
          ? "unpinned: the sampler's own dice, runs are not comparable row by row"
          : benchSeed === DEFAULT_BENCH_SEED
            ? "the default seed; the same pass set is expected from another run of this commit on the same day"
            : "a chosen seed; may differ from a default-seed run of this commit",
    },
    ordinaryTools: ordinaryToolIds(loadAllManifests(), { byPlugin: [] }),
    fixtures: SELECTED.map((c) => c.id),
    ...(only ? { partial: `--only ${[...only].join(",")}: ${SELECTED.length} of ${CONVERSATIONS.length} conversations` } : {}),
  };
  console.log("\n## Run header\n");
  console.log("```json");
  console.log(JSON.stringify(header, null, 2));
  console.log("```\n");

  const log = runner.captureTurnLog();
  const people = runner.createBenchPeople();
  const homeAssistant = runner.startFakeHomeAssistant();
  const scores: Awaited<ReturnType<typeof runner.runConversation>>["scores"] = [];
  const started = Date.now();
  try {
    for (const conv of SELECTED) {
      console.log(`[bench] ${conv.id}`);
      const run = await runner.runConversation(conv, {
        people,
        proxy,
        log,
        drainJudge,
        backdate: (days, turnIds) => runner.backdateBenchRows(people, days, turnIds),
        homeAssistant,
      }).catch((err: Error) => {
        // A conversation that throws (a seed or conversation-create
        // failure) is a failing row, never a lost table.
        console.error(`[bench] ${conv.id} threw: ${err.message}`);
        return { scores: [], turnIds: [] as string[] };
      });
      scores.push(...run.scores);
      // One JSON line per turn for a later reading of the run (the
      // reply, the checks, the timings), beside the table.
      for (const sc of run.scores) console.log(`[bench-turn] ${JSON.stringify({ conversation: sc.conversationId, turn: sc.turnIndex + 1, said: sc.say, pass: sc.pass, checks: sc.checks, reply: sc.observed.reply, source: sc.observed.source, pluginId: sc.observed.pluginId, guardHits: sc.observed.guardHits, rawModelText: sc.observed.rawModelText ?? null, memoryRows: sc.observed.memoryRows, offeredTools: sc.observed.offeredTools, firstDeltaMs: sc.observed.firstDeltaMs, totalMs: sc.observed.totalMs })}`);
    }
  } finally {
    log.stop();
    homeAssistant.stop();
  }

  console.log("\n## Table\n");
  console.log(score.renderTable(scores));
  console.log("\n## Totals by category\n");
  console.log(score.renderTotals(score.totalsByCategory(scores)));
  const hard = scores.filter((s) => s.hard);
  console.log("\n## Hard rows\n");
  for (const s of hard) console.log(`- ${s.conversationId} turn ${s.turnIndex + 1}: ${s.pass === null ? "reader" : s.pass ? "pass" : "MISS"}${s.pass === false ? ` (${s.checks.filter((c) => !c.pass).map((c) => `${c.name}: ${c.detail}`).join("; ")})` : ""}`);
  console.log("\n## Ranked failures (scored rows; the reader's verdicts are separate)\n");
  console.log(score.renderRanking(score.rankFailures(scores)));
  const timed = scores.filter((s) => s.observed.firstDeltaMs !== null);
  const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]! : NaN);
  runner.cleanupBenchPeople(people); // after the output: the table is the run's product, the cleanup a courtesy
  __resetEmbedSupervisorForTests();
  console.log(`\nturns ${scores.length}; median first delta ${Math.round(median(timed.map((s) => s.observed.firstDeltaMs!)))} ms; median total ${Math.round(median(scores.map((s) => s.observed.totalMs)))} ms; wall ${Math.round((Date.now() - started) / 1000)} s`);
  return { executed: scores.length, engine: `chat ${header.chat.build} ${header.chat.model}; judge ${header.judge.model}; seed ${benchSeed ?? "none"}` };
}

let summary = { executed: 0, engine: "" };
try {
  summary = await main();
} finally {
  proxy.stop();
}
finishBench(summary);
