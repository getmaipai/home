// RESEARCH-PIN-01 (senior review of the live research runs, 2026-11-01): before any web search, a research turn pins WHAT the person means to one
// canonical article (from the offline library, else the live Wikimedia API when the household allows it for an adult), and every later
// search carries that article's distinctive words. The live runs showed why: with a bare one-letter title the engines returned a person,
// lists and the wrong work, and the old guard that stripped any year the question had not spelled out made it worse ("the 80s"
// is not "1984"). The pin replaces that guard's job: the anchor's own title, years and lead are the words searches may carry.
// Nothing here names a subject or a kind of question; the model picks among real article titles and the code reads the title's shape.
import type { PersonRow } from "@/types";
import { complete } from "@/lib/llm";
import { searchReference } from "@/lib/referenceSearch";
import { kiwixBaseUrl } from "@/lib/kiwixSidecar";
import { installed, libraryRequest } from "@/lib/kiwixClient";
import { extractFullArticle, type ArticleBlock, type ArticleInline } from "@/lib/retrieval/extractArticle";
import { wikimediaGate } from "@/lib/retrieval/sourceMode";
import { wikimediaApiJson } from "@/lib/packageHost";
import { wikimediaLiveBaseUrl } from "@/lib/wikimediaLive";
import type { Brief } from "./researchPipeline";

export interface ArticleSection { heading: string; text: string }
/** An article read whole: its lead (the text before the first heading) and its sections in order. */
export interface ArticleText {
  title: string;
  lead: string;
  sections: ArticleSection[];
  source: "library" | "wikimedia";
  /** Where it was read: the offline library's book and path, or the live article's public address. */
  book?: string;
  path?: string;
  url?: string;
}

export interface EntityCandidate {
  title: string;
  snippet: string;
  /** Reads the whole article; null when it cannot be read. Called only for the candidate that was picked. */
  load: () => Promise<ArticleText | null>;
}
/** One lookup of article titles for a phrase: the best few, best first. Never throws. */
export type CandidateFinder = (query: string, person: PersonRow, signal?: AbortSignal, opts?: { live?: boolean }) => Promise<EntityCandidate[]>;
/** One model call: a prompt in, text out, or null when the model is unavailable. */
export type PinWriter = (prompt: string) => Promise<string | null>;

export interface EntityAnchor {
  /** The article's title as written ("Name (1999 edition)"). */
  title: string;
  /** The title before its qualifier ("Name"). */
  baseName: string;
  /** Four-digit years in the title (the disambiguating qualifier). */
  years: string[];
  /** What a search carries to name this subject: the title with its brackets taken out ("Name 1999 edition"). */
  phrase: string;
  /** The article's opening, a few sentences. */
  lead: string;
  /** The whole article when it was read, for the backbone step. */
  article: ArticleText | null;
  /** Title and lead as one string: the words a search built on this anchor may carry. */
  text: string;
}

const MAX_QUERY_WORDS = 8;
const CANDIDATES_MAX = 5;
const LEAD_CHARS = 700;

let finderOverride: CandidateFinder | undefined;
let pinWriterOverride: PinWriter | undefined;
/** Tests: replace the title lookup and the picking model call; undefined restores them. */
export function __setEntityPinForTests(parts: { finder?: CandidateFinder | undefined; writer?: PinWriter | undefined } | undefined): void {
  finderOverride = parts?.finder;
  pinWriterOverride = parts?.writer;
}

// ---------------------------------------------------------------- reading articles

const inlineText = (inlines: readonly ArticleInline[]): string => inlines.map((i) => i.text).join("").replace(/\s+/g, " ").trim();

function blockText(block: ArticleBlock): string {
  switch (block.type) {
    case "paragraph": return inlineText(block.inlines);
    case "list": return block.items.map((item) => `- ${inlineText(item)}`).join("\n");
    case "rows": return block.rows.map((row) => `${row.label}: ${row.value}`).join("\n");
    case "table": return block.rows.map((row) => row.join(" | ")).join("\n");
    case "quote": return inlineText(block.inlines);
    case "note": return block.text;
    default: return "";
  }
}

