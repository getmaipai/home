// Memory judge bench (session-a-intelligence.md step 6: "a household
// fixture on the persona roster, LongMemEval-shaped, testing a knowledge
// update and an abstention; record the first numbers in dev.md"). Not
// part of scripts/check.sh - a bench, run on demand against whatever
// chat/embed backend the machine currently resolves, the same "small
// deterministic suite in check.sh, a large model-driven bench on demand"
// split memory-eval.ts (step 5) already established.
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
// Two real, model-routed calls per turn (extract, then dedupe when a
// candidate exists) mean this bench's result is only as good as the
// chat backend it runs against: with no chat model configured, it falls
// back to the in-process stub (spec/llm/ts/stubServer.ts), whose canned
// echo reply is not valid extraction JSON at all - extraction fails
// every time, and the honest result is "0 facts, nothing to update or
// abstain from" fully by default, not a real pass. This script reports
// that plainly rather than dressing it up; see docs/dev.md's own step 6
// entry for what it actually recorded and why.
import { eq } from "drizzle-orm";
import { db, sqlite } from "@/db";
import { people, conversationTurns } from "@/db/schema";
import { newPersonId, randomSuffix } from "@/lib/id";
import { resolveOrCreateConversation, logTurn } from "@/lib/conversationHistory";
import { runJudgeBatch } from "@/lib/memoryJudge";
import { recall, embedQueryForRecall } from "@/lib/memory";
import { getEmbedBackendKind } from "@/lib/embedSupervisor";
import { getEngineStatus } from "@/lib/llmSupervisor";
import type { PersonRow } from "@/types";
import type { TurnValue } from "@/wire";

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

function seedTurn(actor: PersonRow, conversationId: string, userText: string, replyText: string, ageDays: number): void {
  const turnId = `turn-${randomSuffix(10)}`;
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
    sqlite.query("DELETE FROM conversation_turns WHERE id = ?").run(id);
  }
  sqlite.query("DELETE FROM notification_deliveries WHERE recipient_id = ?").run(testPersonId);
  sqlite.query("DELETE FROM conversations WHERE person_id = ?").run(testPersonId);
  sqlite.query("DELETE FROM people WHERE id = ?").run(testPersonId);
}

async function main(): Promise<void> {
  const nowIso = new Date().toISOString();
  sqlite
    .query(
      "INSERT INTO people (id, display_name, role, avatar_seed, source, local_only, created_at, updated_at) VALUES (?, 'Iris', 'owner', ?, 'bench', 0, ?, ?)",
    )
    .run(testPersonId, randomSuffix(12), nowIso, nowIso);
  const actor = db.select().from(people).where(eq(people.id, testPersonId)).get();
  if (!actor) throw new Error("failed to create the bench person row");

  const conv = resolveOrCreateConversation(actor, "chat");
  if (!conv.ok) throw new Error("failed to create the bench conversation");

  console.log("Seeding a two-session conversation (a knowledge update, days apart)...");
  seedTurn(actor, conv.value.id, "I work as a nurse at Riverside Hospital", "That sounds rewarding!", 14);
  seedTurn(actor, conv.value.id, "I actually just started a new job, I'm a teacher now", "Congratulations on the new job!", 0);
  // Never asserted - the abstention probe below must find nothing.
  seedTurn(actor, conv.value.id, "what's the weather like today", "I don't have live weather access yet.", 0);

  const batchResult = await runJudgeBatch();
  console.log(`Judge batch: processed=${batchResult.processed} factsWritten=${batchResult.factsWritten}`);
  console.log(`Chat backend used: ${getEngineStatus().kind}`);

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

  console.log(`\nEmbed backend used: ${getEmbedBackendKind()}`);
  console.log(`${Number(knowledgeUpdateOk) + Number(abstentionOk)}/2 passed`);
}

try {
  await main();
} finally {
  cleanup();
}
