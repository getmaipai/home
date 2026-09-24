// QUERY-WRITER-01b (dev.md, getmaipai-26's ruling, 2026-09-24): the
// query-writer's own recovery path (recoveredMissingCall()/
// runQueryWriter(), turnMachine/nodes/model.ts) only ever runs on a
// real required-call miss, which ENGINE-CONTRACT-02 measured as
// genuinely rare and engine-dependent (0/5 to 8/10 by temp/cache state
// alone) - too unreliable to exercise the path itself from a live
// bench (query-writer-01-live.ts's own header explains why it repeats
// the scenario rather than forcing a miss). MAIPAI_BENCH_FORCE_REQUIRED_
// MISS=1 (model.ts, this same date) forces every forced turn into that
// branch regardless of what the model actually returned, so this bench
// drives the recovery deterministically instead of hoping for a natural
// miss. Isolated hub throughout: its own temp data dir, the resident
// 8B via URL (never spawned), the fake SearXNG (conversationRunner.ts's
// own fixture server) - no real search traffic, ever.
//
//   MAIPAI_LLAMA_SERVER_URL=http://127.0.0.1:8788 \
//   MAIPAI_EMBED_URL=http://127.0.0.1:8794 \
//   bun run backend/scripts/bench/query-writer-01b-live.ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { refuseIfGateRunning, waitForHubQuiet } from "./liveHubQuiet";

const REPS = Number(process.env.QUERY_WRITER_REPS ?? 5);
// Same roster-safe shape query-writer-01-live.ts already established.
const SUBJECT_TURN = "marlow took over hosting the late night show from the old host, riff";
const FOLLOWUP_TURN = "when did his show end";

async function main(): Promise<void> {
  refuseIfGateRunning("query-writer-01b-live");
  const ownDataDir = mkdtempSync(join(tmpdir(), "query-writer-01b-live-"));
  process.env.MAIPAI_DATA_DIR = ownDataDir;
  if (!process.env.MAIPAI_LLAMA_SERVER_URL) process.env.MAIPAI_LLAMA_SERVER_URL = "http://127.0.0.1:8788";
  if (!process.env.MAIPAI_EMBED_URL) process.env.MAIPAI_EMBED_URL = "http://127.0.0.1:8794";
  process.env.MAIPAI_BENCH_FORCE_REQUIRED_MISS = "1";

  const setup = await import("./setup");
  await setup.startBench();

  const { createBenchPeople, startFakeSearxng } = await import("./conversationRunner");
  const { setHouseholdSettingValue } = await import("@/lib/settings");
  const { runTurnNext } = await import("@/lib/turnMachine/turnNext");

  const searxng = startFakeSearxng();
  setHouseholdSettingValue("chat.model_id", "qwen3-8b-instruct-q4-k-m");
  setHouseholdSettingValue("turn.pipeline.next", true);
  setHouseholdSettingValue("search.searxng_url", searxng.url);

  console.log("\n## Run header\n");
  console.log(JSON.stringify({ date: new Date().toISOString(), chat: process.env.MAIPAI_LLAMA_SERVER_URL, searxng: "fake (isolated)", reps: REPS, forceRequiredMiss: true }, null, 2));

  let namedSubject = 0;
  let executed = 0;
  try {
    for (let rep = 0; rep < REPS; rep++) {
      await waitForHubQuiet(undefined, (msg) => console.log(msg.replace("live-hub-quiet", `query-writer-01b-live rep ${rep}`)));
      const beforeCount = searxng.queries.length;
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
      const query = searxng.queries[searxng.queries.length - 1];
      const gotNewQuery = searxng.queries.length > beforeCount && query !== undefined;
      const resolvedSubject = gotNewQuery && /marlow|riff/i.test(query) && query.trim().toLowerCase() !== FOLLOWUP_TURN.toLowerCase();
      if (resolvedSubject) namedSubject++;
      console.log(`  rep ${rep}: search_query=${JSON.stringify(query ?? null)} names_subject=${resolvedSubject}`);
    }
  } finally {
    searxng.stop();
    rmSync(ownDataDir, { recursive: true, force: true });
  }

  console.log(`\nnamed the resolved subject (not the bare pronoun): ${namedSubject}/${executed}`);
  console.log(`\nbench finished: executed ${executed} cases; data directory ${ownDataDir} (disposable)`);
  if (executed === 0) process.exit(1);
}

if (import.meta.main) {
  await main();
}
