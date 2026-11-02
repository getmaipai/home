// RESEARCH-FABRICATION-01 (senior review, 2026-11-01): when the evidence was thin the writing model filled the gap with confident names
// and figures no source gave (a person, a title, a number). The claim check only looked at sentences that cite a source, so these went
// out unmarked. Two mechanical guards, neither tied to a kind of subject:
//   1. a sentence naming a person, place, title or quoted work (a run of capitalized words, or text in quotation marks) that appears in
//      none of the evidence is marked "(not in the sources)";
//   2. a sentence with no citation that states a fact (a figure or such a name) goes to the claim judge against the notes and the article.

/** Appended to a sentence whose names appear in no source. */
export const NOT_IN_SOURCES = " (not in the sources)";

// A bare "the" does not join two capitalized runs ("New York City the Atlantic"); it joins only as "of the" ("Wedding of the Waters").
// Side effect: a name with a bare "the" ("Jack the Ripper") splits into its capitalized parts and is not checked as one name.
const NAME_RUN = /\b[A-Z][a-z]{1,}(?:\s+(?:[A-Z]\.|[A-Z][a-z]+|of(?:\s+the)?|de|von|van)){0,3}(?:\s+[A-Z][a-z]+)\b/g;
// A clause starts after a sentence end, a newline, or a colon, semicolon or opening bracket; a list marker is not part of the clause.
const CLAUSE_SPLIT = /\n+|\s*[:;(]\s*/;
const LIST_MARK = /^\s*(?:[-*•]|\d+[.)])\s+/;
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

export const squashText = (s: string): string => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ");

/** Words that open sentences in ordinary English and are capitalized only for being first; they are never part of a name there. */
const OPENERS = new Set(["the", "a", "an", "in", "on", "at", "it", "he", "she", "they", "we", "this", "that", "these", "those", "there", "then", "when", "while", "after", "before", "during", "but", "and", "so", "if", "as", "by", "for", "from", "with", "some", "many", "one", "two", "its", "his", "her", "their", "our", "my", "your", "no", "not", "also", "however", "since", "because", "although", "once", "today", "later", "earlier", "first", "second", "finally", "overall", "most", "all", "both", "each", "every", "such", "yes", "any", "another", "other", "several", "few", "more", "much", "only", "even", "still", "yet", "thus", "here", "now", "what", "which", "who", "how", "why", "where", "perhaps", "maybe", "unlike", "like", "despite", "without", "within", "under", "over", "between", "among", "through", "though", "until", "unless", "whether", "neither", "either", "nor", "or", "to", "into", "of", "about", "i", "you", "me", "us", "him", "them", "none", "nothing", "something", "anything", "everything", "someone", "anyone", "everyone", "instead", "meanwhile", "otherwise", "indeed", "again", "already", "almost", "often"]);

/** The names in a text: runs of two or more capitalized words (a calendar word alone is not a name, and a sentence-opening function word is
 * not part of one) and short quoted titles. */
export function namesIn(text: string): string[] {
  const found = new Set<string>();
  for (const sentence of withoutLabels(text).split(/(?<=[.!?])\s+/)) {
    for (const m of sentence.matchAll(QUOTED)) found.add(m[1]!);
    for (const clause of sentence.split(CLAUSE_SPLIT)) {
      const body = clause.replace(LIST_MARK, "");
      for (const m of body.matchAll(NAME_RUN)) {
        // The name is kept as written ("Wedding of the Waters"), so the connecting words it carries are still part of what is looked up.
        let run = m[0];
        const atStart = body.slice(0, m.index).trim() === "";
        if (atStart && OPENERS.has(run.split(/\s+/)[0]!.toLowerCase())) run = run.replace(/^\S+\s+/, "");
        const words = run.split(/\s+/).filter((w) => /^[A-Z]/.test(w));
        if (words.length < 2 || !/^[A-Z]/.test(run)) continue;
        if (words.every((w) => CALENDAR.has(w.toLowerCase()))) continue;
        found.add(run);
      }
    }
  }
  return [...found];
}

