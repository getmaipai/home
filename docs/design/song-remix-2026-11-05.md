# Song remix: change a song you bring, in Create and in chat (2026-11-05)

Status: architect APPROVED 2026-11-05 (first pass REJECTED with edits, applied here; two wording conditions added). Item: MUSIC-REMIX-01. Owner ask 2026-11-05 (Jesse): (1) take an input song and change it, for example make it reggae or have the companion sing it, with options to split stems and keep original parts; (2) every command also works in plain chat, for example attach a song and say "remove vocals".

## 1. Owner rulings (2026-11-05, wizard)

- **Who:** everyone. Teens and children can edit an attached song too, after Home reads the song's words and finds they pass that person's safety floor, for the tasks that make new audio (section 3.4). Adults get the same CSAM check a made song gets and nothing else.
- **Where it goes:** the result follows the normal Private or Shared switch, like a song made here.
- This resolves MUSIC-GEN-14 (uploaded audio as a source) and opens it for edit, cover and voice sources.

## 2. What exists (read from origin/main 2026-11-05)

- `edit_music` tasks: remake, restyle (cover), instrumental, rewrite section (repaint), extend, stems, trim, fade, loudness. cover, repaint, extend and edit already send source bytes to the Stack (`backend/src/lib/music/tool.ts`).
- Stems of a file the person owns: `POST /api/music/stems/from-file`, `prepareOwnedStemsJob` (`jobs.ts`), 40 MB cap, 12 minute limit, result provenance `upload`, never a made-here ledger entry.
- Four Home checks refuse an uploaded source: manifest `track` text, `sourceMusicJob` (`tool.ts:194`), `prepareMusicEdit` (`tool.ts:112`), `readMusicFile` (`jobs.ts:330`). The Stack also keeps a ledger and refuses an unknown source for every edit and cover (stem-splitting 10.2 point 3).
- Chat tools receive no attachment id today; images use `readAttachmentForConversation` from a route.
- Music is adult-only today (`musicViewDenial` in `policy.ts`). MUSIC-GEN-22 (teen and child lanes, superseding MUSIC-GEN-13), MUSIC-GEN-15 (as-sung check) and CONTENT-POLICY-04 are owed.
- No transcription step exists; `alignSong` aligns given lyrics.

## 3. Design

One definition: the song edit stays the `edit_music` tool and its jobs. Nothing new for chat versus Create (owner rule 2026-11-01, music-listen-create 3.3, not yet in RULES.md: the same tool, the same card).

**3.1 Source.** `edit_music.track` accepts `latest`, a made-here file id, or an id of an audio attachment the person owns (this conversation or their Library). A new `resolveSongSource` in `lib/music/jobs.ts` is the only place that decides which, using `readAttachment` ownership and the 40 MB and 12 minute limits of the stems path. The result keeps provenance `upload` so commercial use is never claimed. The Stack ledger refusal is relaxed for a source Home marks `origin: "owned_file"` on cover, repaint, extend and edit (the stems task already does this); the result is never a made-here ledger entry and so is not a voice or cover source for anyone else.

**3.2 Chat.** The turn passes the ids of audio attachments on the person's message to the offered tool set (new `audioAttachments` beside `documentAttachments`). `musicEditAllowed` becomes true when the message carries an audio attachment, not only after a made-here song (a conditional tool trigger under rule 1: the offered set stays at 16 or fewer and code never decides the task from words). The model picks the task from the words. The result is the existing `MusicTrack` song card or the stems card, with no new Home card. CHAT-AB-01 gets rows: attach and "make it reggae", "remove vocals", "have the companion sing it", and a negative with an attachment and no music intent.

**3.3 The edits.**
1. *Restyle:* `cover` with the source and the style words, source lyrics passed in so words survive. Adults may pick a model; a minor runs the fixed Standard path with no model or tier choice (rule 8).
2. *Keep or replace parts:* a `parts` argument on the stems task (`keep`, `drop`, `mute` over vocals, drums, bass, other) and a `mix` step: stems, ffmpeg mix and loudness; a replaced part is regenerated (repaint on the stem, or a regenerated instrumental) and aligned to the source tempo with rubberband. "Remove vocals" and "just the vocals" need no model beyond the stems worker.
3. *Companion sings:* the vocal stem goes through a singing voice conversion worker in the Stack with a reference clip of the target voice, then is mixed over the instrumental (original or restyled). The target follows the rules for voices, not a new consent system: an adult may use the companion or any household voice the Family option allows (rule 0; Home issues no consent proofs and withholds on no likeness); a child or a teen never lists, picks or hears a clip voice (household-voices-2026-10-20.md), so a minor's swap is the companion or a described voice only. Real singers are not special-cased (rule 0).
4. A stem is an intermediate inside one job. It is never stored as a Library or ledger source and never gets a file id a later request can name; the stored result is the finished mix, with provenance `upload`.
5. Each edit is a new version of the working song; the original is never overwritten.

