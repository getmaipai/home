// ASSIST-BENCH-01: does the widened `remind` and `timer` schema (backend/packages/*/args.widened.json, switched by the
// household setting tools.assist.widened) hold up as a tool decision? Rule 13 and the design note
// docs/plans/assistant-tools-lists-reminders-alarms-2026-10-30.md section 5.
//
// What it does, per chat model (rule 8: one record per model id):
//   1. Runs every utterance of datasets/assist-tools.json (120 rows: lists, reminders, alarms, 20 negatives; half dev,
//      half held-out) through the real default turn path (runConversation from conversationRunner.ts, an adult owner,
//      chat surface, fixture search, memory judge off), at least 3 repeats, once with the widened schema ON and once
//      OFF, alternating which goes first. A row with `context` replays its earlier turns with scripted answers first.
//   2. Scores each run (assistToolsScore.ts): right tool, right action, key words in the arguments, a question when the
//      name is ambiguous (clarify rows), no remind or timer call on negatives.
//   3. Prints paired 95% intervals, widened-on minus widened-off, on the SAME rows, per split, and judges the bar:
//      held-out tool+action >= 95% and no call on negatives >= 95%.
//   4. With --regression it also shells out to chat-ab-01.ts (fresh websearch rows, child rows, spoken rows) with the
//      widened setting off and on, and checks that no existing row set gets worse (paired interval low end >= -5 points).
//      chat-ab-01 has no companion-voice group, so that row set is not covered here.
//   5. Writes data-scratch/assist-bench/<model>/results.json (override the folder with MAIPAI_ASSIST_OUT).
//
// Run it only when the machine is quiet: the Stack on 127.0.0.1:8770 is shared with the live hub. Use the wrapper,
// which waits for gates, checks 8770, uses fixture search and a temp data dir:
//
//   bash backend/scripts/bench/assist-tools-studio.sh            (add --regression, --reps 5, --only li-01,li-02)
//
// By hand, from backend/:
//
//   MAIPAI_DATA_DIR=<empty dir under the OS temp root> \
//   MAIPAI_BENCH_SEARCH=fixture \
//   MAIPAI_LLAMA_SERVER_URL=http://127.0.0.1:8770 MAIPAI_EMBED_URL=http://127.0.0.1:8770 \
//   bun run scripts/bench/assist-tools-bench.ts [--reps N] [--only id,id] [--split dev|heldout] [--arms on,off] [--regression]
//
// No engine needed: `--list` prints the dataset counts; `--report <results.json>` re-scores a saved file and prints the
// verdict (it does not rerun the regression arms; their saved verdicts are printed from the file).
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import dataset from "./datasets/assist-tools.json";
import { buildReport, freshRates, judgeRegression, okRate, renderReport, scoreRow, type ArmRun, type AssistRow, type Arm, type RegressionVerdict } from "./assistToolsScore";

const rows = dataset.rows as AssistRow[];
const argAfter = (flag: string): string | undefined => {
  const at = process.argv.indexOf(flag);
  return at < 0 ? undefined : process.argv[at + 1];
};
const MIN_REPS = 3;
const REPS = Math.max(MIN_REPS, Number(argAfter("--reps") ?? MIN_REPS));
const ONLY = argAfter("--only") ? new Set(argAfter("--only")!.split(",").map((s) => s.trim()).filter(Boolean)) : null;
const SPLIT = argAfter("--split") as "dev" | "heldout" | undefined;
const ARMS = (argAfter("--arms") ?? "on,off").split(",").map((s) => s.trim()).filter(Boolean) as Arm[];
const WANT_REGRESSION = process.argv.includes("--regression");
const WIDENED_KEY = "tools.assist.widened";

function safeName(model: string): string {
  return model.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "unknown-model";
}
function outDirFor(model: string): string {
  return join(process.env.MAIPAI_ASSIST_OUT ?? join(process.cwd(), "..", "data-scratch", "assist-bench"), safeName(model));
}

