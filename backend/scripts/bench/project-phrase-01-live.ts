import "../../../scripts/runTemp";
// PROJECT-PHRASE-01's own live acceptance (docs/dev.md, 2026-09-27): the
// work order's own item #2 - "one real, live, end-to-end run ... offer a
// bedtime storybook, confirm with a plain 'yes', and read the ACTUAL
// final reply text that comes back." Drives the real turn machine
// (runTurnNext(), never a stub) through the REAL bundled bedtime-
// storybook package (backend/packages/bedtime-storybook/), the exact
// two-turn shape of the live incident: an initial request that parks a
// confirmation ask, then a plain "yes" that resumes it under the
// household's own real budget (qwen3-8b-instruct-q4-k-m, model_
// transitions: true, rounds: 1) - the one budget shape that let the
// broken phrasing round run at all.
//
// CHAT-22 (setup.ts): never touches the household's own live-serving
// ports. MAIPAI_LLAMA_SERVER_URL/MAIPAI_EMBED_URL must name a side
// engine started on a SPARE port for this run alone - never
// 127.0.0.1:8787 (the hub) or 127.0.0.1:8788/8794 (the household's own
// chat/embed engines). This script never spawns one itself; start one
// by hand first, e.g.:
//
//   /path/to/llama-server --model qwen3-8b-instruct-q4-k-m.gguf --port 28788 --host 127.0.0.1 -fa on -ngl all --jinja
//   /path/to/llama-server --model nomic-embed-text-v1.5.Q4_K_M.gguf --embedding --port 28794 --host 127.0.0.1
//
//   MAIPAI_DATA_DIR=$(mktemp -d) \
//   MAIPAI_LLAMA_SERVER_URL=http://127.0.0.1:28788 \
//   MAIPAI_EMBED_URL=http://127.0.0.1:28794 \
//   bun run backend/scripts/bench/project-phrase-01-live.ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (!process.env.MAIPAI_DATA_DIR) process.env.MAIPAI_DATA_DIR = mkdtempSync(join(tmpdir(), "project-phrase-01-live-"));

const setup = await import("./setup");
await setup.startBench();

const { createBenchPeople } = await import("./conversationRunner");
const { setHouseholdSettingValue } = await import("@/lib/settings");
const { runTurnNext } = await import("@/lib/turnMachine/turnNext");
const { registerAllPackageProjectTypes } = await import("@/lib/plugins");
const { getPendingAsk } = await import("@/lib/conversationHistory");
const { db } = await import("@/db");
const { conversationTurns } = await import("@/db/schema");
const { eq } = await import("drizzle-orm");

async function main(): Promise<void> {
  console.log(`[project-phrase-01-live] MAIPAI_DATA_DIR=${process.env.MAIPAI_DATA_DIR}`);

  // The real production loader - registers the real bundled
  // backend/packages/bedtime-storybook/ manifest+plan.json, the same
  // package Jesse's own real turn actually started, never a test
  // fixture.
  registerAllPackageProjectTypes();

  // The household's own one real catalog budget - deliberately NOT an
  // unrecognized model id (that would force NO_RECORD_BUDGET,
  // model_transitions: false, and mask this exact bug the way
  // PROJECT-REPLY-01's own test had to for a different reason). This is
  // the one setting whose real value determines whether the phrasing
  // round runs at all.
  setHouseholdSettingValue("chat.model_id", "qwen3-8b-instruct-q4-k-m");

  const people = createBenchPeople();

  console.log("\n[project-phrase-01-live] turn 1: offering a bedtime storybook (Jesse's own real wording)\n");
  const first = await runTurnNext(people.owner, "chat", "write my kid a bedtime story about a shy dragon who's scared of the dark");
  if (!first.ok || first.kind !== "immediate") {
    console.error(`[project-phrase-01-live] REFUSED: turn 1 did not come back as an immediate reply: ${JSON.stringify(first)}`);
    process.exit(1);
  }
  console.log(`[project-phrase-01-live] turn 1 reply (source=${first.value.source}): ${JSON.stringify(first.value.reply.text)}`);

  const ask = getPendingAsk(first.value.conversation_id);
  if (!ask) {
    console.error("[project-phrase-01-live] REFUSED: no pending ask was parked - the model may not have offered start_project this run (a real model-choice variance, not necessarily this fix's own concern); rerun.");
    process.exit(1);
  }
  console.log(`[project-phrase-01-live] parked ask: packageId=${ask.packageId} args=${JSON.stringify(ask.args)}`);

  console.log("\n[project-phrase-01-live] turn 2: confirming with a plain \"yes\"\n");
  const second = await runTurnNext(people.owner, "chat", "yes", { conversationId: first.value.conversation_id });
  if (!second.ok || second.kind !== "immediate") {
    console.error(`[project-phrase-01-live] REFUSED: turn 2 did not come back as an immediate reply: ${JSON.stringify(second)}`);
    process.exit(1);
  }

  const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, second.value.turn_id)).get();
  const stats = row?.stats ? (JSON.parse(row.stats as unknown as string) as { nodes?: { node: string; outcome?: { skipped?: boolean } }[] }) : { nodes: [] };
  const modelInvocations = (stats.nodes ?? []).filter((n) => n.node === "model" && n.outcome?.skipped !== true).length;

  console.log(`\n[project-phrase-01-live] turn 2 reply (source=${second.value.source}, plugin_id=${second.value.plugin_id ?? "n/a"}): ${JSON.stringify(second.value.reply.text)}`);
  console.log(`[project-phrase-01-live] real model invocations on the resumed turn: ${modelInvocations} (0 is the fixed behavior; 1+ means a phrasing round ran)`);

  const looksGarbled = /answer your question completely|solely on the results|as an ai/i.test(second.value.reply.text);
  const looksLikeTheOutcome = /^Starting .+ now/i.test(second.value.reply.text);
  console.log(`\nVERDICT: ${looksLikeTheOutcome && !looksGarbled ? "the resumed reply names the started project in plain words, matching the tool's own outcome text - the live incident's symptom is gone." : "the resumed reply does NOT look like the tool's own outcome text - a real finding, not swept under a passing exit code."}`);
  console.log(`\nbench finished: data directory ${process.env.MAIPAI_DATA_DIR} (disposable, left in place for inspection)`);
  if (!looksLikeTheOutcome || looksGarbled) process.exit(1);
}

await main();
