import "../../../scripts/runTemp";
// SEARCH-RECENCY-02: measurement only, nothing here ships. A copy of the KS-BENCH-01
// harness (same 120 rows, same engine and model, thinking off, 3 repeats, same scorer)
// plus 12 follow-up rows, with arms that test how much of the recency miss a router or
// a prompt change recovers. Arms 0, 6 and 7 conflict with RULES.md rule 1 (no router or
// classifier) and are ceilings only, reported beside the best in-rules arm.
//   diag    (arm 0) the model sees the user turn (plus the prior turn for follow-ups) and
//           answers only SEARCH or NO_SEARCH. No tools, no hub turn.
//   router  (arm 6) adult rows: the same question first; on SEARCH the websearch tool is
//           forced (tool_choice names the function) with the plain 11-tool block, on
//           NO_SEARCH a normal plain turn. Latency includes the extra call.
//   always  (arm 7) adult rows: websearch forced on every turn.
//   plain   baseline: the scope property removed from websearch on the wire, as KS-BENCH-01.
//   classifier (SEARCH-RECENCY-05) per-turn decision from a trained embedding classifier (precomputed per row id in
//           MAIPAI_SR_DECISIONS, a JSON of {id: "SEARCH"|"NO_SEARCH"}); on SEARCH the websearch call is forced with the
//           router's emulation, on NO_SEARCH the plain turn runs unchanged. Child rows are forced too: the scope gate stays outside.
//   desc    (arm 1) plain plus one sentence on the websearch description (first round).
//   cutoff  (arm 2) plain plus the loki-doki e0d8c75e knowledge-cutoff block on the system message.
// Child and spoken rows always run the plain turn (router and forcing apply to adult rows only).
// Prior turns of a follow-up row run through the hub in the same conversation as a plain turn.
//
//   MAIPAI_LLAMA_SERVER_URL=http://127.0.0.1:8771 MAIPAI_KS_OUT=<dir> \
//   bun run scripts/bench/search-recency-02.ts [--arms diag,router,always,plain] [--reps 3]
//        [--bands adult,child] [--only id,id] [--limit N] [--fresh]
//   bun run scripts/bench/search-recency-02.ts --summarize
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import dataset from "./datasets/ks-bench-01.json";
import followups from "./datasets/search-recency-02-followups.json";
import { foldLateSystemMessages, addCutoffBlockBody, addDescriptionSentenceBody, forceWebsearchBody, pairedInterval, parseRouterAnswer, ROUTER_INSTRUCTION } from "./searchRecency02Score";
import { startFixtureSearch } from "./fixtureSearch";
import { refuseIfGateRunning } from "./liveHubQuiet";
import { callShapes, judge, scopeUse, stripScopeFromBody, type CategoryRule, type ToolCall } from "./ksBenchScore";
import { startRecordingProxy, type RecordedRequest } from "./recordingProxy";

type Arm = "diag" | "router" | "always" | "plain" | "desc" | "cutoff" | "classifier";
type Band = "adult" | "child" | "spoken";
interface Row { id: string; band: Band; category: "stable" | "recency" | "no_tool"; prompt: string; heldOut: boolean; followUp?: boolean; priorUser?: string; priorAssistant?: string }
interface RunRecord {
  arm: Arm; row: string; band: Band; category: Row["category"]; heldOut: boolean; followUp: boolean; rep: number; prompt: string;
  routerAnswer: string | null; diagMs: number | null; forced: boolean; wire?: unknown[];
  reply: string; words: number; firstWordMs: number | null; totalMs: number; error: string | null;
  mode: string | null;
  firstRound: { calls: ToolCall[]; toolChoice: string | null; promptTokens: number | null; cachedTokens: number | null; toolsOffered: number; scopeInSchema: boolean | null; latencyMs: number | null } | null;
  laterCalls: ToolCall[];
  shapes: string[]; pass: boolean | null; forbidden: boolean | null;
  searches: number; scoped: number; engineRequests: number; fixtureQueries: number;
}

// ROUTER-LIVE-06 (bench-only): MAIPAI_SR_DATASET=<path> swaps the row set for one dataset file (rows marked held-out).
const rows: Row[] = process.env.MAIPAI_SR_DATASET
  ? (JSON.parse(readFileSync(process.env.MAIPAI_SR_DATASET, "utf-8")).rows as Row[]).map((r) => ({ ...r, heldOut: true }))
  : [...(dataset.rows as Row[]), ...(followups.rows as Row[])];
