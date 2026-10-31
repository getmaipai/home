# Stem splitting: a tool on a song Home made (2026-10-30)

Status: APPROVED 2026-10-30 for TIER-STEMS-01 (built); section 10 added 2026-10-31 after Jesse ruled "You can build out stems" (TIER-STEMS-02 and 03, APPROVED 2026-10-31). Item id TIER-STEMS-01. Parents: [resource-tiers-2026-10-27.md](resource-tiers-2026-10-27.md) section 5.5,
[tier-evaluations-2026-10-30.md](tier-evaluations-2026-10-30.md) (TIER-EVAL-07), [music-generation-2026-10-17.md](music-generation-2026-10-17.md).
Design only: no code is written until the architect rules APPROVED.

## 1. Answer

1. **One new task, `stems`, of the existing `edit_music` tool, on a song Home made.** No new tool: the chat tool budget (rule 1) is already exactly 16 on a turn with a song, and `stems` is earned on the same turns as `edit_music`, so the count stays 16. The bench row is `edit_music`'s (MUSIC-GEN-07) with a stems case added.
   It turns one finished song into four tracks: vocals, drums, bass and other. A song with no singer
   gets a silent vocals track, and Home leaves silent tracks out of the card (measured: 0.0 percent energy, TIER-EVAL-07).
2. **Standard is `htdemucs`.** Boost and Max do not exist yet, so the tier collapse rule hides them: nobody sees a stem tier control. `htdemucs_ft`
   becomes the Boost slot only if Jesse's listen finds it audibly cleaner; the catalog row is written so that is one entry, not new code.
   `htdemucs_6s` (guitar and piano) is a later feature choice, not a tier. BS-RoFormer SW has no permissive weights and no Mac path: no Max.
3. **A Python worker in the Stack, not the Swift MLX port.** Section 2 gives the reasons.
4. **Stems are songs.** Each stem is a normal Home song file with provenance, so it appears in the Library and the Created by you shelf, and
   renders as the existing MusicTrack card. No new page, no new setting, no new status surface (rule S6).
5. **Scope of v1: songs made here, by the person's own chat, and no uploads.** Section 5 explains how that sits with MUSIC-GEN-14.

## 2. The Stack worker: Python, not the Swift helper

| | Python `demucs` 4.1.0 on torch MPS | Swift MLX port (`demucs-mlx`) |
|---|---|---|
| Measured | 40 s song in 1.8 to 4.5 s, 1.21 GB process peak (TIER-EVAL-07) | 2 to 5 s per 40 s song, 1.2 GB (the MLX weights); not run through the Stack |
| Fits the Stack | The Stack already runs each engine as a uv environment with a hashed lock and a JSON-lines worker (`music-gen`, voice, image tools, video). Same recipe, same install path, same offline check | Needs a Swift toolchain in the build, a new binary to build, sign, pin and update, and a second process protocol |
| Licence | MIT code, MIT weights (same models) | MIT code, weights re-converted by a third party |
| Models | All three Demucs families from one package | One converted checkpoint per model |

Decision: Python. The speed difference does not matter at this size (a song is split in seconds either way), and the Swift helper would add a build
and signing path for one feature. A Swift helper is revisited only if a future model has no Python path.

Shape (mirror of `stack/backend/src/music/`):

- A small uv environment `stems` (demucs 4.1.0, torch and torchaudio already pinned elsewhere in the Stack, imageio-ffmpeg for the AAC output),
  compiled with hashes like the other environments.
- The checkpoint is a pinned file (URL, size, sha256) in the model catalog, fetched at install time by the Stack's existing downloader (download,
  never vendor). The worker runs offline and refuses to start without it. Privacy page lists the pin (same row as MUSIC-GEN-08).
- `POST /v1/audio/stems` on the Stack: body is the song's bytes and sha256, the model id. The Stack refuses a source whose sha256 is not in its
  existing made-here ledger (`music/provenance.ts`, error `source_not_made_here`), the same check `music_edit` already uses. Returns 202 and a job.
