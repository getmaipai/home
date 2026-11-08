# One translation service (design, 2026-11-07)

Owner: Jesse, 2026-11-07: "We need a single one and we can use it for the localization of this app and even translate our GitHub
documentation." Rules in [RULES.md](RULES.md) govern; nothing here asks for a rule change. Related: CAPTION-02 to 04, MUSIC lyric translation.

## Supersedes

It moves the engine half of [i18n-2026-11-07.md](i18n-2026-11-07.md) section 7 (prompt, batching, parse, validation) into a shared core. What stays exactly as section 7 says:

- 7.2 batching: the `ui` kind keeps one batch per source file, split past `MAX_BATCH_ENTRIES` (150). The core default of 20 applies to `subtitle`, `lyric`, `doc` and `chat` only.
- 7.3 readiness: `stackCompleter` checks that chat is ready before each batch, runs one batch at a time and stops at the first "not ready".
- 7.5 retry: the `ui` kind keeps it exactly: each failed entry is retried alone, then left empty and reported, with no whole-batch retry. The other kinds retry the batch once, then each item alone.
- 7.7 back translation (the review list) and 7.8 (no host but the Stack, with its test) stay in the catalog adapter and `stackCompleter`.

It also merges the caption language list (17) and the lyric list (18) into one `LANGUAGES`; the `lyric` kind keeps its own batch size of 18 and `subtitle` keeps 20, and adds the reader-band output check to lyrics, which had none.

## 1. Reuse check

Searched `translat` across `backend/src`, `frontend/scripts`, `scripts`, `docs` and the package folders. Four places translate today:

| Where | What | Own copy of |
|---|---|---|
| `backend/src/lib/transcripts/captionTranslate.ts` | caption tracks, JSON array contract, 20 per batch, age filter, 17 languages | language list, prompt, batching, parse, safety hook |
| `backend/src/lib/music/lyricsTranslate.ts` | lyric lines, numbered-text contract, 18 per batch, cache table `music_lyric_translations` | prompt, batching, parse (no age filter) |
| `frontend/scripts/translate-catalog.ts` | `.po` catalogs, glossary, protected copy, validation, Stack-only fetch, `needs-review` flag | prompt, batching, parse, validation |
| `backend/packages/translate` | chat "translate X to Y" | its own prompt |

Rule 1 (one definition): the engine call, the batching, the reply parse, the validation, the language list and the safety hook
exist three times. This note makes them exist once and turns the four places into thin adapters. Extend, do not add a fifth.

Future users, so nobody builds a fifth copy: MUSIC-GEN-20c (lyric translation by the local model), AUDIO-PARITY-01 V3 (translate with
dubbing), CHAT-CARDS-10 (the same `translate` package).

Prebuilt over hand-built (principle 6): the Markdown splitter does not parse by hand. It uses `remark-parse` with `remark-gfm` (`remark-gfm` is
already a dependency; Fumadocs parses the same way) as a parse-only pass, takes each text node's source position, and slices the
original string at those positions. Fixed parts are never rewritten, so the byte-exact round trip holds without a new parser.

## 2. The decision

One module, `backend/src/lib/translate/` (scripts already import from `backend/src/lib`, so the catalog and docs scripts use it too).

1. `core.ts`, no database or Hono imports, so scripts can use it:
   - `LANGUAGES`: code to English name and native name. One list; captions, lyrics, docs and the chat package read it. App locales
     stay `SUPPORTED_LOCALES` (a subset the app ships catalogs for).
   - `translateItems({ items, from, to, kind, glossary?, completer, check?, onProgress? })`: batches (default 20, a kind may
     override), one prompt per `kind` (`subtitle | lyric | ui | doc | chat`), JSON-array reply contract, count and non-empty
     check, one retry of the batch, then each failed item alone, then the item is reported failed (never silently source text).
   - `validateTranslation(source, out)`: the checks the catalog script has today (placeholders, em dash, exclamation point,
     length), extended per kind (subtitle max length, lyric line count).
   - `isProtected(refs, id)`: the catalog script's protected-copy rule (child, teen, crisis, consent, refusal, spoken, robot) moves here
     unchanged. It is applied to catalog ids and source references only, never to caption, lyric or document text (RULES rule 0: no word
     lists on content). Protected catalog entries are never translated by the model.
   - `check` hook: the caller's output gate. Anything that reaches a person on a band passes `evaluateReply` (rule 10); captions
     and lyrics pass their reader's band (for an adult that blocks only what rule 10 allows it to block: CSAM), catalogs and docs run
     in the operator's context and are reviewed. Logs and `onProgress` carry counts and ids only, never caption or lyric text (rule 6a).
   - Reply format: the core asks the engine for JSON-schema output (an array of exactly N strings) where the engine offers it, and
     parses a JSON array from text only as the fallback.