const rules = dataset.arms as Record<string, CategoryRule>;
const argOf = (name: string): string | null => {
  const at = process.argv.indexOf(name);
  return at < 0 ? null : (process.argv[at + 1] ?? null);
};
const OUT_DIR = process.env.MAIPAI_KS_OUT ?? join(process.cwd(), "..", "data-scratch", "chat-ab", "search-recency-02");
const RESULTS = join(OUT_DIR, "results.json");
const words = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length;
const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};
const pct = (n: number, d: number): number | null => (d === 0 ? null : Math.round((1000 * n) / d) / 10);

// ==== summary ====

const SLICES = ["all", "heldout", "tuning", "followup"] as const;
const sliceOf = (r: RunRecord): string[] => (r.followUp ? ["followup"] : ["all", r.heldOut ? "heldout" : "tuning"]);

function summarize(runs: RunRecord[], env: unknown) {
  const present = (["plain", "router", "always", "desc", "cutoff", "classifier"] as Arm[]).filter((a) => runs.some((r) => r.arm === a));
  const slice = (arm: Arm, pred: (r: RunRecord) => boolean) => runs.filter((r) => r.arm === arm && r.error === null && pred(r));
  const cellPred = (band: Band, category: string, sl: string) => (r: RunRecord) => r.band === band && r.category === category && sliceOf(r).includes(sl);
  const byCategory: Record<string, unknown> = {};
  for (const arm of present) {
    const out: Record<string, unknown> = {};
    for (const band of ["adult", "child", "spoken"] as Band[]) {
      for (const category of ["stable", "recency", "no_tool"] as const) {
        for (const sl of SLICES) {
          const rs = slice(arm, cellPred(band, category, sl));
          if (rs.length === 0) continue;
          const count = (shape: string) => rs.filter((r) => r.shapes.includes(shape)).length;
          out[`${band}/${category}/${sl}`] = {
            n: rs.length,
            passPct: pct(rs.filter((r) => r.pass).length, rs.length),
            forbiddenPct: pct(rs.filter((r) => r.forbidden).length, rs.length),
            searchedPct: pct(rs.filter((r) => r.searches > 0).length, rs.length),
            medianTotalMs: median(rs.map((r) => r.totalMs)),
            shapes: { no_tool: count("no_tool"), other_tool: count("other_tool"), scope_reference: count("scope_reference"), scope_web: count("scope_web"), scope_omitted: count("scope_omitted"), scope_reference_only: count("scope_reference_only") },
          };
        }
      }
    }
    byCategory[arm] = out;
  }
  const perArm: Record<string, unknown> = {};
  for (const arm of present) {
    const all = slice(arm, () => true);
    const adult = slice(arm, (r) => r.band === "adult");
    perArm[arm] = {
      runs: runs.filter((r) => r.arm === arm).length,
      errors: runs.filter((r) => r.arm === arm && r.error !== null).length,
      forcedRuns: all.filter((r) => r.forced).length,
      adultMedianWords: median(adult.map((r) => r.words)),
      adultMedianFirstWordMs: median(adult.flatMap((r) => (r.firstWordMs === null ? [] : [r.firstWordMs]))),
      adultMedianTotalMs: median(adult.map((r) => r.totalMs)),
      adultMedianDiagMs: median(adult.flatMap((r) => (r.diagMs === null ? [] : [r.diagMs]))),
      medianPromptTokensFirstRound: median(all.flatMap((r) => (r.firstRound?.promptTokens == null ? [] : [r.firstRound.promptTokens]))),
      childRuns: slice(arm, (r) => r.band === "child").length,
      childFixtureSearchQueries: slice(arm, (r) => r.band === "child").reduce((n, r) => n + r.fixtureQueries, 0),
      childWebsearchCalls: slice(arm, (r) => r.band === "child").reduce((n, r) => n + r.searches, 0),
    };
  }
  // Paired 95% intervals vs plain: per-row pass rate over repeats, same rows.
  const rates = (arm: Arm, pred: (r: RunRecord) => boolean, f: (r: RunRecord) => boolean) => {
    const acc = new Map<string, { k: number; n: number }>();
    for (const r of slice(arm, pred)) {
      const a = acc.get(r.row) ?? { k: 0, n: 0 };
      a.n += 1;
      if (f(r)) a.k += 1;
      acc.set(r.row, a);
    }
    return new Map([...acc].map(([row, a]) => [row, a.k / a.n] as const));
  };
  const pairedVsPlain: Record<string, Record<string, unknown>> = {};
  const pairedSearchedVsPlain: Record<string, Record<string, unknown>> = {};
  if (present.includes("plain")) {
    for (const arm of present.filter((a) => a !== "plain")) {
      const out: Record<string, unknown> = {};
      const outS: Record<string, unknown> = {};
      for (const band of ["adult", "child", "spoken"] as Band[]) {
        for (const category of ["stable", "recency", "no_tool"] as const) {
          for (const sl of SLICES) {
            const pred = cellPred(band, category, sl);
            const iv = pairedInterval(rates(arm, pred, (r) => !!r.pass), rates("plain", pred, (r) => !!r.pass));
            if (iv) out[`${band}/${category}/${sl}`] = iv;
            const ivs = pairedInterval(rates(arm, pred, (r) => r.searches > 0), rates("plain", pred, (r) => r.searches > 0));
            if (ivs) outS[`${band}/${category}/${sl}`] = ivs;
          }
        }
      }
      pairedVsPlain[arm] = out;
      pairedSearchedVsPlain[arm] = outS;
    }
  }
  // Arm 0: the SEARCH / NO_SEARCH diagnostic.
  const diagRuns = runs.filter((r) => r.arm === "diag" && r.error === null);
  const diag: Record<string, unknown> = {};
  for (const band of ["adult", "child", "spoken"] as Band[]) {
    for (const category of ["stable", "recency", "no_tool"] as const) {
      for (const sl of SLICES) {
        const rs = diagRuns.filter(cellPred(band, category, sl));
        if (rs.length === 0) continue;
        const search = rs.filter((r) => r.routerAnswer === "SEARCH").length;
        const unparsed = rs.filter((r) => r.routerAnswer === null || String(r.routerAnswer).startsWith("UNPARSED:")).length;
        diag[`${band}/${category}/${sl}`] = { n: rs.length, searchPct: pct(search, rs.length), unparsed, medianMs: median(rs.map((r) => r.totalMs)), recallPct: category === "recency" ? pct(search, rs.length) : null, falseSearchPct: category === "recency" ? null : pct(search, rs.length) };
      }
    }
  }
  return { environment: env, perArm, byCategory, pairedVsPlain, pairedSearchedVsPlain, diag };
}

