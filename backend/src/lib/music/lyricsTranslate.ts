import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { musicLyricTranslations } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import { complete } from "@/lib/llm";
import type { PersonRow } from "@/types";
import { readableItem } from "@/lib/media/access";
import { trips } from "@/lib/media/band";
import { getPersonSettingValue } from "@/lib/settings";

export const LYRICS_TRANSLATION_PROMPT = "Translate each numbered lyric line into the requested language. Keep the same number and order of lines. Return only one translated line per input line, without numbering or commentary. Preserve names and song structure tags.";
export const sourceHash = (lines: string[]) => createHash("sha256").update(lines.join("\n")).digest("hex");

export async function translateLines(lines: string[], language: string, translate: (language: string, batch: string[]) => Promise<string[]>): Promise<(string | null)[]> {
  const result: (string | null)[] = Array(lines.length).fill(null);
  for (let offset = 0; offset < lines.length; offset += 18) {
    const batch = lines.slice(offset, offset + 18);
    try {
      const translated = await translate(language, batch);
      if (translated.length === batch.length && translated.every((line) => line.trim().length > 0)) {
        translated.forEach((line, index) => { result[offset + index] = line.trim(); });
      }
    } catch { /* A failed tool leaves these source lines untranslated. */ }
  }
  return result;
}

export async function localTranslate(language: string, lines: string[]): Promise<string[]> {
  const numbered = lines.map((line, index) => `${index + 1}. ${line}`).join("\n");
  const result = await complete("chat", [{ role: "user", content: `${LYRICS_TRANSLATION_PROMPT}\nLanguage: ${language}\n${numbered}` }], { max_tokens: Math.min(2048, 256 + lines.join("\n").length), temperature: 0.1, thinking: false });
  if (!result.ok || !result.value.text.trim()) throw new Error("translation unavailable");
  return result.value.text.trim().split(/\r?\n/).map((line) => line.replace(/^\s*\d+[.)]\s*/, "").trim());
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

export async function fillTranslation(mediaId: string, language: string, lines: string[]): Promise<void> {
  const started = Date.now();
  const hash = sourceHash(lines);
  const translated = await translateLines(lines, language, localTranslate);
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

export function readableLyrics(person: PersonRow, mediaId: string): string[] | null {
  const item = readableItem(person, mediaId);
  const lyrics = item?.lyrics;
  return item?.kind === "track" && lyrics?.timed?.length ? lyrics.timed.map((line: { line: string }) => line.line) : null;
}

export function cachedMadeTranslation(mediaId: string, language: string, lines: string[]): (string | null)[] | null {
  return cachedTranslation(`made:${mediaId}`, language, lines);
}

export async function fillMadeTranslation(mediaId: string, language: string, lines: string[]): Promise<void> {
  return fillTranslation(`made:${mediaId}`, language, lines);
}