**3.4 Gates.**
- *Adult:* the CSAM check a made song gets: request-aware on the style words and lyrics passed in, direct detection on the output, an unrun check fails closed. Nothing else.
- *Teen and child:* a words screen on tasks that make new audio (restyle, regenerate a part, voice swap). Pure stems, trim, fade and mix stay unscreened, as ruled in stem-splitting 10.7, because no new words enter. The screen runs mlx-whisper (`whisper-large-v3-turbo`, MUSIC-GEN-15's pick) as a pinned component of the Stack music worker behind a Stack endpoint; Home calls only that endpoint. It transcribes the raw mix and the vocal stem; the words go through the same floor as made lyrics; any disagreement or empty transcript on a song with vocals fails closed. For restyle, regenerate and voice swap the as-sung check (MUSIC-GEN-15) also runs on the generated result before it is stored, because the source screen does not cover newly sung words. The transcript is dropped after the check, never stored or logged (rule 6a); a withheld result is a fixed policy-refusal line (rule 6). The Stack request carries no file name and no status or log line carries the title. Teens and children enter through the chat attachment and the Library file action; Create is hidden for them today (stem-splitting 10.2 point 1).
- *Order of build:* until R5 lands, R1 to R4 are adult-only and a minor's attached-song edit is refused by the existing `musicViewDenial`. R5 depends on MUSIC-GEN-22, MUSIC-GEN-15, CONTENT-POLICY-01 and CONTENT-POLICY-04 (minor lanes stay closed until all checks exist).
- Nothing leaves the home; weights are pre-fetched and pinned, with rows in `/stack/v1/privacy`.

**3.5 Create.** The Edit tab and Stems mixer take "Bring a song" through the kit's existing file-upload part (the control the Library upload uses), with no raw `<input type="file">`, no wrapper and no `className` override. If the part is missing it is a `commons` kit change first with a `UI-DECISIONS.md` row (rule 9, 9b). Same tool, same card.

**3.6 Status (rule S6).** A down or queued voice-swap or transcription worker, or a long edit job, reports through the existing music job Status row (TIER-HOME-03) and Repairs; the edit controls disable through the existing health row. No new banner, toast or poll.

## 4. Slices (each one to three files, Codex first, each with its chat half)

| Slice | Size | What | Proof |
|---|---|---|---|
| R0 | M | Stack bench: ACE-Step cover melody keeping on three songs and strengths; Seed-VC vs SoulX-Singer SVC with a TTS clip; mlx-whisper on sung lyrics | measured notes, listened to; decides R4 engine |
| R1 | M | `resolveSongSource`, `track` accepts an owned attachment, four Home refusals and the Stack ledger refusal relaxed for `owned_file`, provenance `upload`; restyle and instrumental of an attached song (adults) | test: attached file restyles, ledger untouched, commercial unknown |
| R2 | M | Chat: `audioAttachments` into the turn, `musicEditAllowed` on an attached song, routing examples, CHAT-AB-01 rows, card | real chat run: attach, "make it reggae", card plays |
| R3 | L | `parts` and `mix` (keep, drop, replace) with tempo alignment | remove vocals, keep drums and bass, plays; mix exports |
| R4 | L | Voice swap worker (Stack) and `voice` argument; companion reference clip | real run: converted vocal heard and Whisper-checked |
| R5 | M | Teen and child lane: transcription screen and as-sung check on the result, fail closed (needs MUSIC-GEN-22, -15, CONTENT-POLICY-01, -04) | each row of 3.4 has a test, including the result check |
| R6 | S | Create: Bring a song entry; docs `docs/user/music.md`, privacy rows | opened at 1440 and 390 |

## 5. Reuse check (org principle 6)

| Piece | Prebuilt used | Hand-built only where |
|---|---|---|
| Restyle, repaint, extend | ACE-Step 1.5 cover, repaint, extend (built) | the source-owner flag and ledger relaxation |
| Stems | Demucs htdemucs, already shipped (TIER-STEMS-01 to -03) | `parts` selection logic |
| Mix, level, tempo | ffmpeg amix and loudnorm, Rubber Band as a separate process (GPL, not linked) | tempo alignment glue |
| Words screen | mlx-whisper `whisper-large-v3-turbo` (MIT) in the Stack worker | the compare-and-fail-closed rule |
| Voice swap | Seed-VC (GPL, separate process) or SoulX-Singer SVC (Apache-2.0), chosen by the R0 bench; RVC only for a one-time-trained voice | the worker wrapper and reference clip handling |
| Ownership and reading | existing `readAttachment` | `resolveSongSource` |
| Create picker | kit file-upload part | nothing |

## 6. Supersedes

- stem-splitting-2026-10-30.md 10.1 points 1 and 2 (a chat file is not a source; chat takes no attachment), 10.2 point 3 (the ledger stays closed to uploads, for owned sources on cover, repaint, extend and edit only; stems unchanged), 10.2 point 5 (Home never uses a stem as a voice or music source: narrowed, a stem lives only inside one job), 10.2 point 7 (Home neither writes nor reads lyrics: the words screen reads them locally and drops them).
- music-listen-create-2026-11-01.md 3.3 (Stems row: "chat never takes an attachment").
- music-studio-2026-10-31.md: its Q3 line that MUSIC-GEN-14 stays Jesse's decision, "Singer swap v1 means a described voice", and its upload row ("closed until MUSIC-GEN-14").
- music-generation-2026-10-17.md section 9: `imitates_real_voice` is stale (rule 0).
- BACKLOG: MUSIC-GEN-14 is resolved by MUSIC-REMIX-01.

## 7. Risks

Stem bleed and SVC artefacts on harmonies; key or tempo drift when mixing a regenerated part (rubberband holds about plus or minus 10 percent tempo); Whisper misses sung words, so a clean result is probable only; copyright of a commercial song is a personal-use gray area, kept inside the home; GPL code (Seed-VC, Rubber Band) runs only as separate processes; read each weight LICENSE before R4.
