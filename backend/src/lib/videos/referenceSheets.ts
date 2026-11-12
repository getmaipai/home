// REFVIDEO-01: which reference-sheet files belong to which video. Kept apart from referenceVideo.ts (which pulls in the sheet maker and the language model) so the Library's
// cleanup (libraryTrash.ts, libraryRetention.ts) can ask "does any other video still use this sheet?" without importing them. Pure reads of video_jobs and attachments.
import { sqlite } from "@/db";

/** The note a sheet file carries in its provenance (an unknown writer to the Library: it lists as a plain picture the person keeps). */
export const REFERENCE_SHEET_NOTE = "reference-sheet:";
export const isReferenceSheetFile = (row: { provenance: string }): boolean => row.provenance.startsWith(REFERENCE_SHEET_NOTE);

/** The sheet file ids a video job's request names (empty for any other video). */
export function sheetIdsOfRequest(requestJson: string): string[] {
  try {
    const request = JSON.parse(requestJson) as { reference?: { sheetFileIds?: unknown } };
    const ids = request.reference?.sheetFileIds;
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
  } catch { return []; }
}

/** Whether a video other than `exceptJobId` still uses this sheet: one being made, or a finished one whose clip file is still there. A failed or stopped video holds nothing. */
export function sheetUsedByOtherVideo(ownerId: string, sheetId: string, exceptJobId: string): boolean {
  const rows = sqlite.query<{ id: string; state: string; files: string }, [string, string, string]>(
    "SELECT id, state, files FROM video_jobs WHERE person_id = ? AND id != ? AND instr(request, ?) > 0",
  ).all(ownerId, exceptJobId, `"${sheetId}"`);
  for (const row of rows) {
    if (row.state === "queued" || row.state === "running") return true;
    if (row.state !== "done") continue;
    let clip: string | null = null;
    try { clip = (JSON.parse(row.files) as Array<{ id?: string }>)[0]?.id ?? null; } catch { /* no clip */ }
    if (!clip) continue;
    const live = sqlite.query<{ id: string }, [string]>("SELECT id FROM attachments WHERE id = ? AND deleted_at IS NULL").get(clip);
    if (live) return true;
  }
  return false;
}

/** The sheet files that travel with a video's clip: the ones its recipe names that no other video uses. The clip's family (companionsOf) carries them to Trash and to purge. */
export function sheetFilesOnlyUsedBy(ownerId: string, jobId: string): string[] {
  const row = sqlite.query<{ request: string }, [string, string]>("SELECT request FROM video_jobs WHERE id = ? AND person_id = ?").get(jobId, ownerId);
  if (!row) return [];
  return sheetIdsOfRequest(row.request).filter((id) => !sheetUsedByOtherVideo(ownerId, id, jobId));
}
