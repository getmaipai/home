// SEARCH-MIXED-01 (dev.md, getmaipai-26's ruling, 2026-09-24): the
// item's own live acceptance - measure on the real 8B, a fake SearXNG
// that always fails, whether an ordinary offered round that calls two
// tools together phrases the succeeded one and states the outage,
// never answering the failed search's own question from its own
// knowledge. Unlike query-writer-01-live.ts's own forced-round measure
// (a real forced call always reaches the real engine by design), this
// bench also can't force the model to call websearch at all - an
// offered call is the model's own choice - so it reports, per rep,
// whether the model called websearch alongside the other tool at all,
// and only judges the outage-line/no-hallucinated-answer behavior on
// the reps where it did. A fake SearXNG that fails EVERY query
// (never conditioned on the model's own wording, which paraphrases and
// can't be scripted) is what makes the failure itself deterministic
// once the model does call it.
//
//   MAIPAI_LLAMA_SERVER_URL=http://127.0.0.1:8788 \
//   MAIPAI_EMBED_URL=http://127.0.0.1:8794 \
//   bun run backend/scripts/bench/search-mixed-01-live.ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { refuseIfGateRunning, waitForHubQuiet } from "./liveHubQuiet";

const REPS = Number(process.env.SEARCH_MIXED_REPS ?? 5);
// Roster-safe, never the real household's own words: a turn that
// genuinely needs two different tools together (today's date, a real
// person's current show) is the natural shape a mixed round comes from
// - the almanac-date half is a giveaway if the model answers it from
// its own knowledge instead of calling the tool, so the reply is also
// checked for that.
const TURN = process.env.SEARCH_MIXED_TURN ?? "what's today's date? also, please search the web for what movies are playing this weekend";

/** Always fails, whatever the model's own search expression says - a
 * fixed, safe "search_unavailable" outcome the same shape
 * conversationRunner.ts's own startFakeSearxng() gives its own
 * "unresponsive engines fixture" magic query, except unconditional:
 * a real model paraphrases its own search query, so nothing here can
 * script the exact wording the way a stub-driven test can. */
function startAlwaysFailingSearxng(): { url: string; queries: string[]; stop: () => void } {
  const queries: string[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname !== "/search") return new Response("not found", { status: 404 });
      queries.push(url.searchParams.get("q") ?? "");
      return Response.json({
        query: url.searchParams.get("q") ?? "",
        results: [],
        unresponsive_engines: [
          ["brave", "Suspended: too many requests"],
          ["google cse", "Suspended: too many requests"],
          ["startpage", "Suspended: CAPTCHA"],
        ],
      });
    },
  });
  return { url: `http://127.0.0.1:${server.port}`, queries, stop: () => server.stop(true) };
}

async function main(): Promise<void> {
  refuseIfGateRunning("search-mixed-01-live");
  const ownDataDir = mkdtempSync(join(tmpdir(), "search-mixed-01-live-"));
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

  const searxng = startAlwaysFailingSearxng();
  setHouseholdSettingValue("chat.model_id", "qwen3-8b-instruct-q4-k-m");
  setHouseholdSettingValue("turn.pipeline.next", true);
  setHouseholdSettingValue("search.searxng_url", searxng.url);

  console.log("\n## Run header\n");
  console.log(JSON.stringify({ date: new Date().toISOString(), chat: process.env.MAIPAI_LLAMA_SERVER_URL, reps: REPS, turn: TURN }, null, 2));

  let calledBoth = 0;
  let executed = 0;
  let statedOutage = 0;
  try {
    for (let rep = 0; rep < REPS; rep++) {
      await waitForHubQuiet(undefined, (msg) => console.log(msg.replace("live-hub-quiet", `search-mixed-01-live rep ${rep}`)));
      const people = createBenchPeople();
      const result = await runTurnNext(people.owner, "chat", TURN);
      if (!result.ok || result.kind !== "immediate") {
        console.error(`  rep ${rep}: turn failed: ${JSON.stringify(result)}`);
        continue;
      }
      executed++;
      const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, result.value.turn_id)).get();
      const outcomes = row?.outcomes ? (JSON.parse(row.outcomes as unknown as string) as { packageId: string; status: string; errorCode?: string }[]) : [];
      const websearchOutcome = outcomes.find((o) => o.packageId === "websearch");
      const dateOutcome = outcomes.find((o) => o.packageId === "almanac-date");
      const bothCalled = websearchOutcome !== undefined && dateOutcome !== undefined;
      if (bothCalled) calledBoth++;
      const text = result.value.reply.text;
      const outageStated = text.includes("Search isn't working right now.");
      if (outageStated) statedOutage++;
      // No reliable automated test for "the model invented a specific-
      // sounding answer to the failed search's own question" - a fixed
      // regex tuned to one turn's own wording (the first cut of this
      // bench had one, "late night|show|host", and it silently read
      // zero on every rep once the turn text changed). The outage line
      // being present is checked here; whether the text ALSO carries a
      // real or fake answer to the search question is a judgment call
      // on the printed reply itself, read by whoever runs this - see
      // dev.md's own SEARCH-MIXED-01 entry for the read of one real run
      // (2026-09-24: 1/5 reps invented specific-sounding placeholder
      // movie/theater names despite never being shown a real result).
      console.log(`  rep ${rep}: called_both=${bothCalled} websearch_status=${websearchOutcome?.status ?? "not_called"} outage_stated=${outageStated} reply=${JSON.stringify(text)}`);
    }
  } finally {
    searxng.stop();
    rmSync(ownDataDir, { recursive: true, force: true });
  }

  console.log(`\ncalled both tools together: ${calledBoth}/${executed}; of those, stated the outage: ${statedOutage}/${calledBoth || 0}`);
  if (calledBoth === 0) {
    console.log("no rep called both tools together in this run - the model's own choice to call websearch at all is out of this item's own scope; the scripted test (turnNext.test.ts's own SEARCH-MIXED-01 describe block) is the deterministic proof of the fix itself.");
  } else if (statedOutage === calledBoth) {
    console.log("every real mixed round stated the outage line. Read each printed reply above for the separate, real question this bench can't automate: whether the model ALSO invented a specific-sounding answer to the failed search's own question anyway.");
  } else {
    console.log("VERDICT: at least one real mixed round did not state the outage line at all - a real finding, not swept under a passing exit code.");
  }
  console.log(`\nbench finished: executed ${executed} cases; data directory ${ownDataDir} (disposable)`);
  if (executed === 0) process.exit(1);
}

if (import.meta.main) {
  await main();
}
