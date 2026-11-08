// MUSIC-LIKE-01: `make_band`, a made band "like" a song the person holds. The song only supplies a short brief (its genre, year and
// mood words, plus its artist's public genre tags when MusicBrainz knows it); the band is a new fictional act. Its name, members,
// back story, single title and words are never a copy of the song's (a "like this" is an instruction, not a copy), and nothing
// here refuses an adult's brief over a name or a likeness. The portrait, the logo and the first single go through the existing
// picture and song jobs; each is optional, so a failed one never fails the band or the answer.
// Rule 6a: a title, a band name, a back story and the style words are a person's words. Nothing here logs any of them or an id.
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { people } from "@/db/schema";
import { complete, type LlmMessage } from "@/lib/llm";
import { visibleText } from "@/lib/wellFormed";
import { matchingEnabled, sameName, sharedMusicBrainzClient } from "@/lib/media/musicbrainzMatch";
import { readableItem } from "@/lib/media/access";
import { routeAudience } from "@/lib/pictures/audience";
import { laneOf } from "@/lib/pictures/lane";
import { adultStylesAllowed, pictureDenial, refusePrompt } from "@/lib/pictures/policy";
import { QUICK_MODEL } from "@/lib/pictures/quality";
import { pictureEngineReady } from "@/lib/pictures/ready";
import { startPictureJob, type PictureJob } from "@/lib/pictures/jobs";
import { itemRefsIn } from "@/lib/items/tool";
import { outcomeOf } from "@/lib/turnContext";
import type { ToolExecutionOutcome, TurnState } from "@/lib/turnMachine/contract";
import type { PersonRow } from "@/types";
import { blockEnvelope } from "@/lib/packageBlocks";
import { createMade, getMade, updateMade } from "./madeRecords";
import { musicDenial } from "./policy";
import { musicAudienceOf, runGenerateMusic } from "./tool";

export const MAKE_BAND_TOOL_ID = "make_band";

/** What the model is told when the band cannot be made; plain words, never the person's own text. */
export const BAND_NOT_HERE_LINE = "No band was made. Tell the person this needs an adult on their own screen and a song they hold in Music. Offer to describe a band in words instead.";
export const BAND_MODEL_LINE = "No band was made, because the writing model did not answer. Tell the person to try Create a band like this again in a minute.";

export interface BandBrief { title: string; artist: string | null; genre: string | null; year: number | null; tags: string[] }

/** The seed's own words become a short brief. MusicBrainz genre tags are asked once, only for a matched artist and only when matching is on. */
export async function briefFor(actor: PersonRow, mediaId: string): Promise<BandBrief | null> {
  const item = readableItem(actor, mediaId);
  if (!item || item.kind !== "track") return null;
  let tags: string[] = [];
  if (item.musicbrainz_artist_id && matchingEnabled()) {
    try { tags = await sharedMusicBrainzClient().lookupArtistGenres(item.musicbrainz_artist_id); } catch { tags = []; }
  }
  return { title: item.title, artist: item.artist ?? item.album_artist ?? null, genre: item.genre ?? null, year: item.year ?? null, tags };
}

export interface BandDraft {
  name: string; backstory: string; genres: string[]; members: { name: string; role: string }[];
  style: string; portrait_prompt: string; logo_prompt: string; single_title: string; single_lyrics: string;
}

const BAND_SCHEMA = {
  name: "band",
  strict: true,
  schema: {
    type: "object", additionalProperties: false,
    required: ["name", "backstory", "genres", "members", "style", "portrait_prompt", "logo_prompt", "single_title", "single_lyrics"],
    properties: {
      name: { type: "string" }, backstory: { type: "string" },
      genres: { type: "array", items: { type: "string" } },
      members: { type: "array", items: { type: "object", additionalProperties: false, required: ["name", "role"], properties: { name: { type: "string" }, role: { type: "string" } } } },
      style: { type: "string" }, portrait_prompt: { type: "string" }, logo_prompt: { type: "string" },
      single_title: { type: "string" }, single_lyrics: { type: "string" },
    },
  },
} as const;

