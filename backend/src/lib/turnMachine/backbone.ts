// RESEARCH-BACKBONE-01 (senior review of the live research runs, 2026-11-01): the pinned article is the research turn's backbone source. The live runs
// kept 2,500 characters of it and lost the sections that answer a "why did it happen" or "what came next" question (they sat at characters 6,900 to
// 11,200 of an 11,800 character article). Here the writer is handed the article's lead and
// the sections that bear on the question's parts, uncut within a budget, with no light-model pass over them. Which sections is one short
// chat-model choice over the article's real headings, with a word-overlap fallback; no list of section names decides it.
import { complete } from "@/lib/llm";
import { sourcesFromRows } from "@/lib/turnContext";
import type { Source } from "@maipai/spec/gen/ts/source.js";
import type { ArticleSection, ArticleText, EntityAnchor } from "./entityPin";

/** Characters of the article the writing round is handed (about 3,000 tokens). */
export const BACKBONE_CHARS = 12_000;
const LEAD_CHARS = 1_800;
const SECTIONS_MAX = 7;

/** One model call: a prompt in, text out, or null when the model is unavailable. */
export type BackboneWriter = (prompt: string) => Promise<string | null>;
let writerOverride: BackboneWriter | undefined;
/** Tests: replaces the heading choice; undefined restores the chat model. */
export function __setBackboneWriterForTests(writer: BackboneWriter | undefined): void { writerOverride = writer; }

const chatWriter = (signal?: AbortSignal): BackboneWriter => async (prompt) => {
  const result = await complete("chat", [{ role: "user", content: prompt }], { max_tokens: 80, temperature: 0, thinking: false, ...(signal ? { signal } : {}) });
  return result.ok ? result.value.text : null;
};

/** Headings that are bookkeeping, not content, in any article. */
const STRUCTURAL = /^(?:references?|external links?|see also|notes?|footnotes?|further reading|bibliography|citations?|sources?)$/i;

export interface Backbone {
  title: string;
  /** The lead and the chosen sections as text, in article order, within the budget. */
  text: string;
  headings: string[];
  chars: number;
  /** The article as a source of the reply (null when it cannot be named as one). */
  source: Source | null;
}

const wordsOf = (text: string): Set<string> => new Set(text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 3));

export function choosePrompt(question: string, wanted: readonly string[], sections: readonly ArticleSection[]): string {
  const list = sections.map((s, i) => `${i + 1}. ${s.heading} (${s.text.length} characters)`).join("\n");
  return `An article has these sections:
${list}

The question being researched: "${question.replace(/"/g, "'")}"
The parts of it the answer must cover: ${wanted.length > 0 ? wanted.join("; ") : "everything the question asks"}

Answer with one JSON object and nothing else: {"sections": [2, 5]}
List up to ${SECTIONS_MAX} section numbers, the ones most likely to hold facts for those parts, most useful first. Choose by the headings and the question only.`;
}

export function parseChosen(text: string | null, count: number): number[] | null {
  if (text === null) return null;
  try {
    const raw = (JSON.parse(text.match(/\{[\s\S]*?\}/)?.[0] ?? "{}") as { sections?: unknown }).sections;
    if (!Array.isArray(raw)) return null;
    const picked = raw.filter((n): n is number => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= count).map((n) => n - 1);
    return picked.length > 0 ? [...new Set(picked)].slice(0, SECTIONS_MAX) : null;
  } catch { return null; }
}

/** The fallback: sections whose heading and opening share the most words with the question's parts, best first. */
export function overlapChoice(wanted: readonly string[], sections: readonly ArticleSection[]): number[] {
  const target = wordsOf(wanted.join(" "));
  return sections
    .map((s, i) => ({ i, score: [...wordsOf(`${s.heading} ${s.heading} ${s.text.slice(0, 300)}`)].filter((w) => target.has(w)).length }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, SECTIONS_MAX)
    .map((x) => x.i);
}

function cutAtSentence(text: string, max: number): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const end = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("\n"));
  return (end > max * 0.5 ? slice.slice(0, end + 1) : slice).trim();
}

/** The article's own address as a source of the reply: an offline-library article by its library address, a live one by its public address. */
export function backboneSource(article: ArticleText): Source | null {
  const row = article.book && article.path
    ? { title: article.title, url: `/api/reference/${encodeURIComponent(article.book)}/${article.path.split("/").map(encodeURIComponent).join("/")}`, snippet: article.lead.slice(0, 200), kind: "reference", source_label: article.book }
    : article.url
      ? { title: article.title, url: article.url, snippet: article.lead.slice(0, 200) }
      : null;
  return row ? sourcesFromRows([row])[0] ?? null : null;
}

/** The lead and the sections that bear on the question, in article order, within `budget` characters. */
export async function pickBackbone(anchor: EntityAnchor, question: string, wanted: readonly string[], opts: { budget?: number; signal?: AbortSignal } = {}): Promise<Backbone | null> {
  const article = anchor.article;
  if (!article) return null;
  const budget = opts.budget ?? BACKBONE_CHARS;
  const sections = article.sections.filter((s) => !STRUCTURAL.test(s.heading.trim()));
  let chosen: number[] = [];
  if (sections.length > 0) {
    let reply: string | null = null;
    try { reply = await (writerOverride ?? chatWriter(opts.signal))(choosePrompt(question, wanted, sections)); } catch { reply = null; }
    chosen = parseChosen(reply, sections.length) ?? overlapChoice(wanted, sections);
    if (chosen.length === 0) chosen = sections.map((_, i) => i).slice(0, SECTIONS_MAX);
  }
  const parts: { heading: string; text: string }[] = [];
  let used = 0;
  const lead = cutAtSentence(article.lead, Math.min(LEAD_CHARS, budget));
  if (lead) { parts.push({ heading: "", text: lead }); used += lead.length; }
  const headings: string[] = [];
  // Chosen sections go in article order; each is cut at a sentence when the budget runs short, later ones are dropped.
  for (const index of [...chosen].sort((a, b) => a - b)) {
    const section = sections[index]!;
    const room = budget - used - section.heading.length - 8;
    if (room < 200) break;
    const text = cutAtSentence(section.text, room);
    parts.push({ heading: section.heading, text });
    headings.push(section.heading);
    used += text.length + section.heading.length + 8;
  }
  if (parts.length === 0) return null;
  const body = parts.map((p) => (p.heading ? `## ${p.heading}\n${p.text}` : p.text)).join("\n\n");
  return { title: article.title, text: body, headings, chars: body.length, source: backboneSource(article) };
}

/** The block the writing round gets for the backbone article, cited by its source number (null: the article cannot be named as a source,
 * so it is background only and the writer is told not to cite it). */
export function backboneBlock(backbone: Backbone, sourceNumber: number | null): string {
  return sourceNumber === null
    ? `Background article, read in full by section; it has no source number, so do not cite it (${backbone.title}):\n${backbone.text}`
    : `Backbone article, read in full by section, cite it as [${sourceNumber}] (${backbone.title}):\n${backbone.text}`;
}
