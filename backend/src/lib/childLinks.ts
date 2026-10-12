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

// MINOR-SEARCH-01o: the same strip for the structured parts of a turn (answer blocks, the spec-sheet part, a generated
// document's body). Every string loses its links; a `url` or `href` field that holds a web address is removed (the
// block schema makes it optional), and `src` is left alone because the hub rewrites it to its own picture route.
const KEEP_AS_IS = new Set(["src", "full", "id", "kind", "hlc", "created_at"]);
const ADDRESS_KEYS = new Set(["url", "href"]);

/** A copy of `value` with every closed link format removed from every string inside it. */
export function stripLinksDeep<T>(value: T, key = ""): T {
  // A kept key stays only when it is the hub's own path (a picture route), never an outside address.
  if (typeof value === "string") return (KEEP_AS_IS.has(key) && !/^\s*(?:https?:)?\/\//i.test(value) ? value : stripLinksForChild(value)) as unknown as T;
  if (Array.isArray(value)) return value.map((item) => stripLinksDeep(item, key)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [childKey, child] of Object.entries(value)) {
      if (ADDRESS_KEYS.has(childKey) && typeof child === "string" && /^https?:\/\//i.test(child.trim())) continue;
      out[childKey] = stripLinksDeep(child, childKey);
    }
    return out as T;
  }
  return value;
}

export function blocksForBand<T>(blocks: T[] | undefined, band: string): T[] | undefined {
  return blocks && band === "child" ? stripLinksDeep(blocks) : blocks;
}

export function structuredPartForBand<T>(part: T | undefined, band: string): T | undefined {
  return part && band === "child" ? stripLinksDeep(part) : part;
}

/** A child's generated document: the body and title lose their links. Code is left whole (an address inside code is
 * text, not a link the child can follow). */
export function artifactTextForBand<T extends { kind: string; title: string; body: string }>(artifact: T, band: string): T {
  if (band !== "child" || artifact.kind === "code") return artifact;
  return { ...artifact, title: stripLinksForChild(artifact.title), body: stripLinksForChild(artifact.body) };
}
