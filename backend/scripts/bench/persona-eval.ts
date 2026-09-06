// Persona consistency bench (session-a-intelligence.md step 8: "a
// persona consistency test with ten scripted exchanges scored by string
// checks: address form, length cap, forbidden phrases"). Not part of
// scripts/check.sh - a bench, run on demand against whatever chat
// backend the machine currently resolves, the same "small deterministic
// suite in check.sh, a large model-driven bench on demand" split
// memory-eval.ts (step 5) and judge-eval.ts (step 6) already established.
//
// Runs the SAME ten scripted user turns through the real turn engine
// (runTurn(), not a parallel prompt-only check) once per bundled
// companion, switching persona.active_id between runs exactly the way a
// household member would in Settings. Three string checks per reply:
// - Address form: a reply never leaks a DIFFERENT companion's own
//   display_name (Buddy's replies mentioning "The Tutor," say).
// - Length cap: a rough proxy for the active persona's `engagement`
//   dial - "brief" replies should stay short; "curious"/"balanced" get
//   more room. Not a hard spec number (none exists), a sanity ceiling.
// - Forbidden phrases: a formal persona (tutor) never uses a
//   contraction; every other persona is casual and DOES use one -
//   composePersonaPrompt()'s own FORMALITY_FRAGMENT asks for exactly
//   this split.
//
// Like judge-eval.ts, this bench's signal is only as good as the chat
// backend it runs against: the in-process stub (spec/llm/ts/
// stubServer.ts) echoes the LAST USER MESSAGE verbatim regardless of any
// system prompt, so it structurally CANNOT honor a persona instruction -
// every check below will fail against it by construction, not because
// personas are broken. This script reports that plainly; see docs/
// dev.md's own step 8 entry for what it actually recorded and why.
//
// Session C step 4 adds the model-judged half BACKLOG.md named as "still
// real, unbuilt work": `--judge` runs each persona's real transcript
// through `lib/personaJudge.ts` (one structured-output LLM call per
// persona judging tone/voice consistency, not just the three structural
// proxies above). Same stub caveat applies even harder here: a judge
// reading the stub's own echoed-back user text is judging the user's
// phrasing, not any persona - this flag is only informative once a real
// chat model is configured (MAIPAI_LLAMA_SERVER_URL or a spawned engine).
import { eq } from "drizzle-orm";
import { db, sqlite } from "@/db";
import { people } from "@/db/schema";
import { newPersonId, randomSuffix } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { runTurn } from "@/lib/turnEngine";
import { setValue } from "@/lib/settings";
import { PERSONAS } from "@/lib/persona";
import { getEngineStatus, stopChatBackend } from "@/lib/llmSupervisor";
import { __resetEmbedSupervisorForTests } from "@/lib/embedSupervisor";
import { judgePersonaConsistency, type JudgedExchange } from "@/lib/personaJudge";
import type { PersonRow } from "@/types";

// Step 4 (session-c-brain-and-voice.md): "plus a model-judged version on
// demand" - opt-in, not the default, since it doubles the model calls
// this bench makes (one extra judge call per persona) for a signal
// that's just as uninformative against the stub as the string checks
// already documented themselves to be (the stub echoes the user's own
// words, so a judge reading those echoes back is judging the user's
// phrasing, not any persona). `bun run scripts/bench/persona-eval.ts --judge`.
const RUN_JUDGE = process.argv.includes("--judge");

const testPersonId = newPersonId();

const EXCHANGES: readonly string[] = [
  "hi there!",
  "what's the weather like today?",
  "can you help me with something?",
  "I'm not sure what to do about this",
  "thanks for the help",
  "what do you think about that?",
  "tell me something interesting",
  "I had a rough day today",
  "what's 2 plus 2?",
  "goodnight",
];

const CONTRACTIONS = ["can't", "won't", "don't", "it's", "you're", "i'm", "that's", "isn't", "didn't"];

interface PersonaScore {
  id: string;
  addressFormOk: number;
  lengthCapOk: number;
  forbiddenPhrasesOk: number;
  total: number;
}

function cleanup(): void {
  // conversation_turns.conversation_id carries a real FK to
  // conversations.id, so it has to go first, or the conversations
  // delete itself fails under foreign_keys=ON (the same ordering
  // forgetTransaction() in lib/memory.ts already has to respect for its
  // own FK-carrying child tables).
  sqlite.query("DELETE FROM conversation_turns WHERE person_id = ?").run(testPersonId);
  sqlite.query("DELETE FROM conversations WHERE person_id = ?").run(testPersonId);
  sqlite.query("DELETE FROM settings_values WHERE scope = ?").run(`person:${testPersonId}`);
  sqlite.query("DELETE FROM people WHERE id = ?").run(testPersonId);
}

