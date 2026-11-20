// FILM-KEEP-01: a film's song is made inside a hidden chat turn (retention "conversation"). It stays only while that chat does; once the person deletes the chat the
// library reclaim may take it and the film cannot be finished again. Pinning it as a kept file ties it to the film instead.
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { attachments } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";

export function pinFilmSong(ownerPersonId: string, fileId: string, name: string): void {
  db.update(attachments).set({ retention: "kept", name, hlc: nextHlc() })
    .where(and(eq(attachments.id, fileId), eq(attachments.ownerPersonId, ownerPersonId), isNull(attachments.deletedAt))).run();
}
