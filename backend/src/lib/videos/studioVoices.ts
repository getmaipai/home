// VIDEO-STUDIO-07: the spoken lines of a Studio session. A typed line is screened, spoken once (`synthesizeSpeech`, as `edit_video` mix does) and kept here
// in memory so the page can play it and the export can lay it over the film. Memory only: nothing is written to the Library or the disk, a line is gone
// after two hours or a restart (the export then says so in one line), and only the person who made it can read it.
import { randomSuffix } from "@/lib/id";
import { audioSeconds, wavSeconds } from "./audioLength";
export { wavSeconds };

export interface StudioVoice { id: string; ownerPersonId: string; bytes: Uint8Array; ext: string; mediaType: string; line: string; seconds: number; createdAt: number }

export const VOICE_TTL_MS = 2 * 60 * 60 * 1000;
export const VOICES_PER_PERSON = 24;
const voices = new Map<string, StudioVoice>();

/** When the header cannot say, speech runs about fifteen characters a second. */
export function estimatedSpeechSeconds(line: string): number {
  return Math.max(1, Math.round((line.length / 15) * 10) / 10);
}

function sweep(now: number): void {
  for (const [id, voice] of voices) if (now - voice.createdAt > VOICE_TTL_MS) voices.delete(id);
}

export function putStudioVoice(ownerPersonId: string, input: { bytes: Uint8Array; ext: string; mediaType: string; line: string }, now = Date.now()): StudioVoice {
  sweep(now);
  const own = [...voices.values()].filter((voice) => voice.ownerPersonId === ownerPersonId).sort((a, b) => a.createdAt - b.createdAt);
  for (const old of own.slice(0, Math.max(0, own.length - (VOICES_PER_PERSON - 1)))) voices.delete(old.id);
  const voice: StudioVoice = { id: `voice-${randomSuffix(12)}`, ownerPersonId, ...input, seconds: audioSeconds(input.bytes) ?? estimatedSpeechSeconds(input.line), createdAt: now };
  voices.set(voice.id, voice);
  return voice;
}

/** A line by id for the person who made it; nobody else reads another person's. */
export function getStudioVoice(ownerPersonId: string, id: string, now = Date.now()): StudioVoice | null {
  const voice = voices.get(id);
  if (!voice || voice.ownerPersonId !== ownerPersonId || now - voice.createdAt > VOICE_TTL_MS) return null;
  return voice;
}

export const VOICE_REF_PREFIX = "voice:";
export const studioVoiceRef = (id: string): string => `${VOICE_REF_PREFIX}${id}`;
export const studioVoiceUrl = (id: string): string => `/api/videos/studio/voices/${encodeURIComponent(id)}`;

/** Test-only. */
export function __resetStudioVoicesForTests(): void { voices.clear(); }
