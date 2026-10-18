import { expect, test } from "bun:test";
import { parseHTML } from "linkedom";
import { cleanArticleDocument, isPromoText } from "@/lib/retrieval/articleClean";
function clean(html: string) {
  const { document } = parseHTML(`<html><body><article>${html}</article></body></html>`);
  cleanArticleDocument(document);
  return document;
}

test("short promos are removed and long Get ready prose survives", () => {
  for (const text of ["Sign up for our email", "Subscribe to the newsletter", "Get our podcast", "Get the app", "Get our briefing", "News delivered to your inbox", "Skip past newsletter promotion"]) {
    expect(isPromoText(text)).toBe(true);
    expect(clean(`<p>${text}</p>`).querySelector("p")).toBeNull();
  }
  const prose = `Get ready for a new season at the garden. ${"Volunteers planted native flowers and prepared paths for visitors to explore the changing landscape. ".repeat(3)}`;
  expect(prose.length).toBeGreaterThan(180);
  for (const text of [prose, "Get ready for the opening.", `Get our ${"x".repeat(121)} newsletter`, `Subscribe to newsletter ${"x".repeat(180)}`]) {
    expect(isPromoText(text)).toBe(false);
    expect(clean(`<p>${text}</p>`).body.textContent).toBe(text);
  }
  expect(isPromoText(`Get our ${"x".repeat(118)} app`)).toBe(true);
});
for (const prefix of ["ad-slot", "advertisement", "tag-list", "topic-list", "byline", "related", "share-tools", "newsletter", "promo"]) {
  test(`CMS component ${prefix}`, () => expect(clean(`<div data-component="${prefix}-widget"><p>Chrome</p></div><p>Story</p>`).body.textContent).toBe("Story"));
}
for (const suffix of ["RichLinkBlockElement", "LinkBlockElement", "NewsletterSignupBlockElement", "EmailSignupBlockElement"]) {
  test(`CMS spacefinder ${suffix}`, () => expect(clean(`<div data-spacefinder-type="cms.${suffix}"><p>Chrome</p></div>`).querySelector("p")).toBeNull());
}
for (const name of ["newsletter", "subscribe", "byline", "dateline", "promo", "related-links", "read-more", "share", "image-credit", "photo-credit"]) {
  test(`class substring ${name}`, () => expect(clean(`<p class="cms-${name}-text">Chrome</p><p>Story<span class="cms-${name}-text">Credit</span></p>`).body.textContent).toBe("Story"));
}
test("print-hidden content and paragraph notes", () => {
  expect(clean('<div data-print-layout="hide"><p>Hidden</p></div><p role="note">Note</p><p data-component="story" data-spacefinder-type="TextBlockElement">Story</p>').body.textContent).toBe("Story");
});
test("only in-page skip links", () => {
  const document = clean('<p><a href="#body">Skip to body</a><a href="#end">Skip past chart</a><a href="#chart">Chart</a><a href="https://example.com/story">Skip to another story</a></p>');
  expect(Array.from(document.querySelectorAll("a")).map((a) => (a as { textContent: string | null }).textContent)).toEqual(["Chart", "Skip to another story"]);
});
test("timestamp-only paragraphs", () => {
  for (const text of ["Posted October 18, 2026 9:30 am", "Published on 18/10/2026 10 pm", "Updated 9:45 PM EDT"]) expect(clean(`<p>${text}</p>`).querySelector("p")).toBeNull();
  for (const text of ["Updated paths open at 9 am tomorrow, the council said.", "Published findings will be discussed at 9 am"]) {
    expect(clean(`<p>${text}</p>`).body.textContent).toBe(text);
  }
});
test("first identical caption survives", () => {
  const document = clean('<figure><figcaption>Garden view</figcaption></figure><figure><figcaption> Garden   view </figcaption></figure><figure><figcaption>Another view</figcaption></figure>');
  expect(Array.from(document.querySelectorAll("figcaption")).map((c) => (c as { textContent: string | null }).textContent)).toEqual(["Garden view", "Another view"]);
});
test("link-only Read more and Related paragraphs and items", () => {
  const document = clean('<p>Read more: <a href="https://example.com/a">Plans</a></p><ul><li><a href="/b">Related: Maps</a></li><li>Related: <a href="/c">Gardens</a> explain the plans.</li></ul><p>Read more: the report includes maps.</p>');
  expect(document.querySelectorAll("p")).toHaveLength(1);
  expect(document.querySelectorAll("li")).toHaveLength(1);
  expect(document.body.textContent).toContain("explain the plans");
});
for (const heading of ["Related", "More stories", "More from the garden", "You may also like", "Recommended", "Trending"]) {
  test(`trailing links under ${heading}`, () => {
    for (const tag of ["ul", "ol"]) {
      const document = clean(`<p>Story</p><section><h2>${heading}</h2><${tag}><li><a href="https://example.com/a">A</a></li><li><strong><a href="/b">B</a></strong></li></${tag}></section>`);
      expect(document.querySelector("h2")).toBeNull();
      expect(document.querySelector(tag)).toBeNull();
    }
  });
}
test("retains non-tail, prose, in-page and ordinary lists", () => {
  for (const html of ['<h2>Related</h2><ul><li><a href="/a">A</a></li></ul><p>Story continues</p>', '<h2>Related</h2><ul><li>See <a href="/a">A</a></li></ul>', '<h2>Related</h2><ul><li><a href="#a">A</a></li></ul>', '<h2>Garden steps</h2><ul><li><a href="/a">A</a></li></ul>']) expect(clean(html).querySelector("ul")).not.toBeNull();
});