function renderSummary(s: ReturnType<typeof summarize>): string {
  const lines: string[] = ["# SEARCH-RECENCY-02 summary", "", "Pass = the first-round call shape is acceptable for the row's category and none is forbidden (KS-BENCH-01 rules). Slice `all` = the 120 original rows (follow-ups excluded), `followup` = the 12 added rows.", "", "## Arm 0 diagnostic (SEARCH / NO_SEARCH, no tools)", "", "| Band / category / slice | n | SEARCH % | unparsed | median ms |", "|---|---:|---:|---:|---:|"];
  for (const [name, c] of Object.entries(s.diag as Record<string, { n: number; searchPct: number | null; unparsed: number; medianMs: number | null }>)) lines.push(`| ${name} | ${c.n} | ${c.searchPct ?? "-"} | ${c.unparsed} | ${c.medianMs === null ? "-" : Math.round(c.medianMs)} |`);
  lines.push("", "## Per arm", "", "```json", JSON.stringify(s.perArm, null, 2), "```", "", "## Per band, category and slice", "", "| Arm | Band / category / slice | n | pass % | forbidden % | searched % | median total ms | shapes |", "|---|---|---:|---:|---:|---:|---:|---|");
  for (const [arm, cells] of Object.entries(s.byCategory)) {
    for (const [name, cell] of Object.entries(cells as Record<string, { n: number; passPct: number | null; forbiddenPct: number | null; searchedPct: number | null; medianTotalMs: number | null; shapes: Record<string, number> }>)) {
      lines.push(`| ${arm} | ${name} | ${cell.n} | ${cell.passPct ?? "-"} | ${cell.forbiddenPct ?? "-"} | ${cell.searchedPct ?? "-"} | ${cell.medianTotalMs === null ? "-" : Math.round(cell.medianTotalMs)} | ${Object.entries(cell.shapes).filter(([, v]) => v > 0).map(([k, v]) => `${k} ${v}`).join(", ")} |`);
    }
  }
  for (const [title, data] of [["pass rate", s.pairedVsPlain], ["searched rate (any websearch call)", s.pairedSearchedVsPlain]] as const) {
    lines.push("", `## Paired 95% intervals, arm minus plain, ${title} (points, per-row pairs)`, "", "| Arm | Band / category / slice | rows | diff | 95% low | 95% high |", "|---|---|---:|---:|---:|---:|");
    for (const [arm, cells] of Object.entries(data as Record<string, Record<string, { n: number; meanDiffPct: number; lowPct: number; highPct: number }>>)) {
      for (const [name, iv] of Object.entries(cells)) lines.push(`| ${arm} | ${name} | ${iv.n} | ${iv.meanDiffPct} | ${iv.lowPct} | ${iv.highPct} |`);
    }
  }
  return lines.join("\n") + "\n";
}

