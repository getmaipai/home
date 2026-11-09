# Long clips: a take longer than ten seconds (design draft, 2026-11-09)

Status: proposed; architect ruling pending. Items: LONGTAKE-01 to -03. Owner ask (Jesse, 2026-11-09): movie and TV clips run much longer than
ten seconds, so Home must make them. Ideas from the open-source studios reviewed that day (data-scratch/reports/iv-studio-gap-2026-11-09.md):
a long take is parts that each continue from the last frame of the one before, measured per part.

## Supersedes

- The cut-and-`shortened` behaviour of `chooseVideoQuality` (`lib/videos/quality.ts`, `shortened: asked > ceiling`) for adults on Create and in
  chat: a length past the ceiling now makes a long take instead of being cut. The ceiling per part is unchanged; a person who asks for a
  single part still gets the ceiling. Minors keep the existing cut and the existing refusal.

## Reuse check (org principle 6, prebuilt over hand-built)

- `edit_video` `extend` (`editTool.ts`, Max only, a range limit, the engine's own extend) is not used: it is Max-only and bounded, and
  VIDEO-EVAL-04 has not yet measured it against direct generation. Last-frame `continue` (EDITOR-15) works at every level and is already
  built. If VIDEO-EVAL-04 shows `extend` gives a better seam, a part may switch to it behind the same plan.
- The film runner (`lib/films/run.ts`, FILM-02) is not reused: it plans cast, stills, music and an assembled film from an idea, and its run
  table (`film_runs`) parses its plan with the film schema. A take has none of those steps. Its resume, cancel and progress idea is copied;
  the clip-per-shot recording is the same `setShotClip` path that video jobs already write for productions.

## 1. What exists today

- One clip is at most 10 s on Standard and 5 s on Boost (`maxSecondsFor`, `lib/videos/quality.ts`). A longer ask is cut to the ceiling and
  the person is told (`shortened`).
- `edit_video` `continue` starts a new clip from the last frame of a finished one (EDITOR-15, `continueFrom` in `lib/videos/editTool.ts`),
  and `join` puts clips in order with a cut or crossfade (`media.edit`). Both are one step at a time, in chat only.
- A finished clip passes the finished-video check (`gateFinished`) inside the video job, so every part is checked like any clip.
- Films (`lib/films/`) already run a plan across many clips as a background run with progress, Resume and Cancel; a media production
  (`mediaProductions.ts`) already stores per-shot clip ids with no new table.

## 2. Design

**A long take is a production of parts.** Asking for more seconds than the level's ceiling makes a long take instead of cutting the length:

1. **Plan (code, no model).** parts = ceil(seconds / ceiling); each part gets an equal share, at least 3 s. At most 12 parts (about two minutes at
   Standard). An unbroken take is capped at 40 seconds (drift builds with every part; research on 2026-11-09 found every chained method drifts and the better ones carry more than one frame); anything longer is refused with one plain line that points to a film or scene made from shots with cuts (the long-form productions design, LONGFORM-01).
2. **Beats.** The person's words stay as written for part 1. For each later part the code adds one continuity sentence ("the same scene, the same
   people and light, a moment later") and, when the person gave beats (one per line, or numbered), that part's beat. With no beats, every part
   gets the whole prompt plus the continuity sentence. The model is not asked to plan camera or timing (the framing rule from the film maker:
   code decides, the model writes content).
3. **Render in order.** Part 1 from the words (or the person's start picture). Part n starts from the last frame of part n-1. Each part calls
   `runGenerateVideo` directly with the `production` and `shot` arguments, the way the film maker does (`lib/films/engines.ts`), so the job
   carries `request.production_id` and `request.shot_id` and the existing writer records the clip on its shot (`makeVideoFor` does not pass
   those arguments today). The last-frame step (the Stack `frame` op, the input screening, the stored picture) is split out of `continueFrom`
   into a function that needs no chat, and its result is handed to the part as `prepared`; `continue` in chat keeps working through it. Each part keeps the same level, orientation, style and seed family. One part at a time through the household queue at the
   clip's normal priority; the lane gates, the Adult-only rule and the finished-video check are each part's own.
4. **Check each part.** The frame check (`lib/videos/frameCheck.ts`) runs on the finished part. A serious finding (black, nothing moves)
   makes that part once more with a new seed; the better one is kept and the other stays in the person's clips, not deleted. A warning
   (soft) is shown, not acted on.
5. **Join.** The parts are joined with a straight cut (the pictures already match at the seam) through `media.edit` `join`. Sound is
   each part's own; one music bed over the whole take is optional (`musicBed.ts`). The joined file passes the finished-video check
   (`gateFinished`, rule 10) and fails closed, exactly as a film's assembled cut does; checking each part is not enough. The finished take is a
   normal clip file in the person's Library, so Trim, Join, Mix and Make it Max work on it.
6. **Run record (no spec change, no migration).** A media production created with provenance `long-take` (`createMediaProduction(..., "long-take")`)
   with one episode and one scene whose shots `part-1` to `part-N` are all created up front (`setShotClip` records nothing for a shot that does
   not exist). Each part's video job carries `request.production_id` and `request.shot_id`, so the
   existing job writer records `clip_file_id` when the part finishes). The take's parameters (words, beats, level, orientation, seconds per
   part, seed, style ids; JSON, versioned) live in the production's `summary` field (cut at 2,000 characters), which is what Resume rebuilds from. The serialized parameters are measured
