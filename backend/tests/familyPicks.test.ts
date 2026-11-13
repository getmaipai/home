import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "@/db";
import { mediaCollections, mediaItems, mediaSources, people } from "@/db/schema";
import { addPick, listPicks, togglePickVote } from "@/lib/media/familyPicks";
import { nextHlc } from "@/lib/hlc";
import type { PersonRow } from "@/types";
import { resetDb } from "./reset-db";

beforeEach(() => resetDb());

function makePerson(id: string, role: string, birthdate: string | null = null): PersonRow {
  const now = new Date().toISOString();
  db.insert(people).values({ id, displayName: id, nickname: null, bio: null, accent: null, birthdate, role, avatarSeed: id, source: "local", localOnly: false, createdAt: now, updatedAt: now, deletedAt: null, hlc: nextHlc(), enabled: true, guestExpiresAt: null, memorializedAt: null }).run();
  return db.select().from(people).all().find((row) => row.id === id)!;
}

function video(id: string, bandOk = "child") {
  const now = new Date().toISOString();
  if (!db.select().from(mediaSources).all().some((row) => row.id === "msrc-test000")) db.insert(mediaSources).values({ id: "msrc-test000", kind: "root", scope: "household", ownerPersonId: null, label: "Test", rootMountId: null, rootPath: null, rootKinds: JSON.stringify(["video"]), visibleTo: JSON.stringify("household"), feedId: null, url: null, station: null, productionId: null, extractor: null, createdAt: now, hlc: nextHlc(), provenance: "test" }).run();
  db.insert(mediaItems).values({ id, kind: "video", title: id, subtitle: null, description: null, sourceId: "msrc-test000", parentId: null, locFileId: null, locRootId: null, locPath: null, locUrl: `https://example.test/${id}`, mediaType: "video/mp4", durationS: 12, size: 1, width: 1, height: 1, videoCodec: null, audioCodec: null, playable: "original", artwork: null, previews: null, chapters: "[]", subtitles: "[]", lyrics: null, lockedFields: null, series: null, season: null, episode: null, artist: null, album: null, albumArtist: null, madeArtistId: null, musicbrainzRecordingId: null, musicbrainzArtistId: null, musicbrainzReleaseGroupId: null, musicbrainzCheckedKey: null, trackNo: null, discNo: null, year: null, genre: null, author: null, narrator: null, seriesIndex: null, locatorKind: "none", external: null, externalId: null, advisoryExplicit: false, advisorySource: "tag", bandOk, verifiedByPersonId: null, addedAt: now, fingerprint: null, hidden: false, lastSeenScan: null, missingSince: null, pages: null, probeFailedFp: null, deletedAt: null, trashUntil: null, createdAt: now, hlc: nextHlc(), provenance: "test" }).run();
}

describe("Family Picks", () => {
  test("creates one shared owner collection, sorts by votes, toggles unique person votes, and returns top", () => {
    const owner = makePerson("person-owner001", "owner"), adult = makePerson("person-adult001", "adult");
    video("media-video001"); video("media-video002");
    expect(addPick(owner, "media-video001").ok).toBe(true);
    expect(addPick(adult, "media-video002").ok).toBe(true);
    togglePickVote(adult, "media-video002"); togglePickVote(owner, "media-video002");
    expect(listPicks(owner).items[0]).toMatchObject({ media_id: "media-video002", votes: 2, top: true });
    expect(listPicks(adult).items[1]?.voted).toBe(false);
    togglePickVote(adult, "media-video002");
    expect(listPicks(owner).items.find((item) => item.media_id === "media-video002")?.votes).toBe(1);
    expect(db.select().from(mediaCollections).all().filter((row) => row.kind === "family_picks")).toHaveLength(1);
  });

  test("minor sees and votes only on all ages items; hidden and adult items do not enter counts", () => {
    const owner = makePerson("person-owner001", "owner"), teen = makePerson("person-teen001", "teen", "2010-01-01"), child = makePerson("person-child001", "child", "2018-01-01");
    video("media-video001"); video("media-video002", "adult");
    expect(addPick(owner, "media-video001").ok).toBe(true);
    expect(addPick(owner, "media-video002").ok).toBe(false);
    expect(listPicks(teen).items.map((item) => item.media_id)).toEqual(["media-video001"]);
    expect(listPicks(child).items.map((item) => item.media_id)).toEqual(["media-video001"]);
    expect(togglePickVote(teen, "media-video002").ok).toBe(false);
  });

  test("no active adult yields no collection", () => {
    const teen = makePerson("person-teen001", "teen", "2010-01-01");
    expect(() => listPicks(teen)).toThrow();
    expect(db.select().from(mediaCollections).all().filter((row) => row.kind === "family_picks")).toHaveLength(0);
  });
});
