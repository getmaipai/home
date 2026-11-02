# Videos in chat: generate, remix, edit, mix (design draft, 2026-11-02)

Status (2026-11-02): proposed; architect ruling pending. No code. Item: VIDEO-CHAT-01. Implements the chat half of
[video-create-2026-11-01.md](video-create-2026-11-01.md) section 7 (every Create item has a chat tool and a card) for the Create screen in
[video-create-ui-2026-11-02.md](video-create-ui-2026-11-02.md), on the tiers in [video-tiers-2026-11-02.md](video-tiers-2026-11-02.md).
Rule S7 is only proposed (branch `wt/fair-heron-music-chat-cards-note`); this note follows it as a plan, not as authority.

## Supersedes

- `generate_video` (manifest 0.2.0): `quality` (quick or detailed) is retired in favour of `tier` (standard, boost or max), and `look`, `camera`,
  `voices` are declared (`seconds` follows the tier's length ceiling, 5 s and 10 s for now). The Quick and Detailed words stay only in the
  minors' Wan lane until it is migrated (see [video-tiers-2026-11-02.md](video-tiers-2026-11-02.md)).
- The chat video card's actions are aligned with the Create screen's button row; its existing Remix and tier segment are kept, not replaced.
- [video-create-2026-11-01.md](video-create-2026-11-01.md) section 7's tool table: `edit_video` takes the `change` values below (`extend` and
  `continue` are one function, named `continue`, as in EDITOR-15).

Owner direction (Jesse, 2026-11-02): a person must be able to make, tweak, remix, edit and mix a video in chat as well as in the studio,
and that has to fit the Create app. Terms: **remix** = a new version of a clip you already have, with a change (same words, look, camera,
level, seed and reference, plus the change); **mix** = lay a voice, music or sound effects over a clip and balance them against the
clip's own sound; **join** = put clips in order into one film.

## 1. What exists today (read from the code, 2026-11-02)

- Tool `generate_video` (`backend/packages/generate_video/manifest.json` 0.2.0; `lib/videos/tool.ts`): arguments `prompt`, `from_picture`,
  `orientation`, `seconds` (1 to 10), `quality` (quick or detailed), `tier`, `style` (a saved LoRA). The code also reads `recipe`, `look` and
  `voices`, but the manifest does not declare them, so the model cannot send them: a gap.
- The result is `data: { videoJobId }` and returns at once; the chat card polls the job (`VideoToolRender`, `frontend/src/apps/chat/chatToolUis.tsx`)
  and draws the kit `VideoPlayer`. Its actions today: the Quality tier segment, a Remix button (`askRemix`) and Download original; the card also
  offers stop, retry and make another.
- The music analog is the model to copy: `generate_music` plus `edit_music` with one `change` enum (remake, restyle, extend, trim, fade,
  loudness, stems, and so on) and `MusicCardView` drawing the edit panel.
- Not built anywhere: trim, join, continue, extend, audio mix or overlay for a clip (EDITOR-11 to 15 in `media-editors-2026-10-31.md` are proposed
  and have no BACKLOG rows). A voice can be spoken by `POST /api/tts` (`synthesizeSpeech`) as a WAV, but nothing mixes it into a clip.
- Offering: `toolGates.ts` (`videoEligible`: adult, own written screen, household video on, engine ready) and the 16-tool cap in
  `turnMachine/budget.ts`; VIDEO-GEN-07 built the safety matrix but its CHAT-AB-01 offer-rate rows were never run.

## 2. Tools (one definition each; Create and chat call the same functions)

| Tool | What it does | Arguments |
|---|---|---|
| `generate_video` (existing) | make a clip from words, optionally from a picture | `prompt`, `orientation`, `seconds`, `tier`, plus the Create screen's choices, now declared: `look`, `camera` (the recipe), `voices` (clean or with music and effects), and later `start_frame`, `character`, `place`; `quality` is retired in favour of `tier` |
| `edit_video` (new, the video twin of `edit_music`) | change a clip made here | `clip`, `change` and its arguments |
| `make_character`, `make_place` | save a reference for later shots | per the Create note (V4); not in the first slice |
| `make_storyboard` | the shot list of a film | per the Create note (V5); not in the first slice |

`edit_video` `change` values and where each is built (so chat and the Create buttons are the same function):

| `change` | Meaning | Built on | Needs |
|---|---|---|---|
| `another_take` | same words and choices, new seed | `makeVideoFor` (landed V1b) | nothing new |
| `remix` | same recipe plus a changed field (`prompt`, `look`, `camera`, `voices`, `tier`, `seconds`); optional `keep_seed` | `makeVideoFor` | nothing new |
| `make_it_max` | the same clip at the next tier | `makeVideoFor` with `tier` | the tier slot is on |
| `continue` | a new shot from the last frame, with new words | EDITOR-15 on the existing video job | Stack picture-to-video from a frame |
| `trim`, `join` | cut a clip, put clips in order | EDITOR-11 `media.edit` (ops list) | the Stack `media.edit` job |
| `mix` | lay a voice, music or effects over the clip and set the balance | `media.edit` with an audio-overlay op (the same op the Storyboard stitch uses) | `media.edit`; a voice line from `synthesizeSpeech`, music from a music job |
| `retake` | redo a time range of the clip, keep the rest | the LTX runtime's `retake` | experimental; only after a bench |

