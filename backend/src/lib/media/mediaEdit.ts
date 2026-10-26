// MEDIA-DETAIL-04b: edit a media item's title, description, artist or cover. Only an adult, the owner or an admin may; an item the
// person cannot read is never edited. Each changed field joins `locked_fields` so a rescan keeps it, and the band is checked again
// on the new words: it may get stricter, never looser.
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments, mediaItems } from "@/db/schema";
import { canReadFileAudience, isOwnerOrAdmin } from "@/lib/access";
import { nextHlc } from "@/lib/hlc";
import type { PersonRow } from "@/types";
import { readableIn, type MediaAppId } from "./appHost";
import { mediaBandOf, trips } from "./band";

type Result = { ok: true; value: Record<string, unknown> } | { ok: false; status: 400 | 403 | 404; error: string };
type Field = "title" | "description" | "artist" | "artwork";

const fail = (status: 400 | 403 | 404, error: string): Result => ({ ok: false, status, error });

/** Plain text: tags removed, whitespace collapsed, ends trimmed. */
const plain = (value: string): string => value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

function artworkId(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { file_id?: string };
    return typeof parsed.file_id === "string" ? parsed.file_id : null;
  } catch {
    return null;
  }
}

export function editMediaItem(person: PersonRow, appId: MediaAppId, body: Record<string, unknown>): Result {
  if (!isOwnerOrAdmin(person) && mediaBandOf(person) !== "adult") return fail(403, "You can't edit this.");
  const id = typeof body.id === "string" ? body.id : "";
  const item = id ? readableIn(person, appId, id) : null;
  if (!item) return fail(404, "That item is not in the library.");
  if ("artist" in body && body.artist !== undefined && item.kind !== "track") return fail(400, "Only songs have an artist.");

  const row = db.select().from(mediaItems).where(eq(mediaItems.id, item.id)).get();
  if (!row) return fail(404, "That item is not in the library.");
  const current = { title: row.title, description: row.description, artist: row.artist, artwork: artworkId(row.artwork) };
  const set: Partial<Record<Field, string | null>> = {};

  if (body.title !== undefined) {
    const title = plain(String(body.title ?? ""));
    if (title.length < 1) return fail(400, "A title is needed.");
    if (title.length > 200) return fail(400, "That title is too long.");
    if (title !== current.title) set.title = title;
  }
  if (body.description !== undefined) {
    const description = plain(String(body.description ?? ""));
    if (description.length > 4000) return fail(400, "That description is too long.");
    const next = description === "" ? null : description;
    if (next !== current.description) set.description = next;
  }
  if (body.artist !== undefined) {
    const artist = plain(String(body.artist ?? ""));
    if (artist.length > 200) return fail(400, "That artist is too long.");
    const next = artist === "" ? null : artist;
    if (next !== current.artist) set.artist = next;
  }
  if (body.artwork !== undefined) {
    if (body.artwork === null) {
      if (current.artwork !== null) set.artwork = null;
    } else {
      const fileId = typeof body.artwork === "string" ? body.artwork : "";
      const file = /^file-[a-z0-9]{6,}$/.test(fileId) ? db.select().from(attachments).where(eq(attachments.id, fileId)).get() : undefined;
      if (!file || file.deletedAt !== null || !file.mediaType.startsWith("image/") || !canReadFileAudience(person, file)) return fail(400, "That picture is not available.");
      if (fileId !== current.artwork) set.artwork = fileId;
    }
  }

  const changed = Object.keys(set) as Field[];
  if (changed.length === 0) return { ok: true, value: { id: item.id, ...current } };

  const existing = ((): string[] => { try { return row.lockedFields ? (JSON.parse(row.lockedFields) as string[]) : []; } catch { return []; } })();
  const locked = [...new Set([...existing, ...changed])];
  const next = { title: set.title ?? current.title, description: "description" in set ? set.description! ?? null : current.description, artist: "artist" in set ? set.artist ?? null : current.artist };
  const text = [next.title, next.artist, row.album, row.albumArtist, next.description].filter((part): part is string => typeof part === "string" && part.trim().length > 0).join(". ");
  const bandOk = row.bandOk === "adult" || trips(text) ? "adult" : row.bandOk;

  const update: Partial<typeof mediaItems.$inferInsert> = { lockedFields: JSON.stringify(locked), hlc: nextHlc(), provenance: "hub:edit", bandOk };
  if (changed.includes("title")) update.title = next.title;
  if (changed.includes("description")) update.description = next.description;
  if (changed.includes("artist")) update.artist = next.artist;
  if (changed.includes("artwork")) update.artwork = set.artwork ? JSON.stringify({ file_id: set.artwork }) : null;
  db.update(mediaItems).set(update).where(eq(mediaItems.id, item.id)).run();

  return { ok: true, value: { id: item.id, title: next.title, description: next.description, artist: next.artist, artwork: "artwork" in set ? set.artwork ?? null : current.artwork } };
}
