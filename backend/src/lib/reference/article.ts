import { speakerAgeBand } from "@/lib/ageBand";
import { readReferencePage } from "@/lib/retrieval/referenceReader";
import type { ReferenceRow } from "@/lib/retrieval/minorFloor";
import { licenceLabel, readableBooks } from "@/lib/retrieval/referenceSources";
import { kiwixBaseUrl } from "@/lib/kiwixSidecar";
import { extractArticle, extractFullArticle, cutAtSentence } from "@/lib/retrieval/extractArticle";
import { tripsMinorFloor } from "@/lib/retrieval/minorFloor";
import { getPersonSettingValue } from "@/lib/settings";
import { extractArticleImages } from "@/lib/retrieval/articleImages";
import { sourceForBook } from "@/lib/retrieval/referenceSources";
import { installed, libraryRequest } from "@/lib/kiwixClient";
import type { PersonRow } from "@/types";

export async function loadArticleFor(person: PersonRow, book: string, path: string) {
  const band = speakerAgeBand(person, new Date()); const base = kiwixBaseUrl();
  if (!base || path.split("/").includes("..")) return null;
  try {
    const names = await installed(base); const rb = readableBooks(names, band).books.find((x) => x.book === book); if (!rb) return null;
    const res = await libraryRequest(base, `/content/${encodeURIComponent(book)}/${path.split("/").map(encodeURIComponent).join("/")}`); if (!res.ok) return null;
    const html = await res.text();
    const imagesAllowed = getPersonSettingValue(person, "reference.images") === true;
    const full = extractFullArticle(html, { book, allowedBooks: new Set(names), allowLinks: band === "adult", allowImages: imagesAllowed });
    if (full.redirectTo) {
      const target = new URL(full.redirectTo, "http://kiwix.local").pathname.match(/^\/(?:content\/)?([^/]+)\/(.+)$/);
      if (target && decodeURIComponent(target[1]!) === book && !decodeURIComponent(target[2]!).split("/").includes("..")) {
        return { redirect: `/api/reference/article/${encodeURIComponent(book)}/${encodeURIComponent(decodeURIComponent(target[2]!))}` };
      }
    }
    const fallback = extractArticle(html); const title = full.title || fallback.title || path;
    const plain = full.blocks.flatMap((b) => b.type === "paragraph" ? b.inlines.map((i) => i.text) : b.type === "heading" ? [b.text] : b.type === "rows" ? b.rows.flatMap((r) => [r.label, r.value]) : []).concat(full.summary ?? "", full.hatnote ?? "", full.infobox?.rows.flatMap((r) => [r.label, r.value]) ?? []).join(" ");
    if (band !== "adult" && tripsMinorFloor(`${title}. ${plain}. ${full.kicker ?? ""}. ${full.infobox?.rows[0]?.label ?? ""}. ${full.infobox?.rows[0]?.value ?? ""}`)) return null;
    const rewrite = (imagePath: string) => `/api/reference/media/${encodeURIComponent(book)}/${encodeURIComponent(imagePath)}`;
    const leadImg = imagesAllowed ? extractArticleImages(html, { book, articlePath: path, limit: 1 }).find((image) => image.lead) : undefined;
    const blocks = full.blocks.map((block) => {
      if (block.type !== "figure") return block;
      if (!imagesAllowed) return null;
      const resolved = extractArticleImages(`<figure><img src="${block.src.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}" alt=""></figure>`, { book, articlePath: path }).find((image) => image.imagePath);
      return resolved ? { ...block, src: rewrite(resolved.imagePath) } : null;
    }).filter((block): block is NonNullable<typeof block> => block !== null);
    const firstParagraph = full.blocks.find((block) => block.type === "paragraph");
    const leadText = firstParagraph?.type === "paragraph" ? firstParagraph.inlines.map((inline) => inline.text).join("") : "";
    const wordText = full.blocks.flatMap((block) => block.type === "paragraph" ? [block.inlines.map((inline) => inline.text).join("")] : block.type === "list" ? block.items.map((item) => item.map((inline) => inline.text).join("")) : block.type === "heading" ? [block.text] : []).join(" ");
    const lead = leadText ? cutAtSentence(leadText, 300) : undefined;
    const quickFactRow = full.infobox?.rows[0];
    const quickFact = quickFactRow ? `${quickFactRow.label}: ${quickFactRow.value}`.slice(0, 160).trimEnd() : undefined;
    const badge = imagesAllowed && leadImg?.caption ? leadImg.caption.length <= 30 ? leadImg.caption : leadImg.caption.slice(0, 30).replace(/\s+\S*$/, "").trim() : undefined;
    const links = [...new Map(full.blocks.flatMap((block) => block.type === "paragraph" ? block.inlines : []).flatMap((inline) => inline.type === "link" && inline.target ? [`${inline.target.book}\0${inline.target.path}`] : []).map((key) => { const [linkBook, linkPath] = key.split("\0"); return [key, { book: linkBook!, path: linkPath! }] as const; })).values()].filter((target) => !(target.book === book && target.path === path) && target.book === book);
    const leadImage = leadImg ? { src: rewrite(leadImg.imagePath), alt: leadImg.alt } : undefined;
    return { rb, book, path, title, full: { ...full, blocks }, lead, reading_minutes: Math.max(1, Math.ceil(wordText.trim().split(/\s+/).filter(Boolean).length / 200)), ...(full.kicker ? { kicker: full.kicker } : {}), ...(quickFact ? { quick_fact: quickFact } : {}), ...(badge ? { badge } : {}), relatedTargets: band === "adult" ? links : [], ...(leadImage ? { lead_image: leadImage } : {}), ...(leadImage && full.infobox ? { infoboxImage: leadImage } : {}), profile: sourceForBook(book)?.id.startsWith("wikipedia-") ? "wikipedia" : "generic" };
  } catch { return null; }
}

