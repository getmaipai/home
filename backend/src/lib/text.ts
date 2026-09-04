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
