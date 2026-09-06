// The persona judge (session-c-brain-and-voice.md step 4: "the persona
// consistency test... plus a model-judged version on demand"). The
// string checks `scripts/bench/persona-eval.ts` already runs (address
// form, length cap, forbidden phrases) are structural: they can tell a
// reply didn't leak another companion's name or run on forever, but they
// cannot tell whether a reply actually SOUNDS like the persona it was
// generated under, the same gap `docs/BACKLOG.md`'s own entry named
// ("forbidden-phrases is honestly uninformative against a stub... needs
// a real chat model before this means anything for persona fidelity").
// This is that: a second LLM call, structured-output judged, the exact
// pattern `memoryJudge.ts`'s own dedupe/contradiction calls already use
// (`response_format: json_schema`, one batched call per persona rather
// than one call per exchange - ten separate judge calls per persona
// would be ten times the cost for a question that reads the whole
// transcript at once just as well).
//
// Deliberately its own file, not folded into memoryJudge.ts: this judges
// STYLE (does this sound like Buddy), memoryJudge.ts judges CONTENT
// (should this be remembered) - different questions, different schemas,
// and persona-eval.ts is the only caller of this one.
import { complete, type LlmMessage } from "@/lib/llm";
import { composePersonaPrompt, type Persona } from "@/lib/persona";

export interface JudgedExchange {
  user: string;
  reply: string;
}

export interface PersonaVerdict {
  index: number;
  matches_persona: boolean;
  reason: string;
}

export interface PersonaJudgeResult {
  ok: true;
  verdicts: PersonaVerdict[];
  /** Fraction of exchanges the judge marked as matching the persona,
   * 0 when the transcript is empty rather than NaN - a bench printing
   * this straight to a percentage shouldn't have to guard against that
   * itself. */
  score: number;
}

export interface PersonaJudgeFailure {
  ok: false;
  error: string;
}

const PERSONA_JUDGE_SCHEMA = {
  name: "persona_judge",
  schema: {
    type: "object",
    properties: {
      verdicts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            index: { type: "number" },
            matches_persona: { type: "boolean" },
            reason: { type: "string" },
          },
          required: ["index", "matches_persona", "reason"],
        },
      },
    },
    required: ["verdicts"],
  },
} as const;

function buildJudgePrompt(persona: Persona, exchanges: readonly JudgedExchange[]): string {
  const transcript = exchanges.map((e, i) => `${i}. User: "${e.user}"\n   Reply: "${e.reply}"`).join("\n");
  return (
    `You are grading whether a set of chat replies sound like they came from a specific character, ` +
    `not whether the replies are factually correct or helpful.\n\n` +
    `The character is "${persona.display_name}". Here is how they're supposed to talk:\n${composePersonaPrompt(persona)}\n\n` +
    `Here is a transcript of exchanges from this character. For each numbered exchange, decide whether the ` +
    `REPLY's tone, formality, and voice are consistent with the character description above - not whether it's a ` +
    `good or correct answer, purely whether it sounds like the same character speaking.\n\n${transcript}\n\n` +
    `Return one verdict per exchange, indexed to match.`
  );
}

/** Judges a batch of already-generated exchanges against one persona in
 * a single model call. Returns `ok: false` (never throws) on a
 * malformed judge reply or an unavailable backend, the same
 * "dedupe deciding safely is never wrong enough to fail the whole turn"
 * posture `memoryJudge.ts`'s own dedupe round already has - a bench
 * calling this should degrade to "judge unavailable" for that persona,
 * not crash the whole run over one bad call. */
export async function judgePersonaConsistency(persona: Persona, exchanges: readonly JudgedExchange[]): Promise<PersonaJudgeResult | PersonaJudgeFailure> {
  if (exchanges.length === 0) return { ok: true, verdicts: [], score: 0 };

  const messages: LlmMessage[] = [{ role: "user", content: buildJudgePrompt(persona, exchanges) }];
  const result = await complete("chat", messages, {
    temperature: 0.1,
    response_format: { type: "json_schema", json_schema: PERSONA_JUDGE_SCHEMA },
  });
  if (!result.ok) return { ok: false, error: result.error };

  try {
    const parsed = JSON.parse(result.value.text) as { verdicts?: unknown };
    if (!Array.isArray(parsed.verdicts)) return { ok: false, error: "judge reply had no verdicts array" };
    // Indexed by exchange index, not pushed positionally: a code review
    // (2026-09-06) found the first cut scored matches/verdicts.length
    // (the SURVIVING verdict count after dropping malformed or
    // duplicate entries), which silently shrinks the denominator every
    // time the judge skips or repeats an index - exactly what the real
    // run this bench recorded in docs/BACKLOG.md hit (buddy came back
    // 9 verdicts for a 10-exchange transcript, printed as "5/9" with no
    // sign one exchange was never judged at all). A Map keyed by index
    // keeps the LAST verdict for a repeated index (matching how a
    // dedupe round elsewhere in this codebase, memoryJudge.ts's own,
    // treats a repeated key) and drops anything out of range, so the
    // denominator below is always the real transcript length.
    const byIndex = new Map<number, PersonaVerdict>();
    for (const raw of parsed.verdicts) {
      if (!raw || typeof raw !== "object") continue;
      const v = raw as Record<string, unknown>;
      if (typeof v.index !== "number" || typeof v.matches_persona !== "boolean") continue;
      if (v.index < 0 || v.index >= exchanges.length || !Number.isInteger(v.index)) continue;
      byIndex.set(v.index, { index: v.index, matches_persona: v.matches_persona, reason: typeof v.reason === "string" ? v.reason : "" });
    }
    if (byIndex.size === 0) return { ok: false, error: "judge reply parsed but produced no usable verdicts" };
    const verdicts = [...byIndex.values()].sort((a, b) => a.index - b.index);
    // A missing verdict (the judge skipped an exchange) counts as a
    // non-match rather than being excluded - the denominator is always
    // exchanges.length, never the count of verdicts that happened to
    // parse, so this score can never overstate consistency by silently
    // dropping the exchanges the judge said the least about.
    const score = verdicts.filter((v) => v.matches_persona).length / exchanges.length;
    return { ok: true, verdicts, score };
  } catch {
    return { ok: false, error: "judge reply was not valid JSON" };
  }
}
