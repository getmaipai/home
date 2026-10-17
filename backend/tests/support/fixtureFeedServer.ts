// NEWS-02b: a localhost-only feed server for the News tests (docs/THIRD-PARTY-SERVICES.md, the privacy promise: a test never reaches a
// real publisher). It binds 127.0.0.1 on an ephemeral port and serves one feed in three formats, the pictures and article pages the
// feed points at, plus a 429 feed and a slow feed. Every address it hands out is `http://127.0.0.1:<port>/...`.
import type { Server } from "bun";

export interface FixtureItem {
  id: string;
  title: string;
  summary: string;
  /** ISO timestamp. */
  published: string;
  /** Picture file name under /pictures/, or null for a text-only story. */
  picture: string | null;
  /** Full-article HTML body served at /articles/<id>; the feed itself carries only the summary. */
  articleHtml?: string;
  /** JSON Feed only: put the article in `content_html`, as NPR-style feeds do. */
  contentInFeed?: boolean;
}

export type FixtureMode = "ok" | "429" | "slow" | "500";

export interface FixtureFeedServer {
  /** `http://127.0.0.1:<port>` */
  origin: string;
  url(path: string): string;
  /** Replace the served items. */
  setItems(items: FixtureItem[]): void;
  /** Make one path (for example "/rss.xml" or "/pictures/a.png") answer 429, 500 or slowly. */
  setMode(path: string, mode: FixtureMode): void;
  /** Every request seen, in order (path only; the server never logs a body). */
  readonly requests: Array<{ method: string; path: string; userAgent: string | null }>;
  count(pathPrefix: string): number;
  close(): Promise<void>;
}

export const SLOW_DELAY_MS = 1500;

// A 1x1 PNG and a 2x1 GIF are enough for the picture route's resize tests; both are valid files.
const PNG_1X1 = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));

export function defaultItems(now: Date = new Date()): FixtureItem[] {
  const at = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * 3_600_000).toISOString();
  const body = (n: string) => `<article><h1>${n}</h1>${"<p>Juniper Falls reopened to visitors after a long repair of the footbridge, and the county says the path will stay open all year.</p>".repeat(6)}<blockquote><p>It is good to be back.</p><cite>A visitor</cite></blockquote><p>Read the <a href="https://example.com/county-notice">county notice</a>.</p></article>`;
  return [
    { id: "falls-reopen", title: "Juniper Falls reopens", summary: "The footbridge is repaired.", published: at(1), picture: "falls.png", articleHtml: body("Juniper Falls reopens") },
    { id: "library-hours", title: "Library adds evening hours", summary: "Open until nine on weekdays.", published: at(3), picture: "library.png", articleHtml: body("Library adds evening hours") },
    { id: "bus-route", title: "A new bus route starts Monday", summary: "Route 12 links the market and the park.", published: at(6), picture: null, articleHtml: body("A new bus route starts Monday") },
  ];
}

function xml(s: string): string { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

export function startFixtureFeedServer(initial: FixtureItem[] = defaultItems()): FixtureFeedServer {
  let items = initial;
  const modes = new Map<string, FixtureMode>();
  const requests: FixtureFeedServer["requests"] = [];

  const server: Server<undefined> = Bun.serve<undefined>({
    hostname: "127.0.0.1", // never a real or LAN address
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;
      requests.push({ method: req.method, path, userAgent: req.headers.get("user-agent") });
      const mode = modes.get(path) ?? "ok";
      if (mode === "429") return new Response("slow down", { status: 429, headers: { "retry-after": "60" } });
      if (mode === "500") return new Response("broken", { status: 500 });
      if (mode === "slow") await new Promise((r) => setTimeout(r, SLOW_DELAY_MS));
      const origin = `http://127.0.0.1:${server.port}`;
      const pic = (i: FixtureItem) => (i.picture ? `${origin}/pictures/${i.picture}` : null);
      const link = (i: FixtureItem) => `${origin}/articles/${i.id}`;

      if (path === "/rss.xml") {
        const body = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>Fixture Gazette</title><link>${origin}/</link><description>Fixture feed</description>${items.map((i) => `<item><title>${xml(i.title)}</title><link>${link(i)}</link><guid isPermaLink="false">${i.id}</guid><pubDate>${new Date(i.published).toUTCString()}</pubDate><description>${xml(i.summary)}</description>${pic(i) ? `<enclosure url="${pic(i)}" type="image/png" length="68"/><media:thumbnail url="${pic(i)}"/>` : ""}</item>`).join("")}</channel></rss>`;
        return new Response(body, { headers: { "content-type": "application/rss+xml" } });
      }
      if (path === "/atom.xml") {
        const body = `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Fixture Gazette</title><id>${origin}/</id><updated>${items[0]?.published ?? new Date(0).toISOString()}</updated>${items.map((i) => `<entry><title>${xml(i.title)}</title><id>${i.id}</id><link rel="alternate" href="${link(i)}"/>${pic(i) ? `<link rel="enclosure" type="image/png" href="${pic(i)}"/>` : ""}<updated>${i.published}</updated><summary>${xml(i.summary)}</summary></entry>`).join("")}</feed>`;
        return new Response(body, { headers: { "content-type": "application/atom+xml" } });
      }
      if (path === "/feed.json") {
        const body = { version: "https://jsonfeed.org/version/1.1", title: "Fixture Gazette", home_page_url: `${origin}/`, items: items.map((i) => ({ id: i.id, url: link(i), title: i.title, summary: i.summary, date_published: i.published, ...(pic(i) ? { image: pic(i) } : {}), ...(i.contentInFeed && i.articleHtml ? { content_html: i.articleHtml } : {}) })) };
        return new Response(JSON.stringify(body), { headers: { "content-type": "application/feed+json" } });
      }
      if (path.startsWith("/pictures/")) {
        const name = decodeURIComponent(path.slice("/pictures/".length));
        if (!items.some((i) => i.picture === name)) return new Response("not found", { status: 404 });
        return new Response(PNG_1X1, { headers: { "content-type": "image/png" } });
      }
      if (path.startsWith("/articles/")) {
        const item = items.find((i) => i.id === decodeURIComponent(path.slice("/articles/".length)));
        if (!item) return new Response("not found", { status: 404 });
        return new Response(`<!doctype html><html><head><title>${xml(item.title)}</title></head><body><nav>Home Sections</nav>${item.articleHtml ?? `<article><p>${xml(item.summary)}</p></article>`}<footer>Copyright</footer></body></html>`, { headers: { "content-type": "text/html" } });
      }
      return new Response("not found", { status: 404 });
    },
  });

  const origin = `http://127.0.0.1:${server.port}`;
  return {
    origin,
    url: (path) => `${origin}${path.startsWith("/") ? "" : "/"}${path}`,
    setItems(next) { items = next; },
    setMode(path, mode) { if (mode === "ok") modes.delete(path); else modes.set(path, mode); },
    requests,
    count: (prefix) => requests.filter((r) => r.path.startsWith(prefix)).length,
    async close() { await server.stop(true); },
  };
}
