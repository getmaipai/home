// READ-PAGE-01 (home/docs/BACKLOG.md; home/docs/dev.md "LIVE-0923-01"):
// measure-first for stripping the model's own `read_page` argument on a
// websearch call, the same "never trust the model's own tool argument"
// floor LIVE-0923-01's own category fix already landed. Seven rows
// matching the shapes of the real conversation's own seven forced-
// search turns that surfaced this (an announcement question, a
// conceptual definition, a poster request, a trailer request, a
// release-date question, an urgent follow-up, a general current-events
// question) - roster-safe and fictional throughout, never the
// household's own words (getmaipai/.github/CLAUDE.md's privacy rule).
//
// Each row runs twice, `MAIPAI_BENCH_KEEP_READ_PAGE` off (read_page
// stripped, tool.ts's own new default) then on (kept, today's
// unfiltered behavior) - the tool node's own bench toggle, `tool.ts`'s
// header comment names it. Compares: the phrasing round's own
// prompt_n (the token cost read_page adds), total_ms (a real relative
// signal even though the fake SearXNG's own near-instant response
// means the wall-clock split between "the search itself" and "the
// page read" isn't representative - the live conversation's own
// dev.md numbers are the reference for that half), and reply parity
// against the bare model (written-set.ts's own bareReply()/
// judgeReplyParity(), one batched judge call over all 14 exchanges).
//
//   bun run backend/scripts/bench/read-page-01.ts            scripted (no live model, proves the harness only)
//   bun run backend/scripts/bench/read-page-01.ts --live     a side engine, a spare port (or 127.0.0.1:8788 by URL, this machine's own precedent)
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BenchConversation } from "./conversationFixture";
import type { RecordingProxy } from "./recordingProxy";
import type { TurnScore } from "./conversationScore";

const LIVE = process.argv.includes("--live");

const READ_PAGE_ROWS: readonly { id: string; kind: string; say: string }[] = [
  { id: "read-page-announcement", kind: "announcement", say: "what has cosmo systems announced this week" },
  { id: "read-page-conceptual", kind: "conceptual", say: "what is technical benchmarking and why do you need it" },
  { id: "read-page-poster", kind: "poster", say: "show me the latest poster for the marsh lantern movie" },
  { id: "read-page-trailer", kind: "trailer", say: "show me the latest trailer for the marsh lantern movie" },
  { id: "read-page-release-date", kind: "release-date", say: "when does the new lantern bay series come out" },
  { id: "read-page-urgent-followup", kind: "urgent-followup", say: "just search for it now" },
  { id: "read-page-current-events", kind: "current-events", say: "what was the score of last night's game" },
];

function conversationFor(row: (typeof READ_PAGE_ROWS)[number]): BenchConversation {
  return {
    id: row.id,
    category: "tools",
    note: `read_page shape, ${row.kind}`,
    turns: [{ say: row.say, expect: { guard: null, humanVerdict: true } }],
  };
}

if (import.meta.main) {
  await runMain();
}

