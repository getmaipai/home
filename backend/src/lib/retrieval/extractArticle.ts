// KS-01: the `extract_article` processor (DESIGN section 4.4, capability
// registry row `extract_article`, `learned: false`). It reads one ZIM
// article page and returns the lead (first paragraphs, at most 2,500
// characters), the infobox rows, the kept section names, and whether the
// page is a disambiguation page. CSS and template residue is stripped;
// References, See also and the other tail sections are dropped. Pure and
// deterministic: HTML in, a plain record out, no network.
import { parseHTML } from "linkedom";

type Element = ReturnType<typeof parseHTML>["document"]["body"];
type Node = Element;

export const LEAD_MAX_CHARS = 2500;
const INFOBOX_MAX_ROWS = 12;
const INFOBOX_VALUE_MAX = 200;
const DISAMBIGUATION_OPTIONS_MAX = 8;
const FULL_ARTICLE_DROP = "references, .references, .reflist, .navbox, .mw-editsection, script, style, iframe, form, noscript, svg, .catlinks, .metadata, .sistersitebox, .portal, .mw-jump-link, .mw-references-wrap";

export type ArticleInline = { type: "text" | "emphasis" | "strong"; text: string } | { type: "link"; text: string; target?: { book: string; path: string }; href?: string };
export type ArticleBlock =
  | { type: "heading"; level: 2 | 3 | 4; id: string; text: string }
  | { type: "paragraph"; inlines: ArticleInline[] }
  | { type: "list"; ordered: boolean; items: ArticleInline[][] }
  | { type: "rows"; rows: Array<{ label: string; value: string }> }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "figure"; src: string; alt: string; caption: string }
  | { type: "note"; text: string }
  | { type: "quote"; inlines: ArticleInline[]; cite?: string };
export interface FullArticle { title: string; blocks: ArticleBlock[]; toc: Array<{ id: string; title: string; level: 2 | 3 | 4 }>; redirectTo?: string }

function plain(el: Element): string { return cleanText(el.textContent ?? ""); }

/** Extract a closed, renderable block model. This walk deliberately ignores unknown markup. */
export interface FullArticleOptions {
  book: string; allowedBooks: ReadonlySet<string>; allowLinks: boolean; allowImages: boolean;
  /** `reference` (default) is the encyclopedia reader. `news` (NEWS-02b) keeps a publisher article's outbound links as plain `href`s
   * when `allowLinks` is true, drops them to text when false, finds the article body without the wiki wrappers, and reads `<blockquote>`
   * as a `quote` block. */
  mode?: "reference" | "news";
  /** News mode only: resolves relative links; without it a relative link is plain text. */
  baseUrl?: string;
}