function save(runs: RunRecord[], env: unknown): void {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(RESULTS, JSON.stringify({ environment: env, runs }, null, 2));
}

if (process.argv.includes("--summarize")) {
  const saved = JSON.parse(readFileSync(RESULTS, "utf-8")) as { environment: unknown; runs: RunRecord[] };
  const s = summarize(saved.runs, saved.environment);
  writeFileSync(join(OUT_DIR, "summary.json"), JSON.stringify(s, null, 2));
  writeFileSync(join(OUT_DIR, "summary.md"), renderSummary(s));
  console.log(`wrote summary.json and summary.md in ${OUT_DIR}`);
  process.exit(0);
}

// ==== live run ====

refuseIfGateRunning("search-recency-02");
const chatUrl = process.env.MAIPAI_LLAMA_SERVER_URL?.replace(/\/$/, "");
if (!chatUrl) {
  console.error("search-recency-02 refused: MAIPAI_LLAMA_SERVER_URL is not set; the bench connects only to an engine already running (the Stack's chat role).");
  process.exit(2);
}
const classifierDecisions: Record<string, string> = process.env.MAIPAI_SR_DECISIONS ? JSON.parse(readFileSync(process.env.MAIPAI_SR_DECISIONS, "utf-8")) : {};
const ARMS = ((argOf("--arms") ?? "diag,router,always,plain").split(",").map((s) => s.trim()).filter(Boolean)) as Arm[];
for (const a of ARMS) if (!["diag", "router", "always", "plain", "desc", "cutoff", "classifier"].includes(a)) throw new Error(`--arms: unknown arm ${a}`);
const REPS = Math.max(1, Number(argOf("--reps") ?? 3));
if (!Number.isFinite(REPS)) throw new Error("--reps must be a number, for example --reps 3");
const BANDS = new Set((argOf("--bands") ?? "adult,child").split(",").map((s) => s.trim()));
const ONLY = argOf("--only") ? new Set(argOf("--only")!.split(",").map((s) => s.trim())) : null;
const LIMIT = argOf("--limit") ? Number(argOf("--limit")) : Infinity;
if (Number.isNaN(LIMIT)) throw new Error("--limit must be a number, for example --limit 10");
const selected = rows.filter((r) => BANDS.has(r.band) && (!ONLY || ONLY.has(r.id))).slice(0, LIMIT);

// Nothing in the hub's data directory may be a household's: a fresh one under the OS temp root.
if (!process.env.MAIPAI_DATA_DIR) process.env.MAIPAI_DATA_DIR = mkdtempSync(join(tmpdir(), "search-recency-02-"));

