// MUSIC-STUDIO-ALBUM: `make_album`, a made album: a title, a cover, a short blurb and a list of songs, optionally by a made band
// and in a saved song style. The cover and the first song go through the existing picture and song jobs; each is optional, so a
// failed one never fails the album or the answer. More songs are made with generate_music (`album` argument) and join the album when
// they finish (syncAlbumTracks). Adults only on a written screen, like make_band. Rule 6a: a title, a blurb, the look words and the
// style words are a person's words. Nothing here logs any of them or an id.
import { and, desc, eq, like } from "drizzle-orm";
import { db } from "@/db";
import { mediaItems, musicJobs, people } from "@/db/schema";
import { complete, type LlmMessage } from "@/lib/llm";
import { visibleText } from "@/lib/wellFormed";
import { nextHlc } from "@/lib/hlc";
import { readableItem } from "@/lib/media/access";
import { promoteMadeMusicFile } from "@/lib/media/appHost";
import { routeAudience } from "@/lib/pictures/audience";
import { laneOf } from "@/lib/pictures/lane";
import { adultStylesAllowed, pictureDenial, refusePrompt } from "@/lib/pictures/policy";
import { QUICK_MODEL } from "@/lib/pictures/quality";
import { pictureEngineReady } from "@/lib/pictures/ready";
import { startPictureJob, type PictureJob } from "@/lib/pictures/jobs";
import { outcomeOf } from "@/lib/turnContext";
import type { ToolExecutionOutcome } from "@/lib/turnMachine/contract";
import type { PersonRow } from "@/types";
import { blockEnvelope } from "@/lib/packageBlocks";
import { hubImageRef, type BandState } from "./band";
import { createMade, deleteMade, getMade, updateMade } from "./madeRecords";
import { musicDenial } from "./policy";
import { resolveSound, type SoundStyle } from "./sound";
import { musicAudienceOf, runGenerateMusic } from "./tool";
import type { Result } from "@/lib/result";

export const MAKE_ALBUM_TOOL_ID = "make_album";
export const EDIT_ALBUM_TOOL_ID = "edit_album";

export const ALBUM_NOT_HERE_LINE = "No album was made. Tell the person this needs an adult on their own screen. Offer to describe an album in words instead.";
export const ALBUM_MODEL_LINE = "No album was made, because the writing model did not answer. Tell the person to try again in a minute.";
export const ALBUM_GONE_LINE = "That album is not here any more. Tell the person it may have been discarded.";

export interface AlbumDraft { title: string; blurb: string; look: string; cover_prompt: string; sound: string; genres: string[]; tracks: string[]; first_lyrics: string }

const ALBUM_SCHEMA = {
  name: "album",
  strict: true,
  schema: {
    type: "object", additionalProperties: false,
    required: ["title", "blurb", "look", "cover_prompt", "sound", "genres", "tracks", "first_lyrics"],
    properties: {
      title: { type: "string" }, blurb: { type: "string" }, look: { type: "string" }, cover_prompt: { type: "string" }, sound: { type: "string" },
      genres: { type: "array", items: { type: "string" } }, tracks: { type: "array", items: { type: "string" } }, first_lyrics: { type: "string" },
    },
  },
} as const;

export interface AlbumBrief { idea: string; band: { name: string; backstory: string; sound: string } | null; style: SoundStyle | null }

export function albumPrompt(brief: AlbumBrief): LlmMessage[] {
  return [
    { role: "system", content: "You plan a new album for a family music app. Reply with JSON only. title: the album title. blurb: 2 to 3 plain sentences about it. "
      + "look: one line describing the cover art. cover_prompt: a picture prompt for the cover, no text or letters. sound: one line of sound words for a song engine (genre, mood, instruments, era), no lyrics. "
      + "genres: up to 5 short words. tracks: 4 to 8 new song titles in album order. first_lyrics: a short first song with [Verse] and [Chorus] tags. "
      + "If a band or a style is given, keep to its sound. Everything is new and made up." },
    { role: "user", content: JSON.stringify({ idea: brief.idea || "any", band: brief.band, style: brief.style?.description ?? null }) },
  ];
}

