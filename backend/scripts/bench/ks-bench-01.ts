import "../../../scripts/runTemp";
// KS-BENCH-01: the tool-choice bench for the `scope` argument on `websearch`
// (design: data-scratch/design/KNOWLEDGE-SEARCH-DESIGN.md section 9.1; corpus:
// datasets/ks-bench-01.json, 120 rows). It measures what the model does on
// the real turn path (routes/turn.ts's own stream) against ONE engine, the
// MaiPai Stack's chat role, and scores the websearch calls it makes against
// the call shapes each row category accepts and forbids (ksBenchScore.ts).
//
// Arms (all on one engine, one machine, blocks of arm then row so the prompt
// cache is warm inside a block; each repeat sweeps every arm):
//   plain  today's plain federation: the `scope` property is removed from the
//          websearch tool schema ON THE WIRE (a bench-only rewrite in the
//          Stack stand-in; production code and settings are untouched), so
//          the model can only produce no_tool or scope_omitted. Source mode `mix`.
//   scope  the shipped schema, `scope` offered. Source mode `mix` (the default).
//   live   the shipped schema, source mode `live` (reproduces the 2026-09-24
//          "both, labelled" behaviour for an omitted scope).
//   bare   (adult rows only) the same engine with no tools, no system prompt and
//          the chat sampling: the length and first-text yardstick.
//
// The hub side is a throwaway seeded backend (a fresh MAIPAI_DATA_DIR under the
// OS temp root, two invented bench people). Search is a loopback fixture
// (fixtureSearch.ts), the live Wikipedia base URL points at a loopback server
// that has no pages, and embedding is refused at once (embed is offline on
// the remote Stack), so nothing reaches the internet and no household data is
// read. No offline library (ZIM) is installed, so `scope: reference` finds
// nothing here; tool CHOICE is what this measures, not library answers.
//
//   MAIPAI_LLAMA_SERVER_URL=http://127.0.0.1:8771 \
//   MAIPAI_KS_OUT=<output dir> \
//   bun run scripts/bench/ks-bench-01.ts [--arms plain,scope,live,bare] [--reps 3]
//        [--bands adult,child,spoken] [--only id,id] [--limit N] [--fresh]
//   bun run scripts/bench/ks-bench-01.ts --summarize     (rebuilds summary.json and summary.md from results.json)
//
// results.json is written after every run and the run resumes from it (skip with --fresh).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import dataset from "./datasets/ks-bench-01.json";
import { startFixtureSearch } from "./fixtureSearch";
import { refuseIfGateRunning } from "./liveHubQuiet";
import { callShapes, judge, scopeUse, stripScopeFromBody, type CategoryRule, type ToolCall } from "./ksBenchScore";
import { startRecordingProxy, type RecordedRequest } from "./recordingProxy";

type Arm = "plain" | "scope" | "live" | "bare";
type Band = "adult" | "child" | "spoken";
interface Row { id: string; band: Band; category: "stable" | "recency" | "no_tool"; prompt: string; heldOut: boolean }
interface RunRecord {
  arm: Arm; row: string; band: Band; category: Row["category"]; heldOut: boolean; rep: number; prompt: string;
  reply: string; words: number; firstWordMs: number | null; totalMs: number; error: string | null;
  mode: string | null;
  firstRound: { calls: ToolCall[]; toolChoice: string | null; promptTokens: number | null; cachedTokens: number | null; toolsOffered: number; scopeInSchema: boolean | null; latencyMs: number | null } | null;
  laterCalls: ToolCall[];
  shapes: string[]; pass: boolean | null; forbidden: boolean | null;
  searches: number; scoped: number; engineRequests: number; fixtureQueries: number;
}

const rows = dataset.rows as Row[];
const rules = dataset.arms as Record<string, CategoryRule>;
const argOf = (name: string): string | null => {
  const at = process.argv.indexOf(name);
  return at < 0 ? null : (process.argv[at + 1] ?? null);
};
const OUT_DIR = process.env.MAIPAI_KS_OUT ?? join(process.cwd(), "..", "data-scratch", "chat-ab", "ks-bench-01");
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

