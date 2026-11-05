import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { clonedVoices } from "@/db/schema";
import { transcribeAudioClip } from "@/lib/stt";

const pending = new Map<string, Promise<string | null>>();
let transcriber: typeof transcribeAudioClip = transcribeAudioClip;
export function __setClonedVoiceTranscriberForTests(fn: typeof transcribeAudioClip | null): void {
  transcriber = fn ?? transcribeAudioClip;
}

export function normalizeVoiceTranscript(text: string): string | null {
  const normalized = text.trim().slice(0, 1000).trim();
  return normalized || null;
}

export function updateClonedVoiceTranscript(id: string, text: string): string | null {
  const transcript = normalizeVoiceTranscript(text);
  if (!transcript) return null;
  db.update(clonedVoices).set({ transcript }).where(and(eq(clonedVoices.id, id), isNull(clonedVoices.transcript))).run();
  return db.select({ transcript: clonedVoices.transcript }).from(clonedVoices).where(eq(clonedVoices.id, id)).get()?.transcript ?? null;
}

export function transcribeClonedVoiceOnce(id: string, bytes: Uint8Array, mimeType: string): Promise<string | null> {
  const existing = pending.get(id);
  if (existing) return existing;
  const task = (async () => {
    try { return updateClonedVoiceTranscript(id, await transcriber(bytes, mimeType)); }
    catch { return null; }
    finally { pending.delete(id); }
  })();
  pending.set(id, task);
  return task;
}