- Output: one AAC file per non-silent stem at the song's length, 44.1 kHz stereo, each recorded in the same made-here ledger so a stem can be
  trimmed or faded like a song. Loudness is untouched (a stem is a part of the mix, not a track to normalize).

## 3. Queue class and memory

A stem split is a **tool job** in the household queue (memory note section on classes): the lowest class, round robin by person (Q3), aging by Q5, no
use of the picture band (Q6). Admission is 2 GB (1.21 GB measured peak plus margin), so it fits beside chat, voice and the resting picture pool at
Standard. It takes the same governor path as `music_edit`. While a Max lease runs it queues with the reason "Max job" like every tool job; no new rule.
The worker is cold-started per job and exits when idle for 60 s (a 1.2 GB resident cost is not worth keeping warm for a rare tool).

The tier contract: Standard promise "Home keeps working normally while this runs" holds (seconds, 1.2 GB). `tierArgument` for category `stems` resolves
to Standard only; with one slot, the card and tool never offer a tier (collapse rule, section 4 of the tiers note). TIER-HOME's per-category tier table
gets a `stems` row with `standard` only.

## 4. Where stems are stored and how they appear (no new surface)

- Home writes each stem as an `attachments` row exactly as a song version is written (`lib/music/store.ts`), with `provenance.generation` copied from
  the parent song and a `provenance.parent_file_id` (the existing field), so commercial-use is inherited (`commercialUseOf` already walks parents).
  A `music_jobs` row (task `stems`) carries stage, ETA and the file ids, so the existing `/api/music/jobs/*` polling, stop button, busy line and
  Status row carry every state (the per-category Status row is TIER-HOME-03, not yet built; until it lands the card and busy line carry them). No new table beyond that row's task value; one migration if the task is an enum column (checked at build).
- Chat: an `edit_music` result with task `stems` renders the stems with the existing MusicTrack card, one per stem, titled "<Song> (vocals)", under the song's
  card. Elements decision row first (rule 9): the card is used as shipped; if its Edit and Make-it-full controls cannot be turned off by an existing
  prop, a prop is added in `commons` first, never a Home wrapper or `className`.
- Library and the Created by you shelf: the stems are made songs, so the existing listing shows them with no code. They group by the parent in the
  listing's title only.
- Entry points: the model decides (rule 1), as for `edit_music`, from "split this into stems"; and a "Split into stems" action on the song card.
  The action is a card prop in `commons` if one is not there, with an Elements decision row.

## 5. Who may use it

1. **Age and surface gates run first and are never loosened.** `edit_music` with task `stems` keeps `musicDenial` and `musicAudienceOf` unchanged: if a person
   cannot make a song on that surface (child, teen under the lane switches, guest, spoken, shared screen), they cannot split one. The minor line
   is not re-run: the audio is a part of a song that already passed it, and no text is added.
2. **Source: a song made here, in this chat, by this person** (`sourceMusicJob`, the same helper the edits use). That is the whole of v1.
3. **"A file the person owns" is deferred, not refused by this note.** Uploaded audio is MUSIC-GEN-14, which stays Jesse's decision. Splitting
   an upload does not make a voice reference or a cover source (stems are an output), so it may be a smaller question than MUSIC-GEN-14, but it
   still puts a person's own recording, and possibly a household member's voice, through a model, and that ruling is his. This note leaves
   one row, TIER-STEMS-02 (decision for Jesse), and builds nothing for uploads. Everything above is written so adding it is a new source
   in `edit_music` plus a Stack ledger entry for the upload's sha256, and nothing else changes.
4. **No stem feeds a generator.** A stem is never accepted as a cover, reference or voice source (the Stack's `source_not_made_here` check passes
   it as a trim and fade source only; `generate_music` has no source argument beyond the edit tasks).

## 6. Reuse check

