# home/spec: the household's shapes

Source of truth for everything the hub and robot agree on. Platform plan
chapter 3. This is **spec v0.1**: Person, Setting, Memory/Entity/Episode,
the package manifest/recipe/result shapes, the settings registry, the
capability and permissions vocabularies, UI schema v0 (Chat only), both
recipe interpreters, and both host emulators, per the Hub v0.1 scope in
the platform plan's roadmap (chapter 13). Everything else chapter 3
describes (Capability grant, Content ceiling, Integration, Device, the
link API, the LLM and voice contracts) lands with the release that needs
it, not now.

The error catalogue's *shape* (`ErrorEntry`) and the privacy row shape
(`PrivacyRow`, used by the manifest's `data_sources[]`) are owned by
`@maipai/standards` (std-v0.2.0) and imported by `$ref`, not defined here;
see "Cross-repo schemas" below. The populated error catalogue itself
(`errors/errors.json`) is this repo's own content.

## Layout

| Path | What it is | Hand-written or generated |
|---|---|---|
| `schemas/*.schema.json` | JSON Schema 2020-12, the source of truth for every record and package shape | hand-written |
| `schemas.resolved/` | A local-only copy of `schemas/` with the cross-repo standards `$ref` swapped for a local file; not committed, `gen-py.sh`'s input | generated build output, gitignored |
| `gen/ts/` | Zod schemas + TS types, one file per `schemas/*.schema.json` | generated, committed. `bun run gen:ts` |
| `gen/py/` | Pydantic v2 models, same schemas | generated, committed. `bash scripts/gen-py.sh` |
| `errors/errors.json` | The error catalogue, conforming to `@maipai/standards`' `ErrorEntry` shape | hand-written |
| `settings/keys.json` | The settings registry (conforms to `schemas/settings-key.schema.json`); empty until core or a package declares a key | generated from declarations, currently empty |
| `vocab/capabilities.json` | The capability vocabulary (3.2) | hand-written |
| `vocab/permissions.json` | The permissions vocabulary, the install prompt's fixed enum (3.2) | hand-written |
| `ui/schema.json`, `ui/pages/*.json` | UI schema v0 (Chat only) and the Chat page itself | hand-written; see `ui/README.md` for why this isn't codegen'd |
| `interpreters/ts/`, `interpreters/py/` | The Tier 0 recipe interpreter, one per language, kept behaviorally identical | hand-written |
| `emulators/ts/`, `emulators/py/` | A deterministic offline stand-in for the `host.*` RPC surface (4.9), one per language | hand-written |
| `safety/ts/`, `safety/corpus/` | The deterministic multi-signal safety classifier (4.3), TS only for now (see `safety/README.md`); the labelled corpus it's tested against | hand-written |
| `fixtures/records/` | One valid example per record schema, round-tripped through both generated model sets | hand-written |
| `fixtures/recipes/` | Recipe + inputs + expected result, run through both interpreters to prove they agree | hand-written |
| `tests/ts/`, `tests/py/` | The tests that make every proof above real, not asserted | hand-written |

## Generating

```
cd spec
bun install
bun run gen:ts        # -> gen/ts/
bash scripts/gen-py.sh # -> gen/py/ (needs uv)
```

Both are committed output. `home`'s `check.sh` regenerates both and fails
if the result differs from what's committed, so a schema change without a
regeneration is caught, not shipped silently.

## Testing

```
cd spec
bun test                        # TS: fixtures, recipe conformance, the UI schema, the host emulator
uv run pytest tests/py -q       # Python: the same four, mirrored
uv run ruff check . && uv run ruff format --check .
```

All of this runs from `home`'s `scripts/check.sh`.

## Cross-repo schemas: how `@maipai/standards` gets imported

`manifest.schema.json`'s `data_sources[]` `$ref`s
`https://getmaipai.github.io/.github/standards/schemas/privacy-row.schema.json`
(a sibling repo's schema, the same way `settings-key.schema.json` is
`$ref`'d within this repo). Both codegen targets need this resolved
before they can run, but differently:

- **TS** (`scripts/gen-ts.ts`): `$RefParser.dereference()` inlines it
  directly via a resolver override that maps the standards `$id` base back
  to `../.github/standards/schemas/` on disk (`MAIPAI_STANDARDS_DIR`
  overrides the sibling path).
- **Python** (`scripts/gen-py.sh`): first runs `scripts/bundle-schemas.ts`,
  which copies every `schemas/*.schema.json` byte-for-byte into
  `schemas.resolved/`, rewrites only the standards `$ref` string to a bare
  local filename, and copies the referenced standards schema alongside it.
  `datamodel-code-generator` then resolves it exactly the way it already
  resolves `settings-key.schema.json`: as a same-directory file, producing
  a real `from . import privacy_row_schema` line, not an inlined blob.

Both stop short of `$RefParser.dereference()`/`.bundle()` on the *whole*
document: either one, tried first, corrupted `recipe.schema.json`'s
internal `oneOf` of seven step types into a pile of duplicate, oddly
numbered classes (or, for `.bundle()`, something `json-schema-to-zod`
couldn't follow at all and silently fell back to `z.any()`, losing
validation entirely). The `gen-ts.ts`/`bundle-schemas.ts` comments explain
this in more detail; don't "simplify" either script back to a blanket
resolve without re-checking `recipe.ts`'s `steps` field afterward.

This means `standards/gen/ts/` and `standards/gen/py/` (in the sibling
`.github` checkout) need to already be generated before `home`'s codegen
runs; `home`'s `check.sh` doesn't currently verify that for you.

## How the robot pins this

Not wired up yet (there is no `bot` content to pin it from this session).
Per platform plan chapter 3, once this reaches `spec-v0.1.0`, `bot` pins it
as `maipai-spec @ git+https://github.com/getmaipai/home@spec-v0.1.0#subdirectory=spec`
and runs the same fixtures in `tests/py/` against its own stores. No tag
has been cut yet; this is still pre-release, unversioned spec work.

## Why two generated model sets for the same JSON Schema

The hub is TypeScript (Bun), the robot is Python (federation on shared
contracts, decision 1). Both read and write the same record shapes, so
both get real generated types instead of hand-maintained parallel ones
that drift. A cross-file `$ref` (the package manifest's `config[]` uses
`settings-key.schema.json`) round-trips through both generators; that's
part of what `tests/ts/fixtures.test.ts` and `tests/py/test_fixtures.py`
prove, not just that a single flat schema converts.
