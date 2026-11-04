import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { and, asc, eq, gt, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { musicDjLines } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import { complete } from "@/lib/llm";
import { synthesizeSpeech } from "@/lib/tts";
import { voiceForSpeech } from "@/lib/voiceForSpeech";
import { getPersonSettingValue } from "@/lib/settings";
import { getHouseholdSettingValue } from "@/lib/settings";
import { companionVoiceKey } from "@/settings/companionVoiceKeys";
import { getHouseholdCompanion } from "@/lib/householdCompanions";
import { resolvePersona } from "@/lib/persona";
import { composePersonaPrompt } from "@/lib/persona";
import { readableItem } from "@/lib/media/access";
import { artistProfileFor } from "@/lib/media/artistProfiles";
import { songFactFor } from "@/lib/media/songFacts";
import { bandAllows } from "@/lib/media/band";
import { storeFile, attachmentFilePath, purgeFileRecord, removeFileBlobs } from "@/lib/attachments";
import { newFileId } from "@/lib/id";
import type { PersonRow } from "@/types";
import { attachments } from "@/db/schema";
import { refreshHouseholdQueue, registerQueueProvider, type QueueJob } from "@/lib/jobs/householdQueue";

export const DJ_ANGLES = ["a crisp handoff", "a warm late-night host", "a quick musical observation", "a relaxed introduction", "a bright, simple segue"] as const;
export const DJ_LINE_PROMPT = "Use only the supplied track tags and stored facts; never invent a fact. No profanity. Use plain speech without emoji, in one or two sentences. Follow the requested position and word limit exactly.";
export type DjPosition = "intro" | "transition" | "outro";
export type DjMode = "minimal" | "full";
export interface DjTrack { title: string; artist: string }
export interface DjLineInput { position: DjPosition; prev: DjTrack | null; next: DjTrack | null; factPrev: string | null; factNext: string | null; bio: string | null; stationName: string | null; personName: string; angle: string; mode: DjMode }
type Complete = typeof complete;
const limits: Record<DjPosition, number> = { intro: 14, transition: 28, outro: 18 };
const wordCount = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

export async function writeDjLine(input: DjLineInput, completion: Complete = complete, random: () => number = Math.random, voice = ""): Promise<string | null> {
  const position = input.position;
  const maxWords = input.mode === "minimal" ? 14 : limits[position];
  const angle = input.angle || DJ_ANGLES[Math.floor(random() * DJ_ANGLES.length)]!;
  const context = [
    `Position: ${position}; maximum ${maxWords} words. Mode: ${input.mode}. Angle: ${angle}.`,
    `Previous track: ${input.prev ? `${input.prev.title} by ${input.prev.artist}` : "none"}.`,
    `Next track: ${input.next ? `${input.next.title} by ${input.next.artist}` : "none"}.`,
    ...(input.mode === "full" ? [`Stored fact about previous track: ${input.factPrev ?? "none"}.`, `Stored fact about next track: ${input.factNext ?? "none"}.`, `Stored artist bio: ${input.bio ?? "none"}.`] : []),
    `Station or playlist: ${input.stationName ?? "none"}. Listener first name: ${input.personName}.`,
    input.mode === "minimal" ? "Only announce song title and artist. No aside." : position === "transition" ? "Name the song that ended, include at most one true aside only when a supplied stored fact exists, and tease the next song." : "Keep the introduction or sign-off brief; announce the next song when present.",
  ].join("\n");
  try {
    const result = await completion("chat", [
      { role: "system", content: `${voice}\n${DJ_LINE_PROMPT}` },
      { role: "user", content: context },
    ], { max_tokens: 192, temperature: 0.7, thinking: false });
    if (!result.ok) return null;
    const text = result.value.text.trim().replace(/^['“”]+|['“”]+$/g, "").trim();
    if (!text || /[\p{Extended_Pictographic}]/u.test(text) || wordCount(text) > maxWords) return null;
    if (input.mode === "minimal" && ![input.prev, input.next].filter((v): v is DjTrack => !!v).every((track) => text.toLowerCase().includes(track.title.toLowerCase()) && text.toLowerCase().includes(track.artist.toLowerCase()))) return null;
    if (position === "transition" && input.prev && !text.toLowerCase().includes(input.prev.title.toLowerCase())) return null;
    return text;
  } catch { return null; }
}

export async function synthesizeDjLine(text: string, voice: string, speech: typeof synthesizeSpeech = synthesizeSpeech): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  try {
    const result = await speech(text, voice);
    if (!result.ok) return null;
    return { bytes: new Uint8Array(await new Response(result.value.stream).arrayBuffer()), contentType: result.value.contentType };
  } catch { return null; }
}

