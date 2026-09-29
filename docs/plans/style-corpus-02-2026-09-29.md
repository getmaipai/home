# STYLE-CORPUS-02: class-aware targets - the frame rewrite for document-shaped typed rows, the full rewrite everywhere else

## Why

`VOICE-CLASS-01`'s design pass (`docs/dev.md`, "VOICE-CLASS-01 design
pass: one adapter per companion, two registers", Fable, 2026-09-29)
decided this after real evidence from `STYLE-CORPUS-01b` (landed
`561531c1`): a spoken-class reply takes the companion's voice whole (the
brief `STYLE-CORPUS-01b` already used); a typed reply whose bare neutral
answer is document-shaped (headings, list markers, more than two
paragraphs - the correct, already-accepted written-class production
behavior per `PREFIX-CLASS-01`) keeps its body character for character
and takes the voice only in its opener and closer. This is the pattern
every mainstream assistant with both a text and a voice mode already
uses (cited at length in the design record - read it, it has the
evidence, the prior-art research and the exact kept/dropped examples
this item's acceptance criteria are built from).

This item builds that split into the actual corpus generator.
`STYLE-CORPUS-01b` is closed and accepted with this exact gap named as
its own follow-up - this is that follow-up, not a redo of anything it
already did (the teacher swap, the local-27B wiring, the earlier
validator false-positive fixes all stand untouched).

## Files you own

`~/Developer/github.com/getmaipai/home` (work in an isolated worktree,
`isolation: worktree`):
- `backend/scripts/voice/corpus.ts`
- `backend/tests/voiceCorpus.test.ts`
- `backend/scripts/voice/fixtures/` (re-committed per companion, per
  acceptance below)
- `docs/BACKLOG.md`'s `STYLE-CORPUS-02` row
- `docs/dev.md` (append a dated section beside tonight's
  `STYLE-CORPUS-01b`/`VOICE-CLASS-01` entries, don't rewrite them)

Nothing else. No production runtime code, no training, no bench.

## Setup

`cd` into your worktree, confirm clean, `git fetch origin main -q && git
merge --ff-only origin/main` (this pulls in `561531c1` and the design
record). Read `docs/dev.md`'s `VOICE-CLASS-01` section in full first -
it has the exact kept/dropped examples (the Pal "human heart" pair, the
default spoken 15/15 result, the carpet-stain digit-run case) that this
item's own tests are built from. Read `STYLE-CORPUS-01b`'s landed
`corpus.ts` and `voiceCorpus.test.ts` in full - this item extends that
file's own shape, not a rewrite.

## Steps

Follow `docs/BACKLOG.md`'s own `STYLE-CORPUS-02` row exactly - it is
fully specified (search for it, the row itself names every function,
every check and every test case). In short: `replyShape()` classifies a
neutral reply as `document` or `conversational`; `splitFrame()` splits a
document-shaped reply into opener/body/closer; a second fixed brief
(`FRAME_BRIEF`) asks the teacher to rewrite only the frame; `validatePair`
becomes class-aware (document rows: body byte-identical, frame word
counts within 1.5x, one added sentence per frame paragraph at most 25
words; full-rewrite rows: the five existing checks, length band as the
larger of 25% or 8 words, matching `REWRITE_BRIEF`'s own stated number);
the spoken prompt pool gains the five typed kinds under the spoken
prefix (a child's/teen's typed turn is spoken-class in real production,
`promptSurfaceClassFor`); each row records its shape and exact system
prompt; the drop rate prints per companion, per class and per shape.

The row's own test list is the test list - implement exactly those five
(the numbered how-to splitting correctly, a body-word-change being
dropped, an opener/closer-only change being kept, the Pal aside-after-
bold-label case being dropped as a reproduced fixture, a grown spoken
reply being kept). Don't invent additional scope.

## Acceptance evidence

Per the BACKLOG row exactly: the four corpora rebuilt against the local
teacher (`MAIPAI_VOICE_TEACHER_URL`, required, no hardcoded default -
this is already true in the file you're extending, keep it that way);
drop rates per companion AND per class/shape in `dev.md` beside
tonight's table; document-shaped typed rows under 20% dropped per
companion; full-rewrite rows (spoken + conversational typed) under 20%
dropped per companion; a miss on either is a finding about that specific
brief, reported honestly, never a relaxed check; the 20-row sample
fixtures re-committed per companion with at least five document-shaped
rows each.

If a real full run is impractical in the time this item reasonably
takes (the last one ran many hours), a rigorous small-scale run (the
same n=35/companion shape `STYLE-CORPUS-01b` used, or larger if time
allows) is acceptable evidence AS LONG AS it's reported as exactly that,
not dressed up as the full acceptance numbers - say plainly what scale
you measured at and why, the way the landed `STYLE-CORPUS-01b` commit
itself did with its own two-run account.

## Exit checks

- `bash scripts/check.sh` green, scope noted.
- Code review at low effort (extending an already-reviewed file's own
  shape, not new architecture) with an explicit target (`main...HEAD` in
  your worktree).
- One commit, staged by name.
- Push once green (`git push origin HEAD:main`).

## Reporting

Ready, then wait for start. Done: commit hash, check.sh pass line, the
per-companion/per-class/per-shape drop rates, which test cases pass,
whether you ran full-scale or a rigorous small-scale sample (and why).
Blocked: exact error - confirm `$MAIPAI_VOICE_TEACHER_URL`'s health
yourself before reporting the teacher unreachable, since the eGPU it
depends on has a documented flaky history; ask the coordinator rather
than touching laptop infrastructure yourself. Question: only if the
`VOICE-CLASS-01` design record and the BACKLOG row's own text
genuinely conflict on a detail neither resolves - re-read both fully
before concluding that.
