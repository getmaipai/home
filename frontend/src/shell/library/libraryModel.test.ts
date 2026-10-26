import { describe, expect, test } from "bun:test";
import { filterAllowed, filtersOf, parseView, queryOf, viewParams, secondaryLine, daysLeft, extensionOf, canAddFiles, isAdultRole, creationOf } from "./libraryModel";
import type { LibraryItem } from "@/lib/api";

const view = (query: string) => parseView(new URLSearchParams(query));
const item = (over: Partial<LibraryItem> = {}): LibraryItem => ({
  id: "f1", kind: "image", name: "Fox.png", media_type: "image/png", size_bytes: 1_258_291, created_at: "2026-10-16T00:00:00.000Z",
  owner: { id: "p1", display_name: "Sage" }, shared_with: { count: 0, household: false }, retention: "kept", chat_id: null, can_edit: false,
  audience: null, duration_seconds: null, thumb_url: "/api/files/f1/thumb?w=320", expires_at: null, version_count: 1, ...over,
});

describe("the Library address", () => {
  test("an empty address is the default view", () => {
    expect(view("")).toEqual({ section: "all", filter: "any", q: "", sort: "newest", layout: "grid", file: null });
    expect(viewParams(view("")).toString()).toBe("");
  });
  test("every part of the view survives a round trip", () => {
    const text = "section=pictures&filter=mine&q=fox&sort=name&view=list&file=f1";
    expect(viewParams(view(text)).toString()).toBe(text);
  });
  test("Home's Recently made link (sort=new) means Newest, and a bad value falls back", () => {
    expect(view("sort=new").sort).toBe("newest");
    expect(view("sort=sideways").sort).toBe("newest");
    expect(view("section=nowhere").section).toBe("all");
  });
  test("an older Only me filter link opens the Only me section", () => {
    expect(view("filter=only-me").section).toBe("only-me");
  });
  test("Mine cannot join Shared with me or Trash", () => {
    expect(filterAllowed("shared-with-me", "mine")).toBe(false);
    expect(filterAllowed("trash", "mine")).toBe(false);
    expect(filterAllowed("pictures", "mine")).toBe(true);
    expect(view("section=shared-with-me&filter=mine").filter).toBe("any");
  });
  test("sections and filters become the hub's filters", () => {
    expect(queryOf(view("section=videos"))).toEqual({ type: "video", sort: "newest" });
    expect(queryOf(view("section=shared-with-me"))).toEqual({ shared: "with-me", sort: "newest" });
    expect(queryOf(view("section=shared-by-me&filter=mine&q=%20fox%20&sort=size"))).toEqual({ shared: "by-me", owner: "me", search: "fox", sort: "size" });
    expect(queryOf(view("section=only-me"))).toEqual({ shared: "none", sort: "newest" });
    expect(filtersOf(queryOf(view("section=songs&sort=name")))).toEqual({ type: "audio" });
  });
});

describe("how an item reads", () => {
  test("the second line names the owner, the size and a planned removal", () => {
    const now = Date.parse("2026-10-18T00:00:00.000Z");
    expect(secondaryLine(item(), { id: "p1" }, now)).toBe("You · 1.2 MB");
    expect(secondaryLine(item({ owner: { id: "p2", display_name: "Marlow" } }), { id: "p1" }, now)).toBe("Marlow · 1.2 MB");
    expect(secondaryLine(item({ expires_at: "2026-10-21T00:00:00.000Z" }), { id: "p1" }, now)).toBe("You · 1.2 MB · Removed in 3 days");
  });
  test("days left in Trash", () => {
    const now = Date.parse("2026-10-18T00:00:00.000Z");
    expect(daysLeft("2026-11-17T00:00:00.000Z", now)).toBe(30);
    expect(daysLeft(null, now)).toBeNull();
    expect(daysLeft("2026-10-01T00:00:00.000Z", now)).toBe(0);
  });
  test("a type label from the name, else the media type", () => {
    expect(extensionOf({ name: "Trip plan.pdf", media_type: "application/pdf" })).toBe("PDF");
    expect(extensionOf({ name: "Fox", media_type: "image/png" })).toBe("PNG");
  });
  test("a child and a guest ask a grown-up to add files", () => {
    expect(canAddFiles({ role: "child" })).toBe(false);
    expect(canAddFiles({ role: "guest" })).toBe(false);
    expect(canAddFiles({ role: "teen" })).toBe(true);
    expect(isAdultRole({ role: "teen" })).toBe(false);
    expect(isAdultRole({ role: "admin" })).toBe(true);
  });
});

describe("the creation header of a Library file", () => {
  const me = { id: "p1" };
  test("a private file of mine names me, the added date, and I can manage it", () => {
    expect(creationOf(item(), me, [])).toEqual({ title: "Fox.png", creator: { name: "Sage", href: "/people/p1" }, madeAt: "2026-10-16T00:00:00.000Z", mode: "private", people: [], canManage: true });
  });
  test("a file shared with named people lists them", () => {
    const got = creationOf(item({ shared_with: { count: 2, household: false } }), me, [{ id: "p2", name: "Marlow" }, { id: "p3", name: "Nova" }]);
    expect(got.mode).toBe("shared");
    expect(got.people).toEqual([{ id: "p2", name: "Marlow" }, { id: "p3", name: "Nova" }]);
  });
  test("a household share shows Everyone in the home", () => {
    const got = creationOf(item({ shared_with: { count: 1, household: true } }), me, []);
    expect(got.mode).toBe("shared");
    expect(got.people).toEqual([{ id: "household", name: "Everyone in the home" }]);
  });
  test("someone else's file names its owner and I cannot manage it", () => {
    const got = creationOf(item({ owner: { id: "p9", display_name: "Marlow" } }), me, []);
    expect(got.creator).toEqual({ name: "Marlow", href: "/people/p9" });
    expect(got.canManage).toBe(false);
  });
});