2. `engine.ts`: two completers behind one type. `hubCompleter` (`completeBackground` from `@/lib/llm`, used inside Home) and
   `stackCompleter(url)` (the catalog script's Stack-only fetch, used by scripts). Nothing leaves the home (PRIVACY.md): the Stack-only
   fetch is the only network path in either.
3. `markdown.ts`: splits a Markdown file into translatable segments and fixed parts and puts them back. Never sent to the model:
   fenced and indented code, inline code, link and image targets, HTML tags, front matter keys other than `title` and `description`,
   table pipes, anchors. A round trip with the identity translator must return the file byte for byte (the test that proves it).
4. Adapters, each small:
   - captions: `captionTranslate.ts` keeps its job and storage, calls `translateItems({ kind: "subtitle" })`.
   - lyrics: `lyricsTranslate.ts` keeps `musicLyricTranslations` caching, calls `translateItems({ kind: "lyric" })`.
   - catalogs: `translate-catalog.ts` keeps `.po` reading and writing, the glossary file and the `needs-review` flag; its batching,
     prompt and validation are deleted in favor of the core.
   - docs: new `scripts/translate-docs.ts` (section 4).
   - chat package: the `translate` package (also CHAT-CARDS-10) reaches the core through a host tool, `host.translate({ text, to })`,
     exposed to packages like the other host tools, so a package never imports a lib. The tool calls `translateItems({ kind: "chat" })`
     for the person's band and returns one string (TRANSLATE-06). It is a host capability in `packageHost.ts`, not a tool the turn offers
     (no change to the turn's tool set, rule 1's budget). The package keeps `min_role: "child"`: a child gets the child band's filtered
     result, so nothing is taken away from children. The bot side of the package keeps working offline as today (`offline: "full"`).

No new database table. Caching stays where it is (lyrics table; catalogs are files).

## 3. Behavior that must not change

Captions: 422 when the age filter holds output, nothing stored unless every cue translated, translated tracks never refresh. Lyrics:
cache by media id, language and source hash. Catalogs: every fill is `needs-review`, protected entries stay empty for a reviewer.
Each adapter keeps its existing tests green before its internals move (port before delete).

## 4. Documentation translation

`bun scripts/translate-docs.ts --locale es [--path docs/user/transcripts.md] [--dry-run] [--check]`.

- Source: the English files in `docs/user/` and the published site content under `docs/site-fumadocs/content/docs/`. `docs/dev/`,
  `docs/api/`, design notes and anything with a PII or homelab marker are not translated.
- Output goes next to the source in a `<locale>` subfolder of the site content (the Fumadocs layout for languages), with front matter
  `machine_translated: true`, `source_sha256` and `translated_at`. A changed source marks its translation stale (`--check` lists
  stale ones and fails when asked); the script retranslates only changed files.
- Same glossary as the app (`frontend/src/locales/glossary.json`), so product words match. Same style rules (grade 6, no em dash).
- Pages carry a visible one-line "Translated by the home's AI, may read oddly" note until a person clears `machine_translated`.
- Publishing the translated site is a separate step and needs Jesse's word; this slice only writes files.

## 5. Slices (backlog rows TRANSLATE-01 to 06)

| Row | Slice | Size |
|---|---|---|
| TRANSLATE-01 | `core.ts`, `engine.ts`, language list, validation, protected rule, tests with a scripted completer | M |
| TRANSLATE-02 | captions adapter onto the core | S |
| TRANSLATE-03 | lyrics adapter onto the core (adds the age filter lyrics lack) | S |
| TRANSLATE-04 | catalog script onto the core, tests unchanged | M |
| TRANSLATE-05 | `markdown.ts` and `scripts/translate-docs.ts`, Spanish first | M |
| TRANSLATE-06 | chat `translate` package onto the core | S |

Order: 01, then 02 to 05 in any order (separate files), 06 last.

## 6. Verification

Core: scripted completer tests (count mismatch, bad JSON, partial failure, protected refusal, each validation). Markdown: identity
round trip on every file in `docs/user/`. Each adapter: its existing test file passes unchanged. One real run per adapter against the
hub's model on a small input, output read by me. Docs: translate one page to Spanish, open it, judge it.
