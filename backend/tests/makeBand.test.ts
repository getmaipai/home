import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { storeFile } from "@/lib/attachments";
import { db } from "@/db";
import { madeArtists, mediaItems, mediaSources, people } from "@/db/schema";
import { BAND_NOT_HERE_LINE, bandBlock, bandProvenance, bandPrompt, briefFor, copiesSeed, fileIdOfHubImage, finishBandPicture, hubImageRef, makeBand, parseDraft } from "@/lib/music/band";
import { BAND_ACTION_NAMES, runBandAction } from "@/lib/music/bandActions";
import { deleteMade } from "@/lib/music/madeRecords";
import { createMade, getMade } from "@/lib/music/madeRecords";
import { __setMusicBrainzClientForTests, type MusicBrainzClient } from "@/lib/media/musicbrainzMatch";
import type { PictureJob } from "@/lib/pictures/jobs";
import type { PersonRow } from "@/types";
import { resetDb } from "./reset-db";

// MUSIC-LIKE-01: a band made "like" a song is new. The brief comes from the song's labels (and, once, its artist's public genre
// tags); a draft that reuses the song's title or artist is never kept; the picture hook only touches a band's own record.

let sage: PersonRow; let nova: PersonRow;
const stamp = { createdAt: new Date().toISOString(), hlc: "1:0:aaaaaa", provenance: "test" };
function person(name: string, role: string, birthdate: string | null = null): PersonRow {
  db.insert(people).values({ id: `person-${name}000001`, displayName: name, role, birthdate, avatarSeed: "s", source: "local", createdAt: stamp.createdAt, updatedAt: stamp.createdAt, hlc: stamp.hlc }).run();
  return db.select().from(people).where(eq(people.displayName, name)).get() as PersonRow;
}
function song(mbArtist: string | null) {
  db.insert(mediaItems).values({ id: "media-song000001", sourceId: "msrc-music000001", kind: "track", locRootId: "msrc-music000001", locPath: "1.mp3", title: "Paper Boats", artist: "Rivet Row", album: "Garden", genre: "Folk", year: 1974,
    musicbrainzArtistId: mbArtist, bandOk: "child", mediaType: "audio/mpeg", playable: "original", addedAt: stamp.createdAt, ...stamp }).run();
}
function client(genres: string[], calls: string[] = []): MusicBrainzClient {
  return { searchRecordings: async () => [], lookupArtistWikidata: async () => null, lookupArtistGenres: async (id) => { calls.push(id); return genres; } };
}

beforeEach(() => {
  resetDb();
  __setMusicBrainzClientForTests(null);
  sage = person("sage", "owner"); nova = person("nova", "child", "2018-03-01");
  db.insert(mediaSources).values({ id: "msrc-music000001", kind: "root", scope: "household", label: "Music", createdAt: stamp.createdAt, hlc: stamp.hlc, provenance: "test" }).run();
});

describe("the brief", () => {
  test("a matched song adds its artist's genre tags, asked once for that artist's public id", async () => {
    song("0e4d5a4e-1b1c-4c1a-8f3a-2f5f8c2d9a11");
    const calls: string[] = [];
    __setMusicBrainzClientForTests(client(["folk rock", "psychedelic folk"], calls));
    const brief = await briefFor(sage, "media-song000001");
    expect(brief).toEqual({ title: "Paper Boats", artist: "Rivet Row", genre: "Folk", year: 1974, tags: ["folk rock", "psychedelic folk"] });
    expect(calls).toEqual(["0e4d5a4e-1b1c-4c1a-8f3a-2f5f8c2d9a11"]);
  });
  test("an unmatched song asks nothing and uses the file's own tags", async () => {
    song(null);
    const calls: string[] = [];
    __setMusicBrainzClientForTests(client(["x"], calls));
    const brief = await briefFor(sage, "media-song000001");
    expect(brief?.tags).toEqual([]);
    expect(brief?.genre).toBe("Folk");
    expect(calls).toEqual([]);
  });
  test("a lookup that fails still gives the brief, and a missing song gives none", async () => {
    song("0e4d5a4e-1b1c-4c1a-8f3a-2f5f8c2d9a11");
    __setMusicBrainzClientForTests({ ...client([]), lookupArtistGenres: async () => { throw new Error("offline"); } });
    expect((await briefFor(sage, "media-song000001"))?.tags).toEqual([]);
    expect(await briefFor(sage, "media-nothing0001")).toBeNull();
  });
});

