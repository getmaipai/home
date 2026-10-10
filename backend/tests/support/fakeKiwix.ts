// A scripted stand-in for kiwix-serve for the tier K reader's tests
// (KS-01): serves the OPDS book list, /suggest, /search, /content and
// /raw/<book>/meta/Date from in-memory fixtures on a loopback port, and
// records every request path so a test can prove which books were (not)
// asked. Deterministic and offline.
export interface FakeArticle {
  title: string;
  html: string;
}

export interface FakeBook {
  /** The served id (the ZIM file stem). */
  id: string;
  date?: string;
  /** Articles by path, e.g. "Juniper_Falls". */
  articles: Record<string, FakeArticle>;
}

export interface FakeKiwix {
  baseUrl: string;
  requests: string[];
  /** Requests that named a given book (by /content/<id>, content= or /raw/<id>). */
  requestsFor(book: string): string[];
  setBooks(books: FakeBook[]): void;
  stop(): void;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
}

export function startFakeKiwix(initial: FakeBook[]): FakeKiwix {
  let books = initial;
  const requests: string[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      requests.push(`${url.pathname}${url.search}`);
      if (url.pathname === "/catalog/v2/entries") {
        const entries = books.map((b) => `<entry><title>${esc(b.id)}</title><link type="text/html" href="/content/${b.id}"/></entry>`).join("");
        return new Response(`<?xml version="1.0"?><feed>${entries}</feed>`, { headers: { "content-type": "application/atom+xml" } });
      }
      if (url.pathname === "/suggest") {
        const book = books.find((b) => b.id === url.searchParams.get("content"));
        if (!book) return new Response("no such book", { status: 404 });
        const term = (url.searchParams.get("term") ?? "").toLowerCase();
        const out = Object.entries(book.articles)
          .filter(([, a]) => a.title.toLowerCase().includes(term))
          .map(([path, a]) => ({ value: a.title, label: a.title, kind: "path", path }));
        out.push({ value: term, label: `containing '${term}'...`, kind: "pattern", path: "" });
        return Response.json(out);
      }
      if (url.pathname === "/search") {
        const book = books.find((b) => b.id === url.searchParams.get("content"));
        if (!book) return new Response("<error>No such book</error>", { status: 400 });
        const pattern = (url.searchParams.get("pattern") ?? "").toLowerCase();
        const items = Object.entries(book.articles)
          .filter(([, a]) => a.html.toLowerCase().includes(pattern))
          .map(([path, a]) => `<item><title>${esc(a.title)}</title><link>/content/${book.id}/${path}</link></item>`)
          .join("");
        return new Response(`<?xml version="1.0"?><rss><channel>${items}</channel></rss>`, { headers: { "content-type": "application/xml" } });
      }
      const content = /^\/content\/([^/]+)\/(.+)$/.exec(url.pathname);
      if (content) {
        const book = books.find((b) => b.id === decodeURIComponent(content[1]!));
        const article = book?.articles[decodeURIComponent(content[2]!)];
        return article ? new Response(article.html, { headers: { "content-type": "text/html" } }) : new Response("not found", { status: 404 });
      }
      const raw = /^\/raw\/([^/]+)\/meta\/Date$/.exec(url.pathname);
      if (raw) {
        const book = books.find((b) => b.id === decodeURIComponent(raw[1]!));
        return book?.date ? new Response(book.date) : new Response("not found", { status: 404 });
      }
      return new Response("not found", { status: 404 });
    },
  });
  return {
    baseUrl: `http://127.0.0.1:${server.port}`,
    requests,
    requestsFor: (book) => requests.filter((r) => r.includes(`/${book}/`) || r.includes(`content=${book}`)),
    setBooks(next) {
      books = next;
    },
    stop() {
      server.stop(true);
    },
  };
}

/** An article page shaped like the Kiwix Wikipedia markup: a style block
 * and template residue the extractor must drop, an infobox, a lead, then
 * body sections ending in References and See also. */
export function articleHtml(opts: { title: string; lead: string[]; infobox?: Array<[string, string]>; extraSections?: string[]; hostile?: string }): string {
  const rows = (opts.infobox ?? []).map(([k, v]) => `<tr><th scope="row" class="infobox-label">${k}</th><td class="infobox-data">${v}</td></tr>`).join("");
  const lead = opts.lead.map((p) => `<p>${p}</p>`).join("");
  const extra = (opts.extraSections ?? []).map((s) => `<h2 id="${s}">${s}</h2><p>Body text of ${s}.</p>`).join("");
  return `<!DOCTYPE html><html><head><title>${opts.title}</title><link rel="stylesheet" href="../-/s/style.css"><style>.mw-parser-output .hlist ul{margin:0;padding:0}</style></head><body>
<h1><span class="mw-page-title-main">${opts.title}</span></h1>
<section data-mw-section-id="0">
<table class="infobox"><tbody><tr><th colspan="2" class="infobox-above">${opts.title}</th></tr>${rows}</tbody></table>
<style>.mw-parser-output .infobox-data{padding:0}</style>
${lead}${opts.hostile ? `<p>${opts.hostile}</p>` : ""}
</section>
${extra}
<h2 id="See_also">See also</h2><ul><li>Unrelated Thing One</li></ul>
<h2 id="References">References</h2><ol class="references"><li>Citation text that must not appear.</li></ol>
</body></html>`;
}