// The loopback Wikipedia: no pages, so the live fallback finds nothing and nothing leaves the machine.
const deadWikipedia = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response(JSON.stringify({ query: { search: [] } }), { headers: { "content-type": "application/json" } }) });
process.env.MAIPAI_WIKIPEDIA_BASE_URL = `http://127.0.0.1:${deadWikipedia.port}`;
const fixtureSearch = startFixtureSearch(rows.map((r) => ({ id: r.id, prompt: r.prompt })));
// The engine build ignores a named tool_choice (and "required" is not reliable), so a forced round is
// emulated in this shim between the recording proxy and the engine: the engine writes the query as JSON
// from the same conversation, and the shim answers with a streamed websearch tool call. Everything else
// passes through untouched. Bench-only; llm.ts and the manifests are not touched.
const forceShim = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  idleTimeout: 120,
  async fetch(req) {
    const url = new URL(req.url);
    const bodyText = req.method === "POST" ? await req.text() : undefined;
    if (!(req.headers.get("x-sr-force") === "1" && bodyText && url.pathname === "/v1/chat/completions")) {
      const headers = new Headers(req.headers);
      headers.delete("host");
      headers.delete("content-length");
      return fetch(`${chatUrl}${url.pathname}${url.search}`, { method: req.method, headers, body: bodyText, signal: req.signal });
    }
    const orig = JSON.parse(bodyText) as { messages: { role: string; content: unknown }[]; stream?: boolean; model?: string };
    const lastUser = [...orig.messages].reverse().find((m) => m.role === "user");
    let query = typeof lastUser?.content === "string" ? lastUser.content : "";
    try {
      const ask = { role: "user", content: 'Write the web search query for the conversation above as JSON: {"query": "..."}. A name or topic, not a question. For a follow-up, search the previous subject.' };
      const res = await fetch(`${chatUrl}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: orig.model ?? "chat", messages: [...orig.messages, ask], max_tokens: 60, temperature: 0, stream: false, chat_template_kwargs: { enable_thinking: false }, response_format: { type: "json_schema", json_schema: { name: "q", schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } } } }), signal: AbortSignal.timeout(60_000) });
      const content = ((await res.json()) as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content ?? "";
      const q = (JSON.parse(content) as { query?: string }).query;
      if (q && q.trim()) query = q.trim();
    } catch { /* falls back to the user's own words */ }
    const args = JSON.stringify({ query });
    const id = `call_${Math.random().toString(36).slice(2, 10)}`;
    const model = orig.model ?? "chat";
    if (orig.stream) {
      const enc = new TextEncoder();
      const line = (choice: unknown) => enc.encode(`data: ${JSON.stringify({ id: "forced", model, object: "chat.completion.chunk", choices: [choice] })}\n\n`);
      const stream = new ReadableStream<Uint8Array>({ start(c) {
        c.enqueue(line({ index: 0, delta: { role: "assistant", content: null }, finish_reason: null }));
        c.enqueue(line({ index: 0, delta: { tool_calls: [{ index: 0, id, type: "function", function: { name: "websearch", arguments: args } }] }, finish_reason: null }));
        c.enqueue(line({ index: 0, delta: {}, finish_reason: "tool_calls" }));
        c.enqueue(enc.encode("data: [DONE]\n\n"));
        c.close();
      } });
      return new Response(stream, { headers: { "content-type": "text/event-stream" } });
    }
    return Response.json({ id: "forced", model, choices: [{ index: 0, message: { role: "assistant", content: null, tool_calls: [{ id, type: "function", function: { name: "websearch", arguments: args } }] }, finish_reason: "tool_calls" }] });
  },
});
const proxy = startRecordingProxy(forceShim.url.toString().replace(/\/$/, ""));

const probe = await fetch(`${chatUrl}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "chat", messages: [{ role: "user", content: "Say hi" }], max_tokens: 4, stream: false, chat_template_kwargs: { enable_thinking: false } }), signal: AbortSignal.timeout(240_000) }).catch((err: Error) => {
  console.error(`search-recency-02 refused: the chat engine did not answer (${err.message}); failure shape: ${/ECONNREFUSED|refused/i.test(err.message) ? "refused" : /timeout|timed out/i.test(err.message) ? "hung" : "dropped"}.`);
  process.exit(2);
});
if (!probe.ok) {
  console.error(`search-recency-02 refused: the chat engine answered HTTP ${probe.status}: ${(await probe.text()).slice(0, 200)}`);
  process.exit(2);
}
const engineHeaders = { "x-maipai-engine": probe.headers.get("x-maipai-engine") ?? "unknown", "x-maipai-model": probe.headers.get("x-maipai-model") ?? "unknown" };
const probeBody = (await probe.json().catch(() => ({}))) as { system_fingerprint?: string; model?: string };

// ---- the Stack stand-in: forwards chat to the engine through the recording proxy, refuses embeddings at once ----
const state = { stripScope: false, strippedLast: false, force: false, forcedLast: false, desc: false, cutoff: false };
const roleRow = (id: string, wire: string) => ({ id, label: id, wire, residency: "resident", endpoints: [], quality: ["everyday"], sharesModelWith: null, state: { state: "ready", reason: null }, reason: null, model: null, check: { state: "passed", at: null, reason: null, stale: false } });
const standIn = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  idleTimeout: 120,
  async fetch(req) {
    const path = new URL(req.url).pathname;
    if (req.method === "GET" && path === "/healthz") return Response.json({ ok: true, version: "search-recency-02-stand-in", uptimeSeconds: 0 });
    if (req.method === "GET" && path === "/health") return Response.json({ status: "ok" });
    if (req.method === "GET" && path === "/stack/v1/roles") return Response.json({ roles: [roleRow("chat", "chat"), roleRow("judge", "chat"), roleRow("embed", "embeddings")] });
    if (req.method === "POST" && path === "/v1/embeddings") return Response.json({ error: "No engine is ready for role 'embed'.", role: "embed", state: "offline", offline_reason: "bench: embed is offline on the remote Stack" }, { status: 503, headers: engineHeaders });
    if (req.method === "POST" && path === "/v1/chat/completions") {
      let bodyText = await req.text();
      if (state.stripScope) {
        const out = stripScopeFromBody(bodyText);
        bodyText = out.body;
        if (out.stripped) state.strippedLast = true;
      }
      bodyText = foldLateSystemMessages(bodyText).body;
      let forceHeader = false;
      if (state.force) { const f = forceWebsearchBody(bodyText); bodyText = f.body; if (f.applied) { state.forcedLast = true; forceHeader = true; } }
      if (state.desc) bodyText = addDescriptionSentenceBody(bodyText).body;
      if (state.cutoff) bodyText = addCutoffBlockBody(bodyText).body;
      const upstream = await fetch(`${proxy.url.replace(/\/$/, "")}${path}`, { method: "POST", headers: { "content-type": "application/json", ...(forceHeader ? { "x-sr-force": "1" } : {}) }, body: bodyText, signal: req.signal });
      if (upstream.status >= 400) {
        const errText = await upstream.text();
        console.error(`[search-recency-02] engine HTTP ${upstream.status}: ${errText.slice(0, 400)}`);
        if (process.env.SR_DUMP) console.error(`[search-recency-02] request roles: ${JSON.stringify((JSON.parse(bodyText) as { messages: { role: string }[] }).messages.map((m) => m.role))}`);
        return new Response(errText, { status: upstream.status, headers: { "content-type": "application/json", ...engineHeaders } });
      }
      return new Response(upstream.body, { status: upstream.status, headers: { "content-type": upstream.headers.get("content-type") ?? "application/json", ...engineHeaders } });
    }
    return new Response("not found", { status: 404 });
  },
});
process.env.MAIPAI_LLAMA_SERVER_URL = standIn.url.toString().replace(/\/$/, "");
process.env.MAIPAI_EMBED_URL = process.env.MAIPAI_LLAMA_SERVER_URL;

