// #93: recall's relevance floors were never measured (memory.ts's own
// comment: legacy's 0.37 durable and 0.55 episodic, "must be re-measured
// on the bench before v0.1"). This bench measures them the way ROUTE-01
// measured routing's null floor: a seeded household of memories, thirty
// unrelated queries (general questions nothing stored answers), the
// cosine of the top hit per query (the null floor, reported as p50, p90,
// p95 and max per tier), and ten related queries with the cosine of
// their right record (the signal). The floors are then set above the
// null floor and below the weakest signal, per tier, in memory.ts.
//
// Runs against the embed engine by URL through setup.ts (CHAT-22's
// refusals: a fresh temp data directory, engines already running, never
// a spawn). Usage: MAIPAI_DATA_DIR=<fresh> MAIPAI_LLAMA_SERVER_URL=<chat>
// MAIPAI_EMBED_URL=<embed> bun run scripts/bench/recall-floor.ts
import "./setup"; // CHAT-22: must come before anything that reaches "@/db"
import { finishBench, startBench } from "./setup";
import { eq, inArray } from "drizzle-orm";
import { db, sqlite } from "@/db";
import { people, memoryRecords, memoryEmbeddings } from "@/db/schema";
import { newPersonId, randomSuffix } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { remember, drainPendingEmbeddings, embedQueryForRecall, cosineSimilarity, bufferToVector } from "@/lib/memory";
import { __resetEmbedSupervisorForTests } from "@/lib/embedSupervisor";
import type { PersonRow } from "@/types";

const BENCH_SOURCE = "bench:recall-floor";

interface Seed {
  text: string;
  tier: "durable" | "episodic";
  category: string;
}

// A household of two dozen facts, persona-roster names only, half
// durable and half episodic, the mix a real install carries.
const SEEDS: Seed[] = [
  { text: "Pippa is allergic to peanuts", tier: "durable", category: "fact" },
  { text: "Pippa has soccer practice on Tuesdays", tier: "durable", category: "fact" },
  { text: "Pippa loves painting", tier: "durable", category: "preference" },
  { text: "Marlow's birthday is in June", tier: "durable", category: "fact" },
  { text: "Marlow works as a paramedic on the night shift", tier: "durable", category: "identity" },
  { text: "Marlow is vegetarian", tier: "durable", category: "preference" },
  { text: "Rover is the family dog and gets his medicine at seven every evening", tier: "durable", category: "fact" },
  { text: "Bramble is scared of the dark and sleeps with a night light", tier: "durable", category: "fact" },
  { text: "The dentist is on Friday at four", tier: "durable", category: "fact" },
  { text: "The wifi password is written on the fridge", tier: "durable", category: "fact" },
  { text: "Sage prefers tea over coffee", tier: "durable", category: "preference" },
  { text: "Juniper drives a blue Subaru Outback", tier: "durable", category: "fact" },
  { text: "Sage went to a Yankees game last Saturday and loved it", tier: "episodic", category: "event" },
  { text: "Sage mentioned the car needs an oil change soon", tier: "episodic", category: "fact" },
  { text: "Pippa lost a tooth on Monday", tier: "episodic", category: "event" },
  { text: "Marlow was tired after a double shift yesterday", tier: "episodic", category: "event" },
  { text: "Rover had a bath on Sunday", tier: "episodic", category: "event" },
  { text: "Bramble drew a picture of a lighthouse at school", tier: "episodic", category: "event" },
  { text: "The plumber is coming Thursday morning", tier: "episodic", category: "event" },
  { text: "Sage is reading a novel about lighthouse keepers", tier: "episodic", category: "fact" },
  { text: "The family watched a documentary about penguins", tier: "episodic", category: "event" },
  { text: "Juniper brought banana bread over on Saturday", tier: "episodic", category: "event" },
  { text: "Marlow signed up for the Hartford half-marathon in October", tier: "episodic", category: "goal" },
  { text: "Pippa wants a telescope for her birthday", tier: "episodic", category: "preference" },
  // The memory-eval bench's own indirect rows: a preference or goal a
  // question touches without naming it.
  { text: "Marlow dislikes cilantro and refuses to eat it", tier: "durable", category: "preference" },
  { text: "Marlow is training for the Hartford half-marathon in October", tier: "durable", category: "goal" },
];

