// Memory judge bench (MEM-05: "Prove the small judge, or fall back to the 4B pin").
// Not part of scripts/check.sh - a bench, run on demand against a running
// background engine (MAIPAI_BACKGROUND_URL). Reports extraction precision
// and recall per seeded turn (#87, scripts/bench/judgeScore.ts: expected
// facts against the memory records the judge WROTE for that turn, so a
// fact extracted and then dropped by the dedupe decision reads as a miss
// here and as a supersede fault in the retrieval scenarios), the two
// retrieval scenarios separately, and seconds per turn, beside the 8B
// baseline to decide whether the 1.7B pin meets the cutoff.
//
// LongMemEval (Wu et al. 2026) names five failure categories for a
// memory-augmented assistant; this bench exercises the two the plan
// calls out by name:
// - Knowledge update: an earlier fact is later CONTRADICTED by a newer
//   one (a job change) - the assistant must answer with the new fact,
//   not the stale one, and the old record must no longer be active.
// - Abstention: asked about something never stated, the assistant must
//   recall NOTHING rather than hallucinate an answer. Recall() itself
//   can't hallucinate content (it only ever returns rows that exist),
//   so this checks the more basic and equally real failure mode: that
//   nothing ever gets remembered from a passing, unconfirmed mention -
//   the judge's own SOURCE RULE.
//
// Runs against the background engine (use MAIPAI_LLAMA_SERVER_URL or
// MAIPAI_LLAMA_SERVER_BIN + MAIPAI_CHAT_MODEL_PATH to point at the judge
// model). Record the precision/recall/seconds output; keep 1.7B if recall
// is at least 85% of the 8B baseline and precision within 5 points.
//
// MEM-AUDIT-06: `--dataset memory-household-01` runs the household fixture
// (scripts/bench/datasets/memory-household-01.json) instead of the seeded
// scenarios above: every case is logged with its real turn signal and the
// insert-time judge status, so the gate, the clause citation and the
// rejectors are all measured, and precision and recall are printed from
// the same scorer. Against the Stack shared with the live hub:
//   MAIPAI_DATA_DIR=$(mktemp -d -t judge-eval) MAIPAI_BENCH_UPSTREAM=stack \
//   MAIPAI_LLAMA_SERVER_URL=http://127.0.0.1:8770 MAIPAI_EMBED_URL=http://127.0.0.1:8770 \
//   MAIPAI_BACKGROUND_URL=http://127.0.0.1:8770 bun run scripts/bench/judge-eval.ts --dataset memory-household-01
import { sanitizeEngineUrl } from "@/lib/engineIdentity";
import "./setup"; // CHAT-22: must come before anything that reaches "@/db"
import { finishBench, startBench } from "./setup";
import { scoreExtraction, formatPercent, type JudgeCase } from "./judgeScore";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { db, sqlite } from "@/db";
import { people, conversationTurns, memoryRecords } from "@/db/schema";
import { newPersonId, randomSuffix } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { resolveOrCreateConversation, logTurn } from "@/lib/conversationHistory";
import { runJudgeBatch } from "@/lib/memoryJudge";
import { recall, embedQueryForRecall } from "@/lib/memory";
import { classifyTurnSignal } from "@/lib/turnSignal";
import { commandOpeners, judgeStatusAtInsert, loadAllManifests } from "@/lib/turnShared";
import type { PersonRow } from "@/types";
import type { TurnValue } from "@/wire";
import { deleteEpisodesForTurns } from "@/lib/episodes";

const testPersonId = newPersonId();
const createdTurnIds: string[] = [];
const createdPersonIds: string[] = [];

interface HouseholdDataset {
  household: { owner: string; members: { name: string; role: string }[] };
  cases: { id: string; kind: "miss" | "synthetic" | "negative" | "assistant_only"; user: string; assistant: string; expected: string[][] }[];
}

