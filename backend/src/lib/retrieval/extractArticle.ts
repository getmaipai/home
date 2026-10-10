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
