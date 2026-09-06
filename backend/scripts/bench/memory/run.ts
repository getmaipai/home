// The LongMemEval-shaped household bench's runner (session-c-brain-and-
// voice.md step 9). Not part of scripts/check.sh - a bench, run on
// demand against whatever chat/embed backend the machine currently
// resolves, the same "small deterministic suite in check.sh, a large
// model-driven bench on demand" split every other bench in this
// directory already follows.
//
// A real, named limitation, stated once here rather than repeated at
// every grading site: every check below is SUBSTRING grading against a
// real generated reply, the same grading style scripts/bench/
// conversation.ts already uses. It can tell "the current value is
// present" and "a specific invented value is absent," but it can't tell
// "the reply asserted the stale value as still-true" apart from "the
// reply correctly mentioned the stale value historically while
// answering with the current one" - a genuinely harder judgment this
// pass doesn't attempt (an LLM-judge pass, the same shape
// lib/personaJudge.ts already established for a different bench, is the
// natural next step if these numbers turn out to matter enough to
// refine).
//
// Usage: bun run scripts/bench/memory/run.ts
import { eq } from "drizzle-orm";
import { db, sqlite } from "@/db";
import { people } from "@/db/schema";
import { newPersonId, randomSuffix } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { remember, supersede } from "@/lib/memory";
import { runTurn } from "@/lib/turnEngine";
import { getEngineStatus, stopChatBackend } from "@/lib/llmSupervisor";
import { __resetEmbedSupervisorForTests } from "@/lib/embedSupervisor";
import { KNOWLEDGE_UPDATE_CASES, ABSTENTION_CASES, TEMPORAL_CASES, MULTI_SESSION_CASES, type KnowledgeUpdateSeed } from "./fixture";
import type { PersonRow } from "@/types";

const testPersonId = newPersonId();
const now = new Date();

function backdatedIso(ageDays: number): string {
  return new Date(now.getTime() - ageDays * 86_400_000).toISOString();
}

function seedDated(actor: PersonRow, s: KnowledgeUpdateSeed, source: string): string {
  const created = remember(actor, {
    text: s.text,
    category: "fact",
    tier: "durable",
    scope: "household",
    source,
    importance: 0.7,
  });
  if (!created.ok) throw new Error(`seed failed for "${s.text}": ${created.error}`);
  sqlite.query("UPDATE memory_records SET created_at = ? WHERE id = ?").run(backdatedIso(s.ageDays), created.value.id);
  return created.value.id;
}

function cleanup(): void {
  sqlite.query("DELETE FROM conversation_turns WHERE person_id = ?").run(testPersonId);
  sqlite.query("DELETE FROM conversations WHERE person_id = ?").run(testPersonId);
  sqlite.query("DELETE FROM memory_embeddings WHERE memory_id IN (SELECT id FROM memory_records WHERE person IS NULL)").run();
  sqlite.query("DELETE FROM pending_embeddings WHERE memory_id IN (SELECT id FROM memory_records WHERE person IS NULL)").run();
  sqlite.query("DELETE FROM memory_records WHERE scope = 'household'").run();
  sqlite.query("DELETE FROM people WHERE id = ?").run(testPersonId);
}

interface Result {
  category: string;
  id: string;
  pass: boolean;
  question: string;
  reply: string;
}