/** `--dataset <name>` names a file in scripts/bench/datasets/; null runs the seeded scenarios. */
function datasetArg(): string | null {
  const at = process.argv.indexOf("--dataset");
  if (at < 0) return null;
  const name = process.argv[at + 1];
  if (!name) {
    console.error("bench setup refused: --dataset needs a name, for example --dataset memory-household-01.");
    process.exit(2);
  }
  return name;
}

function loadDataset(name: string): HouseholdDataset {
  const path = resolve(import.meta.dir, "datasets", `${name}.json`);
  try {
    return JSON.parse(readFileSync(path, "utf8")) as HouseholdDataset;
  } catch (error) {
    console.error(`bench setup refused: could not read the dataset at ${path} (${error instanceof Error ? error.message : String(error)}); name a file in scripts/bench/datasets/.`);
    process.exit(2);
  }
}

function insertPerson(id: string, name: string, role: string): void {
  const nowIso = new Date().toISOString();
  sqlite
    .query("INSERT INTO people (id, display_name, role, avatar_seed, source, local_only, created_at, updated_at, hlc) VALUES (?, ?, ?, ?, 'bench', 0, ?, ?, ?)")
    .run(id, name, role, randomSuffix(12), nowIso, nowIso, nextHlc());
  createdPersonIds.push(id);
}

const SAFE: TurnValue["safety"] = {
  flagged: false,
  categories: [],
  action: "allow",
  notify_parent: false,
  matched_signals: [],
  checked_at: new Date().toISOString(),
};

// #87: each seeded turn carries its expected facts as keyword sets, so
// the judge's extractions are scored per case as true positives, false
// positives and misses (scripts/bench/judgeScore.ts), separately from
// whether recall then surfaces the right fact.
const seeded: { turnId: string; label: string; expected: string[][] }[] = [];

function seedTurn(actor: PersonRow, conversationId: string, userText: string, replyText: string, ageDays: number, label: string, expected: string[][]): void {
  const turnId = `turn-${randomSuffix(10)}`;
  seeded.push({ turnId, label, expected });
  logTurn(actor, "chat", userText, { reply: { text: replyText }, source: "model", safety: SAFE, conversation_id: conversationId, turn_id: turnId });
  createdTurnIds.push(turnId);
  if (ageDays > 0) {
    const backdated = new Date(Date.now() - ageDays * 86_400_000).toISOString();
    sqlite.query("UPDATE conversation_turns SET created_at = ? WHERE id = ?").run(backdated, turnId);
  }
}

function cleanup(): void {
  for (const id of createdTurnIds) {
    sqlite.query("DELETE FROM memory_embeddings WHERE memory_id IN (SELECT id FROM memory_records WHERE source = ?)").run(id);
    sqlite.query("DELETE FROM pending_embeddings WHERE memory_id IN (SELECT id FROM memory_records WHERE source = ?)").run(id);
    sqlite.query("DELETE FROM memory_records WHERE source = ?").run(id);
    deleteEpisodesForTurns([id]); // MEM-03: the turn's verbatim episodes carry a FK to it
    sqlite.query("DELETE FROM conversation_turns WHERE id = ?").run(id);
  }
  sqlite.query("DELETE FROM notification_deliveries WHERE recipient_id = ?").run(testPersonId);
  sqlite.query("DELETE FROM conversations WHERE person_id = ?").run(testPersonId);
  for (const id of [testPersonId, ...createdPersonIds]) sqlite.query("DELETE FROM people WHERE id = ?").run(id);
}

/** MEM-AUDIT-06: the household fixture. One owner speaks every case; the
 * members exist as people rows so the judge's roster names them. Each case
 * is logged the way the turn machine logs a real turn (its signal and the
 * insert-time judge status), then the batch runs once and every case is
 * scored from the records written for its turn. */
