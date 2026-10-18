// MEDIA-KID-01 regression: a person whose own `media.allowlist_only` is on (a teen or an adult a guardian or admin set, not only a
// child) gets no discovery rows in any media app: featured, new, recent, more-from, Music's radio seeds and the autoplay suggestion.
import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people, mediaItems, mediaSources } from "@/db/schema";
import type { PersonRow } from "@/types";
import { DISCOVERY_IDS, mediaAppData, MEDIA_APPS, type MediaAppId } from "@/lib/media/appHost";
import { setValue, __resetSettingsCacheForTests } from "@/lib/settings";
import { resetDb } from "./reset-db";
import { __resetProgressForTests } from "@/lib/media/progress";

let atlas: PersonRow, marlow: PersonRow, nova: PersonRow, sprout: PersonRow;
const person = (name: string) => db.select().from(people).where(eq(people.displayName, name)).get() as PersonRow;

beforeEach(() => {
  resetDb(); __resetProgressForTests(); __resetSettingsCacheForTests();
  const now = new Date().toISOString();
  for (const [name, role, birthdate] of [["atlas", "owner", null], ["marlow", "adult", null], ["nova", "teen", "2011-03-01"], ["sprout", "child", "2018-03-01"]] as const) {
    db.insert(people).values({ id: `person-${name}00001`, displayName: name, role, birthdate, avatarSeed: "s", source: "local", createdAt: now, updatedAt: now, hlc: "1:0:aaaaaa" }).run();
  }
  [atlas, marlow, nova, sprout] = ["atlas", "marlow", "nova", "sprout"].map(person) as [PersonRow, PersonRow, PersonRow, PersonRow];
  db.insert(mediaSources).values({ id: "msrc-library0001", kind: "root", scope: "household", label: "Library", createdAt: now, hlc: "1:0:aaaaaa", provenance: "test" }).run();
  let n = 0;
  for (const [kind, title, subtitle] of [["video", "Garden walk", "Pippa"], ["video", "River trip", "Pippa"], ["track", "Morning song", "Riff"], ["track", "Evening song", "Riff"], ["episode", "Pilot", "Willow"], ["film", "Kite day", null], ["podcast_episode", "Question 1", "Quill"]] as const) {
    n += 1;
    db.insert(mediaItems).values({ id: `media-disc0000${n}`, sourceId: "msrc-library0001", kind, locRootId: "msrc-library0001", locPath: `${n}.mp4`, title, subtitle, artist: kind === "track" ? subtitle : null,
      album: kind === "track" ? "Days" : null, genre: "Family", year: 2021, artwork: JSON.stringify({ path: `${n}.jpg` }), bandOk: "child", mediaType: kind === "track" ? "audio/mpeg" : "video/mp4", playable: "original",
      addedAt: now, createdAt: now, hlc: "1:0:aaaaaa", provenance: "test" }).run();
  }
});

const rows = (who: PersonRow, app: MediaAppId, id: string, params: Record<string, unknown> = {}) => {
  const value = mediaAppData(who, app, id, params) as unknown;
  return Array.isArray(value) ? value : value && typeof value === "object" && "rows" in value ? (value as { rows: unknown[] }).rows : [];
};
const apps = Object.keys(MEDIA_APPS) as MediaAppId[];
const allowlist = (who: PersonRow, on: boolean) => {
  const result = setValue(atlas, `person:${who.id}`, "media.allowlist_only", on);
  expect(result.ok).toBe(true);
};

test("control: a teen and an adult with the setting off see discovery rows in Videos and Music", () => {
  for (const who of [nova, marlow]) {
    expect(rows(who, "videos", "featured").length).toBeGreaterThan(0);
    expect(rows(who, "videos", "recent").length).toBeGreaterThan(0);
    expect(rows(who, "music", "radio-seeds").length).toBeGreaterThan(0);
  }
});

test("a teen or an adult whose own media.allowlist_only is on gets no discovery rows in any media app", () => {
  for (const who of [nova, marlow]) {
    allowlist(who, true);
    for (const app of apps) {
      for (const id of DISCOVERY_IDS) expect(rows(who, app, id, { id: "media-disc00001" })).toEqual([]);
    }
    expect(rows(who, "music", "radio-seeds")).toEqual([]);
  }
});

test("a child, and a guest-band child, get no discovery rows either (unchanged)", () => {
  for (const app of apps) for (const id of DISCOVERY_IDS) expect(rows(sprout, app, id, { id: "media-disc00001" })).toEqual([]);
  expect(rows(sprout, "music", "radio-seeds")).toEqual([]);
});

test("the item view offers no autoplay suggestion when the person's allowlist is on", () => {
  allowlist(nova, true);
  const view = mediaAppData(nova, "videos", "item", { id: "media-disc00001" }) as Array<{ up_next?: unknown }> | { up_next?: unknown };
  const item = Array.isArray(view) ? view[0] : view;
  expect(item?.up_next ?? null).toBeNull();
});