async function main(): Promise<void> {
  const nowIso = now.toISOString();
  sqlite
    .query(
      "INSERT INTO people (id, display_name, role, avatar_seed, source, local_only, created_at, updated_at, hlc) VALUES (?, 'Sprout', 'owner', ?, 'bench', 0, ?, ?, ?)",
    )
    .run(testPersonId, randomSuffix(12), nowIso, nowIso, nextHlc());
  const actor = db.select().from(people).where(eq(people.id, testPersonId)).get();
  if (!actor) throw new Error("failed to create the bench person row");

  console.log(`Chat backend used: ${getEngineStatus().kind}`);

  const results: Result[] = [];

  // Knowledge updates: seed the OLD fact, then supersede() it with the
  // NEW one - the real dedupe mechanism the judge itself uses
  // (lib/memoryJudge.ts), not two independent remember() calls left to
  // coexist. The old record's own valid_to closes, matching a real
  // household correction.
  for (const c of KNOWLEDGE_UPDATE_CASES) {
    const oldId = seedDated(actor as PersonRow, c.before, "bench:memory-longeval");
    const superseded = supersede(
      actor as PersonRow,
      oldId,
      { text: c.after.text, category: "fact", tier: "durable", importance: 0.7, source: "bench:memory-longeval" },
      { closeValidTo: backdatedIso(c.after.ageDays) },
    );
    if (!superseded.ok) throw new Error(`supersede failed for "${c.id}": ${superseded.error}`);
    sqlite.query("UPDATE memory_records SET created_at = ? WHERE id = ?").run(backdatedIso(c.after.ageDays), superseded.value.created.id);

    const turnResult = await runTurn(actor as PersonRow, "chat", c.question);
    const reply = turnResult.ok ? turnResult.value.reply.text : "";
    const lower = reply.toLowerCase();
    const pass = lower.includes(c.mustContainCurrent.toLowerCase()) && !lower.includes(c.mustNotContainStale.toLowerCase());
    results.push({ category: "knowledge-update", id: c.id, pass, question: c.question, reply });
  }

  // Abstention: nothing seeded on purpose - these questions have no
  // answer anywhere in this household's memory.
  for (const c of ABSTENTION_CASES) {
    const turnResult = await runTurn(actor as PersonRow, "chat", c.question);
    const reply = turnResult.ok ? turnResult.value.reply.text : "";
    // A code review (2026-09-06) found this was a plain, case-sensitive
    // .includes() - "May" (the month) is a real substring of "Maybe",
    // so a correctly-abstaining reply that starts a sentence with
    // "Maybe" ("Maybe check with them directly") was scored as having
    // invented a birthday month it never actually said. Word-boundary,
    // case-insensitive matching, the same fix this session's own
    // guards.ts/normalizeForSpeech.ts work already applied to an
    // identical class of substring bug more than once.
    const pass = !c.mustNotInvent.some((invented) => new RegExp(`\\b${invented.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(reply));
    results.push({ category: "abstention", id: c.id, pass, question: c.question, reply });
  }

  // Temporal: two dated facts, a question asking their relative order.
  for (const c of TEMPORAL_CASES) {
    for (const s of c.seeds) seedDated(actor as PersonRow, s, "bench:memory-longeval");
    const turnResult = await runTurn(actor as PersonRow, "chat", c.question);
    const reply = turnResult.ok ? turnResult.value.reply.text : "";
    const lowerReply = reply.toLowerCase();
    const earlierIdx = lowerReply.indexOf(c.earlierMention.toLowerCase());
    const laterIdx = lowerReply.indexOf(c.laterMention.toLowerCase());
    // The earlier event MUST be named (that's the actual answer to
    // "which happened first"); the later one is only required to appear
    // AFTER it if the reply mentions it at all - a concise, correct
    // answer ("The roof was replaced first, back in March") that never
    // repeats the loser's name by ITS name is still a correct answer,
    // not a failure to grade against. Found live: the first cut of this
    // check required both names present in order, which marked a
    // genuinely correct real-model reply as a fail for exactly this
    // reason.
    const pass = earlierIdx !== -1 && (laterIdx === -1 || earlierIdx < laterIdx);
    results.push({ category: "temporal", id: c.id, pass, question: c.question, reply });
  }

  // Multi-session recall: a fact seeded directly (simulating an earlier,
  // separate conversation) recalled in a fresh runTurn() call - never
  // the same conversation the seed itself came from.
  for (const c of MULTI_SESSION_CASES) {
    seedDated(actor as PersonRow, c.seed, c.seed.source);
    const turnResult = await runTurn(actor as PersonRow, "chat", c.question);
    const reply = turnResult.ok ? turnResult.value.reply.text : "";
    const pass = reply.toLowerCase().includes(c.mustContain.toLowerCase());
    results.push({ category: "multi-session", id: c.id, pass, question: c.question, reply });
  }

  console.log(`\nRunning ${results.length} LongMemEval-shaped probes...\n`);
  const byCategory = new Map<string, { pass: number; total: number }>();
  for (const r of results) {
    console.log(`${r.pass ? "PASS" : "FAIL"}  [${r.category}] ${r.id}: "${r.question}" -> "${r.reply}"`);
    const bucket = byCategory.get(r.category) ?? { pass: 0, total: 0 };
    bucket.total++;
    if (r.pass) bucket.pass++;
    byCategory.set(r.category, bucket);
  }
  console.log("\nPer-category results:");
  for (const [category, { pass, total }] of byCategory) {
    console.log(`  ${category.padEnd(16)} ${pass}/${total}`);
  }
  const totalPass = results.filter((r) => r.pass).length;
  console.log(`\n${totalPass}/${results.length} passed overall`);
}

try {
  await main();
} finally {
  cleanup();
  __resetEmbedSupervisorForTests();
  stopChatBackend();
}