export async function articlePayloadFor(person: PersonRow, result: NonNullable<Awaited<ReturnType<typeof loadArticleFor>>>) {
  if ("redirect" in result) return null;
  const base = kiwixBaseUrl()!;
  let related: Array<{ book: string; path: string; title: string; thumbnail?: { src: string; alt: string } }> | undefined;
  if (result.relatedTargets.length) {
    related = [];
    for (let i = 0; i < result.relatedTargets.length && related.length < 5; i += 4) {
      const batch = result.relatedTargets.slice(i, i + 4);
      const loaded = await Promise.all(batch.map(async (target: { book: string; path: string }) => { const article = await loadArticleFor(person, target.book, target.path); return !article || "redirect" in article ? null : { book: target.book, path: target.path, title: article.title, ...(article.lead_image ? { thumbnail: article.lead_image } : {}) }; }));
      related.push(...loaded.filter((x): x is NonNullable<typeof x> => x !== null).slice(0, 5 - related.length));
    }
  }
  return { title: result.title, book: result.book, path: result.path, source_label: result.rb.source.label, licence: licenceLabel(result.rb.source.licence), snapshot_date: await dateFor(base, result.book), blocks: result.full.blocks, toc: result.full.toc, ...(result.full.infobox ? { infobox: { ...result.full.infobox, ...(result.infoboxImage ? { image: result.infoboxImage } : {}) } } : {}), ...(result.full.description ? { description: result.full.description } : {}), ...(result.full.summary ? { summary: result.full.summary } : {}), ...(result.full.hatnote ? { hatnote: result.full.hatnote } : {}), profile: result.profile, ...(result.lead_image ? { lead_image: result.lead_image } : {}), ...(result.lead ? { lead: result.lead } : {}), reading_minutes: result.reading_minutes, ...(result.kicker ? { kicker: result.kicker } : {}), ...(result.quick_fact ? { quick_fact: result.quick_fact } : {}), ...(result.badge ? { badge: result.badge } : {}), ...(related ? { related } : {}) };
}

async function dateFor(base: string, book: string): Promise<string | null> {
  try { const res = await libraryRequest(base, `/raw/${encodeURIComponent(book)}/meta/Date`); const value = res.ok ? (await res.text()).trim() : ""; return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null; } catch { return null; }
}

export async function readArticleImage(person: PersonRow, book: string, imagePath: string): Promise<{ bytes: ArrayBuffer; type: string } | null> {
  const band = speakerAgeBand(person, new Date()); const base = kiwixBaseUrl();
  if (!base || !imagePath || imagePath.split("/").includes("..") || getPersonSettingValue(person, "reference.images") !== true) return null;
  try {
    const names = await installed(base); if (!readableBooks(names, band).books.some((row) => row.book === book)) return null;
    const safePath = decodeURIComponent(imagePath); if (/^(?:https?:|data:|javascript:)/i.test(safePath)) return null;
    const res = await libraryRequest(base, `/raw/${encodeURIComponent(book)}/${safePath.split("/").map(encodeURIComponent).join("/")}`); if (!res.ok) return null;
    const type = (res.headers.get("content-type") ?? "").split(";")[0]!.toLowerCase(); if (!["image/png", "image/jpeg", "image/webp", "image/svg+xml"].includes(type)) return null;
    return { bytes: await res.arrayBuffer(), type };
  } catch { return null; }
}
