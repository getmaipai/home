# Long-form productions: from one prompt to a video of any length, made as scenes and shots (design draft, 2026-11-09)

Status: proposed; architect ruling pending (the first drafts, "show-runner" and "productions", were REJECTED 2026-11-09; this is the second resubmission). Items: LONGFORM-01 to -05.
Owner ask (Jesse, 2026-11-09): prompt "a video about xyz", "a sitcom episode", "a movie"; the clips stay short and are spliced; the system should work
like other apps, where anything larger than a short film is a production with scenes, cast, locations, music and a storyboard. Lengths he named were
examples: nothing here is built for a particular number of minutes. Companion to [long-clips-2026-11-09.md](long-clips-2026-11-09.md) (one unbroken
take, capped at 40 s).

## Supersedes

Nothing is replaced. Named so they are not confused with this work:

- `make_film` (FILM-04) keeps making a short film of 2 to 12 shots from one idea, unchanged; it is the per-run maker below.
- TALENT-06's chat tool `make_show` and a production's `show` field (set by TALENT-04) are the **spoken shows** of the talent design
  ([talent-2026-11-07.md](talent-2026-11-07.md)); they are unchanged. This note uses the word **production** and the tool name `make_production`, never "show".
- The chat harness's **projects** (`projects` table, `lib/projects/`, the `start_project` tool, PROJECTS-UI-01, CHAT-PROJECT-01 chat folders, background work-steps) are unrelated and unchanged. The word "project" is not used in this feature's tool, rows or copy (CHAT-PROJECT-01: background work is never labelled "project"); the existing `project.done` notification type is reused only as a notification type.

## Reuse check (org principle 6, prebuilt over hand-built)

- Productions (`mediaProductions.ts`, PRODUCTION-01) already hold episodes, scenes and shots with picture, voice-line and clip ids, and saved
  subjects (`mediaSubjects.ts`) hold a character, place or prop with its look and reference pictures. Both are used as they are. A production's
  summary is capped at 2,000 characters, so it is not a document store.
