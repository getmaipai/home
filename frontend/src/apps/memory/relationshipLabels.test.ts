import { describe, expect, test } from "bun:test";
import { relationshipLinesFor, relationshipOptionsBetween, relationshipTypeLabel } from "@/apps/memory/relationshipLabels";

const entity = (id: string, name: string) => ({ id, name }) as never;
const edge = (type: string, from_id: string, to_id: string) => ({ id: `${from_id}-${type}-${to_id}`, type, from_id, to_id }) as never;

describe("relationshipTypeLabel", () => {
  test("uses the short phrase table", () => {
    expect(relationshipTypeLabel("parent_of")).toBe("parent of");
    expect(relationshipTypeLabel("owns")).toBe("owner of");
    expect(relationshipTypeLabel("cares_for")).toBe("caregiver of");
    expect(relationshipTypeLabel("employs")).toBe("employer of");
  });
  test("falls back to the id with spaces for an unlisted type", () => {
    expect(relationshipTypeLabel("relative_of")).toBe("relative of");
    expect(relationshipTypeLabel("some_new_type")).toBe("some new type");
  });
});

describe("relationshipLinesFor", () => {
  const me = entity("e1", "Willow");
  const byId = new Map([["e1", me], ["e2", entity("e2", "Clover")]]) as never;
  test("shows an ordinary edge only on its from side", () => {
    const lines = relationshipLinesFor(me, [edge("parent_of", "e1", "e2")], byId);
    expect(lines.map((line) => line.text)).toEqual(["parent of Clover"]);
    expect(relationshipLinesFor(me, [edge("child_of", "e2", "e1")], byId)).toEqual([]);
  });
  test("shows a symmetric edge from either side", () => {
    expect(relationshipLinesFor(me, [edge("partner_of", "e2", "e1")], byId).map((line) => line.text)).toEqual(["partner of Clover"]);
  });
  test("names a missing other entity as someone no longer known", () => {
    expect(relationshipLinesFor(me, [edge("friend_of", "e1", "gone")], byId).map((line) => line.text)).toEqual(["friend of someone no longer known"]);
  });
  test("ignores edges that do not involve the entity", () => {
    expect(relationshipLinesFor(me, [edge("parent_of", "e2", "e3")], byId)).toEqual([]);
  });
});

describe("relationshipOptionsBetween", () => {
  test("lists person to pet types in vocab order with the right direction", () => {
    expect(relationshipOptionsBetween("person", "pet").map((option) => [option.id, option.directionNewIsFrom])).toEqual([
      ["owns", true],
      ["owned_by", false],
      ["cares_for", true],
      ["cared_for_by", false],
    ]);
  });
  test("deduplicates symmetric person to person types", () => {
    const options = relationshipOptionsBetween("person", "person");
    const ids = options.map((option) => option.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(options.find((option) => option.id === "partner_of")).toEqual({ id: "partner_of", label: "partner of", directionNewIsFrom: true });
    expect(ids).toContain("parent_of");
  });
  test("returns nothing when no type joins the kinds", () => {
    expect(relationshipOptionsBetween("pet", "pet")).toEqual([]);
  });
});