/** An extracted article's blocks as a lead and sections: a level 2 heading starts a section, smaller headings stay inside it. */
export function articleFromBlocks(title: string, blocks: readonly ArticleBlock[], source: ArticleText["source"]): ArticleText {
  let lead = "";
  const sections: ArticleSection[] = [];
  let current: ArticleSection | null = null;
  for (const block of blocks) {
    if (block.type === "heading") {
      if (block.level === 2) { current = { heading: block.text.trim(), text: "" }; sections.push(current); }
      else if (current) current.text += `${current.text ? "\n" : ""}${block.text.trim()}:`;
      continue;
    }
    const text = blockText(block);
    if (!text) continue;
    if (current) current.text += `${current.text ? "\n" : ""}${text}`;
    else lead += `${lead ? "\n" : ""}${text}`;
  }
  return { title, lead: lead.trim(), sections: sections.filter((s) => s.text.trim() !== ""), source };
}

/** A plain-text extract in the Wikimedia API's shape ("== Heading ==" lines) as a lead and sections. */
export function articleFromExtract(title: string, extract: string, source: ArticleText["source"]): ArticleText {
  let lead = "";
  const sections: ArticleSection[] = [];
  let current: ArticleSection | null = null;
  for (const line of extract.split(/\r?\n/)) {
    const head = /^\s*==\s*([^=].*?)\s*==\s*$/.exec(line);
    if (head) { current = { heading: head[1]!.trim(), text: "" }; sections.push(current); continue; }
    if (/^\s*={3,}\s*.*?\s*={3,}\s*$/.test(line)) { if (current) current.text += `${current.text ? "\n" : ""}${line.replace(/=/g, "").trim()}:`; continue; }
    if (!line.trim()) continue;
    if (current) current.text += `${current.text ? "\n" : ""}${line.trim()}`;
    else lead += `${lead ? "\n" : ""}${line.trim()}`;
  }
  return { title, lead: lead.trim(), sections: sections.filter((s) => s.text.trim() !== ""), source };
}

// ---------------------------------------------------------------- finding candidates

async function libraryArticle(book: string, path: string, title: string): Promise<ArticleText | null> {
  const base = kiwixBaseUrl();
  if (!base) return null;
  try {
    const names = await installed(base);
    const res = await libraryRequest(base, `/content/${encodeURIComponent(book)}/${path.split("/").map(encodeURIComponent).join("/")}`, { timeoutMs: 4000 });
    if (!res.ok) return null;
    const full = extractFullArticle(await res.text(), { book, allowedBooks: new Set(names), allowLinks: false, allowImages: false });
    const article = { ...articleFromBlocks(full.title || title, full.blocks, "library"), book, path };
    return article.lead || article.sections.length > 0 ? article : null;
  } catch { return null; }
}

async function wikimediaArticle(title: string, signal?: AbortSignal): Promise<ArticleText | null> {
  const data = await wikimediaApiJson(`/w/api.php?action=query&format=json&redirects=1&prop=extracts&explaintext=1&titles=${encodeURIComponent(title)}`, "Wikipedia's article API didn't return JSON", signal);
  const pages = ((data?.query as { pages?: Record<string, { title?: unknown; extract?: unknown }> } | undefined)?.pages) ?? {};
  const page = Object.values(pages)[0];
  const extract = typeof page?.extract === "string" ? page.extract : "";
  if (!extract) return null;
  const found = typeof page?.title === "string" ? page.title : title;
  return { ...articleFromExtract(found, extract, "wikimedia"), url: `${wikimediaLiveBaseUrl()}/wiki/${encodeURIComponent(found.replace(/ /g, "_"))}` };
}

/** The default lookup: the offline library's title and text search (an adult's, with the household's book list), then the live Wikimedia search
 * when the household allows it and the library found fewer than two titles. With `live`, only the live search runs (the widening pass). */
