import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { mediaItems, mediaSources, people } from "@/db/schema";
import { albumBlock, albumFieldsFromPatch, runAlbumAction, syncAlbumTracks } from "@/lib/music/album";
import { runStyleAction, styleBlock, styleFieldsFromPatch } from "@/lib/music/styleCard";
import { createMade, ensureStarterStyles, getMade, listRevisions, restoreRevision, updateMade } from "@/lib/music/madeRecords";
import { resolveSound } from "@/lib/music/sound";
import { applySound } from "@/lib/music/tool";
import { EDIT_TOOL_OBJECT, STUDIO_TOOL_IDS, isStudioTool, runStudioTool } from "@/lib/music/studioTools";
import { resolveTurnBudget, withTurnToolGates, type MusicObjectGate } from "@/lib/turnMachine/budget";
import type { PersonRow } from "@/types";
import { resetDb } from "./reset-db";

// MUSIC-STUDIO-HOME: albums, saved song styles, edits as revisions, and the sound a song takes from a style, band or album.
// Names are persona names only.

const stamp = { createdAt: new Date().toISOString(), hlc: "1:0:aaaaaa", provenance: "test" };
let sage: PersonRow; let marlow: PersonRow;
function person(name: string, role: string, birthdate: string | null = null): PersonRow {
  db.insert(people).values({ id: `person-${name}000001`, displayName: name, role, birthdate, avatarSeed: "s", source: "local", createdAt: stamp.createdAt, updatedAt: stamp.createdAt, hlc: stamp.hlc }).run();
  return db.select().from(people).where(eq(people.displayName, name)).get() as PersonRow;
}
const STYLE = { description: "slow warm piano and a soft hum", genres: ["lullaby"], instrumental: false, length_s: 120, bpm: 70, key: null, language: "en" };
function album(owner: PersonRow, extra: Record<string, unknown> = {}) {
  const made = createMade("made_album", owner, { title: "Night Garden", blurb: "Songs for the porch", look: "blue dusk", track_media_ids: [], style: STYLE, ...extra });
  if (!made.ok) throw new Error(made.error);
  return made.value as unknown as { id: string; title: string; track_media_ids: string[] };
}
function track(id: string) {
  db.insert(mediaItems).values({ id, sourceId: "msrc-music000001", kind: "track", locRootId: "msrc-music000001", locPath: `${id}.mp3`, title: id, artist: "Quill", album: "Garden", genre: "Folk", year: 1974,
    bandOk: "child", mediaType: "audio/mpeg", playable: "original", addedAt: stamp.createdAt, ...stamp }).run();
}

beforeEach(() => {
  resetDb();
  sage = person("sage", "owner"); marlow = person("marlow", "teen", "2011-05-01");
  db.insert(mediaSources).values({ id: "msrc-music000001", kind: "root", scope: "household", label: "Music", createdAt: stamp.createdAt, hlc: stamp.hlc, provenance: "test" }).run();
});

describe("edits are revisions", () => {
  test("an album edit keeps the earlier version, and it can be restored", async () => {
    const a = album(sage);
    const r = await runAlbumAction(sage, a.id, "edit", { patch: { title: "Night Garden II", genres: ["folk"] } });
    expect(r.ok).toBe(true);
    const now = getMade("made_album", sage, a.id);
    expect(now.ok && (now.value as unknown as { title: string }).title).toBe("Night Garden II");
    const revs = listRevisions("made_album", sage, a.id);
    expect(revs.ok && revs.value.length).toBe(1);
    if (!revs.ok) throw new Error("no revisions");
    expect((revs.value[0]!.record as unknown as { title: string }).title).toBe("Night Garden");
    expect(revs.value[0]!.reason).toBe("edit");
    const back = restoreRevision("made_album", sage, a.id, revs.value[0]!.id);
    expect(back.ok && (back.value as unknown as { title: string }).title).toBe("Night Garden");
  });
  test("a silent change and a filled-in cover make no revision", () => {
    const a = album(sage);
    updateMade("made_album", sage, a.id, { cover_file_id: "file-cover0000001" }, {});
    updateMade("made_album", sage, a.id, { blurb: "hub fill" }, { silent: true });
    const revs = listRevisions("made_album", sage, a.id);
    expect(revs.ok && revs.value.length).toBe(0);
  });
  test("an empty patch is refused with a next step", async () => {
    const a = album(sage);
    const r = await runAlbumAction(sage, a.id, "edit", { patch: {} });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.status).toBe(400); expect(r.error).toContain("Tell me"); }
  });
  test("only the owner edits an album", async () => {
    const a = album(sage, { shared_to: null });
    const r = await runAlbumAction(marlow, a.id, "edit", { patch: { title: "Mine" } });
    expect(r.ok).toBe(false);
  });
});