describe("a like-this is never a copy", () => {
  const brief = { title: "Paper Boats", artist: "Rivet Row", genre: "Folk", year: 1974, tags: [] };
  const draft = { name: "Clover Lane", single_title: "Slow River", members: [{ name: "Iris", role: "vocals" }] };
  test("a new name, title and members pass; the song's title, its artist or a member named for the artist do not", () => {
    expect(copiesSeed(draft, brief)).toBe(false);
    expect(copiesSeed({ ...draft, name: "rivet row" }, brief)).toBe(true);
    expect(copiesSeed({ ...draft, name: "Paper Boats" }, brief)).toBe(true);
    expect(copiesSeed({ ...draft, single_title: "Paper boats!" }, brief)).toBe(true);
    expect(copiesSeed({ ...draft, members: [{ name: "Rivet Row", role: "bass" }] }, brief)).toBe(true);
  });
  test("the prompt carries the feel, tells the model to avoid the song's names, and asks again on a retry", () => {
    const first = bandPrompt({ ...brief, tags: ["folk rock"] }, false).map((m) => m.content).join("\n");
    expect(first).toContain("folk rock");
    expect(first).toContain("Never reuse the song's title");
    expect(bandPrompt(brief, true)[0]!.content).toContain("completely different names");
  });
  test("a model answer is cut to the record's limits and an answer with no name is refused", () => {
    const raw = JSON.stringify({ name: " Clover Lane ", backstory: "x".repeat(5000), genres: ["folk", "folk", "dream"], members: [{ name: "Iris", role: "vocals" }, { name: "", role: "drums" }], style: "", portrait_prompt: "a band", logo_prompt: "a mark", single_title: "Slow River", single_lyrics: "[Verse]\nla" });
    const draft = parseDraft(raw)!;
    expect(draft.name).toBe("Clover Lane");
    expect(draft.backstory).toHaveLength(4000);
    expect(draft.genres).toEqual(["folk", "dream"]);
    expect(draft.members).toEqual([{ name: "Iris", role: "vocals" }]);
    expect(parseDraft(JSON.stringify({ name: "", single_title: "x" }))).toBeNull();
    expect(parseDraft("not json")).toBeNull();
  });
});

describe("the portrait and logo", () => {
  function band() {
    song(null);
    const made = createMade("made_artist", sage, { name: "Clover Lane", style: { description: "soft folk" }, seed: { media_id: "media-song000001" } });
    if (!made.ok) throw new Error("band not made");
    return made.value.id;
  }
  function picture(purpose: string | null, state = "done"): PictureJob {
    const file = storeFile(sage, { conversationId: null, turnId: null, mediaType: "image/png", bytes: new Uint8Array([state.length, 2, 3, purpose?.length ?? 0]), provenance: "test", deduplicate: false });
    if (!file.ok) throw new Error("file not stored");
    return { personId: sage.id, purpose, state, files: [{ id: file.value.id }] } as unknown as PictureJob;
  }
  const saved = (id: string) => JSON.parse(db.select().from(madeArtists).where(eq(madeArtists.id, id)).get()!.body) as { portrait_file_id?: string | null; logo_file_id?: string | null };
  test("a finished portrait or logo lands on its own band", () => {
    const id = band();
    const portrait = picture(`band:${id}:portrait`); const logo = picture(`band:${id}:logo`);
    finishBandPicture(portrait); finishBandPicture(logo);
    expect(saved(id).portrait_file_id).toBe(portrait.files[0]!.id);
    expect(saved(id).logo_file_id).toBe(logo.files[0]!.id);
  });
  test("a cover, an unfinished picture, a picture with no purpose or another band's name changes nothing", () => {
    const id = band();
    finishBandPicture(picture(`band:${id}:portrait`, "running"));
    finishBandPicture(picture("cover"));
    finishBandPicture(picture(null));
    finishBandPicture(picture("band:mband-nothere0000:portrait"));
    expect(saved(id).portrait_file_id ?? null).toBeNull();
  });
});

