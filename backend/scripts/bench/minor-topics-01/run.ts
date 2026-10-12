// MINOR-TOPICS-01g: the live runner and the offline report for the minor-topics bench.
//
//   Live (needs a running Stack; never part of check.sh):
//     MAIPAI_LLAMA_SERVER_URL=<the Stack's chat role URL> \
//     MAIPAI_REPLAY_MODEL_ID=<default chat model id> \
//     bun run scripts/bench/minor-topics-01/run.ts --models <default>,<second catalog model> \
//       --reps 3 [--bands child,teen] [--surfaces written,spoken] [--only id,id] [--limit N] [--fresh]
//   Offline report from files already in the out dir (no Stack needed):
//     bun run scripts/bench/minor-topics-01/run.ts --report
//
// Files in MAIPAI_TOPICS_OUT (default ../data-scratch/chat-ab/minor-topics-01):
//   results.json          every run, written as the bench goes (a rerun resumes unless --fresh)
//   label-sheet.json      the replies a person must read, blinded (no arm, model or setting); copy to labels.json and fill in the label per key
//   label-key.json        key to run id; the labeller does not open it
//   labels.json           { "<sheet key>": { violations: [], stanceOk, refused, leaked, honest, tookSide } }
//   static-evidence.json  { "adult_prompt_identical": { pass, source }, "check_safety_identical": {...}, "access": {...} }
//   report.json / report.md  the verdict; the item closes only when `closes` is true
//
// Baseline means "today": the same turn with the topic block removed from the prompt on the wire, in this
// bench's own shim. No production switch turns a child protection off, and none is added for this.
// Import order matters: the shim and recording proxy must sit in front of the engine before setup.ts reads
// MAIPAI_LLAMA_SERVER_URL, and setup.ts must load before anything reaches "@/db".
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startRecordingProxy } from "../recordingProxy";
import { refuseIfGateRunning } from "../liveHubQuiet";
import type { Row } from "./schema";
import { buildReport, type CheckId, type Label, type Labels, type Report, type Surface, type StaticEvidence, type TopicRun } from "./score";
import { coverageFor, defaultCombo, labelSheet, labelsByRun, runBench, settingCombos, type Respond, type SettingCombo } from "./harness";

const argv = process.argv.slice(2);
const argOf = (name: string): string | undefined => { const i = argv.indexOf(name); return i === -1 ? undefined : argv[i + 1]; };
const OUT_DIR = process.env.MAIPAI_TOPICS_OUT ?? join(process.cwd(), "..", "data-scratch", "chat-ab", "minor-topics-01");
const RESULTS = join(OUT_DIR, "results.json");
const readJson = <T>(file: string, fallback: T): T => (existsSync(file) ? (JSON.parse(readFileSync(file, "utf-8")) as T) : fallback);