const setup = await import("./setup");
const runner = await import("./conversationRunner");
const { CHAT_SAMPLING } = await import("@/lib/llm");
const { setHouseholdSettingValue } = await import("@/lib/settings");
const { effectiveMode } = await import("@/lib/retrieval/sourceMode");

/** One turn the way routes/turn.ts streams it, inside an existing conversation. */
async function streamTurnIn(actor: { id: string; role?: string }, conversationId: string, text: string, spoken: boolean): Promise<{ reply: string; error: string | null; firstWordMs: number | null; totalMs: number }> {
  const { runTurnNextStream } = await import("@/lib/turnMachine/turnNext");
  const { streamTurnEvents } = await import("@/routes/turn");
  const t0 = performance.now();
  const at = () => performance.now() - t0;
  let reply = "";
  let firstWordMs: number | null = null;
  try {
    const result = await runTurnNextStream(actor as never, "chat", text, { conversationId, spoken, thinking: false });
    if (!result.ok) return { reply: "", error: result.error, firstWordMs, totalMs: at() };
    if (result.kind === "immediate") return { reply: result.value.reply.text, error: null, firstWordMs: at(), totalMs: at() };
    for await (const event of streamTurnEvents(result, actor.id, 900, undefined, true)) {
      if (event.type === "delta") {
        reply += event.text;
        if (firstWordMs === null && event.text.trim()) firstWordMs = at();
      } else if (event.type === "done") {
        if (reply.trim() === "") reply = event.value.reply.text;
        if (firstWordMs === null && reply.trim()) firstWordMs = at();
      } else if (event.type === "error") {
        return { reply, error: JSON.stringify(event).slice(0, 300), firstWordMs, totalMs: at() };
      }
    }
    return { reply, error: null, firstWordMs, totalMs: at() };
  } catch (err) {
    return { reply, error: (err as Error).message, firstWordMs, totalMs: at() };
  }
}