| Need | Prebuilt option | Verdict |
|---|---|---|
| Separation model | Demucs `htdemucs` (MIT, official) | used |
| Stronger model | BS-RoFormer SW, MVSEP, Spleeter | no: weights licence unknown or Spleeter is older and weaker; none has a Mac path with a permissive licence |
| Mac path | Swift MLX port | rejected, section 2 |
| Job runner, queue, stages, ETA, stop | `music_edit` job kind, `registerJobRunner`, `music_jobs` | reused |
| Made-here check | `music/provenance.ts` ledger | reused |
| Card, player, Download, Share | MusicTrack Element and the kit Player | reused as shipped |
| Library listing, shelf | existing made-file listing | reused |
| Tier control | none; one slot, collapsed | none |
| ACE-Step `extract` | xl-base only, a second 20 GB model | no; later alternative only |

## 7. Failure and privacy

Two cases. The stems job's own card shows a fixed plain line from the `failureCopy.ts` map ("The stems could not be made. Try again in a minute."),
which S6 allows for "One job's progress" and "A form or action failed". A tool call that fails at submission gives the model only the failure kind
(down, timed out, source not made here); the model says it in its own words and no fixed chat reply is stored (rule 6).

The tool reply never carries raw Stack text (rule 6). The worker has no network at run time. Stem bytes follow the song's
retention and the nightly cleanup (`kept` honoured like any made file).

## 8. Supersedes

