// NEWS-02b: Loki Doki's content-quality rules, ported.
import { describe, expect, test } from "bun:test";
import { FAILURE_TTL_MS, MIN_ARTICLE_CHARS, acceptArticleText, betterCopy, createFailureMemory, looksLikeStub } from "@/lib/news/contentQuality";

const sentence = "The county reopened the footbridge at Juniper Falls on Friday after a long repair. ";
// Exactly `chars` characters after trimming (the last character is always a letter).
const article = (chars: number) => `${sentence.repeat(Math.ceil(chars / sentence.length))}`.slice(0, chars - 1) + "x";

describe("acceptArticleText", () => {
  test("needs 400 characters of text", () => {
    expect(MIN_ARTICLE_CHARS).toBe(400);
    expect(acceptArticleText(article(399))).toBe(false);
    expect(article(400)).toHaveLength(400);
    expect(acceptArticleText(article(400))).toBe(true);
    expect(acceptArticleText("")).toBe(false);
  });
  test("whitespace does not count toward the length", () => {
    expect(acceptArticleText(`${article(300)}${" \n\t ".repeat(200)}`)).toBe(false);
  });
  test("a paywall stub is refused even when long enough", () => {
    expect(acceptArticleText(`${article(300)} Subscribe to continue reading. Already a subscriber? Sign in. ${article(300)}`)).toBe(false);
    expect(acceptArticleText("This article is for subscribers only. " + article(500))).toBe(false);
  });
  test("a cookie wall or bot challenge is refused", () => {
    expect(acceptArticleText("We use cookies to improve your experience. Accept all cookies. Cookie settings. " + article(450))).toBe(false);
    expect(acceptArticleText("Checking your browser before accessing the site. Please enable JavaScript. " + article(400))).toBe(false);
  });
  test("a long real story that merely mentions cookies or subscribing is kept", () => {
    expect(acceptArticleText(`${article(2000)} The bakery sells cookies. Readers can subscribe to the newsletter. ${article(500)}`)).toBe(true);
  });
  test("a wall in front of a long page is still refused", () => {
    expect(acceptArticleText(`We use cookies. ${article(3000)}`)).toBe(false);
  });
  test("looksLikeStub treats empty text as a stub", () => {
    expect(looksLikeStub("   ")).toBe(true);
    expect(looksLikeStub(article(100))).toBe(false);
  });
});

describe("betterCopy", () => {
  test("an accepted copy beats a rejected one in either order", () => {
    const good = article(500), stub = "Subscribe to continue reading. " + article(2500);
    expect(betterCopy(good, stub)).toBe(good);
    expect(betterCopy(stub, good)).toBe(good);
    expect(betterCopy(good, article(100))).toBe(good);
  });
  test("between two accepted copies the longer wins; a tie keeps the first", () => {
    const a = article(600), b = article(900);
    expect(betterCopy(a, b)).toBe(b);
    expect(betterCopy(b, a)).toBe(b);
    const t1 = article(500), t2 = t1 + "";
    expect(betterCopy(t1, t2)).toBe(t1);
  });
  test("between two rejected copies the longer wins; missing copies never win", () => {
    expect(betterCopy("short", "a bit longer teaser")).toBe("a bit longer teaser");
    expect(betterCopy(null, "x")).toBe("x");
    expect(betterCopy("x", undefined)).toBe("x");
    expect(betterCopy(null, undefined)).toBe("");
  });
});

describe("failure memory", () => {
  const url = "https://news.example.com/story/1";
  test("remembers a failure for 30 minutes on an injected clock", () => {
    expect(FAILURE_TTL_MS).toBe(30 * 60_000);
    let t = 1_000_000;
    const mem = createFailureMemory({ now: () => t });
    expect(mem.has(url)).toBe(false);
    expect(mem.record(url)).toBe(true);
    expect(mem.has(url)).toBe(true);
    t += FAILURE_TTL_MS - 1;
    expect(mem.has(url)).toBe(true);
    t += 1;
    expect(mem.has(url)).toBe(false);
    expect(mem.size).toBe(0);
  });
  test("is keyed by canonical URL: tracking parameters, fragment, case of host and trailing slash do not matter", () => {
    const mem = createFailureMemory({ now: () => 0 });
    mem.record("https://News.Example.com/story/1/?utm_source=x&b=2&a=1#top");
    expect(mem.has("https://news.example.com/story/1?a=1&b=2")).toBe(true);
    expect(mem.has("https://news.example.com/story/2?a=1&b=2")).toBe(false);
  });
  test("an address that is not a usable link is never recorded", () => {
    const mem = createFailureMemory();
    expect(mem.record("not a url")).toBe(false);
    expect(mem.record("ftp://example.com/x")).toBe(false);
    expect(mem.has("not a url")).toBe(false);
  });
  test("Try again forgets one address; sweep drops only expired entries", () => {
    let t = 0;
    const mem = createFailureMemory({ now: () => t, ttlMs: 100 });
    mem.record(url); mem.record("https://news.example.com/story/2");
    mem.forget(url);
    expect(mem.has(url)).toBe(false);
    expect(mem.has("https://news.example.com/story/2")).toBe(true);
    t = 100;
    expect(mem.sweep()).toBe(1);
    expect(mem.size).toBe(0);
  });
  test("a second failure restarts the clock", () => {
    let t = 0;
    const mem = createFailureMemory({ now: () => t, ttlMs: 100 });
    mem.record(url); t = 90; mem.record(url); t = 150;
    expect(mem.has(url)).toBe(true);
  });
});
