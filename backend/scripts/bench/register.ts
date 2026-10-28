// NAT-01 register bench: about 30 rows, one per spoken-register mechanic
// (clock, hedge, evidential, reask, price, date, opinion, news), each run
// through the real turn engine (conversationRunner.ts's runConversation,
// the same path the conversation bench uses) with its evidence seeded the
// way a turn really gets it, scored by regex (registerScore.ts). Design:
// docs/design/natural-speech-register-2026-10-27.md section 3.2.
//
// How evidence reaches the model, per mechanic (two test-only seams in
// backend/src/lib/benchSampling.ts, inert unless this bench sets them):
//   clock, date, reask  the pinned prompt clock (__setPromptClockForBench).
//                       It sets both the almanac packages' clock and the
//                       "Today is ..." line the model sees (context.ts).
//   hedge, price        a typed package outcome (__setSeededOutcomesForBench,
//                       read by runPlugin). The bench also scripts the tool
//                       call through the recording proxy, so the model
//                       composes from the outcome every run, never by its
//                       own choice of tool. Hedge rows seed weather; price
//                       rows seed websearch (a lookup that returns a price).
//   opening             (NAT-07a) a dated person-scope record whose end date has
//                       passed (archived by the hub's own maintenance), an earlier
//                       conversation backdated by days, and a greeting or a task
//                       opener as the first turn of the next one. The child and
//                       Incognito rows must never be asked about the thread.
//   news                the same scripted websearch call against a recorded
//                       search result behind search.searxng_url.
//   clock-with-bus,
//   evidential, opinion an ordinary household memory record the turn recalls
//                       (not a pinned profile line, which never surfaces as
//                       a recalled record). Recall needs an embedder that
//                       tells texts apart; a constant-vector stub returns
//                       nothing and those rows report "raw 0/N in context".
// Each row also asserts what the model actually received (the recording
// proxy keeps the system messages and last user message): "raw" counts the
// seeded values present as the tools hand them over today; "shaped" asks
// whether the spoken form NAT-02 to NAT-04 will add is there. Rows are
// expected to fail or stay shaped=no today; that is the point.
//
// Against the in-process stub every reply is an echo, so every row reports
// "ambiguous" (see naturalness.ts); the bench says so and exits 0. Rule 6a:
// only counts, row ids and pattern ids print, never a household reply.
//
// Usage: MAIPAI_DATA_DIR=<fresh dir under tmp> MAIPAI_LLAMA_SERVER_URL=...
//        MAIPAI_EMBED_URL=... bun run scripts/bench/register.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { startRecordingProxy } from "./recordingProxy";
import { sanitizeEngineUrl } from "@/lib/engineIdentity";
import { MECHANICS, checkEvidence, receivedByModel, scoreHedgePair, scoreRegisterReply, type Mechanic, type RegisterRow, type Verdict } from "./registerScore";

const upstream = process.env.MAIPAI_LLAMA_SERVER_URL;
if (!upstream) {
  console.error("bench setup refused: MAIPAI_LLAMA_SERVER_URL is not set; the register bench connects only to an engine already running.");
  process.exit(2);
}
const proxy = startRecordingProxy(upstream);
process.env.MAIPAI_LLAMA_SERVER_URL = proxy.url;
// setup.ts must load before anything reaches "@/db" (CHAT-22).
const { finishBench, startBench } = await import("./setup");
const runner = await import("./conversationRunner");
const { startFixtureSearch } = await import("./fixtureSearch");
const { getPersonSettingValue, setHouseholdSettingValue, setValue } = await import("@/lib/settings");
const { getEngineStatus } = await import("@/lib/llmSupervisor");
const { __setPromptClockForBench, __setSeededOutcomesForBench } = await import("@/lib/benchSampling");

const corpus = JSON.parse(readFileSync(join(import.meta.dir, "datasets", "register-corpus.json"), "utf8")) as RegisterRow[];