export function saveDjLine(person: Pick<PersonRow, "id">, input: { mediaId: string; position: DjPosition; audioPath: string; wordsCount: number }, now = new Date()) {
  const createdAt = now.toISOString(), expiresAt = new Date(now.getTime() + 24 * 60 * 60_000).toISOString();
  const row = { id: randomUUID(), personId: person.id, mediaId: input.mediaId, position: input.position, audioPath: input.audioPath, wordsCount: input.wordsCount, createdAt, expiresAt, hlc: nextHlc() };
  db.insert(musicDjLines).values(row).run();
  const excess = db.select({ id: musicDjLines.id }).from(musicDjLines).orderBy(asc(musicDjLines.createdAt)).all().slice(0, Math.max(0, db.select({ count: sql<number>`count(*)` }).from(musicDjLines).get()!.count - 200));
  for (const item of excess) deleteDjLine(item.id);
  return row;
}

function deleteDjLine(id: string): boolean {
  const row = db.select().from(musicDjLines).where(eq(musicDjLines.id, id)).get();
  if (!row) return false;
  try {
    const file = db.select().from(attachments).where(and(eq(attachments.storagePath, row.audioPath), eq(attachments.ownerPersonId, row.personId))).get();
    if (file) { const blob = purgeFileRecord(file); if (blob) removeFileBlobs([blob]); }
  } catch { /* cache row still has to expire */ }
  db.delete(musicDjLines).where(eq(musicDjLines.id, id)).run();
  return true;
}

export function pruneDjLines(now = new Date()): number {
  const rows = db.select().from(musicDjLines).where(lte(musicDjLines.expiresAt, now.toISOString())).all();
  for (const row of rows) deleteDjLine(row.id);
  return rows.length;
}

export function consumeDjLine(person: Pick<PersonRow, "id">, mediaId: string, position: DjPosition, now = new Date()) {
  pruneDjLines(now);
  const row = db.select().from(musicDjLines).where(and(eq(musicDjLines.personId, person.id), eq(musicDjLines.mediaId, mediaId), eq(musicDjLines.position, position), gt(musicDjLines.expiresAt, now.toISOString()))).get();
  if (!row) return null;
  const attachment = db.select().from(attachments).where(and(eq(attachments.storagePath, row.audioPath), eq(attachments.ownerPersonId, person.id), isNull(attachments.deletedAt))).get();
  if (!attachment) { db.delete(musicDjLines).where(eq(musicDjLines.id, row.id)).run(); return null; }
  const path = attachmentFilePath(attachment.storagePath);
  const bytes = new Uint8Array(readFileSync(path));
  deleteDjLine(row.id);
  return { id: row.id, mediaType: attachment.mediaType, bytes };
}

export function deleteCachedDjLine(person: Pick<PersonRow, "id">, mediaId: string, position: DjPosition): boolean {
  const row = db.select().from(musicDjLines).where(and(eq(musicDjLines.personId, person.id), eq(musicDjLines.mediaId, mediaId), eq(musicDjLines.position, position))).get();
  return row ? deleteDjLine(row.id) : false;
}

