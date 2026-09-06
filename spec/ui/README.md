# The UI schema

`schema.json` is the source of truth: a JSON Schema 2020-12 document
describing `UiNode`, a recursive tree of the kit's primitives and pattern
components. `pages/*.json` are real pages written against it, one of
which (`memory.json`) is actually executed at runtime by the interpreter
in `frontend/src/kit/schema/`; the rest are conformance fixtures only -
see "What Session B step 5 actually converted" below for exactly which
and why.

## Why this isn't run through the record codegen pipeline

`spec/schemas/*.schema.json` (the record types) get generated Zod and
Pydantic bindings (`spec/gen/ts/`, `spec/gen/py/`) because code
*constructs* those objects: core creates a `Person`, a package returns a
`SkillResult`. Nobody constructs a `UiNode` object graph in TypeScript by
hand; every page is authored as a JSON document. `schema.json`'s
recursive `$ref: "#"` structure also does not codegen well through
`json-schema-to-zod` (its recursion handling falls back to `z.any()` past
a shallow depth, which would silently stop validating nested content).

So UI pages are validated the JSON Schema way, with
[ajv](https://ajv.js.org) (draft 2020-12 support, proper `$ref` and
`oneOf`/`discriminator` handling) - see `spec/tests/ts/ui-schema.test.ts`.
The frontend's own interpreter (`frontend/src/kit/schema/types.ts`)
separately hand-writes the same shapes in Zod, for its own reason: ajv's
validation runs at `spec`'s own `check.sh` time, which a frontend build
has no guarantee ran (or ran against the same file) - `SchemaPage.tsx`
parses every page through its own Zod schema before rendering it, an
independent, runtime proof. `catalog.test.ts` is the test that keeps
schema.json's `$defs` and the frontend's `NODE_TYPES`/catalog from
silently drifting apart.

## What Session B step 5 actually converted, and what didn't

The plan's own step 5 named four pages (people, memory, privacy,
settings) for schema-page conversion. Building the interpreter
(`kit/schema/`: `SchemaPage`, `NodeRenderer`, bindings via TanStack
Query, the five actions, a minimal condition evaluator) and converting
each page in turn surfaced real complexity the plan's own "time-box the
hard pages, don't invent primitives ahead of need" methodology (platform
plan 6.2, originally aimed at Chat/Videos/Music) turned out to apply
more broadly than expected:

- **Memory** converted for real (`pages/memory.json`,
  `frontend/src/apps/memory/MemoryPage.tsx` is now a thin mount). It was
  the one candidate page shaped the way the generic interpreter actually
  handles well: one bound list, one action per row, a batch capability
  (`list.batch`, used here for "archive selected"/"clear all" - the
  backlog's named consumer). One real, documented behavior change: the
  hand-rolled version resolved a memory's `person` id against the
  household roster to show a name ("Nova"); the schema page shows the
  raw scope value instead, since joining two separately-bound lists by id
  has no interpreter support (a real, separate feature, not built here).
- **People** stayed hand-written React. Its batch-select flow sits on top
  of a permission matrix (`roles.ts`'s `canManagePerson`/
  `canDeletePerson`/`canManagePeople`, evaluated per row against the
  actor's own role) plus inline per-row edit (a role picker, a name
  field) and a write-only secret/PIN field on create - none of which the
  schema's `action`/`condition` vocabulary expresses today without
  inventing a permission-predicate system and an inline-edit node kind
  that nothing else needs yet.
- **Privacy** stayed hand-written React. Its one real list has a rich,
  multi-field row template (destination/when/what/what/who/retention)
  plus conditional prose (`sourceKind === "platform" ? ... : ...`,
  `joinNames`'s own grammar-aware joining) that `list`'s single
  `item_label_field`/`item_subtitle_field` template can't reach without a
  much richer per-row template mechanism - exactly the kind of primitive
  the plan says to build when a real page needs it, not ahead of time.
- **Settings** stayed on its own existing generic renderer
  (`frontend/src/kit/settings/SettingsRenderer.tsx`, already reading the
  settings registry data-driven per docs/SETTINGS.md) rather than gaining
  a second, competing JSON description of the same data. `settings_editor`
  is a bare mount-point node (the same shape `message_thread` is for
  Chat) so a schema page can still say "Settings renders here"; step 7
  ("settings as an editor") extends that renderer directly - a tree
  sidebar, search, scope tabs - never a UiNode rewrite of it.
- **Chat**'s `message_thread` node was simplified to a bare mount point
  in the same step, once step 4 (chat on assistant-ui) had already moved
  every real concern - history loading, streaming, actions, the thread
  list - into React (`chatModelAdapter.ts`, `chatThreadListAdapter.ts`).
  v0's `bind`/`sender_field`/`text_field` described a generic turn-list
  interpreter that was never built; removing them here isn't a
  regression, it's catching the schema up to what actually shipped.

`pages/chat.json` and a future `pages/settings.json` remain conformance
fixtures ajv validates but the interpreter never receives at runtime -
`ChatPage.tsx` and `SettingsPage.tsx` mount their own real components
directly, keyed off the route. `pages/people.json` and
`pages/privacy.json` don't exist; People and Privacy stay entirely
hand-written, `docs/dev.md`'s A2UI entry has this same reasoning as the
project's standing record of the decision.

## `list`'s one templating mechanism

`item_subtitle_field`, `row_action.label` and `action.confirm.prompt` all
take a `{field}`-style template string (`frontend/src/kit/schema/
fieldPath.ts`'s `fillTemplate`), not a bare dotted path - the same
substitution everywhere, so a subtitle can combine more than one field
("`{category} · {scope}`") without a second, richer per-row template
mechanism. `{count}` is the one placeholder a confirm prompt gets that no
single bound item's own fields could ever supply (the number of items a
batch action is about to act on).
