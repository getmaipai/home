# The show-runner: a prompt becomes a 3-minute video, a 20-minute episode or a 90-minute movie (design draft, 2026-11-09)

Status: proposed; architect ruling pending. Items: SHOWRUNNER-01 to -05. Owner ask (Jesse, 2026-11-09): "make a 3 minute video about xyz", "make a 20
minute sitcom episode", ideally "a 90 minute movie", from one prompt, with the clips kept short and spliced. Companion to
[long-clips-2026-11-09.md](long-clips-2026-11-09.md): one unbroken take is capped at 40 s; anything longer is made here, from shots with cuts.

## Supersedes

- The film maker's size limits as the only way to make a film: `make_film` (FILM-04) keeps making a short film of 2 to 12 shots from one idea
  and is unchanged. A request longer than that is a show, planned and made by the stages below. The film maker's plan, engines and
  assembly are reused as the per-scene machinery (section 4); nothing is replaced.

## Reuse check (org principle 6, prebuilt over hand-built)

- Productions already hold episodes, scenes and shots with per-shot picture, voice line and clip ids (`mediaProductions.ts`, PRODUCTION-01), and
  saved subjects hold a character, place or prop with its look and reference pictures (`mediaSubjects.ts`). Both are used as they are.
- The film runner (`lib/films/run.ts`, `engines.ts`) already makes cast, stills, clips, music and an assembled cut for one plan, with resume,
  cancel, progress and the finished-video check. A scene is run through it; the show-runner adds the levels above and the store.
- Long takes (LONGTAKE-01) are used for the few shots that need one unbroken move; the frame check (`frameCheck.ts`) is each shot's dailies.
- The talking companions work (TALK-*) and household voices own voices and lip-sync; the show-runner calls them and builds no voice engine.

## 1. How a person uses it

Chat or the Productions page: "make a 20 minute sitcom episode about a family whose robot vacuum starts a podcast". The model decides this is a
show (rule 1: it chooses the tool; nothing reads the wording); the tool takes `kind` (video, episode, movie), `minutes` and the idea. Home
answers at once with the plan of what will happen and what it will cost in time, then stops at each approval. Nothing renders before the
person approves the bible. It can be left running for hours; it resumes after a restart; a push notice says when a scene or the whole show is ready.

## 2. The stages (code decides structure, the model writes content)

The framing rule from the film maker's review: small models ignore structure rules, so code sets every number and the model fills fields.

1. **Pitch.** The chat model writes a logline, a tone and a one-paragraph treatment. Approve or change it. Cheap, a few seconds.
2. **Bible.** The model proposes the cast (name, kind, one locked description each), the places and the look; Home makes each a saved subject with
   reference pictures (the existing subject sheet), a household voice for each speaking character, and one look preset. The person approves
   the faces and voices. This is the consistency anchor for the whole show; later steps may not invent a new face.
3. **Outline.** Code sets the structure from the length: scenes of 60 to 150 s (a 20-minute episode is about 10 scenes in 3 acts; a 90-minute
   movie is about 35 scenes in 3 acts; a 3-minute video is 2 or 3 scenes). The model fills each scene's purpose, place, who is in it and the
   turn. Approve or edit.
4. **Script, then shot list, scene by scene.** Dialogue and action per scene (the model), then the shot list (code): shots of 3 to 8 s in a
   coverage pattern (establishing wide, medium, close-ups and reverses for dialogue; the code picks sizes, angles and one camera move per shot
   from a fixed pool without repeats, the model only writes what happens). Spoken lines are placeholders the model must keep verbatim and the
   real words are substituted after, so a line is never paraphrased; one line per 10 s; lines start at the very start of a shot.
5. **Render.** Per scene, through the film machinery: a still per shot from the bible (the previous shot and the establishing shot as
   references, one seed per scene), then the clip from the still, with the character's voice laid over silent shots or generated with the clip.
   Continuity rule: the code writes the continuity sentence ("same people, same clothes, same light, a moment later").
6. **Dailies.** Each shot gets the frame check; a serious finding makes it once more with a new seed; the better take is kept. Each scene
   gets a contact sheet for review.
7. **Assemble.** Shots are cut in order with music under dialogue (ducked), an opening and end card, then the scene is a clip in the Library.
   The show is the scenes joined; each passes the finished-video check and fails closed (rule 10), the same as films.
8. **Review.** Per scene: Keep, Redo this scene, Redo this shot, Change the music. Redo only re-makes what was asked.

## 3. The store (this is a migration, so it is a T2 change)

A show needs durable text that does not fit in a production's 2,000-character summary: treatment, bible, outline, scripts and shot lists, and
run state per scene and shot. SHOWRUNNER-03 adds `show_runs` (id, person, production id, kind, minutes, state, stage, progress, error, created,
updated, hlc) and `show_documents` (run id, kind, key, json, version) through a Drizzle migration, with the full gate, `code-review` at medium
and this note's ruling. Productions keep the clips and cut ids exactly as films do. Shared records are unchanged.

## 4. What it costs, honestly (Studio, about 2 min per 8 s shot, measured by the films work)

| Length | Shots (about 5 s each) | Render time | Notes |
|---|---|---|---|
| 3 minutes | 36 | about 1 to 1.5 hours | one afternoon |
| 20-minute episode | 240 | 8 to 10 hours | overnight, with retakes about 12 |
| 90-minute movie | 1,080 | 35 to 45 hours | days; scene by scene with approvals |

The estimate is shown before the first render and updated as scenes finish (VIDEO-ESTIMATE-01 rates). The show shares the household queue at
the normal video priority, so chat is never blocked, and the person can pause. The limits that matter are consistency of faces, voices and
rooms across hundreds of shots and dialogue lip-sync, not render time. Expect the best results from cartoon and stylised looks first; real
faces drift. The product says so on the approval card in plain words.

## 5. Gates and rules

Adults on their own screen only, as films are. Every still, clip, scene and cut passes the existing checks; a refusal stops that shot with a plain
line and never the whole show. Characters from household members need their consent as today (likeness). No new outbound connection; no
resource words for people (the card says "scene 7 of 10, about 40 minutes left"). Spoken lines pass the speech normalizer.

## 6. Rows

- **SHOWRUNNER-01** (M): pitch, bible and outline as chat tool `make_show` plus cards; planning only, nothing rendered; store the documents in the
  production's own fields until SHOWRUNNER-03; code-set structure; tests with the chat model stubbed.
- **SHOWRUNNER-02** (M): script and shot list per scene with the code-set coverage patterns and verbatim line placeholders; rule checks and
  targeted rewrites; tests.
- **SHOWRUNNER-03** (L, T2): `show_runs` and `show_documents` migration, background runner by scene, resume, cancel, pause, progress and ETA,
  notifications; one real 3-minute show on the Studio.
- **SHOWRUNNER-04** (M): dailies (frame check, one remake), scene contact sheet, continuity references, bible-locked faces and voices.
- **SHOWRUNNER-05** (M, after VIDEO-UI-06): the Productions page: plan and approvals, scene grid with Keep and Redo, the player, the estimate.
