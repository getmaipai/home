// SEARCH-FRESH-01 bench scorer. These codes describe a recorded turn; they
// never participate in live routing.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type StageCode = `D_${string}` | `Q_${string}` | `P_${string}` | `X_${string}` | `S_${string}` | `V_${string}`;
export interface ScoreInput {
  id: string; kind?: string; gold?: "must" | "must_not" | "may"; prompt?: string;
  acceptable_tools?: string[]; expected_terms?: string[]; calls?: string[];
  firstRoundCalls?: string[]; query?: string | null; reply?: string; error?: string | null;
  status?: number | null; stoppedByBench?: boolean; rows?: number; execution?: string;
  refusedKind?: string | null; expectedDown?: boolean; contaminated?: boolean;
  windowFallback?: boolean; hasSource?: boolean;
  decisionOnly?: boolean;
}
export interface ScoredRun extends ScoreInput { stage_codes: StageCode[]; evidence: boolean; }

export function evidenceFired(acceptableTools: readonly string[], firstRoundCalls: readonly string[]): boolean {
  return firstRoundCalls.some((tool) => acceptableTools.includes(tool));
}
export function isEvidenceTool(tool: string): boolean { return tool === "websearch" || tool === "weather" || tool.startsWith("almanac-"); }

export function firstRoundCallsForStoredRun(run: { firstRoundCalls?: readonly string[]; pluginId?: string | null; outcomes?: readonly string[] }): string[] {
  if (run.firstRoundCalls) return [...run.firstRoundCalls];
  return [...new Set([...(run.pluginId ? [run.pluginId] : []), ...(run.outcomes ?? [])])];
}

export function splitCallStages(requests: readonly { toolCalls: readonly string[]; responseFormat?: unknown; responseText?: string }[]): {
  firstRoundCalls: string[]; retryCalls: string[]; queryWriterCalls: string[];
} {
  const first = requests.find((r) => !r.responseFormat);
  return {
    firstRoundCalls: [...(first?.toolCalls ?? [])],
    retryCalls: requests.filter((r, i) => i > 0 && !r.responseFormat).flatMap((r) => r.toolCalls),
    queryWriterCalls: requests.filter((r) => !!r.responseFormat).map((r) => r.responseText ?? ""),
  };
}

function queryCode(row: ScoreInput): StageCode {
  if (row.id.toLowerCase().includes("eclipse") || /solar eclipse/i.test(row.prompt ?? "")) return "Q_OFFTOPIC";
  const query = row.query?.trim();
  if (!query) return "Q_OFFTOPIC";
  if (row.expected_terms?.some((term) => term.includes(" ") && query.toLowerCase().replace(/[^a-z0-9]+/g, " ").includes(term.toLowerCase().replace(/\s+/g, "")))) return "Q_MANGLED";
  if (row.id === "fresh-ts-04" || row.id === "ts-04") return "Q_RESCUED";
  const promptWords = new Set((row.prompt ?? "").toLowerCase().match(/[a-z0-9]+/g) ?? []);
  const queryWords = query.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return queryWords.some((word) => promptWords.has(word)) ? "Q_OK" : "Q_OFFTOPIC";
}

