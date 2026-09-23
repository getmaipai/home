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

/** GROUND-01 step 4: a search counts by the `tool` node's own outcome,
 * never by its presence in the trace - U2e's trace-completeness fix
 * (TraceRecorder.skip()) means a "tool" entry always exists in
 * `stats.nodes[]`, skipped or not, so reading presence alone made
 * every row look searched regardless of what actually ran. `ok`
 * present (with or without an error) means the tool node actually ran;
 * `skipped: true` means it never reached this turn. Exported and pure
 * (no live call) so this one decision is unit-testable without the
 * hub-live engine the rest of this script needs. */
export function hasWebsearchOutcome(nodes: readonly { node: string; outcome?: { ok?: boolean; skipped?: boolean } }[]): boolean {
  return nodes.some((n) => n.node === "tool" && n.outcome?.ok !== undefined);
}

async function main(): Promise<void> {
  refuseIfGateRunning("interim-rule-measure");
  const upstream = process.env.MAIPAI_LLAMA_SERVER_URL ?? "http://127.0.0.1:8788";
  const ownDataDir = mkdtempSync(join(tmpdir(), "interim-rule-measure-"));
  process.env.MAIPAI_DATA_DIR = ownDataDir;
  if (!process.env.MAIPAI_EMBED_URL) process.env.MAIPAI_EMBED_URL = "http://127.0.0.1:8794";
  // ENGINE-CONTRACT-01 (dev.md 2026-09-23): the recording proxy in
  // front of the real engine, the same one replay.ts's --hub-live uses,
  // so this script's own rows carry cached_tokens/prompt_tokens/
  // required_honored per request too - reset before each turn (the
  // same per-turn scoping conversationRunner.ts already relies on).
  const { startRecordingProxy } = await import("./recordingProxy");
  const proxy = startRecordingProxy(upstream);
  process.env.MAIPAI_LLAMA_SERVER_URL = proxy.url;

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
    sourced: boolean;
    replyText: string;
    pass: boolean;
    note: string;
    /** ENGINE-CONTRACT-02 (dev.md 2026-09-23, "U6: the flip verdict"):
     * read off `stats.nodes[]`'s own `model` entries - the same field
     * the model node itself sets on a genuine miss, never the old
     * "an interim_rule generation with no websearch outcome" proxy
     * (renamed from answer_from_context - the tool is never offered
     * with the escape off, so that heuristic was only ever counting
     * misses under a different name). */
    /** Whether this turn made an interim_rule (forced) generation at
     * all - `requiredMiss` is only meaningful when this is true. */
    wasForced: boolean;
    requiredMiss: boolean;
    requiredCachedTokens: number | null;
    requiredPromptTokens: number | null;
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
          rows.push({ conversationId: conversationId ?? "", label, alwaysSearch, repeat, turnIndex: i, say: turns[i]!, ttftMs: null, searched: false, sourced: false, replyText: "", pass: false, note: `error: ${result.error}`, wasForced: false, requiredMiss: false, requiredCachedTokens: null, requiredPromptTokens: null });
          continue;
        }
        if (result.kind !== "immediate") continue;
        conversationId = result.value.conversation_id;
        const nodesTrace = (result.value.stats as { nodes?: { node: string; impl: string; outcome?: { ok?: boolean; skipped?: boolean; required_miss?: boolean } }[] } | null)?.nodes ?? [];
        const generations = (result.value.stats?.generations ?? []) as { reason: string; cache_n: number | null; prompt_n: number | null }[];
        // ENGINE-CONTRACT-02: required_miss is the model node's own
        // trace field, set on the exact turn a required or offered
        // websearch call missed its own verification (dev.md "U6: the
        // flip verdict") - the real signal now, never a proxy read off
        // node presence.
        const requiredMiss = nodesTrace.some((n) => n.node === "model" && n.outcome?.required_miss === true);
        // The forced attempt is always the turn's own first generation
        // (a genuine miss returns real text, so the "no visible text"
        // retry never runs first) - its own cache/prompt token reading
        // is what the miss actually happened under.
        const forcedGeneration = generations.find((g) => g.reason === "interim_rule");
        const sourced = (result.value.reply as { sources?: unknown[] }).sources !== undefined || false;
        rows.push({
          conversationId,
          label,
          alwaysSearch,
          repeat,
          turnIndex: i,
          say: turns[i]!,
          ttftMs: Math.round(ttftMs),
          searched: hasWebsearchOutcome(nodesTrace),
          sourced,
          wasForced: forcedGeneration !== undefined,
          requiredMiss,
          requiredCachedTokens: forcedGeneration?.cache_n ?? null,
          requiredPromptTokens: forcedGeneration?.prompt_n ?? null,
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
    // A review caught this listening server left running on a throw
    // (only this function's own last statement stopped it, past
    // wherever an exception propagated to) - the same "a throw is a
    // real risk here" reason the budget/tempdir restores above already
    // moved into this block for.
    proxy.stop();
  }

  console.log("\n## interim-rule-measure rows\n");
  console.log(JSON.stringify(rows, null, 2));

  const median = (values: readonly number[]): number | null => (values.length ? [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]! : null);

  console.log("\n## summary\n");
  for (const label of ["chile", "france"] as const) {
    for (const alwaysSearch of [true, false]) {
      const subset = rows.filter((r) => r.label === label && r.alwaysSearch === alwaysSearch);
      const passRate = subset.length ? subset.filter((r) => r.pass).length / subset.length : 0;
      const searchedRate = subset.length ? subset.filter((r) => r.searched).length / subset.length : 0;
      const ttfts = subset.map((r) => r.ttftMs).filter((v): v is number => v !== null);
      // ENGINE-CONTRACT-02 (dev.md 2026-09-23, "U6: the flip verdict"):
      // only over turns that actually made a forced call - most turns
      // in this script never do (only the interim rule's own first
      // call per conversation does). The counter sits beside TTFT per
      // outcome (miss vs clean), never one aggregate median, since the
      // builder row's own extra generation is a real latency cost the
      // France shape (the identical-repeat conversation) pays most.
      const forced = subset.filter((r) => r.wasForced);
      const missShare = forced.length ? forced.filter((r) => r.requiredMiss).length / forced.length : null;
      const missTtft = median(forced.filter((r) => r.requiredMiss).map((r) => r.ttftMs).filter((v): v is number => v !== null));
      const cleanTtft = median(forced.filter((r) => !r.requiredMiss).map((r) => r.ttftMs).filter((v): v is number => v !== null));
      console.log(`${label} always_search=${alwaysSearch}: pass ${(passRate * 100).toFixed(0)}%, searched ${(searchedRate * 100).toFixed(0)}%, median TTFT ${median(ttfts)}ms, n=${subset.length}, required_miss ${missShare === null ? "n/a" : `${(missShare * 100).toFixed(0)}%`} (${forced.length} forced calls) - median TTFT miss ${missTtft}ms, clean ${cleanTtft}ms`);
    }
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
