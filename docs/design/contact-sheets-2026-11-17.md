# Contact sheets (CONTACT-SHEET-01)

**Verdict: REBUILD** as one Home feature. The video session's showcase script and the FLUX 3 bench sheets were one-off scripts for one model
set (`data-scratch/showcase`, `flux3-bench`), so they stay as the spec for the look and are not ported.

**Search first (2026-11-17).** The H3-SHEET rows (H3-SHEET-STACK-01, -HOME-01, -BENCH-01) and `films/sheetMaker.ts` are character sheets:
one person from messy photos, drawn by a model. A contact sheet draws nothing: it lays out pictures that already exist. They share no code
and no record. LONGFORM-04 names a "scene contact sheet" for dailies; it can call this builder when it is built. `picture.combine` merges
pictures with a model, so it is a different job. `pictures/keyframes.ts` already pulls frames out of a clip and is reused.

## Shape

- Input: Library file ids (pictures, or clips: N frames per clip, 1 to 8, default 3), up to 24 files. Or `sections`: one section per
  prompt with one file per model (compare mode). One builder, `lib/contactSheet.ts`, any model, any library selection.
- Layout: dark board, optional title, a caption per section (the prompt, or the clip name), tiles in square cells, up to 8 per row,
  at most 4096 px wide. Labels: `none`, `name`, or `details` (name, model, size and seconds when the file records them).
- Output: one new kept picture in the Library (`picture-gen` note with `contact_sheet: true`), adult-only when any source is.
  Only the owner's own, unlocked, non-Trash files go on a sheet; anything else is refused in plain words.
- Entry points: the Library's batch bar ("Contact sheet", with Select), `POST /api/library/contact-sheet` (ids, sections, per_clip,
  columns, title, labels) for scripts and other sessions, and the chat picture tool as `picture.contact_sheet` (the source is the first
  picture, `args.items` lists the rest, `args.sections` is compare mode).
- No picture model runs, so a sheet takes a few seconds and answers in one request. Activity rows are not used; clip decoding is
  the slow part (a few seconds per clip).
- Not built: choosing compare pairs in the Library screen (the API and chat tool have it), and an Activity row for very long clip lists.
