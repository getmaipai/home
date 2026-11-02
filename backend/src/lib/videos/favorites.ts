// VIDEO-UI-06: a person's Favorite mark on a Library clip. One row per person and clip (`video_favorites`), so a clip shared with a household
// member is a favorite of each person on their own, and the file itself is never touched. The mark is a private preference: it is read and
// written only for the signed-in person, and a clip the person cannot see in their own Library cannot be marked.
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { videoFavorites } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import { newVideoFavoriteId } from "@/lib/id";
import type { PersonRow } from "@/types";

/** Which of these Library files this person has marked. */
export function favoriteFileIds(person: PersonRow, fileIds: readonly string[]): Set<string> {
  if (fileIds.length === 0) return new Set();
  return new Set(db.select({ fileId: videoFavorites.fileId }).from(videoFavorites).where(and(eq(videoFavorites.personId, person.id), inArray(videoFavorites.fileId, [...fileIds]))).all().map((row) => row.fileId));
}

export function isFavoriteFile(person: PersonRow, fileId: string): boolean {
  return favoriteFileIds(person, [fileId]).has(fileId);
}

/** Mark or unmark a file for this person. `on` left out flips the mark. Returns the mark as it now is (both directions are idempotent). */
export function setFavoriteFile(person: PersonRow, fileId: string, on?: boolean): boolean {
  const had = isFavoriteFile(person, fileId);
  const want = on ?? !had;
  if (want && !had) db.insert(videoFavorites).values({ id: newVideoFavoriteId(), personId: person.id, fileId, createdAt: new Date().toISOString(), hlc: nextHlc(), provenance: `person:${person.id}` }).onConflictDoNothing().run();
  if (!want && had) db.delete(videoFavorites).where(and(eq(videoFavorites.personId, person.id), eq(videoFavorites.fileId, fileId))).run();
  return want;
}
