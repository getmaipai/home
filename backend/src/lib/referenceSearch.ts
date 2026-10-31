// One definition of the offline-library search (KS-02): the Sources page route and the global
// search palette both call it, so the closed book list and the minor floor are applied in one place.
import type { PersonRow } from "@/types";
import { speakerAgeBand } from "@/lib/ageBand";
import { kiwixBaseUrl } from "@/lib/kiwixSidecar";
import { readableBooks } from "@/lib/retrieval/referenceSources";
import { extractFullArticle } from "@/lib/retrieval/extractArticle";
import { tripsMinorFloor } from "@/lib/retrieval/minorFloor";
import { installed, libraryRequest } from "@/lib/kiwixClient";

/** A full-text search over a whole-encyclopedia ZIM can take a second or two cold; the shared 2.5 s default is for suggestions. */
const SEARCH_TIMEOUT_MS = 8000;

/** Pages that are not articles: the real ZIM carries its category, template and project pages, and a full-text search finds them. */
const NAMESPACE_TITLE = /^(?:Category|Template|Wikipedia|File|Help|Portal|Draft|Talk|User|Module|MediaWiki|Special|Book|TimedText)\b\s*:/i;
function isNamespacePage(title: string, path: string): boolean {
  return NAMESPACE_TITLE.test(title) || path.startsWith("_") || /^(?:Category|Template|Wikipedia|File|Help|Portal|Draft|Talk|User|Module):/i.test(path);
}

function decodeText(text: string): string {
  return text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#0?39;|&apos;/g, "'").replace(/&amp;/g, "&").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

/** A snippet is plain words: markup and entities removed, the engine's leading ellipsis and trailing citation marks dropped. */
function cleanSnippet(snippet: string): string {
  return decodeText(snippet).replace(/^\.{3}\s*/, "").replace(/\s*[↑^]\s.*$/u, "").trim();
}

/** Title matches from the book's own suggest list, best first: "prince" should open Prince (musician) before any page that merely says "prince". */
async function titleMatches(base: string, book: string, q: string): Promise<Array<{ title: string; snippet: string; path: string }>> {
  try {
    const res = await libraryRequest(base, `/suggest?content=${encodeURIComponent(book)}&term=${encodeURIComponent(q)}&count=10`); if (!res.ok) return [];
    const data: unknown = await res.json(); if (!Array.isArray(data)) return [];
    const found = data.flatMap((x: any) => x?.kind === "path" && typeof x.path === "string" && x.path && !x.path.split("/").includes("..") ? [{ title: decodeText(typeof x.value === "string" && x.value ? x.value : String(x.label ?? "")), snippet: "", path: x.path as string }] : [])
      .filter((entry) => /^[\p{L}\p{N}]/u.test(entry.title));
    const want = q.trim().toLowerCase();
    const rank = (title: string) => (title === q.trim() ? 0 : title.toLowerCase() === want ? 1 : title.toLowerCase().startsWith(`${want} (`) ? 2 : title.toLowerCase().startsWith(want) ? 3 : 4);
    return found.map((entry, index) => ({ entry, index })).sort((a, b) => rank(a.entry.title) - rank(b.entry.title) || a.entry.title.length - b.entry.title.length || a.index - b.index).map((x) => x.entry);
  } catch { return []; }
}

export interface ReferenceHit { title: string; snippet: string; book: string; path: string }

/** Hits for `q` across the books this person may read, at most 20, and the sidecar's own total for adults. Never throws. */
export async function searchReference(person: PersonRow, q: string, book?: string): Promise<{ hits: ReferenceHit[]; total: number }> {
  const band = speakerAgeBand(person, new Date());
  const base = kiwixBaseUrl();
  if (!base) return { hits: [], total: 0 };
  try {
    const names = await installed(base); let books = readableBooks(names, band).books; if (book) books = books.filter((x) => x.book === book);
    const hits: Array<{ title: string; snippet: string; book: string; path: string }> = []; let sidecarTotal = 0;
    for (const rb of books) {
      if (hits.length >= 20) break;
      const [res, titles] = await Promise.all([
        libraryRequest(base, `/search?content=${encodeURIComponent(rb.book)}&pattern=${encodeURIComponent(q)}&format=xml&pageLength=30`, { timeoutMs: SEARCH_TIMEOUT_MS }).catch(() => null),
        titleMatches(base, rb.book, q),
      ]);
      if (!res?.ok && titles.length === 0) continue;
      const xml = res?.ok ? await res.text() : "";
      const totalText = /<(?:\w+:)?totalResults\b[^>]*>([\d,]+)<\/(?:\w+:)?totalResults>/i.exec(xml)?.[1];
      if (totalText) sidecarTotal += Number(totalText.replace(/,/g, ""));
      const candidates: Array<{ title: string; snippet: string; path: string }> = [];
      const seenPaths = new Set<string>();
      const take = (entry: { title: string; snippet: string; path: string }) => { if (candidates.length >= 20 || seenPaths.has(entry.path) || isNamespacePage(entry.title, entry.path)) return; seenPaths.add(entry.path); candidates.push(entry); };
      for (const hit of titles) take(hit);
      for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
        const item = m[1]!; const title = /<title>([\s\S]*?)<\/title>/i.exec(item)?.[1]?.replace(/<[^>]+>/g, "").trim(); const href = /<link>([^<]+)<\/link>/i.exec(item)?.[1]?.trim(); const snippet = /<description>([\s\S]*?)<\/description>/i.exec(item)?.[1]?.replace(/<[^>]+>/g, "").trim() ?? "";
        if (!title || !href) continue;
        let path = ""; try { path = new URL(href, base).pathname.split("/").slice(3).map(decodeURIComponent).join("/"); } catch { continue; }
        if (!path || path.split("/").includes("..")) continue;
        take({ title: decodeText(title), snippet: cleanSnippet(snippet), path });
      }
      if (band === "adult") hits.push(...candidates.map((hit) => ({ ...hit, book: rb.book })));
      else {
        for (let i = 0; i < candidates.length; i += 4) {
          const batch = candidates.slice(i, i + 4);
          const checked = await Promise.all(batch.map(async (hit) => {
            const articleRes = await libraryRequest(base, `/content/${encodeURIComponent(rb.book)}/${hit.path.split("/").map(encodeURIComponent).join("/")}`); if (!articleRes.ok) return null;
            const full = extractFullArticle(await articleRes.text(), { book: rb.book, allowedBooks: new Set(names), allowLinks: false, allowImages: false });
            const plainText = full.blocks.flatMap((b) => b.type === "paragraph" ? b.inlines.map((entry) => entry.text) : b.type === "heading" ? [b.text] : b.type === "rows" ? b.rows.flatMap((row) => [row.label, row.value]) : []).join(" ");
            if (tripsMinorFloor(`${hit.title}. ${hit.snippet}. ${plainText}`)) return null;
            return { title: hit.title, snippet: (hit.snippet || plainText).slice(0, 240), book: rb.book, path: hit.path };
          }));
          hits.push(...checked.filter((x): x is NonNullable<typeof x> => x !== null));
        }
      }
      if (hits.length >= 20) hits.splice(20);
    }
    return { hits, total: band === "adult" ? sidecarTotal : hits.length };
  } catch {
    return { hits: [], total: 0 };
  }
}
