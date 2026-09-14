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
import { sanitizeEngineUrl } from "@/lib/engineIdentity";
import "./setup"; // CHAT-22: must come before anything that reaches "@/db"
import { finishBench, startBench } from "./setup";
import { scoreExtraction, formatPercent } from "./judgeScore";
import { eq } from "drizzle-orm";
import { db, sqlite } from "@/db";
import { people, conversationTurns, memoryRecords } from "@/db/schema";
import { newPersonId, randomSuffix } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { resolveOrCreateConversation, logTurn } from "@/lib/conversationHistory";
import { runJudgeBatch } from "@/lib/memoryJudge";
import { recall, embedQueryForRecall } from "@/lib/memory";
import { getEmbedBackendKind, __resetEmbedSupervisorForTests } from "@/lib/embedSupervisor";
import { getBackgroundBackendKind, getBackgroundClient, probeBackgroundEngine, __resetBackgroundSupervisorForTests } from "@/lib/backgroundSupervisor";
import type { PersonRow } from "@/types";
import type { TurnValue } from "@/wire";
import { deleteEpisodesForTurns } from "@/lib/episodes";

const testPersonId = newPersonId();
const createdTurnIds: string[] = [];

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
  sqlite.query("DELETE FROM people WHERE id = ?").run(testPersonId);
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

  console.log(`Background engine (judge): ${getBackgroundBackendKind()}`);
  // The setup's default MAIPAI_BACKGROUND_URL is a closed port; this
  // bench is the one that needs the judge, so it refuses rather than
  // scoring a batch the judge never processed (a code review on CHAT-22).
  await getBackgroundClient(); // selects the URL tier; the probe reads what is selected
  const probe = await probeBackgroundEngine();
  if (!probe.alive) {
    console.error(`bench setup refused: no memory judge answers at MAIPAI_BACKGROUND_URL (${sanitizeEngineUrl(process.env.MAIPAI_BACKGROUND_URL)}); judge-eval needs a running background engine.`);
    process.exit(2);
  }
  const engine = `background ${probe.kind} at ${sanitizeEngineUrl(process.env.MAIPAI_BACKGROUND_URL)}`; // before the reset below

  const startTime = Date.now();
  const batchResult = await runJudgeBatch();
  const elapsedMs = Date.now() - startTime;
  const secondsPerTurn = elapsedMs / 1000 / 3; // 3 turns in the bench

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

  console.log(`\nEmbed backend: ${getEmbedBackendKind()}`);
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
  summary = await main();
} finally {
  cleanup(); // this bench's own rows only, in its own disposable database
  // A shared engine is never stopped: the URL tier's stop is a no-op, and
  // CHAT-22's setup admits nothing but the URL tier (MAIPAI_BACKGROUND_URL
  // must name the running memory engine; the setup's default is a closed
  // port, which the probe above reports as unreachable).
  __resetEmbedSupervisorForTests();
  __resetBackgroundSupervisorForTests();
}
finishBench(summary);
