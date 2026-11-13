# Video: what comes over from Loki Doki (VIDEO-LD-PORT-01)

Status: design note, 2026-11-13. Owner asked (2026-11-12) to review Loki Doki's video side and bring over its features, UI, organization and flow; he chose all four groups below. Loki Doki is the archived repo (read only). Rule V1 (live video services) governs: nothing here sends a request to YouTube or any live video service, and the Loki Doki sources (YouTube, Reddit, TikTok, Vimeo, "Clip a Link") are not carried.

## Supersedes
- `docs/design/media-apps-blend-2026-10-17.md` row "Family picks, moments, votes, recap": it said drop (no family use recorded). The owner's choice of 2026-11-12 reverses it for Family Picks and moments; recap stays dropped.
- Nothing else. `docs/design/video-studio-2026-11-02.md` section 6.1 and the LoRA note (`docs/design/video-loras-2026-11-02.md`) section 3.7 are NOT superseded: VIDEO-LD-03b saves only plans with no locked or adult-only source, so what those sections protect (an edit of a locked clip never outlives the page) still holds.

## What Loki Doki's video actually was
Generators AnimateDiff-XL (text to video, 16 to 24 frames) and Stable Video Diffusion XT (image to video); Home's LTX family replaces both. Around them: a Videos hub (billboard, chip row, shelves, Mine), a Studio editor (one video track: trim, split, reorder, speed, mute, undo and redo, autosave, ffmpeg export), Family Picks (shared vote queue), Save as GIF, WebP or MP4, and a large watch page (transcript, Ask, moments, chapters, catch-me-up, resume, Watch Together, cast, year in review). Loki Doki's own half-built parts: a dead settings link, upscale text that pointed to nothing, no audio track or transitions in the editor, arrow-button reorder only.

## What Home's Video already has (read from code 2026-11-13; this changes the verdicts)
- Video home already has a billboard, a Channel picker, and shelves: Channels, Recently added (with filter chips), Made at home, Clips, Continue watching, New from your channels, More from your most watched, Watch again, From your videos. It has no grid or list toggle.
- The kit Player already has captions button, picture in picture, speed menu, chapters, resume, double-tap seek (15 s), hold for 2x and Up next with autoplay. It has no transcript follow-along, no Ask, no moments, no catch-me-up, no audio boost; Home video rows pass an empty captions list.
- The Video Studio already exists (VIDEO-STUDIO-01 to 07, `docs/design/video-studio-2026-11-02.md`): the kit `TrackStudio` with Video, Voice and Music lanes, trim, split, delete, reorder, per-clip level, lane mute and solo, fades, crossfade, undo and redo, and an export through the shared edit gate. It lacks per-clip speed, autosave, saved projects and export presets (the 9:16, 1:1, 16:9 and 4:5 shapes exist in `lib/videos/editPlan.ts` but the Studio does not offer them).
- Conversion: only a messages.mp4 (`convertForMessages`). No GIF, WebP or plain MP4 save-as.
- Collections: liked, watch_later, queue per person; shared playlists; share a clip with named people. No household vote or shared queue.
- My clips: tabs All, Favorites, Uploaded, all one grid; no Videos versus Projects split because there are no saved Studio projects.
- Kit cards: MediaShelf has wide, square and poster art, card or plain variants, density, progress overlay and press-scale; no blurred backdrop, no hover zoom, no per-item art colour scope.

