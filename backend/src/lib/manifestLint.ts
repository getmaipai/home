// OPENER-01 (turn-machine-state-record-2026-09-22.md, "The machine",
// the commands row; dev.md "The knowledge hijack" (a)): the manifest
// floor behind the commands node's own three closed opener kinds. A
// wildcard whose fixed part opens with a question word decides what a
// person means before the model ever sees the words -
// RULES-AND-LEARNED-COMPONENTS.md's "a rule decides only closed, exact
// things," never a word rule reading intent. The one exception is a
// computed wildcard on a compute or clock package: its own
// deterministic resolver, never the pattern text, decides whether it
// fires - named here, once, as the single list both the manifest lint
// (this file's own tests, backend/tests/manifestLint.test.ts) and the
// commands node (nodes/commands.ts) read, so an opener can never be
// "allowed" in one place and "gated" in a different, driftable way in
// the other.
import { evaluateExpression } from "@maipai/spec/interpreters/ts/compute.js";

/** The interrogative openers RULES-AND-LEARNED-COMPONENTS.md and the
 * state record both name: "who, what, when, where, which, why, how or
 * is." A trailing `\b` catches a contraction's own root ("who's",
 * "what's", "how's") without also matching a real imperative opener
 * that merely starts with the same letters (nothing bundled does). */
const QUESTION_WORD_RE = /^(?:who|what|when|where|which|why|how|is)\b/i;

/** The text before a pattern's one wildcard, or the whole pattern for a
 * fixed phrase (no `*` at all). Patterns never carry more than one `*`
 * (matchPattern's own rule, turnEngine.ts), so the first index is the
 * only one that matters. */
export function fixedPartOf(pattern: string): string {
  const idx = pattern.indexOf("*");
  return idx === -1 ? pattern : pattern.slice(0, idx);
}

/** True only for a WILDCARD pattern whose fixed part opens with a
 * question word - a fixed phrase (no wildcard) is never "a hijack," it
 * always means the same closed thing, and an imperative wildcard
 * ("define *", "convert *") never trips this by construction (none of
 * the bundled verbs starts with one of the words above). */
export function isQuestionWordOpener(pattern: string): boolean {
  return pattern.includes("*") && QUESTION_WORD_RE.test(fixedPartOf(pattern).trim());
}

/** `packageId:pattern` keys allowed to open with a question word - the
 * third closed opener kind (a computed wildcard on a compute or clock
 * package). Each value is that pattern's OWN deterministic resolver:
 * true only when the captured remainder is real input for that
 * package, decided by the package's own evaluator, never a guess about
 * what the words mean. math's "what does * equal" is the only bundled
 * instance today; SIGNAL-02 adds almanac-time's "what time is it in *"
 * the same way, gated by the zone library's own place lookup instead. */
export const COMPUTED_WILDCARD_RESOLVERS: Readonly<Record<string, (remainder: string) => boolean>> = {
  "math:what does * equal": (remainder) => {
    try {
      evaluateExpression(remainder);
      return true;
    } catch {
      return false;
    }
  },
};

/** Every `routing.patterns` entry on this manifest that opens with a
 * question word and is not a named computed opener - the manifest
 * lint's own refusal list (empty means the manifest is clean). */
export function lintManifestPatterns(packageId: string, patterns: readonly string[]): string[] {
  return patterns.filter((pattern) => isQuestionWordOpener(pattern) && !(`${packageId}:${pattern}` in COMPUTED_WILDCARD_RESOLVERS));
}

/** A code review (2026-09-23) caught a real gap `isQuestionWordOpener`
 * cannot close by its own rule: knowledge's "tell me about *" and
 * media-lookup's "tell me about the movie *" both grammatically read
 * as an imperative ("tell me...", not "who"/"what"/an interrogative
 * pronoun), so `classifyTurnSignal` correctly reads "tell me about
 * quantum entanglement" as `directive` - but the remainder is exactly
 * the same open, free-form topic "what is *"'s remainder is, and a
 * blind pattern match on it reproduces the identical hijack (dev.md
 * "The knowledge hijack" names both patterns among knowledge's own
 * five, alongside the interrogative-pronoun ones). Named here, once,
 * as its own small, closed list (never a guess about a verb's meaning,
 * never a broadened regex that would also catch a real imperative
 * argument-by-definition opener some other package might add): a
 * wildcard on this list never fires from the commands node, on any
 * turn, whatever `primary_act` reads - it always yields to the model,
 * the identical outcome a question-word wildcard with no resolver
 * already gets. */
export const NEVER_FIRES_WILDCARDS: ReadonlySet<string> = new Set(["knowledge:tell me about *", "media-lookup:tell me about the movie *"]);