async function runMain(): Promise<void> {
  // Validated before the temp data dir is ever created below - a
  // refused --live run (a missing env var) must leave nothing behind
  // to clean up, the same "a script never leaves state behind" rule
  // every other check in this file already follows.
  if (LIVE) {
    if (!process.env.MAIPAI_LLAMA_SERVER_URL) {
      console.error("read-page-01 --live refused: MAIPAI_LLAMA_SERVER_URL is not set; the live run connects only to an engine already running.");
      process.exit(2);
    }
    if (!process.env.MAIPAI_EMBED_URL) {
      console.error("read-page-01 --live refused: MAIPAI_EMBED_URL is not set.");
      process.exit(2);
    }
  }

  let ownDataDir: string | null = null;
  if (!process.env.MAIPAI_DATA_DIR) {
    ownDataDir = mkdtempSync(join(tmpdir(), "read-page-01-"));
    process.env.MAIPAI_DATA_DIR = ownDataDir;
  }

  let stub: { url: string; stop: () => void } | null = null;
  let proxy: RecordingProxy | null = null;
  if (LIVE) {
    const upstream = process.env.MAIPAI_LLAMA_SERVER_URL!;
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

  await startBench();

  const { setHouseholdSettingValue } = await import("@/lib/settings");
  setHouseholdSettingValue("turn.pipeline.next", true);
  setHouseholdSettingValue("chat.model_id", process.env.MAIPAI_REPLAY_MODEL_ID ?? "qwen3-8b-instruct-q4-k-m");

  console.log("\n## Run header\n");
  console.log(JSON.stringify({ mode: LIVE ? "live" : "scripted (no live model, see file header)", surface: "chat", date: new Date().toISOString(), chat: process.env.MAIPAI_LLAMA_SERVER_URL, rows: READ_PAGE_ROWS.length }, null, 2));
  console.log("");

  type Variant = { toolMs: number | null; phrasingPromptN: number | null; totalMs: number | null; reply: string };

  async function runVariant(row: (typeof READ_PAGE_ROWS)[number], variant: "off" | "on"): Promise<Variant> {
    if (variant === "on") process.env.MAIPAI_BENCH_KEEP_READ_PAGE = "1";
    else delete process.env.MAIPAI_BENCH_KEEP_READ_PAGE;

    const log = runner.captureTurnLog();
    const people = runner.createBenchPeople();
    const homeAssistant = runner.startFakeHomeAssistant();
    const searxng = runner.startFakeSearxng();
    let run: { scores: TurnScore[]; turnIds: string[] };
    try {
      run = await runner
        .runConversation(conversationFor(row), { people, proxy, log, drainJudge: async () => {}, backdate: (days, turnIds) => runner.backdateBenchRows(people, days, turnIds), homeAssistant })
        .catch((err: Error) => {
          console.error(`[read-page-01] ${row.id} (${variant}) threw: ${err.message}`);
          return { scores: [], turnIds: [] as string[] };
        });
    } finally {
      log.stop();
      homeAssistant.stop();
      searxng.stop();
      runner.cleanupBenchPeople(people);
    }
    const observed = run.scores[0]?.observed;
    const toolNode = observed?.nodeTrace?.find((n) => n.node === "tool");
    const phrasing = observed?.generationTrace?.find((g) => g.reason === "phrasing");
    const v: Variant = { toolMs: toolNode ? toolNode.endMs - toolNode.startMs : null, phrasingPromptN: phrasing?.prompt_n ?? null, totalMs: observed?.totalMs ?? null, reply: observed?.reply ?? "" };
    console.log(`       read_page=${variant}: tool_ms=${v.toolMs ?? "n/a"} phrasing_prompt_n=${v.phrasingPromptN ?? "n/a"} total_ms=${v.totalMs === null ? "n/a (the conversation threw, see the error above)" : Math.round(v.totalMs)}`);
    return v;
  }

  const results: { row: (typeof READ_PAGE_ROWS)[number]; off: Variant; on: Variant }[] = [];
  for (const row of READ_PAGE_ROWS) {
    console.log(`[read-page-01] ${row.id} (${row.kind}): "${row.say}"`);
    const off = await runVariant(row, "off");
    const on = await runVariant(row, "on");
    results.push({ row, off, on });
  }
  delete process.env.MAIPAI_BENCH_KEEP_READ_PAGE;

  console.log("\n## Token and time deltas (on minus off)\n");
  for (const r of results) {
    const dPromptN = r.on.phrasingPromptN !== null && r.off.phrasingPromptN !== null ? r.on.phrasingPromptN - r.off.phrasingPromptN : null;
    const dTotalMs = r.on.totalMs !== null && r.off.totalMs !== null ? Math.round(r.on.totalMs - r.off.totalMs) : null;
    const fmt = (ms: number | null) => (ms === null ? "n/a" : Math.round(ms).toString());
    console.log(`${r.row.id}: prompt_n off=${r.off.phrasingPromptN ?? "n/a"} on=${r.on.phrasingPromptN ?? "n/a"} (delta ${dPromptN ?? "n/a"}); total_ms off=${fmt(r.off.totalMs)} on=${fmt(r.on.totalMs)} (delta ${dTotalMs ?? "n/a"})`);
  }

  if (LIVE) {
    const { bareReply } = runner;
    const { judgeReplyParity } = await import("@/lib/replyParityJudge");
    const exchanges: { question: string; bareReply: string; pathReply: string }[] = [];
    for (const r of results) {
      const bare = await bareReply(r.row.say);
      exchanges.push({ question: `${r.row.say} (read_page off)`, bareReply: bare, pathReply: r.off.reply });
      exchanges.push({ question: `${r.row.say} (read_page on)`, bareReply: bare, pathReply: r.on.reply });
    }
    const judged = await judgeReplyParity(exchanges);
    console.log("\n## Reply parity against the bare model\n");
    if (!judged.ok) {
      console.error(`[read-page-01] parity judge failed: ${judged.error}`);
    } else {
      let offCarries = 0;
      let onCarries = 0;
      for (let i = 0; i < results.length; i++) {
        const offV = judged.verdicts.find((v) => v.index === i * 2);
        const onV = judged.verdicts.find((v) => v.index === i * 2 + 1);
        if (offV?.carries_points) offCarries++;
        if (onV?.carries_points) onCarries++;
        console.log(`${results[i]!.row.id}: off ${offV?.carries_points ? "ok" : `missing: ${offV?.missing_points?.join(", ") ?? "unjudged"}`}; on ${onV?.carries_points ? "ok" : `missing: ${onV?.missing_points?.join(", ") ?? "unjudged"}`}`);
      }
      console.log(`\noff carries points on ${offCarries}/${results.length} rows; on carries points on ${onCarries}/${results.length} rows`);
      console.log(offCarries >= onCarries ? "VERDICT: parity holds with read_page off - ship the strip." : "VERDICT: parity drops with read_page off - do not ship, bring these numbers back.");
    }
  } else {
    console.log("\nscripted mode: harness proven, no real reply to judge - rerun with --live for the parity verdict.");
  }

  if (proxy) proxy.stop();
  if (stub) stub.stop();
  if (ownDataDir) rmSync(ownDataDir, { recursive: true, force: true });
  finishBench({ executed: results.length * 2, engine: LIVE ? `live: ${process.env.MAIPAI_LLAMA_SERVER_URL}` : "scripted (stub, no live model)" });
}
