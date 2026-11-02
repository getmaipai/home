// VIDEO-CHAT-01 (C2, C3, C4): the `edit_video` tool, the video twin of `edit_music`. Three changes remake a clip made here: another take (same
// words and choices, new seed), remix (the same recipe plus the fields the person changed) and make it max (the same clip at Max). Each one calls
// `makeVideoFor`, the one function the Create page's buttons call, so the gates, the level rules and the one-clip-at-a-time rule are the
// same in chat and on the page. Three more edit the finished clips themselves through the Stack's `media.edit` job: trim (cut a clip), join
// (put the person's own clips in order into one film) and mix (lay a spoken line or a song over a clip and set the balance). `continue` and
// `retake` are not here: the Stack's LTX-2.5 cannot start from a picture yet. The model decides when a person wants one of these (rule 1); nothing here reads wording. The result is
// `data: { videoJobId }` like `generate_video`, so the same card follows the job. A failed tool tells the model only the failure kind
// (rule 6); a refusal keeps its own plain line.
import { z } from "zod";
import type { PersonRow } from "@/types";
import type { ToolExecutionOutcome } from "@/lib/turnMachine/contract";
import { outcomeOf } from "@/lib/turnContext";
import { MAX_NEEDS_ADMIN_LINE, jobTier, tierArgument } from "@/lib/tiers";
import { etaWords, makerOfModel } from "./quality";
import { MINOR_MAKE_LINE, bodyOfVideoJob, makeVideoFor, type MakeVideoBody } from "./make";
import { laneOf } from "@/lib/pictures/lane";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments } from "@/db/schema";
import { readAttachment } from "@/lib/attachments";
import { getMusicJobFor, readMusicFile } from "@/lib/music/jobs";
import { synthesizeSpeech } from "@/lib/tts";
import { listClonedVoices } from "@/lib/clonedVoices";
import { getOfferedVoices } from "@/lib/voiceResolve";
import { isPresetVoice, voiceForSpeech } from "@/lib/voiceForSpeech";
import { readVideoFile, sourceVideoJob, startVideoEditJob, type EditRun, type VideoJob, type VideoRequest } from "./jobs";
import { DEFAULT_MUSIC_LEVEL, DEFAULT_VOICE_LEVEL, MAX_JOIN_CLIPS, MIN_JOIN_CLIPS, MIX_LEVEL_IDS, joinOps, mixOps, trimOps, trimRange } from "./editPlan";
import { runStackEdit, type EditFile } from "./stackEdit";
import { isAdultOnlyJob } from "@/lib/pictures/ageCheck";
import { fileAudience } from "@/lib/access";
import { allVideoAdapters } from "./adapters";
import { VIDEO_LOOKS, VIDEO_RECIPES, VIDEO_VOICES } from "./recipes";
import { prepareVideoRerun } from "./rerun";
import { videoAudienceOf, videoRefusalFor, type GenerateVideoState, type RunGenerateVideoInput } from "./tool";

export const EDIT_VIDEO_TOOL_ID = "edit_video";

const ids = <T extends { id: string }>(list: readonly T[]) => list.map((item) => item.id) as [string, ...string[]];

export const editVideoArgs = z.object({
  clip: z.string().trim().min(1).max(80),
  change: z.enum(["another_take", "remix", "make_it_max", "trim", "join", "mix"]),
  prompt: z.string().trim().min(3).max(1200).optional(),
  look: z.enum(ids(VIDEO_LOOKS)).optional(),
  camera: z.enum(ids(VIDEO_RECIPES)).optional(),
  voices: z.enum(ids(VIDEO_VOICES)).optional(),
  tier: z.enum(["standard", "boost", "max"]).optional(),
  seconds: z.number().int().min(1).max(10).optional(),
  keep_seed: z.boolean().optional(),
  from_s: z.number().min(0).max(600).optional(),
  to_s: z.number().gt(0).max(600).optional(),
  clips: z.array(z.string().trim().min(1).max(80)).min(MIN_JOIN_CLIPS).max(MAX_JOIN_CLIPS).optional(),
  sound: z.enum(["voice", "music"]).optional(),
  line: z.string().trim().min(1).max(600).optional(),
  voice: z.string().trim().min(1).max(80).optional(),
  track: z.string().trim().min(1).max(80).optional(),
  level: z.enum(MIX_LEVEL_IDS).optional(),
  start_s: z.number().min(0).max(600).optional(),
});

