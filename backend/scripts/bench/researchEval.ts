// RESEARCH-TIER-01: the pass condition of a research question, scored from the finished run (its answer, the sources it
// cited and the queries it wrote). A case is data (scripts/bench/research-cases/*.json); no production prompt and no test
// names a person or a title. Wording checks live here, in the bench, never in the turn engine (RULES.md rule 1).
export interface ResearchCase {
  id: string;
  utterance: string;
  /** Each topic is covered when the answer mentions any of its phrases (case-insensitive). */
  topics: { name: string; anyOf: string[] }[];
  /** Distinct sites the answer's sources must span. */
  minSites: number;
  /** A person the answer must not credit with the work the question is about. */
  wrongAttributions: { name: string }[];
}
export interface ResearchRun { answer: string; sources: { site?: string; url: string }[]; queries: string[] }
export interface ResearchVerdict { pass: boolean; failures: string[]; sites: number }

const CREDIT_CUES = /\b(created|creator|wrote|written by|writer|produced|producer|directed|showrunner|developed by|behind the (?:series|show))\b/i;
const NEGATION = /\b(not|never|no involvement|did not|didn't|wasn't|was not|neither|nor|without)\b/i;

const sentences = (text: string): string[] => text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);

export function judgeResearchAnswer(c: ResearchCase, run: ResearchRun): ResearchVerdict {
  const failures: string[] = [];
  const lower = run.answer.toLowerCase();
  for (const topic of c.topics) if (!topic.anyOf.some((phrase) => lower.includes(phrase.toLowerCase()))) failures.push(`missing topic: ${topic.name}`);
  const sites = new Set(run.sources.map((s) => (s.site ?? (() => { try { return new URL(s.url).hostname; } catch { return s.url; } })()).replace(/^www\./, "")));
  if (sites.size < c.minSites) failures.push(`only ${sites.size} distinct sites, need ${c.minSites}`);
  for (const wrong of c.wrongAttributions) {
    for (const sentence of sentences(run.answer)) {
      if (sentence.toLowerCase().includes(wrong.name.toLowerCase()) && CREDIT_CUES.test(sentence) && !NEGATION.test(sentence)) failures.push(`wrong attribution: ${wrong.name}`);
    }
  }
  return { pass: failures.length === 0, failures: [...new Set(failures)], sites: sites.size };
}
