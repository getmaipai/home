import { mixData, savedRows, topicRows } from "@/lib/news/data";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people, newsReads } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import { getPersonSettingValue, setValue, setHouseholdSettingValue } from "@/lib/settings";
import { interestRowsOf, listSaves, recordRead, setFollow, resetMix, recomputeAllMixes, recomputeNightlyMixes, recomputeMix, addSave } from "@/lib/news/records";
import { pageVisibleTo } from "@/lib/apps";
import { loadManifestOnly } from "@/lib/plugins";
import { resetDb } from "./reset-db";
import { seedFeeds, resetNewsState, putItem, installNewsApp, removeNewsApp, ADULT_HOST } from "./support/newsFixture";

beforeEach(() => { resetDb(); resetNewsState(); });
afterEach(() => removeNewsApp());
function person(role: string) {
  const iso = new Date().toISOString();
  const id = `person-${role}123456`;
  db.insert(people).values({ id, displayName: "Nadia", role, avatarSeed: id, source: "hub", createdAt: iso, updatedAt: iso, hlc: nextHlc() }).run();
  return db.select().from(people).where(eq(people.id, id)).get()!;
}

test("each band: only teens and adults get learned channels and the My Mix page", () => {
  const feeds = seedFeeds();
  const item = putItem(feeds.household, ADULT_HOST, { topics: ["science"], image: null });
  const manifest = loadManifestOnly("news");
  expect(manifest.ok).toBe(true);
  if (!manifest.ok) return;
  for (const role of ["child", "teen", "adult", "guest"]) {
    const p = person(role);
    recordRead(p.id, { itemId: item.id, storyId: "story-abcdef123", finished: true });
    const allowed = role === "teen" || role === "adult";
    expect(interestRowsOf(p.id).some((r) => r.inferred && r.affinity > 0)).toBe(allowed);
    expect(pageVisibleTo(p, manifest.value, { id: "mix", module: "news-mix", min_role: "teen" })).toBe(allowed);
    if (allowed) expect(getPersonSettingValue(p, "news.my_mix")).toBe(true);
  }
  recomputeAllMixes();
  expect(interestRowsOf("person-child123456")).toEqual([]);
  expect(interestRowsOf("person-guest123456")).toEqual([]);
});

test("reset forgets inferred rows, followed affinity and feedback; saves and another person's mix stay", () => {
  const feeds = seedFeeds();
  const item = putItem(feeds.household, ADULT_HOST, { topics: ["science"], image: null });
  const a = person("adult"), t = person("teen");
  for (const p of [a, t]) recordRead(p.id, { itemId: item.id, storyId: "story-abcdef123", feedback: "more" });
  setFollow(t.id, "teen", "topic", "science", true);
  addSave(t.id, { itemId: item.id, storyId: "story-abcdef123", canonicalUrl: item.canonical_url, title: item.title, publisher: item.publisher, offline: false });
  resetMix(t.id);
  recomputeAllMixes();
  expect(interestRowsOf(t.id)).toHaveLength(1);
  expect(interestRowsOf(t.id)[0]).toMatchObject({ followed: true, inferred: false, affinity: 0 });
  expect(db.select().from(newsReads).where(eq(newsReads.personId, t.id)).all()).toEqual([]);
  expect(listSaves(t.id)).toHaveLength(1);
  expect(interestRowsOf(a.id).some((r) => r.affinity > 0)).toBe(true);
});

test("switching My Mix off hides its page and stops learning", () => {
  const p = person("teen");
  expect(setValue(p, `person:${p.id}`, "news.my_mix", false).ok).toBe(true);
  expect(getPersonSettingValue(p, "news.my_mix")).toBe(false);
  expect(recomputeMix(p.id).topics.size).toBe(0);
  const manifest = loadManifestOnly("news");
  if (!manifest.ok) throw new Error("News fixture is missing. Restore the bundled package and retry.");
  expect(pageVisibleTo(p, manifest.value, { id: "mix", module: "news-mix", min_role: "teen" })).toBe(false);
});


test("an admin page never exposes another person's interests, reads or saves", () => {
  installNewsApp();
  setHouseholdSettingValue("news.shelf.enabled", true);
  const feeds = seedFeeds();
  const item = putItem(feeds.household, ADULT_HOST, { topics: ["science"], image: null });
  const t = person("teen"), admin = person("admin");
  setFollow(t.id, "teen", "topic", "science", true);
  recordRead(t.id, { itemId: item.id, storyId: "story-abcdef123", finished: true });
  addSave(t.id, { itemId: item.id, storyId: "story-abcdef123", canonicalUrl: item.canonical_url, title: item.title, publisher: item.publisher, offline: false });
  expect(savedRows(t)).toHaveLength(1);
  expect(topicRows(t).find((r) => r.key === "science")?.followed).toBe(true);
  expect(savedRows(admin)).toEqual([]);
  expect(topicRows(admin).find((r) => r.key === "science")?.followed).toBe(false);
  const result = JSON.stringify(mixData(admin, { person_id: t.id }));
  expect(result).not.toContain('"read":true');
  expect(result).not.toContain('"saved":true');
  expect(interestRowsOf(admin.id)).toEqual([]);
});

test("the shelf tick recomputes during the local nightly hour", () => {
  const feeds = seedFeeds();
  const item = putItem(feeds.household, ADULT_HOST, { topics: ["science"], image: null });
  const p = person("teen");
  recordRead(p.id, { itemId: item.id, storyId: "story-abcdef123" });
  // A persisted read update models activity restored before the scheduled sweep.
  db.update(newsReads).set({ feedback: "less" }).where(eq(newsReads.personId, p.id)).run();
  const midday = new Date(); midday.setHours(12);
  recomputeNightlyMixes(midday);
  expect(interestRowsOf(p.id).some((r) => r.affinity > 0)).toBe(true);
  const night = new Date(); night.setHours(2);
  recomputeNightlyMixes(night);
  expect(interestRowsOf(p.id).every((r) => r.affinity === 0)).toBe(true);
});


test("moving a profile to child controls removes its previous inference", () => {
  const feeds = seedFeeds();
  const item = putItem(feeds.household, ADULT_HOST, { topics: ["science"], image: null });
  const p = person("teen");
  recordRead(p.id, { itemId: item.id, storyId: "story-abcdef123" });
  expect(interestRowsOf(p.id).some((r) => r.inferred)).toBe(true);
  db.update(people).set({ role: "child" }).where(eq(people.id, p.id)).run();
  recomputeMix(p.id);
  expect(interestRowsOf(p.id)).toEqual([]);
});
