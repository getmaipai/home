// What the real kiwix-serve and a real 2026 Wikipedia ZIM send (seen on the Studio, 2026-10-30): the suggest label is
// match-highlighted HTML while value is the plain title, and an ordinary article links to its own disambiguation page
// through a class="mw-disambig" hatnote link.
import { beforeEach, describe, expect, test } from "bun:test";
import { __resetReferenceReaderCachesForTests, lookupReference } from "@/lib/retrieval/referenceReader";
import { deriveDescription, extractArticle, extractFullArticle } from "@/lib/retrieval/extractArticle";

const BOOK = "wikipedia_en_all_maxi";
const catalog = `<feed><entry><title>Wikipedia</title><link rel="http://opds-spec.org/acquisition/open-access" type="text/html" href="/content/${BOOK}"/></entry></feed>`;

function article(title: string): string {
  return `<html><head><title>${title}</title></head><body><div id="mw-content-text"><div class="hatnote">"Einstein" redirects here. For other uses, see <a class="mw-disambig" href="./${title}_(disambiguation)">${title} (disambiguation)</a>.</div><p><b>${title}</b> (14 March 1879 – 18 April 1955) was a German-born theoretical physicist who developed the theory of relativity.</p><p>He received the 1921 Nobel Prize in Physics.</p></div></body></html>`;
}

const fetcher: typeof fetch = (async (input: unknown) => {
  const url = new URL(String(input), "http://127.0.0.1:1");
  if (url.pathname === "/catalog/v2/entries") return new Response(catalog, { status: 200 });
  if (url.pathname === "/suggest") {
    return Response.json([
      { value: "Albert Einstein (actor)", label: "&lt;b&gt;Albert&lt;/b&gt; &lt;b&gt;Einstein&lt;/b&gt; (actor)", kind: "path", path: "Albert_Einstein_(actor)" },
      { value: "Albert Einstein", label: "&lt;b&gt;Albert&lt;/b&gt; &lt;b&gt;Einstein&lt;/b&gt;", kind: "path", path: "Albert_Einstein" },
      { value: "Albert Einstein ", label: "containing 'Albert Einstein'...", kind: "pattern" },
    ]);
  }
  if (url.pathname === `/content/${BOOK}/Albert_Einstein`) return new Response(article("Albert Einstein"), { status: 200 });
  if (url.pathname === `/content/${BOOK}/Albert_Einstein_(actor)`) return new Response(article("Albert Einstein (actor)"), { status: 200 });
  return new Response("", { status: 404 });
}) as typeof fetch;

describe("real kiwix shapes", () => {
  beforeEach(() => __resetReferenceReaderCachesForTests());

  test("a title with highlighted label markup still matches exactly, so the real article wins", async () => {
    const out = await lookupReference({ query: "Albert Einstein", band: "adult" }, { baseUrl: "http://127.0.0.1:1", fetch: fetcher, db: null });
    expect(out.outcome).toBe("found");
    expect(out.rows[0]?.title).toBe("Albert Einstein");
  });

  test("a hatnote link to the disambiguation page does not make the article a disambiguation page", () => {
    const parsed = extractArticle(article("Albert Einstein"));
    expect(parsed.disambiguation).toBe(false);
    expect(parsed.lead).toContain("theoretical physicist");
  });

  test("a dek is built from the lead sentence in the book's own words", () => {
    expect(deriveDescription("Albert Einstein (14 March 1879 – 18 April 1955) was a German-born theoretical physicist best known for developing the theory of relativity.")).toBe("German-born theoretical physicist");
    expect(deriveDescription("Zendaya Maree Stoermer Coleman (born September 1, 1996) is an American actor and producer.")).toBe("American actor and producer");
    expect(deriveDescription("Zendaya Maree Stoermer Coleman (/zɛnˈdeɪ.ə/ zen-DAY-ə; born September 1, 1996), known mononymously as Zendaya, is an American actress and singer-songwriter.")).toBe("American actress and singer-songwriter");
    expect(deriveDescription("Paris, France: the capital.")).toBeUndefined();
  });

  test("infobox values keep their line breaks and list items readable", () => {
    const html = `<html><body><div id="mw-content-text"><table class="infobox"><tr><th scope="row">Born</th><td><div>Zendaya Coleman</div><br><span style="display:none"> (<span class="bday">1996-09-01</span>) </span>September 1, 1996<br>Oakland, California, U.S.</td></tr><tr><th>Occupations</th><td><ul><li>Actress</li><li>singer-songwriter</li></ul></td></tr></table><p>Zendaya is an American actress.</p></div></body></html>`;
    const rows = extractArticle(html).infobox;
    expect(rows[0]?.value).toBe("Zendaya Coleman, September 1, 1996, Oakland, California, U.S.");
    expect(rows[1]?.value).toBe("Actress, singer-songwriter");
  });

  test("a 2026 Wikipedia page links to other articles by bare title, keeps See also, and leaves namespace pages as plain text", () => {
    const html = `<html><body><div id="mw-content-text"><p>Zendaya was born in <a rel="mw:WikiLink" href="Oakland%2C_California">Oakland</a>, in the <a href="Category:Zendaya">category</a>, and <a href="https://example.com/x">outside</a>.</p><h2>See also</h2><ul><li><a href="Mononymous_person">Mononymous person</a></li></ul><h2>References</h2><ul><li>dropped</li></ul></div></body></html>`;
    const full = extractFullArticle(html, { book: BOOK, allowedBooks: new Set([BOOK]), allowLinks: true, allowImages: false });
    const inlines = full.blocks.flatMap((b) => (b.type === "paragraph" ? b.inlines : []));
    expect(inlines.find((i) => i.type === "link")).toMatchObject({ text: "Oakland", target: { book: BOOK, path: "Oakland,_California" } });
    expect(inlines.filter((i) => i.type === "link")).toHaveLength(1);
    const seeAlso = full.blocks.findIndex((b) => b.type === "heading" && b.text === "See also");
    expect(seeAlso).toBeGreaterThan(-1);
    expect(JSON.stringify(full.blocks[seeAlso + 1])).toContain("Mononymous_person");
    expect(full.blocks.some((b) => b.type === "heading" && b.text === "References")).toBe(false);
  });
});
