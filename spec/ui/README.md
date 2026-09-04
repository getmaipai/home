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

## `pages/chat.json` describes the real backend, but nothing executes it yet

Originally written against placeholder routes (`/api/chat/turns`,
`/api/chat/send`, `/api/chat/status`, `/api/chat/suggestions`) that never
existed. Fixed (`home/docs/dev.md`'s shell/kit/Chat slice) to the real
routes the backend actually serves: `message_thread` binds to
`GET /api/conversations` (`stream: false` - the turn engine is single-shot
JSON today, not the incremental `turn.token` delivery 7.2 describes; flip
this back to `true` once it is), and the form's `on_submit` calls
`POST /api/turn` with `text`, not `message`. The `progress` node's `bind`
was dropped rather than pointed at a route: there is no separate status
poll, a turn's in-flight state is derived from the pending request itself.

**`sender_field`/`text_field` are honest about what exists, not about
what a real Chat page renders.** A first fix (caught by code review,
2026-09-04) left them as `speaker.display_name`/`reply.text` - fields
that describe `TurnValue`'s shape, not what `GET /api/conversations`
actually returns. The real rows (`backend/src/wire.ts`'s
`ConversationTurnRow`) are flat: `personId`, `userText`, `replyText`, no
`speaker` or `reply` object anywhere. They're now `personId`/`replyText`,
which at least resolve to real fields, but this does not make the fixture
executable: **one `ConversationTurnRow` is a whole turn (a person's
message and MaiPai's reply together), while `message_thread` renders one
sender+text pair per bound item.** No field-path fix closes that gap; it
needs either a richer schema shape (a row expanding to two rendered
items) or a backend endpoint that already returns one entry per message.
Neither exists, and inventing either tonight would be exactly the kind of
generic-interpreter scope this file already defers. The frontend's real
mapping (`frontend/src/apps/chat/mapRows.ts`, tested) does the one-row-
to-two-messages expansion directly in code instead.

This file is still only a conformance fixture (`spec/tests/ts/ui-schema.test.ts`
validates its shape against `schema.json`), not something a renderer reads
at runtime: the frontend's actual Chat page
(`frontend/src/apps/chat/ChatPage.tsx`) is hand-written directly against
the kit primitives to match this shape, because a generic `UiNode`-tree
interpreter (bindings, conditions, the five action kinds) doesn't exist
yet. Building one is real, separate scope - `docs/dev.md` tracks it as a
deferred slice, the same category of gap as the turn engine's tier-2
tool-calling deferral.