export const NO_CLIP_LINE = "I can't find that video. Ask for a new one, or open the video you mean and try again.";
export const WHAT_TO_CHANGE_LINE = "Tell me what to change: the words, the look, the camera move, the sound, the length or the level.";
export const NO_PICTURE_LINE = "The picture that video started from is not available any more, so I can't make it again. Ask for a new video.";
export const ALREADY_MAX_LINE = "That video is already made at Max.";
export const NO_CLIPS_LINE = "I can't find one of those videos. Tell me which videos to join, from the ones you made here.";
export const JOIN_CLIPS_LINE = `Tell me ${MIN_JOIN_CLIPS} to ${MAX_JOIN_CLIPS} of your videos to join, in the order you want them.`;
export const MIX_SOUND_LINE = "Tell me what to put over the video: a line to say in a voice, or one of your songs.";
export const NO_TRACK_LINE = "I can't find that song. Pick one of your own songs or sound files, or ask for a voice line instead.";
export const NO_VOICE_LINE = "I don't know that voice. Pick one from your home's voices, or leave the voice out to use yours.";
export const SPEECH_FAILED_LINE = "I couldn't change that video. Home can't speak right now, so the line was not added. Try again in a minute.";
export const START_PAST_END_LINE = "That is after the video ends. Pick a start time inside it.";

export interface RunEditVideoInput { state: GenerateVideoState; args: Record<string, unknown>; callId: string; spoken: boolean }

const packageId = EDIT_VIDEO_TOOL_ID;

function refused(callId: string, args: Record<string, unknown>, line: string, why: string): ToolExecutionOutcome {
  return outcomeOf({ callId, packageId, status: "succeeded", via: "tool_call", args, durationMs: 0, result: { reply: { text: `No video was made. Say this to the person in your own words and keep its meaning: ${line}` }, data: { refused: why }, actions: [] } });
}

function failed(callId: string, args: Record<string, unknown>, code: string, kind: "unavailable" | "errored" | "bad_arguments"): ToolExecutionOutcome {
  return outcomeOf({ callId, packageId, status: "failed", via: "tool_call", args, errorCode: code, failureKind: kind, durationMs: 0 });
}

