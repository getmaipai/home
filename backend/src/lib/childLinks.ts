// MINOR-SEARCH-01m (design layer L5): a child's answer carries no outbound link in any form, so
// history, copy and export hold none either. Only closed formats are handled (a markdown link,
// an autolink, a bare http(s) address); the `[n]` citation marker has no address and is kept.
// Stored rows are never rewritten: the strip runs on the way out for the child band.
import type { Source } from "@maipai/spec/gen/ts/source.js";

const URL_BODY = String.raw`(?:[^\s()<>]|\([^\s()]*\))*`;
const MARKDOWN_LINK = new RegExp(String.raw`!?\[([^\]\n]*)\]\(\s*<?https?:\/\/${URL_BODY}>?(?:\s+"[^"\n]*")?\s*\)`, "gi");
// A label that a sentence break split in two leaves only "](address)" in the later span.
const DANGLING_TARGET = new RegExp(String.raw`\]\(\s*<?https?:\/\/${URL_BODY}>?\s*\)`, "gi");
const AUTOLINK = /[ \t]?<https?:\/\/[^\s>]*>/gi;
const BARE_ADDRESS = /[ \t]?\bhttps?:\/\/[^\s<>()\[\]"']+/gi;

/** The text with every closed link format reduced to its words: [label](url) becomes label; bare addresses go. */
export function stripLinksForChild(text: string): string {
  if (!text || !/https?:\/\//i.test(text)) return text;
  return text
    .replace(MARKDOWN_LINK, (_m, label: string) => label)
    .replace(DANGLING_TARGET, "]")
    .replace(AUTOLINK, "")
    .replace(BARE_ADDRESS, "");
}

/** A child's source keeps its title and site but not the page address: the url shrinks to the site's own front page
 * (the schema needs a url; the chip shows the domain and never links it for a child). A library page keeps its in-home
 * `local_path`, which is what the chip opens. */
export function sourcesForChild(sources: Source[]): Source[] {
  return sources.map((source) => {
    if (!source || typeof source !== "object" || typeof source.url !== "string") return source;
    try {
      const parsed = new URL(source.url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return source;
      return { ...source, url: `${parsed.origin}/` };
    } catch {
      return source;
    }
  });
}

export function sourcesForBand<T>(sources: T[] | undefined, band: string): T[] | undefined {
  return sources && Array.isArray(sources) && band === "child" ? (sourcesForChild(sources as unknown as Source[]) as unknown as T[]) : sources;
}
