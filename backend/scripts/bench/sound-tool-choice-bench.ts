// COMPOSER-04 sound-mode acceptance bench: run the requested sound, song, and plain-question rows
// with and without the Sound effect composer mode. Uses the same Home turn path and Stack client
// as composer-hint-bench.ts; compares both tool selection and every non-music tool rate.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import dataset from "./datasets/sound-tool-choice.json";

const REPS = Math.max(3, Number(process.argv[process.argv.indexOf("--reps") + 1] ?? 3));
const OUT_DIR = process.env.MAIPAI_SOUND_BENCH_OUT ?? join(process.cwd(), "..", "data-scratch", "sound-tool-choice-bench");
const rows = dataset.rows;
const arms = ["off", "on"] as const;
type Arm = (typeof arms)[number];
type Run = { id: string; rep: number; arm: Arm; expected: string; calls: Array<{ packageId: string; args?: Record<string, unknown> }>; offered: number; error: string | null };

const { refuseIfGateRunning } = await import("./liveHubQuiet");
refuseIfGateRunning("sound-tool-choice-bench");
const stackUrl = process.env.MAIPAI_STACK_URL;
if (process.env.MAIPAI_BENCH_PASS !== "route" || !stackUrl) { console.error("sound-tool-choice-bench refused: set MAIPAI_BENCH_PASS=route and MAIPAI_STACK_URL to the running Stack; Home reads its own key."); process.exit(2); }
if (process.env.MAIPAI_BENCH_SEARCH !== "fixture") { console.error("sound-tool-choice-bench refused: MAIPAI_BENCH_SEARCH must be fixture."); process.exit(2); }

const { startFixtureSearch } = await import("./fixtureSearch");
const fixtureSearch = startFixtureSearch(rows.map((row) => ({ id: row.id, prompt: row.prompt })), "fixture");
const setup = await import("./setup");
const runner = await import("./conversationRunner");
const { setHouseholdSettingValue } = await import("@/lib/settings");
const { runTurnNext } = await import("@/lib/turnMachine/turnNext");
const { createConversation } = await import("@/lib/conversationHistory");
const { db } = await import("@/db");
const { conversationTurns } = await import("@/db/schema");
const { eq } = await import("drizzle-orm");
const people = runner.createBenchPeople();
const runs: Run[] = [];

async function runRow(row: (typeof rows)[number], rep: number, arm: Arm): Promise<void> {
  const conversation = createConversation(people.owner, { surface: "chat" });
  if (!conversation.ok) { runs.push({ id: row.id, rep, arm, expected: row.expected, calls: [], offered: 0, error: "no conversation" }); return; }
  const result = await runTurnNext(people.owner, "chat", row.prompt, { conversationId: conversation.value.id, ...(arm === "on" ? { composer: { mode: "sound" } } : {}) });
  if (!result.ok || result.kind !== "immediate") { runs.push({ id: row.id, rep, arm, expected: row.expected, calls: [], offered: 0, error: result.ok ? "unexpected stream" : String(result.code) }); return; }
  const stored = db.select().from(conversationTurns).where(eq(conversationTurns.id, result.value.turn_id)).get();
  const outcomes = JSON.parse(stored?.outcomes ?? "[]") as Array<{ packageId?: string; args?: Record<string, unknown> }>;
  const stats = JSON.parse(stored?.stats ?? "{}") as { tools_offered?: { count?: number } };
  runs.push({ id: row.id, rep, arm, expected: row.expected, calls: outcomes.flatMap((item) => item.packageId ? [{ packageId: item.packageId, args: item.args }] : []), offered: stats.tools_offered?.count ?? 0, error: null });
}

try {
  await setup.startBench();
  setHouseholdSettingValue("chat.model_id", process.env.MAIPAI_REPLAY_MODEL_ID ?? "qwen3-8b-instruct-q4-k-m");
  const search = setHouseholdSettingValue("search.searxng_url", fixtureSearch.url);
  if (!search.ok) throw new Error(`could not point search at the fixture: ${search.error}`);
  setHouseholdSettingValue("engines.stack.url", stackUrl);
  mkdirSync(OUT_DIR, { recursive: true });
  console.log(JSON.stringify({ model: "the Stack chat role", stack: "127.0.0.1:8770 (Home route)", reps: REPS, rows: rows.length, hint: { mode: "sound" }, search: "fixture" }, null, 2));
  for (let rep = 1; rep <= REPS; rep++) for (const row of rows) for (const arm of rep % 2 ? ["off", "on"] as const : ["on", "off"] as const) {
    console.log(`[sound-tool-choice-bench] rep ${rep}/${REPS} ${row.id} hint ${arm}`);
    await runRow(row, rep, arm);
    writeFileSync(join(OUT_DIR, "results.json"), JSON.stringify({ runs }, null, 2));
  }
  const pairs = rows.flatMap((row) => Array.from({ length: REPS }, (_, i) => {
    const off = runs.find((run) => run.id === row.id && run.rep === i + 1 && run.arm === "off");
    const on = runs.find((run) => run.id === row.id && run.rep === i + 1 && run.arm === "on");
    return off && on ? { row: row.id, expected: row.expected, off, on } : null;
  }).filter((pair): pair is NonNullable<typeof pair> => pair !== null));
  const wanted = (run: Run) => run.calls.some((call) => call.packageId === "generate_music" && (run.expected === "sound" ? call.args?.kind === "sound" : run.expected === "song" ? call.args?.kind !== "sound" : false));
  const otherCalls = (run: Run) => JSON.stringify(run.calls.filter((call) => call.packageId !== "generate_music").map((call) => call.packageId).sort());
  console.log(`correct generate_music selection: off ${pairs.filter((p) => wanted(p.off)).length}/${pairs.length}, on ${pairs.filter((p) => wanted(p.on)).length}/${pairs.length}`);
  console.log(`non-music tool calls unchanged: ${pairs.filter((p) => otherCalls(p.off) === otherCalls(p.on)).length}/${pairs.length} paired turns`);
  console.log(`offered counts unchanged: ${pairs.filter((p) => p.off.offered === p.on.offered).length}/${pairs.length} paired turns`);
  console.log(`runs ${runs.length}, errors ${runs.filter((run) => run.error).length}; wrote ${join(OUT_DIR, "results.json")}`);
  runner.cleanupBenchPeople(people);
  setup.finishBench({ executed: runs.length, engine: "the Stack chat role" });
} finally { fixtureSearch.stop(); }
