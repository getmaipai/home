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
  // A case file holds one case, or a held-out set ({ "cases": [...] }) that runs one case after another, paced.
  const loaded = JSON.parse(readFileSync(new URL(`./research-cases/${caseId}.json`, import.meta.url), "utf8")) as ResearchCase | { cases: ResearchCase[] };
  const researchCases: ResearchCase[] = "cases" in loaded ? loaded.cases : [loaded];
  const onlyCase = process.env.RESEARCH_ONLY;
  const runCases = onlyCase ? researchCases.filter((c) => c.id === onlyCase) : researchCases;
  const paceMs = Number(process.env.RESEARCH_PACE_SECONDS ?? (runCases.length > 1 ? 20 : 0)) * 1000;
  const summary: { id: string; type: string; style: string; seconds: number; pass: boolean; failures: string[]; writeStartSeconds: number }[] = [];
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
  const { judgeResearch } = await import("./researchEval");
  const { researchEvidence, __setResearchMarkSinkForTests, __setResearchTextSinkForTests } = await import("@/lib/turnMachine/research");
  // RESEARCH-CLOCK-01: the time-line of each turn (milliseconds since it began, labels only), printed with the result.
  let marks: string[] = [];
  __setResearchMarkSinkForTests((_turnId, at, what) => { marks.push(`${(at / 1000).toFixed(1)}s ${what}`); });
  // The backbone article and the notes ledger the writer saw count as evidence for the fabrication check.
  let writerTexts: string[] = [];
  __setResearchTextSinkForTests((_turnId, _label, text) => { writerTexts.push(text); });
  // The credit judge is one plain, non-thinking call to the Stack's chat model per sentence that names a watched person.
  const judge = async (prompt: string): Promise<string> => {
    const response = await fetch(`${process.env.MAIPAI_STACK_URL}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "chat", messages: [{ role: "user", content: prompt }], max_tokens: 120, temperature: 0 }) });
    const body = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    return body.choices?.[0]?.message?.content ?? "";
  };
  const people = runner.createBenchPeople();
  for (const research of runCases) for (const style of wanted) {
    registerActiveChatLease(null);
    if (paceMs > 0 && summary.length > 0) await new Promise((resolve) => setTimeout(resolve, paceMs));
    if (style === "max") {
      const lease = createChatLease({ now: Date.now, swapToBig: async () => {}, swapToStandard: async () => {}, ready: async () => true });
      registerActiveChatLease(lease);
      await lease.acquire(people.owner!);
    }
    marks = [];
    writerTexts = [];
    const started = Date.now();
    const result = await runTurnNext(people.owner!, "chat", research.utterance, { thinking: style !== "instant", max: style === "max" });
    const ms = Date.now() - started;
    if (!result.ok || result.kind !== "immediate") { console.log(redact(JSON.stringify({ style, error: "no result", detail: JSON.stringify(result).slice(0, 400) }))); continue; }
    const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, result.value.turn_id)).get();
    const outcomes = row?.outcomes ? (JSON.parse(row.outcomes) as { packageId: string; status: string; args?: { expression?: string; scope?: string }; result?: { data?: { rows?: unknown[] } } }[]) : [];
    const searches = outcomes.filter((o) => o.packageId === "websearch");
    const sources = (result.value.sources ?? []).map((s) => ({ site: s.site, title: s.title?.slice(0, 80) }));
    const evidence = researchEvidence(outcomes as unknown as Parameters<typeof researchEvidence>[0]);
    // Pages read and the light model's seconds, from the turn's own time-line marks and outcomes (RESEARCH-EVAL-02).
    const pagesRead = outcomes.reduce((n, o) => n + (((o.result?.data as { pages?: unknown[] } | undefined)?.pages?.length) ?? 0), 0);
    const lightModelSeconds = Number(marks.map((m) => m.match(/\(([\d.]+) s of light-model time\)/)?.[1]).find(Boolean) ?? 0);
    // The notes the writer saw and the article it was given count as evidence for the fabrication check.
    const verdict = await judgeResearch(research, { answer: result.value.reply.text, sources: (result.value.sources ?? []).map((s) => ({ site: s.site, url: s.url })), queries: searches.map((o) => o.args?.expression ?? ""), evidence: `${evidence}\n${writerTexts.join("\n")}`, pagesRead, lightModelSeconds }, judge);
    summary.push({ id: research.id, type: research.type ?? "", style, seconds: Math.round(ms / 100) / 10, pass: verdict.pass, failures: verdict.failures, writeStartSeconds: Math.round(Number(marks.map((m) => m.match(/^([\d.]+)s model start \(answers\)/)?.[1]).filter(Boolean).at(-1) ?? 0) * 10) / 10 });
    console.log(redact(JSON.stringify({ case: research.id, type: research.type ?? "", style, seconds: Math.round(ms / 100) / 10, rounds: searches.length, timeline: marks, queries: searches.map((o) => `${o.args?.expression ?? ""} [scope ${o.args?.scope ?? "unset"}, ${o.status}, ${o.result?.data?.rows?.length ?? 0} rows]`), sources, answer: result.value.reply.text, verdict }, null, 2)));
  }
  registerActiveChatLease(null);
  if (summary.length > 1) {
    // Pass rate and time per kind of subject and style (the held-out set).
    const groups = new Map<string, typeof summary>();
    for (const row of summary) groups.set(`${row.type || row.id} / ${row.style}`, [...(groups.get(`${row.type || row.id} / ${row.style}`) ?? []), row]);
    console.log(JSON.stringify({ summary: [...groups].map(([key, rows]) => ({ key, runs: rows.length, passed: rows.filter((r) => r.pass).length, meanSeconds: Math.round(rows.reduce((n, r) => n + r.seconds, 0) / rows.length * 10) / 10, failures: rows.flatMap((r) => r.failures).slice(0, 4) })) }, null, 2));
  }
  runner.cleanupBenchPeople(people);
  finishBench({ executed: wanted.length, engine: "chat on the Stack" });
} finally {
  rmSync(dataDir, { recursive: true, force: true });
}