export async function runEditVideo(input: RunEditVideoInput): Promise<ToolExecutionOutcome> {
  const { state, args, callId } = input;
  const parsed = editVideoArgs.safeParse(args);
  if (!parsed.success) return failed(callId, args, "bad_arguments", "bad_arguments");
  const value = parsed.data;
  const actor = state.actor as PersonRow;
  const audience = videoAudienceOf(state as Parameters<typeof videoAudienceOf>[0], input.spoken);
  // The surface and age gate, then the same screening any typed prompt gets (a remix's new words are screened like a first request).
  // A typed voice line is screened like a prompt, before any speech is made.
  const typed = value.change === "remix" ? value.prompt ?? "" : value.change === "mix" && value.sound === "voice" ? value.line ?? "" : "";
  const refusal = videoRefusalFor(audience, { prompt: typed });
  if (refusal) return refused(callId, args, refusal.line, refusal.why);

  const temporary = state.temporary === true || state.ephemeral === true;
  if (value.change === "trim" || value.change === "join" || value.change === "mix") {
    // Cutting, joining and mixing are for adults on their own screen, like making one: a child's turn passes the screen above but never reaches the editor.
    if (laneOf(audience) !== "adult") return refused(callId, args, MINOR_MAKE_LINE, "minor");
    return editFinishedClips(input, value, actor, temporary);
  }
  const source = sourceVideoJob(actor, state.conversationId, value.clip, temporary);
  if (!source) return refused(callId, args, NO_CLIP_LINE, "no_clip");

  const body: MakeVideoBody = bodyOfVideoJob(source);
  // A clip that started from a picture (made here or an attached photo) starts from it again, through the same loader and input screening a Make another uses.
  let prepared: RunGenerateVideoInput["prepared"];
  if (source.request.source_file_id) {
    const prep = source.conversationId
      ? await prepareVideoRerun({ actor, audience, conversationId: source.conversationId, temporary: source.temporary, prompt: value.change === "remix" ? value.prompt ?? source.prompt : source.prompt, sourceFileId: source.request.source_file_id, adapters: [], styleIds: [] })
      : null;
    if (!prep) return refused(callId, args, NO_PICTURE_LINE, "reference");
    if (!prep.ok) return refused(callId, args, prep.line, prep.code);
    if (prep.image) prepared = { image: prep.image, imageSource: prep.imageSource ?? "generated", sourceFileId: source.request.source_file_id, width: prep.width, height: prep.height };
  }
  if (value.change === "remix") {
    const changed = value.prompt !== undefined || value.look !== undefined || value.camera !== undefined || value.voices !== undefined || value.tier !== undefined || value.seconds !== undefined;
    if (!changed) return refused(callId, args, WHAT_TO_CHANGE_LINE, "nothing_to_change");
    if (value.prompt !== undefined) body.prompt = value.prompt;
    if (value.look !== undefined) body.look = value.look;
    if (value.camera !== undefined) body.recipe = value.camera;
    if (value.voices !== undefined) body.voices = value.voices;
    if (value.tier !== undefined) body.tier = value.tier;
    if (value.seconds !== undefined) body.seconds = value.seconds;
    if (value.keep_seed && source.request.seed) body.seed = source.request.seed;
  } else if (value.change === "make_it_max") {
    if (body.tier === "max") return refused(callId, args, ALREADY_MAX_LINE, "already_max");
    // The same grant check the tool and the Create page use; without it nothing is made.
    if (tierArgument({ person: actor, category: "video", arg: "max", band: audience.band }).line === MAX_NEEDS_ADMIN_LINE) return refused(callId, args, MAX_NEEDS_ADMIN_LINE, "max_needs_admin");
    body.tier = "max";
    // The same clip, made better: the same picture of the idea, so the seed stays.
    if (source.request.seed) body.seed = source.request.seed;
  }

  const made = await makeVideoFor(actor, body, { audience, state, callId, ...(prepared ? { prepared } : {}) });
  if (!made.ok) {
    if (made.status === 503) return failed(callId, args, made.code, "unavailable");
    if (made.status === 502) return failed(callId, args, made.code, "errored");
    return refused(callId, args, made.error, made.code);
  }
  const job = made.job;
  const quality = job.request.quality ?? "quick";
  const level = jobTier("video", job.request.tier, quality);
  const note = made.notice ? ` ${made.notice}` : "";
  return outcomeOf({
    callId, packageId, status: "succeeded", via: "tool_call", args, durationMs: 0,
    result: {
      reply: { text: `A new ${job.request.seconds} second version of the video is being made at ${level === "max" ? "Max" : level === "boost" ? "Boost" : "Standard"}; the first one is kept. It takes ${etaWords(quality, job.request.seconds, makerOfModel((job.request as { stackBody?: { model?: string } }).stackBody?.model, quality))} and appears below your reply when it is ready. You have not seen it or heard it: do not describe how it looks or sounds. Tell the person in one short sentence that it is on its way and about how long it takes.${note}` },
      data: { videoJobId: job.id },
      actions: [],
    },
  });
}

// ---------------------------------------------------------------- trim, join and mix (the Stack's media.edit)

type EditArgs = z.infer<typeof editVideoArgs>;
const EXTENSION_OF: Record<string, string> = { "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav", "audio/flac": "flac", "audio/ogg": "ogg" };

/** A finished clip of this person for an edit: "latest" or a video job id. A temporary chat uses only its own temporary clips and a saved chat never a temporary one. */
function ownClip(actor: PersonRow, state: GenerateVideoState, clip: string, temporary: boolean): VideoJob | null {
  const job = sourceVideoJob(actor, state.conversationId, clip, temporary);
  if (!job || job.personId !== actor.id) return null;
  if (temporary && job.conversationId !== state.conversationId) return null;
  return job;
}

