// Memory recall quality bench (session-a-intelligence.md step 5): ports
// the legacy hub's 11 memory-recall probes (legacy-backups/home-legacy.git,
// backend/scripts/eval/memory-eval.ts) onto the rebuilt platform's real
// spec-shaped store and turn engine. Not part of `scripts/check.sh` - this
// is a bench, run on demand against whatever embed backend the machine
// currently resolves (stub, spawned llama-server, or a configured URL),
// same "small deterministic suite in check.sh, a large model-driven bench
// on demand" split the org testing standard names.
//
// Legacy names (JT/Artie/Marge) are replaced with persona-roster names
// (getmaipai/.github CLAUDE.md's PII rules): Marlow (the household
// member the probes are about), Rover and Juniper (the two entities).
//
// What changed porting this, beyond names:
// - Legacy stored entities in their own table with a real `name`/
//   `aliases` pair; this store has no such table - an entity is a
//   memory_record with record_kind "entity", whose "name" is approximated
//   from the text before its first colon/period/comma (lib/memory.ts's
//   entityNameWords()). Two entity records ("Rover: ...", "Juniper: ...")
//   stand in for the legacy `entities` rows.
// - Legacy's recallMemories()/formatMemoriesForPrompt() pair is this
//   store's recall() + turnEngine.ts's buildSystemPrompt() - the real
//   production prompt-building function, called directly with its own
//   defaults (loadAllManifests()/loadAllSkills()/DEFAULT_PERSONA), not a
//   parallel formatter built for this script.
// - importance is 0-1 here (spec/schemas/memory-record.schema.json), not
//   legacy's 0-9; every seed's importance below is the legacy value / 9.
//
// Usage: bun run scripts/bench/memory-eval.ts
import { eq } from "drizzle-orm";
import { db, sqlite } from "@/db";
import { people } from "@/db/schema";
import { newPersonId, randomSuffix } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { remember, recall, embedQueryForRecall } from "@/lib/memory";
import { buildSystemPrompt } from "@/lib/turnEngine";
import { getEmbedBackendKind, __resetEmbedSupervisorForTests } from "@/lib/embedSupervisor";
import type { PersonRow } from "@/types";

const now = new Date();
const testPersonId = newPersonId();
const createdMemoryIds: string[] = [];

interface Seed {
  text: string;
  recordKind?: "memory" | "entity";
  category?: string;
  tier?: "durable" | "episodic";
  pinned?: boolean;
  importance?: number;
  ageDays?: number;
}

interface Case {
  id: string;
  question: string;
  /** substring that must appear in the built system prompt */
  expect: string;
  /** true = must be ABSENT (specificity control) */
  absent?: boolean;
}

const SEEDS: Seed[] = [
  { text: "Marlow works as a paramedic on the night shift", category: "identity", tier: "durable", pinned: true, importance: 0.9 },
  { text: "Marlow dislikes cilantro and refuses to eat it", category: "preference", tier: "durable", importance: 0.6 },
  { text: "Marlow is vegetarian", category: "preference", tier: "durable", importance: 0.7 },
  { text: "Marlow is training for the Hartford half-marathon in October", category: "goal", tier: "durable", importance: 0.7 },
  { text: "Marlow went to a Yankees game last Saturday and loved it", category: "event", tier: "episodic", importance: 0.5, ageDays: 4 },
  { text: "Marlow's car got an oil change in March", category: "fact", tier: "episodic", importance: 0.3, ageDays: 90 },
  { text: "Rover: a family friend", recordKind: "entity", category: "relationship", tier: "episodic", importance: 0.3 },
  { text: "Rover is allergic to peanuts", category: "relationship", tier: "episodic", importance: 0.7 },
  { text: "Rover loves science-fiction movies", category: "relationship", tier: "episodic", importance: 0.5 },
  { text: "Juniper: a family friend", recordKind: "entity", category: "relationship", tier: "episodic", importance: 0.3 },
];

// Entity-flood seeds: 22 filler facts + 1 target about Juniper, to test
// whether the char budget truncates the block before the target fact
// survives (legacy's exact regression, ported verbatim in shape).
const FLOOD_TARGET = "Juniper is severely allergic to shellfish";
const FLOOD_FILLERS = [
  "plays tennis on Tuesdays", "drives a blue Subaru Outback", "grew up in Ohio", "has two golden retrievers",
  "collects vintage postcards", "works at the town library", "makes excellent banana bread", "is learning Italian",
  "volunteers at the animal shelter", "hates horror movies", "loves gardening in spring", "sings in the church choir",
  "went to Cornell", "is afraid of heights", "prefers tea over coffee", "runs a book club",
  "has a lake house in Vermont", "broke her wrist skiing once", "is married to Dave", "has a niece named Sophie",
  "plays bridge on Fridays", "makes her own jam",
];
const floodSeeds: Seed[] = [
  ...FLOOD_FILLERS.map((detail): Seed => ({
    text: `Juniper ${detail}`,
    category: "relationship",
    tier: "episodic",
    importance: 0.4,
  })),
  { text: FLOOD_TARGET, category: "relationship", tier: "episodic", importance: 0.8 },
];

// 40 generic filler memories to simulate an aged install (recall window noise).
const FILLER_DETAILS = ["grabbed coffee", "watched a documentary", "mowed the lawn", "fixed a leaky faucet", "ordered new shoes"];
const fillerSeeds: Seed[] = Array.from({ length: 40 }, (_, i): Seed => ({
  text: `Marlow mentioned random daily detail number ${i}: ${FILLER_DETAILS[i % FILLER_DETAILS.length]} on day ${i}`,
  category: "fact",
  tier: "episodic",
  importance: 0.3,
  ageDays: i,
}));