function summarize(runs: RunRecord[], env: unknown) {
  const arms = (["plain", "scope", "live"] as Arm[]).filter((a) => runs.some((r) => r.arm === a));
  const slice = (arm: Arm, pred: (r: RunRecord) => boolean) => runs.filter((r) => r.arm === arm && r.error === null && pred(r));
  const byCategory: Record<string, unknown> = {};
  for (const arm of arms) {
    const out: Record<string, unknown> = {};
    for (const band of ["adult", "child", "spoken"] as Band[]) {
      for (const category of ["stable", "recency", "no_tool"] as const) {
        for (const heldOut of [null, true, false] as (boolean | null)[]) {
          const rs = slice(arm, (r) => r.band === band && r.category === category && (heldOut === null || r.heldOut === heldOut));
          if (rs.length === 0) continue;
          const count = (shape: string) => rs.filter((r) => r.shapes.includes(shape)).length;
          out[`${band}/${category}/${heldOut === null ? "all" : heldOut ? "heldout" : "tuning"}`] = {
            n: rs.length,
            passPct: pct(rs.filter((r) => r.pass).length, rs.length),
            forbiddenPct: pct(rs.filter((r) => r.forbidden).length, rs.length),
            shapes: { no_tool: count("no_tool"), other_tool: count("other_tool"), scope_reference: count("scope_reference"), scope_web: count("scope_web"), scope_omitted: count("scope_omitted"), scope_reference_only: count("scope_reference_only") },
          };
        }
      }
    }
    byCategory[arm] = out;
  }
  const bare = runs.filter((r) => r.arm === "bare" && r.error === null);
  const perArm: Record<string, unknown> = {};
  for (const arm of arms) {
    const all = slice(arm, () => true);
    const calls = all.reduce((n, r) => n + r.searches, 0);
    const scoped = all.reduce((n, r) => n + r.scoped, 0);
    const adult = slice(arm, (r) => r.band === "adult");
    const adultBare = bare.filter((r) => r.band === "adult");
    const medWords = median(adult.map((r) => r.words));
    const bareWords = median(adultBare.map((r) => r.words));
    perArm[arm] = {
      runs: runs.filter((r) => r.arm === arm).length,
      errors: runs.filter((r) => r.arm === arm && r.error !== null).length,
      websearchCalls: calls,
      scopeSetPct: pct(scoped, calls),
      rowsThatSearchedPct: pct(all.filter((r) => r.searches > 0).length, all.length),
      adultMedianWords: medWords,
      bareMedianWords: bareWords,
      adultLengthVsBarePct: medWords !== null && bareWords ? Math.round((1000 * (medWords - bareWords)) / bareWords) / 10 : null,
      adultMedianFirstWordMs: median(adult.flatMap((r) => (r.firstWordMs === null ? [] : [r.firstWordMs]))),
      bareMedianFirstWordMs: median(adultBare.flatMap((r) => (r.firstWordMs === null ? [] : [r.firstWordMs]))),
      adultMedianTotalMs: median(adult.map((r) => r.totalMs)),
      forcedToolChoiceRequired: all.filter((r) => r.firstRound?.toolChoice === "required").length,
      medianPromptTokensFirstRound: median(all.flatMap((r) => (r.firstRound?.promptTokens == null ? [] : [r.firstRound.promptTokens]))),
      childFixtureSearchQueries: slice(arm, (r) => r.band === "child").reduce((n, r) => n + r.fixtureQueries, 0),
      scopeInSchemaPct: pct(all.filter((r) => r.firstRound?.scopeInSchema).length, all.length),
    };
  }
  return { environment: env, perArm, byCategory };
}