async function runDataset(name: string): Promise<{ executed: number; engine: string }> {
  const dataset = loadDataset(name);
  await startBench();
  insertPerson(testPersonId, dataset.household.owner, "owner");
  for (const member of dataset.household.members) insertPerson(newPersonId(), member.name, member.role);
  const actor = db.select().from(people).where(eq(people.id, testPersonId)).get();
  if (!actor) throw new Error("failed to create the bench person row");
  const conv = resolveOrCreateConversation(actor, "chat");
  if (!conv.ok) throw new Error("failed to create the bench conversation");
  const roster = [dataset.household.owner, ...dataset.household.members.map((m) => m.name)];
  const openers = commandOpeners(loadAllManifests());

  console.log(`Seeding ${dataset.cases.length} household cases from ${name}...`);
  const seededCases: { turnId: string; label: string; expected: string[][]; skipped: boolean }[] = [];
  for (const c of dataset.cases) {
    const turnId = `turn-${randomSuffix(10)}`;
    const signal = classifyTurnSignal({ text: c.user, commandOpeners: openers, roster, ageBand: "adult" });
    const value: TurnValue = { reply: { text: c.assistant }, source: "model", safety: SAFE, conversation_id: conv.value.id, turn_id: turnId };
    const judgeStatus = judgeStatusAtInsert(value, signal, c.user);
    logTurn(actor, "chat", c.user, value, { signal, judgeStatus });
    createdTurnIds.push(turnId);
    seededCases.push({ turnId, label: c.id, expected: c.expected, skipped: judgeStatus === "skipped" });
  }
  const skippedAtGate = seededCases.filter((c) => c.skipped);
  console.log(`Gate: ${skippedAtGate.length} of ${seededCases.length} cases skipped at insert${skippedAtGate.length ? ` (${skippedAtGate.map((c) => c.label).join(", ")})` : ""}`);

  const judgeUrl = process.env.MAIPAI_BACKGROUND_URL;
  if (!judgeUrl || !(await new (await import("@maipai/spec/llm/ts/client.js")).LlamaServerClient(judgeUrl).health())) {
    console.error(`bench setup refused: no judge answers at MAIPAI_BACKGROUND_URL (${sanitizeEngineUrl(judgeUrl ?? "")}); configure a running Stack URL.`);
    process.exit(2);
  }
  const engine = `judge at ${sanitizeEngineUrl(judgeUrl)}`;
  const startTime = Date.now();
  const batchResult = await runJudgeBatch();
  const elapsedMs = Date.now() - startTime;
  console.log(`Judge batch: processed=${batchResult.processed} factsWritten=${batchResult.factsWritten} elapsed=${(elapsedMs / 1000).toFixed(2)}s (${(elapsedMs / 1000 / Math.max(1, batchResult.processed)).toFixed(3)}s/turn)`);

  const cases: JudgeCase[] = seededCases.map((c) => ({
    turnId: c.turnId,
    label: c.label,
    expected: c.expected,
    extracted: db.select({ text: memoryRecords.text }).from(memoryRecords).where(eq(memoryRecords.source, c.turnId)).all().map((r) => r.text),
  }));
  const score = scoreExtraction(cases);
  console.log(`\nExtraction, per case:`);
  for (const c of score.cases) {
    const detail = [c.missed.length ? `missed ${c.missed.map((k) => k.join("+")).join(", ")}` : "", c.extra.length ? `extra ${c.extra.map((t) => JSON.stringify(t)).join(", ")}` : ""].filter(Boolean).join("; ");
    console.log(`  ${c.label.padEnd(18)} tp=${c.truePositives} fp=${c.falsePositives} missed=${c.misses}${detail ? `  (${detail})` : ""}`);
  }
  console.log(`\n=== BENCHMARK RESULTS (${name}) ===`);
  console.log(`Extraction precision: ${formatPercent(score.precision)} (tp ${score.truePositives}, fp ${score.falsePositives})`);
  console.log(`Extraction recall: ${formatPercent(score.recall)} (tp ${score.truePositives}, missed ${score.misses})`);
  console.log(`Skipped at the gate: ${skippedAtGate.length}/${seededCases.length}`);
  console.log(`Seconds per judged turn: ${(elapsedMs / 1000 / Math.max(1, batchResult.processed)).toFixed(3)}s`);
  return { executed: batchResult.processed, engine };
}

