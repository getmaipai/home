// U2d acceptance addendum (the coordinator, 2026-09-22): "the skeleton
// bench that was going to measure the interim rule was deleted with the
// spike worktrees. So in U2d, run the Chile three turns and the France
// repeated-question pair 10 times each with the always-search budget
// flag on and off, and record for each: correctness, whether the
// answer_from_this_conversation choice was taken, and time to first
// token." Runs turnNext.ts directly (not through conversationRunner.ts's
// own runConversation - this needs per-turn control over the budget
// override and the answer_from_context signal conversationRunner.ts's
// scorer doesn't track), against the hub's real, already-running 8B at
// 127.0.0.1:8788, per the task brief's own protocol: one request at a
// time, a 30s quiet wait after any new [turn] line in
// home/data/logs/hub.log (real household activity, never a bench's -
// this script's own turns never write that log line, so any new one
// during a run is a real household turn), never beside a gate. Uses an
// isolated bench data directory (MAIPAI_DATA_DIR), never the
// household's real data/hub.db - the engine port is shared, the data
// never is.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { waitForHubQuiet, refuseIfGateRunning } from "./liveHubQuiet";

const REPEATS = Number(process.env.INTERIM_REPEATS ?? 10);
const waitForQuiet = () => waitForHubQuiet(undefined, (msg) => console.log(msg.replace("live-hub-quiet", "interim-rule-measure")));

