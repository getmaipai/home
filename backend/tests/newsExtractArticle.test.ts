// NEWS-02b: extractFullArticle's news mode (outbound hrefs, quote blocks); the reference mode is covered by its own tests.
import { describe, expect, test } from "bun:test";
import { extractFullArticle, safeOutboundHref, type ArticleBlock, type ArticleInline } from "@/lib/retrieval/extractArticle";

const page = `<!doctype html><html><head><title>Falls reopen</title></head><body>
<nav><a href="/sections">Sections</a></nav>
<article><h1>Falls reopen</h1>
<p>The <a href="https://county.example.com/notice?id=7">county notice</a> says <em>the path</em> is open, see <a href="/local/map">the map</a>, <a href="javascript:alert(1)">bad</a>, <a href="https://user:pw@evil.example.com/">creds</a> and <a href="mailto:a@example.com">mail</a>.</p>
<blockquote><p>It is good to be back.</p><p>We waited a year.</p><cite>A visitor</cite></blockquote>
<p>After the quote.</p>
<aside>Related: junk</aside>
</article><footer>Copyright</footer></body></html>`;
const base = { book: "news", allowedBooks: new Set<string>(), allowImages: false, mode: "news" as const, baseUrl: "https://news.example.com/2026/falls" };
const links = (blocks: ArticleBlock[]): ArticleInline[] => blocks.flatMap((b) => (b.type === "paragraph" ? b.inlines : b.type === "quote" ? b.inlines : [])).filter((i) => i.type === "link");

describe("extractFullArticle news mode", () => {
  test("keeps outbound http(s) links as plain hrefs when allowLinks is true, and resolves relative ones against baseUrl", () => {
    const out = extractFullArticle(page, { ...base, allowLinks: true });
    expect(links(out.blocks)).toEqual([
      { type: "link", text: "county notice", href: "https://county.example.com/notice?id=7" },
      { type: "link", text: "the map", href: "https://news.example.com/local/map" },
    ]);
  });
  test("drops every link to plain text when allowLinks is false (a child)", () => {
    const out = extractFullArticle(page, { ...base, allowLinks: false });
    expect(links(out.blocks)).toEqual([]);
    const p = out.blocks.find((b) => b.type === "paragraph");
    expect(JSON.stringify(p)).toContain("county notice");
    expect(JSON.stringify(out.blocks)).not.toContain("href");
    expect(JSON.stringify(out.blocks)).not.toContain("county.example.com");
  });
  test("never keeps a script, mail, credentialed or unresolvable link", () => {
    const out = extractFullArticle(page, { ...base, allowLinks: true, baseUrl: undefined });
    expect(links(out.blocks).map((l) => (l as { href?: string }).href)).toEqual(["https://county.example.com/notice?id=7"]);
    const json = JSON.stringify(out.blocks);
    expect(json).not.toContain("javascript:");
    expect(json).not.toContain("evil.example.com");
    expect(json).not.toContain("mailto:");
  });
  test("the article body is found without wiki wrappers; nav, aside and footer are dropped", () => {
    const out = extractFullArticle(page, { ...base, allowLinks: true });
    const text = JSON.stringify(out.blocks);
    expect(out.title).toBe("Falls reopen");
    expect(text).not.toContain("Sections");
    expect(text).not.toContain("junk");
    expect(text).not.toContain("Copyright");
  });
  test("a blockquote becomes one quote block with its cite, and its paragraphs are not repeated", () => {
    const out = extractFullArticle(page, { ...base, allowLinks: true });
    const quotes = out.blocks.filter((b) => b.type === "quote");
    expect(quotes).toHaveLength(1);
    const q = quotes[0]! as Extract<ArticleBlock, { type: "quote" }>;
    expect(q.cite).toBe("A visitor");
    expect(q.inlines.map((i) => i.text).join("")).toBe("It is good to be back. We waited a year.");
    expect(out.blocks.filter((b) => b.type === "paragraph")).toHaveLength(2);
    expect(JSON.stringify(out.blocks).split("good to be back").length).toBe(2);
  });
  test("the same page in reference mode has no quote block and no href", () => {
    const out = extractFullArticle(page, { book: "news", allowedBooks: new Set(), allowLinks: true, allowImages: false });
    expect(out.blocks.some((b) => b.type === "quote")).toBe(false);
    expect(JSON.stringify(out.blocks)).not.toContain("href");
  });
  test("links by band: child gets none, teen and adult keep them", () => {
    const allowLinks = { child: false, teen: true, adult: true } as const;
    for (const band of ["child", "teen", "adult"] as const) {
      const n = links(extractFullArticle(page, { ...base, allowLinks: allowLinks[band] }).blocks).length;
      expect(n).toBe(band === "child" ? 0 : 2);
    }
  });
});

describe("safeOutboundHref", () => {
  test("accepts only absolute http and https without credentials", () => {
    expect(safeOutboundHref("https://a.example.com/x#y")).toBe("https://a.example.com/x#y");
    expect(safeOutboundHref("/x")).toBeNull();
    expect(safeOutboundHref("/x", "https://a.example.com/p/")).toBe("https://a.example.com/x");
    expect(safeOutboundHref("data:text/html,hi")).toBeNull();
    expect(safeOutboundHref("ftp://a.example.com/")).toBeNull();
    expect(safeOutboundHref("https://u:p@a.example.com/")).toBeNull();
    expect(safeOutboundHref("")).toBeNull();
  });
});
