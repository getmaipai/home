# Home's shell and pages on shadcndashboard, the chat on assistant-ui Elements (2026-09-21)

The owner's rules of 2026-09-21 (org CLAUDE.md, principle 6; DECISIONS
2026-09-21, two entries): no hand-built UI; Home's shell and every
non-chat page come from `shadcndashboard` used exactly as it ships;
the chat is assistant-ui Elements used exactly as they ship; tokens
are the only thing Home changes; Home writes routes, data and copy,
never a component. This record is the program: what is vendored,
what is stripped, the decisions the inventory forced, the visual
stand-up first, then the wiring page by page.

## What is vendored, and where

Into the kit, `commons/ui/src/dashboard/`, as a snapshot of
`github.com/shadcndashboard/shadcndashboard` (the Vite variant; MIT;
its commit pinned in `commons/ui/docs/dashboard-upstream.md` with
the sha, and attribution added to `commons/NOTICE`): `src/components`
(the 55 shadcn primitives on Base UI and the page-level components),
`src/layouts` (FullLayout: SidebarProvider, Sidebar, SidebarInset,
Header with search, notifications, theme toggle and profile menu,
Footer), `src/views` (the modern dashboard, data tables, form
layouts, user profile, the auth flow, error and maintenance), the
one hook (`use-mobile`), the theme context and `globals.css` (the
CSS-variable token set and the style-variant mechanism). Nothing in
those files is edited; the only edits are import paths so the files
resolve inside the kit.

Stripped at vendoring, recorded in the upstream note (removing demo
and marketing content is not customizing a component): the three
demo apps (Blog, Notes, Tickets) with Tiptap, the MSW mocks and the
`api/mocks` tree, the fake-data generator, the "Buy Now" upsell card
and the `isPro` nav badge rendering, and one of the two icon systems
(`@iconify/react` goes; `lucide-react` stays, it is also what the
Elements use).

## Decisions the inventory forced

- **Primitives**: Base UI, the template's. The kit's Radix-based
  vendored set stays only until the last page has moved, then it is
  deleted; no page is composed from both. The Elements bring their
  own shadcn dependencies; where an Element and the template both
  vendor a primitive of the same name, each keeps its own copy under
  its own folder (a component is never edited to share), and the
  duplicate is a known, bounded cost until upstream aligns.
- **Data fetching**: the template's pages fetch with SWR through its
  `global-fetcher`; Home points the fetcher at its own API and keeps
  the pages' hooks as shipped. TanStack Query remains for the old code
  until it is removed. Two fetch layers during the migration, one
  after.
- **Routing**: `react-router` 7 (the template imports from
  `react-router`, Home from `react-router-dom`, same library and
  major); Home's route table moves to the template's import path.
- **Icons**: `lucide-react`; the kit's own icon set retires with the
  pages that used it.
- **Looks**: the template's style-variant system (a body class that
  swaps a named preset, layered under light and dark) is how Studio
  and Calm ship: two presets of CSS variables, the palette and the
  radii and spacing from the 2026-09-20 design doc as the values,
  nothing else. `ui.look` keeps selecting between them.
- **Settings**: the template has no settings view; Settings is the
  smallest composition of shipped parts, the form-layouts view's
  row patterns inside the tabs and card primitives, with the page
  structure from `docs/dev/session-a-settings-rulings-2026-09-21.md`
  as data (one section tree for both scopes, the scope switch, routed
  link-out cards for the management surfaces, inline rows for plain
  keys, Privacy as a section).
- **Chat**: assistant-ui Elements as shipped, on Home's existing
  runtime and adapters (nothing on the wire changes except the
  artifact record, a separate item); artifact-card and canvas-split
  are the artifact experience.
- **Generative UI, the output contract** (owner's rule, 2026-09-21
  04:30): a tool's result is emitted as the structured part the
  matching shipped Element renders (a chart for numbers over time, a
  spec sheet for a thing's facts, a data table for a list, sources
  for citations), never narrated as prose and never drawn by Home.
  This includes weather: no weather card, chart or component is
  created anywhere in Home or the kit; the weather tool emits its
  structured result and the Elements' chart and spec-sheet render it
  as they ship. The same holds for every tool.
- **The design doc of 2026-09-20**: its numbers become token targets;
  its component rulings retire. The captures it produced are
  replaced by the stand-up's.

## Step 1: the visual stand-up (one session-day, no wiring)

