import { afterEach, beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import { setHouseholdSettingValue } from "@/lib/settings";
import { defaultTopicsFor, followedChannels, interestRowsOf, isFollowing, recomputeMix, setFollow } from "@/lib/news/records";
import { topicRows } from "@/lib/news/data";
import { resetDb } from "./reset-db";
import { resetNewsState, removeNewsApp } from "./support/newsFixture";

beforeEach(() => { resetDb(); resetNewsState(); });
afterEach(() => removeNewsApp());
function person(role: string) {
  const iso = new Date().toISOString();
  const id = `person-${role}123456`;
  db.insert(people).values({ id, displayName: "Nadia", role, avatarSeed: id, source: "hub", createdAt: iso, updatedAt: iso, hlc: nextHlc() }).run();
  return db.select().from(people).where(eq(people.id, id)).get()!;
}

const NINE = ["world", "local", "business", "technology", "science", "health", "sports", "entertainment", "environment"];

test("adults and teens follow every offered topic by default, a child follows none", () => {
  expect(defaultTopicsFor("adult")).toEqual(NINE);
  expect(defaultTopicsFor("teen")).toEqual(NINE);
  expect(defaultTopicsFor("child")).toEqual([]);
  for (const role of ["adult", "teen"]) {
    const p = person(role);
    expect([...followedChannels(p.id).topics].sort()).toEqual([...NINE].sort());
    expect(isFollowing(p.id, "topic", "science")).toBe(true);
    expect(topicRows(p).every((row) => row.followed === true)).toBe(true);
  }
  const child = person("child");
  expect(followedChannels(child.id).topics.size).toBe(0);
  expect(interestRowsOf(child.id)).toEqual([]);
});

test("an unfollow sticks, survives My Mix recomputation, and a follow brings it back", () => {
  const p = person("adult");
  setFollow(p.id, "adult", "topic", "sports", false);
  expect(isFollowing(p.id, "topic", "sports")).toBe(false);
  expect(followedChannels(p.id).topics.has("sports")).toBe(false);
  expect(followedChannels(p.id).topics.size).toBe(NINE.length - 1);
  recomputeMix(p.id);
  expect(isFollowing(p.id, "topic", "sports")).toBe(false);
  setFollow(p.id, "adult", "topic", "sports", true);
  expect(isFollowing(p.id, "topic", "sports")).toBe(true);
});

test("a household change applies to people who have not chosen, and keeps a person's opt-out", () => {
  const p = person("teen");
  setFollow(p.id, "teen", "topic", "health", false);
  expect(setHouseholdSettingValue("news.default_topics.teen", ["health", "science"]).ok).toBe(true);
  expect([...followedChannels(p.id).topics]).toEqual(["science"]);
  const q = person("adult");
  expect(setHouseholdSettingValue("news.default_topics.adult", ["world"]).ok).toBe(true);
  expect([...followedChannels(q.id).topics]).toEqual(["world"]);
});

test("a household can give children default topics only from the ones offered to children, and a child's opt-out writes no affinity", () => {
  expect(setHouseholdSettingValue("news.default_topics.child", ["kids"]).ok).toBe(true);
  const c = person("child");
  expect([...followedChannels(c.id).topics]).toEqual(["kids"]);
  setFollow(c.id, "child", "topic", "kids", false);
  expect(followedChannels(c.id).topics.size).toBe(0);
  expect(interestRowsOf(c.id)).toHaveLength(1);
  expect(interestRowsOf(c.id)[0]).toMatchObject({ followed: false, inferred: false, affinity: 0 });
});