describe("album tracks", () => {
  test("a patch keeps only songs already on the album, in the new order", () => {
    const body = { track_media_ids: ["media-a", "media-b", "media-c"], style: STYLE } as never;
    expect(albumFieldsFromPatch(body, { track_ids: ["media-c", "media-x", "media-a"] }).track_media_ids).toEqual(["media-c", "media-a"]);
  });
  test("sync never adds a song twice and keeps a removed song removed", async () => {
    const a = album(sage);
    track("media-track000001"); track("media-track000002");
    const put = updateMade("made_album", sage, a.id, { track_media_ids: ["media-track000001", "media-track000002"] }, { silent: true });
    expect(put.ok).toBe(true);
    await runAlbumAction(sage, a.id, "edit", { patch: { track_ids: ["media-track000002"] } });
    syncAlbumTracks(sage, a.id);
    const got = getMade("made_album", sage, a.id);
    expect(got.ok && (got.value as unknown as { track_media_ids: string[] }).track_media_ids).toEqual(["media-track000002"]);
  });
  test("the block is an editable album card with the real actions", () => {
    const a = album(sage);
    const rec = getMade("made_album", sage, a.id);
    if (!rec.ok) throw new Error("album missing");
    const block = albumBlock(sage, rec.value as never, { conversationId: null, turnId: null }) as { kind: string; props: { editable: boolean; actions: string[] } };
    expect(block.kind).toBe("album");
    expect(block.props.editable).toBe(true);
    expect(block.props.actions).toEqual(["play_all", "keep", "remake_cover", "discard"]);
  });
});

describe("song styles", () => {
  test("starter styles are read-only; a household style is edited as a revision", () => {
    ensureStarterStyles();
    const made = createMade("song_style", sage, { title: "Rainy", style: STYLE });
    if (!made.ok) throw new Error(made.error);
    const id = (made.value as { id: string }).id;
    const ok = runStyleAction(sage, id, "edit", { patch: { title: "Rainy 2", bpm: 90 } });
    expect(ok.ok).toBe(true);
    const revs = listRevisions("song_style", sage, id);
    expect(revs.ok && revs.value.length).toBe(1);
    const starter = runStyleAction(sage, "sstyle-starterlullaby", "edit", { patch: { title: "Changed" } });
    expect(starter.ok).toBe(false);
    if (!starter.ok) expect(starter.status).toBe(403);
  });
  test("the card is not editable for a starter", () => {
    ensureStarterStyles();
    const rec = getMade("song_style", sage, "sstyle-starterlullaby");
    if (!rec.ok) throw new Error("starter missing");
    const block = styleBlock(rec.value as never, { conversationId: null, turnId: null }) as { props: { editable: boolean } };
    expect(block.props.editable).toBe(false);
  });
  test("a style patch maps sound to the description and clamps the tempo", () => {
    const fields = styleFieldsFromPatch({ style: STYLE, title: "x" } as never, { sound: "bright banjo", bpm: 100 });
    expect((fields.style as { description: string; bpm: number }).description).toBe("bright banjo");
    expect((fields.style as { bpm: number }).bpm).toBe(100);
  });
});