function clipFile(actor: PersonRow, job: VideoJob): EditFile | null {
  const file = job.files[0];
  // A clip in Trash or gone from the Library is not edited.
  if (file && !job.temporary) { const row = db.select().from(attachments).where(eq(attachments.id, file.id)).get(); if (!row || row.deletedAt !== null || row.ownerPersonId !== actor.id) return null; }
  const read = file ? readVideoFile(actor, job, file.id) : null;
  return read ? { bytes: read.bytes, ext: "mp4" } : null;
}

/** Whether a source clip is adult-only: flagged when it was stored, else by its Library note; a saved clip whose note does not say all-ages counts as adult-only. */
async function clipAdultOnly(job: VideoJob): Promise<boolean> {
  if (job.request.adultOnly === true) return true;
  const file = job.files[0];
  if (job.request.adultOnly === undefined && !job.temporary && file) {
    const row = db.select().from(attachments).where(eq(attachments.id, file.id)).get();
    return !row || fileAudience(row.provenance) !== "all-ages";
  }
  if (job.request.adultOnly === undefined) return isAdultOnlyJob(job.prompt, job.request.loras, async (id) => (await allVideoAdapters()).find((a) => a.id === id)?.classification);
  return false;
}

/** A song or sound file of this person for a mix: their own music job (a temporary chat's only in that chat) or a file in their own Library. */
function ownTrack(actor: PersonRow, state: GenerateVideoState, track: string, temporary: boolean): EditFile | null {
  const job = getMusicJobFor(actor, track);
  let fileId = track;
  if (job) {
    if (job.state !== "done" || !job.fileId || job.temporary !== temporary) return null;
    if (temporary && job.conversationId !== state.conversationId) return null;
    const read = job.conversationId ? readMusicFile(actor, job, job.fileId) : null;
    if (read) return { bytes: read.bytes, ext: "m4a" };
    if (temporary) return null;
    fileId = job.fileId;
  }
  // A temporary chat never uses a saved Library file.
  if (temporary) return null;
  const row = db.select().from(attachments).where(and(eq(attachments.id, fileId), eq(attachments.ownerPersonId, actor.id))).get();
  if (!row || row.deletedAt !== null || !row.mediaType.startsWith("audio/")) return null;
  const read = readAttachment(actor, fileId);
  return read.ok ? { bytes: read.value.bytes, ext: EXTENSION_OF[row.mediaType] ?? "m4a" } : null;
}

/** The voice a line is spoken in: the person's own choice, or a household voice they named by id or name. */
async function voiceChoice(actor: PersonRow, named: string | undefined): Promise<{ ok: true; voice: string } | { ok: false }> {
  if (!named) return { ok: true, voice: voiceForSpeech({ actor }) };
  const wanted = named.trim().toLowerCase();
  const household = listClonedVoices().find((voice) => voice.id.toLowerCase() === wanted || voice.label.trim().toLowerCase() === wanted);
  if (household) return { ok: true, voice: household.id };
  if (isPresetVoice(named)) return { ok: true, voice: named };
  const offered = (await getOfferedVoices())?.find((voice) => voice.id.toLowerCase() === wanted || voice.name.trim().toLowerCase() === wanted);
  return offered ? { ok: true, voice: offered.id } : { ok: false };
}

async function speakLine(line: string, voice: string): Promise<EditFile | null> {
  const spoken = await synthesizeSpeech(line, voice);
  if (!spoken.ok) return null;
  try {
    const bytes = new Uint8Array(await new Response(spoken.value.stream).arrayBuffer());
    return bytes.byteLength > 0 ? { bytes, ext: "wav" } : null;
  } catch { return null; }
}

