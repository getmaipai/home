// RESEARCH-TIER-01: the real-web research eval. Runs one question as Instant, Thinking and Max against the Stack's chat model
// (no Max lease swap: a stand-in lease only marks the turn as Max, so the family's chat is not touched) and the household's
// SearXNG, then scores each answer with researchEval.ts and prints the queries, the answer, the sources, the time and the rounds.
//
//   MAIPAI_BENCH_PASS=route MAIPAI_BENCH_REAL_SEARXNG_CLEARED=1 MAIPAI_STACK_URL=http://127.0.0.1:8770 RESEARCH_SEARXNG_URL=<household SearXNG> \
//     bun run backend/scripts/bench/researchLive.ts [case-id] [instant|thinking|max ...]
//
// The SearXNG address is read from the environment and never printed. A throwaway data directory is used and removed.
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ResearchCase } from "./researchEval";

const caseId = process.argv[2] && !["instant", "thinking", "max"].includes(process.argv[2]) ? process.argv[2] : "v-series";
const styles = (process.argv.slice(2).filter((a) => ["instant", "thinking", "max"].includes(a)) as ("instant" | "thinking" | "max")[]);
const wanted = styles.length > 0 ? styles : (["instant", "thinking", "max"] as const);
const searxng = process.env.RESEARCH_SEARXNG_URL;
if (!searxng || !process.env.MAIPAI_STACK_URL) {
  console.error("researchLive refused: set MAIPAI_STACK_URL and RESEARCH_SEARXNG_URL.");
  process.exit(2);
}
const { refuseRealSearxngWithoutClearance } = await import("./liveHubQuiet");
refuseRealSearxngWithoutClearance("researchLive", searxng);
const redact = (text: string): string => text.split(searxng).join("<household search>");
const dataDir = mkdtempSync(join(tmpdir(), "research-live-"));
process.env.MAIPAI_DATA_DIR = dataDir;

try {
  const research = JSON.parse(readFileSync(new URL(`./research-cases/${caseId}.json`, import.meta.url), "utf8")) as ResearchCase;
  const { startBench, finishBench } = await import("./setup");
  const runner = await import("./conversationRunner");
  await startBench();
  const { setHouseholdSettingValue } = await import("@/lib/settings");
  setHouseholdSettingValue("engines.stack.url", process.env.MAIPAI_STACK_URL!);
  setHouseholdSettingValue("search.searxng_url", searxng);
  setHouseholdSettingValue("search.web_sources", ["searxng"]);
  const { runTurnNext } = await import("@/lib/turnMachine/turnNext");
  const { createChatLease, registerActiveChatLease } = await import("@/lib/chatLease");
  const { db } = await import("@/db");
  const { conversationTurns } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const { judgeResearchAnswer } = await import("./researchEval");
  const people = runner.createBenchPeople();
  for (const style of wanted) {
    registerActiveChatLease(null);
    if (style === "max") {
      const lease = createChatLease({ now: Date.now, swapToBig: async () => {}, swapToStandard: async () => {}, ready: async () => true });
      registerActiveChatLease(lease);
      await lease.acquire(people.owner!);
    }
    const started = Date.now();
    const result = await runTurnNext(people.owner!, "chat", research.utterance, { thinking: style !== "instant", max: style === "max" });
    const ms = Date.now() - started;
    if (!result.ok || result.kind !== "immediate") { console.log(redact(JSON.stringify({ style, error: "no result", detail: JSON.stringify(result).slice(0, 400) }))); continue; }
    const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, result.value.turn_id)).get();
    const outcomes = row?.outcomes ? (JSON.parse(row.outcomes) as { packageId: string; status: string; args?: { expression?: string; scope?: string }; result?: { data?: { rows?: unknown[] } } }[]) : [];
    const searches = outcomes.filter((o) => o.packageId === "websearch");
    const sources = (result.value.sources ?? []).map((s) => ({ site: s.site, title: s.title?.slice(0, 80) }));
    const verdict = judgeResearchAnswer(research, { answer: result.value.reply.text, sources: (result.value.sources ?? []).map((s) => ({ site: s.site, url: s.url })), queries: searches.map((o) => o.args?.expression ?? "") });
    console.log(redact(JSON.stringify({ style, seconds: Math.round(ms / 100) / 10, rounds: searches.length, queries: searches.map((o) => `${o.args?.expression ?? ""} [scope ${o.args?.scope ?? "unset"}, ${o.status}, ${o.result?.data?.rows?.length ?? 0} rows]`), sources, answer: result.value.reply.text, verdict }, null, 2)));
  }
  registerActiveChatLease(null);
  runner.cleanupBenchPeople(people);
  finishBench({ executed: wanted.length, engine: "chat on the Stack" });
} finally {
  rmSync(dataDir, { recursive: true, force: true });
}
