// MEDIA-LIB-01: EPUB package metadata (title, author, series, cover) read from the OPF inside the zip, with no heavy dependency.
import { openZip } from "./zip";
import { decodeEntities, plainText } from "./text";

export interface EpubMeta {
  title: string | null;
  author: string | null;
  description: string | null;
  language: string | null;
  year: number | null;
  series: string | null;
  seriesIndex: number | null;
  coverEntry: string | null;
  coverMediaType: string | null;
}

function dirOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash + 1);
}

function resolveEntry(base: string, href: string): string {
  const parts = (base + decodeURIComponent(href.split("#")[0]!)).split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (part === "..") out.pop();
    else if (part !== "." && part !== "") out.push(part);
  }
  return out.join("/");
}

function attrs(tag: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of tag.matchAll(/([A-Za-z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g)) result[match[1]!.toLowerCase()] = decodeEntities(match[3] ?? match[4] ?? "");
  return result;
}

function first(xml: string, name: string): string | null {
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i").exec(xml);
  return match ? plainText(match[1]!, 1000) || null : null;
}

export function parseOpf(opf: string, opfPath: string): EpubMeta {
  const base = dirOf(opfPath);
  const creators = [...opf.matchAll(/<dc:creator(?:\s[^>]*)?>([\s\S]*?)<\/dc:creator>/gi)].map((match) => plainText(match[1]!, 200)).filter(Boolean);
  const date = first(opf, "dc:date");
  const yearMatch = date ? /\b(\d{4})\b/.exec(date) : null;
  // EPUB 3 collections and Calibre's series meta.
  let series: string | null = null;
  let seriesIndex: number | null = null;
  const collection = /<meta\b[^>]*property\s*=\s*["']belongs-to-collection["'][^>]*>([\s\S]*?)<\/meta>/i.exec(opf);
  if (collection) {
    series = plainText(collection[1]!, 200) || null;
    const position = /<meta\b[^>]*property\s*=\s*["']group-position["'][^>]*>([\s\S]*?)<\/meta>/i.exec(opf);
    const n = position ? Number(plainText(position[1]!, 20)) : Number.NaN;
    seriesIndex = Number.isFinite(n) ? n : null;
  } else {
    for (const tag of opf.match(/<meta\b[^>]*>/gi) ?? []) {
      const a = attrs(tag);
      if (a["name"] === "calibre:series" && a["content"]) series = a["content"].trim() || null;
      if (a["name"] === "calibre:series_index" && a["content"]) {
        const n = Number(a["content"]);
        seriesIndex = Number.isFinite(n) ? n : null;
      }
    }
  }
  // The cover: a manifest item flagged cover-image, else the one the cover meta names.
  const items = (opf.match(/<item\b[^>]*>/gi) ?? []).map(attrs);
  let coverItem = items.find((item) => (item["properties"] ?? "").split(/\s+/).includes("cover-image"));
  if (!coverItem) {
    const coverMeta = (opf.match(/<meta\b[^>]*>/gi) ?? []).map(attrs).find((a) => a["name"] === "cover" && a["content"]);
    if (coverMeta) coverItem = items.find((item) => item["id"] === coverMeta["content"]);
  }
  return {
    title: first(opf, "dc:title"),
    author: creators.length > 0 ? creators.join(", ") : null,
    description: first(opf, "dc:description"),
    language: first(opf, "dc:language"),
    year: yearMatch ? Number(yearMatch[1]) : null,
    series,
    seriesIndex,
    coverEntry: coverItem?.["href"] ? resolveEntry(base, coverItem["href"]) : null,
    coverMediaType: coverItem?.["media-type"] ?? null,
  };
}

/** Metadata of an EPUB file, or null when it is not a readable EPUB. */
export async function readEpubMeta(absPath: string): Promise<EpubMeta | null> {
  try {
    const zip = await openZip(absPath);
    if (!zip) return null;
    const container = await zip.read("META-INF/container.xml", 256 * 1024);
    if (!container) return null;
    const rootfile = /full-path\s*=\s*["']([^"']+)["']/i.exec(new TextDecoder().decode(container));
    if (!rootfile) return null;
    const opfPath = decodeEntities(rootfile[1]!);
    const opf = await zip.read(opfPath, 2 * 1024 * 1024);
    if (!opf) return null;
    return parseOpf(new TextDecoder().decode(opf), opfPath);
  } catch {
    return null;
  }
}

/** The cover image inside an EPUB, or null. */
export async function readEpubCover(absPath: string): Promise<{ data: Uint8Array; mediaType: string } | null> {
  const meta = await readEpubMeta(absPath);
  if (!meta?.coverEntry) return null;
  const zip = await openZip(absPath);
  const data = await zip?.read(meta.coverEntry, 16 * 1024 * 1024);
  if (!data) return null;
  const lower = meta.coverEntry.toLowerCase();
  const mediaType = meta.coverMediaType ?? (lower.endsWith(".png") ? "image/png" : lower.endsWith(".webp") ? "image/webp" : "image/jpeg");
  return { data, mediaType };
}
