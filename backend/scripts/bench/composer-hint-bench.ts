// ONE-COMPOSER-2026-11-13 (COMPOSER-04, architect condition 6): does the chat composer's mode hint move any other tool's offer rate?
// Design note docs/design/one-composer-2026-11-13.md sections 4 and 4.1. Rules 1, 8 and 13 of docs/design/RULES.md.
//
// What it does: runs held-out rows through the real default turn path (runTurnNext, an adult owner, the written chat surface, fixture search,
// a fake picture engine so the picture tool is offered and no real picture is made, memory judge off), at least 3 repeats, once with the
// Picture hint on (`composer: { mode: "picture", settings: { shape, count, quality } }`) and once off, alternating which arm goes first.
// Rows: new picture requests and plain questions (datasets/composer-hint.json) and the CHAT-AB-01 fresh set (datasets/chat-ab-01.json,
// `fresh.items`: time-sensitive, timeless and hard-negative), which ships a dev split only, so a stable hash of the row id makes the
// held-out half. Only held-out rows are measured; nothing was tuned on any row. Prints the paired 95% interval (hint on minus off, over
// rows) of the picture-tool rate, the search decisions (hit and false search), and any other tool, and whether the offered tool list was the same.
//
// Run it only when the machine is quiet: the Stack on 127.0.0.1:8770 is shared with the live hub. By hand, from backend/:
//
//   MAIPAI_DATA_DIR=<empty dir under the OS temp root> MAIPAI_BENCH_SEARCH=fixture \
//   MAIPAI_BENCH_PASS=route MAIPAI_STACK_URL=http://127.0.0.1:8770 \
//   bun run scripts/bench/composer-hint-bench.ts [--reps N] [--per-group N] [--only id,id]
//
// The bench talks to the Stack only through Home's own Stack client, as every Home call does: the Stack refuses a request without Home's key,
// and Home reads that key itself. The bench never reads, prints or passes it. A turn's tool calls are read back from its stored outcomes.
//
// `--report <results.json>` re-scores a saved file. Results: data-scratch/composer-hint-bench/results.json (override with MAIPAI_COMPOSER_BENCH_OUT).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import dataset from "./datasets/composer-hint.json";
import chatAb from "./datasets/chat-ab-01.json";
import { hashSplit, renderReport, type Arm, type Group, type HintRun } from "./composerHintScore";

interface Row { id: string; group: Group; split: "dev" | "heldout"; prompt: string; fixture?: { as_of: string; title: string; content: string; url?: string } }
const freshRows: Row[] = (chatAb.fresh.items as { id: string; kind: string; prompt: string; fixture?: Row["fixture"] }[])
  .filter((item) => item.kind === "time-sensitive" || item.kind === "timeless" || item.kind === "hard-negative")
  .map((item) => ({ id: item.id, group: item.kind as Group, split: hashSplit(item.id), prompt: item.prompt, ...(item.fixture ? { fixture: item.fixture } : {}) }));
const allRows: Row[] = [...(dataset.rows as Row[]), ...freshRows];

const argAfter = (flag: string): string | undefined => { const at = process.argv.indexOf(flag); return at < 0 ? undefined : process.argv[at + 1]; };
const REPS = Math.max(3, Number(argAfter("--reps") ?? 3));
const PER_GROUP = argAfter("--per-group") ? Number(argAfter("--per-group")) : Infinity;
const ONLY = argAfter("--only") ? new Set(argAfter("--only")!.split(",").map((s) => s.trim()).filter(Boolean)) : null;
const OUT_DIR = process.env.MAIPAI_COMPOSER_BENCH_OUT ?? join(process.cwd(), "..", "data-scratch", "composer-hint-bench");
const HINT = { mode: "picture", settings: { shape: "square", count: 1, quality: "standard" } } as const;

function selectRows(): Row[] {
  const taken = new Map<Group, number>();
  return allRows.filter((row) => {
    if (row.split !== "heldout" || (ONLY && !ONLY.has(row.id))) return false;
    const n = taken.get(row.group) ?? 0;
    if (n >= PER_GROUP) return false;
    taken.set(row.group, n + 1);
    return true;
  });
}

if (process.argv.includes("--list")) {
  const rows = selectRows();
  for (const group of ["picture-request", "plain", "time-sensitive", "timeless", "hard-negative"] as Group[]) console.log(`${group}: ${rows.filter((r) => r.group === group).length} held-out rows (of ${allRows.filter((r) => r.group === group).length})`);
  process.exit(0);
}
if (argAfter("--report")) {
  const saved = JSON.parse(readFileSync(argAfter("--report")!, "utf-8")) as { runs: HintRun[] };
  console.log(renderReport(saved.runs));
  process.exit(0);
}