export function parseAlbumDraft(text: string): AlbumDraft | null {
  try {
    const raw = JSON.parse(visibleText(text)) as Partial<Record<keyof AlbumDraft, unknown>>;
    const title = String(raw.title ?? "").trim().slice(0, 120);
    const tracks = (Array.isArray(raw.tracks) ? raw.tracks : []).map((t) => String(t).trim().slice(0, 120)).filter(Boolean).slice(0, 12);
    if (!title || tracks.length === 0) return null;
    return {
      title, blurb: String(raw.blurb ?? "").trim().slice(0, 1000), look: String(raw.look ?? "").trim().slice(0, 1000),
      cover_prompt: String(raw.cover_prompt ?? "").trim().slice(0, 500), sound: String(raw.sound ?? "").trim().slice(0, 1000) || "original songs",
      genres: [...new Set((Array.isArray(raw.genres) ? raw.genres : []).map((g) => String(g).trim().slice(0, 40)).filter(Boolean))].slice(0, 5),
      tracks, first_lyrics: String(raw.first_lyrics ?? "").trim().slice(0, 3500),
    };
  } catch { return null; }
}

async function draftAlbum(brief: AlbumBrief): Promise<AlbumDraft | null> {
  const result = await complete("chat", albumPrompt(brief), { temperature: 0.9, response_format: { type: "json_schema", json_schema: ALBUM_SCHEMA } });
  return result.ok ? parseAlbumDraft(result.value.text) : null;
}

const PURPOSE = /^album:(malbum-[a-z0-9]+):cover$/;

/** Uses a finished cover for its album; any other picture is ignored, and a failure here never changes the picture. */
export function finishAlbumPicture(picture: PictureJob): void {
  if (picture.state !== "done" || !picture.files[0] || !picture.purpose) return;
  const match = PURPOSE.exec(picture.purpose);
  if (!match) return;
  const owner = db.select().from(people).where(and(eq(people.id, picture.personId))).get();
  if (!owner) return;
  const album = getMade("made_album", owner as unknown as PersonRow, match[1]!);
  if (album.ok && (album.value as unknown as { cover_file_id?: string | null }).cover_file_id === picture.files[0].id) return;
  updateMade("made_album", owner as unknown as PersonRow, match[1]!, { cover_file_id: picture.files[0].id });
}

export type AlbumCoverStart = { ok: true } | { ok: false; error: string };
export const NO_PICTURE_ENGINE_LINE = "There is no picture engine set up, so no cover can be made. Add one in Settings under AI and models, then try again.";

/** Starts the album's cover. It says why when it could not, so a button can tell the person; a cover still never fails the album. */
export async function startAlbumCover(state: { conversationId: string | null; turnId: string | null }, actor: PersonRow, albumId: string, prompt: string): Promise<AlbumCoverStart> {
  try {
    const audience = routeAudience(actor);
    const full = `${prompt} Album cover art, square, no text, no letters.`.slice(0, 578);
    if (!prompt) return { ok: false, error: "There is no look to draw a cover from. Edit the album's look, then try again." };
    if (pictureDenial(audience)) return { ok: false, error: "Pictures are not available for this person." };
    if (refusePrompt(full, { lane: laneOf(audience) })) return { ok: false, error: "That cover idea is not allowed. Change the album's look and try again." };
    if (!(await pictureEngineReady())) return { ok: false, error: NO_PICTURE_ENGINE_LINE };
    const picture = await startPictureJob({ actor, conversationId: state.conversationId, turnId: state.turnId, temporary: false,
      purpose: `album:${albumId}:cover`, kind: "generate", prompt: full,
      body: { prompt: full, model: QUICK_MODEL, size: "1024x1024", n: 1, seed: Math.floor(Math.random() * 2147483647), audience: adultStylesAllowed() ? "adult" : "all-ages" } });
    finishAlbumPicture(picture);
    return { ok: true };
  } catch { return { ok: false, error: "The cover could not be started. Try again in a minute." }; }
}

/** `make_album:<album id>:<conversation id>:<turn id>`. The album id is what the card's buttons send back; the other two are where a new cover is filed. */
export const albumProvenance = (albumId: string, where: { conversationId: string | null; turnId: string | null }): string => `make_album:${albumId}:${where.conversationId ?? "-"}:${where.turnId ?? "-"}`;
const ALBUM_ACTIONS = ["play_all", "keep", "remake_cover", "discard"] as const;