const CASES: Case[] = [
  { id: "pinned-identity", question: "hi there!", expect: "paramedic" },
  { id: "durable-pref-food", question: "what should I cook for dinner tonight?", expect: "cilantro" },
  { id: "durable-pref-para", question: "find me a good steakhouse for Friday", expect: "vegetarian" },
  { id: "durable-goal", question: "should I go for a run this weekend?", expect: "half-marathon" },
  { id: "episodic-relevant", question: "tell me about that baseball game I went to", expect: "Yankees" },
  { id: "specificity-ctrl", question: "what should I cook for dinner tonight?", expect: "oil change", absent: true },
  { id: "entity-recall", question: "would Rover like this new sci-fi movie?", expect: "science-fiction" },
  { id: "entity-detail", question: "I'm cooking for Rover tomorrow, any concerns?", expect: "peanuts" },
  { id: "entity-flood", question: "can Juniper eat at the seafood place with us?", expect: "shellfish" },
  // Durable-tier specificity controls: the lower durable floor must not
  // spray preferences onto unrelated turns (guards DURABLE_MIN_COSINE).
  { id: "durable-ctrl-movie", question: "what movie should we watch?", expect: "vegetarian", absent: true },
  { id: "durable-ctrl-greet", question: "hi there!", expect: "cilantro", absent: true },
];

function seed(actor: PersonRow, s: Seed): void {
  const created = remember(actor, {
    record_kind: s.recordKind ?? "memory",
    text: s.text,
    category: s.category ?? "fact",
    tier: s.tier ?? "episodic",
    scope: "household",
    source: "bench:memory-eval",
    importance: s.importance ?? 0.5,
    pinned: s.pinned ?? false,
  });
  if (!created.ok) throw new Error(`seed failed for "${s.text}": ${created.error}`);
  createdMemoryIds.push(created.value.id);
  if (s.ageDays) {
    const backdated = new Date(now.getTime() - s.ageDays * 86_400_000).toISOString();
    sqlite.query("UPDATE memory_records SET created_at = ? WHERE id = ?").run(backdated, created.value.id);
  }
}

function cleanup(): void {
  for (const id of createdMemoryIds) {
    sqlite.query("DELETE FROM memory_embeddings WHERE memory_id = ?").run(id);
    sqlite.query("DELETE FROM pending_embeddings WHERE memory_id = ?").run(id);
    sqlite.query("DELETE FROM memory_records WHERE id = ?").run(id);
  }
  sqlite.query("DELETE FROM people WHERE id = ?").run(testPersonId);
}

async function main(): Promise<void> {
  const nowIso = now.toISOString();
  sqlite
    .query(
      "INSERT INTO people (id, display_name, role, avatar_seed, source, local_only, created_at, updated_at, hlc) VALUES (?, ?, 'owner', ?, 'bench', 0, ?, ?, ?)",
    )
    .run(testPersonId, "Bench Household", randomSuffix(12), nowIso, nowIso, nextHlc());
  const actor = db.select().from(people).where(eq(people.id, testPersonId)).get();
  if (!actor) throw new Error("failed to create the bench person row");

  console.log("Seeding memories...");
  for (const s of [...SEEDS, ...floodSeeds, ...fillerSeeds]) seed(actor, s);

  // Force the embed backend selection to finish before reporting which
  // one this run actually used: right after seeding, remember()'s own
  // fire-and-forget embed calls have only just started it, and
  // getEmbedBackendKind() would still read back "starting".
  await embedQueryForRecall("warm the embed backend");
  console.log(`Embed backend: ${getEmbedBackendKind()}`);
  console.log(`Running ${CASES.length} recall probes...\n`);
  let pass = 0;
  for (const c of CASES) {
    const queryVector = await embedQueryForRecall(c.question);
    const matches = recall(actor, c.question, { selfOnly: true, bumpUsage: false, queryVector });
    const prompt = buildSystemPrompt(actor, c.question, matches);
    const inRecall = matches.some((m) => m.record.text.includes(c.expect));
    const inBlock = prompt.includes(c.expect);
    const ok = c.absent ? !inBlock : inBlock;
    if (ok) pass++;
    const stage = c.absent
      ? inBlock
        ? "leaked-into-block"
        : "correctly-absent"
      : inBlock
        ? "in-block"
        : inRecall
          ? "RECALLED-BUT-TRUNCATED"
          : "NOT-RECALLED";
    console.log(
      `${ok ? "PASS" : "FAIL"}  ${c.id.padEnd(18)} "${c.question}" -> ${stage}  (recalled=${matches.length}, prompt=${prompt.length}ch)`,
    );
  }
  console.log(`\n${pass}/${CASES.length} passed`);
}

try {
  await main();
} finally {
  cleanup();
  // Found live (session-a-intelligence.md step 10's own verification
  // run): embedQueryForRecall() lazily starts a real backend (the stub
  // is a real Bun.serve() HTTP listener) that nothing ever stopped, so
  // this script's own process never exited on its own - three earlier
  // runs sat as zombies for HOURS, silently contending for the same
  // SQLite file this exact run needed. __resetEmbedSupervisorForTests()
  // isn't test-only in effect, just in name (it really calls .stop() on
  // whatever's running); every bench script that touches embed/chat now
  // calls its own supervisor's real stop function here.
  __resetEmbedSupervisorForTests();
}
