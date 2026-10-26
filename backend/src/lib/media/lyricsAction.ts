// LYRICS-LOOKUP: the single "look up lyrics" action behind the music player's
// lyrics button. Every gate from the app's eligibility check (readability, band,
// the household setting, scanned-vs-generated, a title and an artist, the
// one-lookup-per-track receipt) runs here before the network call, and the
// paused state (lyricsReceipts) plus the shared one-per-second bucket
// (rateLimiter) keep the hub from hammering lrclib.net. A hit is re-checked
// against the reader's band before it is stored, so lyrics never serve to a
// band the text would fail.
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { mediaItems, mediaSources } from "@/db/schema";
import type { PersonRow } from "@/types";
import { getHouseholdSettingValue } from "@/lib/settings";
import { tryConsume } from "@/lib/rateLimiter";
import { readableIn } from "./appHost";
import { bandAllows, mediaBandOf } from "./band";
import { lookupLyrics } from "./lyricsLookup";
import { hasReceipt, isPaused, recordReceipt, recordRefusal, recordSuccess } from "./lyricsReceipts";
import type { MediaItem } from "./model";

// One lookup per second across the whole household for this host (the shared
// net bucket the music app declares).
const LOOKUP_BUCKET_KEY = "net:lyrics:lrclib.net";

// The scanned-track test the music app's eligibility check reuses (musicApp.ts):
// a track a real music source scanned in, never a generated-library song.
function isScannedTrack(item: MediaItem): boolean {
  if (item.provenance === "music:generated-library") return false;
  if (!item.source_id || item.source_id.startsWith("msrc-made")) return false;
  return db.select({ id: mediaSources.id }).from(mediaSources).where(eq(mediaSources.id, item.source_id)).get() !== undefined;
}

export type LookupResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; status: 400 | 403 | 404 | 429; error: string };

export async function lookupLyricsFor(
  person: PersonRow,
  mediaId: unknown,
  deps?: { fetch?: typeof fetch; nowMs?: () => number },
): Promise<LookupResult> {
  const now = deps?.nowMs?.() ?? Date.now();
  const item = typeof mediaId === "string" ? readableIn(person, "music", mediaId) : null;
  if (!item) return { ok: false, status: 404, error: "That song is not in the library." };

  const currentLyrics = bandAllows(person, item) ? item.lyrics : null;
  const fields: Record<string, unknown> = currentLyrics
    ? { lyrics: currentLyrics.text, ...(currentLyrics.timed ? { timed_lyrics: currentLyrics.timed } : {}) }
    : {};

  // No request (any one of): lyrics already there, the setting off, a child, a
  // generated song, no title or artist, or this track was already looked up.
  if (currentLyrics) return { ok: true, value: { lookup: "none", ...fields } };
  if (getHouseholdSettingValue("music.lyrics_online") === false) return { ok: true, value: { lookup: "none", ...fields } };
  if (mediaBandOf(person) === "child") return { ok: true, value: { lookup: "none", ...fields } };
  if (!isScannedTrack(item)) return { ok: true, value: { lookup: "none", ...fields } };
  const title = item.title;
  const artist = item.artist;
  if (artist === null || artist === "" || title === "") return { ok: true, value: { lookup: "none", ...fields } };
  if (hasReceipt(item.id)) return { ok: true, value: { lookup: "none", ...fields } };

  // Paused (after a refusal or a 429) and the shared bucket both answer
  // without fetching.
  if (isPaused(now)) return { ok: true, value: { lookup: "paused" } };
  if (!tryConsume(LOOKUP_BUCKET_KEY, { capacity: 1, refillPerSecond: 1 }, now)) return { ok: true, value: { lookup: "paused" } };

  const outcome = await lookupLyrics({ title, artist, album: item.album, durationS: item.duration_s }, { fetch: deps?.fetch });
  if (outcome.outcome === "refused") {
    recordRefusal(now);
    return { ok: true, value: { lookup: "paused" } };
  }
  if (outcome.outcome === "miss") {
    recordSuccess();
    recordReceipt(item.id, "miss", now);
    return { ok: true, value: { lookup: "none" } };
  }
  // A hit: remember it was tried either way, then re-check the text against
  // this reader's band before storing it (lyrics never serve to a failing band).
  recordSuccess();
  recordReceipt(item.id, "hit", now);
  const newLyrics = { source: "lrclib", text: outcome.text, ...(outcome.timed ? { timed: outcome.timed } : {}) };
  if (!bandAllows(person, { ...item, lyrics: newLyrics })) return { ok: true, value: { lookup: "none" } };
  db.update(mediaItems).set({ lyrics: JSON.stringify(newLyrics) }).where(eq(mediaItems.id, item.id)).run();
  return {
    ok: true,
    value: { lookup: "found", lyrics: outcome.text, ...(outcome.timed ? { timed_lyrics: outcome.timed } : {}) },
  };
}