type AlbumBody = { id: string; title: string; blurb?: string | null; look?: string | null; cover_file_id?: string | null; made_artist_id?: string | null; song_style_id?: string | null;
  track_media_ids?: string[]; style?: SoundStyle; owner_person_id?: string | null };

/** The album's chat card, built from the saved record (so an edit and a new card agree). */
export function albumBlock(actor: PersonRow, album: AlbumBody, where: { conversationId: string | null; turnId: string | null }): Record<string, unknown> {
  const tracks = (album.track_media_ids ?? []).flatMap((id) => {
    const item = readableItem(actor, id);
    return item ? [{ media_id: id, title: item.title.slice(0, 120), ...(item.duration_s ? { length_s: Math.round(item.duration_s) } : {}) }] : [];
  });
  const band = album.made_artist_id ? getMade("made_artist", actor, album.made_artist_id) : null;
  const props: Record<string, unknown> = { title: album.title, genres: album.style?.genres ?? [], tracks, editable: true, actions: [...ALBUM_ACTIONS], sound: album.style?.description ?? "", look: album.look ?? "" };
  if (album.blurb) props.blurb = album.blurb;
  if (band?.ok) props.artist = (band.value as unknown as { name: string }).name;
  if (album.cover_file_id) props.cover = { src: hubImageRef(album.cover_file_id), alt: `Cover of the album ${album.title}` };
  return blockEnvelope("album", MAKE_ALBUM_TOOL_ID, `The album ${album.title}, with ${tracks.length} ${tracks.length === 1 ? "song" : "songs"} so far.`, albumProvenance(album.id, where), props);
}

/** The finished songs made for an album, oldest first. The query names the album, so it reads only that album's songs (newest 100) and never every finished song. */
function albumJobs(personId: string, albumId: string): Array<{ fileId: string }> {
  if (!/^malbum-[a-z0-9]+$/.test(albumId)) return [];
  const rows = db.select({ fileId: musicJobs.fileId, request: musicJobs.request }).from(musicJobs)
    .where(and(eq(musicJobs.personId, personId), eq(musicJobs.state, "done"), like(musicJobs.request, `%"album":{"id":"${albumId}"%`)))
    .orderBy(desc(musicJobs.createdAt)).limit(100).all();
  const out: Array<{ fileId: string }> = [];
  for (const row of rows) {
    if (!row.fileId) continue;
    try { if ((JSON.parse(row.request) as { album?: { id?: string } }).album?.id === albumId) out.push({ fileId: row.fileId }); } catch { /* A job row that does not parse belongs to no album. */ }
  }
  return out.reverse();
}

/** Songs finished for this album join its list (oldest first). A song already in the library is never added again, so one the person
 * removed from the album stays out. Only the album's owner's own songs join. Silent: a song joining is not an edit. */
export function syncAlbumTracks(actor: PersonRow, albumId: string): void {
  const found = getMade("made_album", actor, albumId);
  if (!found.ok) return;
  const album = found.value as unknown as AlbumBody;
  if (album.owner_person_id !== actor.id) return;
  const added: string[] = [];
  for (const job of albumJobs(actor.id, albumId)) {
    // A song saved or played before the album read it has an item already; it joins while it names no album, and one the person removed keeps its album name and stays out.
    const existing = db.select().from(mediaItems).where(eq(mediaItems.locFileId, job.fileId)).get();
    if (existing && existing.album) continue;
    const item = existing ?? promoteMadeMusicFile(actor, job.fileId);
    if (!item) continue;
    db.update(mediaItems).set({ album: album.title, trackNo: (album.track_media_ids?.length ?? 0) + added.length + 1, hlc: nextHlc() }).where(eq(mediaItems.id, item.id)).run();
    added.push(item.id);
  }
  if (added.length) updateMade("made_album", actor, albumId, { track_media_ids: [...(album.track_media_ids ?? []), ...added] }, { silent: true });
}

export type AlbumResult = { ok: true; albumId: string; musicJobId: string | null; line: string; block: Record<string, unknown> } | { ok: false; line: string };