Behind one household setting, `ui.shell.next` (a spec key, off by
default; it governs the chat too, there is no separate chat flag), a second route tree at `/next/*` mounts the template's
FullLayout with Home's sidebar items as data (Home, Chat, Apps;
Household: People; System: Settings; Manage: Engines, Updates,
Repairs, Backups; the labels and routes only), and the template's
views on their own demo data: `/next` the dashboard, `/next/apps` the
data-tables view, `/next/people` the user-profile and tables views,
`/next/settings` the form-layouts view under tabs, `/next/sign-in`
the auth view, `/next/chat` the Elements thread with the mock runtime
the Elements ship for demos, with reasoning, a tool call, sources and
an artifact-card that opens canvas-split. The old routes and the old
shell are untouched. Acceptance: at 8787 with the setting on, every
`/next` route renders the template's page in both looks and both
themes; captures at 1440 and 390 of each, opened and judged for one
thing only, that nothing on them is Home-drawn; the kit tag (ui-v0.5.0)
carries the vendored snapshot, NOTICE, the upstream note and the two
presets.

## Step 2: wiring, page by page (the checklist)

One item per row, each swapping a demo data source for Home's and
keeping the template's page as shipped. The table is filled in as
each lands.

| /next route | Template view or Element | Data source to wire | Old file it retires |
|---|---|---|---|
| `/next` | modern dashboard (KPI cards, charts, recent list) | engines status, updates, repairs, people, activity | `frontend/src/apps/home/*`, the dashboard blocks in the kit |
| `/next/chat` | Elements: thread, thread-list-sidebar, composer family, reasoning, tool-call, sources, artifact-card, canvas-split, orb, read-aloud | the existing model, history, thread-list, suggestion, attachment, dictation adapters; the artifact record | `apps/chat/thread.aui.tsx`, `chatDocumentPane.tsx`, the kit's `.aui` files |
| `/next/apps` | data-tables view | packages list, install and remove | `apps/apps/*`, `ThingsTable` |
| `/next/people` | user-profile, data-tables | people, memories tab | `apps/people/*`, `apps/memories/*` |
| `/next/settings` | form-layouts in tabs and cards | the settings renderer's keys by section and scope | `apps/settings/*`, `apps/privacy/*` |
| `/next/engines` | data-tables, cards | the Engines API (HOME-STACK-04a) | none (new) |
| `/next/updates`, `/next/repairs`, `/next/backups` | data-tables, cards | the routes HOME-STACK-05 landed | `apps/settings/UpdatesSection.tsx`, repairs, backups pages |
| `/next/sign-in` | auth view | Home's sign-in and passkeys | `apps/auth/*` |