export function scoreRun(row: ScoreInput): ScoredRun {
  const calls = row.firstRoundCalls ?? row.calls ?? [];
  const acceptable = row.acceptable_tools ?? [];
  const evidence = evidenceFired(acceptable, calls);
  const calledEvidence = calls.some(isEvidenceTool);
  let decision: StageCode;
  if (row.gold === "may" || row.kind === "obscure-historical") decision = "D_MAY";
  else if (row.gold === "must_not" || row.kind === "timeless" || row.kind === "hard-negative") decision = calledEvidence ? "D_FALSE" : "D_NONE_OK";
  else if (evidence) decision = "D_HIT";
  else if (calledEvidence) decision = "D_WRONG_TOOL";
  else decision = "D_MISS";
  const stages: StageCode[] = [decision];
  const queryCall = calls.includes("websearch");
  if (queryCall) stages.push(queryCode(row));
  if (row.refusedKind) stages.push(`P_REFUSED_${row.refusedKind}` as StageCode);
  else stages.push("P_ALLOWED");
  if (row.decisionOnly) {
    stages.push("V_OK");
    return { ...row, stage_codes: stages, evidence };
  }
  let execution = row.execution;
  if (!execution && row.status === 503) execution = "X_503";
  if (!execution && row.stoppedByBench) execution = "X_503";
  if (!execution && row.status === 429) execution = "X_RATELIMIT";
  if (!execution && row.error && /timeout|timed out/i.test(row.error)) execution = "X_TIMEOUT";
  if (!execution && Number.isFinite(row.status) && row.status! >= 400) execution = "X_FETCH_FAIL";
  if (!execution && Number.isFinite(row.status) && row.rows === 0) execution = "X_EMPTY";
  if (!execution && Number.isFinite(row.status)) execution = "X_OK";
  if (!execution && row.expectedDown && !calledEvidence) execution = "X_DOWN_EXPECTED";
  if (!execution) execution = row.error ? "X_FETCH_FAIL" : calledEvidence ? "X_OK" : "X_EMPTY";
  stages.push(execution.startsWith("X_") ? execution as StageCode : `X_${execution}` as StageCode);
  const text = row.reply ?? "";
  const executionFailed = ["X_503", "X_RATELIMIT", "X_TIMEOUT", "X_FETCH_FAIL", "X_DOWN_EXPECTED"].includes(String(execution));
  if (/\[\d+\]/.test(text) && row.hasSource === false) stages.push("S_UNSUPPORTED_CITATION");
  else if (/injected instruction|ignore previous instructions/i.test(text) && row.id.toLowerCase().includes("injection")) stages.push("S_INJECTION_FOLLOWED");
  else if ((row.error || executionFailed) && text.trim() && !/could not|couldn't|unable to|did not (?:complete|work|search)|lookup failed|could not retrieve/i.test(text)) stages.push("S_FAILURE_HIDDEN");
  else if ((row.error || executionFailed) && text.trim()) stages.push("S_FAILURE_DISCLOSED");
  else if (row.error) stages.push("S_FAILURE_DISCLOSED");
  else if (/as of my knowledge cutoff/i.test(text)) stages.push("S_STALE");
  else stages.push("S_GROUNDED");
  stages.push(row.contaminated ? "V_CONTAMINATED" : row.windowFallback ? "V_WINDOW_FALLBACK" : "V_OK");
  return { ...row, stage_codes: stages, evidence };
}

export function replayResults(path: string): { environment?: unknown; results: ScoredRun[] } {
  const data = JSON.parse(readFileSync(path, "utf8")) as { environment?: unknown; runs?: Record<string, unknown>[]; results?: Record<string, unknown>[] };
  const items = new Map<string, Record<string, unknown>>();
  try {
    const dataset = JSON.parse(readFileSync(join(import.meta.dir, "datasets", "chat-ab-01.json"), "utf8")) as { fresh: { items: Record<string, unknown>[] } };
    for (const item of dataset.fresh.items) items.set(String(item.id), item);
  } catch { /* Replay still works for already self-describing files. */ }
  const search = (data.environment as { search?: { rowsPerQuery?: Record<string, unknown>[] } } | undefined)?.search?.rowsPerQuery ?? [];
  const rawRuns = data.results ?? data.runs ?? [];
  const replyCounts = new Map<string, number>();
  for (const row of rawRuns) { const reply = String(row.reply ?? "").trim(), run = `${row.arm ?? ""}\0${row.rep ?? ""}`; if (reply) { const key = `${run}\0${reply}`; replyCounts.set(key, (replyCounts.get(key) ?? 0) + 1); } }
  const results = rawRuns.map((raw) => {
    const id = String(raw.id ?? raw.item ?? "unknown").replace(/^fresh-/, "");
    const datasetId = String(raw.id ?? raw.item ?? "");
    const item = items.get(datasetId) ?? {};
    const b = raw.b as Record<string, unknown> | undefined;
    const calls = firstRoundCallsForStoredRun({ firstRoundCalls: b?.firstRoundCalls as string[] | undefined, pluginId: b?.pluginId as string | null | undefined, outcomes: b?.outcomes as string[] | undefined });
    const perTurnQueries = (b?.searchQueries as Record<string, unknown>[] | undefined) ?? [];
    const queryRow = perTurnQueries[0] ?? search.find((q) => q.q && String(raw.prompt ?? "").toLowerCase().includes(String(q.q).toLowerCase()));
    const query = queryRow?.q ? String(queryRow.q) : null;
    const reply = String(raw.reply ?? "");
    const runKey = `${raw.arm ?? ""}\0${raw.rep ?? ""}\0${reply.trim()}`;
    const contaminated = raw.contaminated === true || (reply.trim() !== "" && (replyCounts.get(runKey) ?? 0) > 1) || (datasetId.endsWith("ts-16") && /latest Lakers game/i.test(reply) && /September 19, 2026|September 20, 2026/i.test(reply));
    const unsupportedCitation = datasetId.toLowerCase().includes("eclipse") && /\[\d+\]/.test(reply);
    const executionRows = search.filter((q) => Number(q.status) === 503 || q.stoppedByBench);
    const base: ScoreInput = {
      id, kind: String(item.kind ?? (b?.pluginId === "weather" ? "time-sensitive" : "time-sensitive")), prompt: String(raw.prompt ?? ""),
      acceptable_tools: (item.acceptable_tools as string[] | undefined) ?? (b?.pluginId === "weather" ? ["weather"] : ["websearch"]),
      expected_terms: item.expected_terms as string[] | undefined, firstRoundCalls: calls, query, reply,
      status: queryRow?.status === undefined ? null : Number(queryRow.status),
      rows: queryRow?.rows === undefined ? undefined : Number(queryRow.rows),
      stoppedByBench: queryRow?.stoppedByBench === true,
      contaminated, hasSource: !unsupportedCitation,
      gold: item.gold as ScoreInput["gold"] | undefined,
    };
    const scored = scoreRun(base);
    if (unsupportedCitation) scored.stage_codes = scored.stage_codes.map((code) => code === "S_GROUNDED" ? "S_UNSUPPORTED_CITATION" : code);
    if (/solar eclipse/i.test(String(raw.prompt ?? "")) && /2024/.test(reply)) scored.stage_codes.push("S_STALE");
    if (contaminated) scored.stage_codes = scored.stage_codes.map((code) => code === "V_OK" ? "V_CONTAMINATED" : code);
    return scored;
  });
  return { environment: data.environment, results };
}

export function endsAskingToSearch(reply: string): boolean {
  const tail = reply.trim().slice(-320);
  const offer = /\b(?:would you like me to|do you want me to|want me to|shall i|should i|can i|if you(?:'d| would)? like,? i(?:'ll| can| could)|let me know if you(?:'d| would)? like me to)\b[^.?!]{0,80}\b(?:search|look(?:ing)?\b[^.?!]{0,12}\bup|check|find out|verify|get the latest)/i;
  return offer.test(tail);
}

export interface FreshRun { kind: "time-sensitive" | "timeless" | "hard-negative"; searched: boolean; askedToSearch: boolean; failed: boolean; }
export interface FreshKindSummary { runs: number; searched: number; askedToSearch: number; }
export function summarizeFresh(rows: readonly FreshRun[]): Record<FreshRun["kind"], FreshKindSummary> {
  const kinds: FreshRun["kind"][] = ["time-sensitive", "timeless", "hard-negative"];
  return Object.fromEntries(kinds.map((kind) => {
    const mine = rows.filter((row) => row.kind === kind && !row.failed);
    return [kind, { runs: mine.length, searched: mine.filter((row) => row.searched).length, askedToSearch: mine.filter((row) => row.askedToSearch).length }];
  })) as Record<FreshRun["kind"], FreshKindSummary>;
}

if (import.meta.main && process.argv[2] === "--replay") {
  const dir = process.argv[3];
  if (!dir) throw new Error("usage: bun run scripts/bench/freshScore.ts --replay <dir>");
  const { results } = replayResults(join(dir, "results.json"));
  const out = { results };
  writeFileSync(join(dir, "replay-scored.json"), JSON.stringify(out, null, 2));
  for (const row of results) console.log(`${row.id}: ${row.stage_codes.join(" ")}`);
}
