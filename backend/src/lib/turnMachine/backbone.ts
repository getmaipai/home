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
export const BACKBONE_CHARS = 9_000;
/** Characters of a targeted second read for parts the first reading did not cover. */
export const EXTRA_READ_CHARS = 4_000;
const LEAD_CHARS = 1_800;
const SECTIONS_MAX = 8;

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
  /** The headings of the sections in the text, in article order. */
  headings: string[];
  /** Every heading the article offered (the picker saw these). */
  seen: string[];
  chars: number;
  /** The article as a source of the reply (null when it cannot be named as one). */
  source: Source | null;
  /** Headings of sections the picker did not take, with their text, for a later targeted read. */
  unread: ArticleSection[];
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

/** Splits `room` characters over `sections` in priority order so no section is starved by a long one before it: each gets an equal share
 * (or its whole length when shorter), and what a short section leaves over goes to the cut ones in priority order. */
export function allocate(lengths: readonly number[], room: number): number[] {
  const out = lengths.map(() => 0);
  if (lengths.length === 0 || room <= 0) return out;
  const share = Math.floor(room / lengths.length);
  let left = room;
  lengths.forEach((len, i) => { out[i] = Math.min(len, share); left -= out[i]!; });
  for (let i = 0; i < lengths.length && left > 0; i++) {
    const extra = Math.min(lengths[i]! - out[i]!, left);
    out[i]! += extra;
    left -= extra;
  }
  return out;
}

/** Section numbers for `wanted` parts, chosen by the model over the headings (most useful first), then the sections whose heading and opening
 * share the most words with the parts; at most SECTIONS_MAX. */
async function chooseSections(sections: readonly ArticleSection[], question: string, wanted: readonly string[], signal?: AbortSignal): Promise<number[]> {
  if (sections.length === 0) return [];
  let reply: string | null = null;
  try { reply = await (writerOverride ?? chatWriter(signal))(choosePrompt(question, wanted, sections)); } catch { reply = null; }
  const modelPicks = parseChosen(reply, sections.length) ?? [];
  const overlap = overlapChoice(wanted, sections).filter((i) => !modelPicks.includes(i));
  const merged = [...modelPicks, ...overlap.slice(0, 2)].slice(0, SECTIONS_MAX);
  return merged.length > 0 ? merged : sections.map((_, i) => i).slice(0, SECTIONS_MAX);
}

/** The text of chosen sections, in article order, `room` characters shared between them by priority (the order of `chosen`). */
function sectionsText(sections: readonly ArticleSection[], chosen: readonly number[], room: number): { parts: { heading: string; text: string }[]; used: number } {
  const lengths = chosen.map((i) => sections[i]!.text.length + sections[i]!.heading.length + 8);
  const alloc = allocate(lengths, room);
  const taken = chosen.map((index, k) => ({ index, room: alloc[k]! - sections[index]!.heading.length - 8 })).filter((t) => t.room >= Math.min(200, sections[t.index]!.text.length));
  const parts = taken.sort((a, b) => a.index - b.index).map((t) => ({ heading: sections[t.index]!.heading, text: cutAtSentence(sections[t.index]!.text, t.room) }));
  return { parts, used: parts.reduce((n, p) => n + p.text.length + p.heading.length + 8, 0) };
}

/** The lead and the sections that bear on the question, in article order, within `budget` characters. The budget is shared between the
 * chosen sections (a long early section no longer starves a later one that holds the answer). */
export async function pickBackbone(anchor: EntityAnchor, question: string, wanted: readonly string[], opts: { budget?: number; signal?: AbortSignal } = {}): Promise<Backbone | null> {
  const article = anchor.article;
  if (!article) return null;
  const budget = opts.budget ?? BACKBONE_CHARS;
  const sections = article.sections.filter((s) => !STRUCTURAL.test(s.heading.trim()));
  const chosen = await chooseSections(sections, question, wanted, opts.signal);
  const lead = cutAtSentence(article.lead, Math.min(LEAD_CHARS, budget));
  const { parts } = sectionsText(sections, chosen, Math.max(0, budget - lead.length));
  const all = lead ? [{ heading: "", text: lead }, ...parts] : parts;
  if (all.length === 0) return null;
  const body = all.map((p) => (p.heading ? `## ${p.heading}\n${p.text}` : p.text)).join("\n\n");
  const taken = new Set(parts.map((p) => p.heading));
  return { title: article.title, text: body, headings: parts.map((p) => p.heading), seen: sections.map((s) => s.heading), chars: body.length, source: backboneSource(article), unread: sections.filter((s) => !taken.has(s.heading)) };
}

/** A targeted read for parts the first reading did not cover: the model picks from the sections not yet read, and their text is returned
 * (within `budget`, shared by priority). No search; the article is already in hand. Empty when nothing is left to read. */
export async function readMoreSections(unread: readonly ArticleSection[], question: string, parts: readonly string[], opts: { budget?: number; signal?: AbortSignal } = {}): Promise<{ text: string; headings: string[] }> {
  if (unread.length === 0 || parts.length === 0) return { text: "", headings: [] };
  const chosen = (await chooseSections(unread, question, parts, opts.signal)).slice(0, 3);
  const { parts: read } = sectionsText(unread, chosen, opts.budget ?? EXTRA_READ_CHARS);
  return { text: read.map((p) => `## ${p.heading}\n${p.text}`).join("\n\n"), headings: read.map((p) => p.heading) };
}

/** The block the writing round gets for the backbone article, cited by its source number (null: the article cannot be named as a source,
 * so it is background only and the writer is told not to cite it). */
export function backboneBlock(backbone: Backbone, sourceNumber: number | null): string {
  return sourceNumber === null
    ? `Background article, read in full by section; it has no source number, so do not cite it (${backbone.title}):\n${backbone.text}`
    : `Backbone article, read in full by section, cite it as [${sourceNumber}] (${backbone.title}):\n${backbone.text}`;
}