/** An outbound link the news reader may keep: absolute http(s) only, no credentials, no script or data schemes. */
export function safeOutboundHref(raw: string, baseUrl?: string): string | null {
  try {
    const url = baseUrl ? new URL(raw, baseUrl) : new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch { return null; }
}

const NEWS_DROP = "nav, aside, footer, button, [role=navigation], [role=complementary], [aria-hidden=true]";

export function extractFullArticle(html: string, opts: FullArticleOptions): FullArticle {
  const news = opts.mode === "news";
  const { document } = parseHTML(html);
  const detectedBeforeClean = document.querySelector(".dmbox-disambig, .disambig, #disambigbox, [class*=\"disambig\"]") !== null || /\bmay (?:also )?refer to\b/i.test(document.body?.textContent ?? "");
  const redirectTo = document.querySelector(".redirectMsg a, .redirectText a, #redirectedfrom a")?.getAttribute("href") ?? null;
  document.querySelectorAll(FULL_ARTICLE_DROP).forEach((n: Node) => n.remove());
  if (news) document.querySelectorAll(NEWS_DROP).forEach((n: Node) => n.remove());
  document.querySelectorAll(".redirectMsg, .redirectText, #redirectedfrom").forEach((n: Node) => n.remove());
  document.querySelectorAll("[style*='display:none'],[style*='display: none'],[hidden]").forEach((n: Node) => n.remove());
  const title = cleanText((document.querySelector("h1") ?? document.querySelector("title"))?.textContent ?? "");
  const blocks: ArticleBlock[] = [];
  const toc: FullArticle["toc"] = [];
  const content = (news ? document.querySelector("article") : null) ?? document.querySelector(".mw-parser-output") ?? document.querySelector("main") ?? document.body ?? document.documentElement;
  const titleNode = content.querySelector("h1");
  if (titleNode) titleNode.remove();
  const inline = (root: Element): ArticleInline[] => {
    const out: ArticleInline[] = [];
    const walk = (node: any, style: "text" | "emphasis" | "strong" = "text") => {
      if (node.nodeType === 3) { const text = cleanText(node.nodeValue ?? ""); if (text) out.push({ type: style, text }); return; }
      if (node.nodeType !== 1) return;
      const el = node as Element; const tag = el.tagName.toLowerCase();
      if (["script", "style", "iframe", "form", "svg", "img", "sup"].includes(tag) || el.hasAttribute("hidden") || el.hasAttribute("style") && /display\s*:\s*none/i.test(el.getAttribute("style") ?? "")) return;
      if (tag === "a") {
        const text = cleanText(el.textContent ?? ""); const href = el.getAttribute("href") ?? "";
        const match = /^\/(?:content\/)?([^/?#]+)\/([^?#]+)$/.exec(href) ?? /^\.\/([^/?#]+)$/.exec(href);
        if (news) {
          const outbound = opts.allowLinks ? safeOutboundHref(href, opts.baseUrl) : null;
          if (text) out.push(outbound ? { type: "link", text, href: outbound } : { type: "text", text });
          return;
        }
        let target: { book: string; path: string } | undefined;
        if (opts.allowLinks && match) {
          const book = match.length === 3 ? decodeURIComponent(match[1]!) : opts.book;
          const path = decodeURIComponent(match.length === 3 ? match[2]! : match[1]!);
          if (opts.allowedBooks.has(book) && !path.split("/").includes("..")) target = { book, path };
        }
        if (text) out.push(target ? { type: "link", text, target } : { type: "text", text }); return;
      }
      const next = tag === "b" || tag === "strong" ? "strong" : tag === "i" || tag === "em" ? "emphasis" : style;
      for (const child of Array.from(el.childNodes)) walk(child, next);
    };
    for (const child of Array.from(root.childNodes)) walk(child);
    return out;
  };
  const root = content;
  const disambig = root.querySelector(".dmbox-disambig, .disambig, #disambigbox, [class*='disambig']");
  const detectedDisambiguation = detectedBeforeClean || disambig !== null || /\bmay (?:also )?refer to\b/i.test(root.textContent ?? "") || /\(disambiguation\)\s*$/i.test(title);
  if (detectedDisambiguation) blocks.push({ type: "note", text: "Several articles share this name." });
  if (detectedDisambiguation) {
    const options = (Array.from(root.querySelectorAll("li")) as Element[]).slice(0, 8).map((li) => cleanText(li.textContent ?? "")).filter(Boolean);
    if (options.length) blocks.push({ type: "list", ordered: false, items: options.map((text) => [{ type: "text", text }]) });
  }
  const elements = Array.from(root.querySelectorAll(`h2,h3,h4,p,ul,ol${news ? ",blockquote" : ""},table.infobox,table.infobox_v2,table.infobox_v3,table:not(.infobox):not(.infobox_v2):not(.infobox_v3),figure`)) as Element[];
  const dropped = new Set(["references", "see also", "external links", "notes", "further reading", "citations", "bibliography", "footnotes", "sources"]);
  let skip = false;
  for (const el of elements) {
    if (el.closest(FULL_ARTICLE_DROP)) continue;
    const tag = el.tagName.toLowerCase();
    if (/^h[2-4]$/.test(tag)) {
      const text = plain(el); skip = dropped.has(text.toLowerCase());
      if (skip || !text) continue;
      const level = Number(tag.slice(1)) as 2 | 3 | 4; const id = el.getAttribute("id") || text.replace(/\s+/g, "_");
      blocks.push({ type: "heading", level, id, text }); toc.push({ id, title: text, level }); continue;
    }
    if (skip || el.closest("table") && !/^table/.test(tag)) continue;
    if (news && tag !== "blockquote" && el.closest("blockquote")) continue;
    if (tag === "blockquote") {
      const citeEl = el.querySelector("cite, footer"); const cite = citeEl ? plain(citeEl) : ""; citeEl?.remove();
      const paras = Array.from(el.querySelectorAll("p")) as Element[];
      const inlines = paras.length > 1 ? paras.flatMap((p, i) => [...(i ? [{ type: "text" as const, text: " " }] : []), ...inline(p)]) : inline(el);
      if (inlines.length) blocks.push({ type: "quote", inlines, ...(cite ? { cite } : {}) });
    } else if (tag === "p") { const inlines = inline(el); if (inlines.length) blocks.push({ type: "paragraph", inlines }); }
    else if (tag === "ul" || tag === "ol") { if (el.parentElement?.closest("ul,ol")) continue; const items = Array.from(el.querySelectorAll(":scope > li")).map((li) => inline(li)).filter((x) => x.length); if (items.length) blocks.push({ type: "list", ordered: tag === "ol", items }); }
    else if (tag === "table") {
      const trs = Array.from(el.querySelectorAll("tr")) as Element[];
      const rows = trs.map((tr) => (Array.from(tr.querySelectorAll(":scope > th,:scope > td")) as Element[]).map(plain)).filter((r) => r.length);
      if (el.matches(".infobox,.infobox_v2,.infobox_v3")) { const pairs = trs.flatMap((tr) => { const th = tr.querySelector("th"); const td = tr.querySelector("td"); const label = th && plain(th), value = td && plain(td); return label && value ? [{ label, value }] : []; }); if (pairs.length) blocks.push({ type: "rows", rows: pairs }); }
      else if (rows.length) { const first = rows[0]!; blocks.push({ type: "table", headers: first, rows: rows.slice(1) }); }
    } else if (tag === "figure" && opts.allowImages) { const img = el.querySelector("img"); const src = img?.getAttribute("src") ?? ""; if (/^(?:\/|\.\/|https?:\/\/)/i.test(src) && !/^data:/i.test(src)) blocks.push({ type: "figure", src, alt: img?.getAttribute("alt") ?? "", caption: plain(el.querySelector("figcaption") ?? el) }); }
  }
  // Wiktionary and similar definition lists.
  for (const dl of Array.from(root.querySelectorAll("dl")) as Element[]) {
    if (dl.closest(FULL_ARTICLE_DROP)) continue;
    const children = Array.from(dl.children) as Element[]; const rows: Array<{ label: string; value: string }> = []; let label = "";
    for (const child of children) { if (child.tagName === "DT") label = plain(child); else if (child.tagName === "DD" && label) { rows.push({ label, value: plain(child) }); label = ""; } }
    if (rows.length) blocks.push({ type: "rows", rows });
  }
  return { title, blocks, toc, ...(redirectTo ? { redirectTo } : {}) };
}

/** Section headings that are never kept (their text is not read either). */
const DROPPED_SECTIONS: ReadonlySet<string> = new Set([
  "references", "see also", "external links", "notes", "further reading", "citations", "bibliography", "footnotes", "sources",
]);

export interface ExtractedArticle {
  title: string;
  lead: string;
  infobox: Array<{ label: string; value: string }>;
  sections: string[];
  disambiguation: boolean;
  /** Titles the page lists, for a disambiguation page only. */
  options: string[];
}

/** Residue the encyclopedia's markup leaves in extracted text: inline CSS
 * rules, unrendered template braces, citation marks and edit links. */
export function cleanText(raw: string): string {
  let text = raw.replace(/ /g, " ");
  if (text.includes("{")) {
    text = text
      .replace(/\{\{[^{}]*\}\}/g, " ")
      .replace(/[.#][\w-]+(?:[\s>+~,.#:]+[\w-]+){0,8}\s*\{[^{}]*\}/g, " ")
      .replace(/\b[a-z][\w-]*\s*\{[^{}:]*:[^{}]*\}/gi, " ");
  }
  return text
    .replace(/\{\{|\}\}|\[\[|\]\]/g, " ")
    .replace(/\[(?:\d+|[a-z]|citation needed|edit|clarification needed|when\?|who\?)\]/gi, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

function textOf(el: Element): string {
  // <br> and list items separate values; the text itself carries no marker.
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll("br").forEach((br: Node) => br.replaceWith(" , "));
  clone.querySelectorAll("li").forEach((li: Node) => li.append(" , "));
  const joined = cleanText(clone.textContent ?? "");
  return joined.replace(/(\s*,\s*)+/g, ", ").replace(/^,\s*|,\s*$/g, "").trim();
}

function cutAtBoundary(text: string, max: number): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const sentenceEnd = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("? "), slice.lastIndexOf("! "));
  if (sentenceEnd > max * 0.5) return slice.slice(0, sentenceEnd + 1).trim();
  const space = slice.lastIndexOf(" ");
  return (space > 0 ? slice.slice(0, space) : slice).trim();
}

export function extractArticle(html: string): ExtractedArticle {
  const { document } = parseHTML(html);
  // Residue by markup first: styles, scripts, edit links, citation
  // superscripts, navigation boxes, hidden elements.
  document.querySelectorAll("style, script, link, meta, noscript, sup.reference, .mw-editsection, .navbox, .reflist, .mw-empty-elt, .noprint, [style*='display:none'], [style*='display: none']").forEach((n: Node) => n.remove());

  const titleEl = document.querySelector("h1") ?? document.querySelector("title");
  const title = cleanText(titleEl?.textContent ?? "");

  const infobox: Array<{ label: string; value: string }> = [];
  const table = document.querySelector("table.infobox, table.infobox_v2, table.infobox_v3");
  if (table) {
    for (const row of table.querySelectorAll("tr")) {
      const th = row.querySelector("th");
      const td = row.querySelector("td");
      if (!th || !td) continue;
      const label = textOf(th);
      const value = cutAtBoundary(textOf(td), INFOBOX_VALUE_MAX);
      if (label.length === 0 || value.length === 0) continue;
      infobox.push({ label, value });
      if (infobox.length >= INFOBOX_MAX_ROWS) break;
    }
    table.remove();
  }

  // Walk headings and paragraphs in document order: the lead is every
  // paragraph before the first section heading; a dropped section's
  // paragraphs are skipped. Tables other than the infobox are not prose.
  let lead = "";
  const sections: string[] = [];
  let inLead = true;
  let inDropped = false;
  for (const node of document.querySelectorAll("h2, p")) {
    if (node.tagName === "H2") {
      inLead = false;
      const name = cleanText(node.textContent ?? "");
      inDropped = DROPPED_SECTIONS.has(name.toLowerCase());
      if (!inDropped && name.length > 0) sections.push(name);
      continue;
    }
    if (!inLead || inDropped) continue;
    if (node.closest("table")) continue;
    const text = cleanText(node.textContent ?? "");
    if (text.length === 0) continue;
    lead = lead.length === 0 ? text : `${lead}\n\n${text}`;
    if (lead.length >= LEAD_MAX_CHARS) break;
  }
  lead = cutAtBoundary(lead, LEAD_MAX_CHARS);

  const markupDisambiguation = document.querySelector(".dmbox-disambig, .disambig, #disambigbox, [class*='disambig']") !== null;
  const disambiguation = markupDisambiguation || /\bmay (?:also )?refer to\b/i.test(lead.slice(0, 400)) || /\(disambiguation\)\s*$/i.test(title);
  const options: string[] = [];
  if (disambiguation) {
    for (const li of document.querySelectorAll("li")) {
      const anchor = li.querySelector("a");
      const name = cleanText((anchor ?? li).textContent ?? "");
      if (name.length > 0 && name.length <= 120 && !options.includes(name)) options.push(name);
      if (options.length >= DISAMBIGUATION_OPTIONS_MAX) break;
    }
  }

  return { title, lead, infobox, sections, disambiguation, options };
}
