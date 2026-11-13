# The creation store (CREATOR-02)

One record per made item says what it was made from. The shape is the spec `creation-record` (commons `spec`, pinned `spec-v0.1.378`); the design is
[creatoros-port-2026-11-13.md](../design/creatoros-port-2026-11-13.md) section 7.

- **Tables.** `creations` (one row per item, the record as JSON in `body`, plus `person_id`, `kind`, `parent_id`, `review`, `made_audience`, `lock`,
  `file_ids`, `job_ids`) and `creation_cast` (the derived index of who is cast; written in the same transaction; `rebuildCreationCast()` rebuilds it).
  Migration `0194_creations`, schema version 145.
- **One writer.** `lib/creations/store.ts` `recordCreation`. It never throws and never fails the item. A second call for the same main file updates that
  record (a film's cut is first the clip the edit job made, then becomes the film).
- **Who calls it, and when.** Only a finished job's writer, after its files are stored, never from a live plan: picture jobs (`pictures/jobs.ts`), clips
  and edits including reference videos (`videos/jobs.ts` `settleClip`), Picture Studio saves (`imageEdit.ts` `saveVersion`), long takes
  (`videos/longTake.ts`) and finished films (`films/background.ts`). The builders are in `creations/writers.ts`. A temporary chat stores no file and keeps no
  record. The file note gains `"creation":"crt-..."`.
- **Reference recipe.** `ReferenceRecipe` stays on the job's request as the working copy (old readers keep working). The record carries what the spec can
  hold: sheets and pictures as `sources`, the person's request and the whole prompt as `words`, route and seconds in `settings`, the first-picture notes and
  the face check in `checks`. Panels, the sheet description and the provided-as-is flags have no spec field yet.
- **Another take.** `markAnotherTake` puts `anotherOf` on the new job's request; the new clip's record gets the old clip's record as `parent_id`. A
  Picture Studio save and an edit take the source file's record as parent.
- **Read.** `GET /api/creations/by-file/:fileId`, the maker only. A hidden item (a file that is not theirs, trashed, a minor and an adult-only item) answers
  404; a locked one answers 423 with the lock tile and nothing else. The record's mark and the file's live mark are both checked (the stricter wins), through
  `canReadFileAudience`, `lockState` and `fileLockState`. A parent the viewer could not open is not named.
- **Marks.** `made_audience` and `lock` are the maximum over the made files, the source files and the parent, by `newItemMark`. When the creator marks or
  clears the lock, or a recheck lowers a picture's audience, `syncCreationMarkForFile` brings the record back in line.
- **Purge.** `purgeFileRecord` calls `dropCreationsForFile`: the main file takes the record and its cast; a purged poster or 5.1 sibling only leaves the
  list. Trash keeps the record (the read answers 404 while the file is trashed). Deleting a person deletes their records.
- **Back-fill.** An item made before the store has no record; when its maker opens it, `backfillCreationForFile` rebuilds it from the picture or video job
  row that made it (same builders). An item whose job row is gone has none.
- **Not here.** Credits (CREATOR-03) and the cast (CREATOR-04): `cast` is empty except for the picture subjects the job already named.
