// RESEARCH-TIER-01: the pass condition of a research question, scored from the finished run (its answer, the sources it
// cited, the passages it fetched and the queries it wrote). A case is data (scripts/bench/research-cases/*.json); no
// production prompt names a person or a title. Wording checks live here, in the bench, never in the turn engine
// (RULES.md rule 1). Whether a sentence credits a person is a judge call (a model reads the sentence and the fetched
// passages), not a keyword match: a sentence about another of their works is not a claim about this one.
// RESEARCH-EVAL-02 (senior review, 2026-11-01): three more checks the real failures needed. IDENTIFICATION: the answer names the exact
// work in its opening (two of the case's identifiers) and a judge confirms it is about that work and not another one with a similar name.
// FABRICATION: a person, place or title in the answer that appears in no fetched passage, no note, no query and not in the question fails.
export interface ResearchCase {
  id: string;
  utterance: string;
  /** The exact work the question is about, as the judge is told it (title, years, kind). */
  production: string;
  /** Words that identify the work (years, a channel, an edition): the answer's opening must contain at least `minIdentifiers` of them. */
  identifiers?: string[];
  minIdentifiers?: number;
  /** Each topic is covered when the answer mentions any of its phrases (case-insensitive). */
  topics: { name: string; anyOf: string[] }[];
  /** Distinct sites the answer's sources must span. */
  minSites: number;
  /** People whose credits are checked: a sentence that credits or places one of them in the production must be supported by a fetched passage. */
  watchedPeople: { name: string }[];
}
export interface ResearchRun {
  answer: string;
  sources: { site?: string; url: string }[];
  queries: string[];
  /** The text of the fetched passages (titles, snippets, page text) the judge checks credit claims against. */
  evidence?: string;
  /** Pages read and light-model seconds of the run, recorded in the verdict. */
  pagesRead?: number;
  lightModelSeconds?: number;
}
export interface ResearchVerdict { pass: boolean; failures: string[]; sites: number; pagesRead?: number; lightModelSeconds?: number }
/** One model call: a prompt in, the model's text out. */
export type Judge = (prompt: string) => Promise<string>;
export type SentenceKind = "credit" | "other_work" | "context";
export interface ClassifiedSentence { person: string; sentence: string; kind: SentenceKind; supported: boolean }

import { namesIn } from "@/lib/turnMachine/fabrication";
const squashText = (s: string): string => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ");
const sentences = (text: string): string[] => text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);

/** Topics and distinct sites: structural, no judge. */
export function judgeResearchAnswer(c: ResearchCase, run: ResearchRun): ResearchVerdict {
  const failures: string[] = [];
  const lower = run.answer.toLowerCase();
  for (const topic of c.topics) if (!topic.anyOf.some((phrase) => lower.includes(phrase.toLowerCase()))) failures.push(`missing topic: ${topic.name}`);
  const sites = new Set(run.sources.map((s) => (s.site ?? (() => { try { return new URL(s.url).hostname; } catch { return s.url; } })()).replace(/^www\./, "")));
  if (sites.size < c.minSites) failures.push(`only ${sites.size} distinct sites, need ${c.minSites}`);
  return { pass: failures.length === 0, failures: [...new Set(failures)], sites: sites.size };
}

export function creditPrompt(c: ResearchCase, person: string, sentence: string, evidence: string): string {
  return `You check one sentence from a research answer.
The question was about this work: ${c.production}.
Sentence: "${sentence}"
Person named in it: ${person}

Passages the answer's sources returned:
"""
${evidence.slice(0, 12000)}
"""

Answer with one JSON object and nothing else: {"kind": "credit" | "other_work" | "context", "supported": true | false}
- "credit": the sentence credits ${person} with, or places ${person} inside the making or running of, the work above (creator, writer, producer, director, executive producer, lead, demoted or fired from it, and so on).
- "other_work": it is about a different named work (a later or earlier work, a remake, a book) or a different thing, including a claim about one of ${person}'s other works.
- "context": the person is only mentioned (background, a quote, a comparison, an offer to look something up, a remark about their style or taste) with no claim about who made or ran the work above.
"supported" is true only when a passage above says what the sentence says about ${person} and that work; otherwise false.`;
}

function parseClass(text: string): { kind: SentenceKind; supported: boolean } {
  const match = text.match(/\{[\s\S]*?\}/);
  try {
    const parsed = JSON.parse(match?.[0] ?? "{}") as { kind?: unknown; supported?: unknown };
    const kind = parsed.kind === "credit" || parsed.kind === "other_work" || parsed.kind === "context" ? parsed.kind : "credit";
    return { kind, supported: parsed.supported === true };
  } catch {
    // An unreadable judge answer counts as an unsupported credit claim: the check fails closed.
    return { kind: "credit", supported: false };
  }
}