function renderSummary(s: ReturnType<typeof summarize>): string {
  const lines: string[] = ["# KS-BENCH-01 summary", "", "Pass = the first-round call shape is acceptable for the row's category and none is forbidden. Forbidden = a shape the category forbids.", "", "## Per arm", "", "```json", JSON.stringify(s.perArm, null, 2), "```", "", "## Per band, category and slice", ""];
  lines.push("| Arm | Band / category / slice | n | pass % | forbidden % | shapes |", "|---|---|---:|---:|---:|---|");
  for (const [arm, cells] of Object.entries(s.byCategory)) {
    for (const [name, cell] of Object.entries(cells as Record<string, { n: number; passPct: number | null; forbiddenPct: number | null; shapes: Record<string, number> }>)) {
      lines.push(`| ${arm} | ${name} | ${cell.n} | ${cell.passPct ?? "-"} | ${cell.forbiddenPct ?? "-"} | ${Object.entries(cell.shapes).filter(([, v]) => v > 0).map(([k, v]) => `${k} ${v}`).join(", ")} |`);
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

refuseIfGateRunning("ks-bench-01");
const chatUrl = process.env.MAIPAI_LLAMA_SERVER_URL?.replace(/\/$/, "");
if (!chatUrl) {
  console.error("ks-bench-01 refused: MAIPAI_LLAMA_SERVER_URL is not set; the bench connects only to an engine already running (the Stack's chat role).");
  process.exit(2);
}
const ARMS = ((argOf("--arms") ?? "plain,scope,live,bare").split(",").map((s) => s.trim()).filter(Boolean)) as Arm[];
for (const a of ARMS) if (!["plain", "scope", "live", "bare"].includes(a)) throw new Error(`--arms: unknown arm ${a}`);
const REPS = Math.max(1, Number(argOf("--reps") ?? 3));
const BANDS = new Set((argOf("--bands") ?? "adult,child,spoken").split(",").map((s) => s.trim()));
const ONLY = argOf("--only") ? new Set(argOf("--only")!.split(",").map((s) => s.trim())) : null;
const LIMIT = argOf("--limit") ? Number(argOf("--limit")) : Infinity;
const selected = rows.filter((r) => BANDS.has(r.band) && (!ONLY || ONLY.has(r.id))).slice(0, LIMIT);

// Nothing in the hub's data directory may be a household's: a fresh one under the OS temp root.
if (!process.env.MAIPAI_DATA_DIR) process.env.MAIPAI_DATA_DIR = mkdtempSync(join(tmpdir(), "ks-bench-01-"));

// The loopback Wikipedia: no pages, so the live fallback finds nothing and nothing leaves the machine.
const deadWikipedia = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response(JSON.stringify({ query: { search: [] } }), { headers: { "content-type": "application/json" } }) });
process.env.MAIPAI_WIKIPEDIA_BASE_URL = `http://127.0.0.1:${deadWikipedia.port}`;
const fixtureSearch = startFixtureSearch(rows.map((r) => ({ id: r.id, prompt: r.prompt })));
const proxy = startRecordingProxy(chatUrl);

const probe = await fetch(`${chatUrl}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "chat", messages: [{ role: "user", content: "Say hi" }], max_tokens: 4, stream: false, chat_template_kwargs: { enable_thinking: false } }), signal: AbortSignal.timeout(240_000) }).catch((err: Error) => {
  console.error(`ks-bench-01 refused: the chat engine did not answer (${err.message}); failure shape: ${/ECONNREFUSED|refused/i.test(err.message) ? "refused" : /timeout|timed out/i.test(err.message) ? "hung" : "dropped"}.`);
  process.exit(2);
});
if (!probe.ok) {
  console.error(`ks-bench-01 refused: the chat engine answered HTTP ${probe.status}: ${(await probe.text()).slice(0, 200)}`);
  process.exit(2);
}
const engineHeaders = { "x-maipai-engine": probe.headers.get("x-maipai-engine") ?? "unknown", "x-maipai-model": probe.headers.get("x-maipai-model") ?? "unknown" };
const probeBody = (await probe.json().catch(() => ({}))) as { system_fingerprint?: string; model?: string };

// ---- the Stack stand-in: forwards chat to the engine through the recording proxy, refuses embeddings at once ----
const state = { stripScope: false, strippedLast: false };
const roleRow = (id: string, wire: string) => ({ id, label: id, wire, residency: "resident", endpoints: [], quality: ["everyday"], sharesModelWith: null, state: { state: "ready", reason: null }, reason: null, model: null, check: { state: "passed", at: null, reason: null, stale: false } });
const standIn = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  idleTimeout: 120,
  async fetch(req) {
    const path = new URL(req.url).pathname;
    if (req.method === "GET" && path === "/healthz") return Response.json({ ok: true, version: "ks-bench-01-stand-in", uptimeSeconds: 0 });
    if (req.method === "GET" && path === "/health") return Response.json({ status: "ok" });
    if (req.method === "GET" && path === "/stack/v1/roles") return Response.json({ roles: [roleRow("chat", "chat"), roleRow("judge", "chat"), roleRow("embed", "embeddings")] });
    if (req.method === "POST" && path === "/v1/embeddings") return Response.json({ error: "No engine is ready for role 'embed'.", role: "embed", state: "offline", offline_reason: "bench: embed is offline on the remote Stack" }, { status: 503, headers: engineHeaders });
    if (req.method === "POST" && path === "/v1/chat/completions") {
      let bodyText = await req.text();
      if (state.stripScope) {
        const out = stripScopeFromBody(bodyText);
        bodyText = out.body;
        state.strippedLast = out.stripped;
      }
      const upstream = await fetch(`${proxy.url.replace(/\/$/, "")}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: bodyText, signal: req.signal });
      return new Response(upstream.body, { status: upstream.status, headers: { "content-type": upstream.headers.get("content-type") ?? "application/json", ...engineHeaders } });
    }
    return new Response("not found", { status: 404 });
  },
});
process.env.MAIPAI_LLAMA_SERVER_URL = standIn.url.toString().replace(/\/$/, "");
process.env.MAIPAI_EMBED_URL = process.env.MAIPAI_LLAMA_SERVER_URL;