export async function ensureDjLines(person: PersonRow, afterId: string, nextIds: readonly string[], deps: { complete?: Complete; random?: () => number; synthesize?: typeof synthesizeSpeech; voice?: typeof voiceForSpeech; stationName?: string | null } = {}): Promise<void> {
  const mode = getPersonSettingValue(person, "music.dj");
  if (mode !== "minimal" && mode !== "full") return;
  pruneDjLines();
  const queue = [afterId, ...nextIds.slice(0, 2)];
  const keys = new Set<string>();
  for (const mediaId of queue.slice(1)) {
    const key = `${person.id}:${mediaId}`;
    if (keys.has(key)) continue; keys.add(key);
    await scheduleBackground(key, person.id, async () => {
      try {
        const next = readableItem(person, mediaId); if (!next || next.kind !== "track") return;
        const previousId = queue[queue.indexOf(mediaId) - 1];
        const previous = previousId ? readableItem(person, previousId) : null;
        const prev = previous?.kind === "track" ? previous : null;
        const selected = resolvePersona(getPersonSettingValue(person, "persona.active_id"));
        const angle = DJ_ANGLES[Math.floor((deps.random ?? Math.random)() * DJ_ANGLES.length)]!;
        const positions: DjPosition[] = queue.indexOf(mediaId) === 1 ? ["intro", "transition"] : [prev ? "transition" : "intro"];
        for (const position of positions) {
        const existing = db.select({ id: musicDjLines.id }).from(musicDjLines).where(and(eq(musicDjLines.personId, person.id), eq(musicDjLines.mediaId, mediaId), eq(musicDjLines.position, position), gt(musicDjLines.expiresAt, new Date().toISOString()))).get();
        if (existing) continue;
        const spokenPrev = position === "transition" ? prev : null;
        const input: DjLineInput = { position, prev: spokenPrev ? { title: spokenPrev.title, artist: spokenPrev.artist ?? "" } : null, next: { title: next.title, artist: next.artist ?? "" }, factPrev: spokenPrev ? songFactFor(spokenPrev, person)?.summary ?? null : null, factNext: songFactFor(next, person)?.summary ?? null, bio: artistProfileFor(next.musicbrainz_artist_id)?.bio ?? null, stationName: deps.stationName ?? null, personName: person.displayName.split(/\s+/)[0]!, angle, mode };
        const manifest = getHouseholdCompanion(selected.id);
        const savedVoice = getHouseholdSettingValue(companionVoiceKey(selected.id));
        const companionVoice = typeof savedVoice === "string" && savedVoice !== "default" ? savedVoice : manifest?.companion?.voice_id;
        const voice = (deps.voice ?? voiceForSpeech)({ actor: person, ...(companionVoice ? { companionVoice } : {}) });
        const startedAt = Date.now();
        const text = await writeDjLine(input, deps.complete ?? complete, deps.random, composePersonaPrompt(selected, "spoken"));
        if (!text || !bandAllows(person, { band_ok: "child", title: next.title, artist: next.artist ?? null, description: text, subtitle: null, advisory: { explicit: false } } as never)) return;
        const speech = await synthesizeDjLine(text, voice, deps.synthesize);
        if (!speech) return;
        const id = newFileId();
        const stored = storeFile(person, { conversationId: null, turnId: null, mediaType: speech.contentType || "audio/wav", bytes: speech.bytes, retention: "kept", provenance: `music-dj:${id}`, deduplicate: false, name: "DJ line" });
        if (!stored.ok) return;
        saveDjLine(person, { mediaId, position, audioPath: stored.value.storage_path, wordsCount: wordCount(text) });
        console.info(`[music-dj] words=${wordCount(text)} ms=${Date.now() - startedAt}`);
        }
      } catch { /* A failed DJ tool leaves playback untouched. */ }
    });
  }
}

const inFlight = new Map<string, Promise<void>>();
const queued = new Map<string, { job: QueueJob; run: () => Promise<void> }>();
registerQueueProvider(() => [...queued.values()].map(({ job, run }) => ({ job, release: job.state === "queued" ? async () => {
  job.state = "running";
  try { await run(); } finally { queued.delete(job.id); void refreshHouseholdQueue(); }
} : undefined, save: () => {} })));
function scheduleBackground(key: string, personId: string, work: () => Promise<void>): Promise<void> {
  return coalesce(key, () => new Promise<void>((resolve) => {
    const id = `dj-${randomUUID()}`;
    const job: QueueJob = { id, personId, jobClass: "other", category: "background", state: "queued", createdAt: Date.now(), typicalSeconds: 2 };
    queued.set(id, { job, run: async () => { try { await work(); } finally { resolve(); } } });
    void refreshHouseholdQueue();
  }));
}
async function coalesce(key: string, work: () => Promise<void>): Promise<void> {
  const prior = inFlight.get(key); if (prior) return prior;
  const current = work().finally(() => { if (inFlight.get(key) === current) inFlight.delete(key); });
  inFlight.set(key, current); return current;
}
