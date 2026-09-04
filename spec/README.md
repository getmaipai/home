# home/spec: the household's shapes

Source of truth for everything the hub and robot agree on. Platform plan
chapter 3. This is **spec v0.1**: Person, Setting, Memory/Entity/Episode,
the package manifest/recipe/result shapes, the error catalogue, the
settings registry, the capability and permissions vocabularies, UI schema
v0 (Chat only), both recipe interpreters, and both host emulators, per the
Hub v0.1 scope in the platform plan's roadmap (chapter 13). Everything else
chapter 3 describes (Capability grant, Content ceiling, Integration,
Device, the link API, the LLM and voice contracts) lands with the release
that needs it, not now.

## Layout

| Path | What it is | Hand-written or generated |
|---|---|---|
| `schemas/*.schema.json` | JSON Schema 2020-12, the source of truth for every record and package shape | hand-written |
| `gen/ts/` | Zod schemas + TS types, one file per `schemas/*.schema.json` | generated, committed. `bun run gen:ts` |
| `gen/py/` | Pydantic v2 models, same schemas | generated, committed. `bash scripts/gen-py.sh` |
| `errors/errors.json` | The error catalogue (conforms to `schemas/error-entry.schema.json`) | hand-written |
| `settings/keys.json` | The settings registry (conforms to `schemas/settings-key.schema.json`); empty until core or a package declares a key | generated from declarations, currently empty |
| `vocab/capabilities.json` | The capability vocabulary (3.2) | hand-written |
| `vocab/permissions.json` | The permissions vocabulary, the install prompt's fixed enum (3.2) | hand-written |
| `ui/schema.json`, `ui/pages/*.json` | UI schema v0 (Chat only) and the Chat page itself | hand-written; see `ui/README.md` for why this isn't codegen'd |
| `interpreters/ts/`, `interpreters/py/` | The Tier 0 recipe interpreter, one per language, kept behaviorally identical | hand-written |
| `emulators/ts/`, `emulators/py/` | A deterministic offline stand-in for the `host.*` RPC surface (4.9), one per language | hand-written |
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