export function bandPrompt(brief: BandBrief, retry: boolean): LlmMessage[] {
  const seedWords = [brief.genre, brief.year ? `${Math.floor(brief.year / 10) * 10}s` : null, ...brief.tags].filter(Boolean).join(", ");
  return [
    { role: "system", content: "You invent a new fictional band for a family music app. The brief gives the feel of a song the person likes: use its genre, era and mood only. "
      + "Never reuse the song's title, its artist's name, or any member name, lyric or melody from it; the band, its people, its back story and its single are all new and made up. "
      + "Reply with JSON only. name: the band name. backstory: 3 to 5 sentences of plain text. genres: up to 5 short words. members: 3 to 5 people with a role each. "
      + "style: one line of sound words for a song engine (genre, mood, instruments, era), no lyrics. portrait_prompt: a group photo of the band, no text. "
      + "logo_prompt: a simple logo mark for the band, no text or letters. single_title: a new title. single_lyrics: a short song with [Verse] and [Chorus] tags."
      + (retry ? " Your last answer reused a name from the song. Choose completely different names." : "") },
    { role: "user", content: JSON.stringify({ brief_genre_and_era: seedWords || "any", song_title_to_avoid: brief.title, artist_name_to_avoid: brief.artist }) },
  ];
}

export function parseDraft(text: string): BandDraft | null {
  try {
    const raw = JSON.parse(visibleText(text)) as Partial<BandDraft>;
    const name = String(raw.name ?? "").trim().slice(0, 120);
    if (!name || !String(raw.single_title ?? "").trim()) return null;
    const members = (Array.isArray(raw.members) ? raw.members : []).slice(0, 8)
      .map((m) => ({ name: String(m?.name ?? "").trim().slice(0, 80), role: String(m?.role ?? "").trim().slice(0, 60) })).filter((m) => m.name && m.role);
    return {
      name, backstory: String(raw.backstory ?? "").trim().slice(0, 4000),
      genres: [...new Set((Array.isArray(raw.genres) ? raw.genres : []).map((g) => String(g).trim().slice(0, 40)).filter(Boolean))].slice(0, 5),
      members, style: String(raw.style ?? "").trim().slice(0, 1000) || "original songs",
      portrait_prompt: String(raw.portrait_prompt ?? "").trim().slice(0, 500), logo_prompt: String(raw.logo_prompt ?? "").trim().slice(0, 500),
      single_title: String(raw.single_title ?? "").trim().slice(0, 120), single_lyrics: String(raw.single_lyrics ?? "").trim().slice(0, 3500),
    };
  } catch { return null; }
}

/** True when the draft reuses the song's title, its artist, or names a member after its artist: the one thing a like-this never does. */
export function copiesSeed(draft: Pick<BandDraft, "name" | "single_title" | "members">, brief: BandBrief): boolean {
  return sameName(draft.name, brief.artist) || sameName(draft.single_title, brief.title) || sameName(draft.name, brief.title)
    || draft.members.some((m) => sameName(m.name, brief.artist));
}

async function draftBand(brief: BandBrief): Promise<BandDraft | null> {
  for (const retry of [false, true]) {
    const result = await complete("chat", bandPrompt(brief, retry), { temperature: 0.9, response_format: { type: "json_schema", json_schema: BAND_SCHEMA } });
    if (!result.ok) return null;
    const draft = parseDraft(result.value.text);
    if (draft && !copiesSeed(draft, brief)) return draft;
  }
  return null;
}

const PURPOSE = /^band:(mband-[a-z0-9]+):(portrait|logo)$/;

/** Uses a finished portrait or logo for its band; any other picture is ignored, and a failure here never changes the picture. */
export function finishBandPicture(picture: PictureJob): void {
  if (picture.state !== "done" || !picture.files[0] || !picture.purpose) return;
  const match = PURPOSE.exec(picture.purpose);
  if (!match) return;
  const owner = db.select().from(people).where(and(eq(people.id, picture.personId))).get();
  if (!owner) return;
  updateMade("made_artist", owner as unknown as PersonRow, match[1]!, match[2] === "portrait" ? { portrait_file_id: picture.files[0].id } : { logo_file_id: picture.files[0].id });
}