before saving; if they do not fit, the take is refused with one plain line ("That is too much to say in one take. Shorten the words or the
beats.") rather than saved cut off. Progress is the count
   of shots with a clip; "part N of M" is read from the part jobs. Resume starts at the first part with no clip; Cancel stops after the part in
   progress and keeps the parts made (the person can still join them). Shared records are unchanged, so no spec-first step is needed.
7. **Who.** Adults on their own screen only, as Create is today (`makeAudienceOf`); teens, children and guests get the existing refusal.
   One long take per person at a time and the daily counts are the household queue's existing per-person limits and daily caps (TIER-PRIO-06); a part
   that the queue holds back simply waits. Nothing new locks.
8. **Where it starts.** `generate_video` with `seconds` past the ceiling in chat; `POST /api/videos/long` for the Create page; the Create
   page's Length dropdown lists 5 s up to the longest unbroken take (built from the level's part ceiling and `MAX_TAKE_SECONDS`, never typed in) once VIDEO-UI-06 lands (LONGTAKE-02); past the maximum the page offers **New production** (the long-form productions design) instead of a longer choice. The estimate for the button is parts times the
   measured minutes per part (VIDEO-ESTIMATE-01).

## 2a. Upgrades from the 2026-11-09 research (what others do)

Carrying only the last frame is the common baseline and the weakest form of it. Better systems also (a) condition on the last second or
several frames (Veo, LTX's extend sampler with a frame-overlap setting, Helios' last three frames), (b) re-anchor identity on every chunk
(Infinite Talk feeds the reference picture plus the last frame), and (c) keep real work to short shots with cuts. Done in this note: the
40-second cap, and a character style (`styles`, at most two, read again through the person's own access) passed to every part so the
face is held by the style. Not yet done: multi-frame conditioning needs a Stack input that does not exist for the non-Max levels (Max has
the engine's own `extend`, VIDEO-EVAL-04 measures it); a short audio crossfade at each join needs a Stack step for audio alone (`crossfade`
dissolves the picture too). Both are rows under VIDEO-EVAL-04.

## 3. What it will not do (stated plainly in the product)

- Faces and clothes drift a little more with each part, and a speaking voice is not the same across parts. A character style (LoRA) holds the
  face best. One spoken line per part works best; a long monologue should be a Film with recorded voices.
- A take is not a Film: no cast sheet, no story plan. Use `make_film` for a story with several scenes.

## 4. Rules check

Rule 1 (the model decides when to offer; nothing reads wording): the offer is the tool's `seconds` argument. Age and surface gates: reused
unchanged per part. No new outbound connection. No new store. No resource words for people: the progress line says "part 3 of 6", never memory.

## 5. Rows

- **LONGTAKE-01** (M, Home backend): `lib/videos/longTake.ts` (plan, run, resume, cancel), `generate_video` over-length path, `POST /api/videos/long`
  and `GET /api/videos/long/:id`. Tests with the Stack stubbed; one real run on the Studio judged by eye (3 parts).
- **LONGTAKE-02** (S, after VIDEO-UI-06 and LONGTAKE-01): the Length dropdown past 10 s, "part N of M" on the card, the estimate on the button.
- **LONGTAKE-03** is folded into VIDEO-EVAL-04 (extend versus direct generation, which already judges the seam): add a six-part chain with and
  without a character style, measured with the frame check and the face match, and decide the part length and cut versus crossfade.
