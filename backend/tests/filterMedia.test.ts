// FILTER-MEDIA-01 (RULES.md C5, C9): every library list and every by-id read of a library row reads the one stored stamp. A child sees G
// only, a teen G to PG-13, an adult everything today's filters allow, and an item with no stamp is Unrated: absent for both minors.
// No rater runs on any list call, and the migration maps the old values (explicit, band_ok adult, the audience marks) onto stamps.
import { beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { ContentRating } from "@maipai/spec/ratings/ts/contentRating";
import { NewsItem } from "@maipai/spec/gen/ts/news-item.js";
import { db, sqlite } from "@/db";
import { contentRatings, creations, attachments, mediaItems, mediaProgress, mediaSources, people, shares } from "@/db/schema";
import type { PersonRow } from "@/types";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { nextHlc } from "@/lib/hlc";
import { __setRateHookForTests } from "@/lib/filter/rateStored";
import { buildDoor } from "@/lib/filter/door";
import { getStamp, putStamp, staleOrMissing, type StampKind } from "@/lib/filter/stamps";
import { runRatingsSweep } from "@/lib/filter/ratingsSweep";
import { listItems, listGroups } from "@/lib/media/items";
import { searchMedia } from "@/lib/media/search";
import { mediaAppData, queryItems } from "@/lib/media/appHost";
import { readableItem } from "@/lib/media/access";
import { addItem, resolveCollection, setSharedTo } from "@/lib/media/collections";
import { addPick, listPicks } from "@/lib/media/familyPicks";
import { resolveEntries } from "@/lib/videos/playlists";
import { listLibrary } from "@/lib/library";
import { feedRowOf } from "@/lib/videos/feed";
import type { VideoJob } from "@/lib/videos/jobs";
import { newMediaProgressId } from "@/lib/id";
import { openShelfStore } from "@/lib/shelf/shelfStore";
import { releaseShelfItem, releaseShelfItems } from "@/lib/shelf/shelfRead";
import { syncShelfFeeds } from "@/lib/shelf/shelfFeeds";
import { listFeeds } from "@/lib/shelf/feedStore";
import { setHouseholdSettingValue } from "@/lib/settings";

const NOW = "2026-11-17T12:00:00.000Z";
const LEVELS = ["g", "pg13", "r", "x", "none"] as const;
type Level = (typeof LEVELS)[number];
const KINDS = [["track", "audio"], ["video", "video"], ["podcast_episode", "podcasts"]] as const;
const id = (kind: string, level: Level) => `media-${kind.replace("_", "")}${level}`;

let owner: PersonRow, adult: PersonRow, teen: PersonRow, child: PersonRow;
let clients: Record<"owner" | "adult" | "teen" | "child", TestClient>;
let ratedCalls = 0;

function stamp(kind: StampKind, subject: string, level: string, label?: { system: string; value: string }): void {
  putStamp({ kind, id: subject }, ContentRating.parse({ level, source: "given", rater: "test", rater_version: 1, rated_at: NOW, ...(label ? { label } : {}) }), `fp-${subject}`);
}

async function signIn(displayName: string, role: string, birthdate?: string): Promise<{ row: PersonRow; client: TestClient }> {
  const made = (await (await clients.owner.post("/api/people", { displayName, role, secret: "0000", ...(birthdate ? { birthdate } : {}) })).json()) as { id: string };
  const client = new TestClient();
  await client.post("/api/auth/verify-secret", { personId: made.id, secret: "0000" });
  return { row: db.select().from(people).where(eq(people.id, made.id)).get() as PersonRow, client };
}

function insertItem(kind: string, level: Level, n: number): void {
  const explicit = level === "r";
  db.insert(mediaItems).values({
    id: id(kind, level), sourceId: "msrc-filter000001", kind, locUrl: `https://example.test/${kind}${level}`, mediaType: kind === "track" ? "audio/mpeg" : kind === "video" ? "video/mp4" : "audio/mpeg",
    playable: "original", title: `Item ${kind} ${level}`, artist: "nova", album: "Garden", series: null, durationS: 100, size: 10, trackNo: n,
    advisoryExplicit: explicit, bandOk: explicit || level === "x" ? "adult" : "child", addedAt: `2026-11-${String(10 + n).padStart(2, "0")}T00:00:00.000Z`, createdAt: NOW, hlc: nextHlc(), provenance: "test",
  }).run();
  if (level === "g") stamp("media_item", id(kind, level), "G");
  if (level === "pg13") stamp("media_item", id(kind, level), "PG-13");
  if (level === "r") stamp("media_item", id(kind, level), "R", { system: "explicit", value: "true" });
  if (level === "x") stamp("media_item", id(kind, level), "X");
}

beforeEach(async () => {
  resetDb();
  const ownerClient = new TestClient();
  await ownerClient.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  clients = { owner: ownerClient, adult: ownerClient, teen: ownerClient, child: ownerClient };
  owner = db.select().from(people).where(eq(people.displayName, "Sage")).get() as PersonRow;
  const a = await signIn("Atlas", "adult"); adult = a.row; clients.adult = a.client;
  const t = await signIn("Nova", "teen", "2011-02-01"); teen = t.row; clients.teen = t.client;
  const c = await signIn("Sprout", "child", "2018-03-01"); child = c.row; clients.child = c.client;
  db.insert(mediaSources).values({ id: "msrc-filter000001", kind: "root", scope: "household", label: "Library", createdAt: NOW, hlc: nextHlc(), provenance: "test" }).run();
  let n = 1;
  for (const [kind] of KINDS) for (const level of LEVELS) insertItem(kind, level, n++);
  ratedCalls = 0;
  __setRateHookForTests(() => { ratedCalls++; });
});

const names = (rows: Array<{ id: string }>, kind: string): Level[] => LEVELS.filter((level) => rows.some((row) => row.id === id(kind, level)));
const seen = (rows: Array<{ id: string }>): string[] => rows.map((row) => row.id);
/** What each viewer may see: a child G only, a teen G and PG-13, an adult every row today's other filters allow. */
const expected = (who: "child" | "teen" | "adult"): Level[] => (who === "child" ? ["g"] : who === "teen" ? ["g", "pg13"] : ["g", "pg13", "r", "x", "none"]);
const WHO = { child: () => child, teen: () => teen, adult: () => adult } as const;

describe("lists read the stamp", () => {
  for (const who of ["child", "teen", "adult"] as const) {
    test(`library list, shelf, search and groups for a ${who}`, () => {
      const person = WHO[who]();
      expect(names(listItems(person, { kind: "track", limit: 50, offset: 0 }).items, "track")).toEqual(expected(who));
      expect(names(listItems(person, { kind: "video", limit: 50, offset: 0 }).items, "video")).toEqual(expected(who));
      expect(names(queryItems(person, "audio", { all: true }), "track")).toEqual(expected(who));
      expect(names(queryItems(person, "podcasts", { all: true }), "podcastepisode")).toEqual(expected(who));
      const hits = searchMedia(person, "Item", 20).flatMap((group) => group.rows);
      for (const [kind] of KINDS) expect(names(hits, kind)).toEqual(expected(who));
      const groups = listGroups(person, "album", "track");
      expect(groups.length).toBeLessThanOrEqual(1);
      if (who !== "adult") expect(groups.every((group) => group.count <= expected(who).length)).toBe(true);
      expect(ratedCalls).toBe(0);
    });

    test(`by-id reads and the queue, liked, watch later, history and up next for a ${who}`, () => {
      const person = WHO[who]();
      for (const level of LEVELS) expect(!!readableItem(person, id("track", level))).toBe(expected(who).includes(level));
      for (const [kind, app] of KINDS) {
        for (const level of LEVELS) {
          for (const list of ["queue", "liked", "watch_later"] as const) {
            const collection = resolveCollection(person.id, list)!;
            addItem(collection, id(kind, level));
          }
          const ts = new Date().toISOString();
          db.insert(mediaProgress).values({ id: newMediaProgressId(), personId: person.id, mediaId: id(kind, level), position: JSON.stringify({ seconds: 5 }), durationS: 100, completed: false, plays: 1, skips: 0, finishes: 0, marks: JSON.stringify([{ at_s: 5, label: "mark" }]), deviceId: null, updatedAt: ts, hlc: nextHlc(), provenance: "test" }).run();
        }
        const want = expected(who);
        const union = new Set<Level>();
        for (const dataId of ["queue", "liked", "watch-later", "history"]) {
          const rows = mediaAppData(person, app, dataId, {}) as Array<{ id: string }>;
          const got = names(rows, kind);
          expect(got.filter((level) => !want.includes(level))).toEqual([]);
          for (const level of got) union.add(level);
        }
        // not vacuous: the lists of this app together do show what the viewer may see
        expect([...union].sort()).toEqual(want.slice().sort());
        const upNext = mediaAppData(person, app, "up-next", { id: id(kind, "g") }) as Array<{ id: string }>;
        expect(names(upNext, kind).filter((level) => !want.includes(level))).toEqual([]);
        if (app === "podcasts") {
          const bookmarks = mediaAppData(person, "podcasts", "bookmarks", {}) as Array<{ id: string }>;
          expect(names(bookmarks, kind)).toEqual(want);
          const episodes = mediaAppData(person, "podcasts", "episodes", {}) as Array<{ id: string }>;
          expect(names(episodes, kind).filter((level) => !want.includes(level))).toEqual([]);
        }
      }
      expect(ratedCalls).toBe(0);
    });

    test(`media home progress and recent songs for a ${who}`, async () => {
      const person = WHO[who]();
      const client = clients[who];
      const ts = new Date().toISOString();
      for (const level of LEVELS) for (const kind of ["track", "video"]) {
        db.insert(mediaProgress).values({ id: newMediaProgressId(), personId: person.id, mediaId: id(kind, level), position: JSON.stringify({ seconds: 5 }), durationS: 100, completed: false, plays: 1, skips: 0, finishes: 0, marks: "[]", deviceId: null, updatedAt: ts, hlc: nextHlc(), provenance: "test" }).run();
      }
      const home = (await (await client.get("/api/media/home")).json()) as { continue: Array<{ id: string }>; recent_music: Array<{ id: string }> };
      expect(names(home.recent_music, "track")).toEqual(expected(who));
      expect(names(home.continue, "video")).toEqual(expected(who));
      expect(ratedCalls).toBe(0);
    });

    test(`family picks and a video playlist for a ${who}`, () => {
      const person = WHO[who]();
      for (const level of ["g", "pg13", "none"] as const) expect(addPick(owner, id("video", level)).ok).toBe(true);
      expect(addPick(owner, id("video", "x")).ok).toBe(false);
      const picks = listPicks(person).items.map((item) => ({ id: item.media_id }));
      expect(names(picks, "video")).toEqual(expected(who).filter((level) => level === "g" || level === "pg13" || (who === "adult" && level === "none")));
      const entries = resolveEntries(person, LEVELS.map((level) => id("video", level)));
      expect(names(entries, "video")).toEqual(expected(who));
      expect(ratedCalls).toBe(0);
    });
  }

  test("an unstamped row is absent for a child and a teen, present for an adult, and a rater never ran", () => {
    expect(getStamp("media_item", id("track", "none"))).toBeNull();
    expect(seen(listItems(child, { limit: 50, offset: 0 }).items)).not.toContain(id("track", "none"));
    expect(seen(listItems(teen, { limit: 50, offset: 0 }).items)).not.toContain(id("track", "none"));
    expect(seen(listItems(adult, { limit: 50, offset: 0 }).items)).toContain(id("track", "none"));
    expect(ratedCalls).toBe(0);
  });

  test("the door's filterList on stored stamps releases the same rows and its onRate never fires", async () => {
    const rated: string[] = [];
    const door = buildDoor({ onRate: (raterId) => { rated.push(raterId); } });
    const rows = LEVELS.map((level) => ({ id: id("track", level) }));
    for (const who of ["child", "teen"] as const) {
      const person = WHO[who]();
      const kept = await door.filterList({ surface: "library", audience: { actor: person, band: who }, rows, rate: (row) => getStamp("media_item", row.id) });
      expect(names(kept, "track")).toEqual(expected(who));
    }
    expect(rated).toEqual([]);
  });
});

describe("the clips feed", () => {
  test("a minor's feed row needs the creation's stamp within the ceiling; an adult's needs none", () => {
    const make = (person: PersonRow, n: number, level: string | null) => {
      const fileId = `file-feed${n}000000000`, creationId = `creation-feed${n}`;
      db.insert(attachments).values({ id: fileId, ownerPersonId: person.id, conversationId: null, turnId: null, mediaType: "video/mp4", size: 10, sha256: `sha-${fileId}`, storagePath: `people/${person.id}/attachments/${fileId}`, provenance: "video-gen:{\"audience\":\"all-ages\"}", createdAt: NOW, hlc: nextHlc() }).run();
      db.insert(creations).values({ id: creationId, personId: person.id, kind: "video", madeAudience: "all-ages", fileIds: JSON.stringify([fileId]), body: JSON.stringify({ id: creationId }), createdAt: NOW, updatedAt: NOW, hlc: nextHlc(), provenance: "test" }).run();
      if (level) stamp("creation", creationId, level);
      return { id: `vjob-feed${n}`, personId: person.id, conversationId: null, turnId: null, companionId: null, kind: "generate", state: "done", stackJob: null, percent: 100, phase: null, position: null, prompt: "a boat", request: {}, files: [{ id: fileId, poster_id: fileId, width: 1, height: 1, seconds: 3, seed: null, model: null, ms: null, bytes: 10 }], error: null, createdAt: NOW, updatedAt: NOW, temporary: false } as unknown as VideoJob;
    };
    const rowFor = (person: PersonRow, job: VideoJob) => feedRowOf(person, job, new Set());
    expect(rowFor(child, make(child, 1, "G"))).not.toBeNull();
    expect(rowFor(child, make(child, 2, "PG-13"))).toBeNull();
    expect(rowFor(child, make(child, 3, null))).toBeNull();
    expect(rowFor(teen, make(teen, 4, "PG-13"))).not.toBeNull();
    expect(rowFor(teen, make(teen, 5, "R"))).toBeNull();
    expect(rowFor(adult, make(adult, 6, null))).not.toBeNull();
    expect(ratedCalls).toBe(0);
  });
});

describe("the shelf release and the Library", () => {
  test("a minor's shelf and story read hold only stamped stories under the ceiling", () => {
    const store = openShelfStore(":memory:");
    try {
      const urls = { child: "https://filter-child.example/feed.xml", teen: "https://filter-teen.example/feed.xml" } as const;
      setHouseholdSettingValue("news.feeds.child", urls.child);
      setHouseholdSettingValue("news.feeds.teen", urls.teen);
      syncShelfFeeds({ nowIso: NOW, store });
      let n = 0;
      for (const band of ["child", "teen"] as const) {
        const feed = listFeeds().find((candidate) => candidate.url === urls[band])!;
        const story = (title: string) => NewsItem.parse({ id: `news-filter${++n}abcdef`, feed_id: feed.id, url: `https://filter.example/${n}`, canonical_url: `https://filter.example/${n}`, title, summary: "", published_at: NOW, fetched_at: NOW, publisher: "Example", lang: "en", band_ok: "child", hlc: "1:0:abcdef", provenance: "test" });
        const clean = story("A calm day at the lake"), flagged = story("Hardcore porn"), fresh = story("A story not rated yet");
        for (const item of [clean, flagged, fresh]) store.put(item);
        db.delete(contentRatings).where(eq(contentRatings.subjectId, fresh.id)).run(); // the store rates a story as it is put; drop that stamp so this one is Unrated
        stamp("shelf_item", clean.id, "G");
        stamp("shelf_item", flagged.id, "X");
        ratedCalls = 0; // putting a story rated it; the reads below must not
        expect(releaseShelfItems(band, 20, store).map((item) => item.id)).toEqual([clean.id]);
        expect(releaseShelfItem(band, clean.id, store)?.id).toBe(clean.id);
        expect(releaseShelfItem(band, flagged.id, store)).toBeNull();
        expect(releaseShelfItem(band, fresh.id, store)).toBeNull();
      }
      expect(ratedCalls).toBe(0);
    } finally { store.close(); }
  });

  test("the Library lists a shared file for a minor only when its stamp is within the ceiling", () => {
    const file = (n: number, provenance: string): string => {
      const key = `file-${n.toString(16).padStart(16, "0")}`;
      db.insert(attachments).values({ id: key, ownerPersonId: owner.id, conversationId: null, turnId: null, mediaType: "image/png", size: n + 1, sha256: `sha-${key}`, storagePath: `people/${owner.id}/attachments/${key}`, provenance, createdAt: NOW, hlc: nextHlc() }).run();
      db.insert(shares).values({ id: `share-${n}`, fileId: key, fromPersonId: owner.id, to: "household", provenance: "fixture", createdAt: NOW, hlc: "fixture" }).run();
      return key;
    };
    const safe = file(1, 'picture-gen:{"audience":"all-ages"}'), adultOnly = file(2, 'picture-gen:{"audience":"adult-only"}'), unrated = file(3, 'picture-gen:{"audience":"all-ages"}');
    stamp("attachment", safe, "G"); stamp("attachment", adultOnly, "X");
    expect(listLibrary(child, {}).items.map((row) => row.id)).toEqual([safe]);
    expect(listLibrary(teen, {}).items.map((row) => row.id)).toEqual([safe]);
    expect(listLibrary(adult, {}).items.map((row) => row.id).sort()).toEqual([safe, unrated].sort());
    expect(ratedCalls).toBe(0);
  });
});

describe("the migration and the sweep", () => {
  function migrated(seed: (sqlite: Database) => void): Database {
    const sqlite = new Database(":memory:");
    sqlite.exec("PRAGMA foreign_keys = OFF");
    const dir = join(import.meta.dir, "../src/db/migrations");
    const journal = JSON.parse(readFileSync(join(dir, "meta/_journal.json"), "utf8")) as { entries: Array<{ tag: string }> };
    const tag = "0200_rating_stamps_from_band_ok";
    for (const entry of journal.entries) {
      if (entry.tag === tag) break;
      for (const part of readFileSync(join(dir, `${entry.tag}.sql`), "utf8").split("--> statement-breakpoint")) if (part.trim()) sqlite.exec(part);
    }
    sqlite.exec("PRAGMA foreign_keys = OFF");
    seed(sqlite);
    for (const part of readFileSync(join(dir, `${tag}.sql`), "utf8").split("--> statement-breakpoint")) if (part.trim()) sqlite.exec(part);
    return sqlite;
  }
  function insertMedia(sqlite: Database, rowId: string, fields: { bandOk: string; explicit?: number; genre?: string }): void {
    sqlite.run(
      "INSERT INTO media_items (id, source_id, kind, loc_url, media_type, playable, title, genre, advisory_explicit, band_ok, added_at, created_at, hlc, provenance) VALUES (?, 'msrc-x', 'track', 'https://e.test/x', 'audio/mpeg', 'original', 'Song', ?, ?, ?, ?, ?, '1:0:aaaaaa', 'test')",
      [rowId, fields.genre ?? "Folk", fields.explicit ?? 0, fields.bandOk, NOW, NOW],
    );
  }

  test("an adult or explicit row becomes an X or R stamp at rater version 0; child and teen rows get none", () => {
    const sqlite = migrated((s) => {
      s.run("INSERT INTO media_sources (id, kind, scope, label, created_at, hlc, provenance) VALUES ('msrc-x', 'root', 'household', 'L', ?, '1:0:aaaaaa', 'test')", [NOW]);
      insertMedia(s, "media-adultrow1", { bandOk: "adult" });
      insertMedia(s, "media-explicit1", { bandOk: "adult", explicit: 1 });
      insertMedia(s, "media-childtrip", { bandOk: "child", genre: "Hardcore porn" });
      insertMedia(s, "media-childclean", { bandOk: "child" });
      insertMedia(s, "media-teenrow1", { bandOk: "teen" });
    });
    const rows = sqlite.query("SELECT subject_id, level, source, rater, rater_version FROM content_ratings WHERE subject_kind = 'media_item' ORDER BY subject_id").all();
    expect(rows).toEqual([
      { subject_id: "media-adultrow1", level: "X", source: "worked_out", rater: "band-ok-migration", rater_version: 1 },
      { subject_id: "media-explicit1", level: "R", source: "given", rater: "explicit-flag", rater_version: 1 },
    ]);
    sqlite.close();
  });

  test("the sweep lists a migrated row, rates unstamped child rows with the real rater, and a minor sees a row only once it is stamped", async () => {
    insertItemRaw("media-trip000001", { bandOk: "child", genre: "Hardcore porn" });
    insertItemRaw("media-clean000001", { bandOk: "child", genre: "Folk" });
    insertItemRaw("media-adult000001", { bandOk: "adult", genre: "Folk" });
    // The migration's own statement, as it would have run on a database that held these rows before it.
    sqlite.exec(readStatements()[0]!);
    expect(getStamp("media_item", "media-adult000001")).toMatchObject({ level: "X", rater_version: 1 });
    expect(getStamp("media_item", "media-trip000001")).toBeNull();
    expect(getStamp("media_item", "media-clean000001")).toBeNull();
    const stale = staleOrMissing("media_item", 500).map((row) => row.id);
    expect(stale).toContain("media-adult000001"); // the migrated stamp's fingerprint is never the real one, so the sweep re-rates it
    for (const person of [child, teen]) {
      expect(seen(queryItems(person, "audio", { all: true }))).not.toContain("media-trip000001");
      expect(seen(queryItems(person, "audio", { all: true }))).not.toContain("media-clean000001");
    }
    ratedCalls = 0;
    await runRatingsSweep(() => {});
    expect(ratedCalls).toBeGreaterThan(0);
    expect(getStamp("media_item", "media-trip000001")?.level).toBe("X");
    expect(getStamp("media_item", "media-clean000001")?.level).toBe("G");
    expect(getStamp("media_item", "media-adult000001")?.fingerprint.endsWith("#migrated")).toBe(false); // re-rated by the sweep
    
    for (const person of [child, teen]) {
      expect(seen(queryItems(person, "audio", { all: true }))).not.toContain("media-trip000001");
    }
    expect(seen(queryItems(child, "audio", { all: true }))).toContain("media-clean000001");
    expect(seen(queryItems(adult, "audio", { all: true }))).toContain("media-trip000001");
  });

  test("the migration stamps a creation's audience mark and an attachment's", () => {
    const sqlite = migrated((s) => {
      s.run("INSERT INTO attachments (id, owner_person_id, media_type, size, sha256, storage_path, provenance, created_at, hlc) VALUES ('file-a', 'p', 'image/png', 1, 'sha-a', 'x', 'picture-gen:{\"audience\":\"adult-only\"}', ?, 'h')", [NOW]);
      s.run("INSERT INTO attachments (id, owner_person_id, media_type, size, sha256, storage_path, provenance, created_at, hlc) VALUES ('file-b', 'p', 'image/png', 1, 'sha-b', 'x', 'picture-gen:{\"audience\":\"all-ages\"}', ?, 'h')", [NOW]);
      s.run("INSERT INTO attachments (id, owner_person_id, media_type, size, sha256, storage_path, provenance, created_at, hlc) VALUES ('file-c', 'p', 'image/png', 1, 'sha-c', 'x', 'composer:upload', ?, 'h')", [NOW]);
      s.run("INSERT INTO attachments (id, owner_person_id, media_type, size, sha256, storage_path, provenance, created_at, hlc) VALUES ('file-d', 'p', 'image/png', 1, 'sha-d', 'x', 'composer:{\"audience\":\"all-ages\"}', ?, 'h')", [NOW]);
    });
    const rows = sqlite.query("SELECT subject_id, level, rater_version FROM content_ratings WHERE subject_kind = 'attachment' ORDER BY subject_id").all();
    expect(rows).toEqual([{ subject_id: "file-a", level: "X", rater_version: 1 }, { subject_id: "file-b", level: "G", rater_version: 1 }]);
    sqlite.close();
  });

  test("a creation's audience mark becomes a stamp with the rater's own fingerprint", () => {
    const sqlite = migrated((s) => {
      for (const [n, audience] of [["a", "adult-only"], ["b", "all-ages"]] as const) {
        s.run("INSERT INTO creations (id, person_id, kind, made_audience, body, created_at, updated_at, hlc, provenance) VALUES (?, 'p', 'picture', ?, '{}', ?, ?, 'h', 'test')", [`creation-${n}`, audience, NOW, NOW]);
      }
    });
    const rows = sqlite.query("SELECT subject_id, level, fingerprint, rater FROM content_ratings WHERE subject_kind = 'creation' ORDER BY subject_id").all();
    expect(rows).toEqual([
      { subject_id: "creation-a", level: "X", fingerprint: `adult-only:${NOW}`, rater: "audience-mark" },
      { subject_id: "creation-b", level: "G", fingerprint: `all-ages:${NOW}`, rater: "audience-mark" },
    ]);
    sqlite.close();
  });
});

function readStatements(): string[] {
  const sql = readFileSync(join(import.meta.dir, "../src/db/migrations/0200_rating_stamps_from_band_ok.sql"), "utf8");
  return sql.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean);
}
function insertItemRaw(rowId: string, fields: { bandOk: string; genre: string }): void {
  db.insert(mediaItems).values({ id: rowId, sourceId: "msrc-filter000001", kind: "track", locUrl: "https://example.test/x", mediaType: "audio/mpeg", playable: "original", title: "Song", genre: fields.genre, bandOk: fields.bandOk, addedAt: NOW, createdAt: NOW, hlc: nextHlc(), provenance: "test" }).run();
}