const setup = await import("./setup");
const runner = await import("./conversationRunner");
const { benchChatSampling } = await import("@/lib/benchSampling");
const { setHouseholdSettingValue } = await import("@/lib/settings");
const { effectiveMode } = await import("@/lib/retrieval/sourceMode");

/** One turn the way routes/turn.ts streams it (the same loop chat-ab-01's arms C and S use). */
async function streamTurn(actor: { id: string; role?: string }, text: string, spoken: boolean): Promise<{ reply: string; error: string | null; firstWordMs: number | null; totalMs: number }> {
  const { createConversation } = await import("@/lib/conversationHistory");
  const { runTurnNextStream } = await import("@/lib/turnMachine/turnNext");
  const { streamTurnEvents } = await import("@/routes/turn");
  const created = createConversation(actor as never, { surface: "chat" });
  if (!created.ok) throw new Error(`createConversation: ${created.error}`);
  const t0 = performance.now();
  const at = () => performance.now() - t0;
  let reply = "";
  let firstWordMs: number | null = null;
  try {
    const result = await runTurnNextStream(actor as never, "chat", text, { conversationId: created.value.id, spoken, thinking: false });
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

/** The yardstick: the same engine, no tools, no system prompt, the chat sampling, thinking off. */
async function bareTurn(prompt: string): Promise<{ reply: string; error: string | null; firstWordMs: number | null; totalMs: number }> {
  const t0 = performance.now();
  let reply = "";
  let firstWordMs: number | null = null;
  try {
    const res = await fetch(`${chatUrl}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "chat", messages: [{ role: "user", content: prompt }], max_tokens: 1536, stream: true, chat_template_kwargs: { enable_thinking: false }, ...benchChatSampling() }), signal: AbortSignal.timeout(300_000) });
    if (!res.ok || !res.body) return { reply, error: `HTTP ${res.status}`, firstWordMs, totalMs: performance.now() - t0 };
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        const piece = (JSON.parse(payload) as { choices?: { delta?: { content?: string | null } }[] }).choices?.[0]?.delta?.content;
        if (piece) {
          if (firstWordMs === null && piece.trim()) firstWordMs = performance.now() - t0;
          reply += piece;
        }
      }
    }
    return { reply, error: null, firstWordMs, totalMs: performance.now() - t0 };
  } catch (err) {
    return { reply, error: (err as Error).message, firstWordMs, totalMs: performance.now() - t0 };
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
    chatSampling: benchChatSampling(),
    search: "loopback fixture rows only (fixtureSearch.ts); live Wikipedia fallback pointed at an empty loopback server; embed refused at once",
    library: "no ZIM installed in the throwaway backend: scope reference finds nothing here",
    hub: "throwaway seeded backend in a fresh OS-temp data directory, two invented bench people",
    scopeStrip: "arm plain removes the scope property from the websearch tool schema on the wire (bench-only)",
  };
  console.log(JSON.stringify(env, null, 2));

  let runs: RunRecord[] = [];
  if (existsSync(RESULTS) && !process.argv.includes("--fresh")) runs = (JSON.parse(readFileSync(RESULTS, "utf-8")) as { runs: RunRecord[] }).runs;
  const done = new Set(runs.map((r) => `${r.arm}|${r.row}|${r.rep}`));
  let consecutiveErrors = 0;

  for (let rep = 1; rep <= REPS; rep++) {
    for (const arm of ARMS) {
      if (arm === "live") setHouseholdSettingValue("search.source_mode", "live");
      else setHouseholdSettingValue("search.source_mode", "mix");
      const mode = effectiveMode("web", "adult");
      state.stripScope = arm === "plain";
      for (const row of selected) {
        if (arm === "bare" && row.band !== "adult") continue;
        if (done.has(`${arm}|${row.id}|${rep}`)) continue;
        console.log(`[ks-bench-01] rep ${rep}/${REPS} ${arm} ${row.id}`);
        const base = { arm, row: row.id, band: row.band, category: row.category, heldOut: row.heldOut, rep, prompt: row.prompt };
        if (arm === "bare") {
          const r = await bareTurn(row.prompt);
          runs.push({ ...base, reply: r.reply, words: words(r.reply), firstWordMs: r.firstWordMs, totalMs: r.totalMs, error: r.error, mode: null, firstRound: null, laterCalls: [], shapes: [], pass: null, forbidden: null, searches: 0, scoped: 0, engineRequests: 1, fixtureQueries: 0 });
          consecutiveErrors = r.error ? consecutiveErrors + 1 : 0;
        } else {
          proxy.reset();
          state.strippedLast = false;
          const queriesBefore = fixtureSearch.queries.length;
          const actor = row.band === "child" ? people.child : people.owner;
          const turn = await Promise.race([streamTurn(actor, row.prompt, row.band === "spoken"), new Promise<never>((_, reject) => setTimeout(() => reject(new Error("hung: no end of turn in 420 s")), 420_000))]).catch((err: Error) => ({ reply: "", error: err.message, firstWordMs: null as number | null, totalMs: 420_000 }));
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
            ...base, reply: turn.error ? "" : turn.reply, words: turn.error ? 0 : words(turn.reply), firstWordMs: turn.firstWordMs, totalMs: turn.totalMs, error: turn.error, mode,
            firstRound: first ? { calls: firstCalls, toolChoice: first.toolChoice ?? null, promptTokens: first.promptTokens ?? null, cachedTokens: first.cachedTokens ?? null, toolsOffered: first.tools.length, scopeInSchema: arm === "plain" ? !state.strippedLast : true, latencyMs: first.latencyMs ?? null } : null,
            laterCalls, shapes: [...shapes], pass: verdict?.pass ?? null, forbidden: verdict?.forbidden ?? null, searches: use.searches, scoped: use.scoped, engineRequests: requests.length, fixtureQueries: fixtureSearch.queries.length - queriesBefore,
          });
          consecutiveErrors = turn.error ? consecutiveErrors + 1 : 0;
        }
        save(runs, env);
        if (consecutiveErrors >= 5) {
          console.error(`[ks-bench-01] STOPPED: 5 runs in a row failed (last error: ${runs.at(-1)?.error}). Engine failure shape: ${await failureShape()}.`);
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