test("a wrapper class containing share or promo never removes the story", () => {
  const long = "The council voted on the new budget after a long evening of debate about roads, schools and the library hours, and the result was close.";
  const document = clean(`<div class="share-wrapper"><p>${long}</p><p>${long} Again.</p><p>${long} More.</p></div>`);
  expect(document.querySelectorAll("p").length).toBe(3);
});

test("author sources follow priority, validate, deduplicate and cap names", () => {
  const { document } = parseHTML(`<html><head><meta name="author" content="Ember Stone"><script type="application/ld+json">{"author":["Iris Reed","bad/credit","Q","${"x".repeat(61)}","Quill Brook"]}</script></head><body><article><span class="author">Raven Lake</span><span itemprop="author">Nova Vale</span><a rel="author">Astro Hill</a><a rel="author">astro hill</a><span class="byline">Willow Park</span><p>By Astro Hill, Nova Vale and Ember Stone</p><p>By</p><span>,</span><p>and</p><span>&amp;</span><p>By the river, Nova Vale waited.</p></article></body></html>`);
  expect(cleanArticleDocument(document).byline).toBe("Astro Hill, Nova Vale, Ember Stone, Iris Reed, Quill Brook and Raven Lake");
  expect(document.querySelector("article")?.textContent).toBe("By the river, Nova Vale waited.");
});
test("caption credit and toggles are collected and cleaned while later figures survive", () => {
  const { document } = parseHTML('<html><body><article><figure><figcaption><b>A deck</b><p>A fictional garden. <span class="credit">Nova Vale</span></p><button>Other button</button>SHOW CAPTION</figcaption></figure><figure><figcaption>Later view</figcaption></figure><p>toggle caption</p></article></body></html>');
  expect(cleanArticleDocument(document).leadCaption).toBe("A deck A fictional garden. · Nova Vale");
  expect(document.querySelectorAll("figcaption")).toHaveLength(2);
  expect(document.body.textContent).not.toMatch(/caption|Other button/i);
});
test("author and caption wrappers retain the holdsArticle guard", () => {
  const prose = "The garden opened after volunteers finished the paths and planted flowers along the fence, giving visitors a quiet place to explore.";
  expect(clean(`<div class="author-caption"><p>${prose}</p><p>${prose}</p><p>${prose}</p></div>`).querySelectorAll("p")).toHaveLength(3);
});

test("an inline word and between emphasis in prose is never removed as a byline fragment", () => {
  const document = clean("<p>Trees <em>and</em> paths opened today.</p>");
  expect(document.querySelectorAll("em").length).toBe(1);
});
