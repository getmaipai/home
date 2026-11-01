// MUSIC-WIKI-01: the artist photo and bio pass, against an offline Wikimedia fixture (no real network).
import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { existsSync } from "node:fs";
import { db } from "@/db";
import { mediaItems, musicArtistProfiles } from "@/db/schema";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { buildMediaTree } from "./support/mediaTree";
import { scanRoot } from "@/lib/media/scan";
import { setHouseholdSettingValue } from "@/lib/settings";
import { artistPhotoFile, artistProfileFor, creditLines, lookupArtistProfile, runArtistProfilePass, shortBio } from "@/lib/media/artistProfiles";
import { MusicBrainzUnavailable, type MusicBrainzClient } from "@/lib/media/musicbrainzMatch";

const ART = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ART2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);

type Wd = { human?: boolean; birth?: string; title?: string | null; image?: string | null; classes?: string[] };
function wikidata(qid: string, over: Wd = {}): unknown {
  const classes = over.classes ?? (over.human ? ["Q5"] : ["Q215380"]);
  const claims: Record<string, unknown[]> = { P31: classes.map((id) => ({ mainsnak: { datavalue: { value: { id } } } })) };
  if (over.birth) claims.P569 = [{ mainsnak: { datavalue: { value: { time: over.birth } } } }];
  if (over.image !== null) claims.P18 = [{ mainsnak: { datavalue: { value: over.image ?? "Quill live.jpg" } } }];
  const sitelinks = over.title === null ? {} : { enwiki: { title: over.title ?? "Quill (band)" } };
  return { entities: { [qid]: { id: qid, claims, sitelinks } } };
}
const extract = (text: string, disambiguation = false) => ({ query: { pages: { "1": { title: "Quill (band)", extract: text, ...(disambiguation ? { pageprops: { disambiguation: "" } } : {}) } } } });
const commons = (licensed = true) => ({
  query: { pages: { "9": { title: "File:Quill live.jpg", imageinfo: [{ url: "https://upload.wikimedia.org/a.jpg", thumburl: "https://upload.wikimedia.org/thumb/a.jpg", descriptionurl: "https://commons.wikimedia.org/wiki/File:Quill_live.jpg", mime: "image/jpeg", width: 1600,
    extmetadata: licensed ? { LicenseShortName: { value: "CC BY-SA 4.0" }, LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/4.0" }, Artist: { value: "<a href='x'>Pippa Stone</a>" } } : {} }] } } },
});

function fixture(wd: unknown, page: unknown, files: unknown = commons()) {
  const urls: string[] = [];
  const fetchJson = async (url: string): Promise<unknown> => {
    urls.push(url);
    if (url.includes("wikidata.org")) return wd;
    if (url.includes("en.wikipedia.org")) return page;
    if (url.includes("commons.wikimedia.org")) return files;
    throw new Error("unexpected host");
  };
  const photos: string[] = [];
  const fetchPhoto = async (url: string) => { photos.push(url); return { bytes: PNG, mime: "image/png" }; };
  return { urls, photos, fetchJson, fetchPhoto };
}
const mb = (qid: string | null | Error): MusicBrainzClient => ({
  searchRecordings: async () => [],
  lookupArtistWikidata: async () => { if (qid instanceof Error) throw qid; return qid; },
});
const BIO = "Quill is a folk band from Example Town. They formed in 1999. Their first album came out in 2001.";

beforeEach(() => resetDb());

test("a clean match: bio of two sentences, a licensed photo, and only ids and titles are sent", async () => {
  const f = fixture(wikidata("Q42"), extract(BIO));
  const result = await lookupArtistProfile(ART, { client: mb("Q42"), fetchJson: f.fetchJson, fetchPhoto: f.fetchPhoto });
  expect(result.status).toBe("found");
  if (result.status !== "found") return;
  expect(result.bio).toBe("Quill is a folk band from Example Town. They formed in 1999.");
  expect(result.bioUrl).toBe("https://en.wikipedia.org/wiki/Quill_(band)");
  expect(result.photo?.credit).toMatchObject({ license: "CC BY-SA 4.0", author: "Pippa Stone", page: "https://commons.wikimedia.org/wiki/File:Quill_live.jpg" });
  expect(f.photos).toEqual(["https://upload.wikimedia.org/thumb/a.jpg"]);
  expect(f.urls.every((u) => /wikidata\.org|en\.wikipedia\.org|commons\.wikimedia\.org/.test(u))).toBe(true);
});

test("no Wikidata link, no page and no usable page all end as none, not as an error", async () => {
  expect((await lookupArtistProfile(ART, { client: mb(null), ...fixture(wikidata("Q1"), extract(BIO)) })).status).toBe("none");
  const noPage = fixture(wikidata("Q42", { title: null, image: null }), extract(BIO));
  expect((await lookupArtistProfile(ART, { client: mb("Q42"), fetchJson: noPage.fetchJson, fetchPhoto: noPage.fetchPhoto })).status).toBe("none");
});

test("a disambiguation page is ignored (bio none), and a disambiguation item is none", async () => {
  const f = fixture(wikidata("Q42", { image: null }), extract("Quill may refer to: a pen. A band.", true));
  expect((await lookupArtistProfile(ART, { client: mb("Q42"), fetchJson: f.fetchJson, fetchPhoto: f.fetchPhoto })).status).toBe("none");
  const item = fixture(wikidata("Q42", { classes: ["Q4167410"] }), extract(BIO));
  const r = await lookupArtistProfile(ART, { client: mb("Q42"), fetchJson: item.fetchJson, fetchPhoto: item.fetchPhoto });
  expect(r.status).toBe("none");
  expect(item.urls.some((u) => u.includes("wikipedia.org"))).toBe(false);
});

test("a person under 18, or with no stated birth date, is withheld before any page or photo is asked for", async () => {
  const year = new Date().getUTCFullYear() - 12;
  for (const wd of [wikidata("Q42", { human: true, birth: `+${year}-05-01T00:00:00Z` }), wikidata("Q42", { human: true })]) {
    const f = fixture(wd, extract(BIO));
    expect((await lookupArtistProfile(ART, { client: mb("Q42"), fetchJson: f.fetchJson, fetchPhoto: f.fetchPhoto })).status).toBe("withheld");
    expect(f.urls.filter((u) => !u.includes("wikidata.org"))).toEqual([]);
    expect(f.photos).toEqual([]);
  }
  const adult = fixture(wikidata("Q42", { human: true, birth: "+1970-01-01T00:00:00Z" }), extract(BIO));
  expect((await lookupArtistProfile(ART, { client: mb("Q42"), fetchJson: adult.fetchJson, fetchPhoto: adult.fetchPhoto })).status).toBe("found");
});

test("a photo with no licence line is not kept; the bio still is", async () => {
  const f = fixture(wikidata("Q42"), extract(BIO), commons(false));
  const r = await lookupArtistProfile(ART, { client: mb("Q42"), fetchJson: f.fetchJson, fetchPhoto: f.fetchPhoto });
  expect(r.status === "found" && r.photo).toBeNull();
  expect(f.photos).toEqual([]);
});

test("shortBio keeps two sentences and bounds a long one", () => {
  expect(shortBio("One. Two. Three.")).toBe("One. Two.");
  expect(shortBio("   ")).toBeNull();
  expect(shortBio(`${"word ".repeat(300)}.`)!.length).toBeLessThanOrEqual(504);
});

// ---- The pass, against the database ------------------------------------------------------------------------------------------------

let owner: TestClient;
async function artistIds(): Promise<string[]> {
  setHouseholdSettingValue("music.musicbrainz_match", false);
  owner = new TestClient();
  await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const tree = buildMediaTree();
  const made = await owner.post("/api/media/sources", { label: "music", path: tree.music, kinds: ["track"] });
  const id = ((await made.json()) as { source: { id: string } }).source.id;
  await scanRoot(id, { prober: null, pruneGraceMs: 0 });
  return db.select().from(mediaItems).where(eq(mediaItems.kind, "track")).all().map((row) => row.id);
}

test("the pass stores bio, photo file and credit; the page reads them locally; a second pass asks nothing", async () => {
  const [first, second] = await artistIds() as [string, string];
  db.update(mediaItems).set({ musicbrainzArtistId: ART }).where(eq(mediaItems.id, first)).run();
  db.update(mediaItems).set({ musicbrainzArtistId: null }).where(eq(mediaItems.id, second)).run();
  const f = fixture(wikidata("Q42"), extract(BIO));
  const result = await runArtistProfilePass({ client: mb("Q42"), fetchJson: f.fetchJson, fetchPhoto: f.fetchPhoto });
  expect(result).toMatchObject({ considered: 1, found: 1, failed: 0 });
  const view = artistProfileFor(ART)!;
  expect(view.bio).toBe("Quill is a folk band from Example Town. They formed in 1999.");
  expect(view.photoUrl).toBe(`/api/media/artists/${ART}/photo`);
  expect(view.photoCredit?.license).toBe("CC BY-SA 4.0");
  expect(creditLines(view)).toEqual(["Photo: Pippa Stone, CC BY-SA 4.0, via Wikimedia Commons", "About: Wikipedia"]);
  const file = artistPhotoFile(ART)!;
  expect(existsSync(file.path)).toBe(true);
  expect(file.mime).toBe("image/png");
  const before = f.urls.length;
  expect((await runArtistProfilePass({ client: mb("Q42"), fetchJson: f.fetchJson, fetchPhoto: f.fetchPhoto })).considered).toBe(0);
  expect(f.urls.length).toBe(before);
});

test("the photo route serves a kept photo to a signed-in reader and 404s otherwise", async () => {
  const [first] = await artistIds() as [string];
  db.update(mediaItems).set({ musicbrainzArtistId: ART }).where(eq(mediaItems.id, first)).run();
  const f = fixture(wikidata("Q42"), extract(BIO));
  await runArtistProfilePass({ client: mb("Q42"), fetchJson: f.fetchJson, fetchPhoto: f.fetchPhoto });
  const ok = await owner.get(`/api/media/artists/${ART}/photo`);
  expect(ok.status).toBe(200);
  expect(ok.headers.get("content-type")).toBe("image/png");
  expect(new Uint8Array(await ok.arrayBuffer())).toEqual(PNG);
  expect((await owner.get(`/api/media/artists/${ART2}/photo`)).status).toBe(404);
  expect((await new TestClient().get(`/api/media/artists/${ART}/photo`)).status).toBe(401);
});

test("offline: nothing is stored, the artist is tried again next pass, and a pass stops after three failures", async () => {
  const [first, second] = await artistIds() as [string, string];
  db.update(mediaItems).set({ musicbrainzArtistId: ART }).where(eq(mediaItems.id, first)).run();
  db.update(mediaItems).set({ musicbrainzArtistId: ART2 }).where(eq(mediaItems.id, second)).run();
  const result = await runArtistProfilePass({ client: mb(new MusicBrainzUnavailable("network")) });
  expect(result.found).toBe(0);
  expect(result.failed).toBe(2);
  expect(db.select().from(musicArtistProfiles).all()).toHaveLength(0);
  expect(artistProfileFor(ART)).toBeNull();
  const wikiDown = fixture(wikidata("Q42"), extract(BIO));
  const throwing = async () => { throw new Error("offline"); };
  const again = await runArtistProfilePass({ client: mb("Q42"), fetchJson: throwing, fetchPhoto: wikiDown.fetchPhoto });
  expect(again.failed).toBe(2);
  expect(db.select().from(musicArtistProfiles).all()).toHaveLength(0);
});

test("the owner's off switch stops the pass before any request", async () => {
  const [first] = await artistIds() as [string];
  db.update(mediaItems).set({ musicbrainzArtistId: ART }).where(eq(mediaItems.id, first)).run();
  setHouseholdSettingValue("music.artist_wikimedia", false);
  const f = fixture(wikidata("Q42"), extract(BIO));
  let asked = 0;
  const client: MusicBrainzClient = { searchRecordings: async () => [], lookupArtistWikidata: async () => { asked++; return "Q42"; } };
  const result = await runArtistProfilePass({ client, fetchJson: f.fetchJson, fetchPhoto: f.fetchPhoto });
  expect(result.considered).toBe(0);
  expect(asked).toBe(0);
  expect(f.urls).toEqual([]);
});

test("a none answer is kept, not asked again, until it is old", async () => {
  const [first] = await artistIds() as [string];
  db.update(mediaItems).set({ musicbrainzArtistId: ART }).where(eq(mediaItems.id, first)).run();
  let asked = 0;
  const client: MusicBrainzClient = { searchRecordings: async () => [], lookupArtistWikidata: async () => { asked++; return null; } };
  expect((await runArtistProfilePass({ client })).none).toBe(1);
  await runArtistProfilePass({ client });
  expect(asked).toBe(1);
  const later = () => Date.now() + 91 * 24 * 60 * 60 * 1000;
  await runArtistProfilePass({ client, now: later });
  expect(asked).toBe(2);
});