## Verdicts (record a verdict first: rule 8 of the platform principles)
| Feature | Verdict | What is built, what comes over |
|---|---|---|
| Billboard and Continue watching on Video home | Already built | Nothing to port. |
| Home Big, Grid and List toggle | Rebuild small | A per-person setting and a kit shelf `layout` choice on Video home; later. |
| Hub card look (blurred backdrop, hover zoom) | Rebuild as a kit variant | Additive `MediaShelf` option `look: "backdrop"` in commons (blurred copy of the art behind a contained image, 1.03 hover zoom, reduced-motion off), pinned by tag, then selected on Video shelves. Rule 9: no Home CSS. First build. |
| Colours from the picture | Rebuild, later | Per-item accent scope from the art palette (Home has `useArtPalette`; kit has none); tokens only. |
| Studio editor | Already built; add the gaps | 03a: per-clip speed (`speedOps` exists in `editPlan.ts`) and export presets (reuse `VIDEO_ASPECTS`). 03b: autosave and saved projects for plans with no locked or adult-only source, with the lock rules below (6.1 and 3.7 stand). |
| My clips split into Your videos and Projects | After saved projects exist | Layout only once Projects exist. |
| Save as GIF, WebP, MP4 | Rebuild | New convert action beside `convertForMessages`: animated WebP and GIF with ffmpeg through the Stack, plain MP4 download; one job, one file, status through the existing job card (S6). |
| Family Picks | Rebuild | A new `kind` of the existing spec `media-collection` plus a votes field or small votes record (principles 1 and 4: no second collection record); anyone adds, everyone votes, top pick plays next; every clip passes the media access check; a child votes only on clips cleared for them. |
| Watch page: captions and transcript | Rebuild | Read CAPTION-01's `CaptionTrack` (CAPTION-01a, 01c, 01d) and fill the Player captions list for Video items; follow-along is the Player's own captions behaviour. |
| Watch page: moments | Rebuild | The spec's `media-progress.marks` (per-person bookmarks) already exists; list them under the player; the add action needs a kit Player callback for the current time. No new record. |
| Watch page: Ask and catch-me-up | Rebuild, later | Through the chat turn engine with the transcript as context, as PODCAST-PORT-05 does, so rules 0 and 10 gates apply; Ask uses kit chat Elements in the S2 right pane, never a new chat box. |
| Watch Together, cast, year in review | Not now | Separate designs. |
| Clip a Link, YouTube, Reddit, TikTok, Vimeo | Not carried | Rule V1 and the privacy rule. |
| AnimateDiff, SVD generators, old create form | Not carried | LTX and the Create page's recipes already do this. |
| Gestures, hold for 2x, double-tap | Already built | Kit Player has them. Audio boost: not carried (unsure it matters). |

## Locks, shared screens and the shared Look (answers the architect's conditions)
- Every output keeps its source's audience and lock: a converted clip (Save as) or an exported edit is never lower than its sources (video-studio section 6), and a locked or adult-only clip never becomes an open file.
- A Studio plan with any locked or adult-only source is never saved anywhere (browser or server); a saved project is deleted the moment it gains such a source or a source is relocked (VIDEO-LD-03b). Sections 6.1 of the Studio note and 3.7 of the LoRA note stand unchanged.
- Family Picks: a locked or adult-only clip cannot be added; vote counts and the top pick never reveal a hidden item; a shared screen or unknown viewer lists only all-ages clips, and the rule says minor (teens included), not only child; logs carry no voter (rule 6a).
- Watch page: Ask and moments are refused on a locked clip without proof (LoRA note 3.6 and 3.7); the moments list is a kit node, not a Home panel (rule 9(b)); the Player current-time callback is a kit change first (rule 9(c)).
- A shared screen or unknown viewer gets the child result (rule 0): Family Picks lists only all-ages clips there.
- The card backdrop is part of the shared Look (S2: one product across apps), not a Video-only skin; Audio, Image and Podcasts shelves can select it later.
- "Colours from the picture" is not filed: it may clash with the no fixed colours rule (2026-10-19) and needs the owner's answer first.

## Order of work
1. Card look: the commons `MediaShelf` backdrop variant, then Video shelves use it.
2. Save as (GIF, WebP, MP4).
3. Studio gaps: export presets, per-clip speed, then autosave and saved projects (spec first), then the My clips split.
4. Family Picks (spec first).
5. Watch page: captions and transcript, then moments, then Ask and catch-me-up.
Each step: reuse check, build through Codex, review the diff, run the tests, land, ship, verify.

## Rules that bind this work
- Rule 0: age and surface gates outrank everything; creation and editing surfaces are adult-only; a child sees only what is shared and cleared for them.
- Rule 9 (shipped parts only): Home CSS defines tokens only; looks are kit variants in commons, pinned by tag.
- S6: status reaches the person through the existing mechanisms; no new status UI. Progress for exports uses the existing job cards.
- V1: no request to any live video service.
- Principle 3: every new record has the shared spec shape (spec first in commons/spec, then Home).
- No em dashes; every error says what went wrong and what to do.
