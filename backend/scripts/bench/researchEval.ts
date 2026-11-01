// RESEARCH-TIER-01: the pass condition of a research question, scored from the finished run (its answer, the sources it
// cited, the passages it fetched and the queries it wrote). A case is data (scripts/bench/research-cases/*.json); no
// production prompt and no test names a person or a title. Wording checks live here, in the bench, never in the turn engine
// (RULES.md rule 1). Whether a sentence credits a person is a judge call (a model reads the sentence and the fetched
// passages), not a keyword match: a sentence that says someone wrote a sequel novel is not a claim about the show.
export interface ResearchCase {
  id: string;
  utterance: string;
  /** The exact work the question is about, as the judge is told it (title, years, kind). */
  production: string;
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
}
export interface ResearchVerdict { pass: boolean; failures: string[]; sites: number }
/** One model call: a prompt in, the model's text out. */
export type Judge = (prompt: string) => Promise<string>;
export type SentenceKind = "credit" | "other_work" | "context";
export interface ClassifiedSentence { person: string; sentence: string; kind: SentenceKind; supported: boolean }

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
- "credit": the sentence credits ${person} with, or places ${person} inside the making or running of, the work above (creator, writer, producer, director, executive producer, showrunner, demoted or fired from it, and so on).
- "other_work": it is about a different named work (a sequel novel, an earlier miniseries, a reboot) or a different thing.
- "context": the person is only mentioned (background, a quote, a comparison) with no claim about who made or ran the work above.
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

/** Every sentence of the answer that names a watched person is classified by the judge; only an unsupported credit claim fails. */
export async function judgeCredits(c: ResearchCase, run: ResearchRun, judge: Judge): Promise<{ failures: string[]; classified: ClassifiedSentence[] }> {
  const failures: string[] = [];
  const classified: ClassifiedSentence[] = [];
  const evidence = run.evidence ?? "";
  for (const sentence of sentences(run.answer)) {
    for (const person of c.watchedPeople) {
      if (!sentence.toLowerCase().includes(person.name.toLowerCase())) continue;
      const verdict = parseClass(await judge(creditPrompt(c, person.name, sentence, evidence)));
      classified.push({ person: person.name, sentence, ...verdict });
      if (verdict.kind === "credit" && !verdict.supported) failures.push(`unsupported credit: ${person.name}: "${sentence.slice(0, 140)}"`);
    }
  }
  return { failures, classified };
}

/** The whole pass condition: topics, sites and the judged credit check. */
export async function judgeResearch(c: ResearchCase, run: ResearchRun, judge: Judge): Promise<ResearchVerdict & { classified: ClassifiedSentence[] }> {
  const base = judgeResearchAnswer(c, run);
  const credits = await judgeCredits(c, run, judge);
  const failures = [...base.failures, ...credits.failures];
  return { pass: failures.length === 0, failures, sites: base.sites, classified: credits.classified };
}