- Tiers note section 5.5, Boost row: `htdemucs_6s` becomes a feature choice, not a tier; Boost stays empty until Jesse's listen picks `htdemucs_ft`.
- Tiers note section 5.5, "Stems are an edit of a song Home made or a file the person owns": uploads move to TIER-STEMS-02 (Jesse's decision).
- Backlog TIER-STEMS-01 "a file the person owns; Standard and Boost slots": v1 is songs made here, Standard only.
- Backlog TIER-STEMS-01 "A new tool": stems are a task of `edit_music`, not a new tool.
- Backlog MUSIC-GEN-12 "ACE-Step base `extract` or Demucs": Demucs is picked; `extract` stays a later alternative.
- Nothing in `docs/design/RULES.md` is superseded.

## 9. Rows

| Row | Slice | Where |
|---|---|---|
| TIER-STEMS-01a | Stack `stems` environment, pin, worker, `POST /v1/audio/stems`, ledger, tests with a fake worker, one real run | `stack` |
| TIER-STEMS-01b | Home `stems` music task, `stems` task of `edit_music`, store, gates, `tierArgument` row | `home` backend |
| TIER-STEMS-01c | Card rendering and the Split into stems action, Elements decision row, preview at 1440 and 390 | `home` frontend, `commons` only if a prop is missing |
| TIER-STEMS-01d | Bench rows, privacy page pin, docs | `home` |
| TIER-STEMS-02 | Decision for Jesse: split a file the person uploaded (MUSIC-GEN-14 neighbour) | none until he rules |

## 10. Ruling of 2026-10-31: split files the person owns, and the other models as options

Jesse, 2026-10-31: "You can build out stems." That rules on TIER-STEMS-02 (split a file the person uploaded) and on the rest of stem
splitting. Section 5 point 3 and the "no uploads" line of section 1 point 5 are replaced by this section. Rows: TIER-STEMS-02 and
TIER-STEMS-03. Nothing here changes MUSIC-GEN-14: a recording still cannot be a cover, reference or voice source.

### 10.1 The source: an audio file in the person's own Library

1. **Source kinds.** `stems` accepts (a) a song made here, as before, and (b) an audio file the person owns in their Library (`kind: "audio"`,
   uploaded or imported through the Library routes; a file shared with them does not count, `ownsMusicAttachment`-style ownership). A file in a
   chat or on another person's shelf is not a source.
2. **Entry points, no new surface.** "Split into stems" on the Library file detail of an audio file, and on Now playing for a song that is the
   person's own Library file; both start the same job as the song card's Stems tab (`POST /api/music/stems/from-file`, body `file_id`). The model
   still decides from chat for songs made in that chat only (rule 1; no new tool and no file picker tool: a chat tool that reads the Library is a
   privacy surface this ruling does not open).
3. **The card.** The job and its finished card are the same job card and one stems card that steps through its tracks (section 4); a split of a
   file starts a conversation of its own named for the file ("Split: <file name>") so the chat history shows it like a song split. Tracks are
   titled "<file name> (vocals)". On the music page the stems appear under Created by you like any made song.
4. **Phone width.** The card and the Library action are the existing kit controls; mobile is previewed at 390 and judged before landing.

### 10.2 Gates and privacy (RULES.md applies, nothing leaves the home)

1. **Age and surface gates run first, unchanged.** The same `musicDenial` and audience check as `edit_music`: any child or teen (music is adult-only, `musicViewDenial`), a guest, a spoken turn and a shared screen cannot split a file either; teens have no music lane, so
   no model or tier choice ever reaches a minor (rule 8). The from-file route uses the same `musicRouteAudience` and `musicDenial` as the existing stems route in
   `routes/music.ts`, and refuses before any bytes are read. Started in Incognito (a temporary conversation), the split and its stems are temporary, as `source.temporary` does on the song route.
2. **Local only.** The file's bytes go from Home to the Stack on the same machine over loopback and nowhere else; the worker has no network at
   run time; no new outbound connection (docs/PRIVACY.md unchanged). Rule 6a: the bytes are not logged, the Stack keeps the source only for the
   job and deletes it on completion, failure or cancel, and Home stores only the stems. The Stack request carries no file name; no log line, queue reason, music
   job Status row (TIER-HOME-03) or admin view carries the file name, file id or the "Split: <file name>" title, which lives only in the person's own conversation.
3. **The ledger stays closed to uploads.** The Stack's made-here ledger still refuses an unknown source for every edit and cover. A new request
   field `source: "owned_file"` is accepted by `POST /v1/audio/stems` only, with the declared sha256 of the bytes. Stems of an owned file are
   **not** recorded in the ledger, so a stem of a person's recording can never be a trim, edit or cover source, and `generate_music` still has no
   source argument. A song made here keeps today's path (ledger check, stems recorded).
4. **Provenance.** A stem of an owned file carries `provenance.parent_file_id` of the Library file and no generation record, so commercial use
   is not asserted (the person's file is not ours to clear) and the file is `private` until the owner shares it. The card says "Made from your file".
5. **Voices.** The vocals of a recording may be a household member's voice. Splitting does not make a voice, and Home never uses a stem as a voice or
   music source (point 3). No consent step is added (SAFETY.md 2026-10-18 has none for making a voice from a clip either). The muted line on the card
   and the Library action says in plain words "Stays on this home server. Splitting does not make a voice." as constant text (no per-person first-use flag), and docs/user/music.md says it too.
6. **Limits.** The Stack limit stays 40 MB and adds 12 minutes of audio; a larger file gets the plain line "That file is too long to split. Try
   one under 12 minutes." Storage counts the stems like any Library file and the caps already apply.
7. **No age loosening on the output.** Stems of an owned file are not content-checked (no text is added and the person owns the audio); adult
   unlock rules for explicit lyrics do not apply because Home neither writes nor reads lyrics here.

### 10.3 The other models as options of one family (TIER-STEMS-03)

Per [tier-families-and-options-2026-10-30.md](tier-families-and-options-2026-10-30.md), the category is the Demucs family and a slot is
`{ model, options }`:

The stems category has no options (family only, like Voice). `parts` is fixed by the checkpoint (`htdemucs` and `htdemucs_ft` give four, `htdemucs_6s` gives
six), so it lives on the catalog entry, not in the slot options. If an option-only Boost is wanted later it uses real same-weights Demucs options
(`shifts`, `overlap`), each measured per F3.

| Slot | Model | Notes |
|---|---|---|
| Standard | `htdemucs` | unchanged, 3 GB admission |
| Boost | `off` by default | `htdemucs_ft` (fine-tuned bag, about four times the time) is a candidate an admin can pick in the slot dialog (tiers 3a, TIER-HOME-04) until Jesse's listen makes it the default |
| Max | `off` | no permissive weights and no Mac path |

`htdemucs_6s` is not a tier. It is a typed variant of the `stems` task, "More parts" (guitar and piano), offered when its catalog entry is installed
(the approved sections 1.2 and 8 call it a feature choice). All three catalog entries carry `family: "demucs"` (F1).

1. The Stack catalog gets `htdemucs_ft` and `htdemucs_6s` as pinned entries of the same `stems` component (URL, size, sha256, licence MIT, revision),
   downloaded at install like `htdemucs`; each is its own optional download, not part of the base install. The two new pins go into the Stack's `/stack/v1/privacy` rows in the same commit as 03a.
2. `POST /v1/audio/stems` takes `model` (default `htdemucs`); the worker loads the named checkpoint offline. Admission: `htdemucs` 3 GB as measured;
   the other two use the measured peak when the evaluation numbers exist, else 6 GB marked unverified (F3), and queue behind the governor like any tool job.
3. Outputs are named by part (`vocals, drums, bass, other`, plus `guitar, piano` for six). Silent tracks are left out of the card as in section 1.
4. Boost and Max follow the tier collapse rule of F2: a tier is shown only when its model and options differ from the tier below. Max stays empty
   (BS-RoFormer SW has no permissive weights and no Mac path).

### 10.4 Rows

| Row | Slice | Where |
|---|---|---|
| TIER-STEMS-02a | Stack: `source: "owned_file"`, no ledger for those stems, source deleted after the job, 12 minute limit, tests | `stack` |
| TIER-STEMS-02b | Home backend: `POST /api/music/stems/from-file`, gates, ownership, provenance, job and conversation, tests | `home` |
| TIER-STEMS-02c | Home frontend: Library audio action, Now playing action, card text, mobile preview, docs/user/music.md | `home` |
| TIER-STEMS-03a | Stack: pins for `htdemucs_ft` and `htdemucs_6s`, `model` field, admission figures, tests | `stack` |
| TIER-STEMS-03b | Home: the existing typed `tier` argument and kit tier segment (TIER-UI-01, when landed) and "More parts" on the stems card, the slot row. Both are new controls on a kit Element, so rule 9(c): a prop in `commons` first with an Elements decision row; the same for the Library and Now playing actions if those Elements lack an action. If `edit_music` gains a `parts` or `tier` argument, its bench row gets a case (rule 1) | `home`, `commons` |

### 10.5 Supersedes

- Section 1 point 2 "nobody sees a stem tier control" (Boost may show once `htdemucs_ft` is installed and picked), section 2's "refuses any source not in the ledger" (now except `owned_file`), section 3's 2 GB admission (now 3 GB), section 4's entry points (Library and Now playing added) and section 5 point 2 "That is the whole of v1".
- Section 1 point 5 ("no uploads") and section 5 point 3 ("deferred") of this note.
- Backlog TIER-STEMS-02 "decision for Jesse": ruled 2026-10-31, rows above.
- The made-here-only sentence of `stack/backend/src/music/provenance.ts` stays true for every task except `stems` with `source: "owned_file"`.
- Nothing in `docs/design/RULES.md` is superseded.

### 10.6 Build notes from the architect

- `ownsMusicAttachment` needs a generation record, so stems of an owned file need their own ownership test (owner and `parent_file_id` of an owned Library file) in the music routes and the file route, and must still never pass as an edit source.
- "Created by you" may list only rows with a generation record; widen its filter or label these "Made from your file".
- Backlog gets TIER-STEMS-03 (none exists yet). Reuse rows added: the Library and Now playing actions are existing kit actions or a commons prop; the Stack downloader serves the two pins.