Remix in two levels: v1 re-runs the recipe with the change (reliable, the new clip keeps the idea but not the picture); true video-to-video
(`retake`) is later and needs its own bench. The `mix` voice path: the person names a household voice and a line; the hub speaks it
(`synthesizeSpeech`), and the Stack lays it over the silent or quiet clip at a chosen level. Every `change` runs through the same gates as
`generate_video`.

## 3. The card

The chat video card is the same kit Element as the Create preview stage (`VideoPlayer` with its actions), never a Home copy (rule 9). Its
actions are the Create button row: Another take, Remix (opens a one-line "change what?" field, or the model asks), Continue, Mix, Make it
Max (the tier segment), Download, Share, Stop. Edit results replace or add a version; the old version stays. Music and effect results from
`mix` reuse the existing music card for the track. The Storyboard and Character cards follow the Create note's slices V4 and V5.

## 4. Offering and safety

Gates are unchanged and run in the tool, not the card: adult, own written screen, household video on, engine ready, and the absolute
line (nothing sexual involving a minor or minor-looking person). The video tool set offered on a turn follows the surface or an object
in the conversation (the Videos pane, a video or a storyboard in the chat), at most four tools (`generate_video`, `edit_video`, and the two
Create tools when they exist) inside the cap of 16; the music set shrinks first when the total would pass 16. A failed tool never fails the
answer (rule 6): the model gets only the failure kind. Status uses the existing "One job's progress" row and the "Pictures and video are not
ready" row (S6); no new status surface.

## 5. Bench rows (rule 1, before each tool or argument joins the set)

1. Offer rate and false offers for `edit_video` (the VIDEO-GEN-07 shape), with the CHAT-AB-01 rows that were never run, on sentences like
   "make it anime", "do another one", "same but at night", "add some music", "cut the first two seconds", "put my voice over it".
2. Arguments: the model sends `look`, `camera`, `voices` and `tier` correctly from plain requests.
3. Worst case tool count (the Videos pane with an audio file in it) stays at 16 or fewer.
4. `mix`: a 10 s clip with a 5 s spoken line at a set level stays in sync and the clip's own sound is balanced (measured with loudness).
5. `join` and `trim` are lossless on picture (no re-encode where the container allows it) and keep audio in sync.

## 6. Slices

| # | Size | Slice | Done when |
|---|---|---|---|
| C1 | S | Declare `look`, `camera`, `voices`, `tier`, `seconds` in the manifest; retire `quality`; align the card's Remix and tier segment with the Create screen | the model can ask for a 10 s anime clip from chat and gets the same job as the Make page |
| C2 | M | `edit_video` with `another_take`, `remix`, `make_it_max` on `makeVideoFor`; bench rows 1 to 3 | each change makes one new version and keeps the old |
| C3 | L | Stack `media.edit` (EDITOR-11), then `trim`, `join`, `continue` in chat and Create | a three-clip film joins and plays in sync |
| C4 | M | `mix`: voice via TTS, music via a music job, effects; the balance control; bench rows 4 and 5 | a clip with a voice line over it plays with both audible |
| C5 | S | Storyboard and Character cards, with Create V4 and V5 | the card is the Create Element |
| C6 | S | `retake` after its own bench | only if it beats a plain remix |

**Built on the Home side (2026-11-02, C3 and C4):** `edit_video` takes `trim` (`from_s`, `to_s`), `join` (`clips`, 2 to 6 of the person's own videos) and `mix`
(`sound` voice with `line` and an optional household `voice`, or music with `track`; `level` quiet to very_loud; `start_s`) through the Stack's
`media.edit` job (`lib/videos/stackEdit.ts`, `editPlan.ts`). The result is a new video job of kind `edit` (Library note `video-edit:`, linked to the first
clip); the old clip stays. `retake` is not built. `continue` (2026-11-02, EDITOR-15) takes the last frame through `media.edit` `frame` and starts a new clip from it with LTX-2.5's picture start (Stack ede7c3a); `join` takes `transition` (`cut` or `crossfade`, 0.3 to 1 s), and a crossfade waits for a Stack `crossfade` step (see `docs/dev/videos-create.md`).

## 7. Open points

None block C1 and C2. Later: whether `mix` may take a voice made from a clip's own sound (the home-made voices feature takes a 6 to 30 s
recording), and a "remix from the Library" entry for videos not made here.
