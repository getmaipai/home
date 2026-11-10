// MEDIA-PARITY-02 (Videos): "Remove from history". The History page lists the videos a person has progress on; removing one deletes that person's own
// progress row for it (their place in it and its played mark) and nothing else: the video, its channel, the other people's progress and the playlists
// it is on are untouched.
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { mediaProgress } from "@/db/schema";
import type { PersonRow } from "@/types";
import { flushProgress } from "@/lib/media/progress";
import type { ActionResult } from "@/lib/media/appHost";

export function removeFromHistory(person: PersonRow, args: Record<string, unknown>): ActionResult<{ removed: boolean }> {
  const mediaId = typeof args.media_id === "string" ? args.media_id : "";
  if (!mediaId) return { ok: false, status: 400, error: "Choose a video to remove from your history, then try again." };
  flushProgress(person.id); // a held tick would otherwise write the row back a moment after it is deleted
  const gone = db.delete(mediaProgress).where(and(eq(mediaProgress.personId, person.id), eq(mediaProgress.mediaId, mediaId))).returning({ id: mediaProgress.id }).all();
  return { ok: true, value: { removed: gone.length > 0 } };
}
