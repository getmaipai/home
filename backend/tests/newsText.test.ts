import { expect, test } from "bun:test";
import { plainSummary } from "../src/lib/news/text";
import { trimArticleTail } from "../src/lib/news/tail";
import type { ArticleBlock } from "../src/lib/retrieval/extractArticle";
import { iconLinksOf } from "../src/lib/favicons";

const p = (text: string): ArticleBlock => ({ type: "paragraph", inlines: [{ type: "text", text }] });
const h = (text: string): ArticleBlock => ({ type: "heading", level: 2, id: text, text });

test("plainSummary drops the aggregator line, tags, entities and addresses", () => {
  expect(plainSummary("Article URL: https://discord.com/blog/x Comments URL: https://news.ycombinator.com/item?id=1 Points: 7 # Comments: 0")).toBe("");
  expect(plainSummary("<p>President Trump doesn&#8217;t like the term &#8220;AI&#8221; &#8212; sure</p> See https://x.example/a")).toBe("President Trump doesn’t like the term “AI” - sure See");
  expect(plainSummary("&lt;b&gt;bold&lt;/b&gt; text")).toBe("bold text");
});

test("trimArticleTail cuts at the first marker after the story begins and drops embedded posts", () => {
  const blocks: ArticleBlock[] = [p("One."), p("Two."), p("Three."), p("Four."), { type: "quote", inlines: [{ type: "text", text: "Today we are releasing pic.twitter.com/abc — Matt (@m)" }] }, p("Five."), h("Do more with your Apple products"), p("AirPods"), h("Comments")];
  expect(trimArticleTail(blocks).map((b) => (b.type === "paragraph" ? b.inlines[0]!.text : ""))).toEqual(["One.", "Two.", "Three.", "Four.", "Five."]);
  expect(trimArticleTail([p("a"), h("Comments"), p("b")]).length).toBe(3);
  expect(trimArticleTail([p("a"), p("b"), p("c"), p("FTC: We use income earning auto affiliate links."), p("d")]).length).toBe(3);
});

test("trimArticleTail keeps a story that has a Related box in the middle (The Verge) and still cuts a closing one", () => {
  const long = (n: string) => p(`${n} `.repeat(60));
  const list = (text: string): ArticleBlock => ({ type: "list", ordered: false, items: [[{ type: "text", text }]] });
  const mid = [long("a"), long("b"), long("c"), long("d"), h("Related"), list("Link box"), long("e"), long("f"), long("g"), h("More in: Topic"), h("Most Popular")];
  expect(trimArticleTail(mid).map((b) => b.type)).toEqual(["paragraph", "paragraph", "paragraph", "paragraph", "paragraph", "paragraph", "paragraph"]);
  const closing = [long("a"), long("b"), long("c"), long("d"), long("e"), h("Related"), list("Link box"), h("Another headline"), h("Most Popular")];
  expect(trimArticleTail(closing).length).toBe(5);
});

test("iconLinksOf lists declared icons, largest first, https only", () => {
  const html = '<link rel="icon" href="/f.ico"><link rel="apple-touch-icon" sizes="180x180" href="/a.png"><link rel="icon" href="http://x/y.png">';
  expect(iconLinksOf(html, "https://s.example/")).toEqual(["https://s.example/a.png", "https://s.example/f.ico"]);
});

test("trimArticleTail drops a Related box with its headline lines mid-story and keeps the story going", () => {
  const p = (text: string): ArticleBlock => ({ type: "paragraph", inlines: [{ type: "text", text }] });
  const h = (text: string): ArticleBlock => ({ type: "heading", level: 2, id: text, text });
  const long = (id: string): ArticleBlock => p(`${id} ${"A full sentence of the story that runs past the prose threshold for a real paragraph. ".repeat(2)}`);
  const blocks = [long("a"), long("b"), long("c"), long("d"), h("Related Stories"), h("New 'Naruto' Anime Series and 'Shadow Rising' Manga Revealed"), h("Magic: The Gathering Reveals New 'Darkhold Destiny' Marvel Set"), long("e"), long("f")];
  const kept = trimArticleTail(blocks);
  expect(kept).toHaveLength(6);
  expect(kept.some((block) => block.type === "heading")).toBe(false);
});

test("trimArticleTail drops a paragraph that repeats the one before it", () => {
  const lede = "Reddit's homepage is now going to offer For You and Following feeds, which could be a big shift.";
  expect(trimArticleTail([p(lede), p(lede), p("A second, different paragraph.")]).map((b) => (b.type === "paragraph" ? b.inlines[0]!.text : ""))).toEqual([lede, "A second, different paragraph."]);
  expect(trimArticleTail([p("Short."), p("Short.")])).toHaveLength(2);
});