describe("who may make a band", () => {
  const state = (actor: PersonRow) => ({ actor, surface: "chat", conversationId: "conv-test", turnId: "turn-test", utterance: "", planBasis: { surfaceClass: "written" } }) as unknown as Parameters<typeof makeBand>[0]["state"];
  test("a child is told no band was made, and no band record is written", async () => {
    song(null);
    const result = await makeBand({ state: state(nova), mediaId: "media-song000001", callId: "call-1", spoken: false });
    expect(result).toEqual({ ok: false, line: BAND_NOT_HERE_LINE });
    expect(db.select().from(madeArtists).all()).toHaveLength(0);
  });
  test("a spoken turn makes no band", async () => {
    song(null);
    const result = await makeBand({ state: state(sage), mediaId: "media-song000001", callId: "call-1", spoken: true });
    expect(result.ok).toBe(false);
    expect(db.select().from(madeArtists).all()).toHaveLength(0);
  });
  test("the band record keeps the song it was made like, readable only by its owner", () => {
    song(null);
    const made = createMade("made_artist", sage, { name: "Clover Lane", style: { description: "soft folk" }, seed: { media_id: "media-song000001" } });
    expect(made.ok).toBe(true);
    if (made.ok) {
      expect((made.value.seed as { media_id: string }).media_id).toBe("media-song000001");
      expect(getMade("made_artist", nova, made.value.id).ok).toBe(false);
    }
  });
});

describe("the band card", () => {
  const brief = { title: "Paper Boats", artist: "Rivet Row", genre: "Folk", year: 1974, tags: [] };
  const draft = { name: "Clover Lane", backstory: "Two friends.", genres: ["folk"], members: [{ name: "Iris", role: "vocals" }], style: "soft", portrait_prompt: "a", logo_prompt: "b", single_title: "Slow River", single_lyrics: "la" };
  const where = { conversationId: "conv-test000001", turnId: "turn-test000001" };
  test("a file id survives the picture reference the block carries", () => {
    const ref = hubImageRef("file-abc123XYZ");
    expect(ref).toMatch(/^hubimg-[a-f0-9]{8,}$/);
    expect(fileIdOfHubImage(ref)).toBe("file-abc123XYZ");
    expect(fileIdOfHubImage("https://example.com/x.png")).toBeNull();
  });
  test("the block is a band with at most four unique actions, its pictures by reference, and the band and turn in its provenance", () => {
    const block = bandBlock("mband-test0000001", where, brief, draft as never, { portrait: "file-portrait1" }) as { kind: string; provenance: string; props: Record<string, unknown> };
    expect(block.kind).toBe("band");
    expect(block.provenance).toBe(bandProvenance("mband-test0000001", where));
    const actions = block.props.actions as string[];
    expect(actions.length).toBeLessThanOrEqual(4);
    expect(new Set(actions).size).toBe(actions.length);
    expect(actions).not.toContain("make_album");
    expect(block.props.logo).toBeUndefined();
    expect(fileIdOfHubImage((block.props.portrait as { src: string }).src)).toBe("file-portrait1");
    expect(block.props.inspiredBy).toBe("Paper Boats by Rivet Row");
  });
});

describe("the band actions", () => {
  function band(owner: PersonRow = sage) {
    song(null);
    const made = createMade("made_artist", owner, { name: "Clover Lane", style: { description: "soft folk" }, seed: { media_id: "media-song000001" } });
    if (!made.ok) throw new Error("band not made");
    return made.value.id;
  }
  test("every action name is known", () => {
    expect([...BAND_ACTION_NAMES]).toEqual(["keep", "remake", "remake_portrait", "remake_logo", "discard"]);
  });
  test("a missing band is 404 and another person's band is 404 for them, not a leak", async () => {
    expect(await runBandAction(sage, "mband-nothere0000", "keep")).toMatchObject({ ok: false, status: 404 });
    const id = band();
    expect(await runBandAction(nova, id, "discard")).toMatchObject({ ok: false, status: 404 });
    expect(db.select().from(madeArtists).all()).toHaveLength(1);
  });
  test("keep with no finished single is pending, not an error", async () => {
    const id = band();
    expect(await runBandAction(sage, id, "keep")).toMatchObject({ ok: true, value: { action: "keep", pending: true } });
  });
  test("remake removes the band and names the song to start again from; discard removes it", async () => {
    const first = band();
    expect(await runBandAction(sage, first, "remake")).toMatchObject({ ok: true, value: { seedMediaId: "media-song000001" } });
    expect(getMade("made_artist", sage, first).ok).toBe(false);
    db.delete(mediaItems).run();
    const second = band();
    expect(await runBandAction(sage, second, "discard")).toMatchObject({ ok: true });
    expect(getMade("made_artist", sage, second).ok).toBe(false);
    expect(deleteMade("made_artist", sage, second).ok).toBe(false);
  });
  test("a new picture needs the chat the band was made in", async () => {
    const id = band();
    expect(await runBandAction(sage, id, "remake_portrait")).toMatchObject({ ok: false, status: 400 });
    expect(await runBandAction(sage, id, "remake_logo", { conversationId: "conv-nothere0000", turnId: "turn-nothere0000" })).toMatchObject({ ok: false, status: 400 });
  });
});