export async function startBandPicture(state: { conversationId: string | null; turnId: string | null }, actor: PersonRow, bandId: string, part: "portrait" | "logo", prompt: string): Promise<void> {
  try {
    const audience = routeAudience(actor);
    const full = `${prompt} No text, no letters.`.slice(0, 578);
    if (!prompt || pictureDenial(audience) || refusePrompt(full, { lane: laneOf(audience) }) || !(await pictureEngineReady())) return;
    const picture = await startPictureJob({ actor, conversationId: state.conversationId, turnId: state.turnId, temporary: false,
      purpose: `band:${bandId}:${part}`, kind: "generate", prompt: full,
      body: { prompt: full, model: QUICK_MODEL, size: "1024x1024", n: 1, seed: Math.floor(Math.random() * 2147483647), audience: adultStylesAllowed() ? "adult" : "all-ages" } });
    finishBandPicture(picture);
  } catch { /* A portrait or a logo never fails the band. */ }
}

export type BandState = Pick<TurnState, "utterance" | "actor" | "persona" | "surface" | "speakerEvidence" | "deviceId" | "planBasis" | "plan" | "conversationId" | "turnId" | "temporary" | "ephemeral">;
export type BandResult = { ok: true; bandId: string; line: string; musicJobId: string | null; block: Record<string, unknown> } | { ok: false; line: string };

/** The answer block's picture reference: the file id in hex, because a block image must read `hubimg-` and hex digits. The chat card turns it back into the file's own address. */
export const hubImageRef = (fileId: string): string => `hubimg-${Buffer.from(fileId, "utf8").toString("hex")}`;
/** The file id a `hubimg-` reference names, or null (the reverse of hubImageRef; the chat card decodes the same format). */
export const fileIdOfHubImage = (src: string): string | null => /^hubimg-([a-f0-9]{8,})$/.test(src) ? Buffer.from(src.slice(7), "hex").toString("utf8") : null;
/** `make_band:<band id>:<conversation id>:<turn id>`. The band id is what the card's buttons send back; the other two are where a new picture is filed. */
export const bandProvenance = (bandId: string, where: { conversationId: string | null; turnId: string | null }): string => `make_band:${bandId}:${where.conversationId ?? "-"}:${where.turnId ?? "-"}`;
// The card spec allows four buttons; a new picture or logo is asked for in the card's edit panel (remake_portrait, remake_logo).
const BAND_ACTIONS = ["make_album", "keep", "remake", "discard"] as const;

/** The band's chat card. It carries the band's own record (name, story, members, pictures made so far) and the first single's title;
 * the band id rides in `provenance`, which the card's buttons send back to the band route. The card is editable: Edit sends edit_band with the changed fields. */
export function bandBlock(bandId: string, where: { conversationId: string | null; turnId: string | null }, brief: BandBrief, draft: BandDraft, pictures: { portrait?: string | null; logo?: string | null }): Record<string, unknown> {
  const props: Record<string, unknown> = {
    name: draft.name, genres: draft.genres, members: draft.members, singleTitle: draft.single_title.slice(0, 120), editable: true, sound: draft.style,
    inspiredBy: (brief.artist ? `${brief.title} by ${brief.artist}` : brief.title).slice(0, 120), actions: [...BAND_ACTIONS],
  };
  if (draft.backstory) props.backstory = draft.backstory;
  if (pictures.portrait) props.portrait = { src: hubImageRef(pictures.portrait), alt: `Portrait of the band ${draft.name}` };
  if (pictures.logo) props.logo = { src: hubImageRef(pictures.logo), alt: `Logo of the band ${draft.name}` };
  return blockEnvelope("band", MAKE_BAND_TOOL_ID, `The band ${draft.name}, made like a song you picked, with its first single ${draft.single_title}.`, bandProvenance(bandId, where), props);
}

type BandRecord = { id: string; name: string; backstory?: string | null; genres?: string[]; members?: { name: string; role: string }[]; portrait_file_id?: string | null; logo_file_id?: string | null; style?: { description?: string } };

/** The band's chat card built from the saved record (after an edit, so the card and the record agree). */
export function bandBlockFromRecord(rec: BandRecord, where: { conversationId: string | null; turnId: string | null }): Record<string, unknown> {
  const props: Record<string, unknown> = { name: rec.name, genres: rec.genres ?? [], members: (rec.members ?? []).map((m) => ({ name: m.name, role: m.role })), editable: true, sound: rec.style?.description ?? "", actions: [...BAND_ACTIONS] };
  if (rec.backstory) props.backstory = rec.backstory;
  if (rec.portrait_file_id) props.portrait = { src: hubImageRef(rec.portrait_file_id), alt: `Portrait of the band ${rec.name}` };
  if (rec.logo_file_id) props.logo = { src: hubImageRef(rec.logo_file_id), alt: `Logo of the band ${rec.name}` };
  return blockEnvelope("band", MAKE_BAND_TOOL_ID, `The band ${rec.name}.`, bandProvenance(rec.id, where), props);
}

