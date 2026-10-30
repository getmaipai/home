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

describe("inline whitespace around a link (verification pass: 'Readthe full report')", () => {
  test("a space before and after an inline link survives, and the ends of a paragraph stay trimmed", () => {
    const html = `<html><body><article><h1>T</h1><p>  Read <a href="https://elsewhere.example.org/more">the full report</a> now, and <b>bold</b> too.  </p><p>${"Filler sentence for the article quality rule. ".repeat(12)}</p></article></body></html>`;
    const article = extractFullArticle(html, { ...base, allowLinks: true });
    const first = article.blocks.find((block) => block.type === "paragraph");
    const flat = first && first.type === "paragraph" ? first.inlines.map((inline) => inline.text).join("") : "";
    expect(flat).toBe("Read the full report now, and bold too.");
  });
});

test("news cleans promos and CMS chrome while reference keeps them", () => {
  const html = '<html><body><article><p>Story text.</p><p>Get our newsletter</p><div data-component="ad-slot-inline"><p>Advert</p></div><p role="note">Note</p></article></body></html>';
  expect(extractFullArticle(html, { ...base, allowLinks: true }).blocks).toEqual([{ type: "paragraph", inlines: [{ type: "text", text: "Story text." }] }]);
  // Reference keeps the promo and the ad text; a role=note paragraph is the article's hatnote now (READER-01), so it is a field, not a block.
  const reference = extractFullArticle(html, { ...base, mode: "reference", allowLinks: true });
  expect(reference.blocks).toHaveLength(3);
  expect(reference.hatnote).toBe("Note");
});
test("news removes skip links, timestamps and credits and keeps long Get ready prose", () => {
  const prose = `Get ready for the garden opening. ${"The paths wind through native flowers and offer visitors a chance to learn about the landscape. ".repeat(3)}`.trim();
  const html = `<html><body><article><p><a href="#body">Skip to article</a>${prose}<span class="photo-credit">Credit</span></p><p>Published October 18, 2026 9 am</p></article></body></html>`;
  expect(extractFullArticle(html, { ...base, allowLinks: true }).blocks).toEqual([{ type: "paragraph", inlines: [{ type: "text", text: prose }] }]);
});
test("news deduplicates captions and drops related links and tail lists", () => {
  const html = '<html><body><article><figure><img src="https://example.com/a.jpg"><figcaption>Garden view</figcaption></figure><figure><img src="https://example.com/b.jpg"><figcaption>Garden view</figcaption></figure><p>Read more: <a href="https://example.com/more">Plans</a></p><h2>Recommended</h2><ul><li><a href="https://example.com/next">Next story</a></li></ul></article></body></html>';
  const news = extractFullArticle(html, { ...base, allowLinks: true, allowImages: true });
  expect(news.blocks).toEqual([{ type: "figure", src: "https://example.com/a.jpg", alt: "", caption: "Garden view" }, { type: "figure", src: "https://example.com/b.jpg", alt: "", caption: "" }]);
  expect(news.toc).toEqual([]);
});

test("news collects the split byline and lead caption without emitting caption paragraphs", () => {
  const html = `<html><body><article><div class="byline"><p>By</p><p><a rel="author" href="https://example.com/a">Ryan Benk</a></p><p>,</p><p><a rel="author" href="https://example.com/b">Ayesha Rascoe</a></p></div><figure><img src="https://example.com/photo.jpg"><div class="caption"><b>If you have the scratch, they have the scares</b><p>Chanthal Harris owns Long Dark House in Alexandria, Virginia. <strong>Ryan Benk/NPR News</strong></p><button>hide caption</button></div></figure><p>By the time the doors opened, the line ran down the block.</p><p>Ryan Benk wrote this fictional report.</p></article></body></html>`;
  const out = extractFullArticle(html, { ...base, allowLinks: true });
  expect(out.byline).toBe("Ryan Benk and Ayesha Rascoe");
  expect(out.leadCaption).toContain("Chanthal Harris owns Long Dark House");
  expect(out.leadCaption).toContain(" · Ryan Benk/NPR News");
  expect(out.leadCaption).not.toContain("hide caption");
  expect(out.blocks).toEqual([
    { type: "paragraph", inlines: [{ type: "text", text: "By the time the doors opened, the line ran down the block." }] },
    { type: "paragraph", inlines: [{ type: "text", text: "Ryan Benk wrote this fictional report." }] },
  ]);
  const reference = extractFullArticle(html, { ...base, mode: "reference", allowLinks: true });
  expect(reference.byline).toBeUndefined();
  expect(reference.leadCaption).toBeUndefined();
  expect(JSON.stringify(reference.blocks)).toContain('"text":"By"');
});

for (const author of ['"Nova Vale"', '{"name":"Nova Vale"}', '["Nova Vale", {"name":"Iris Reed"}]']) {
  test(`JSON-LD author variant ${author}`, () => {
    const html = `<html><head><script type="application/ld+json">{"@graph":[{"author":${author}}]}</script></head><body><article><p>Story.</p></article></body></html>`;
    expect(extractFullArticle(html, { ...base, allowLinks: true }).byline).toBe(author.startsWith("[") ? "Nova Vale and Iris Reed" : "Nova Vale");
  });
}
test("meta author is news metadata only", () => {
  const html = '<html><head><meta name="author" content="Nova Vale"></head><body><article><p>Story.</p></article></body></html>';
  expect(extractFullArticle(html, { ...base, allowLinks: true }).byline).toBe("Nova Vale");
  expect(extractFullArticle(html, { ...base, mode: "reference", allowLinks: true })).toEqual({ title: "", blocks: [{ type: "paragraph", inlines: [{ type: "text", text: "Story." }] }], toc: [], summary: "Story." });
});