async function main(): Promise<void> {
  refuseIfGateRunning("interim-rule-measure");
  const upstream = process.env.MAIPAI_LLAMA_SERVER_URL ?? "http://127.0.0.1:8788";
  const ownDataDir = mkdtempSync(join(tmpdir(), "interim-rule-measure-"));
  process.env.MAIPAI_DATA_DIR = ownDataDir;
  process.env.MAIPAI_LLAMA_SERVER_URL = upstream;
  if (!process.env.MAIPAI_EMBED_URL) process.env.MAIPAI_EMBED_URL = "http://127.0.0.1:8794";

  const setup = await import("./setup");
  await setup.startBench();

  const { createBenchPeople, cleanupBenchPeople } = await import("./conversationRunner");
  const { setHouseholdSettingValue, getHouseholdSettingValue } = await import("@/lib/settings");
  const { CATALOG } = await import("@/lib/modelCatalog");
  const { runTurnNext } = await import("@/lib/turnMachine/turnNext");

  setHouseholdSettingValue("chat.model_id", "qwen3-8b-instruct-q4-k-m");
  setHouseholdSettingValue("turn.pipeline.next", true);
  // The household's own real search backend, read from the live hub's
  // settings (never hardcoded - a LAN address, per CLAUDE.md's privacy
  // rule) so the search leg is measured for real, not against a fixture.
  const searxngUrl = process.env.MAIPAI_SEARXNG_URL;
  if (searxngUrl) setHouseholdSettingValue("search.searxng_url", searxngUrl);

  const entry = CATALOG.find((m) => m.id === "qwen3-8b-instruct-q4-k-m")!;
  const baseBudget = entry.turn_budget!;

  interface Row {
    conversationId: string;
    label: string;
    alwaysSearch: boolean;
    repeat: number;
    turnIndex: number;
    say: string;
    ttftMs: number | null;
    searched: boolean;
    answeredFromContext: boolean;
    sourced: boolean;
    replyText: string;
    pass: boolean;
    note: string;
  }
  const rows: Row[] = [];

  async function runConversation(label: string, turns: string[], alwaysSearch: boolean, repeat: number): Promise<void> {
    entry.turn_budget = { ...baseBudget, always_search: alwaysSearch };
    const people = createBenchPeople();
    let conversationId: string | undefined;
    try {
      for (let i = 0; i < turns.length; i++) {
        await waitForQuiet();
        const t0 = performance.now();
        const result = await runTurnNext(people.owner, "chat", turns[i]!, { conversationId });
        const ttftMs = performance.now() - t0;
        if (!result.ok) {
          rows.push({ conversationId: conversationId ?? "", label, alwaysSearch, repeat, turnIndex: i, say: turns[i]!, ttftMs: null, searched: false, answeredFromContext: false, sourced: false, replyText: "", pass: false, note: `error: ${result.error}` });
          continue;
        }
        if (result.kind !== "immediate") continue;
        conversationId = result.value.conversation_id;
        const nodesTrace = (result.value.stats as { nodes?: { node: string; impl: string; outcome: { ok?: boolean; skipped?: boolean } }[] } | null)?.nodes ?? [];
        const generations = result.value.stats?.generations ?? [];
        // answer_from_context taken: the model's own second-round choice
        // (nodes/model.ts's ANSWER_FROM_CONTEXT_TOOL_ID) - visible only
        // via the trace's own node presence today (no dedicated wire
        // field yet); approximated here as "an interim_rule generation
        // ran but no websearch outcome exists on the turn."
        // The coordinator caught this reading mere presence: U2e's own
        // trace-completeness fix (TraceRecorder.skip()) means a "tool"
        // entry now ALWAYS exists in stats.nodes, skipped or not, so
        // `.some(n => n.node === "tool")` was true on every single row
        // regardless of whether a tool actually ran - reading `.outcome`
        // (`ok` present means it ran, with or without an error; `skipped`
        // means it never did) is the real signal.
        const hasWebsearchOutcome = nodesTrace.some((n) => n.node === "tool" && n.outcome?.ok !== undefined);
        const answeredFromContext = generations.some((g) => g.reason === "interim_rule") && !hasWebsearchOutcome;
        const sourced = (result.value.reply as { sources?: unknown[] }).sources !== undefined || false;
        rows.push({
          conversationId,
          label,
          alwaysSearch,
          repeat,
          turnIndex: i,
          say: turns[i]!,
          ttftMs: Math.round(ttftMs),
          searched: hasWebsearchOutcome,
          answeredFromContext,
          sourced,
          replyText: result.value.reply.text.slice(0, 200),
          pass: result.value.safety.action !== "refuse" && result.value.reply.text.length > 0,
          note: (result.value as { source: string }).source,
        });
      }
    } finally {
      cleanupBenchPeople(people);
    }
  }

  // A code review caught this running with no try/finally: a throw
  // partway through (a real risk against a live household engine)
  // left `entry.turn_budget` pointed at the last alwaysSearch override
  // for the rest of the hub process's life (not this script's own
  // state - CATALOG is the live, shared module-level catalog) and
  // leaked ownDataDir. Both restores now always run.
  try {
    for (const alwaysSearch of [true, false]) {
      for (let repeat = 1; repeat <= REPEATS; repeat++) {
        console.log(`[interim-rule-measure] chile always_search=${alwaysSearch} repeat ${repeat}/${REPEATS}`);
        await runConversation("chile", ["who is the president of chile", "when was he born", "yes"], alwaysSearch, repeat);
        console.log(`[interim-rule-measure] france always_search=${alwaysSearch} repeat ${repeat}/${REPEATS}`);
        await runConversation("france", ["who is the president of France", "who is the president of France"], alwaysSearch, repeat);
      }
    }
  } finally {
    entry.turn_budget = baseBudget;
    rmSync(ownDataDir, { recursive: true, force: true });
  }

  console.log("\n## interim-rule-measure rows\n");
  console.log(JSON.stringify(rows, null, 2));

  console.log("\n## summary\n");
  for (const label of ["chile", "france"] as const) {
    for (const alwaysSearch of [true, false]) {
      const subset = rows.filter((r) => r.label === label && r.alwaysSearch === alwaysSearch);
      const passRate = subset.length ? subset.filter((r) => r.pass).length / subset.length : 0;
      const searchedRate = subset.length ? subset.filter((r) => r.searched).length / subset.length : 0;
      const contextRate = subset.length ? subset.filter((r) => r.answeredFromContext).length / subset.length : 0;
      const ttfts = subset.map((r) => r.ttftMs).filter((v): v is number => v !== null);
      const medianTtft = ttfts.length ? ttfts.sort((a, b) => a - b)[Math.floor(ttfts.length / 2)] : null;
      console.log(`${label} always_search=${alwaysSearch}: pass ${(passRate * 100).toFixed(0)}%, searched ${(searchedRate * 100).toFixed(0)}%, answer_from_context ${(contextRate * 100).toFixed(0)}%, median TTFT ${medianTtft}ms, n=${subset.length}`);
    }
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