// General questions nothing stored answers: the null rows. Written the
// way a household asks them, across the shapes the baseline bench
// found going wrong (arithmetic, history, science, everyday requests).
const UNRELATED_QUERIES = [
  "what year did the second world war end",
  "what is two plus two",
  "why is the sky blue",
  "what is the capital of France",
  "how many legs does a spider have",
  "who wrote Pride and Prejudice",
  "how far is the moon",
  "what is the boiling point of water",
  "tell me a joke",
  "how do I boil an egg",
  "what's a good name for a goldfish",
  "how tall is Mount Everest",
  "what is photosynthesis",
  "who painted the Mona Lisa",
  "what is the speed of light",
  "how many days are in a leap year",
  "what does a thermostat do",
  "how do airplanes stay in the air",
  "what's the difference between a crocodile and an alligator",
  "when was the printing press invented",
  "what is the largest ocean",
  "how do you spell necessary",
  "what rhymes with orange",
  "what time zone is Tokyo in",
  "what is a haiku",
  "how many ounces in a pound",
  "what causes thunder",
  "who invented the telephone",
  "what is the square root of 144",
  "how long do tortoises live",
];

// Null rows that NAME a household member and ask what was never stored
// (#93's own judge-eval probe, "what is Iris's favorite color"): the
// shared name lifts the cosine against every fact about that person,
// so this band is reported on its own.
const NAMED_NULL_QUERIES = [
  "what is Pippa's favorite color",
  "what is Marlow's shoe size",
  "does Bramble like broccoli",
  "what is Rover's favorite toy",
  "what instrument does Sage play",
  "where did Juniper grow up",
  "what is Pippa's middle name",
  "how old is Marlow",
  "what does Bramble want to be when he grows up",
  "what breed is Rover",
];

// Ten related queries, each with the record that answers it.
const RELATED_QUERIES: { query: string; answer: string }[] = [
  { query: "what is Pippa allergic to", answer: "Pippa is allergic to peanuts" },
  { query: "when is the dentist", answer: "The dentist is on Friday at four" },
  { query: "when is Marlow's birthday", answer: "Marlow's birthday is in June" },
  { query: "when does Rover get his medicine", answer: "Rover is the family dog and gets his medicine at seven every evening" },
  { query: "what day does Pippa have soccer", answer: "Pippa has soccer practice on Tuesdays" },
  { query: "what is Bramble scared of", answer: "Bramble is scared of the dark and sleeps with a night light" },
  { query: "what does Marlow do for work", answer: "Marlow works as a paramedic on the night shift" },
  { query: "what car does Juniper drive", answer: "Juniper drives a blue Subaru Outback" },
  { query: "when is the plumber coming", answer: "The plumber is coming Thursday morning" },
  { query: "what did Bramble draw at school", answer: "Bramble drew a picture of a lighthouse at school" },
];

// Indirect rows (memory-eval.ts's durable-pref and durable-goal cases):
// the question never names the fact, the fact bears on the answer.
// Reported apart from the direct signal, since they are the band the
// floor has to decide about.
const INDIRECT_QUERIES: { query: string; answer: string }[] = [
  { query: "what should I cook for dinner tonight?", answer: "Marlow is vegetarian" },
  { query: "what should I cook for dinner tonight?", answer: "Marlow dislikes cilantro and refuses to eat it" },
  { query: "find me a good steakhouse for Friday", answer: "Marlow is vegetarian" },
  { query: "should I go for a run this weekend?", answer: "Marlow signed up for the Hartford half-marathon in October" },
  { query: "should I go for a run this weekend?", answer: "Marlow is training for the Hartford half-marathon in October" },
  { query: "is Pippa free on Tuesday", answer: "Pippa has soccer practice on Tuesdays" },
  { query: "can Pippa have a peanut butter sandwich", answer: "Pippa is allergic to peanuts" },
  { query: "what time should we give the dog his pills", answer: "Rover is the family dog and gets his medicine at seven every evening" },
];