interface Tally { pass: number; fail: number; ambiguous: number; rawOk: number; rawRows: number; shapedYes: number; shapedRows: number; delivered: number }
const tallies = new Map<Mechanic, Tally>();
const tallyOf = (m: Mechanic) => {
  let t = tallies.get(m);
  if (!t) tallies.set(m, (t = { pass: 0, fail: 0, ambiguous: 0, rawOk: 0, rawRows: 0, shapedYes: 0, shapedRows: 0, delivered: 0 }));
  return t;
};
const count = (t: Tally, v: Verdict) => void (t[v]++);

async function main(): Promise<number> {
  await startBench();
  // Home sends chat through engines.stack.url, which startBench points at the
  // embed or background engine; pointing it at the recording proxy puts the
  // chat requests (and so "what the model received") where this bench can read
  // them. The proxy forwards to the chat engine the caller named.
  const pointed = setHouseholdSettingValue("engines.stack.url", proxy.url);
  if (!pointed.ok) throw new Error(`could not route chat through the recording proxy: ${pointed.error}`);
  const searchFixtures = corpus.filter((r) => r.search).map((r) => ({ id: r.id, prompt: r.search!.prompt, fixture: { as_of: r.search!.as_of, title: r.search!.title, content: r.search!.content } }));
  const search = startFixtureSearch(searchFixtures);
  const set = setHouseholdSettingValue("search.searxng_url", search.url);
  if (!set.ok) throw new Error(`could not point search at the fixture: ${set.error}`);
  const log = runner.captureTurnLog();
  const people = runner.createBenchPeople();
  console.log(`Chat backend: ${getEngineStatus().kind} at ${sanitizeEngineUrl(upstream)}`);
  console.log(`Register rows: ${corpus.length}. Against the in-process stub every row is "ambiguous" by design (it echoes the question).\n`);
  const replies = new Map<string, string>();
  let executed = 0;
  try {
    for (const row of corpus) {
      let turnNo = 0;
      const clocks = row.clocks ?? [];
      const queriesBefore = search.queries.length;
      // NAT-08: a companion row runs as that bundled companion, then the person's own choice is put back.
      const priorCompanion = getPersonSettingValue(people.owner, "persona.active_id");
      if (row.companion) {
        const picked = setValue(people.owner, `person:${people.owner.id}`, "persona.active_id", row.companion);
        if (!picked.ok) throw new Error(`could not set the companion ${row.companion}: ${picked.error}`);
      }
      const run = await runner.runConversation({
        id: `register-${row.id}`,
        category: "knowledge",
        surface: row.surface ?? "chat",
        seedRecords: [
          ...(row.seed ?? []).map((text) => ({ text, category: "fact", scope: "household" as const })),
          ...(row.datedSeed ?? []).map((d) => ({ text: d.text, category: d.category, scope: "person" as const, validToDaysAgo: d.validToDaysAgo, forChild: d.forChild })),
        ],
        turns: row.utterances.map((say, i) => ({ say, ...(row.turns?.[i] ?? {}), expect: {} })),
      }, {
        people, proxy, log,
        drainJudge: async () => {},
        backdate: (days, turnIds) => runner.backdateBenchRows(people, days, turnIds),
        homeAssistant: null,
        beforeTurn: async () => {
          const clock = clocks[Math.min(turnNo, clocks.length - 1)];
          __setPromptClockForBench(clock ? () => new Date(clock) : null);
          // The scripted call: a typed outcome row proposes its package, a news row its search.
          if (row.outcome) {
            __setSeededOutcomesForBench({ [row.outcome.package]: row.outcome.result });
            proxy.scriptNextToolCall(row.outcome.package, row.outcome.args);
          } else if (row.search) {
            proxy.scriptNextToolCall("websearch", { expression: row.search.prompt });
          }
          turnNo++;
        },
      }).catch((err: Error) => {
        console.error(`[bench] ${row.id} threw: ${err.message}`);
        return { scores: [], turnIds: [] as string[] };
      });
      __setPromptClockForBench(null);
      __setSeededOutcomesForBench(null);
      if (row.companion) setValue(people.owner, `person:${people.owner.id}`, "persona.active_id", priorCompanion ?? "default");
      executed += run.scores.length;
      const first = run.scores[0]?.observed.reply;
      const last = run.scores[run.scores.length - 1]?.observed;
      const reply = last?.reply ?? "";
      replies.set(row.id, reply);
      const t = tallyOf(row.mechanic);
      const score = scoreRegisterReply(row, reply, row.utterances.length > 1 ? first : undefined);
      count(t, score.verdict);
      if (score.verdict === "fail") console.log(`FAIL ${row.id} matched=${score.matchedPattern}`);
      // What the model received on the scored turn. The user's own words are
      // cut out first so a seeded value that only the utterance contains
      // cannot count as delivered.
      const plugin = (last as { pluginId?: string | null } | undefined)?.pluginId ?? null;
      const received = receivedByModel(proxy.requests);
      const toolRan = proxy.requests.some((r) => r.toolText !== "");
      // A tool-outcome row is judged on the tool message itself: the system text has its own
      // hedge words, and a shaped form that only the prompt carries must not count.
      const toolMessages = proxy.requests.map((r) => r.toolText).filter(Boolean).join("\n");
      const ev = checkEvidence(row.evidence, plugin && proxy.requests.length === 0 ? reply : row.outcome || row.search ? toolMessages || null : received);
      const searched = row.search ? search.queries.slice(queriesBefore).some((q) => q.rows > 0 && q.fixtureId === row.id) : null;
      t.rawRows++;
      if (searched === true || (searched === null && ev.rawFound === ev.rawTotal)) t.rawOk++;
      if (searched === true) t.delivered++;
      if (ev.shaped !== null) { t.shapedRows++; if (ev.shaped) t.shapedYes++; }
      let delivery: string;
      if (searched !== null) delivery = `lookup ${searched ? "returned the recorded result" : "not run"}; raw ${ev.rawFound}/${ev.rawTotal} in what the model received`;
      else if (row.outcome) delivery = `${row.outcome.package} outcome ${toolRan ? "reached the model" : "not delivered (no tool message)"}; raw ${ev.rawFound}/${ev.rawTotal} in what the model received`;
      else if (plugin) delivery = `answered by package ${plugin}, no model call; raw ${ev.rawFound}/${ev.rawTotal} in its reply`;
      else if (received === null) delivery = "no model call, nothing received";
      else delivery = `raw ${ev.rawFound}/${ev.rawTotal} in context`;
      console.log(`EVIDENCE ${row.id}: ${delivery}; shaped form ${ev.shaped === null ? "n/a (exact or no shaping)" : ev.shaped ? "yes" : "no"}`);
    }
    // 30% against 90%: the same hedge word at both ends fails.
    const lo = replies.get("hedge_scale_30");
    const hi = replies.get("hedge_scale_90");
    if (lo !== undefined && hi !== undefined) {
      const pair = scoreHedgePair(lo, hi);
      count(tallyOf("hedge"), pair.verdict);
      if (pair.verdict === "fail") console.log(`FAIL hedge_scales_pair matched=${pair.matchedPattern}`);
    }
  } finally {
    log.stop();
    search.stop();
  }
  console.log("\nmechanic     rows  pass  fail  ambiguous  raw-evidence-ok  shaped-yes");
  for (const mechanic of MECHANICS) {
    const t = tallyOf(mechanic);
    const rows = corpus.filter((r) => r.mechanic === mechanic).length;
    console.log(`${mechanic.padEnd(12)} ${String(rows).padStart(4)}  ${String(t.pass).padStart(4)}  ${String(t.fail).padStart(4)}  ${String(t.ambiguous).padStart(9)}  ${`${t.rawOk}/${t.rawRows}`.padStart(15)}  ${`${t.shapedYes}/${t.shapedRows}`.padStart(10)}`);
  }
  console.log("(hedge also counts the 30%-versus-90% pair as one extra scored check)");
  console.log("Memory rows (clock-with-bus, evidential, opinion) need an embedder that separates texts. A baseline needs a real engine.");
  runner.cleanupBenchPeople(people);
  return executed;
}

let executed = 0;
try {
  executed = await main();
} finally {
  proxy.stop();
}
finishBench({ executed, engine: `register chat ${getEngineStatus().kind} at ${sanitizeEngineUrl(upstream)}` });
