// The naturalness bench (session-c-brain-and-voice.md step 4: "the
// naturalness pairs... a bench scores a model and prompt on it").
// spec/llm/naturalness-corpus.json holds paired robotic/natural
// phrasings for the same utterance, in the shape the safety corpus
// (spec/safety/corpus/corpus.json) and routing corpus already
// established: read once, run through the real path, scored by regex,
// no test framework needed for a bench that's explicitly not part of
// scripts/check.sh.
//
// Not part of check.sh, same "small deterministic suite in check.sh, a
// large model-driven bench on demand" split every other bench in this
// directory already follows: this one runs the REAL turn engine
// (runTurn(), lib/persona.ts's NATURALNESS_POLICY included in every
// prompt) against whatever chat backend the machine currently resolves.
// Against the in-process stub (spec/llm/ts/stubServer.ts, every dev
// machine and CI by default) every row reports "ambiguous": the stub
// echoes the user's own utterance verbatim, which matches neither a
// robotic_re nor a natural_re pattern by construction, not because the
// prompt failed - the same honestly-uninformative-until-a-real-model-
// exists caveat persona-eval.ts's own header already documents for the
// exact same reason.
//
// Usage: bun run scripts/bench/naturalness.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db, sqlite } from "@/db";
import { people } from "@/db/schema";
import { newPersonId, randomSuffix } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { runTurn } from "@/lib/turnEngine";
import { getEngineStatus, stopChatBackend } from "@/lib/llmSupervisor";
import { __resetEmbedSupervisorForTests } from "@/lib/embedSupervisor";
import type { PersonRow } from "@/types";

interface CorpusRow {
  id: string;
  category: string;
  utterance: string;
  robotic: string;
  natural: string;
  robotic_re: string;
  natural_re: string;
  note: string;
}

const corpus: CorpusRow[] = JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "..", "spec", "llm", "naturalness-corpus.json"), "utf-8"));

const testPersonId = newPersonId();

function cleanup(): void {
  sqlite.query("DELETE FROM conversation_turns WHERE person_id = ?").run(testPersonId);
  sqlite.query("DELETE FROM conversations WHERE person_id = ?").run(testPersonId);
  sqlite.query("DELETE FROM people WHERE id = ?").run(testPersonId);
}

// toRegExp() mirrors scripts/bench/conversation.ts's own helper: strips
// Python-style (?i) inline flags (this corpus's own regex strings were
// written the same way the ported legacy conversation scenarios were,
// for consistency between the two benches) since JS regex has no inline
// flag syntax, using a real `i` flag instead.
function toRegExp(pattern: string): RegExp {
  const caseInsensitive = pattern.startsWith("(?i)");
  const body = caseInsensitive ? pattern.slice(4) : pattern;
  return new RegExp(body, caseInsensitive ? "i" : undefined);
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
  console.log(`Running ${corpus.length} naturalness-corpus rows...\n`);

  let natural = 0;
  let robotic = 0;
  let ambiguous = 0;
  for (const row of corpus) {
    const result = await runTurn(actor as PersonRow, "chat", row.utterance);
    const replyText = result.ok ? result.value.reply.text : "";
    const isRobotic = toRegExp(row.robotic_re).test(replyText);
    const isNatural = toRegExp(row.natural_re).test(replyText);

    let verdict: "natural" | "robotic" | "ambiguous";
    if (isNatural && !isRobotic) {
      verdict = "natural";
      natural++;
    } else if (isRobotic) {
      verdict = "robotic";
      robotic++;
    } else {
      verdict = "ambiguous";
      ambiguous++;
    }
    console.log(`${verdict.toUpperCase().padEnd(9)} [${row.category}] "${row.utterance}" -> "${replyText}"`);
  }

  console.log(`\nnatural=${natural} robotic=${robotic} ambiguous=${ambiguous} / ${corpus.length} rows`);
}

try {
  await main();
} finally {
  cleanup();
  __resetEmbedSupervisorForTests();
  stopChatBackend();
}