/** Makes the album, then starts its cover and first song. Only the album record itself can fail this call. */
export async function makeAlbum(input: { state: BandState; idea: string; bandId?: string; styleId?: string; callId: string; spoken: boolean }): Promise<AlbumResult> {
  const { state } = input;
  const actor = state.actor as PersonRow;
  if (musicDenial(musicAudienceOf(state, input.spoken)) || pictureDenial({ ...routeAudience(actor), spoken: input.spoken })) return { ok: false, line: ALBUM_NOT_HERE_LINE };
  const sound = resolveSound(actor, { band: input.bandId, song_style: input.styleId });
  if (!sound.ok) return { ok: false, line: sound.line };
  const bandRecord = sound.value.band ? getMade("made_artist", actor, sound.value.band.id) : null;
  const band = bandRecord?.ok ? bandRecord.value as unknown as { name: string; backstory?: string; style?: SoundStyle } : null;
  const draft = await draftAlbum({ idea: input.idea.slice(0, 500), style: sound.value.style,
    band: band ? { name: band.name, backstory: (band.backstory ?? "").slice(0, 600), sound: band.style?.description ?? "" } : null });
  if (!draft) return { ok: false, line: ALBUM_MODEL_LINE };
  const styleWords = sound.value.style ? `${sound.value.style.description}. ${draft.sound}`.slice(0, 1000) : draft.sound;
  const made = createMade("made_album", actor, {
    title: draft.title, blurb: draft.blurb, look: draft.look, made_artist_id: sound.value.band?.id ?? null, song_style_id: input.styleId ?? null,
    style: { description: styleWords, genres: draft.genres }, track_media_ids: [],
  });
  if (!made.ok) return { ok: false, line: ALBUM_MODEL_LINE };
  const albumId = made.value.id;
  // The cover runs beside the first song, so neither waits for the other; a cover that cannot start leaves the album as it is.
  const cover = startAlbumCover(state, actor, albumId, draft.cover_prompt || draft.look);
  let first = false; let musicJobId: string | null = null;
  try {
    const outcome = await runGenerateMusic({ state, callId: input.callId, spoken: input.spoken, album: { id: albumId }, ...(sound.value.band ? { band: sound.value.band } : {}),
      args: { description: `${styleWords}. Album ${draft.title}.`, lyrics: draft.first_lyrics || undefined, title: draft.tracks[0] } });
    first = outcome.status === "succeeded";
    musicJobId = (outcome.result?.data as { musicJobId?: string } | undefined)?.musicJobId ?? null;
  } catch { first = false; }
  await cover;
  const saved = getMade("made_album", actor, albumId);
  const block = albumBlock(actor, saved.ok ? saved.value as unknown as AlbumBody : { id: albumId, title: draft.title }, state);
  const plan = draft.tracks.map((t, i) => `${i + 1}. ${t}`).join("; ");
  return { ok: true, albumId, musicJobId, block, line: `The album is made and saved in Music under Albums. Planned songs: ${plan}.${first ? " The first song is being made now." : " The first song could not start, so offer to try it again."} The cover appears on the card when ready. Offer to make the next songs for this album with generate_music, naming the album.` };
}

/** The turn's runner for `make_album`: the policy node has already checked the offer and the band or style id. */
export async function runMakeAlbum(input: { state: BandState; args: Record<string, unknown>; callId: string; spoken: boolean }): Promise<ToolExecutionOutcome> {
  const { state, args, callId } = input;
  const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  const made = await makeAlbum({ state, idea: str(args.idea) ?? "", bandId: str(args.band), styleId: str(args.song_style), callId, spoken: input.spoken });
  if (!made.ok) return outcomeOf({ callId, packageId: MAKE_ALBUM_TOOL_ID, status: "succeeded", via: "tool_call", args, durationMs: 0, result: { reply: { text: made.line }, actions: [] } });
  return outcomeOf({ callId, packageId: MAKE_ALBUM_TOOL_ID, status: "succeeded", via: "tool_call", args, durationMs: 0, result: { reply: { text: made.line }, data: { albumId: made.albumId, ...(made.musicJobId ? { musicJobId: made.musicJobId } : {}) }, blocks: [made.block], actions: [] } as NonNullable<ToolExecutionOutcome["result"]> });
}

