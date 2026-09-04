# The UI schema

v0, Chat only (platform plan 6.2, Hub v0.1 roadmap scope). `schema.json`
is the source of truth: a JSON Schema 2020-12 document describing `UiNode`,
a recursive tree of the kit's primitives. `pages/chat.json` is the first
real page written against it.

## Why this isn't run through the record codegen pipeline

`spec/schemas/*.schema.json` (the record types) get generated Zod and
Pydantic bindings (`spec/gen/ts/`, `spec/gen/py/`) because code
*constructs* those objects: core creates a `Person`, a package returns a
`SkillResult`. Nobody constructs a `UiNode` object graph in TypeScript;
every page is authored as a JSON document, the way `pages/chat.json` is.
`schema.json`'s recursive `$ref: "#"` structure also does not codegen well
through `json-schema-to-zod` (its recursion handling falls back to
`z.any()` past a shallow depth, which would silently stop validating
nested content).

So UI pages are validated the more direct way: as JSON Schema, with
[ajv](https://ajv.js.org) (draft 2020-12 support, proper `$ref` and
`oneOf`/`discriminator` handling). See
`spec/tests/ts/ui-schema.test.ts`. `Recipe`'s `oneOf` union of step types
went through the codegen pipeline fine because it isn't recursive; `UiNode`
is, hence the different treatment.

## What v0 covers, and what it does not

Only what the Chat page needs: `page`, `section`, `message_thread` (the
pattern component Chat's own review resulted in, not a generic primitive
the plan names), `form`, `empty_state`, `progress`, plus the five actions
(`navigate`, `call`, `play`, `confirm`, `ask`) and a `binding` shape for
route and `host.*` data sources with a `stream` flag for `turn.token`-style
incremental delivery (7.2).

`List`, `CardGrid`, `MediaShelf`, `DetailPane`, `SplitView`, and whatever
pattern components the Videos and Music pages need do not exist here yet.
Platform plan 6.2 calls out Chat, Videos, and Music as the three hardest
pages to express and says to time-box each in turn, not invent primitives
ahead of need; this file follows that.