const { refuseIfGateRunning } = await import("./liveHubQuiet");
refuseIfGateRunning("composer-hint-bench");
const stackUrl = process.env.MAIPAI_STACK_URL;
if (process.env.MAIPAI_BENCH_PASS !== "route" || !stackUrl) { console.error("composer-hint-bench refused: set MAIPAI_BENCH_PASS=route and MAIPAI_STACK_URL to the running Stack. The Stack refuses a request that does not carry Home's key, so the bench goes through Home's own Stack client (which reads the key itself); the bench never reads, prints or passes the key."); process.exit(2); }
if (process.env.MAIPAI_BENCH_SEARCH !== "fixture") { console.error("composer-hint-bench refused: MAIPAI_BENCH_SEARCH must be fixture; the bench never uses a real search service."); process.exit(2); }
const { startFixtureSearch } = await import("./fixtureSearch");
const fixtureSearch = startFixtureSearch(allRows.map((row) => ({ id: row.id, prompt: row.prompt, ...(row.fixture ? { fixture: row.fixture } : {}) })), "fixture");

const setup = await import("./setup");
const runner = await import("./conversationRunner");
const { setHouseholdSettingValue } = await import("@/lib/settings");
const { runTurnNext } = await import("@/lib/turnMachine/turnNext");
const { createConversation } = await import("@/lib/conversationHistory");
const { installFakeImageStack } = await import("../../tests/pictureFixture");
const { db } = await import("@/db");
const { conversationTurns } = await import("@/db/schema");
const { eq } = await import("drizzle-orm");
const people = runner.createBenchPeople();

async function runRow(row: Row, arm: Arm): Promise<Pick<HintRun, "calls" | "offered" | "error">> {
  const conversation = createConversation(people.owner, { surface: "chat" });
  if (!conversation.ok) return { calls: [], offered: 0, error: "no conversation" };
  const result = await runTurnNext(people.owner, "chat", row.prompt, { conversationId: conversation.value.id, ...(arm === "on" ? { composer: HINT } : {}) });
  if (!result.ok || result.kind !== "immediate") return { calls: [], offered: 0, error: result.ok ? "unexpected stream" : String(result.code) };
  const stored = db.select().from(conversationTurns).where(eq(conversationTurns.id, result.value.turn_id)).get();
  const outcomes = JSON.parse(stored?.outcomes ?? "[]") as { packageId?: string }[];
  const stats = JSON.parse(stored?.stats ?? "{}") as { tools_offered?: { count?: number } };
  return { calls: outcomes.flatMap((o) => (o.packageId ? [o.packageId] : [])), offered: stats.tools_offered?.count ?? 0, error: null };
}

async function main(): Promise<void> {
  await setup.startBench();
  setHouseholdSettingValue("chat.model_id", process.env.MAIPAI_REPLAY_MODEL_ID ?? "qwen3-8b-instruct-q4-k-m");
  const set = setHouseholdSettingValue("search.searxng_url", fixtureSearch.url);
  if (!set.ok) throw new Error(`could not point search at the fixture: ${set.error}`);
  const fake = installFakeImageStack();
  setHouseholdSettingValue("engines.stack.url", stackUrl!);
  const model = "the Stack's chat role";
  mkdirSync(OUT_DIR, { recursive: true });
  const rows = selectRows();
  const environment = { date: new Date().toISOString(), model, stack: "127.0.0.1:8770 (Home route)", reps: REPS, rows: rows.length, hint: HINT, search: "fixture", pictures: "fake picture engine (nothing is made)", thinking: "off (pipeline default)", load: "other sessions' gates ran beside it; rates are not timings" };
  console.log(JSON.stringify(environment, null, 2));
  const runs: HintRun[] = [];
  const save = () => writeFileSync(join(OUT_DIR, "results.json"), JSON.stringify({ model, environment, runs }, null, 2));
  for (let rep = 1; rep <= REPS; rep++) {
    const order: Arm[] = rep % 2 === 1 ? ["off", "on"] : ["on", "off"];
    for (const row of rows) for (const arm of order) {
      console.log(`[composer-hint-bench] rep ${rep}/${REPS} ${row.id} hint ${arm}`);
      const observed = await runRow(row, arm);
      runs.push({ rowId: row.id, group: row.group, rep, arm, ...observed });
      fake.submitted.length = 0;
      save();
    }
  }
  console.log(renderReport(runs));
  console.log(`wrote ${join(OUT_DIR, "results.json")}`);
  fake.restore();
  runner.cleanupBenchPeople(people);
  setup.finishBench({ executed: runs.length, engine: "the Stack chat role" });
}

try {
  await main();
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  fixtureSearch.stop();
  if (process.exitCode) process.exit(process.exitCode as number);
}
