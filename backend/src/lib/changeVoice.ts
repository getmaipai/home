import type { PersonRow } from "@/types";
import { and, eq, isNull } from "drizzle-orm";
import { attachments } from "@/db/schema";
import { db } from "@/db";
import { readAttachment, storeFile } from "@/lib/attachments";
import { speakerAgeBand } from "@/lib/ageBand";
import { transcribeAudioClip } from "@/lib/stt";
import { makeAudienceOf } from "@/lib/videos/make";
import { videoRefusalFor } from "@/lib/videos/tool";
import { overlayOp } from "@/lib/videos/editPlan";
import { runStackEdit } from "@/lib/videos/stackEdit";
import { audioSeconds } from "@/lib/videos/audioLength";
import { voiceForSpeech } from "@/lib/voiceForSpeech";
import { speakAndStore, speakToBytes, voicesFor } from "@/lib/voiceover";

export type ChangeVoiceResult =
  | { ok: true; file_id: string; kind_of_source: "audio" | "video"; seconds: number | null; spoken_seconds: number | null; source_seconds: number | null; difference_seconds: number | null; engine: "fish-audio-drama-3" | "chatterbox-turbo"; revision?: string; voice: string; kind: "preset" | "clip" }
  | { ok: false; status: 403 | 404 | 422 | 503; line: string };

const failure = (status: 403 | 404 | 422 | 503, line: string): ChangeVoiceResult => ({ ok: false, status, line });
const MISSING = "I can't find that file. Pick one of your own audio or video files.";
const SPEECH_DOWN = "Home can't speak right now. Try again in a minute.";

export async function changeVoice(actor: PersonRow, input: { file_id: string; voice?: string }): Promise<ChangeVoiceResult> {
  if (speakerAgeBand(actor, new Date()) !== "adult") return failure(403, "Changing a voice is for adults. Ask an adult in your home to help.");
  const row = db.select().from(attachments).where(and(eq(attachments.id, input.file_id), eq(attachments.ownerPersonId, actor.id), isNull(attachments.deletedAt))).get();
  if (!row || (!row.mediaType.startsWith("audio/") && !row.mediaType.startsWith("video/"))) return failure(404, MISSING);
  const source = readAttachment(actor, input.file_id);
  if (!source.ok) return failure(404, MISSING);
  const kind_of_source = source.value.record.media_type.startsWith("video/") ? "video" : "audio";
  let transcript: string;
  try { transcript = (await transcribeAudioClip(source.value.bytes, source.value.record.media_type)).trim(); }
  catch { return failure(503, "I couldn't transcribe that file. Try again in a few minutes."); }
  if (!transcript) return failure(422, "I couldn't hear any speech in that file. Pick a file with someone talking.");
  if (transcript.length > 2000) return failure(422, "That is more than about three minutes of speech. Use a shorter file.");
  const refusal = videoRefusalFor(makeAudienceOf(actor), { prompt: transcript });
  if (refusal) return failure(403, refusal.line);
  const voices = await voicesFor(actor);
  const voiceId = input.voice ?? voiceForSpeech({ actor });
  const voice = voices.find((item) => item.id === voiceId);
  if (!voice) return failure(422, "I don't know that voice. Choose a voice from the list, then try again.");
  if (kind_of_source === "audio") {
    const spoken = await speakAndStore(actor, transcript, voiceId, voice.kind, "Changed voice", { v: 1, change: "voice", source: input.file_id });
    if (!spoken.ok) return spoken;
    return { ok: true, file_id: spoken.file_id, kind_of_source, seconds: spoken.seconds, spoken_seconds: spoken.seconds, source_seconds: null, difference_seconds: null, engine: spoken.engine, ...(spoken.revision ? { revision: spoken.revision } : {}), voice: voiceId, kind: voice.kind };
  }
  const spoken = await speakToBytes(transcript, voiceId);
  if (!spoken.ok) return spoken;

  const muted = await runStackEdit({ inputs: [{ bytes: source.value.bytes, ext: "mp4" }], ops: [{ op: "mute" }], name: "changed-voice-muted.mp4" });
  if (!muted.ok) return failure(503, muted.line);
  const source_seconds = muted.seconds;
  const mixed = await runStackEdit({ inputs: [{ bytes: muted.bytes, ext: "mp4" }, { bytes: spoken.bytes, ext: "wav" }], ops: [overlayOp(1, { gain_db: 0, clip_gain_db: 0, end_s: source_seconds ?? undefined }, 0, false)], name: "changed-voice.mp4" });
  if (!mixed.ok) return failure(503, mixed.line);
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  const stored = storeFile(actor, { conversationId: null, turnId: null, mediaType: "video/mp4", bytes: mixed.bytes, provenance: `voiceover:${JSON.stringify({ v: 1, change: "voice", source: input.file_id, engine: spoken.engine, ...(spoken.revision ? { revision: spoken.revision } : {}), voice: voiceId, kind: voice.kind })}`, deduplicate: false, retention: "kept", name: `Changed voice ${stamp}` });
  if (!stored.ok) return failure(503, SPEECH_DOWN);
  const spoken_seconds = spoken.seconds;
  const difference_seconds = spoken_seconds !== null && source_seconds !== null ? Math.round((spoken_seconds - source_seconds) * 10) / 10 : null;
  return { ok: true, file_id: stored.value.id, kind_of_source, seconds: mixed.seconds, spoken_seconds, source_seconds, difference_seconds, engine: spoken.engine, ...(spoken.revision ? { revision: spoken.revision } : {}), voice: voiceId, kind: voice.kind };
}