async function main(): Promise<{ executed: number; engine: string }> {
  await startBench();
  const nowIso = new Date().toISOString();
  sqlite
    .query(
      "INSERT INTO people (id, display_name, role, avatar_seed, source, local_only, created_at, updated_at, hlc) VALUES (?, 'Iris', 'owner', ?, 'bench', 0, ?, ?, ?)",
    )
    .run(testPersonId, randomSuffix(12), nowIso, nowIso, nextHlc());
  const actor = db.select().from(people).where(eq(people.id, testPersonId)).get();
  if (!actor) throw new Error("failed to create the bench person row");

  const conv = resolveOrCreateConversation(actor, "chat");
  if (!conv.ok) throw new Error("failed to create the bench conversation");

  console.log("Seeding a two-session conversation (a knowledge update, days apart)...");
  seedTurn(actor, conv.value.id, "I work as a nurse at Riverside Hospital", "That sounds rewarding!", 14, "job", [["nurse"]]);
  seedTurn(actor, conv.value.id, "I actually just started a new job, I'm a teacher now", "Congratulations on the new job!", 0, "new job", [["teacher"]]);
  // An abstention turn: nothing to extract, so any extraction is a false positive.
  seedTurn(actor, conv.value.id, "what's the weather like today", "I don't have live weather access yet.", 0, "abstention", []);
  // MEM-06: one seeded turn per rule the judge must not write for.
  seedTurn(actor, conv.value.id, "how was your day", "Your sister Pippa called about the dentist on Thursday.", 0, "ungrounded reply text", []);
  seedTurn(actor, conv.value.id, "when is the Marsh Lantern film out", "It's out on October 3.", 0, "ungrounded lookup", []);
  seedTurn(actor, conv.value.id, "I'm wondering whether it'll rain tomorrow", "Could be.", 0, "passing state", []);
  seedTurn(actor, conv.value.id, "the Marsh Lantern film has a runtime of two hours", "Long one.", 0, "world fact", []);
  seedTurn(actor, conv.value.id, "I love the Marsh Lantern film, it's my favourite", "Good pick.", 0, "own preference about a title", [["marsh", "lantern"]]);
  seedTurn(actor, conv.value.id, "Pippa says her dentist moved to Thursdays", "Noted.", 0, "reported clause", [["pippa", "dentist", "thursday"]]);
  seedTurn(actor, conv.value.id, "I'll call the dentist tomorrow", "Okay.", 0, "commissive", [["dentist"]]);
  seedTurn(actor, conv.value.id, "add oat milk to the shopping list", "Added.", 0, "directive only", []);

  const judgeUrl = process.env.MAIPAI_BACKGROUND_URL;
  if (!judgeUrl || !(await new (await import("@maipai/spec/llm/ts/client.js")).LlamaServerClient(judgeUrl).health())) {
    console.error(`bench setup refused: no judge answers at MAIPAI_BACKGROUND_URL (${sanitizeEngineUrl(judgeUrl ?? "")}); configure a running Stack URL.`);
    process.exit(2);
  }
  const engine = `judge at ${sanitizeEngineUrl(judgeUrl)}`;

  const startTime = Date.now();
  const batchResult = await runJudgeBatch();
  const elapsedMs = Date.now() - startTime;
  const secondsPerTurn = elapsedMs / 1000 / seeded.length;

  console.log(
    `Judge batch: processed=${batchResult.processed} factsWritten=${batchResult.factsWritten} elapsed=${(elapsedMs / 1000).toFixed(2)}s (${secondsPerTurn.toFixed(3)}s/turn)`,
  );

  const workVector = await embedQueryForRecall("what does Iris do for work");
  const workMatches = recall(actor, "what does Iris do for work", { selfOnly: true, bumpUsage: false, queryVector: workVector });
  const sawTeacher = workMatches.some((m) => m.record.text.toLowerCase().includes("teacher"));
  const sawStaleNurse = workMatches.some((m) => m.record.text.toLowerCase().includes("nurse"));
  const knowledgeUpdateOk = sawTeacher && !sawStaleNurse;
  console.log(
    `${knowledgeUpdateOk ? "PASS" : "FAIL"}  knowledge-update  -> saw "teacher"=${sawTeacher}, saw stale "nurse"=${sawStaleNurse} (${workMatches.length} matches)`,
  );

  const colorVector = await embedQueryForRecall("what is Iris's favorite color");
  const colorMatches = recall(actor, "what is Iris's favorite color", { selfOnly: true, bumpUsage: false, queryVector: colorVector });
  const abstentionOk = colorMatches.length === 0;
  console.log(`${abstentionOk ? "PASS" : "FAIL"}  abstention        -> recalled ${colorMatches.length} matches for a fact never stated`);

  // #87: extraction scored per case from the records the judge wrote for
  // each seeded turn (whatever their status: a superseded record was
  // still extracted), apart from the two retrieval probes above.
  const extractionScore = scoreExtraction(
    seeded.map((c) => ({
      turnId: c.turnId,
      label: c.label,
      expected: c.expected,
      extracted: db
        .select({ text: memoryRecords.text })
        .from(memoryRecords)
        .where(eq(memoryRecords.source, c.turnId))
        .all()
        .map((r) => r.text),
    })),
  );
  console.log(`\nExtraction, per case:`);
  for (const c of extractionScore.cases) {
    const detail = [c.missed.length ? `missed ${c.missed.map((k) => k.join("+")).join(", ")}` : "", c.extra.length ? `extra ${c.extra.map((t) => JSON.stringify(t)).join(", ")}` : ""].filter(Boolean).join("; ");
    console.log(`  ${c.label.padEnd(12)} tp=${c.truePositives} fp=${c.falsePositives} missed=${c.misses}${detail ? `  (${detail})` : ""}`);
  }

  const retrievalPass = Number(knowledgeUpdateOk) + Number(abstentionOk);

  console.log(`\nEmbedding engine URL: ${sanitizeEngineUrl(process.env.MAIPAI_EMBED_URL)}`);
  console.log(`\n=== BENCHMARK RESULTS ===`);
  console.log(`Extraction precision: ${formatPercent(extractionScore.precision)} (tp ${extractionScore.truePositives}, fp ${extractionScore.falsePositives})`);
  console.log(`Extraction recall: ${formatPercent(extractionScore.recall)} (tp ${extractionScore.truePositives}, missed ${extractionScore.misses})`);
  console.log(`Retrieval scenarios: ${retrievalPass}/2 passed (knowledge update ${knowledgeUpdateOk ? "pass" : "fail"}, abstention ${abstentionOk ? "pass" : "fail"})`);
  console.log(`Seconds per turn: ${secondsPerTurn.toFixed(3)}s`);
  // Executed means turns the judge actually processed, not the two
  // probes: a judge that skipped every turn is a run of nothing.
  return { executed: batchResult.processed, engine };
}

let summary = { executed: 0, engine: "not run" };
try {
  const dataset = datasetArg();
  summary = dataset ? await runDataset(dataset) : await main();
} finally {
  cleanup(); // this bench's own rows only, in its own disposable database
  // A shared engine is never stopped: the URL tier's stop is a no-op, and
  // CHAT-22's setup admits nothing but the URL tier (MAIPAI_BACKGROUND_URL
  // must name the running memory engine; the setup's default is a closed
  // port, which the probe above reports as unreachable).
}
finishBench(summary);
