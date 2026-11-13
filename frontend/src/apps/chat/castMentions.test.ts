// CREATOR-05: the cast items of the `@` list are their own type, prefixed so they never collide with a companion item.
import { describe, expect, test } from "bun:test";
import { CAST_MENTION_PREFIX, castMentionItems } from "@/apps/chat/castMentions";

const entry = (over: Record<string, unknown>) => ({ id: "msub-aaaaaaaa", kind: "subject", subject_kind: "character", name: "Pip", real: false, minor: false, audience: "all-ages", ...over }) as never;

describe("cast items for the @ list", () => {
  test("each entry becomes a cast item with a prefixed id and its own label", () => {
    const items = castMentionItems([entry({}), entry({ id: "syn-1", kind: "synth", name: "Marlow Fox" }), entry({ id: "p-1", kind: "member", name: "Sage" }), entry({ id: "msub-bbbbbbbb", subject_kind: "place", name: "Blue house" })]);
    expect(items.map((i) => i.type)).toEqual(["cast", "cast", "cast", "cast"]);
    expect(items.map((i) => i.id)).toEqual(["cast:msub-aaaaaaaa", "cast:syn-1", "cast:p-1", "cast:msub-bbbbbbbb"]);
    expect(items.map((i) => i.description)).toEqual(["Cast", "Synth", "Household", "Place"]);
    expect(items.every((i) => i.id.startsWith(CAST_MENTION_PREFIX))).toBe(true);
  });
  test("nothing from the server means nothing in the list (a minor's list is whatever the server sent)", () => {
    expect(castMentionItems(undefined)).toEqual([]);
    expect(castMentionItems([])).toEqual([]);
  });
});
