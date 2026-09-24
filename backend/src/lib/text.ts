// A tiny shared tokenizer: normalizes free text into a lowercase word set
// with stopwords dropped. Used wherever a deterministic keyword-overlap
// score stands in for something that needs a real embedder (4.11): memory
// recall's fallback ranking (4.4) and the turn engine's routing.examples
// fuzzy match (4.5). One definition, extracted the moment a second
// consumer needed the identical rule (CLAUDE.md principle 4), the same way
// lib/access.ts's canAccessPerson was.
const STOPWORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "to", "of", "in", "on", "at",
  "for", "and", "or", "my", "our", "your", "i", "we", "you", "it", "do", "does",
  "what", "who", "when", "where", "how", "with", "about",
]);

export function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9']+/)
      .filter((w) => w.length > 1 && !STOPWORDS.has(w)),
  );
}

/** CONFIRM-01: moved from turnMachine/nodes/policy.ts, one definition -
 * nodes/model.ts's own `offeredButInvalid` check needs the identical
 * pronoun test policy.ts's own checkGrounding() refuses a call with,
 * and policy.ts already imports from model.ts (ANSWER_FROM_CONTEXT_
 * TOOL_ID), so the reverse import would have been circular. Checked
 * one word at a time, never a literal array (the rule-budget lint's
 * word-list check is syntactic: a 3+-string array trips it whatever it
 * holds - the same reason messages.ts's windowRoleFromId() and nodes/
 * answer.ts's policyRefusalLine() are written this way too). */
function isPronounWord(word: string): boolean {
  return word === "he" || word === "she" || word === "it" || word === "they" || word === "him" || word === "her" || word === "them" || word === "his" || word === "hers" || word === "their" || word === "theirs" || word === "its";
}

// A code review caught the first cut of this checking the raw value
// verbatim ("it" passed, "it?"/"It." did not) - split the SAME way
// tokenize() itself splits (this file's own `[^a-z0-9']+` word
// boundary), before tokenize()'s stopword drop ever gets a chance to
// silently erase a lone "it" into an empty, trivially-passing term
// list.
export function isBarePronoun(value: string): boolean {
  // rule: grounding.bare_pronoun (docs/plans/turn-machine-state-record-2026-09-22.md, "Grounding, stated exactly", 2a28e4e8)
  const words = value.toLowerCase().split(/[^a-z0-9']+/).filter((w) => w.length > 0);
  return words.length === 1 && isPronounWord(words[0]!);
}