One flag, one switch (owner's rule, 2026-09-21 03:30): the shell and
the chat move together. There is no `ui.chat.next`; `ui.shell.next`
governs both, the `/next/chat` row is part of the same stand-up, and
the day the flag defaults on, `/next` becomes `/` for every page
including Chat. The old shell and the old chat are deleted together,
one commit, a release later.

## The chat's wiring table: every capability to its Element

The `/next/chat` row is landed capability by capability against this
table (owner's instruction, 2026-09-21 04:35: each Element is called
at the moment its capability happens). Left, what the turn engine or
the Stack does; right, the Element that renders it, as shipped, and
the part or adapter that feeds it. A capability with no Element is a
named gap, not a Home-drawn substitute.

| Capability (Home / Stack) | Element(s) | Fed by |
|---|---|---|
| The reply text | markdown-text (renderer), message-pair, message-actions, message-timing | the model adapter's text parts |
| Thinking before the reply | reasoning, thinking-indicator | the reasoning part (`--reasoning` on, streamed) |
| A tool call and its result | tool-call, tool-group, tool-timeline, tool-error, tool-fallback | the tool-call parts the turn engine already emits |
| A tool result with structure (weather, almanac, lookups, comparisons, procedures) | chart, spec-sheet, data-table, diagram, mermaid-diagram | the structured part per the generative-UI contract; nothing drawn by Home |
| Image generation (the Stack's `image` role) | image-generation | the image job: queued, progress from the Stack's job events, the finished file |
| Sources and citations (lookups, knowledge) | sources, inline-citation, document-reference, retrieval-chunks | the citation and evidence data the turn already carries |
| A generated document or code (artifacts) | artifact-card, canvas-split, code-diff, shiki-highlighter | the artifact record, the model's artifact tool, versions |
| Speaking a reply (the `tts` role) | read-aloud | the speech route through the Stack client |
| Listening (the `stt` role, dictation, the live voice session) | composer-voice, transcription, voice-conversation, orb | the stt socket and the dictation adapter |
| The wake word and the live connection | connection-state, orb | the wake-word hook and the engine health |
| A destructive or gated action (delete, purchase, a child's request escalated) | approval-card, permission-grant, confirmation | the turn's approval part; the safety pass |
| The child band and safety notices | guardrail-notice | the child projection and the safety result |
| Errors, an engine down, a repair | error-state, empty-state, connection-state | engine health and the Repairs list |
| Attachments (photos to the vision role) | composer-attachments, attachment | the local image attachment adapter |
| Suggestions and follow-ups | composer-slash-commands, composer-mentions, composer-context, the suggestions of the thread | the suggestion adapter |
| Editing, retrying, branching a turn | edit-message, message-branches, message-queue, draft-restore, checkpoints | the history adapter and the runtime |
| Conversations (list, search, pin, delete, the admin's person view) | thread-list-sidebar, thread-search, conversation-search | the thread-list adapter (HOME-UI-02e's functions as data) |
| Turn cost and timing (the stats) | cost-meter, context-breakdown, context-display, trace-waterfall, message-timing | turn stats from the backend |
| Model choice, the model picker | composer-model-picker | the Stack's roles and models through the Engines API |
| Memory outcomes (saved, not saved, failed) | none shipped: named gap; until an Element exists, the outcome is a notification (the shell's notifications), not a chip drawn by Home | the memory state |
| Agents, plans, subagents, MCP | agent-card, agent-plan, task-card, mcp-config, mcp-server-panel | later; the Stack's job feed when the household runtime has agents |
| Sharing a conversation, background runs | shared-conversation, background-runs | later |

## The wire the Elements expect

Session B's item 1: every Element on this session's row of the wiring
table above, read at https://www.assistant-ui.com/elements, with the
exact part or prop shape it binds to as shipped, set against what
Home's turn stream (`backend/src/wire.ts`'s `TurnStreamEvent`/
`TurnValue`) and its typed details document (`commons/spec`'s
`TurnArtifact`, `backend/src/lib/composer.ts`) already carry. A row
marked **gap** needs new wire, not a frontend adapter; a row marked
**rename** needs only a reshape at the boundary; a row marked **fed**
already has what it needs.

| Element | Binds to (as shipped) | Home's wire today | Verdict |
|---|---|---|---|
| **tool-call** | `ToolCallMessagePartComponent<TArgs, TResult>`: `args`, `argsText`, `result`, `status`, `toolName`, `toolCallId`, `isError` | The turn engine's existing tool-call parts (`ToolExecutionOutcome`, `ToolCallWire`) already carry args/result/toolName/toolCallId shape-for-shape | **fed** |
| **chart** | `ToolCallMessagePartComponent<TArgs,TResult>`; component props `label, value, delta, points, visibleCount, variant` | `TurnArtifact.section` has no time-series shape (its five kinds: lookup, card, procedure, comparison, document) | **gap, unfed today.** Nothing in the current composer produces a numeric series. Not needed for weather/almanac's first conversion (both are point-in-time facts, not series) - a real producer needs a new `TurnArtifact` section kind, out of tonight's scope, named here so it isn't silently forgotten. |
| **spec-sheet** | `backend`-tool render: `result.title`, `result.subtitle?`, `result.rows: {label, value, emphasis?}[]`, `visibleCount` | `TurnArtifact`'s `card` section (film/person/place, each a flat set of named fields plus `source_id`) | **rename.** A `card` section maps directly: `title = name`, `rows = [{label, value}, ...]` for each non-null field in kind order. This is weather's and almanac's spec-sheet target. |
| **data-table** | `ToolCallMessagePartComponent<TArgs, readonly Row[]>`; standalone `rows`, `cycle` | `TurnArtifact`'s `lookup` section (`{title, line}[]`) and `comparison` section (`subjects[]` + `rows: {attribute, values[]}[]`) | **rename.** Both map onto `data-table` rows; `comparison`'s subjects become columns. `procedure` (numbered steps with quantities) fits neither `data-table` nor `spec-sheet` well - flagged as an unmapped section, not solved here since no Element on this session's list covers it (the catalog's `todo-list` is a candidate; Session A's row, not mine). |
| **sources** | Message part `{type: "source", sourceType: "url"\|"document", id, url?, title?, mediaType, filename?, status}`, registered as `MessagePrimitive.Parts` `components={{Source: Sources}}` | `TurnArtifact.sources[]`: `{id, kind: web\|wikidata\|wikipedia\|weather\|package, title, url, site, snippet, source, created_at, hlc}` | **gap/rename.** Shapes don't line up: no `sourceType`, no `mediaType`. Every one of our `kind`s is web-ish, none an uploaded document, so the adapter is one direction only: emit `sourceType: "url"` for all of them, `id`/`url`/`title` pass through, `site`/`snippet`/`kind`/`hlc` drop (the Element doesn't render them). A `source` message part per `TurnValue.sources` entry needs adding to the stream - today sources ride only inside `done`'s `TurnValue`, never as their own streamed parts. |
| **inline-citation** | Not runtime-bound at all: "assistant-ui has no positional link between a citation marker and an offset inside streamed message text" - ships as a specimen you hand-edit, placing `<Citation index={n}>` around your own sentence | The reply text already carries `[N]` markers baked in (composer.ts's docstring: the Perplexity-shaped pattern CHAT-16 validated) | **rename, frontend-side.** No backend change: the `[N]` markers plus the reshaped `sources` array (row above) are exactly what a custom `markdown-text` renderer needs to place `<Citation>` at each `[N]`. This is Session A's wiring, named here because it depends on the `sources` reshape above. |
| **image-generation** | `backend`-tool render: `args.prompt` (string, partial while streaming), `status.type: running\|complete\|incomplete\|requires-action`; only `"running"` shows the generating animation; no image URL prop at all - a separate renderer takes over once done | The Stack's `image` role job events: `queued`, `progress` (presumably numeric), `done` with a file | **gap.** Two real mismatches: (1) `image-generation` has no field for a numeric progress percentage, only a boolean-ish `running`/not; the plan's capability row promises "progress from the Stack's job events" but the shipped Element cannot show a number - `queued` and `progress` both have to collapse into `running` until upstream adds one, which is a real, stated gap, not something to invent a prop for. (2) once `done`, the finished file needs the separate `image` Element (not on this session's list) - `image-generation` never renders the result itself. |
| **reasoning** | Message part `{type: "reasoning", text, status?, unstable_summary?}`; consecutive parts grouped via `groupPartByType({reasoning: ["group-reasoning"]})` | `TurnStreamEvent` has no reasoning event today (`turn_meta`, `signal`, `delta`, `status`, `spoken_cue`, `done`, `error`) | **gap.** Needs a new additive stream event, `{ type: "reasoning"; text: string; sequence?: number }`, alongside `delta`, fed from the chat engine's own `--reasoning` output when the role has it on (today only the background role runs with `--reasoning off`; the chat role's reasoning stream isn't captured anywhere yet). |
| **read-aloud** | Runtime state `s.message.speech: {messageId, status: starting\|running\|ended}` plus `aui.message.speak()`/`stopSpeaking()`, wired through a `speech` adapter on the provider (the shipped default, `WebSpeechSynthesisAdapter`, is browser TTS) | Home's `tts` role runs through the Stack, not the browser | **gap.** Needs a custom speech adapter calling Home's own speech route instead of the shipped browser adapter (still "as shipped" - the adapter interface is exactly what's meant to be swapped, per the Elements' own pattern). Separately: the runtime only exposes coarse `starting/running/ended` status, never per-word timing - `read-aloud`'s `words`, `spokenIndex`, `elapsed`, `duration` props need the app's own tracking (a running timer against the audio's duration, not real word boundaries) unless the Stack's `tts` role starts emitting word-boundary timestamps, which it doesn't today. Named as an open question rather than decided here. |
| **approval-card** | `backend`-tool render: `render({args, approval, respondToApproval, result})`; `approval.approved` is `undefined\|false\|true` (request/denied/approved-running-or-done, `result` disambiguates running from done); `respondToApproval({optionId: "once"\|"always"\|"deny", reason?})` resolves it, all on the SAME tool call, same live turn | `backend/src/lib/approvals.ts`: a durable, asynchronous queue - a request is filed, then decided later (minutes to never) by any adult, often on a different screen entirely, via a notification, not a live reply to the model mid-turn | **resolved (coordinator, 2026-09-21): both kinds kept, see paragraph below the table.** |
| **guardrail-notice** | Binds to `message.status?.type === "incomplete" && status.reason === "content-filter"`; output via `aui.thread.append()`; standalone props `title, explanation, policy, alternatives, onPick?` | `TurnValue.source: "safety_refuse"` with a full `SafetyResult` (`categories`, `action`, `matched_signals`, `crisis_resources`) on an otherwise complete, well-formed message - never a stopped/incomplete stream | **named gap, confirmed (coordinator, 2026-09-21); nothing built now.** A later spec bump gives `SafetyResult` (or a sibling wire field) `title`, `explanation`, `policy`, and `alternatives`, generated deterministically from the matched category, never model prose (`docs/RULES-AND-LEARNED-COMPONENTS.md`); the safety-refused message's stream status is marked `{type: "incomplete", reason: "content-filter"}` so the Element's own detector fires. Tracked here so it isn't lost, not scheduled. |
| **artifact-card** | `backend`-tool render: `args.title, args.meta, generating: status.type==="running", args.words` | New: the artifact-creating tool this item defines (below) | **fed by design** - the new tool's args are shaped to match (see "The turn-engine tool" below). |
| **canvas-split** | `ToolCallMessagePartComponent<DocArgs>`: `args` streams partially (the model's raw JSON as it writes), `status.type`, per-field streaming state via `useToolArgsStatus()` | Same new artifact tool | **fed by design** - the tool's body argument is a single string field so it streams naturally into the live "still-writing" view; the persisted `artifact` record (below) is the settled state once the tool call completes, not the live view's own data source. |
| **generative-ui** (mechanism, not a single Element) | A generic `present` tool built from `JSONGenerativeUI({library})`, taking a `{$type, ...props}` component tree from the model and matching `$type` against a registered library | N/A | **not adopted.** Our structured results are a small, closed set (the five `TurnArtifact` section kinds plus weather/almanac), each already mapped above onto one specific Element (`chart`, `spec-sheet`, `data-table`) via that Element's own dedicated tool render. Registering one tool per structured result type is simpler than standing up the generic `present`/`$type` tree for a fixed, known set, and keeps each tool's result schema-typed rather than an untyped component-tree blob. This satisfies the plan's "generative-UI, the output contract" rule (a tool's result renders as the matched structured part) without the extra mechanism. |

**Approval-card, two kinds, both kept (coordinator's decision, 2026-09-21).** A same-turn gate on the requester's own action (delete these, send this, spend this) is `approval-card` bound directly to that tool call, live, resolved by `respondToApproval()` in the same turn - no queue, no notification, nothing added to `approvals.ts`. A cross-person decision (a child's request only a parent may decide) never renders `approval-card` on the requesting child's own turn; it stays `approvals.ts`'s existing async queue and surfaces to the parent exactly as it does today, as a shell notification, and when the parent opens it, that queued item is what renders as an `approval-card` - on the parent's side, against the queued request, not inside the child's turn. Every approval part the emitter produces carries which kind it is, so a client never has to guess which button behavior applies; naming that field (e.g. `scope: "same_turn" | "queued"`) is part of implementing the approval-card row, not decided here.

Two cross-cutting findings, not specific to one row: first, several Elements (`sources`, `reasoning`, `guardrail-notice`) need genuinely new stream event types or message-part shapes on `TurnStreamEvent`/`TurnValue` - additive, per Compatibility, but real backend work beyond this item's own artifact record and tool. Second, `chart` (no current producer) and `image-generation` (no numeric-progress field) are notes for later, not open questions - nothing to build against either one tonight.

## Sessions and order

Session A (fresh, Sonnet) takes step 1 from this record, then the
rows in table order; Session B, after the installer, takes the
artifact record and the turn-engine tool the artifact-card needs,
then the Engines row; the lanes take S rows (updates, repairs,
backups) once the pattern is landed by the first two rows. Each row
is one commit with its test, its capture and the table row filled.
Review budget as usual; the reviewer's first check on every row is
"is anything here Home-drawn", and a yes returns the item.

## Risk and rollback

The old shell and chat stay untouched behind the flag until the last
row; every row is one commit; rollback is the flag. The vendored
snapshot's upstream drift is a manual merge, on a schedule (the
monthly dependency sweep), against the pinned sha in the upstream
note.
