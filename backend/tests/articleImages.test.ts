// ZIM-IMG-01: the pure `extractArticleImages` function. Kiwix article HTML
// in, a list of book-local picture paths out. No network.
import { describe, expect, test } from "bun:test";
import { extractArticleImages } from "@/lib/retrieval/articleImages";

const BOOK = "wikipedia_en_all_maxi";
const ARTICLE = "A/Cat";

function run(html: string, limit?: number): ReturnType<typeof extractArticleImages> {
  return extractArticleImages(html, { book: BOOK, articlePath: ARTICLE, ...(limit === undefined ? {} : { limit }) });
}

function figure(src: string, attrs = "", inner = ""): string {
  return `<figure><img src="${src}"${attrs}>${inner}</figure>`;
}

describe("extractArticleImages", () => {
  test("keeps the infobox lead with size, alt and empty caption (a)", () => {
    const html = '<table class="infobox"><tr><td><img src="../I/lead.jpg" width="220" height="300" alt="A cat"></td></tr></table>';
    expect(run(html)).toEqual([
      { imagePath: "I/lead.jpg", alt: "A cat", caption: "", lead: true, width: 220, height: 300 },
    ]);
  });

  test("keeps a figure image, decoding the path and the caption (b)", () => {
    const html = '<figure><img src="../I/a%20b.png" width="300" height="200"><figcaption>  Two   words </figcaption></figure>';
    const out = run(html);
    expect(out).toHaveLength(1);
    const image = out[0]!;
    expect(image.imagePath).toBe("I/a b.png");
    expect(image.alt).toBe("");
    expect(image.caption).toBe("Two words");
    expect(image.lead).toBe(false);
    expect(image.width).toBe(300);
    expect(image.height).toBe(200);
  });

  test("drops .svg, .gif, remote, data, math and tiny non-lead images (c)", () => {
    const dropped = [
      figure("../I/a.svg", ' width="300" height="300"'),
      figure("../I/a.gif", ' width="300" height="300"'),
      figure("https://example.com/a.jpg", ' width="300" height="300"'),
      figure("data:image/png;base64,AAAA", ' width="300" height="300"'),
      '<figure><img class="mwe-math-element" src="../I/m.png" width="300" height="300"></figure>',
      figure("../I/math/render/xyz.png", ' width="300" height="300"'),
      figure("../I/tiny.png", ' width="50" height="50"'),
    ];
    for (const html of dropped) expect(run(html)).toEqual([]);
  });

  test("drops a source that climbs out of the book (d)", () => {
    expect(run(figure("../../other/x.jpg", ' width="300" height="300"'))).toEqual([]);
  });

  test("lists the lead before an earlier figure image (e)", () => {
    const html =
      figure("../I/first.png", ' width="300" height="300"') +
      '<table class="infobox"><tr><td><img src="../I/lead.jpg" width="120" height="120"></td></tr></table>';
    expect(run(html).map((image) => image.imagePath)).toEqual(["I/lead.jpg", "I/first.png"]);
  });

  test("collapses duplicates by path, keeping the lead flag (f)", () => {
    const twins = figure("../I/dup.png", ' width="300" height="300"') + figure("../I/dup.png", ' width="300" height="300"');
    expect(run(twins)).toHaveLength(1);
    const mixed =
      figure("../I/same.jpg", ' width="300" height="300"') +
      '<table class="infobox"><tr><td><img src="../I/same.jpg" width="150" height="150"></td></tr></table>';
    const out = run(mixed);
    expect(out).toHaveLength(1);
    expect(out[0]!.imagePath).toBe("I/same.jpg");
    expect(out[0]!.lead).toBe(true);
  });

  test("caps the result at the limit, default 8 (g)", () => {
    const five = (0, Array.from)({ length: 5 }, (_, i) => figure(`../I/n${i}.jpg`, ' width="300" height="300"')).join("");
    expect(run(five, 2)).toHaveLength(2);
    const ten = (0, Array.from)({ length: 10 }, (_, i) => figure(`../I/m${i}.jpg`, ' width="300" height="300"')).join("");
    expect(run(ten)).toHaveLength(8);
  });

  test("returns [] for garbage without throwing (h)", () => {
    expect(run("<<<not html")).toEqual([]);
  });

  test("drops a plain inline image in prose and a lead below 100 pixels", () => {
    expect(run('<p><img src="../I/prose.png" width="300" height="300"></p>')).toEqual([]);
    expect(run('<table class="infobox"><tr><td><img src="../I/lead.jpg" width="80" height="300"></td></tr></table>')).toEqual([]);
  });

  test("omits width and height when they are not declared", () => {
    const out = run(figure("../I/plain.webp"));
    expect(out).toHaveLength(1);
    expect(out[0]!.imagePath).toBe("I/plain.webp");
    expect(out[0]!.width).toBeUndefined();
    expect(out[0]!.height).toBeUndefined();
  });

  test("collapses whitespace in alt and strips magnify text from the caption", () => {
    const html =
      '<div class="thumb"><img src="../I/t.jpg" width="300" height="300" alt="  A   cat "><div class="thumbcaption">A ' +
      'thing<span class="magnify">(full size)</span></div></div>';
    const out = run(html);
    expect(out).toHaveLength(1);
    expect(out[0]!.alt).toBe("A cat");
    expect(out[0]!.caption).toBe("A thing");
    expect(out[0]!.lead).toBe(false);
  });

  test("cuts a long caption at 300 characters", () => {
    const caption = "word ".repeat(100);
    const out = run(figure("../I/long.jpg", ' width="300" height="300"', `<figcaption>${caption}</figcaption>`));
    expect(out).toHaveLength(1);
    expect(out[0]!.caption.length).toBe(300);
  });
});

describe("extractArticleImages path resolution (ZIM-IMG-01)", () => {
  test("a root-level article resolves a plain relative src, and a climbing src leaves the book", () => {
    const html = '<figure><img src="I/x.jpg" width="300" height="300"></figure><figure><img src="../I/y.jpg" width="300" height="300"></figure>';
    const found = extractArticleImages(html, { book: BOOK, articlePath: "Cat" });
    expect(found.map((image) => image.imagePath)).toEqual(["I/x.jpg"]);
  });
});
