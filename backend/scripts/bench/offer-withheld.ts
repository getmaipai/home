// NAT-07b / NAT-07c: does the real memory judge set `offer_withheld` on the facts it should (a health matter, money
// trouble, a quarrel, a loss) and leave it off ordinary ones (an interview, a trip, a hobby)? A bench, not part of
// scripts/check.sh: run on demand against a running background engine (MAIPAI_BACKGROUND_URL), the same wiring as
// judge-eval.ts. It prints bench-row labels and counts only (rule 6a), never record text or ids.
import "./setup"; // must come before anything that reaches "@/db"
import { finishBench, startBench } from "./setup";
import { eq } from "drizzle-orm";
import { db, sqlite } from "@/db";
import { people, memoryRecords } from "@/db/schema";
import { newPersonId, randomSuffix } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { resolveOrCreateConversation, logTurn } from "@/lib/conversationHistory";
import { runJudgeBatch } from "@/lib/memoryJudge";
import { deleteEpisodesForTurns } from "@/lib/episodes";
import type { TurnValue } from "@/wire";

const personId = newPersonId();
const turnIds: string[] = [];
const SAFE: TurnValue["safety"] = { flagged: false, categories: [], action: "allow", notify_parent: false, matched_signals: [], checked_at: new Date().toISOString() };

// withheld: true means the row must come back tagged offer_withheld; false means it must not.
const ROWS: { label: string; text: string; withheld: boolean }[] = [
  { label: "health_appointment", text: "I have a biopsy on Friday and I'm pretty nervous about it", withheld: true },
  { label: "health_condition", text: "I was diagnosed with type 2 diabetes last month", withheld: true },
  { label: "money_trouble", text: "We're behind on the mortgage again and I don't know how we'll catch up", withheld: true },
  { label: "money_owed", text: "I owe my brother four thousand dollars and I can't pay him back yet", withheld: true },
  { label: "quarrel", text: "My sister and I aren't speaking since the fight about our mom's house", withheld: true },
  { label: "loss", text: "My dad died in March and the house still feels empty", withheld: true },
  { label: "interview", text: "I have a job interview at the library next Tuesday", withheld: false },
  { label: "trip", text: "We're driving to Lake Geneva for the long weekend in June", withheld: false },
  { label: "school_event", text: "My daughter's spring concert is on the 14th", withheld: false },
  { label: "hobby_project", text: "I'm building a bookshelf for the garage this month", withheld: false },
  { label: "new_pet", text: "We adopted a beagle puppy named Rover last week", withheld: false },
  { label: "goal", text: "I'm trying to run a half marathon by October", withheld: false },
];

function cleanup(): void {
  for (const id of turnIds) {
    sqlite.query("DELETE FROM memory_embeddings WHERE memory_id IN (SELECT id FROM memory_records WHERE source = ?)").run(id);
    sqlite.query("DELETE FROM pending_embeddings WHERE memory_id IN (SELECT id FROM memory_records WHERE source = ?)").run(id);
    sqlite.query("DELETE FROM memory_records WHERE source = ?").run(id);
    deleteEpisodesForTurns([id]);
    sqlite.query("DELETE FROM conversation_turns WHERE id = ?").run(id);
  }
  sqlite.query("DELETE FROM notification_deliveries WHERE recipient_id = ?").run(personId);
  sqlite.query("DELETE FROM conversations WHERE person_id = ?").run(personId);
  sqlite.query("DELETE FROM people WHERE id = ?").run(personId);
}

async function main(): Promise<{ executed: number; engine: string }> {
  await startBench();
  const nowIso = new Date().toISOString();
  sqlite.query("INSERT INTO people (id, display_name, role, avatar_seed, source, local_only, created_at, updated_at, hlc) VALUES (?, 'Iris', 'owner', ?, 'bench', 0, ?, ?, ?)").run(personId, randomSuffix(12), nowIso, nowIso, nextHlc());
  const actor = db.select().from(people).where(eq(people.id, personId)).get();
  if (!actor) throw new Error("failed to create the bench person row");
  const conv = resolveOrCreateConversation(actor, "chat");
  if (!conv.ok) throw new Error("failed to create the bench conversation");

  const seeded = ROWS.map((row) => {
    const turnId = `turn-${randomSuffix(10)}`;
    turnIds.push(turnId);
    logTurn(actor, "chat", row.text, { reply: { text: "I'm sorry, tell me more." }, source: "model", safety: SAFE, conversation_id: conv.value.id, turn_id: turnId });
    return { ...row, turnId };
  });
  const batch = await runJudgeBatch();
  console.log(`Judge batch: processed=${batch.processed} factsWritten=${batch.factsWritten}`);

  let tp = 0, fn = 0, fp = 0, tn = 0, noFact = 0;
  console.log("\nPer row (label, facts written, tagged):");
  for (const row of seeded) {
    const facts = db.select({ withheld: memoryRecords.offerWithheld }).from(memoryRecords).where(eq(memoryRecords.source, row.turnId)).all();
    const tagged = facts.some((f) => f.withheld === true);
    if (facts.length === 0) noFact++;
    if (row.withheld) tagged ? tp++ : fn++;
    else tagged ? fp++ : tn++;
    console.log(`  ${row.label.padEnd(20)} facts=${facts.length} tagged=${tagged} ${row.withheld === tagged ? "ok" : "MISS"}`);
  }
  console.log("\n=== OFFER_WITHHELD RESULTS ===");
  console.log(`Sensitive rows tagged: ${tp}/${tp + fn}`);
  console.log(`Ordinary rows left untagged: ${tn}/${tn + fp}`);
  console.log(`Rows where the judge wrote no fact at all: ${noFact}/${ROWS.length}`);
  return { executed: batch.processed, engine: "background judge" };
}

let summary = { executed: 0, engine: "not run" };
try {
  summary = await main();
} finally {
  cleanup();
}
finishBench(summary);