/** A sentence names a watched person by their full name or by their family name alone (a long enough last word). */
export function namesPerson(sentence: string, name: string): boolean {
  const lower = sentence.toLowerCase();
  if (lower.includes(name.toLowerCase())) return true;
  const last = name.trim().split(/\s+/).at(-1) ?? "";
  return last.length >= 4 && new RegExp(`(?<![\\p{L}\\p{N}])${last.toLowerCase()}(?![\\p{L}\\p{N}])`, "u").test(lower);
}

/** Every sentence of the answer that names a watched person is classified by the judge; only an unsupported credit claim fails. */
export async function judgeCredits(c: ResearchCase, run: ResearchRun, judge: Judge): Promise<{ failures: string[]; classified: ClassifiedSentence[] }> {
  const failures: string[] = [];
  const classified: ClassifiedSentence[] = [];
  const evidence = run.evidence ?? "";
  for (const sentence of sentences(run.answer)) {
    for (const person of c.watchedPeople) {
      if (!namesPerson(sentence, person.name)) continue;
      const verdict = parseClass(await judge(creditPrompt(c, person.name, sentence, evidence)));
      classified.push({ person: person.name, sentence, ...verdict });
      if (verdict.kind === "credit" && !verdict.supported) failures.push(`unsupported credit: ${person.name}: "${sentence.slice(0, 140)}"`);
    }
  }
  return { failures, classified };
}

export function identificationPrompt(c: ResearchCase, opening: string): string {
  return `You check the opening of a research answer.
The question was about exactly this work: ${c.production}.
Opening of the answer:
"""
${opening.slice(0, 1500)}
"""
Answer with one JSON object and nothing else: {"about_this_work": true | false}
"about_this_work" is true only when the opening treats THIS work as the subject. It is false when the subject is a different work, an earlier or later one, a remake, a franchise as a whole, or it is unclear which one is meant.`;
}

/** The answer's opening is its first paragraph (up to 700 characters). */
const openingOf = (answer: string): string => answer.trim().split(/\n\s*\n/)[0]!.slice(0, 700);

/** Identification: structural (the case's identifiers in the opening) then a judge. Absent identifiers skip the structural part. */
export async function judgeIdentification(c: ResearchCase, run: ResearchRun, judge: Judge): Promise<string[]> {
  const failures: string[] = [];
  const opening = openingOf(run.answer);
  if (c.identifiers && c.identifiers.length > 0) {
    const need = c.minIdentifiers ?? 2;
    const have = c.identifiers.filter((id) => opening.toLowerCase().includes(id.toLowerCase())).length;
    if (have < need) failures.push(`the opening does not identify the work (${have} of ${need} identifiers)`);
  }
  try {
    const match = (await judge(identificationPrompt(c, opening))).match(/\{[\s\S]*?\}/);
    const parsed = JSON.parse(match?.[0] ?? "{}") as { about_this_work?: unknown };
    if (parsed.about_this_work !== true) failures.push("the answer is not about the work asked about");
  } catch {
    failures.push("the answer is not about the work asked about");
  }
  return failures;
}

/** Fabrication: names and quoted titles of the answer that no passage, note, query or the question contains. */
export function judgeFabrication(c: ResearchCase, run: ResearchRun): string[] {
  const haystack = squashText(`${run.evidence ?? ""}\n${run.queries.join("\n")}\n${c.utterance}\n${run.sources.map((s) => `${s.site ?? ""} ${s.url}`).join("\n")}`);
  const unknown = new Set<string>();
  for (const sentence of sentences(run.answer)) for (const name of namesIn(sentence)) if (!haystack.includes(squashText(name))) unknown.add(name);
  return unknown.size > 0 ? [`names no source gives: ${[...unknown].slice(0, 8).join("; ")}`] : [];
}

/** The whole pass condition: identification, topics, sites, the judged credit check and the fabrication check. */
export async function judgeResearch(c: ResearchCase, run: ResearchRun, judge: Judge): Promise<ResearchVerdict & { classified: ClassifiedSentence[] }> {
  const base = judgeResearchAnswer(c, run);
  const identification = await judgeIdentification(c, run, judge);
  const credits = await judgeCredits(c, run, judge);
  const failures = [...identification, ...base.failures, ...credits.failures, ...judgeFabrication(c, run)];
  return { pass: failures.length === 0, failures, sites: base.sites, classified: credits.classified, ...(run.pagesRead !== undefined ? { pagesRead: run.pagesRead } : {}), ...(run.lightModelSeconds !== undefined ? { lightModelSeconds: run.lightModelSeconds } : {}) };
}
