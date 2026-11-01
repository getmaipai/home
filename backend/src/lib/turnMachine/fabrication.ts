// RESEARCH-FABRICATION-01 (senior review, 2026-11-01): when the evidence was thin the writing model filled the gap with confident names
// and figures no source gave (a person, a title, a number). The claim check only looked at sentences that cite a source, so these went
// out unmarked. Two mechanical guards, neither tied to a kind of subject:
//   1. a sentence naming a person, place, title or quoted work (a run of capitalized words, or text in quotation marks) that appears in
//      none of the evidence is marked "(not in the sources)";
//   2. a sentence with no citation that states a fact (a figure or such a name) goes to the claim judge against the notes and the article.

/** Appended to a sentence whose names appear in no source. */
export const NOT_IN_SOURCES = " (not in the sources)";

const NAME_RUN = /\b[A-Z][a-z]{1,}(?:\s+(?:[A-Z]\.|[A-Z][a-z]+|of|the|de|von|van)){0,3}(?:\s+[A-Z][a-z]+)\b/g;
const QUOTED = /[“"]([^“”"\n]{3,60})[”"]/g;
const CALENDAR = new Set(["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]);

const squashText = (s: string): string => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ");

/** Words that open sentences in ordinary English and are capitalized only for being first; they are never part of a name there. */
const OPENERS = new Set(["the", "a", "an", "in", "on", "at", "it", "he", "she", "they", "we", "this", "that", "these", "those", "there", "then", "when", "while", "after", "before", "during", "but", "and", "so", "if", "as", "by", "for", "from", "with", "some", "many", "one", "two", "its", "his", "her", "their", "our", "my", "your", "no", "not", "also", "however", "since", "because", "although", "once", "today", "later", "earlier", "first", "second", "finally", "overall", "most", "all", "both", "each", "every", "such", "yes"]);

/** The names in a text: runs of two or more capitalized words (a calendar word alone is not a name, and a sentence-opening function word is
 * not part of one) and short quoted titles. */
export function namesIn(text: string): string[] {
  const found = new Set<string>();
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    for (const m of sentence.matchAll(NAME_RUN)) {
      let words = m[0].split(/\s+/).filter((w) => /^[A-Z]/.test(w));
      const atStart = sentence.slice(0, m.index).trim() === "";
      if (atStart && words.length > 0 && OPENERS.has(words[0]!.toLowerCase())) words = words.slice(1);
      if (words.length < 2) continue;
      if (words.every((w) => CALENDAR.has(w.toLowerCase()))) continue;
      found.add(words.join(" "));
    }
    for (const m of sentence.matchAll(QUOTED)) found.add(m[1]!);
  }
  return [...found];
}

/** True when the sentence states something checkable: a figure or a name. Hedged and general sentences carry neither. */
export function hasFactCue(sentence: string): boolean {
  return /\d/.test(sentence) || namesIn(sentence).length > 0;
}

export interface MarkResult { text: string; marked: number }

/** Marks each sentence that names someone or something no part of the evidence (nor the person's own question) contains. */
export function markUnsourcedNames(text: string, evidence: string, question: string): MarkResult {
  const haystack = squashText(`${evidence}\n${question}`);
  let marked = 0;
  const parts = text.split(/(?<=[.!?])(\s+)/);
  const out = parts.map((part) => {
    if (part.trim() === "" || part.includes(NOT_IN_SOURCES)) return part;
    const unknown = namesIn(part).filter((name) => !haystack.includes(squashText(name)));
    if (unknown.length === 0) return part;
    marked += 1;
    const bare = part.replace(/\s+$/, "");
    const punct = bare.match(/[.!?]$/)?.[0] ?? "";
    return `${punct ? bare.slice(0, -1) : bare}${NOT_IN_SOURCES}${punct}${part.slice(bare.length)}`;
  });
  return { text: out.join(""), marked };
}