if (process.argv.includes("--list")) {
  const count = (pick: (r: AssistRow) => boolean) => rows.filter(pick).length;
  for (const area of ["lists", "reminders", "alarms", "negatives"]) {
    console.log(`${area}: ${count((r) => r.area === area)} rows (${count((r) => r.area === area && r.split === "dev")} dev, ${count((r) => r.area === area && r.split === "heldout")} held-out)`);
  }
  console.log(`total ${rows.length}, with context ${count((r) => r.context !== undefined)}, clarify ${count((r) => r.kind === "clarify")}`);
  process.exit(0);
}

interface SavedFile {
  model: string;
  environment: Record<string, unknown>;
  runs: ArmRun[];
  regressions: RegressionVerdict[];
}

if (argAfter("--report")) {
  const saved = JSON.parse(readFileSync(argAfter("--report")!, "utf-8")) as SavedFile;
  const rescored = saved.runs.map((run) => ({ ...run, score: scoreRow(rows.find((r) => r.id === run.rowId)!, { calls: run.calls, reply: run.reply, error: run.error }) }));
  console.log(renderReport(saved.model, buildReport(rows, rescored), saved.regressions ?? []));
  process.exit(0);
}

// ---- the regression arms: chat-ab-01 with the widened setting off and on ----

function runChatAb(group: "fresh" | "child" | "spoken", widened: boolean, outRoot: string): { item: string; reply: string; error: string | null; fresh?: { kind: string; evidenceFired: boolean } }[] {
  const dataDir = mkdtempSync(join(tmpdir(), "assist-bench-regress-"));
  const out = join(outRoot, widened ? "on" : "off", group);
  try {
    const args = ["run", "scripts/bench/chat-ab-01.ts", "--group", group, "--runs", String(REPS)];
    if (group === "spoken") args.push("--only", "k4-seasons,r2-quarters");
    console.log(`[assist-bench] regression: chat-ab-01 --group ${group}, widened ${widened ? "on" : "off"}`);
    const result = spawnSync("bun", args, {
      cwd: process.cwd(),
      env: { ...process.env, MAIPAI_DATA_DIR: dataDir, MAIPAI_AB_OUT: out, MAIPAI_AB_SETTINGS: JSON.stringify({ [WIDENED_KEY]: widened }) },
      stdio: "inherit",
    });
    if (result.status !== 0) throw new Error(`chat-ab-01 --group ${group} exited ${result.status}`);
    return (JSON.parse(readFileSync(join(out, "results.json"), "utf-8")) as { runs: { item: string; reply: string; error: string | null; fresh?: { kind: string; evidenceFired: boolean } }[] }).runs;
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
}

function regressionArms(outRoot: string): RegressionVerdict[] {
  const verdicts: RegressionVerdict[] = [];
  const fresh = { off: runChatAb("fresh", false, outRoot), on: runChatAb("fresh", true, outRoot) };
  verdicts.push(judgeRegression("websearch decisions (fresh rows)", freshRates(fresh.on), freshRates(fresh.off)));
  for (const group of ["child", "spoken"] as const) {
    const off = runChatAb(group, false, outRoot);
    const on = runChatAb(group, true, outRoot);
    verdicts.push(judgeRegression(`${group} rows answered`, okRate(on), okRate(off)));
  }
  return verdicts;
}

// ---- the live run ----

const { refuseIfGateRunning } = await import("./liveHubQuiet");
refuseIfGateRunning("assist-tools-bench");
const chatUrl = process.env.MAIPAI_LLAMA_SERVER_URL;
const embedUrl = (process.env.MAIPAI_EMBED_URL ?? "").replace(/\/$/, "");
if (!chatUrl || !embedUrl) {
  console.error("assist-tools-bench refused: MAIPAI_LLAMA_SERVER_URL and MAIPAI_EMBED_URL must name an engine that is already running.");
  process.exit(2);
}
if (process.env.MAIPAI_BENCH_SEARCH !== "fixture") {
  console.error("assist-tools-bench refused: MAIPAI_BENCH_SEARCH must be fixture; the bench never uses a real search service.");
  process.exit(2);
}
const directUrl = chatUrl.replace(/\/$/, "");
const { startFixtureSearch } = await import("./fixtureSearch");
const { startRecordingProxy } = await import("./recordingProxy");
const genericFixture = {
  id: "assist-generic",
  prompt: "general answer",
  fixture: { as_of: "2026-10-08", title: "general answer", content: "Recorded bench evidence. It carries no live facts." },
};
const fixtureSearch = startFixtureSearch([genericFixture], "fixture");
const proxy = startRecordingProxy(chatUrl);

// A thin stand-in for the Stack on a loopback port, as chat-ab-01 builds: healthz and roles answered here, chat
// completions forwarded through the recording proxy, embeddings forwarded to the embed engine. It adds no behaviour.
const probeBody = { model: "chat", messages: [{ role: "user", content: "Say hi" }], max_tokens: 4, stream: false, chat_template_kwargs: { enable_thinking: false } };
const probe = await fetch(`${directUrl}/v1/chat/completions`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(probeBody),
  signal: AbortSignal.timeout(240_000),
});
if (!probe.ok) {
  console.error(`assist-tools-bench refused: the Stack's chat role answered ${probe.status}.`);
  process.exit(2);
}
const engineHeaders = { "x-maipai-engine": probe.headers.get("x-maipai-engine") ?? "unknown", "x-maipai-model": probe.headers.get("x-maipai-model") ?? "unknown" };
await probe.text();
const roleRow = (id: string, wire: string) => ({
  id, label: id, wire, residency: "resident", endpoints: [], quality: ["everyday"], sharesModelWith: null,
  state: { state: "ready", reason: null }, reason: null, model: null,
  check: { state: "passed", at: null, reason: null, stale: false },
});
const stackStandIn = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  idleTimeout: 120,
  async fetch(req) {
    const path = new URL(req.url).pathname;
    if (req.method === "GET" && path === "/healthz") return Response.json({ ok: true, version: "assist-bench-stand-in", uptimeSeconds: 0 });
    if (req.method === "GET" && path === "/health") return Response.json({ status: "ok" });
    if (req.method === "GET" && path === "/stack/v1/roles") return Response.json({ roles: [roleRow("chat", "chat"), roleRow("judge", "chat"), roleRow("embed", "embeddings")] });
    if (req.method === "POST" && (path === "/v1/chat/completions" || path === "/v1/embeddings")) {
      const target = path === "/v1/chat/completions" ? proxy.url : embedUrl;
      const upstream = await fetch(`${target.replace(/\/$/, "")}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: await req.text(), signal: req.signal });
      return new Response(upstream.body, { status: upstream.status, headers: { "content-type": upstream.headers.get("content-type") ?? "application/json", ...engineHeaders } });
    }
    return new Response("not found", { status: 404 });
  },
});
process.env.MAIPAI_LLAMA_SERVER_URL = stackStandIn.url.toString().replace(/\/$/, "");
process.env.MAIPAI_EMBED_URL = process.env.MAIPAI_LLAMA_SERVER_URL;

const setup = await import("./setup");
const runner = await import("./conversationRunner");
const { setHouseholdSettingValue } = await import("@/lib/settings");
const { loadManifestOnly } = await import("@/lib/plugins");
const people = runner.createBenchPeople();
const log = runner.captureTurnLog();
const homeAssistant = runner.startFakeHomeAssistant();

function setWidened(on: boolean): void {
  const set = setHouseholdSettingValue(WIDENED_KEY, on);
  if (!set.ok) throw new Error(`could not set ${WIDENED_KEY}: ${set.error}`);
  const loaded = loadManifestOnly("remind");
  const hasAction = loaded.ok && JSON.stringify(loaded.value.args ?? {}).includes('"action"');
  if (!loaded.ok || hasAction !== on) throw new Error(`the model-facing remind schema did not switch ${on ? "on" : "off"}; stopping rather than measuring the wrong thing`);
}

async function runRow(row: AssistRow): Promise<{ calls: { tool: string; args: Record<string, unknown> }[]; reply: string; error: string | null }> {
  const turns = [
    ...(row.context ?? []).map((c) => ({ say: c.user, seedReply: c.assistant, expect: { humanVerdict: true } })),
    { say: row.utterance, expect: { humanVerdict: true } },
  ];
  const run = await runner.runConversation(
    { id: `assist-${row.id}`, category: "tools", note: "ASSIST-BENCH-01", turns },
    { people, proxy, log, drainJudge: async () => {}, backdate: () => {}, homeAssistant },
  );
  const last = run.scores[run.scores.length - 1];
  const reply = last?.observed.reply ?? "";
  const failed = /^\[error: /.test(reply);
  // The proxy was reset at the start of the last turn, so its requests are that turn's.
  const calls = proxy.requests.flatMap((request) => request.toolCalls).map((call) => {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(call.arguments) as Record<string, unknown>;
    } catch {
      args = { expression: call.arguments };
    }
    return { tool: call.name, args };
  });
  return { calls, reply: failed ? "" : reply, error: failed ? reply : null };
}

async function main(): Promise<void> {
  await setup.startBench();
  setHouseholdSettingValue("chat.model_id", process.env.MAIPAI_REPLAY_MODEL_ID ?? "qwen3-8b-instruct-q4-k-m");
  const set = setHouseholdSettingValue("search.searxng_url", fixtureSearch.url);
  if (!set.ok) throw new Error(`could not point search at the fixture: ${set.error}`);
  const roles = (await (await fetch(`${directUrl}/stack/v1/roles`)).json()) as { roles?: { id: string; model?: { id?: string } | null }[] };
  const model = roles.roles?.find((r) => r.id === "chat")?.model?.id ?? engineHeaders["x-maipai-model"];
  const outDir = outDirFor(model);
  mkdirSync(outDir, { recursive: true });
  const environment = {
    date: new Date().toISOString(),
    model,
    engineBuild: engineHeaders["x-maipai-engine"],
    modelFile: engineHeaders["x-maipai-model"],
    reps: REPS,
    arms: ARMS,
    split: SPLIT ?? "all",
    rows: rows.length,
    search: "fixture",
    thinking: "off (pipeline default)",
  };
  console.log(JSON.stringify(environment, null, 2));

  const selected = rows.filter((row) => (!ONLY || ONLY.has(row.id)) && (!SPLIT || row.split === SPLIT));
  const runs: ArmRun[] = [];
  const save = (regressions: RegressionVerdict[]) => writeFileSync(join(outDir, "results.json"), JSON.stringify({ model, environment, runs, regressions } satisfies SavedFile, null, 2));
  for (let rep = 1; rep <= REPS; rep++) {
    // Alternate which arm goes first, so drift in the machine hits both alike.
    const order = rep % 2 === 1 ? ARMS : [...ARMS].reverse();
    for (const row of selected) {
      for (const arm of order) {
        setWidened(arm === "on");
        console.log(`[assist-bench] rep ${rep}/${REPS} ${row.id} widened ${arm}`);
        const observed = await runRow(row);
        runs.push({ rowId: row.id, rep, arm, calls: observed.calls, reply: observed.reply, error: observed.error, score: scoreRow(row, observed) });
        save([]);
      }
    }
  }
  setWidened(false);
  const regressions = WANT_REGRESSION ? regressionArms(join(outDir, "regression")) : [];
  save(regressions);
  console.log(renderReport(model, buildReport(selected, runs), regressions));
  console.log(`wrote ${join(outDir, "results.json")}`);
  runner.cleanupBenchPeople(people);
  setup.finishBench({ executed: runs.length, engine: `${engineHeaders["x-maipai-engine"]} ${engineHeaders["x-maipai-model"]}` });
}

try {
  await main();
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  log.stop();
  homeAssistant.stop();
  fixtureSearch.stop();
  stackStandIn.stop(true);
  proxy.stop();
  if (process.exitCode) process.exit(process.exitCode as number);
}