export const defaultCandidateFinder: CandidateFinder = async (query, person, signal, opts) => {
  const found: EntityCandidate[] = [];
  if (!opts?.live) {
    try {
      const { hits } = await searchReference(person, query);
      for (const hit of hits.slice(0, CANDIDATES_MAX)) found.push({ title: hit.title, snippet: hit.snippet, load: () => libraryArticle(hit.book, hit.path, hit.title) });
    } catch { /* the library is optional */ }
  }
  if ((opts?.live || found.length < 2) && wikimediaGate("adult") === "run") {
    const data = await wikimediaApiJson(`/w/api.php?action=query&format=json&list=search&srlimit=${CANDIDATES_MAX}&srsearch=${encodeURIComponent(query)}`, "Wikipedia's search API didn't return JSON", signal);
    const hits = ((data?.query as { search?: { title?: unknown; snippet?: unknown }[] } | undefined)?.search) ?? [];
    for (const hit of hits) {
      if (typeof hit.title !== "string" || found.some((f) => f.title === hit.title)) continue;
      found.push({ title: hit.title, snippet: typeof hit.snippet === "string" ? hit.snippet.replace(/<[^>]+>/g, "") : "", load: () => wikimediaArticle(hit.title as string, signal) });
    }
  }
  return found.slice(0, CANDIDATES_MAX);
};

// ---------------------------------------------------------------- picking

export function pickPrompt(question: string, subject: string, candidates: readonly { title: string; snippet: string }[]): string {
  const list = candidates.map((c, i) => `${i + 1}. ${c.title}: ${c.snippet.replace(/\s+/g, " ").slice(0, 200)}`).join("\n");
  return `Pick the encyclopedia article that is exactly what this question is about.
Question: "${question.replace(/"/g, "'")}"
What it is about: ${subject}

Candidate articles:
${list}

Answer with one JSON object and nothing else: {"pick": 1}
"pick" is the number of the one article the question's own words describe (the right version, edition, person, work or event, not a list, an overview of a broader topic or a different one with a similar name), or 0 when no candidate is clearly it or two fit equally well. Use only what the question says.`;
}

export function parsePick(text: string | null, count: number): number | null {
  if (text === null) return null;
  try {
    const pick = (JSON.parse(text.match(/\{[\s\S]*?\}/)?.[0] ?? "{}") as { pick?: unknown }).pick;
    return typeof pick === "number" && Number.isInteger(pick) && pick >= 1 && pick <= count ? pick - 1 : null;
  } catch { return null; }
}

const chatPinWriter = (signal?: AbortSignal): PinWriter => async (prompt) => {
  const result = await complete("chat", [{ role: "user", content: prompt }], { max_tokens: 60, temperature: 0, thinking: false, ...(signal ? { signal } : {}) });
  return result.ok ? result.value.text : null;
};

// ---------------------------------------------------------------- the anchor

const QUALIFIER = /^(.*?)\s*\(([^)]*)\)\s*$/;

/** The anchor for an article: its base name, the years in its qualifier, the phrase a search carries, and its opening. */
export function anchorFor(title: string, article: ArticleText | null, snippet = ""): EntityAnchor {
  const m = QUALIFIER.exec(title.trim());
  const baseName = (m ? m[1]! : title).trim();
  const qualifier = m ? m[2]!.trim() : "";
  const years = [...new Set(qualifier.match(/\b(?:1[0-9]|20)\d{2}\b/g) ?? [])];
  const phrase = [baseName, qualifier].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  const lead = (article?.lead || snippet).replace(/\s+/g, " ").trim().slice(0, LEAD_CHARS);
  return { title: title.trim(), baseName, years, phrase, lead, article, text: `${title}. ${lead}` };
}

export interface PinResult { anchor: EntityAnchor | null; candidates: number; /** For the bench: the candidate titles and the model's pick reply. */ debug?: { titles: string[]; reply: string | null } }

/** Pins the subject of a research question to one article, or to none when no candidate is clearly it. The candidate set is widened until a
 * pick is made: the subject as the brief words it, then the question itself, then the live search (when allowed). About a second per pass
 * with the library, plus one short model call per pass; the passes stop at the first pick or after PIN_BUDGET_MS. Never throws. */
