// One definition of the offline-library search (KS-02): the Sources page route and the global
// search palette both call it, so the closed book list and the minor floor are applied in one place.
import type { PersonRow } from "@/types";
import { speakerAgeBand } from "@/lib/ageBand";
import { kiwixBaseUrl } from "@/lib/kiwixSidecar";
import { readableBooks } from "@/lib/retrieval/referenceSources";
import { extractFullArticle } from "@/lib/retrieval/extractArticle";
import { tripsMinorFloor } from "@/lib/retrieval/minorFloor";
import { installed, libraryRequest } from "@/lib/kiwixClient";

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
      const res = await libraryRequest(base, `/search?content=${encodeURIComponent(rb.book)}&pattern=${encodeURIComponent(q)}&count=20`); if (!res.ok) continue;
      const xml = await res.text();
      const totalText = /<(?:\w+:)?totalResults\b[^>]*>(\d+)<\/(?:\w+:)?totalResults>/i.exec(xml)?.[1];
      if (totalText) sidecarTotal += Number(totalText);
      const candidates: Array<{ title: string; snippet: string; path: string }> = [];
      for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
        const item = m[1]!; const title = /<title>([\s\S]*?)<\/title>/i.exec(item)?.[1]?.replace(/<[^>]+>/g, "").trim(); const href = /<link>([^<]+)<\/link>/i.exec(item)?.[1]?.trim(); const snippet = /<description>([\s\S]*?)<\/description>/i.exec(item)?.[1]?.replace(/<[^>]+>/g, "").trim() ?? "";
        if (!title || !href) continue;
        let path = ""; try { path = new URL(href, base).pathname.split("/").slice(3).map(decodeURIComponent).join("/"); } catch { continue; }
        if (!path || path.split("/").includes("..")) continue;
        candidates.push({ title, snippet, path }); if (candidates.length >= 20) break;
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