- The film runner and its run table `film_runs` (`lib/films/run.ts`, `store.ts`; person, production id, state, stage, done and total steps,
  error, plan JSON in the film plan's shape, at most 12 shots and 6 cast) run one scene. A long-form production is many film runs under one production: a scene is one run or several runs that share a
  `scene_key` (each run holds at most 12 shots of 3 to 10 s, so at most 96 s, and at most 6 cast entries, which count places and props too, so a run
  names only the subset of the bible that appears in it). `film_runs` gains a parent link and the scene key (a migration of two nullable columns);
  no second run table is added.
- Not used, and why: the harness project runner (`lib/projects/runner.ts`, an XState actor over typed steps for chat work) has no film stages, stills or
  clips and is tied to a chat conversation; films already have resume, cancel and progress in `film_runs`. The `artifacts` store (`lib/artifacts.ts`)
  holds versioned markdown, code and html documents of a chat turn with the spec artifact shape; a treatment, bible, outline and script are
  structured records with their own lifecycle and approvals, owned by a production, not chat documents, so a table of their own is used.
- Dialogue lines and two-person spoken scenes on film shots are TALENT-03 (the line renderer) and TALENT-12; this design calls them for speech and
  builds no voice engine. Mouth movement on a talking companion is TALK-*; lip-sync on a video clip is VIDEO-INPUTS-04/05 (lipdub is blocked
  under rule 11) and is used only once benched.
- One unbroken move uses a long take (LONGTAKE-01); each shot's dailies use the frame check (`frameCheck.ts`); the animatic (FILM-ANIMATIC-01)
  is the storyboard's playback; music uses the existing music maker; the cut uses the film assembly.
- Other apps (LTX Studio, Google Flow, Higgsfield, Showrunner, reviewed 2026-11-09) agree on the shape: a production holding reusable cast and
  place assets, a storyboard of stills before any video, a timeline, and work done a scene at a time. None documents a feature-length method.

## 1. What a person sees

A **long-form production** is a production with a workspace: **Story** (logline, treatment, outline), **Cast**, **Locations**, **Props**, **Music**, **Storyboard**
(a still per shot, playable as an animatic), **Scenes** (each a card with status), **Timeline** (the cut), and **Pictures and clips**. Whether a
request becomes a short film or a long-form production is the model's choice (rule 1) through two tools: `make_film` (up to 12 shots) and
`make_production` (more than that). `make_production` takes the idea, an optional length in minutes, and the kind (video, episode, movie, or other words the person used).
Home replies at once with what it will do and how long it will take on this home's hardware, then stops at each approval. The person can drive
scene by scene, or switch the production to Auto, which runs on to the next approval gate unattended and sends one notice when something is ready.

## 2. The stages (code decides structure and numbers; the model writes content)

No length is special. Every number below is computed from the requested length, or from the model's own proposal when no length was given, and
from these constants: a scene is about 60 to 180 s (several runs where it needs more than 12 shots); a shot is 3 to 8 s; a scene run holds at most 12 shots (the film plan's limit); a production
has at most as many scenes as the person has approved.

1. **Pitch.** Logline, tone, treatment. Cheap. Approve or change.
2. **Bible.** Cast, locations, props and the look, each made a saved subject with reference pictures; a household voice for each speaking
   character; one look preset. This is the consistency anchor: later stages may not invent a face or a room. The person approves faces and voices.
3. **Outline.** Code splits the length into acts and scenes with the constants above; the model fills each scene's purpose, place, who is in it
   and the turn. With no length given, the model proposes a length and the person approves it here. Approve or edit.
4. **Script and shot list, one scene at a time.** Dialogue and action (model), then the shot list (code): shot sizes and angles from a coverage
   pattern for the scene's kind (a dialogue scene gets establishing, two-shots, singles and reverses; an action scene gets another), one camera
   move per shot from a pool without repeats. Spoken lines are placeholders the model must keep verbatim, substituted after, so a line is never
   paraphrased; the line goes at the very start of its shot. Lines pass the speech normalizer.
5. **Storyboard.** A still per shot, from the bible and the previous shot as references, one seed per scene. The person sees the storyboard and
   the animatic before any clip is rendered, and can redo any still. This is the cheap place to catch mistakes.
6. **Render.** Per scene, as film runs (the clips from the approved stills). Dailies: each shot gets the frame check, with one remake on a
   serious finding.
7. **Assemble.** Shots cut in order with music ducked under dialogue; each scene is a clip in the Library; the production is the scenes joined.
   Every still, clip, scene and the whole cut pass the finished-video check; for an adult the output is withheld by the CSAM check only (rule 10, as films do); a withheld shot stops with a plain line, never the whole production.
8. **Review.** Per scene: Keep, Redo this scene, Redo this shot, Change the music.

## 3. The store (a migration, so a T2 change, in LONGFORM-01)

`film_runs` gains `parent_id` and `scene_key` (nullable). A new table `production_documents` (id, production id, kind, key, json, version, provenance, created, updated, hlc) holds
treatment, bible, outline, scripts and shot lists; it is needed because no existing store fits (see the reuse check: the production summary is 2,000 characters, `film_runs.plan_json` is the film
plan's shape, and chat artifacts are documents of a chat turn). A long-form production's own state is its production plus its child film runs; no second run
table. Shared records are unchanged. The migration takes the full gate, `code-review` at medium and this note's ruling.

## 4. Time and cost, as a formula

Shots = length in seconds divided by the production's average shot length (about 5 s unless the scene kinds say otherwise). Render time = shots times
this home's measured minutes per shot at the chosen level (VIDEO-ESTIMATE-01; it says "no estimate yet" until enough clips exist), plus a retake
allowance from the dailies' measured retake rate. The estimate is shown before the first render and updated as scenes finish. The production shares
the household queue at normal video priority, so chat is never blocked. The limits that matter are consistency of faces, voices and rooms across
many shots, and dialogue lip-sync, not render time; the approval card says so in plain words, and cartoon and stylised looks are expected to hold up best.

## 5. Gates and rules

Adults only, on the adult's own written screen; never a spoken turn, a shared screen or a robot (the FILM-04 wording and gate, `videosAllowed`).
Characters from household members need their consent as today (likeness). No new outbound connection. People never see resource words: the card
says "scene 7 of 10, about 40 minutes left". Status and progress go on the production's own card (S6, one job's progress); controls follow the
"Pictures and video are not ready" row; a finished scene or production uses the existing `project.done` notification.

## 6. Rows

- **LONGFORM-01** (M, T2: migration): `make_production` as a conditional tool (a bench row for offer rate and false offers, `videosAllowed` and the
  adult gate, a slot in the 16-tool cap); the migration (`film_runs` parent and scene key, `production_documents`); pitch, bible and outline as
  documents with approval cards; code-set structure; nothing renders. Tests with the chat model stubbed.
- **LONGFORM-02** (M): script and shot list per scene with the coverage patterns and verbatim line placeholders; rule checks with targeted rewrites.
- **LONGFORM-03** (L): the storyboard (stills, animatic with FILM-ANIMATIC-01), the runner by scene over film runs, pause, resume, cancel,
  progress and ETA, Auto mode; one real production on the Studio judged by eye.
- **LONGFORM-04** (M): dailies and continuity: frame check and one remake per shot, scene contact sheet, previous-shot and establishing-shot
  references, bible-locked faces and voices, music ducked under dialogue.
- **LONGFORM-05** (M, after VIDEO-UI-06 and -03): the Production page with the tabs of section 1, scene grid with Keep and Redo, player, estimate.