/** How far apart (characters) two neighbouring words of a name may sit in the evidence and still count as the same mention: room for a
 * connective or a given name between them ("Countess of Lovelace", "Coach Herb Brooks"), not for two separate passages. */
const NAME_GAP_CHARS = 24;
const escapeRe = (w: string): string => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A source is named by its host ("dailyhealthdigest.example"), and a writer cites it by its display name ("Daily Health Digest"). A name of
 * two or more words whose letters, spaces taken out, are one label of a host the evidence holds is that source's own name, so it is given. */
function givenAsHost(name: string, haystack: string): boolean {
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length < 2) return false;
  const compact = name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  if (compact.length < 6) return false;
  for (const host of haystack.matchAll(/[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu)) {
    if (host[0].split(".").some((label) => label.replace(/-/g, "") === compact)) return true;
  }
  return false;
}

/** A name counts as given when the evidence holds it as written, or holds each pair of neighbouring words of it close together (a writer may
 * drop a connective or join a title to a surname). Words that each appear somewhere in the sources but never near one another do not make
 * a name given: an invented person assembled from known words is still marked. */
export function nameIsGiven(name: string, haystack: string): boolean {
  if (haystack.includes(squashText(name))) return true;
  if (givenAsHost(name, haystack)) return true;
  const words = name.split(/\s+/).filter((w) => /^[A-Z]/.test(w)).map((w) => w.replace(/['’]s$/, "").replace(/[^\p{L}\p{N}-]/gu, "").toLowerCase()).filter(Boolean);
  if (words.length < 2) return words.length === 1 && new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(words[0]!)}(?![\\p{L}\\p{N}])`, "u").test(haystack);
  const near = (a: string, b: string): boolean => {
    const w = (x: string): string => `(?<![\\p{L}\\p{N}])${escapeRe(x)}(?![\\p{L}\\p{N}])`;
    return new RegExp(`${w(a)}[^\\n]{0,${NAME_GAP_CHARS}}?${w(b)}|${w(b)}[^\\n]{0,${NAME_GAP_CHARS}}?${w(a)}`, "u").test(haystack);
  };
  return words.slice(1).every((w, i) => near(words[i]!, w));
}

/** True when the sentence states something checkable: a figure or a name. Hedged and general sentences carry neither. */
export function hasFactCue(sentence: string): boolean {
  return /\d/.test(sentence) || namesIn(sentence).length > 0;
}

export interface MarkResult { text: string; marked: number; dropped: number }

/** A sentence that says it is a guess or an inference. The writer may only repeat the analysis's guesses, which rest on notes; one that adds
 * a name no source gives has nothing to rest on, so it is dropped instead of marked. */
const GUESS_CUE = /\b(?:guess(?:es|ed)?|infer(?:s|red)?|speculat\w*|presum\w*|suppos\w*)\b/i;

/** Marks each sentence that names someone or something no part of the evidence (nor the person's own question) contains. */
export function markUnsourcedNames(text: string, evidence: string, question: string): MarkResult {
  const haystack = squashText(`${evidence}\n${question}`);
  let marked = 0;
  let dropped = 0;
  const parts = text.split(/(?<=[.!?])(\s+)/);
  const out = parts.map((part) => {
    if (part.trim() === "" || part.includes(NOT_IN_SOURCES)) return part;
    const unknown = namesIn(part).filter((name) => !nameIsGiven(name, haystack));
    if (unknown.length === 0) return part;
    if (GUESS_CUE.test(part)) { dropped += 1; return ""; }
    marked += 1;
    const bare = part.replace(/\s+$/, "");
    const punct = bare.match(/[.!?]$/)?.[0] ?? "";
    return `${punct ? bare.slice(0, -1) : bare}${NOT_IN_SOURCES}${punct}${part.slice(bare.length)}`;
  });
  return { text: out.join(""), marked, dropped };
}