async function main(): Promise<void> {
  const nowIso = new Date().toISOString();
  sqlite
    .query(
      "INSERT INTO people (id, display_name, role, avatar_seed, source, local_only, created_at, updated_at, hlc) VALUES (?, 'Sprout', 'owner', ?, 'bench', 0, ?, ?, ?)",
    )
    .run(testPersonId, randomSuffix(12), nowIso, nowIso, nextHlc());
  const actor = db.select().from(people).where(eq(people.id, testPersonId)).get();
  if (!actor) throw new Error("failed to create the bench person row");

  console.log(`Chat backend used: ${getEngineStatus().kind}`);
  console.log(`Running ${EXCHANGES.length} scripted exchanges per persona x ${PERSONAS.length} personas...\n`);

  const scores: PersonaScore[] = [];
  for (const persona of PERSONAS) {
    const setResult = setValue(actor as PersonRow, `person:${testPersonId}`, "persona.active_id", persona.id);
    if (!setResult.ok) throw new Error(`failed to set persona.active_id to ${persona.id}: ${setResult.error}`);
    const otherDisplayNames = PERSONAS.filter((p) => p.id !== persona.id).map((p) => p.display_name);
    const wantsContraction = persona.formality !== "formal";
    // engagement's own ENGAGEMENT_FRAGMENT (lib/persona.ts) asks for a
    // sentence-or-two on "brief", a few sentences on "balanced"/"curious" -
    // these ceilings are a generous multiple of that, a sanity check
    // against a reply running unboundedly long, not a strict spec number.
    const lengthCeiling = persona.engagement === "brief" ? 220 : 400;

    let addressFormOk = 0;
    let lengthCapOk = 0;
    let forbiddenPhrasesOk = 0;
    const transcript: JudgedExchange[] = [];
    for (const utterance of EXCHANGES) {
      const result = await runTurn(actor as PersonRow, "chat", utterance);
      const replyText = result.ok ? result.value.reply.text : "";
      const lower = replyText.toLowerCase();
      transcript.push({ user: utterance, reply: replyText });

      if (!otherDisplayNames.some((name) => replyText.includes(name))) addressFormOk++;
      if (replyText.length <= lengthCeiling) lengthCapOk++;
      const hasContraction = CONTRACTIONS.some((c) => lower.includes(c));
      if (hasContraction === wantsContraction) forbiddenPhrasesOk++;
    }

    const total = addressFormOk + lengthCapOk + forbiddenPhrasesOk;
    scores.push({ id: persona.id, addressFormOk, lengthCapOk, forbiddenPhrasesOk, total });
    console.log(
      `${persona.id.padEnd(8)} address-form ${addressFormOk}/${EXCHANGES.length}  length-cap ${lengthCapOk}/${EXCHANGES.length}  forbidden-phrases ${forbiddenPhrasesOk}/${EXCHANGES.length}`,
    );

    if (RUN_JUDGE) {
      const judged = await judgePersonaConsistency(persona, transcript);
      if (judged.ok) {
        console.log(`${"".padEnd(8)} judge-score ${(judged.score * 100).toFixed(0)}% (${judged.verdicts.filter((v) => v.matches_persona).length}/${judged.verdicts.length})`);
        for (const v of judged.verdicts.filter((v) => !v.matches_persona)) {
          console.log(`${"".padEnd(11)}- #${v.index} "${transcript[v.index]?.reply}" - ${v.reason}`);
        }
      } else {
        console.log(`${"".padEnd(8)} judge-score unavailable: ${judged.error}`);
      }
    }
  }

  const maxPerCheck = EXCHANGES.length * PERSONAS.length;
  const totals = scores.reduce(
    (acc, s) => ({ addressForm: acc.addressForm + s.addressFormOk, lengthCap: acc.lengthCap + s.lengthCapOk, forbidden: acc.forbidden + s.forbiddenPhrasesOk }),
    { addressForm: 0, lengthCap: 0, forbidden: 0 },
  );
  console.log(`\nTotals: address-form ${totals.addressForm}/${maxPerCheck}, length-cap ${totals.lengthCap}/${maxPerCheck}, forbidden-phrases ${totals.forbidden}/${maxPerCheck}`);
}

try {
  await main();
} finally {
  cleanup();
  // Found live (session-a-intelligence.md step 10's own verification
  // run): runTurn() lazily starts real embed AND chat backends (its own
  // prepareTurn() always calls embedQueryForRecall(), and the chat role
  // for the reply itself; the stub is a real Bun.serve() HTTP listener
  // either way) that nothing ever stopped, so this script's own process
  // never exited on its own - earlier runs sat as zombies for hours,
  // silently contending for the same SQLite file a later run needed.
  __resetEmbedSupervisorForTests();
  stopChatBackend();
}
