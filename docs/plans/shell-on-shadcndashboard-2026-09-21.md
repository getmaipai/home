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
