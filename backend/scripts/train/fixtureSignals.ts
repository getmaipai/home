// ACT-02: the bench fixture's own turns (scripts/bench/conversationFixture.ts),
// split two ways. A turn whose `expect.signal` names `primary_act`,
// `expressed_emotion` or `clauseStance` was given that label by the
// person who wrote the fixture row (ACT-01's own comment: "the turn's
// own frozen TurnSignal at the floors a row needs") - a real human
// label, so it is held out entirely from the 4B-labeled training corpus
// and used instead as "the fixture" validation slice the acceptance
// criterion names, alongside DailyDialog's test split. Every other
// fixture turn carries no such hint and is fair game for the 4B
// training corpus (license-clean, our own household-shaped text).
import { CONVERSATIONS } from "../bench/conversationFixture";
import type { ActLabel, StanceLabel, EmotionLabel } from "./labelSets";

export interface FixtureValidationExample {
  id: string;
  text: string;
  act?: ActLabel;
  emotion?: EmotionLabel;
  /** The fixture's own `clauseStance` names the WHOLE turn's clauses in
   * order; single-clause rows (the overwhelming majority) give one
   * stance for the one clause, which is what this head predicts per
   * clause anyway - a multi-clause row's extra clauses are dropped
   * rather than guessing which substring each belongs to. */
  stance?: StanceLabel;
}

export interface FixtureSplit {
  trainingCandidates: Array<{ id: string; text: string }>;
  validation: FixtureValidationExample[];
}

const STANCE_HEAD_VALUES = new Set<string>(["asserted", "reported", "quoted", "hypothetical", "joke"]);

export function splitFixture(): FixtureSplit {
  const trainingCandidates: Array<{ id: string; text: string }> = [];
  const validation: FixtureValidationExample[] = [];
  const seenText = new Set<string>();

  for (const conv of CONVERSATIONS) {
    conv.turns.forEach((turn, i) => {
      const id = `fixture:${conv.id}:${i}`;
      const text = turn.say.trim();
      // Dedupe on TEXT, not `id` (a code review, 2026-09-14, caught the
      // id-keyed check as dead: id already carries the loop index, so
      // it is unique by construction and the check could never fire).
      // Two fixture turns can carry the same line ("thanks" as a closing
      // in more than one conversation) - the second copy is skipped so
      // it never doubles that row's weight in the validation slice or
      // duplicates a training candidate.
      const key = text.toLowerCase();
      if (!text || seenText.has(key)) return;
      seenText.add(key);
      const signal = turn.expect?.signal;
      const hasHint = signal && (signal.primary_act !== undefined || signal.expressed_emotion !== undefined || (signal.clauseStance && signal.clauseStance.length > 0));
      if (hasHint) {
        const stanceRaw = signal!.clauseStance?.[0];
        validation.push({
          id,
          text,
          act: signal!.primary_act as ActLabel | undefined,
          emotion: signal!.expressed_emotion as EmotionLabel | undefined,
          stance: stanceRaw && STANCE_HEAD_VALUES.has(stanceRaw) ? (stanceRaw as StanceLabel) : undefined,
        });
      } else {
        trainingCandidates.push({ id, text });
      }
    });
  }
  return { trainingCandidates, validation };
}
