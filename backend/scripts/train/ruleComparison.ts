// ACT-02: the real rule pass (backend/src/lib/turnSignal.ts's own
// classifyTurnSignal(), read-only import - nothing under backend/src/
// is this lane's to edit) as the baseline every head must beat, and a
// measurement-only "rules plus heads" composition for the headline
// acceptance number. This composition is NOT the production wiring:
// that lands in turnSignal.ts itself, ACT-02's other half (Session A's
// job, after this lane). It exists only so this script can report the
// number the acceptance criterion names (docs/BACKLOG.md:2305-2314:
// "rules plus heads beat the rule pass alone... by a stated margin")
// without waiting on that wiring to exist, by reimplementing docs/dev.md
// section 12's own stated precedence: the rule stands wherever it made
// a high-precision call (an exact greeting/closing/backchannel, an
// explicit question, a directive by construction, an unmistakable
// stance marker, a lexicon-matched emotion); the head fills in only the
// residual, low-confidence guess the rule itself flags as a default,
// never a confident rule call. The three thresholds below are exactly
// the confidence values classifyTurnSignal() assigns to those defaults
// (clauseAct()'s 0.6/0.75 inform fallback, clauseStance()'s 0.7 asserted
// fallback, clauseEmotion()'s 0.5 no-cue neutral), read from that file,
// not invented here.
import { classifyTurnSignal } from "@/lib/turnSignal";
import type { ActLabel, EmotionLabel } from "./labelSets";

export interface RuleReading {
  act: ActLabel;
  actConfidence: number;
  /** "unknown" only ever comes from the fallback path (empty text); a
   * real rule pass over non-empty text always resolves clauseStance()
   * to one of the head's five predictable values. */
  stance: "asserted" | "reported" | "quoted" | "hypothetical" | "joke" | "unknown";
  stanceConfidence: number;
  emotion: EmotionLabel;
  emotionConfidence: number;
}

/** The primary clause only: every corpus here is single-utterance text
 * (no prior turn, no multi-clause household dialogue), so the primary
 * clause is the whole reading in the overwhelming majority of cases,
 * and is the one the turn-level fields (primary_act, expressed_emotion)
 * already summarize. */
export function ruleReading(text: string): RuleReading {
  const signal = classifyTurnSignal({ text, ageBand: "adult" });
  const clause = signal.clauses[0]!;
  return {
    act: signal.primary_act as ActLabel,
    actConfidence: signal.act_confidence,
    stance: clause.stance,
    stanceConfidence: clause.confidence,
    emotion: signal.expressed_emotion as EmotionLabel,
    emotionConfidence: signal.emotion_confidence,
  };
}

// A confidence-threshold test cannot express "override only the inform
// default, never the 0.7 suggestion/negative-imperative directive call":
// clauseAct()'s confidences are 0.6 (inform, no first-person cue), 0.7
// (a real suggestion/negative-imperative directive - NOT a default, dev.md
// does not name it as the head's remit), 0.75 (inform, first-person),
// 0.8 (commissive), 0.85+ (backchannel/question/directive by
// construction/greeting/closing) - 0.7 sits strictly between the two
// inform confidences, so any single "below X" cutoff either also
// releases the real 0.7 directive call or fails to release the 0.75
// inform default. `inform` is reached ONLY by clauseAct()'s residual
// branch (every other branch returns something else), so testing the
// VALUE instead of the confidence is both correct and simpler: "inform
// versus commissive" and "a question with no question mark" (dev.md
// section 12's own words for the head's remit) are both exactly the
// cases where the rule said `inform`, nothing else.
export function actIsRuleDefault(rule: { value: ActLabel }): boolean {
  return rule.value === "inform";
}
// clauseStance()'s own confidence alone is NOT what ruleReading() exposes
// as `stanceConfidence`: classifyTurnSignal() sets each clause's public
// `confidence` to Math.min(act.confidence, stance.confidence)
// (turnSignal.ts's clauses.map()), so a marker-based stance (joke,
// quoted, hypothetical, reported - clauseStance()'s own 0.85) paired
// with a low-confidence act (inform at 0.6/0.75, the common case) reads
// as low overall even though the STANCE call itself was confident - a
// code review (2026-09-14) caught a bare confidence cutoff here wrongly
// treating that as the rule's default and letting the head override a
// correct marker-based reading. `asserted` is the only stance value
// clauseStance() reaches by a residual, unmarked branch (0.7) as well as
// an act-implied one (0.9, question/directive/etc, forced asserted); a
// marker-based stance is NEVER `asserted`, so gating on the value first
// (only `asserted` can ever be the default) and the confidence second
// (0.8 still cleanly separates that value's own residual 0.6-0.7 min
// from its act-implied 0.85-0.9 min) is correct where confidence alone
// was not.
export function stanceIsRuleDefault(rule: { value: "asserted" | "reported" | "quoted" | "hypothetical" | "joke" | "unknown"; confidence: number }): boolean {
  return rule.value === "asserted" && rule.confidence < 0.8;
}
// clauseEmotion()'s "neutral" is reached ONLY by the no-cue branch (0.5);
// every matched cue returns a non-neutral emotion (0.55 and up), so
// (like act) the value alone identifies the default.
export function emotionIsRuleDefault(rule: { value: EmotionLabel }): boolean {
  return rule.value === "neutral";
}

/** Rules-plus-heads for one axis: the rule stands unless it made the
 * default call this axis's own `isRuleDefault` predicate names, in
 * which case the head's prediction fills in (falling back to the rule's
 * default when the head has none). */
export function composeAxis<L extends string>(rule: { value: L; confidence: number }, isRuleDefault: (rule: { value: L; confidence: number }) => boolean, headPredicted: L | null): L {
  if (!isRuleDefault(rule)) return rule.value;
  return headPredicted ?? rule.value;
}
