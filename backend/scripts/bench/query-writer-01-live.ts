// QUERY-WRITER-01 (dev.md, getmaipai-26's ruling, 2026-09-24): the
// item's own live acceptance - "a replay row with roster names only,
// following the same shape (a person-subject turn, then a pronoun
// follow-up), whose searched expression contains the subject's name,
// with the miss path forced." A forced (tool_choice: "required") call
// always reaches the real engine (recordingProxy.ts's own
// scriptNextReply() never intercepts one, by design - ENGINE-CONTRACT-01/
// 02 exist specifically to measure the real model's own miss rate, not
// a scripted one), so this repeats the scenario rather than forcing a
// miss artificially: the one real conversation that found this bug
// missed 3 of 4 forced turns of exactly this shape, a rate high enough
// that a real miss is the expected, not the rare, outcome here.
// Reports, per rep, whether the forced round missed and, when it did,
// whether the query-writer's own recovery searched the resolved
// subject's name rather than the bare pronoun.
//
//   MAIPAI_LLAMA_SERVER_URL=http://127.0.0.1:8788 \
//   MAIPAI_EMBED_URL=http://127.0.0.1:8794 \
//   MAIPAI_SEARXNG_URL=<the household's own live SearXNG URL> \
//   bun run backend/scripts/bench/query-writer-01-live.ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { refuseIfGateRunning, refuseRealSearxngWithoutClearance, waitForHubQuiet } from "./liveHubQuiet";

const REPS = Number(process.env.QUERY_WRITER_REPS ?? 5);
// Roster-safe throughout (never the real household's own words):
// establishes the subject, then a pronoun follow-up in the shape the
// live incident found - "a follow-up question with a pronoun ... after
// a turn naming a person." A first attempt with one, unambiguous
// subject never missed in 5/5 real reps (the model resolved the
// pronoun into its own forced call every time) - the real incident's
// own report named a SECOND host as what the search actually returned,
// so a second candidate name is added here, closer to that ambiguity,
// rather than tuning further on a single-subject shape that already
// isn't representative of the real miss.
const SUBJECT_TURN = "marlow took over hosting the late night show from the old host, riff";
const FOLLOWUP_TURN = "when did his show end";

async function main(): Promise<void> {
  refuseIfGateRunning("query-writer-01-live");
  const searxngUrl = process.env.MAIPAI_SEARXNG_URL;
  if (!searxngUrl) {
    console.error("query-writer-01-live refused: MAIPAI_SEARXNG_URL is not set - this bench measures a real forced-search miss and its recovery against the household's own live search backend, never a fixture.");
    process.exit(2);
  }
  // SEARCH-HEALTH-01: this script's own 2026-09-24 run sent 25 real
  // queries to the household's SearXNG - exactly the traffic that got
  // it rate-limited that same night. Never runs against the real
  // instance again without the coordinator's own explicit clearance.
  refuseRealSearxngWithoutClearance("query-writer-01-live", searxngUrl);
  const ownDataDir = mkdtempSync(join(tmpdir(), "query-writer-01-live-"));
  process.env.MAIPAI_DATA_DIR = ownDataDir;
  if (!process.env.MAIPAI_LLAMA_SERVER_URL) process.env.MAIPAI_LLAMA_SERVER_URL = "http://127.0.0.1:8788";
  if (!process.env.MAIPAI_EMBED_URL) process.env.MAIPAI_EMBED_URL = "http://127.0.0.1:8794";

  const setup = await import("./setup");
  await setup.startBench();

  const { createBenchPeople } = await import("./conversationRunner");
  const { setHouseholdSettingValue } = await import("@/lib/settings");
  const { runTurnNext } = await import("@/lib/turnMachine/turnNext");
  const { db } = await import("@/db");
  const { conversationTurns } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");

  setHouseholdSettingValue("chat.model_id", "qwen3-8b-instruct-q4-k-m");
  setHouseholdSettingValue("turn.pipeline.next", true);
  setHouseholdSettingValue("search.searxng_url", searxngUrl);

  console.log("\n## Run header\n");
  console.log(JSON.stringify({ date: new Date().toISOString(), chat: process.env.MAIPAI_LLAMA_SERVER_URL, reps: REPS }, null, 2));

  let missed = 0;
  let recoveredWithSubject = 0;
  let executed = 0;
  try {
    for (let rep = 0; rep < REPS; rep++) {
      await waitForHubQuiet(undefined, (msg) => console.log(msg.replace("live-hub-quiet", `query-writer-01-live rep ${rep}`)));
      const people = createBenchPeople();
      const first = await runTurnNext(people.owner, "chat", SUBJECT_TURN);
      if (!first.ok || first.kind !== "immediate") {
        console.error(`  rep ${rep}: turn 1 failed: ${JSON.stringify(first)}`);
        continue;
      }
      const second = await runTurnNext(people.owner, "chat", FOLLOWUP_TURN, { conversationId: first.value.conversation_id });
      if (!second.ok || second.kind !== "immediate") {
        console.error(`  rep ${rep}: turn 2 failed: ${JSON.stringify(second)}`);
        continue;
      }
      executed++;
      const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, second.value.turn_id)).get();
      const stats = row?.stats ? (JSON.parse(row.stats as unknown as string) as { nodes?: { node: string; outcome?: { ok?: boolean; required_miss?: boolean } }[] }) : { nodes: [] };
      const modelOutcome = (stats.nodes ?? []).find((n) => n.node === "model")?.outcome;
      const outcomes = row?.outcomes ? (JSON.parse(row.outcomes as unknown as string) as { callId: string; args?: Record<string, unknown> }[]) : [];
      const websearchOutcome = outcomes.find((o) => o.args && "expression" in o.args);
      const missedThisRep = modelOutcome?.required_miss === true;
      if (missedThisRep) missed++;
      const expression = typeof websearchOutcome?.args?.expression === "string" ? websearchOutcome.args.expression : null;
      // Either named subject counts: QUERY-WRITER-01 is about recovering a
      // groundable name instead of a bare pronoun, not about which of the
      // two candidates is the "right" antecedent (a separate co-reference
      // accuracy question, out of scope here).
      const resolvedSubject = expression !== null && /marlow|riff/i.test(expression) && expression.trim().toLowerCase() !== FOLLOWUP_TURN.toLowerCase();
      if (missedThisRep && resolvedSubject) recoveredWithSubject++;
      console.log(`  rep ${rep}: required_miss=${missedThisRep} search_expression=${JSON.stringify(expression)} builder_call_id=${websearchOutcome?.callId ?? "n/a"}`);
    }
  } finally {
    rmSync(ownDataDir, { recursive: true, force: true });
  }

  console.log(`\nmisses: ${missed}/${executed}; of those, recovered with the resolved subject's own name: ${recoveredWithSubject}/${missed || 0}`);
  if (missed === 0) {
    console.log("no natural miss observed in this run - the scripted tests (turnNext.test.ts's own QUERY-WRITER-01 describe block) are the deterministic proof of the recovery mechanism; this live run only ever adds real-world confirmation when a miss actually happens to occur.");
  } else if (recoveredWithSubject === missed) {
    console.log("VERDICT: every real miss recovered with the resolved subject's own name, never the bare pronoun.");
  } else {
    console.log("VERDICT: at least one real miss did NOT recover with the resolved subject's own name - a real finding, not swept under a passing exit code.");
  }
  console.log(`\nbench finished: executed ${executed} cases; data directory ${ownDataDir} (disposable)`);
  if (executed === 0) process.exit(1);
}

if (import.meta.main) {
  await main();
}