/** Arm 0's question straight to the engine: no tools, no hub, thinking off, greedy. */
async function routerQuestion(prior: { user: string; assistant: string } | null, text: string): Promise<{ answer: "SEARCH" | "NO_SEARCH" | null; raw: string; ms: number; error: string | null }> {
  const t0 = performance.now();
  const messages = [{ role: "system", content: ROUTER_INSTRUCTION }, ...(prior ? [{ role: "user", content: prior.user }, { role: "assistant", content: prior.assistant }] : []), { role: "user", content: text }];
  try {
    const res = await fetch(`${chatUrl}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "chat", messages, max_tokens: 8, temperature: 0, stream: false, chat_template_kwargs: { enable_thinking: false } }), signal: AbortSignal.timeout(120_000) });
    if (!res.ok) return { answer: null, raw: "", ms: performance.now() - t0, error: `HTTP ${res.status}` };
    const raw = ((await res.json()) as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content ?? "";
    return { answer: parseRouterAnswer(raw), raw, ms: performance.now() - t0, error: null };
  } catch (err) {
    return { answer: null, raw: "", ms: performance.now() - t0, error: (err as Error).message };
  }
}

/** The shape of an unavailable engine: refused, dropped, hung or an HTTP status. */
async function failureShape(): Promise<string> {
  try {
    const res = await fetch(`${chatUrl}/v1/models`, { signal: AbortSignal.timeout(10_000) });
    return res.ok ? "engine answers /v1/models again (the failures were per turn, not an outage)" : `HTTP ${res.status}`;
  } catch (err) {
    const msg = (err as Error).message;
    return /timeout|timed out|aborted/i.test(msg) ? "hung (no answer in 10 s)" : /ECONNREFUSED|refused|Unable to connect/i.test(msg) ? "refused" : `dropped (${msg.slice(0, 120)})`;
  }
}

async function main(): Promise<void> {
  await setup.startBench();
  setHouseholdSettingValue("chat.model_id", process.env.MAIPAI_REPLAY_MODEL_ID ?? "qwen3-8b-instruct-q4-k-m");
  const set = setHouseholdSettingValue("search.searxng_url", fixtureSearch.url);
  if (!set.ok) throw new Error(`could not point search at the fixture: ${set.error}`);
  const people = runner.createBenchPeople();

  const env = {
    date: new Date().toISOString(),
    engineBuild: engineHeaders["x-maipai-engine"],
    engineSystemFingerprint: probeBody.system_fingerprint ?? null,
    modelFile: engineHeaders["x-maipai-model"],
    modelId: probeBody.model ?? "chat",
    hardware: process.env.MAIPAI_KS_HARDWARE ?? "not recorded",
    toolsBlockState: "THIN-Q3 NOT landed: the full tools block rides every adult turn",
    arms: ARMS, reps: REPS, bands: [...BANDS], rows: selected.length,
    thinking: "off (turn path sends thinking false; bare arm sends enable_thinking false)",
    chatSampling: CHAT_SAMPLING,
    search: "loopback fixture rows only (fixtureSearch.ts); live Wikipedia fallback pointed at an empty loopback server; embed refused at once",
    library: "no ZIM installed in the throwaway backend: scope reference finds nothing here",
    hub: "throwaway seeded backend in a fresh OS-temp data directory, two invented bench people",
    baseCommit: process.env.MAIPAI_SR_BASE ?? "unrecorded",
    note: "run from a detached worktree at that commit so the 11-tool block is the committed one, not the in-progress THIN-Q3 manifests; every arm except diag strips scope on the wire like plain",
    scopeStrip: "all non-diag arms remove the scope property from the websearch tool schema on the wire (bench-only)",
  };
  console.log(JSON.stringify(env, null, 2));

  let runs: RunRecord[] = [];
  if (existsSync(RESULTS) && !process.argv.includes("--fresh")) runs = (JSON.parse(readFileSync(RESULTS, "utf-8")) as { runs: RunRecord[] }).runs;
  const done = new Set(runs.map((r) => `${r.arm}|${r.row}|${r.rep}`));
  let consecutiveErrors = 0;

  const { createConversation } = await import("@/lib/conversationHistory");
  for (let rep = 1; rep <= REPS; rep++) {
    for (const arm of ARMS) {
      setHouseholdSettingValue("search.source_mode", "mix");
      const mode = effectiveMode("web", "adult");
      state.stripScope = arm !== "diag";
      state.desc = arm === "desc";
      state.cutoff = arm === "cutoff";
      for (const row of selected) {
        if (done.has(`${arm}|${row.id}|${rep}`)) continue;
        console.log(`[search-recency-02] rep ${rep}/${REPS} ${arm} ${row.id}`);
        const base = { arm, row: row.id, band: row.band, category: row.category, heldOut: row.heldOut, followUp: !!row.followUp, rep, prompt: row.prompt };
        const blank = { routerAnswer: null as string | null, diagMs: null as number | null, forced: false };
        if (arm === "diag") {
          const r = await routerQuestion(row.priorUser ? { user: row.priorUser, assistant: row.priorAssistant ?? "" } : null, row.prompt);
          runs.push({ ...base, routerAnswer: r.answer ?? (r.error ? null : `UNPARSED:${r.raw.slice(0, 30)}`), diagMs: r.ms, forced: false, reply: r.raw, words: 0, firstWordMs: null, totalMs: r.ms, error: r.error, mode: null, firstRound: null, laterCalls: [], shapes: [], pass: null, forbidden: null, searches: 0, scoped: 0, engineRequests: 1, fixtureQueries: 0 });
          consecutiveErrors = r.error ? consecutiveErrors + 1 : 0;
        } else {
          const actor = row.band === "child" ? people.child : people.owner;
          const adultForced = row.band === "adult" && (arm === "router" || arm === "always");
          state.force = false;
          const created = createConversation(actor as never, { surface: "chat" });
          if (!created.ok) throw new Error(`createConversation: ${created.error}`);
          // Prior turn of a follow-up row: a plain turn in the same conversation; its real reply is the history.
          let priorReply = "";
          let priorError: string | null = null;
          if (row.priorUser) {
            const pr = await Promise.race([streamTurnIn(actor, created.value.id, row.priorUser, false), new Promise<never>((_, reject) => setTimeout(() => reject(new Error("hung: no end of prior turn in 420 s")), 420_000))]).catch((err: Error) => ({ reply: "", error: err.message, firstWordMs: null as number | null, totalMs: 0 }));
            priorReply = pr.reply;
            priorError = pr.error;
          }
          let diagMs = 0;
          let answer: string | null = null;
          if (adultForced && arm === "router") {
            const r = await routerQuestion(row.priorUser ? { user: row.priorUser, assistant: priorReply || row.priorAssistant || "" } : null, row.prompt);
            diagMs = r.ms;
            answer = r.answer;
            state.force = r.answer === "SEARCH";
          } else if (adultForced) {
            state.force = true;
          }
          if (arm === "classifier") {
            answer = classifierDecisions[row.id] ?? null;
            if (answer === null) throw new Error(`no classifier decision for ${row.id}`);
            state.force = answer === "SEARCH" && row.band !== "spoken";
          }
          proxy.reset();
          state.strippedLast = false;
          state.forcedLast = false;
          const queriesBefore = fixtureSearch.queries.length;
          const turn = priorError
            ? { reply: "", error: `prior turn failed: ${priorError}`, firstWordMs: null as number | null, totalMs: 0 }
            : await Promise.race([streamTurnIn(actor, created.value.id, row.prompt, row.band === "spoken"), new Promise<never>((_, reject) => setTimeout(() => reject(new Error("hung: no end of turn in 420 s")), 420_000))]).catch((err: Error) => ({ reply: "", error: err.message, firstWordMs: null as number | null, totalMs: 420_000 }));
          state.force = false;
          await proxy.settled().catch(() => {});
          const requests: RecordedRequest[] = proxy.requests.map((q) => ({ ...q }));
          const answering = requests.filter((q) => !q.responseFormat);
          const first = answering.find((q) => q.tools.length > 0) ?? null;
          const firstCalls: ToolCall[] = (first?.toolCalls ?? []).map((c) => ({ name: c.name, arguments: c.arguments }));
          const laterCalls: ToolCall[] = answering.filter((q) => q !== first).flatMap((q) => q.toolCalls.map((c) => ({ name: c.name, arguments: c.arguments })));
          const shapes = callShapes(firstCalls, laterCalls);
          const verdict = turn.error ? null : judge(shapes, rules[row.category]!);
          const use = scopeUse([...firstCalls, ...laterCalls]);
          runs.push({
            ...base, ...blank, routerAnswer: answer, diagMs: arm === "router" && adultForced ? diagMs : null, forced: state.forcedLast,
            reply: turn.error ? "" : turn.reply, words: turn.error ? 0 : words(turn.reply), firstWordMs: turn.firstWordMs === null ? null : turn.firstWordMs + diagMs, totalMs: turn.totalMs + diagMs, error: turn.error, mode,
            firstRound: first ? { calls: firstCalls, toolChoice: first.toolChoice == null ? null : typeof first.toolChoice === "string" ? first.toolChoice : JSON.stringify(first.toolChoice), promptTokens: first.promptTokens ?? null, cachedTokens: first.cachedTokens ?? null, toolsOffered: first.tools.length, scopeInSchema: !state.strippedLast, latencyMs: first.latencyMs ?? null } : null,
            wire: requests.map((q) => ({ tools: q.tools.length, toolChoice: q.toolChoice ?? null, rf: !!q.responseFormat, calls: q.toolCalls.map((c) => c.name), completed: q.completed, aborted: q.aborted, text: (q.responseText ?? "").slice(0, 200) })),
            laterCalls, shapes: [...shapes], pass: verdict?.pass ?? null, forbidden: verdict?.forbidden ?? null, searches: use.searches, scoped: use.scoped, engineRequests: requests.length, fixtureQueries: fixtureSearch.queries.length - queriesBefore,
          });
          consecutiveErrors = turn.error ? consecutiveErrors + 1 : 0;
        }
        save(runs, env);
        if (consecutiveErrors >= 5) {
          console.error(`[search-recency-02] STOPPED: 5 runs in a row failed (last error: ${runs.at(-1)?.error}). Engine failure shape: ${await failureShape()}.`);
          process.exit(3);
        }
      }
    }
  }
  const s = summarize(runs, env);
  writeFileSync(join(OUT_DIR, "summary.json"), JSON.stringify(s, null, 2));
  writeFileSync(join(OUT_DIR, "summary.md"), renderSummary(s));
  runner.cleanupBenchPeople(people);
  setup.finishBench({ executed: runs.length, engine: `${env.engineBuild} (${env.modelFile})` });
}

await main();
process.exit(0);