async function editFinishedClips(input: RunEditVideoInput, value: EditArgs, actor: PersonRow, temporary: boolean): Promise<ToolExecutionOutcome> {
  const { state, args, callId } = input;
  let sources: VideoJob[];
  if (value.change === "join") {
    if (!value.clips || value.clips.length < MIN_JOIN_CLIPS) return refused(callId, args, JOIN_CLIPS_LINE, "join_clips");
    const found = value.clips.map((clip) => ownClip(actor, state, clip, temporary));
    if (found.some((job) => job === null)) return refused(callId, args, NO_CLIPS_LINE, "no_clip");
    sources = found as VideoJob[];
  } else {
    const one = ownClip(actor, state, value.clip, temporary);
    if (!one) return refused(callId, args, NO_CLIP_LINE, "no_clip");
    sources = [one];
  }
  const first = sources[0]!;
  const files = sources.map((job) => clipFile(actor, job));
  if (files.some((file) => file === null)) return refused(callId, args, NO_CLIP_LINE, "no_clip");
  const clipFiles = files as EditFile[];
  const seconds = first.files[0]?.seconds ?? null;

  let inputs: EditFile[];
  let ops;
  let spoken: { line: string; voice: string } | null = null;
  // Never lower than the sources: any adult-only clip, an adult-only track or an adult line makes the edit adult-only.
  let adultOnly = (await Promise.all(sources.map(clipAdultOnly))).some(Boolean);
  let describe: string;
  if (value.change === "trim") {
    const range = trimRange({ from_s: value.from_s, to_s: value.to_s }, seconds);
    if (!range.ok) return refused(callId, args, range.line, "bad_cut");
    inputs = clipFiles; ops = trimOps(range.from, range.to);
    describe = `cut to ${range.from} to ${range.to} seconds`;
  } else if (value.change === "join") {
    inputs = clipFiles; ops = joinOps();
    describe = `${sources.length} videos joined in the order you named`;
  } else {
    const start = value.start_s ?? 0;
    if (seconds !== null && start >= seconds) return refused(callId, args, START_PAST_END_LINE, "start_past_end");
    if (value.sound === "voice") {
      if (!value.line) return refused(callId, args, MIX_SOUND_LINE, "nothing_to_mix");
      const voice = await voiceChoice(actor, value.voice);
      if (!voice.ok) return refused(callId, args, NO_VOICE_LINE, "no_voice");
      spoken = { line: value.line, voice: voice.voice };
      if (await isAdultOnlyJob(value.line, [], async () => undefined)) adultOnly = true;
      inputs = [clipFiles[0]!]; // the spoken line joins in the run, so the answer does not wait for the speech
      ops = mixOps(value.level ?? DEFAULT_VOICE_LEVEL, start, true);
      describe = "your line laid over it";
    } else if (value.sound === "music") {
      if (!value.track) return refused(callId, args, MIX_SOUND_LINE, "nothing_to_mix");
      const track = ownTrack(actor, state, value.track, temporary);
      if (!track) return refused(callId, args, NO_TRACK_LINE, "no_track");
      const trackRow = db.select().from(attachments).where(eq(attachments.id, value.track)).get();
      if (trackRow && fileAudience(trackRow.provenance) === "adult-only") adultOnly = true;
      inputs = [clipFiles[0]!, track];
      ops = mixOps(value.level ?? DEFAULT_MUSIC_LEVEL, start, false);
      describe = "your song laid under it";
    } else return refused(callId, args, MIX_SOUND_LINE, "nothing_to_mix");
  }

  const edit: NonNullable<VideoRequest["edit"]> = { from: first.id, change: value.change as "trim" | "join" | "mix", ...(value.change === "join" ? { with: sources.slice(1).map((job) => job.id) } : {}) };
  const run: EditRun = async (signal) => {
    const files = [...inputs];
    if (spoken) {
      const line = await speakLine(spoken.line, spoken.voice);
      if (!line) return { ok: false, line: SPEECH_FAILED_LINE };
      files.push(line);
    }
    const made = await runStackEdit({ inputs: files, ops: ops!, name: "edited.mp4", signal });
    return made.ok ? { ok: true, clip: { video: made.bytes, seconds: made.seconds, width: made.width, height: made.height, audio: made.audio, ms: made.ms } } : { ok: false, line: made.line };
  };
  const started = startVideoEditJob({ actor, conversationId: state.conversationId, turnId: state.turnId, temporary, source: first, edit, run, adultOnly });
  if (!started.ok) return refused(callId, args, started.line, "already_making");
  return outcomeOf({
    callId, packageId, status: "succeeded", via: "tool_call", args, durationMs: 0,
    result: {
      reply: { text: `A new version of the video (${describe}) is being made; the first one is kept. It takes under a minute and appears below your reply when it is ready. You have not seen it or heard it: do not describe how it looks or sounds. Tell the person in one short sentence that it is on its way.` },
      data: { videoJobId: started.job.id },
      actions: [],
    },
  });
}