function loadRows(): Row[] {
  const dir = import.meta.dir;
  return ["child.jsonl", "teen.jsonl"].flatMap((f) => readFileSync(join(dir, f), "utf-8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Row));
}

function renderMd(r: Report): string {
  const lines = [`# Minor topics bench: ${r.closes ? "PASS, the item may close" : "NOT closed"}`, ""];
  if (r.reasons.length) lines.push("Reasons it is not closed:", ...r.reasons.map((x) => `- ${x}`), "");
  lines.push("## Zero-tolerance checks", ...r.checks.map((c) => `- ${c.id}: ${c.status} (${c.evidence}, n=${c.n})`), "");
  lines.push(`## Stance compliance: ${r.stance.status}`, ...r.stance.cells.map((c) => `- ${c.cell}: ${c.status}, block ${c.block ? `${c.block.lowPct}-${c.block.highPct}%` : "n/a"} (n=${c.n.block}), baseline ${c.baseline ? `${c.baseline.lowPct}-${c.baseline.highPct}%` : "n/a"} (n=${c.n.baseline})`), "");
  lines.push("## Over-refusal (block minus baseline, points)", ...r.overRefusal.map((o) => `- ${o.band}: ${o.status}${o.interval ? ` mean ${o.interval.meanDiffPct}, 95% ${o.interval.lowPct} to ${o.interval.highPct}, rows ${o.interval.n}` : ""}`), "");
  for (const m of [r.storyLeak, r.honest, r.sideTaking]) lines.push(`## ${m.name}: ${m.status === "ok" ? (m.pass ? "pass" : "fail") : m.status}`, m.w ? `- ${m.w.violations}/${m.w.n}, 95% ${m.w.lowPct} to ${m.w.highPct}% (${m.detail})` : `- ${m.detail}`, "");
  lines.push("## First-token latency (block minus baseline, ms)", ...r.latency.map((l) => `- ${l.surface} ${l.temp}: p50 ${l.p50Delta ?? "n/a"}, p95 ${l.p95Delta ?? "n/a"} (n ${l.n.block}/${l.n.baseline}): ${l.pass === null ? "no_evidence" : l.pass ? "pass" : "fail"}`), "");
  lines.push(`## Prompt tokens added: ${r.tokens.status}`, `- largest per-row increase ${r.tokens.maxAdded ?? "n/a"} over ${r.tokens.rows} rows (budget 260)`, "");
  return lines.join("\n");
}

type Records = { child: ReturnType<typeof settingCombos>; teen: ReturnType<typeof settingCombos> };

async function writeReport(runs: TopicRun[], combos: Records): Promise<Report> {
  // labels.json is keyed by the blinded sheet key; label-key.json maps a key to its run.
  const labels = labelsByRun(readJson<Record<string, Label>>(join(OUT_DIR, "labels.json"), {}), readJson<Record<string, string>>(join(OUT_DIR, "label-key.json"), {}));
  const statics = readJson<Partial<Record<CheckId, StaticEvidence>>>(join(OUT_DIR, "static-evidence.json"), {});
  const report = buildReport(runs, labels, statics, coverageFor(combos.child, combos.teen));
  writeFileSync(join(OUT_DIR, "report.json"), JSON.stringify(report, null, 2));
  writeFileSync(join(OUT_DIR, "report.md"), renderMd(report));
  return report;
}

async function bandRecords(): Promise<{ combos: Records; defaults: { child: SettingCombo; teen: SettingCombo } }> {
  const { getCeilingForBand } = await import("@/lib/contentCeiling");
  const out = {} as Records;
  const defaults = {} as { child: SettingCombo; teen: SettingCombo };
  for (const band of ["child", "teen"] as const) {
    const record = getCeilingForBand(band) as unknown as { topics?: Record<string, { stance: string; allowed: string[]; fixed?: boolean }>; family_stories?: { default?: string } };
    out[band] = settingCombos(band, record);
    defaults[band] = defaultCombo(band, record, out[band]);
  }
  return { combos: out, defaults };
}

if (argv.includes("--report")) {
  // The offline path needs the band records for the setting coverage; it loads the hub's ceiling module only.
  process.env.MAIPAI_DATA_DIR ??= mkdtempSync(join(tmpdir(), "minor-topics-report-"));
  const { combos } = await bandRecords();
  const runs = readJson<{ runs: TopicRun[] }>(RESULTS, { runs: [] }).runs;
  const report = await writeReport(runs, combos);
  console.log(renderMd(report));
  process.exit(report.closes ? 0 : 1);
}

// ==== live run ====
refuseIfGateRunning("minor-topics-01");
const upstream = process.env.MAIPAI_LLAMA_SERVER_URL?.replace(/\/$/, "");
if (!upstream) {
  console.error("minor-topics-01 refused: MAIPAI_LLAMA_SERVER_URL is not set. The bench connects only to an engine already running (the Stack's chat role); start the Stack and set it to the chat role's URL.");
  process.exit(2);
}
const MODELS = (argOf("--models") ?? process.env.MAIPAI_REPLAY_MODEL_ID ?? "").split(",").map((s) => s.trim()).filter(Boolean);
if (MODELS.length === 0) { console.error("minor-topics-01 refused: no model. Pass --models <default id>,<second catalog model id> (rule 13 asks for the default chat model plus one other)."); process.exit(2); }
const REPS = Math.max(1, Number(argOf("--reps") ?? 3));
if (!Number.isFinite(REPS)) { console.error("--reps must be a number, for example --reps 3"); process.exit(2); }
const SURFACES = (argOf("--surfaces") ?? "written,spoken").split(",").map((s) => s.trim()) as Surface[];
const BANDS = new Set((argOf("--bands") ?? "child,teen").split(",").map((s) => s.trim()));
const ONLY = argOf("--only") ? new Set(argOf("--only")!.split(",")) : null;
const LIMIT = argOf("--limit") ? Number(argOf("--limit")) : Infinity;
mkdirSync(OUT_DIR, { recursive: true });
if (!process.env.MAIPAI_DATA_DIR) process.env.MAIPAI_DATA_DIR = mkdtempSync(join(tmpdir(), "minor-topics-01-"));

// Between the hub and the recording proxy: removes the topic block from the prompt on the baseline arm only.
const state = { strip: "" as string, blockTokensSeen: 0 };
const shim = Bun.serve({
  port: 0, hostname: "127.0.0.1", idleTimeout: 120,
  async fetch(req) {
    const url = new URL(req.url);
    let body = req.method === "POST" ? await req.text() : undefined;
    if (body && state.strip && url.pathname === "/v1/chat/completions") body = body.split(JSON.stringify(state.strip).slice(1, -1)).join("");
    const headers = new Headers(req.headers);
    headers.delete("host"); headers.delete("content-length");
    return fetch(`${upstream}${url.pathname}${url.search}`, { method: req.method, headers, body, signal: req.signal });
  },
});
const proxy = startRecordingProxy(shim.url.toString().replace(/\/$/, ""));
const engineHeaders = { "x-maipai-engine": "unknown", "x-maipai-model": "unknown" };
const roleRow = (id: string, wire: string) => ({ id, label: id, wire, residency: "resident", endpoints: [], quality: ["everyday"], sharesModelWith: null, state: { state: "ready", reason: null }, reason: null, model: null, check: { state: "passed", at: null, reason: null, stale: false } });
const standIn = Bun.serve({
  port: 0, hostname: "127.0.0.1", idleTimeout: 120,
  async fetch(req) {
    const path = new URL(req.url).pathname;
    if (req.method === "GET" && path === "/healthz") return Response.json({ ok: true, version: "minor-topics-01-stand-in", uptimeSeconds: 0 });
    if (req.method === "GET" && path === "/health") return Response.json({ status: "ok" });
    if (req.method === "GET" && path === "/stack/v1/roles") return Response.json({ roles: [roleRow("chat", "chat"), roleRow("judge", "chat"), roleRow("embed", "embeddings")] });
    if (req.method === "POST" && path === "/v1/embeddings") return Response.json({ error: "No engine is ready for role 'embed'.", role: "embed", state: "offline", offline_reason: "bench: embed is offline" }, { status: 503, headers: engineHeaders });
    if (req.method === "POST" && path === "/v1/chat/completions") {
      const up = await fetch(`${proxy.url.replace(/\/$/, "")}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: await req.text(), signal: req.signal });
      return new Response(up.body, { status: up.status, headers: { "content-type": up.headers.get("content-type") ?? "application/json", ...engineHeaders } });
    }
    return new Response("not found", { status: 404 });
  },
});
process.env.MAIPAI_LLAMA_SERVER_URL = standIn.url.toString().replace(/\/$/, "");
process.env.MAIPAI_EMBED_URL = process.env.MAIPAI_LLAMA_SERVER_URL;

const setup = await import("./../setup");
const runner = await import("../conversationRunner");
const { setHouseholdSettingValue, setValue } = await import("@/lib/settings");
const { checkSafety } = await import("@maipai/spec/safety/ts/classifier.js");
const { topicBlockFor } = await import("@/lib/topicPrompt");
const { createConversation } = await import("@/lib/conversationHistory");

async function main(): Promise<void> {
  await setup.startBench();
  const people = runner.createBenchPeople();
  runner.addBenchTeen(people);
  const { combos, defaults } = await bandRecords();
  const all = loadRows().filter((r) => BANDS.has(r.band) && (!ONLY || ONLY.has(r.id)));
  // --limit applies per band so a smoke run reaches the teen path too.
  const rows = (["child", "teen"] as const).flatMap((b) => all.filter((r) => r.band === b).slice(0, LIMIT));
  const prior = readJson<{ runs: TopicRun[] }>(RESULTS, { runs: [] }).runs;
  // A resume keeps successful runs only: an errored turn is retried, never skipped.
  const runs: TopicRun[] = argv.includes("--fresh") ? [] : prior.filter((r) => r.error === null);
  const done = new Set(runs.map((r) => r.id));
  let currentModel = "";
  let currentCombo = "";

  // A cold turn needs an empty prompt cache: llama-server's slot erase. Where the engine does not offer it, no turn is
  // marked cold and the cold latency row reads no_evidence instead of passing on warm numbers.
  const resetCache = async (): Promise<boolean> => {
    try { return (await fetch(`${upstream}/slots/0?action=erase`, { method: "POST", signal: AbortSignal.timeout(10_000) })).ok; } catch { return false; }
  };

  const respond: Respond = async ({ arm, model, surface, row, combo, rep }) => {
    const actor = row.band === "child" ? people.child : people.teen!;
    if (model !== currentModel) { const m = setHouseholdSettingValue("chat.model_id", model); if (!m.ok) throw new Error(`could not set chat.model_id: ${m.error}`); currentModel = model; currentCombo = ""; }
    const comboKey = `${row.band}|${combo.id}`;
    if (comboKey !== currentCombo) {
      currentCombo = "";
      for (const [key, value] of Object.entries(combo.values)) {
        const w = row.band === "child" ? setValue(people.owner, `person:${actor.id}`, key, value) : setHouseholdSettingValue(key, value);
        if (!w.ok) throw new Error(`could not set ${key}=${value}: ${w.error}. Check that the bench owner is an admin and the value is in the band's range.`);
      }
      currentCombo = comboKey;
    }
    const block = topicBlockFor(row.band, row.band === "child" ? actor.id : undefined);
    state.strip = arm === "baseline" ? block : "";
    proxy.reset();
    const created = createConversation(actor as never, { surface: "chat" });
    if (!created.ok) throw new Error(`createConversation: ${created.error}`);
    const logs: string[] = [];
    const orig = { log: console.log, warn: console.warn, error: console.error, info: console.info };
    for (const k of Object.keys(orig) as (keyof typeof orig)[]) console[k] = (...a: unknown[]) => { logs.push(a.map(String).join(" ")); orig[k](...a); };
    const t0 = performance.now();
    let reply = ""; let error: string | null = null; let firstWordMs: number | null = null; let reasoningChars = 0; let crisisOverlay = false;
    try {
      const { runTurnNextStream } = await import("@/lib/turnMachine/turnNext");
      const { streamTurnEvents } = await import("@/routes/turn");
      const result = await runTurnNextStream(actor as never, "chat", row.text, { conversationId: created.value.id, spoken: surface === "spoken", thinking: false });
      if (!result.ok) error = result.error;
      else if (result.kind === "immediate") { reply = result.value.reply.text; firstWordMs = performance.now() - t0; crisisOverlay = !!(result.value as { crisis_support?: unknown }).crisis_support; }
      else for await (const event of streamTurnEvents(result, actor.id, 900, undefined, true)) {
        if (event.type === "reasoning") reasoningChars += event.text.length;
        else if (event.type === "delta") { reply += event.text; if (firstWordMs === null && event.text.trim()) firstWordMs = performance.now() - t0; }
        else if (event.type === "done") { if (reply.trim() === "") reply = event.value.reply.text; if (event.value && (event.value as { crisis_support?: unknown }).crisis_support) crisisOverlay = true; }
        else if (event.type === "error") { if ((event as { crisis_support?: unknown }).crisis_support || (event as { crisis_resources?: unknown }).crisis_resources) crisisOverlay = true; if (!reply) error = JSON.stringify(event).slice(0, 300); }
      }
    } catch (err) { error = (err as Error).message; }
    finally { Object.assign(console, orig); }
    await proxy.settled().catch(() => {});
    const answering = proxy.requests.filter((q) => !q.responseFormat);
    const promptTokens = answering[0]?.promptTokens ?? null;
    const blockLines = block.split("\n").filter((l) => l.length > 24);
    // A safety refusal that ends the turn with crisis text is a normal outcome, not an error run.
    if (crisisOverlay && error && !reply) error = null;
    void rep;
    return {
      reply, error, firstWordMs, promptTokens, reasoningChars,
      selfHarmTripped: checkSafety(row.text, { isMinor: true }).categories.includes("self_harm"),
      crisisOverlay,
      topicTextInLogs: blockLines.length > 0 && logs.some((l) => blockLines.some((b) => l.includes(b))),
    };
  };

  const fresh = await runBench({
    rows, combos, defaults, models: MODELS, surfaces: SURFACES, repeats: REPS, respond,
    skip: (id) => done.has(id),
    resetCache,
    onRun: (run) => { runs.push(run); if (runs.length % 25 === 0) writeFileSync(RESULTS, JSON.stringify({ runs }, null, 2)); },
  });
  void fresh;
  writeFileSync(RESULTS, JSON.stringify({ runs }, null, 2));
  const { sheet, keyMap } = labelSheet(runs, rows);
  writeFileSync(join(OUT_DIR, "label-sheet.json"), JSON.stringify(sheet, null, 2));
  writeFileSync(join(OUT_DIR, "label-key.json"), JSON.stringify(keyMap, null, 2));
  const report = await writeReport(runs, combos);
  console.log(renderMd(report));
  runner.cleanupBenchPeople(people);
  setup.finishBench({ executed: runs.length, engine: "minor-topics-01" });
}

await main();
process.exit(0);
