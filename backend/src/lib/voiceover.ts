import type { PersonRow } from "@/types";
import { storeFile } from "@/lib/attachments";
import { speakerAgeBand } from "@/lib/ageBand";
import { listPlayableVoices } from "@/lib/voiceList";
import { householdVoiceEntries, householdVoiceSpeech } from "@/lib/clonedVoices";
import { voiceForSpeech, isPresetVoice } from "@/lib/voiceForSpeech";
import { plannedRecordedEngine, synthesizeRecordedSpeech, type RecordedSpeechEngine } from "@/lib/tts";
import { tagsForEngine } from "@/lib/recordedTags";
import { videoRefusalFor } from "@/lib/videos/tool";
import { makeAudienceOf } from "@/lib/videos/make";
import { audioSeconds } from "@/lib/videos/audioLength";
import type { StackVoice } from "@/lib/stack/types";

export type VoiceoverVoice = { id: string; label: string; kind: "preset" | "clip"; engine: RecordedSpeechEngine; tags: string[] };
export type VoiceoverResult =
  | { ok: true; file_id: string; seconds: number | null; engine: RecordedSpeechEngine; revision?: string; voice: string; kind: "preset" | "clip" }
  | { ok: false; status: 400 | 403 | 422 | 503; line: string };

export async function voicesFor(actor: PersonRow): Promise<VoiceoverVoice[]> {
  const minor = speakerAgeBand(actor, new Date()) !== "adult";
  const listed = await listPlayableVoices();
  const rows: StackVoice[] = [...listed, ...householdVoiceEntries().filter((v) => !listed.some((x) => x.id === v.id))];
  const defaultId = voiceForSpeech({ actor });
  const householdDefault = householdVoiceSpeech(defaultId);
  const engineDefaultId = householdDefault?.voiceUrl ?? defaultId;
  const candidates = rows.filter((v) => v.source === "preset" || v.source === "cloned");
  if (!candidates.some((v) => v.id === engineDefaultId)) candidates.push({ id: engineDefaultId, name: defaultId, description: "Home's default voice.", language: "en", country: "unknown", gender: "unknown", source: householdDefault ? "cloned" : "preset", engine: "chatterbox-turbo", onDisk: true, licence: null, revision: "unknown" });
  const safe = minor ? candidates.filter((v) => v.source === "preset" && isPresetVoice(v.id)) : candidates;
  const result: VoiceoverVoice[] = [];
  for (const item of safe) {
    const engine = await plannedRecordedEngine(item.id);
    result.push({ id: item.id, label: item.name, kind: item.source === "cloned" ? "clip" : "preset", engine, tags: await tagsForEngine(engine) });
  }
  return result;
}


export async function makeVoiceover(actor: PersonRow, input: { script: string; voice?: string }): Promise<VoiceoverResult> {
  const script = typeof input.script === "string" ? input.script.trim() : "";
  if (!script || script.length > 2000) return { ok: false, status: 400, line: "Write a script from 1 to 2000 characters, then try again." };
  const refusal = videoRefusalFor(makeAudienceOf(actor), { prompt: script });
  if (refusal) return { ok: false, status: 403, line: refusal.line };
  const voices = await voicesFor(actor);
  const selected = input.voice ?? voiceForSpeech({ actor });
  const voiceId = selected;
  const voice = voices.find((item) => item.id === voiceId);
  if (!voice) return { ok: false, status: 422, line: "I don't know that voice. Choose a voice from the list, then try again." };
  try {
    const saved = await speakAndStore(actor, script, voiceId, voice.kind, "Voiceover", { v: 1 });
    if (!saved.ok) return saved;
    return { ok: true, file_id: saved.file_id, seconds: saved.seconds, engine: saved.engine, ...(saved.revision ? { revision: saved.revision } : {}), voice: voiceId, kind: voice.kind };
  } catch { return { ok: false, status: 503, line: "Home can't speak right now. Try again in a minute." }; }
}

export type SpokenFileResult = { ok: true; file_id: string; bytes: Uint8Array; seconds: number | null; engine: RecordedSpeechEngine; revision?: string } | { ok: false; status: 503; line: string };

export type SpokenBytesResult = { ok: true; bytes: Uint8Array; seconds: number | null; engine: RecordedSpeechEngine; revision?: string } | { ok: false; status: 503; line: string };

export async function speakToBytes(text: string, voiceId: string): Promise<SpokenBytesResult> {
  try {
    const spoken = await synthesizeRecordedSpeech(text, voiceId);
    if (!spoken.ok) return { ok: false, status: 503, line: "Home can't speak right now. Try again in a minute." };
    const bytes = new Uint8Array(await new Response(spoken.value.stream).arrayBuffer());
    if (!bytes.length) return { ok: false, status: 503, line: "Home can't speak right now. Try again in a minute." };
    return { ok: true, bytes, seconds: audioSeconds(bytes), engine: spoken.engine, ...(spoken.revision ? { revision: spoken.revision } : {}) };
  } catch { return { ok: false, status: 503, line: "Home can't speak right now. Try again in a minute." }; }
}

/** Speak and store a private Library audio file, with caller-supplied provenance additions. */
export async function speakAndStore(actor: PersonRow, text: string, voiceId: string, kind: "preset" | "clip", namePrefix: string, provenance: Record<string, unknown>): Promise<SpokenFileResult> {
  try {
    const spoken = await speakToBytes(text, voiceId);
    if (!spoken.ok) return spoken;
    const { bytes } = spoken;
    const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
    const stored = storeFile(actor, { conversationId: null, turnId: null, mediaType: "audio/wav", bytes, provenance: `voiceover:${JSON.stringify({ ...provenance, engine: spoken.engine, ...(spoken.revision ? { revision: spoken.revision } : {}), voice: voiceId, kind })}`, deduplicate: false, retention: "kept", name: `${namePrefix} ${stamp}` });
    if (!stored.ok) return { ok: false, status: 503, line: "Home can't speak right now. Try again in a minute." };
    return { ok: true, file_id: stored.value.id, bytes, seconds: spoken.seconds, engine: spoken.engine, ...(spoken.revision ? { revision: spoken.revision } : {}) };
  } catch { return { ok: false, status: 503, line: "Home can't speak right now. Try again in a minute." }; }
}
