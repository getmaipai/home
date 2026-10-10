// KS-01: the `extract_article` processor. Pure HTML in, a plain record out.
import { describe, expect, test } from "bun:test";
import { LEAD_MAX_CHARS, cleanText, extractArticle } from "@/lib/retrieval/extractArticle";
import { articleHtml } from "./support/fakeKiwix";

describe("extractArticle", () => {
  const html = articleHtml({
    title: "Juniper Falls",
    lead: [
      "Juniper Falls is a waterfall in the made-up county of Alder.{{cite web|url=x}} It drops 40 metres.[1]",
      "It was first mapped in 1902.[citation needed]",
    ],
    infobox: [
      ["Location", "Alder County"],
      ["Height", "40 m (130 ft)"],
      ["Empty row", ""],
    ],
    extraSections: ["History", "Geology"],
  });
  const article = extractArticle(html);

  test("reads the title and the lead without citation marks or template braces", () => {
    expect(article.title).toBe("Juniper Falls");
    expect(article.lead).toContain("Juniper Falls is a waterfall");
    expect(article.lead).toContain("It was first mapped in 1902.");
    expect(article.lead).not.toMatch(/\[\d+\]|\[citation needed\]|\{\{|\}\}/);
  });

  test("leaves no CSS in the lead or the infobox rows", () => {
    const everything = JSON.stringify(article);
    expect(everything).not.toContain("mw-parser-output");
    expect(everything).not.toMatch(/margin:|padding:|\{[^}]*;[^}]*\}/);
  });

  test("keeps infobox rows with a value and drops the empty one", () => {
    expect(article.infobox).toEqual([
      { label: "Location", value: "Alder County" },
      { label: "Height", value: "40 m (130 ft)" },
    ]);
  });

  test("keeps real sections and drops References and See also", () => {
    expect(article.sections).toEqual(["History", "Geology"]);
    expect(JSON.stringify(article)).not.toContain("Citation text that must not appear");
    expect(JSON.stringify(article)).not.toContain("Unrelated Thing One");
  });

  test("is not a disambiguation page", () => {
    expect(article.disambiguation).toBe(false);
    expect(article.options).toEqual([]);
  });

  test("caps the lead at 2,500 characters on a sentence boundary", () => {
    const sentence = "This is one plain sentence about the falls. ";
    const long = extractArticle(articleHtml({ title: "Long Page", lead: [sentence.repeat(100)] }));
    expect(long.lead.length).toBeLessThanOrEqual(LEAD_MAX_CHARS);
    expect(long.lead.length).toBeGreaterThan(LEAD_MAX_CHARS - 200);
    expect(long.lead.endsWith(".")).toBe(true);
  });

  test("recognises a disambiguation page and lists its options instead of a lead guess", () => {
    const page = `<html><body><h1>Mercury</h1><p>Mercury may refer to:</p><ul><li><a href="Mercury_(planet)">Mercury (planet)</a></li><li><a href="Mercury_(element)">Mercury (element)</a></li></ul></body></html>`;
    const result = extractArticle(page);
    expect(result.disambiguation).toBe(true);
    expect(result.options).toEqual(["Mercury (planet)", "Mercury (element)"]);
  });
});

describe("cleanText", () => {
  test("drops inline CSS rules, template braces and edit links", () => {
    expect(cleanText(".mw-parser-output .hlist ul{margin:0} Born 1990 {{small|x}} [edit]")).toBe("Born 1990");
  });
});
