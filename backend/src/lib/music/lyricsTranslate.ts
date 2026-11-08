import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { musicLyricTranslations } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import { translateItems, type Completer } from "@/lib/translate/core";
import { hubCompleter } from "@/lib/translate/engine";
import type { PersonRow } from "@/types";
import { trips } from "@/lib/media/band";
import { getPersonSettingValue } from "@/lib/settings";

export const sourceHash = (lines: string[]) => createHash("sha256").update(lines.join("\n")).digest("hex");

export async function translateLines(lines: string[], language: string, translate: (language: string, batch: string[]) => Promise<string[]>): Promise<(string | null)[]> {
  const completer: Completer = async (messages) => {
    try {
      const batch: unknown = JSON.parse(messages[1]?.content ?? "");
      if (!Array.isArray(batch) || !batch.every((line) => typeof line === "string")) return { ok: false };
      const result = await translate(language, batch as string[]);
      return { ok: true, text: JSON.stringify(result) };
    } catch { return { ok: false }; }
  };
  return (await translateItems({ items: lines, from: "the original language", to: language, kind: "lyric", completer })).results;
}

export function cachedTranslation(mediaId: string, language: string, lines: string[]): (string | null)[] | null {
  const hash = sourceHash(lines);
  const row = db.select().from(musicLyricTranslations).where(and(eq(musicLyricTranslations.mediaId, mediaId), eq(musicLyricTranslations.language, language))).get();
  if (!row) return null;
  if (row.sourceHash !== hash) {
    db.delete(musicLyricTranslations).where(eq(musicLyricTranslations.id, row.id)).run();
    return null;
  }
  try { const parsed = JSON.parse(row.linesJson); return Array.isArray(parsed) && parsed.length === lines.length ? parsed : null; } catch { return null; }
}

export async function fillTranslation(mediaId: string, language: string, lines: string[], keep?: string[]): Promise<void> {
  const started = Date.now();
  const hash = sourceHash(lines);
  const result = await translateItems({ items: lines, from: "the original language", to: language, kind: "lyric", completer: hubCompleter(), keep });
  const translated = result.results;
  // The band check stays the ingest-time trips() check.
  // A translation that trips the same text check lyrics pass at ingest is dropped, never stored (rule 0: the band outranks the toggle).
  if (translated.some((line) => line === null || trips(line))) return;
  const existing = db.select({ id: musicLyricTranslations.id }).from(musicLyricTranslations).where(and(eq(musicLyricTranslations.mediaId, mediaId), eq(musicLyricTranslations.language, language))).get();
  if (existing) db.update(musicLyricTranslations).set({ sourceHash: hash, linesJson: JSON.stringify(translated), createdAt: new Date().toISOString(), hlc: nextHlc() }).where(eq(musicLyricTranslations.id, existing.id)).run();
  else db.insert(musicLyricTranslations).values({ id: randomUUID(), mediaId, language, sourceHash: hash, linesJson: JSON.stringify(translated), createdAt: new Date().toISOString(), hlc: nextHlc() }).run();
  console.info(`[music-lyrics-translation] lines=${lines.length} ms=${Date.now() - started}`);
}

// Pronunciation lines are intentionally deferred to the next slice; this module translates only.

export function translationLanguage(person: PersonRow): string {
  const value = getPersonSettingValue(person, "music.lyrics_translate");
  return typeof value === "string" ? value.trim() : "";
}

export function cachedMadeTranslation(mediaId: string, language: string, lines: string[]): (string | null)[] | null {
  return cachedTranslation(`made:${mediaId}`, language, lines);
}

export async function fillMadeTranslation(mediaId: string, language: string, lines: string[], keep?: string[]): Promise<void> {
  return fillTranslation(`made:${mediaId}`, language, lines, keep);
}
