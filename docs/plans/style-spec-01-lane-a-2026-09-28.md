# STYLE-SPEC-01: companion.style_adapters in the manifest schema

Lane: codex-a, worktree `~/Developer/github.com/getmaipai/home-codex`.
This item lives in `commons`, not `home` -- your worktree of `home` is
just where this brief sits; do the real work in `commons`'s own working
checkout at `~/Developer/github.com/getmaipai/commons` (check `git status`
there first, same care as the FAMILY-NAV-01 pin bump -- clean and on
`main` before you touch anything; if not, stop and report a question).
Model floor: Codex, low reasoning (mechanical, the design call is
already made in full).

## Ready handshake

Report ready (model, checkout, branch, "ready for STYLE-SPEC-01"), wait
for "start".

## Why

`home/docs/BACKLOG.md`'s `STYLE-SPEC-01` entry (search for it) and the
design note it points at, `home/docs/dev.md`'s "EVAL-03 design pass: a
companion's voice is a per-companion style adapter, selected per
request, never prompt prose and never a process-wide control vector
(Fable, 2026-09-28)" -- read that whole section first, it is the ground
truth for every field name and shape below. The short version: each
companion can have a trained voice adapter (a small LoRA file) per base
model, and the catalog manifest needs a place to declare it, once, so
`home` can find and download it later (a different item, not this one).

## Files you own

`~/Developer/github.com/getmaipai/commons`:
- `spec/schemas/manifest.schema.json`
- whatever fixture/round-trip test files the existing `companion`
  object's own tests live in (find them the same way you'd find any
  other manifest field's tests -- mirror the pattern, don't invent one)
- the generated TypeScript and Python types (regenerated, not
  hand-edited -- find the generation command the same way `commons`
  already documents it, likely a `bun run` or script in `spec/`)

Nothing else. Do not touch `home`, `bot`, or `catalog` in this item.

## Setup

`cd ~/Developer/github.com/getmaipai/commons && git status` (confirm
clean, on `main`) `&& git pull --ff-only`.

## Steps

1. Read `spec/schemas/manifest.schema.json`'s existing `companion`
   object in full, especially its `status_phrases` field (the design
   note names this as your pattern to mirror for "how an optional
   companion sub-object is declared and inlined -- no same-file `$ref`,
   per that field's own note") and its four style dials
   (`formality`/`complexity`/`engagement`/`filler_density`) for the
   general shape and description-writing convention this schema uses.
2. Add `companion.style_adapters`: optional, an array of at most 8
   objects, `additionalProperties: false`, with these required fields:
   - `base_model` (string) -- a model package id
   - `format` (string, enum, exactly one allowed value: `"gguf-lora"`)
   - `url` (string, must be an https URL)
   - `sha256` (string, exactly 64 hex characters)
   - `approx_bytes` (integer, minimum 1)
   - `corpus_sha256` (string, exactly 64 hex characters)
   Also mirror `modelCatalog.ts`'s own `download` object for how this
   repo's schemas typically express a URL/checksum/size triple -- find
   that file and match its field-naming and validation convention
   exactly rather than inventing a slightly different shape.
   Write one description sentence for the new field, saying what it is
   and pointing at the dev.md section by name (`"EVAL-03 design pass"`).
3. Regenerate the TypeScript and Python types from the schema (find and
   run the existing generation command -- do not hand-write the
   generated files).
4. Add one round-trip fixture with `style_adapters` present (a
   plausible, made-up example -- persona-roster names only if a name is
   needed anywhere, per the org's PII rules) and confirm an existing
   fixture without the field still validates (it must, since the field
   is optional).
5. Write the two tests named in the backlog item, in these words: a
   manifest with a well-formed `style_adapters` entry validates; an
   entry missing `sha256`, or with `format: "peft"` instead of
   `"gguf-lora"`, is refused and the schema/validator names the field
   that's wrong (check however this schema's existing validation error
   messages already report a bad field, and match that shape -- don't
   invent a new error format).
6. Cut a new spec tag the same way this repo already does (check a
   recent spec tag's own commit for the exact pattern: version bump in
   `spec/package.json` and/or `pyproject.toml`, commit, `git tag`,
   push) -- **do not bump `home`'s pin to this new tag as part of this
   item**; that is explicitly out of scope here, a separate item wires
   it up when it actually needs the field.

## Acceptance evidence

- The two named tests passing.
- The two fixtures (with and without `style_adapters`) both validating.
- `bash scripts/check.sh` green in `commons`, scope noted.
- The new spec tag name reported in your done report.

## Exit checks

- `bash scripts/check.sh` green (paste it).
- Code review at `low` effort (a schema addition plus generated types,
  no logic) with an explicit target (`main...HEAD`).
- One commit, staged by name. Docs/changelog in the same commit if
  `commons` has a per-tag changelog convention (check).
- Push to `commons`'s `origin/main`, then tag and push the tag
  (`git push origin <tag>`).

## Reporting

Ready, then wait for start. Done: commit hash, tag name, check.sh pass
line, the two test names and what they assert. Blocked: exact error.
Question: only if the type-generation command or the tag-cutting
convention genuinely isn't findable from a recent example -- don't
guess on either.
