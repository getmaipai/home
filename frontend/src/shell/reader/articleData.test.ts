import { describe, expect, test } from "bun:test";
import type { ReferenceArticleView } from "@/lib/api";
import { toArticleViewData } from "./articleData";

type Paragraph = { type: "paragraph"; inlines: Array<{ type: string; text: string }> };
const paragraph = (block: unknown) => block as Paragraph;

const base: ReferenceArticleView = {
  title: "Zendaya", book: "wiki", path: "Zendaya", source_label: "Wikipedia", licence: "CC BY-SA 4.0", snapshot_date: "2026-09-01",
  toc: [{ id: "Early", title: "Early life", level: 2 }, { id: "x", title: "Deep", level: 5 }],
  blocks: [
    { type: "heading", level: 2, id: "Early", text: "Early life" },
    { type: "paragraph", inlines: [{ type: "link", text: "Oakland", book: "wiki", path: "Oakland" }, { type: "link", text: "Plain", book: undefined, path: undefined }] },
  ],
};
const opts = { appName: "Wikipedia", onAppHome: () => {} };

describe("toArticleViewData", () => {
  test("a bare article keeps title, blocks and a source line with reading time, and draws nothing extra", () => {
    const data = toArticleViewData({ ...base, reading_minutes: 12 }, opts);
    expect(data.title).toBe("Zendaya");
    expect(data.description).toBe("Wikipedia · 12 min read");
    expect(data.infobox).toBeUndefined();
    expect(data.related).toBeUndefined();
    expect(data.blocks[1]).toMatchObject({ type: "paragraph" });
    expect(paragraph(data.blocks[1]).inlines[1]).toEqual({ type: "text", text: "Plain" });
  });

  test("the book's own short description wins over the source line", () => {
    expect(toArticleViewData({ ...base, description: "American actor and producer", reading_minutes: 3 }, opts).description).toBe("American actor and producer");
  });

  test("an infobox picture means a top action row, no hero, a floated first figure and a kicker chip", () => {
    const data = toArticleViewData({ ...base, kicker: "Actor · Producer", lead_image: { src: "/api/reference/media/wiki/z.jpg", alt: "Z" }, infobox: { title: "Zendaya", image: { src: "/api/reference/media/wiki/z.jpg", alt: "Z" }, rows: [{ label: "Born", value: "1996" }] } }, opts);
    expect(data.actionRow).toBe("top");
    expect(data.image).toBeUndefined();
    expect(data.floatFirstFigure).toBe(true);
    expect(data.kickerStyle).toBe("chip");
    expect(data.infobox?.image?.src).toContain("/api/reference/media/");
  });

  test("a lead picture without an infobox picture is the hero with the book's own chip text and the row under it", () => {
    const data = toArticleViewData({ ...base, lead_image: { src: "/m/a.jpg", alt: "Aurora" }, badge: "Earth's light show" }, opts);
    expect(data.image).toEqual({ w480: "/m/a.jpg", w1280: "/m/a.jpg", alt: "Aurora", badge: "Earth's light show" });
    expect(data.actionRow).toBe("under-hero");
  });

  test("breadcrumb is the app's own home, then the kicker when there is one, then the page", () => {
    const calls: string[] = [];
    const withKicker = toArticleViewData({ ...base, kicker: "Nature" }, { ...opts, onAppHome: () => calls.push("home") });
    expect(withKicker.breadcrumb?.map((b) => b.label)).toEqual(["Wikipedia", "Nature", "Zendaya"]);
    withKicker.breadcrumb![0]!.onClick!();
    expect(calls).toEqual(["home"]);
    expect(toArticleViewData(base, opts).breadcrumb?.map((b) => b.label)).toEqual(["Wikipedia", "Zendaya"]);
  });

  test("related becomes rail items with book targets; contents keep levels 2 to 4 only", () => {
    const data = toArticleViewData({ ...base, quick_fact: "Born: 1996", lead: "Zendaya is an actor.", related: [{ book: "wiki", path: "Euphoria", title: "Euphoria", thumbnail: { src: "/t.jpg", alt: "" } }] }, opts);
    expect(data.related).toEqual([{ target: { book: "wiki", path: "Euphoria" }, title: "Euphoria", thumbnail: { src: "/t.jpg", alt: "" } }]);
    expect(data.quick_fact).toBe("Born: 1996");
    expect(data.lead).toBe("Zendaya is an actor.");
    expect(data.contents).toEqual([{ id: "Early", title: "Early life", level: 2 }]);
    expect(data.foldSections).toBe(true);
  });

  test("the lead sentence is drawn once: it is cut from the start of the first paragraph", () => {
    const article: ReferenceArticleView = { ...base, lead: "Auroras are light.", blocks: [{ type: "paragraph", inlines: [{ type: "strong", text: "Auroras" }, { type: "text", text: " are light. They move." }] }, { type: "paragraph", inlines: [{ type: "text", text: "Second paragraph." }] }] };
    const data = toArticleViewData(article, opts);
    expect(data.lead).toBe("Auroras are light.");
    expect(paragraph(data.blocks[0]).inlines.map((i) => i.text).join("")).toBe("They move.");
    expect(data.blocks).toHaveLength(2);
  });

  test("a paragraph that is only the lead sentence is dropped; a paragraph that does not start with it is kept", () => {
    const only = toArticleViewData({ ...base, lead: "Only this.", blocks: [{ type: "paragraph", inlines: [{ type: "text", text: "Only this." }] }, { type: "paragraph", inlines: [{ type: "text", text: "Next." }] }] }, opts);
    expect(only.blocks).toHaveLength(1);
    const other = toArticleViewData({ ...base, lead: "Different.", blocks: [{ type: "paragraph", inlines: [{ type: "text", text: "Starts elsewhere. Different." }] }] }, opts);
    expect(other.blocks).toHaveLength(1);
    expect(paragraph(other.blocks[0]).inlines[0]!.text).toBe("Starts elsewhere. Different.");
  });
});