const testPersonId = newPersonId();

function cleanup(): void {
  sqlite.query("DELETE FROM memory_embeddings WHERE memory_id IN (SELECT id FROM memory_records WHERE source = ?)").run(BENCH_SOURCE);
  sqlite.query("DELETE FROM pending_embeddings WHERE memory_id IN (SELECT id FROM memory_records WHERE source = ?)").run(BENCH_SOURCE);
  sqlite.query("DELETE FROM memory_records WHERE source = ?").run(BENCH_SOURCE);
  sqlite.query("DELETE FROM people WHERE id = ?").run(testPersonId);
}

const pct = (xs: number[], p: number): number => {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))] ?? NaN;
};
const f = (n: number) => n.toFixed(3);

async function main(): Promise<{ executed: number; engine: string }> {
  await startBench();
  const nowIso = new Date().toISOString();
  sqlite
    .query("INSERT INTO people (id, display_name, role, avatar_seed, source, local_only, created_at, updated_at, hlc) VALUES (?, 'Sage', 'owner', ?, 'bench', 0, ?, ?, ?)")
    .run(testPersonId, randomSuffix(12), nowIso, nowIso, nextHlc());
  const actor = db.select().from(people).where(eq(people.id, testPersonId)).get() as PersonRow;

  for (const seed of SEEDS) {
    const r = remember(actor, { text: seed.text, category: seed.category, tier: seed.tier, scope: "household", source: BENCH_SOURCE, importance: 0.6 });
    if (!r.ok) throw new Error(`seed failed: ${r.error}`);
  }
  // remember() embeds each record in the background (a fire-and-forget
  // call, with pending_embeddings as the retry queue); wait until every
  // seed has its vector, draining the queue for any that fell back.
  const rows = db.select().from(memoryRecords).where(eq(memoryRecords.source, BENCH_SOURCE)).all();
  let vectors = db.select().from(memoryEmbeddings).where(inArray(memoryEmbeddings.memoryId, rows.map((r) => r.id))).all();
  for (let i = 0; i < 60 && vectors.length < rows.length; i++) {
    await drainPendingEmbeddings();
    await new Promise((resolve) => setTimeout(resolve, 500));
    vectors = db.select().from(memoryEmbeddings).where(inArray(memoryEmbeddings.memoryId, rows.map((r) => r.id))).all();
  }
  console.log(`Seeded ${SEEDS.length} records; ${vectors.length} embedded`);
  if (vectors.length < rows.length) throw new Error("embed engine did not embed every seed");
  const byId = new Map(vectors.map((v) => [v.memoryId, bufferToVector(v.vector)]));
  const records = rows.map((r) => ({ text: r.text, tier: r.tier, vector: byId.get(r.id)! }));

  const topPerTier = async (query: string): Promise<{ durable: number; episodic: number; top: { text: string; cosine: number } }> => {
    const q = await embedQueryForRecall(query);
    if (!q) throw new Error(`could not embed "${query}"`);
    let durable = -1;
    let episodic = -1;
    let top = { text: "", cosine: -1 };
    for (const r of records) {
      const c = cosineSimilarity(q, r.vector);
      if (r.tier === "durable") durable = Math.max(durable, c);
      else episodic = Math.max(episodic, c);
      if (c > top.cosine) top = { text: r.text, cosine: c };
    }
    return { durable, episodic, top };
  };

  console.log(`\nNull rows (${UNRELATED_QUERIES.length} unrelated queries): the top hit's cosine per tier\n`);
  const nullDurable: number[] = [];
  const nullEpisodic: number[] = [];
  for (const query of UNRELATED_QUERIES) {
    const r = await topPerTier(query);
    nullDurable.push(r.durable);
    nullEpisodic.push(r.episodic);
    console.log(`  ${f(r.top.cosine)}  "${query}" -> "${r.top.text}" (durable ${f(r.durable)}, episodic ${f(r.episodic)})`);
  }
  console.log(`\n  durable null floor:  p50 ${f(pct(nullDurable, 0.5))}  p90 ${f(pct(nullDurable, 0.9))}  p95 ${f(pct(nullDurable, 0.95))}  max ${f(Math.max(...nullDurable))}`);
  console.log(`  episodic null floor: p50 ${f(pct(nullEpisodic, 0.5))}  p90 ${f(pct(nullEpisodic, 0.9))}  p95 ${f(pct(nullEpisodic, 0.95))}  max ${f(Math.max(...nullEpisodic))}`);

  console.log(`\nNamed null rows (${NAMED_NULL_QUERIES.length}): a household name, a fact never stored\n`);
  const namedNull: number[] = [];
  for (const query of NAMED_NULL_QUERIES) {
    const r = await topPerTier(query);
    namedNull.push(r.top.cosine);
    console.log(`  ${f(r.top.cosine)}  "${query}" -> "${r.top.text}"`);
  }
  console.log(`\n  named null floor: p50 ${f(pct(namedNull, 0.5))}  p90 ${f(pct(namedNull, 0.9))}  p95 ${f(pct(namedNull, 0.95))}  max ${f(Math.max(...namedNull))}`);

  console.log(`\nRelated rows (${RELATED_QUERIES.length}): the right record's cosine, and whether it was the top hit\n`);
  const signals: number[] = [];
  for (const { query, answer } of RELATED_QUERIES) {
    const q = await embedQueryForRecall(query);
    if (!q) throw new Error(`could not embed "${query}"`);
    const record = records.find((r) => r.text === answer);
    if (!record) throw new Error(`no seeded record "${answer}"`);
    const cosine = cosineSimilarity(q, record.vector);
    const best = records.reduce((b, r) => Math.max(b, cosineSimilarity(q, r.vector)), -1);
    signals.push(cosine);
    console.log(`  ${f(cosine)}  "${query}" -> "${answer}" ${cosine >= best - 1e-9 ? "(top)" : `(top was ${f(best)})`}`);
  }
  console.log(`\n  weakest signal ${f(Math.min(...signals))}, median ${f(pct(signals, 0.5))}`);

  console.log(`\nIndirect rows (${INDIRECT_QUERIES.length}): a fact the question bears on without naming it\n`);
  const indirect: number[] = [];
  for (const { query, answer } of INDIRECT_QUERIES) {
    const q = await embedQueryForRecall(query);
    if (!q) throw new Error(`could not embed "${query}"`);
    const record = records.find((r) => r.text === answer);
    if (!record) throw new Error(`no seeded record "${answer}"`);
    const cosine = cosineSimilarity(q, record.vector);
    indirect.push(cosine);
    console.log(`  ${f(cosine)}  "${query}" -> "${answer}"`);
  }
  console.log(`\n  indirect: weakest ${f(Math.min(...indirect))}, median ${f(pct(indirect, 0.5))}, strongest ${f(Math.max(...indirect))}`);
  return { executed: UNRELATED_QUERIES.length + NAMED_NULL_QUERIES.length + RELATED_QUERIES.length + INDIRECT_QUERIES.length, engine: `embed url at ${process.env.MAIPAI_EMBED_URL}` };
}

let summary = { executed: 0, engine: "" };
try {
  summary = await main();
} finally {
  cleanup();
  __resetEmbedSupervisorForTests();
}
finishBench(summary);
