// RESEARCH-FABRICATION-01 (senior review, 2026-11-01): when the evidence was thin the writing model filled the gap with confident names
// and figures no source gave (a person, a title, a number). The claim check only looked at sentences that cite a source, so these went
// out unmarked. Two mechanical guards, neither tied to a kind of subject:
//   1. a sentence naming a person, place, title or quoted work (a run of capitalized words, or text in quotation marks) that appears in
//      none of the evidence is marked "(not in the sources)";
//   2. a sentence with no citation that states a fact (a figure or such a name) goes to the claim judge against the notes and the article.

/** Appended to a sentence whose names appear in no source. */
export const NOT_IN_SOURCES = " (not in the sources)";

const NAME_RUN = /\b[A-Z][a-z]{1,}(?:\s+(?:[A-Z]\.|[A-Z][a-z]+|of|the|de|von|van)){0,3}(?:\s+[A-Z][a-z]+)\b/g;
// A quoted title: starts with a capital letter or digit and ends on a non-space, so the words BETWEEN two quoted phrases ("A" and "B") are not one.
// A comma, full stop or similar closing a quote in American punctuation ("Title,") is not part of the title.
const QUOTED = /[“"]([A-Z0-9][^“”"\n]{1,58}[^“”"\s,.;:!])[”"]/g;
/** Section labels the writer adds are not names: heading lines, lines that are only bold, "Label:" lines, and a bold "Label:" opening a line. */
export function withoutLabels(text: string): string {
  return text
    .split("\n")
    .filter((line) => !/^\s*#{1,6}\s/.test(line) && !/^\s*(?:[-*]\s+)?\*\*[^*\n]{1,80}\*\*:?\s*$/.test(line) && !/^\s*[A-Za-z][^.!?\n]{0,60}:\s*$/.test(line))
    .map((line) => line.replace(/\*\*[^*\n]{1,60}:\*\*|\*\*[^*\n]{1,60}\*\*:/g, " "))
    .join("\n");
}
const CALENDAR = new Set(["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]);

const squashText = (s: string): string => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ");

/** Words that open sentences in ordinary English and are capitalized only for being first; they are never part of a name there. */
const OPENERS = new Set(["the", "a", "an", "in", "on", "at", "it", "he", "she", "they", "we", "this", "that", "these", "those", "there", "then", "when", "while", "after", "before", "during", "but", "and", "so", "if", "as", "by", "for", "from", "with", "some", "many", "one", "two", "its", "his", "her", "their", "our", "my", "your", "no", "not", "also", "however", "since", "because", "although", "once", "today", "later", "earlier", "first", "second", "finally", "overall", "most", "all", "both", "each", "every", "such", "yes"]);

/** The names in a text: runs of two or more capitalized words (a calendar word alone is not a name, and a sentence-opening function word is
 * not part of one) and short quoted titles. */
export function namesIn(text: string): string[] {
  const found = new Set<string>();
  for (const sentence of withoutLabels(text).split(/(?<=[.!?])\s+/)) {
    for (const m of sentence.matchAll(NAME_RUN)) {
      // The name is kept as written ("Wedding of the Waters"), so the connecting words it carries are still part of what is looked up.
      let run = m[0];
      const atStart = sentence.slice(0, m.index).trim() === "";
      if (atStart && OPENERS.has(run.split(/\s+/)[0]!.toLowerCase())) run = run.replace(/^\S+\s+/, "");
      const words = run.split(/\s+/).filter((w) => /^[A-Z]/.test(w));
      if (words.length < 2 || !/^[A-Z]/.test(run)) continue;
      if (words.every((w) => CALENDAR.has(w.toLowerCase()))) continue;
      found.add(run);
    }
    for (const m of sentence.matchAll(QUOTED)) found.add(m[1]!);
  }
  return [...found];
}

/** A name counts as given when the evidence holds it as written, or holds every capitalized word of it (a writer may join words the
 * sources give separately, as a title and a surname, or "Atlantic Ocean" for "the Atlantic"); an invented name has a word no source has. */
export function nameIsGiven(name: string, haystack: string): boolean {
  if (haystack.includes(squashText(name))) return true;
  const words = name.split(/\s+/).filter((w) => /^[A-Z]/.test(w)).map((w) => w.replace(/['’]s$/, "").replace(/[^\p{L}\p{N}-]/gu, "").toLowerCase()).filter(Boolean);
  const hasWord = (w: string): boolean => new RegExp(`(?<![\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "u").test(haystack);
  return words.length > 0 && words.every(hasWord);
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
    const unknown = namesIn(part).filter((name) => !nameIsGiven(name, haystack));
    if (unknown.length === 0) return part;
    marked += 1;
    const bare = part.replace(/\s+$/, "");
    const punct = bare.match(/[.!?]$/)?.[0] ?? "";
    return `${punct ? bare.slice(0, -1) : bare}${NOT_IN_SOURCES}${punct}${part.slice(bare.length)}`;
  });
  return { text: out.join(""), marked };
}
