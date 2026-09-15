import { describe, expect, test, beforeEach } from "bun:test";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { people } from "@/db/schema";
import { parseReplyConstraint, setReplyConstraint, constraintsFor, bannedPhrasesFor, clearReplyConstraints } from "@/lib/replyConstraints";

beforeEach(() => resetDb());

describe("reply constraint parser", () => {
  test("parses bans only when the hub said the phrase", () => {
    expect(parseReplyConstraint("stop saying good luck", ["Good luck with it!"])).toEqual({ kind: "banned_phrase", value: "good luck" });
    expect(parseReplyConstraint("stop saying good luck", ["See you Thursday."])).toBeNull();
    expect(parseReplyConstraint("don't say 'one sec' again", ["One sec."])).toEqual({ kind: "banned_phrase", value: "one sec" });
  });

  test("parses shape and length asks", () => {
    expect(parseReplyConstraint("give me a bulleted list", [])).toEqual({ kind: "shape", value: "list" });
    expect(parseReplyConstraint("just the number", [])).toEqual({ kind: "shape", value: "number" });
    expect(parseReplyConstraint("one line", [])).toEqual({ kind: "shape", value: "one_line" });
    expect(parseReplyConstraint("keep it under 20 words", [])).toEqual({ kind: "length", value: "120" });
    expect(parseReplyConstraint("keep it short", [])).toEqual({ kind: "length", value: "120" });
    expect(parseReplyConstraint("what's the weather", [])).toBeNull();
  });
});

describe("reply constraint store", () => {
  test("sets, deduplicates, reads, filters, and clears by conversation", () => {
    const person = db.insert(people).values({ id: "person-sage01", displayName: "Sage", nickname: null, birthdate: null, role: "owner", avatarSeed: "sage", source: "hub", localOnly: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), deletedAt: null, hlc: "1:0:node123" }).returning().get();
    const first = setReplyConstraint({ conversationId: "conv-first", person: person.id, kind: "banned_phrase", value: "good luck", setByTurn: null });
    const duplicate = setReplyConstraint({ conversationId: "conv-first", person: person.id, kind: "banned_phrase", value: "good luck", setByTurn: null });
    setReplyConstraint({ conversationId: "conv-first", person: null, kind: "shape", value: "list", setByTurn: null });
    setReplyConstraint({ conversationId: "conv-second", person: null, kind: "banned_phrase", value: "one sec", setByTurn: null });
    expect(duplicate.id).toBe(first.id);
    expect(constraintsFor("conv-first")).toHaveLength(2);
    expect(bannedPhrasesFor("conv-first")).toEqual(["good luck"]);
    expect(constraintsFor("conv-second")).toHaveLength(1);
    clearReplyConstraints("conv-first");
    expect(constraintsFor("conv-first")).toEqual([]);
    expect(constraintsFor("conv-second")).toHaveLength(1);
  });
});