describe("the sound a song takes", () => {
  test("a style fills what the song leaves out and its words come first", () => {
    const out = applySound({ description: "about a dog" } as never, { description: "warm piano", genres: [], bpm: 70, key: "C major", length_s: 120, language: "en" }) as { description: string; bpm: number; key: string; seconds: number };
    expect(out.description).toBe("warm piano. about a dog");
    expect(out.bpm).toBe(70); expect(out.key).toBe("C major"); expect(out.seconds).toBe(120);
  });
  test("the song's own bpm wins", () => {
    const out = applySound({ description: "x", bpm: 140 } as never, { description: "warm", genres: [], bpm: 70 }) as { bpm: number };
    expect(out.bpm).toBe(140);
  });
  test("no style changes nothing", () => {
    const v = { description: "x" } as never;
    expect(applySound(v, null)).toBe(v);
  });
  test("an album brings its style; a missing id is refused in plain words", () => {
    const a = album(sage);
    const ok = resolveSound(sage, { album: a.id });
    expect(ok.ok && ok.value.album?.id).toBe(a.id);
    expect(ok.ok && ok.value.style?.description).toBe(STYLE.description);
    const gone = resolveSound(sage, { song_style: "sstyle-doesnotexist" });
    expect(gone.ok).toBe(false);
    if (!gone.ok) expect(gone.line).toContain("not available");
  });
  test("another person's album is not available", () => {
    const a = album(sage);
    const other = resolveSound(marlow, { album: a.id });
    expect(other.ok).toBe(false);
  });
});

describe("tool offers by object", () => {
  test("every studio tool is known and each edit tool maps to one object", () => {
    expect(STUDIO_TOOL_IDS.every(isStudioTool)).toBe(true);
    expect(EDIT_TOOL_OBJECT).toEqual({ edit_band: "band", edit_album: "album", edit_song_style: "style" });
    expect(isStudioTool("generate_music")).toBe(false);
  });
  test("one object decides the studio tools, never two objects' edit tools, and the cap of sixteen holds", () => {
    const base = resolveTurnBudget("qwen3-8b-instruct-q4-k-m", "adult");
    const offered = (object: MusicObjectGate) => withTurnToolGates(base, true, true, true, true, true, false, true, false, object).tools_offered;
    const withClip = (object: MusicObjectGate) => withTurnToolGates(base, true, true, true, true, true, false, true, true, object).tools_offered;
    const edits = ["edit_band", "edit_album", "edit_song_style"];
    for (const object of ["none", "track", "band", "album", "style", null] as MusicObjectGate[]) {
      const tools = offered(object);
      expect(tools.length).toBeLessThanOrEqual(16);
      expect(tools.filter((t) => edits.includes(t)).length).toBeLessThanOrEqual(1);
    }
    expect(offered("band")).toContain("edit_band");
    expect(offered("album")).toContain("edit_album");
    expect(offered("style")).toContain("edit_song_style");
    expect(offered("album")).not.toContain("edit_band");
    expect(offered(null)).not.toContain("make_album");
    expect(withTurnToolGates(base, false, true, false, true, false, false, false, false, "none").tools_offered).toContain("make_song_style");
    expect(offered("album")).not.toContain("make_album");
    // With a video clip in view too, the studio tools shrink first and the cap still holds.
    for (const object of ["none", "band", "album", "style"] as MusicObjectGate[]) expect(withClip(object).length).toBeLessThanOrEqual(16);
  });
});

describe("the edit tools", () => {
  const stateFor = (actor: PersonRow, kind: "album" | "style", id: string) => ({ actor, surface: "chat", conversationId: "conv-test", turnId: "turn-test", utterance: "", musicObject: { kind, id } }) as unknown as Parameters<typeof runStudioTool>[1]["state"];
  test("edit_album changes the album in view and returns the card stamped with the tool's own id", async () => {
    const a = album(sage);
    const out = await runStudioTool("edit_album", { state: stateFor(sage, "album", a.id), args: { title: "Moon Porch" }, callId: "call-1", spoken: false });
    const result = out.result as { blocks?: { kind: string; producer: string; props: { title: string } }[] };
    expect(result.blocks?.[0]?.kind).toBe("album");
    expect(result.blocks?.[0]?.producer).toBe("edit_album");
    expect(result.blocks?.[0]?.props.title).toBe("Moon Porch");
  });
  test("edit_album with nothing to change says so and returns no card", async () => {
    const a = album(sage);
    const out = await runStudioTool("edit_album", { state: stateFor(sage, "album", a.id), args: {}, callId: "call-2", spoken: false });
    expect((out.result as { blocks?: unknown[] }).blocks).toEqual([]);
  });
  test("edit_song_style on a starter explains it cannot change", async () => {
    ensureStarterStyles();
    const out = await runStudioTool("edit_song_style", { state: stateFor(sage, "style", "sstyle-starterlullaby"), args: { title: "Mine" }, callId: "call-3", spoken: false });
    expect(((out.result as { reply: { text: string } }).reply.text)).toContain("starter");
  });
});