/** Makes the band, then starts its portrait, logo and first single. Only the band itself can fail this call. */
export async function makeBand(input: { state: BandState; mediaId: string; callId: string; spoken: boolean }): Promise<BandResult> {
  const { state } = input;
  const actor = state.actor as PersonRow;
  if (laneOf(musicAudienceOf(state, input.spoken)) !== "adult") return { ok: false, line: "Bands, albums, sound effects and saved styles are for adults. You can make a song here instead." };
  if (musicDenial(musicAudienceOf(state, input.spoken)) || pictureDenial({ ...routeAudience(actor), spoken: input.spoken })) return { ok: false, line: BAND_NOT_HERE_LINE };
  const brief = await briefFor(actor, input.mediaId);
  if (!brief) return { ok: false, line: "No band was made, because that song is not in the library the person can use. Ask which song they mean." };
  const draft = await draftBand(brief);
  if (!draft) return { ok: false, line: BAND_MODEL_LINE };
  const made = createMade("made_artist", actor, {
    name: draft.name, backstory: draft.backstory, genres: draft.genres, members: draft.members,
    style: { description: draft.style, genres: draft.genres }, seed: { media_id: input.mediaId },
  });
  if (!made.ok) return { ok: false, line: BAND_MODEL_LINE };
  const bandId = made.value.id;
  await Promise.all([startBandPicture(state, actor, bandId, "portrait", draft.portrait_prompt), startBandPicture(state, actor, bandId, "logo", draft.logo_prompt)]);
  let single = false; let musicJobId: string | null = null;
  try {
    const outcome = await runGenerateMusic({ state, callId: input.callId, spoken: input.spoken,
      band: { id: bandId, name: draft.name },
      args: { description: `${draft.style}. By the band ${draft.name}.`, lyrics: draft.single_lyrics || undefined, title: draft.single_title } });
    single = outcome.status === "succeeded";
    musicJobId = (outcome.result?.data as { musicJobId?: string } | undefined)?.musicJobId ?? null;
  } catch { single = false; }
  const saved = getMade("made_artist", actor, bandId);
  const body = saved.ok ? saved.value as unknown as { portrait_file_id?: string | null; logo_file_id?: string | null } : {};
  const block = bandBlock(bandId, state, brief, draft, { portrait: body.portrait_file_id, logo: body.logo_file_id });
  return { ok: true, bandId, musicJobId, block, line: `The band is made and saved in Music under Make a band: say its name and one line about its sound.${single ? " Its first single is being made now." : " Its first single could not start, so offer to try it again."} The portrait and logo appear on its page when ready.` };
}

/** The turn's runner for `make_band`: the policy node has already checked the offer and that the reference is the one the person sent. */
export async function runMakeBand(input: { state: BandState; args: Record<string, unknown>; callId: string; spoken: boolean }): Promise<ToolExecutionOutcome> {
  const { state, args, callId } = input;
  const ref = itemRefsIn(typeof args.ref === "string" ? args.ref : "")[0] ?? itemRefsIn(state.utterance ?? "").find((r) => r.app === "music" && r.kind === "track");
  if (!ref) return outcomeOf({ callId, packageId: MAKE_BAND_TOOL_ID, status: "failed", via: "tool_call", args, errorCode: "bad_arguments", failureKind: "bad_arguments", durationMs: 0 });
  const made = await makeBand({ state, mediaId: ref.id, callId, spoken: input.spoken });
  if (!made.ok) return outcomeOf({ callId, packageId: MAKE_BAND_TOOL_ID, status: "succeeded", via: "tool_call", args, durationMs: 0, result: { reply: { text: made.line }, actions: [] } });
  return outcomeOf({ callId, packageId: MAKE_BAND_TOOL_ID, status: "succeeded", via: "tool_call", args, durationMs: 0, result: { reply: { text: made.line }, data: { bandId: made.bandId, ...(made.musicJobId ? { musicJobId: made.musicJobId } : {}) }, blocks: [made.block], actions: [] } as NonNullable<ToolExecutionOutcome["result"]> });
}