// ---- Actions: the card's buttons, the Music app's album page and the edit_album tool all go through here.

export const ALBUM_ACTION_NAMES = ["keep", "remake_cover", "discard", "edit", "play_all"] as const;
export type AlbumActionName = (typeof ALBUM_ACTION_NAMES)[number];
export interface AlbumPatchInput { title?: string; blurb?: string; look?: string; sound?: string; genres?: string[]; track_ids?: string[] }
export type AlbumActionResult = Result<{ action: AlbumActionName; done: string; album?: Record<string, unknown>; media_id?: string | null }, 400 | 403 | 404 | 503>;

/** The record fields a card edit changes. `sound` and `genres` live in the album's style; the track list keeps only ids already on it (a removed song stays in the library). */
export function albumFieldsFromPatch(album: AlbumBody, patch: AlbumPatchInput): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  if (typeof patch.title === "string") fields.title = patch.title.trim();
  if (typeof patch.blurb === "string") fields.blurb = patch.blurb;
  if (typeof patch.look === "string") fields.look = patch.look;
  if (patch.sound !== undefined || patch.genres !== undefined) {
    fields.style = { ...(album.style ?? { description: patch.sound ?? "original songs" }), ...(patch.sound !== undefined ? { description: patch.sound.trim() || "original songs" } : {}), ...(patch.genres !== undefined ? { genres: patch.genres.slice(0, 8) } : {}) };
  }
  if (patch.track_ids) {
    const have = new Set(album.track_media_ids ?? []);
    fields.track_media_ids = [...new Set(patch.track_ids.filter((id) => have.has(id)))];
  }
  return fields;
}

export async function runAlbumAction(actor: PersonRow, albumId: string, action: AlbumActionName, opts: { patch?: AlbumPatchInput; conversationId?: string | null; turnId?: string | null } = {}): Promise<AlbumActionResult> {
  syncAlbumTracks(actor, albumId);
  const found = getMade("made_album", actor, albumId);
  if (!found.ok) return { ok: false, status: 404, error: "That album is not here any more. It may have been discarded." };
  const album = found.value as unknown as AlbumBody;
  if (album.owner_person_id !== actor.id) return { ok: false, status: 403, error: "Only the person who made the album can do that. Ask them." };
  const where = { conversationId: opts.conversationId ?? null, turnId: opts.turnId ?? null };
  const view = (rec: unknown) => albumBlock(actor, rec as AlbumBody, where);
  if (action === "keep" || action === "play_all") {
    const first = album.track_media_ids?.[0] ?? null;
    return { ok: true, value: { action, media_id: first, album: view(album), done: first ? "Kept. The album is in Music under Albums." : "Kept. Its first song is still being made; it joins the album when it finishes." } };
  }
  if (action === "discard") {
    const gone = deleteMade("made_album", actor, albumId);
    return gone.ok ? { ok: true, value: { action, done: "Discarded. The album is gone. Its songs stay in your library." } } : { ok: false, status: gone.status as 403 | 404, error: gone.error };
  }
  if (action === "remake_cover") {
    if (!opts.turnId || !opts.conversationId) return { ok: false, status: 400, error: "A new cover can only be made from the chat where the album was made. Open that chat and try again." };
    const started = await startAlbumCover({ conversationId: opts.conversationId, turnId: opts.turnId }, actor, albumId, album.look || `Cover art for an album called ${album.title}, ${(album.style?.genres ?? []).slice(0, 3).join(", ")}`);
    if (!started.ok) return { ok: false, status: started.error === NO_PICTURE_ENGINE_LINE ? 503 : 400, error: started.error };
    return { ok: true, value: { action, done: "Making a new cover. It shows here when it is ready.", album: view(album) } };
  }
  // edit: a revision with provenance, never a silent overwrite.
  const fields = albumFieldsFromPatch(album, opts.patch ?? {});
  if (Object.keys(fields).length === 0) return { ok: false, status: 400, error: "There was nothing to change. Tell me what to change about the album." };
  const saved = updateMade("made_album", actor, albumId, fields);
  if (!saved.ok) return { ok: false, status: saved.status, error: saved.error };
  return { ok: true, value: { action, done: "Changed. The earlier version is kept.", album: view(saved.value) } };
}

