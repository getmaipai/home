import "../../../scripts/runTemp";
// TOOLS-RECALL-01: per-tool call reliability for the ten base tools
// (weather, timer, remind, convert, math, remember, almanac-date, almanac-time,
// bedtime-storybook, websearch). Fixture: datasets/tools-recall-01.json (156
// labeled rows); scoring: toolsRecallScore.ts. Same approach as KS-BENCH-01:
// the real turn path (routes/turn.ts's own stream) against ONE engine already
// running, a loopback search fixture, a throwaway seeded hub, embeddings refused.
//
// Arms, interleaved row by row inside each repeat so drift hits both alike:
//   base     the shipped tools block, untouched.
//   variant  the same, with tool descriptions replaced ON THE WIRE (bench-only)
//            from the JSON file named by MAIPAI_TR_VARIANT:
//            { "descriptions": { "timer": "new text", ... } }
//
//   bun run scripts/bench/tools-recall-01.ts --dry-run          (validates the fixture, prints counts, never touches the engine)
//   MAIPAI_LLAMA_SERVER_URL=http://127.0.0.1:8771 MAIPAI_KS_OUT=<dir> \
//   bun run scripts/bench/tools-recall-01.ts [--arms base,variant] [--reps 3]
//        [--bands adult,child,spoken] [--only id,id] [--limit N] [--fresh]
//   bun run scripts/bench/tools-recall-01.ts --summarize        (rebuilds summary.json and summary.md from results.json)
//
// A child row that produces a websearch call is counted as a child-search
// violation, which must be zero.
import { existsSync, mkdirSync, readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import dataset from "./datasets/tools-recall-01.json";
import { startFixtureSearch } from "./fixtureSearch";
import { refuseIfGateRunning } from "./liveHubQuiet";
import { startRecordingProxy, type RecordedRequest } from "./recordingProxy";
import { BASE_TOOLS, countRows, pairedInterval, rewriteToolDescriptions, rowMeans, summarizeArm, validateFixture, type Metric, type Row, type Run, type Slice } from "./toolsRecallScore";

type Arm = "base" | "variant";
interface RunRecord extends Run {
  arm: Arm; band: Row["band"]; kind: Row["kind"]; heldOut: boolean; prompt: string;
  reply: string; totalMs: number; toolsOffered: number | null; promptTokens: number | null; engineRequests: number; rewritten: number;
  priorError?: string | null;
}

const rows = dataset.rows as Row[];
const argOf = (name: string): string | null => {
  const at = process.argv.indexOf(name);
  return at < 0 ? null : (process.argv[at + 1] ?? null);
};
const OUT_DIR = process.env.MAIPAI_KS_OUT ?? join(process.cwd(), "..", "data-scratch", "chat-ab", "tools-recall-01");
const RESULTS = join(OUT_DIR, "results.json");
const SLICES: Slice[] = ["all", "tuning", "heldout"];

// ==== dry run: fixture only, no engine, no hub ====
const problems = validateFixture(rows);
if (process.argv.includes("--dry-run")) {
  console.log(JSON.stringify(countRows(rows), null, 2));
  console.log(problems.length === 0 ? "fixture ok" : `fixture problems:\n${problems.join("\n")}`);
  console.log("dry run: no engine, no hub, no files written");
  process.exit(problems.length === 0 ? 0 : 1);
}
if (problems.length > 0) {
  console.error(`tools-recall-01 refused: the fixture has problems (${problems.slice(0, 3).join("; ")}). Fix datasets/tools-recall-01.json and run --dry-run.`);
  process.exit(2);
}

// ==== summary ====
function summarize(runs: RunRecord[], env: unknown) {
  const arms = (["base", "variant"] as Arm[]).filter((a) => runs.some((r) => r.arm === a));
  const perArm: Record<string, Record<string, unknown>> = {};
  for (const arm of arms) perArm[arm] = Object.fromEntries(SLICES.map((s) => [s, summarizeArm(rows, runs, arm, s)]));
  const paired: Record<string, unknown> = {};
  if (arms.length === 2) {
    const metrics: [Metric, string | undefined][] = [["recall", undefined], ["wrongTool", undefined], ["falseCall", undefined], ...BASE_TOOLS.map((t) => ["recall", t] as [Metric, string])];
    for (const slice of SLICES) {
      for (const [metric, tool] of metrics) {
        paired[`${slice}/${metric}${tool ? `/${tool}` : ""}`] = pairedInterval(rowMeans(rows, runs, "base", metric, slice, tool), rowMeans(rows, runs, "variant", metric, slice, tool), 2000, 1);
      }
    }
  }
  return { environment: env, perArm, paired };
}

const fmt = (x: number | null | undefined): string => (x == null ? "-" : `${Math.round(x * 1000) / 10}`);
function renderSummary(s: ReturnType<typeof summarize>): string {
  const lines: string[] = ["# TOOLS-RECALL-01 summary", "", "Rates are percent of scored runs (rows x repeats). Recall = the expected tool was among the first round's calls. Wrong tool = a call was made but not the expected one. False call = any call on a no-tool or near-miss row. Held-out is reported apart from tuning.", ""];
  for (const slice of SLICES) {
    lines.push(`## Slice: ${slice}`, "", "| Arm | Tool | n | recall % | wrong tool % | missed % |", "|---|---|---:|---:|---:|---:|");
    for (const [arm, slices] of Object.entries(s.perArm)) {
      const a = slices[slice] as ReturnType<typeof summarizeArm>;
      for (const [tool, c] of [...Object.entries(a.perTool), ["ALL", a.overall] as const]) lines.push(`| ${arm} | ${tool} | ${c.n} | ${fmt(c.recall)} | ${fmt(c.wrongTool)} | ${fmt(c.missed)} |`);
      lines.push(`| ${arm} | false call, no-tool rows | ${a.falseCall.none.n} | ${fmt(a.falseCall.none.rate)} | | |`, `| ${arm} | false call, near-miss rows | ${a.falseCall.nearmiss.n} | ${fmt(a.falseCall.nearmiss.rate)} | | |`);
      lines.push(`| ${arm} | child-search violations | ${a.childSearchViolations} | | | |`, `| ${arm} | errored runs | ${a.errors} | | | |`);
    }
    lines.push("");
  }
  if (Object.keys(s.paired).length > 0) {
    lines.push("## Variant minus base, paired bootstrap 95% interval over rows (percentage points)", "", "| Slice / metric | rows | diff | low | high |", "|---|---:|---:|---:|---:|");
    for (const [k, v] of Object.entries(s.paired)) {
      const p = v as { n: number; diff: number; lo: number; hi: number } | null;
      lines.push(p ? `| ${k} | ${p.n} | ${fmt(p.diff)} | ${fmt(p.lo)} | ${fmt(p.hi)} |` : `| ${k} | 0 | - | - | - |`);
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
refuseIfGateRunning("tools-recall-01");
const chatUrl = process.env.MAIPAI_LLAMA_SERVER_URL?.replace(/\/$/, "");
if (!chatUrl) {
  console.error("tools-recall-01 refused: MAIPAI_LLAMA_SERVER_URL is not set; the bench connects only to an engine already running (the Stack's chat role). Set it to the engine's address and run again.");
  process.exit(2);
}
const ARMS = (argOf("--arms") ?? "base,variant").split(",").map((s) => s.trim()).filter(Boolean) as Arm[];
for (const a of ARMS) if (!["base", "variant"].includes(a)) throw new Error(`--arms: unknown arm ${a}`);
const variantFile = process.env.MAIPAI_TR_VARIANT ?? null;
let variantDescriptions: Record<string, string> = {};
if (ARMS.includes("variant")) {
  if (!variantFile || !existsSync(variantFile)) {
    console.error("tools-recall-01 refused: arm `variant` needs MAIPAI_TR_VARIANT to name a JSON file like {\"descriptions\":{\"timer\":\"...\"}}. Set it, or run with --arms base.");
    process.exit(2);
  }
  variantDescriptions = (JSON.parse(readFileSync(variantFile, "utf-8")) as { descriptions?: Record<string, string> }).descriptions ?? {};
  if (Object.keys(variantDescriptions).length === 0) {
    console.error(`tools-recall-01 refused: ${variantFile} has no "descriptions" entries, so the variant arm would equal base. Add at least one tool description.`);
    process.exit(2);
  }
}
const REPS = Math.max(1, Number(argOf("--reps") ?? 3));
const BANDS = new Set((argOf("--bands") ?? "adult,child,spoken").split(",").map((s) => s.trim()));
const ONLY = argOf("--only") ? new Set(argOf("--only")!.split(",").map((s) => s.trim())) : null;
const LIMIT = argOf("--limit") ? Number(argOf("--limit")) : Infinity;
const selected = rows.filter((r) => BANDS.has(r.band) && (!ONLY || ONLY.has(r.id))).slice(0, LIMIT);

if (!process.env.MAIPAI_DATA_DIR) process.env.MAIPAI_DATA_DIR = mkdtempSync(join(tmpdir(), "tools-recall-01-"));

const deadWikipedia = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response(JSON.stringify({ query: { search: [] } }), { headers: { "content-type": "application/json" } }) });
process.env.MAIPAI_WIKIPEDIA_BASE_URL = `http://127.0.0.1:${deadWikipedia.port}`;
const fixtureSearch = startFixtureSearch(rows.map((r) => ({ id: r.id, prompt: r.prompt })));
const proxy = startRecordingProxy(chatUrl);

const probe = await fetch(`${chatUrl}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "chat", messages: [{ role: "user", content: "Say hi" }], max_tokens: 4, stream: false, chat_template_kwargs: { enable_thinking: false } }), signal: AbortSignal.timeout(240_000) }).catch((err: Error) => {
  console.error(`tools-recall-01 refused: the chat engine did not answer (${err.message}); failure shape: ${/ECONNREFUSED|refused/i.test(err.message) ? "refused" : /timeout|timed out/i.test(err.message) ? "hung" : "dropped"}. Check the engine is up, then run again.`);
  process.exit(2);
});
if (!probe.ok) {
  console.error(`tools-recall-01 refused: the chat engine answered HTTP ${probe.status}: ${(await probe.text()).slice(0, 200)}`);
  process.exit(2);
}
const engineHeaders = { "x-maipai-engine": probe.headers.get("x-maipai-engine") ?? "unknown", "x-maipai-model": probe.headers.get("x-maipai-model") ?? "unknown" };
const probeBody = (await probe.json().catch(() => ({}))) as { system_fingerprint?: string; model?: string };

const state = { variant: false, rewrittenLast: 0 };
const roleRow = (id: string, wire: string) => ({ id, label: id, wire, residency: "resident", endpoints: [], quality: ["everyday"], sharesModelWith: null, state: { state: "ready", reason: null }, reason: null, model: null, check: { state: "passed", at: null, reason: null, stale: false } });
const standIn = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  idleTimeout: 120,
  async fetch(req) {
    const path = new URL(req.url).pathname;
    if (req.method === "GET" && path === "/healthz") return Response.json({ ok: true, version: "tools-recall-01-stand-in", uptimeSeconds: 0 });
    if (req.method === "GET" && path === "/health") return Response.json({ status: "ok" });
    if (req.method === "GET" && path === "/stack/v1/roles") return Response.json({ roles: [roleRow("chat", "chat"), roleRow("judge", "chat"), roleRow("embed", "embeddings")] });
    if (req.method === "POST" && path === "/v1/embeddings") return Response.json({ error: "No engine is ready for role 'embed'.", role: "embed", state: "offline", offline_reason: "bench: embed is offline on the remote Stack" }, { status: 503, headers: engineHeaders });
    if (req.method === "POST" && path === "/v1/chat/completions") {
      let bodyText = await req.text();
      if (state.variant) {
        const out = rewriteToolDescriptions(bodyText, variantDescriptions);
        bodyText = out.body;
        state.rewrittenLast += out.rewritten;
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
const { setHouseholdSettingValue } = await import("@/lib/settings");
const { createConversation } = await import("@/lib/conversationHistory");

type TurnResult = { reply: string; error: string | null; totalMs: number };
/** One turn the way routes/turn.ts streams it, inside an existing conversation. */
async function streamTurnIn(actor: { id: string; role?: string }, conversationId: string, text: string, spoken: boolean): Promise<TurnResult> {
  const { runTurnNextStream } = await import("@/lib/turnMachine/turnNext");
  const { streamTurnEvents } = await import("@/routes/turn");
  const t0 = performance.now();
  const at = () => performance.now() - t0;
  let reply = "";
  try {
    const result = await runTurnNextStream(actor as never, "chat", text, { conversationId, spoken, thinking: false });
    if (!result.ok) return { reply: "", error: result.error, totalMs: at() };
    if (result.kind === "immediate") return { reply: result.value.reply.text, error: null, totalMs: at() };
    for await (const event of streamTurnEvents(result, actor.id, 900, undefined, true)) {
      if (event.type === "delta") reply += event.text;
      else if (event.type === "done") {
        if (reply.trim() === "") reply = event.value.reply.text;
      } else if (event.type === "error") return { reply, error: JSON.stringify(event).slice(0, 300), totalMs: at() };
    }
    return { reply, error: null, totalMs: at() };
  } catch (err) {
    return { reply, error: (err as Error).message, totalMs: at() };
  }
}
const withTimeout = (p: Promise<TurnResult>, what: string): Promise<TurnResult> =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`hung: no end of ${what} in 420 s`)), 420_000))]).catch((err: Error) => ({ reply: "", error: err.message, totalMs: 420_000 }));

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
  setHouseholdSettingValue("search.source_mode", "mix");
  const people = runner.createBenchPeople();

  const env = {
    date: new Date().toISOString(),
    engineBuild: engineHeaders["x-maipai-engine"],
    engineSystemFingerprint: probeBody.system_fingerprint ?? null,
    modelFile: engineHeaders["x-maipai-model"],
    modelId: probeBody.model ?? "chat",
    hardware: process.env.MAIPAI_KS_HARDWARE ?? "not recorded",
    baseCommit: process.env.MAIPAI_TR_BASE ?? "unrecorded",
    arms: ARMS, reps: REPS, bands: [...BANDS], rows: selected.length,
    variantFile, variantTools: Object.keys(variantDescriptions),
    thinking: "off (turn path sends thinking false)",
    order: "interleaved: within each repeat, every row runs all arms back to back",
    search: "loopback fixture rows only; live Wikipedia fallback pointed at an empty loopback server; embed refused at once",
    hub: "throwaway seeded backend in a fresh OS-temp data directory, two invented bench people",
  };
  console.log(JSON.stringify(env, null, 2));

  let runs: RunRecord[] = [];
  if (existsSync(RESULTS) && !process.argv.includes("--fresh")) runs = (JSON.parse(readFileSync(RESULTS, "utf-8")) as { runs: RunRecord[] }).runs;
  const done = new Set(runs.map((r) => `${r.arm}|${r.row}|${r.rep}`));
  let consecutiveErrors = 0;

  for (let rep = 1; rep <= REPS; rep++) {
    for (const row of selected) {
      for (const arm of ARMS) {
        if (done.has(`${arm}|${row.id}|${rep}`)) continue;
        console.log(`[tools-recall-01] rep ${rep}/${REPS} ${row.id} ${arm}`);
        const actor = row.band === "child" ? people.child : people.owner;
        const created = createConversation(actor as never, { surface: "chat" });
        if (!created.ok) throw new Error(`createConversation: ${created.error}`);
        state.variant = false;
        // A follow-up's prior turn runs first, on the base wire, so both arms see the same kind of history.
        let priorError: string | null = null;
        if (row.priorUser) {
          const pr = await withTimeout(streamTurnIn(actor, created.value.id, row.priorUser, false), "prior turn");
          priorError = pr.error;
        }
        state.variant = arm === "variant";
        state.rewrittenLast = 0;
        proxy.reset();
        const queriesBefore = fixtureSearch.queries.length;
        const turn: TurnResult = priorError ? { reply: "", error: `prior turn failed: ${priorError}`, totalMs: 0 } : await withTimeout(streamTurnIn(actor, created.value.id, row.prompt, row.band === "spoken"), "turn");
        state.variant = false;
        await proxy.settled().catch(() => {});
        const requests: RecordedRequest[] = proxy.requests.map((q) => ({ ...q }));
        const answering = requests.filter((q) => !q.responseFormat);
        const first = answering.find((q) => q.tools.length > 0) ?? null;
        runs.push({
          arm, row: row.id, rep, band: row.band, kind: row.kind, heldOut: row.heldOut, prompt: row.prompt,
          reply: turn.error ? "" : turn.reply, totalMs: turn.totalMs, error: turn.error, priorError,
          firstCalls: (first?.toolCalls ?? []).map((c) => c.name),
          laterCalls: answering.filter((q) => q !== first).flatMap((q) => q.toolCalls.map((c) => c.name)),
          fixtureQueries: fixtureSearch.queries.length - queriesBefore,
          toolsOffered: first ? first.tools.length : null, promptTokens: first?.promptTokens ?? null, engineRequests: requests.length, rewritten: state.rewrittenLast,
        });
        consecutiveErrors = turn.error ? consecutiveErrors + 1 : 0;
        save(runs, env);
        if (consecutiveErrors >= 5) {
          console.error(`[tools-recall-01] STOPPED: 5 runs in a row failed (last error: ${runs.at(-1)?.error}). Engine failure shape: ${await failureShape()}. Fix the engine and run again; the run resumes from results.json.`);
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
