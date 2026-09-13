// The baseline conversation bench, live mode (docs/plans/measure-first-
// 2026-09-13.md section 2; design in docs/dev/session-a.md): the twenty
// fixture conversations through the real runTurnStream() against the
// household engines by URL, every outcome read from the system's own
// state (conversationRunner.ts), one table, totals by category, the
// hard-row verdicts and the ranked failures. Not part of check.sh: a
// bench run on demand, `bun run scripts/bench/conversation.ts --live`,
// with MAIPAI_DATA_DIR (fresh, under the temp root), MAIPAI_LLAMA_SERVER_URL,
// MAIPAI_EMBED_URL and MAIPAI_BACKGROUND_URL (the judge) set.
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
    sampling: { hub: CHAT_SAMPLING, engineDefaults: chat.default_generation_settings?.params ?? {} },
    ordinaryTools: ordinaryToolIds(loadAllManifests(), { byPlugin: [] }),
    fixtures: CONVERSATIONS.map((c) => c.id),
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
    for (const conv of CONVERSATIONS) {
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
  return { executed: scores.length, engine: `chat ${header.chat.build} ${header.chat.model}; judge ${header.judge.model}` };
}

let summary = { executed: 0, engine: "" };
try {
  summary = await main();
} finally {
  proxy.stop();
}
finishBench(summary);