export async function pinEntity(brief: Brief | null, question: string, person: PersonRow, signal?: AbortSignal): Promise<PinResult> {
  if (!brief) return { anchor: null, candidates: 0 };
  const find = finderOverride ?? defaultCandidateFinder;
  // Title-shaped searches first (the library's title lookup answers them at once), then the subject as worded, the question, and the live search.
  const attempts: { query: string; live: boolean }[] = [
    ...(brief.titles ?? []).map((query) => ({ query, live: false })),
    { query: brief.subject, live: false },
    { query: question.slice(0, 120), live: false },
    { query: brief.subject, live: true },
  ];
  const started = Date.now();
  const seen = new Set<string>();
  let total = 0; // distinct titles offered so far
  let debug: PinResult["debug"];
  for (const attempt of attempts) {
    if (Date.now() - started > PIN_BUDGET_MS) break;
    let candidates: EntityCandidate[] = [];
    try { candidates = (await find(attempt.query, person, signal, { live: attempt.live })).slice(0, CANDIDATES_MAX); } catch { candidates = []; }
    // A pass that finds only titles already offered adds nothing to pick from.
    if (candidates.length === 0 || candidates.every((c) => seen.has(c.title))) continue;
    candidates.forEach((c) => seen.add(c.title));
    total = seen.size;
    let reply: string | null = null;
    try { reply = await (pinWriterOverride ?? chatPinWriter(signal))(pickPrompt(question, brief.subject, candidates)); } catch { reply = null; }
    debug = { titles: [...(debug?.titles ?? []), ...candidates.map((c) => c.title)], reply };
    const index = parsePick(reply, candidates.length);
    if (index === null) continue;
    const picked = candidates[index]!;
    let article: ArticleText | null = null;
    try { article = await picked.load(); } catch { article = null; }
    return { anchor: anchorFor(article?.title || picked.title, article, picked.snippet), candidates: total, debug };
  }
  return { anchor: null, candidates: total, ...(debug ? { debug } : {}) };
}

/** The passes of a pin stop starting after this long (milliseconds). */
const PIN_BUDGET_MS = 7_000;

// ---------------------------------------------------------------- queries

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const hasWord = (text: string, word: string): boolean => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(word)}(?![\\p{L}\\p{N}])`, "iu").test(text);

/** A search as plain keywords: quotation marks, boolean words, minus signs, site: operators and brackets taken out, spaces closed up. The
 * engines return nothing for the long quoted and OR forms (live runs). */
export function plainQuery(query: string): string {
  return query
    .replace(/\b(?:site|inurl|intitle|filetype):\S+/gi, " ")
    .replace(/["“”„()]/g, " ")
    .replace(/(^|\s)-(?=\S)/g, "$1")
    .replace(/\b(?:OR|AND|NOT)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** A search carrying its subject's name: when an anchor is pinned, the search names its base name and its years (added when missing), and
 * a query of more than eight words is cut back to eight, the anchor's words kept. Without an anchor only the plain-keyword cleaning applies. */
export function anchorQuery(query: string, anchor: EntityAnchor | null): string {
  const cleaned = plainQuery(query);
  if (!anchor || cleaned === "") return cleaned;
  const hasBase = anchor.baseName === "" || hasWord(cleaned, anchor.baseName);
  const missingYears = anchor.years.filter((y) => !hasWord(cleaned, y));
  const protectedWords = new Set([...anchor.phrase.split(/\s+/), ...anchor.years].map((w) => w.toLowerCase()));
  const body = hasBase ? cleaned : `${anchor.phrase} ${cleaned}`;
  const withYears = hasBase && missingYears.length > 0 ? `${body} ${missingYears.join(" ")}` : body;
  const words = withYears.split(/\s+/);
  if (words.length <= MAX_QUERY_WORDS) return withYears;
  // Keep the anchor's words and fill the rest from the front of the query.
  const keep = words.map((w, i) => ({ w, i, anchor: protectedWords.has(w.toLowerCase()) }));
  const room = MAX_QUERY_WORDS - keep.filter((k) => k.anchor).length;
  let free = 0;
  return keep.filter((k) => k.anchor || (free++ < room)).map((k) => k.w).join(" ");
}

/** The prompt block that tells the query writer which subject is pinned. No subject is named here; the anchor supplies it. */
export function anchorBlock(anchor: EntityAnchor | null): string {
  if (!anchor) return "";
  return `The subject is pinned to the article "${anchor.title}": ${anchor.lead.slice(0, 300)}\nEvery search must carry its name and year as "${anchor.phrase}".`;
}
