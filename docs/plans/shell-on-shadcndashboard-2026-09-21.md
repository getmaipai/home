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
| `/next/apps` | data-tables view (`DataTable`) | packages list (`GET /api/plugins`); install and remove stay on the old route (see the row's own named gap below) | not yet - `apps/library/AppsPage.tsx` still owns install/remove, `ThingsTable` retires once it does |
| `/next/people` | user-profile (own profile card), data-tables (`DataTable`) | the household (`GET /api/people`); the signed-in person's own profile only (see the row's own named gap below) | not yet - viewing another person's own profile and the Memories tab still need `apps/people/*`, `apps/memories/*` |
| `/next/settings` | form-layouts in tabs and cards (`Tabs`, `Card`) | the settings registry (`GET /api/settings/registry`, `GET`/`PUT`/`reset /api/settings`) by section and scope; every other management page stays on the old route (see the row's own named gap below) | not yet - only the registry-driven inline keys moved, `apps/settings/*` still owns every dedicated management page |
| `/next/engines` | data-tables (`DataTable`) | `GET /api/engines`, `GET /api/engines/health` (HOME-STACK-04a) - roles by address, engine state, health severities; actions (start/stop/restart, a role switch) stay on the old surface (see the row's own named gap below) | none (new) |
| `/next/updates`, `/next/repairs`, `/next/backups` | data-tables (`DataTable`) | `GET /api/updates`, `/api/repairs`, `/api/backups`; apply/rollback, fix/dismiss and run/restore all stay on the old pages (see the row's own named gap below) | not yet - all three old pages still own their own real actions |
| `/next/sign-in` | auth view | Home's sign-in and passkeys | `apps/auth/*` |

**SHELL-01's own named gap (found landing the row, 2026-09-21):** the
modern dashboard's widgets (`@maipai/ui/src/dashboard/components/
dashboards/modern/*`) take no data at all - not one accepts a prop or
calls a hook of its own, and neither does anything else in the vendored
`ui/src/dashboard` tree (`useSWR`/`global-fetcher` appear nowhere in
it). `chance` and the MSW `api/mocks` tree, both stripped at vendoring
(`ui/docs/dashboard-upstream.md`'s own "Stripped" list), were the real
data layer even upstream - these widgets are demo compositions with
hardcoded numbers, not components in the "as shipped" sense the no-
hand-built-UI rule protects, since editing one to accept a prop would
be forking a vendored file. Resolution (the owner's own ruling, with a
reference picture - shadcn's own dashboard-01 block is the density
wanted): Home composes its own page from the SAME shipped primitives
those widgets are built from (`Card`, the chart wrapper under
`components/ui/chart`, `Table`, as shipped), mirroring each vendored
widget's own JSX 1:1, one file per widget under `frontend/src/next/
pages/dashboard/`. Only widgets with a real Home counterpart exist:
the greeting, people count, updates available, repairs open and engine
health (owner/admin only - the wire itself omits those fields for
anyone else, so their presence in the response is the visibility
check), turns per day as the chart, recent activity as the table; no
revenue, sales, orders or profit cards. A vendored widget file is
never edited or imported once its Home counterpart lands.

**SHELL-03's own named gap (found landing the row, 2026-09-21):**
unlike the dashboard's demo widgets, the data-tables view's own
`DataTable` (`@maipai/ui/src/dashboard/components/tables/data-table/
DataTable.tsx`) genuinely takes a `data` prop and derives its own
columns from the row shape it's handed - real data-binding surface, no
composition needed to get Home's own apps (`GET /api/plugins`, the
same query `AppsPage.tsx`'s own `pluginsQuery` already reads) into
real rows and columns. Two narrower gaps inside that same file, found
the same way: (1) its header is a literal `Employee Data Table` string
in the JSX, not a prop - every table built on it, whatever data it
carries, shows that title; not fixable without forking the vendored
file, so `NextAppsPage.tsx` puts a real `CardHeader`/`CardTitle` (the
same shipped primitives every other `/next` page's own header already
uses) above the table instead - the page's real title reads correctly
even though the table's own internal one still doesn't, and the
vendored file stays untouched. (2) its per-row "Action" column (a
pencil and a trash icon) has no click handler wired to either icon at
all - decorative, not a real prop surface - so real install/remove
stays on `AppsPage.tsx` (the old shell's own route, with its own
`DetailsPane` and a working Remove action) until a shipped table with
an actions callback exists to move it to. `/next/apps` is the
read-only listing only: name, category, type, version, and a real
Ready/Attention status (`packageState()`, exported from `AppsPage.tsx`
so both routes read the identical rule rather than defining "Ready"
twice). A third gap, found the same way but out of this row's own
scope: neither shell filters the list by the actor's role today -
`min_role` gates invocation only (`lib/plugins.ts`'s `runPlugin()`,
`lib/widgets.ts`, `lib/turnEngine.ts`), never visibility - tracked as
its own item, `APPS-VIS-01`, since fixing it in `routes/plugins.ts`
fixes both shells at once.

**SHELL-04's own named gap (found landing the row, 2026-09-21):** the
vendored `UserProfile` (`@maipai/ui/src/dashboard/components/
user-profile/index.tsx`) is the same shape as the dashboard's own demo
widgets - zero data-binding surface, every field (`firstName`,
`email`, `phone`, `position`, `facebook`/`twitter`/`github`/`dribbble`,
`location`, `state`, `pin`, `zip`, `taxNo`) a local `useState` seeded
with hardcoded demo values, and its "Edit" dialogs only ever write
back to that same local state, never a server. Composed from the same
shipped primitives it's built from instead (`Card`, `CardContent`, the
kit's own `Avatar`), mirroring its top header card's shape (an avatar,
a name, a subtitle line) - every field with no Home counterpart comes
out rather than getting faked: no email, phone, position, social
links, address, or Edit action (account editing already lives in
Settings -> Users, the same "the edit part is for USERS, not people"
rule `AppsPage.tsx` documents). `/next/people` shows the SIGNED-IN
person's own profile only - viewing someone else's profile, and the
Memories tab, stay on `PersonProfilePage.tsx` until their own row
moves them; `PersonProfilePage.tsx`'s own real "This is your own
profile." copy is reused verbatim rather than reworded. The household
list reuses `/next/apps`'s own `DataTable` pattern exactly (a real
`data` prop, real rows, the same hardcoded-title fix as a `CardHeader`/
`CardTitle` above it, the same dead Action-column icons left
unwired) - `GET /api/people` is unscoped by design (`PeoplePage.tsx`'s
own "a plain directory, readable by anyone signed in" comment), so
nothing was invented to filter it.

**SHELL-05's own named gap (found landing the row, 2026-09-21):** the
template's own form-layouts view (`@maipai/ui/src/dashboard/components/
form/index.tsx`) is the same shape as the dashboard's demo widgets and
the profile view - zero data-binding surface, every field a local
`useState` seeded with demo values. Composed instead from the template's
own individual form primitives (`Input`, `Select`, `Switch`, `Button`,
all under `.../dashboard/components/ui/*`) through one new mapping,
`NextSettingField.tsx`: the registry's own selector vocabulary
(boolean/select/number/text/secret today; duration/time/entity/area/
person/media typed but unbuilt, same as the kit's own pre-existing
`SettingField.tsx`) to the primitive that renders it, one definition,
reused by every key rather than a per-key component. That existing kit
file (`@maipai/ui/src/settings/SettingField.tsx`, home/kit-authored, not
a vendored snapshot) already solved this exact mapping against the
kit's own pre-shadcndashboard primitives - `NextSettingField.tsx`
mirrors its selector-by-selector logic (the draft/commit/reset cycle,
the write-only secret flow) rather than reinventing it, reusing its two
pure exported helpers (`titleCaseOption`, `localeDisplayName`)
directly. The grouping logic itself (`groupSettings()`, `sectionTitle()`
- three disclosure levels, expert filtered out, advanced folds at three
or more) is pure, no-UI, and imported as-is by the new
`NextSettingsRenderer.tsx` rather than copied a third time; only the
JSX renders through `Card`/`CardHeader`/`CardTitle` (matching every
other `/next` page's own section-heading shape) in place of the kit's
`Section` primitive. A named, accepted duplication until the old shell
retires: the field-control logic now lives in two files reading the
identical registry, the same class of cost SHELL-03's `packageState()`/
`kindStyle()` exports were written to avoid one function at a time -
here the underlying primitives genuinely differ (pre- and
post-shadcndashboard), so the two copies can't collapse into one import
the way those did.

Out of scope for this row, each staying on the old `/settings` route:
every dedicated management page the registry-driven renderer can't
draw (Users, Models, Backups, Voices - `VOICE-BROWSER-01`'s own browse
list among them - Commands, Devices, Repairs, Updates, Health), the
retired "one section tree" redesign and its link-out cards, Privacy's
things-table, Voice's top-choices row (all `docs/dev/session-a-
settings-rulings-2026-09-21.md`), and `@modified`/search filtering
(docs/SETTINGS.md Rule 5). `/next/settings` is the registry's own
inline keys only, split Household vs Me exactly as `SettingsPage.tsx`'s
own tab switcher already does (same two labels, the Household tab
gated to owner/admin - a non-admin has nothing else to switch to,
since household-scope writes 403 for anyone else).

**SHELL-06's own named gap (found landing the row, 2026-09-21):**
`GET /api/engines` had never had a frontend at all - `docs/BACKLOG.md`'s
own "Old file it retires: none (new)" for this row, confirmed by a grep
of the whole frontend for `/api/engines` before writing a line, which
came back empty. Two real sub-gaps found the same way: (1) neither
`GET /api/engines` nor `GET /api/engines/health` distinguished "no
Stack configured" (the common case - Jesse's own household) from a
real failure; both threw the identical Stack-unreachable 503 either
way, which this row's own acceptance ("the 'No Stack' state must be
the honest one, not an error") can't be built against. Fixed at the
source, `backend/src/routes/engines.ts`: both routes now check
`isStackConfigured()` first and return 200 with `configured: false`
(empty roles/engines, a null budget, an empty health list) instead of
a 503 - the identical "null is the real answer, not a fabricated one"
posture `dashboard.ts`'s own `engineStatusCounts()` already took for
this exact case, just never extended to these two routes until this
row needed it. (2) the vendored `DataTable` has the same dead Action
column every other `/next` table already found (no click handler on
either icon) - real engine actions (start, stop, restart) and a role
switch have no shipped table to carry them, so they stay wherever they
already partly exist (the Stack's own admin surface; Home has never
built a frontend management page for them either) until one does. This
row's own scope is the three real read-only tables the acceptance
names: roles by address, engine state, and health severities. A
household-memory-budget card (the route's own "cards" half) is a real,
separate follow-up - not built here since the acceptance didn't ask
for it and adding it unasked would be inventing scope.

**SHELL-07's own named gap (found landing the row, 2026-09-21):** all
three old pages are real, unlike SHELL-06's `/api/engines` - `GET /api/
updates`, `/api/repairs` and `/api/backups` are all live and already
have a frontend (`UpdatesSection.tsx`, `RepairsSection.tsx`,
`BackupsSection.tsx`), so this row is a genuine port: real `DataTable`
rows built from `rowsFrom()`/`hasUpdate()` (exported from
`UpdatesSection.tsx` rather than redefined - the identical "does this
row have a real update" rule, one definition) for Updates, real
`Issue[]` rows for Repairs, real `BackupInfo[]` history rows plus the
real pending-restore banner for Backups. One correction to the row's
own ask: Backups was framed as "history rows with size and outcome and
the schedule card" - `BackupInfo` (`backend/src/wire.ts`) carries only
`filename`/`createdAt`/`bytes`, no outcome field (a failed backup
attempt never produces a listed file, so there is no failed row to
show), and neither the old page nor `GET /api/backups` has ever had a
schedule concept - the "Backup storage limit" setting's own help text
names a fixed retention cadence, a quantity limit, not a schedule
anything renders. Built against what is actually there instead of
inventing the two missing pieces.
Real actions (apply an engine update and roll one back, run a repair's
fix or dismiss it, run a backup now or restore one) are wired on all
three old pages through the kit's own `ThingsTable`/hand-built
`Button`s - real callback surfaces `UpdatesSection.tsx`'s own
`rowActions` prop and `RepairsSection.tsx`'s/`BackupsSection.tsx`'s own
`onClick`s already use. The vendored `DataTable`'s Action column has no
click handler wired to either icon, the same gap every `/next`
data-table has found so far, so all three actions stay on the old
routes. All three `/next` pages gate to owner/admin exactly as their
old counterparts do (`AdminGatedContent`), even where a route itself
reads looser (`GET /api/updates` is `requireAuth` only) - matching the
old page's own visible gate is the parity this row asks for, not a new
rule.

**SHELL-08's own named gap (found landing the row, 2026-09-21):** the
row's own ask named "the child's PIN vs an adult's password as the old
page distinguishes them" - `SignIn.tsx` makes no such distinction.
Every profile, child or adult, gets the identical
`<Input type="password">`; `usePinAutoSubmit`'s own 4-digit-numeric
check is what quietly makes a short PIN feel instant without the UI
ever needing to know in advance which kind of secret a profile has.
Built against the real, single field instead of inventing a role-aware
switch that would diverge from it. Dropped, no counterpart: the
template's own social sign-in buttons, "Remember this device"
checkbox, "Forgot password" and "Create an account" links - none of
these exist in MaiPai's model (a session is a session, an owner/admin
resets another person's secret, profiles are created in Settings, not
self-service).

Two real, separate limitations, not built around: (1) `useShellNext()`
resolves `ui.shell.next` via `GET /api/settings?scope=household`,
which is `requireAuth` - a genuinely cold, never-authenticated load of
`/next/sign-in` has no session to read the flag with. Landing this row
found a second way this bites, not just the cold-browser case: signing
out invalidates the session server-side, and if anything refetches
this exact query afterward (found live, capturing this row's own
screenshot - a background refetch racing `/api/auth/logout`), it now
401s. `useShellNext()` used to read `!query.data` alone, so either case
spun `RouteSkeleton` forever with no way out; it now checks
`query.isError` too and bounces to `/` (the same fallback a resolved-
false flag already gives), so a real failure no longer hangs, though a
genuinely cold, never-authenticated visit still has no session to
resolve the flag with at all - that half needs its own pre-auth path,
out of this row's scope. The realistic warm path this row's acceptance
asks for (a sign-out from within an already-open `/next`, not a cold
browser typing the URL first) still works the way it always did: no
page reload happens on sign-out - only `App.tsx`'s own
`setPerson(null)` - so the settings query's cache from before signing
out stays valid as long as nothing forces a refetch in between.
(2) No real sign-out control exists yet anywhere in `/next`'s own
chrome to reach that in-session path from: the vendored `FullLayout`
header's `Profile.tsx` sheet has a genuine "Log Out" button (a real
callback-capable shipped part, unlike a dead Action-column icon), but
it is hardcoded to `<Link to="/auth/auth2/login" />`, the vendored
demo's own nonexistent route, not Home's real `api.logout()` - and per
"never edit a vendored file," it can't be forked to point elsewhere.
Tracked as its own follow-up rather than hand-building a sign-out
control unasked; SHELL-08's own live verification exercises the
sign-in half directly and the sign-out half through the old shell's
already-real control, both landing the same in-session, no-reload
person state Home actually runs on.

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
| Thinking before the reply | reasoning, thinking-indicator | the reasoning part (`--reasoning` on, streamed) (landed: REASONING-01, home 57c4b430). **`thinking-indicator` landed 2026-09-22 (slice 5(c))**: the kit's own `elements/thread.aui.tsx` gained an `Indicator` slot (`ui-v0.5.29`, an upstream-bound patch) whose default now renders the shipped `ThinkingIndicator` Element instead of a hand-drawn dot; `NextChatPage.tsx` overrides it with `ChatThinkingIndicator`, porting `/chat`'s own `status`/`spoken_cue`-driven activity line and 45s "still working" timer - `status` turned out to already be a real wire event (CHAT-16, 2026-09-15), so this is live-rendering behavior, not scaffolding, proven by a genuinely staggered-stream test. See `docs/dev.md`. |
| A tool call and its result | tool-call, tool-group, tool-timeline, tool-error, tool-fallback | the tool-call parts the turn engine already emits |
| A tool result with structure (weather, almanac, lookups, comparisons, procedures) | chart, spec-sheet, data-table, diagram, mermaid-diagram | the structured part per the generative-UI contract; nothing drawn by Home (landed for weather and almanac: home af0af0aa) |
| Image generation (the Stack's `image` role) | image-generation | the image job: queued, progress from the Stack's job events, the finished file |
| Sources and citations (lookups, knowledge) | sources, inline-citation, document-reference, retrieval-chunks | the citation and evidence data the turn already carries |
| A generated document or code (artifacts) | artifact-card, canvas-split, code-diff, shiki-highlighter | the artifact record, the model's artifact tool, versions (landed: the record home af0af0aa, the primitive and write_document package home 3ca9aa8e) |
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
| **sources** | Message part `{type: "source", sourceType: "url"\|"document", id, url?, title?, mediaType, filename?, status}`, registered as `MessagePrimitive.Parts` `components={{Source: Sources}}` | `TurnArtifact.sources[]`: `{id, kind: web\|wikidata\|wikipedia\|weather\|package, title, url, site, snippet, source, created_at, hlc}` | **gap/rename.** Shapes don't line up: no `sourceType`, no `mediaType`. Every one of our `kind`s is web-ish, none an uploaded document, so the adapter is one direction only: emit `sourceType: "url"` for all of them, `id`/`url`/`title` pass through, `site`/`snippet`/`kind`/`hlc` drop (the Element doesn't render them). A `source` message part per `TurnValue.sources` entry needs adding to the stream - today sources ride only inside `done`'s `TurnValue`, never as their own streamed parts. **Correction, slice 5(a) (2026-09-22):** the `MessagePrimitive.Parts components={{Source: Sources}}` binding above does not hold against the vendored kit - `elements/thread.aui.tsx`'s own parts switch has no `case "source"` and `ThreadComponents` has no such slot (it was written from the upstream Elements docs, not the snapshot actually vendored into `commons`). Landed instead as a synthetic `tool-call` part (`toolName: "sources"`), the same composition already used for `structured_part`/`write_document` - see `docs/dev.md`, "Slice 5(a)." **Follow-up (2026-09-22):** the Element itself gained a `layout="list"` prop (kit `ui-v0.5.26`, `commons/ui/docs/dashboard-upstream.md`'s own "Patches pending upstream" table) for shadcn.io's AI Sources shape - an upstream-bound patch, not a fork; retires once the PR against `assistant-ui/assistant-ui` merges and a newer snapshot carries it. PR opened 2026-09-22: [assistant-ui/assistant-ui#7962](https://github.com/assistant-ui/assistant-ui/pull/7962) (the `layout` prop and the key fix only, per scope). **Second follow-up (2026-09-22, CHAT-UI-03):** the trigger itself moved into the assistant message's own action bar (last item after "..."), the compact list rendering below the whole footer row - two more upstream-bound patches (kit `ui-v0.5.27`): `Sources` gained `hideTrigger` so a caller's own trigger elsewhere can drive the same lifted state, and `thread.aui.tsx`'s `ThreadComponents` gained `AssistantActionBarExtra`/`AssistantMessageFooterExtra` as the two append points. `NextChatPage.tsx`'s own `SourcesActionBarTrigger`/`SourcesFooterContent` compose the subtle bar-row trigger (stacked favicon glyphs, the word "Sources", ghost style, no pill/badge/chevron - the count lives in the tooltip) from the same shipped `SourceGlyph`/`Sources`, no new visual component. |
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

## The artifact record

`commons/spec/schemas/artifact.schema.json` (`spec-v0.1.7`): one
immutable version of a generated markdown/code/html document - `id,
conversation_id, turn_id, kind, title, body, version, parent_version,
created_by, provenance, created_at, hlc`. Distinct on purpose from
`TurnArtifact` (COMP-01's evidence-grounded details document, built from
retained tool outcomes, never model prose): this record is the model's
own authored content, versioned like a file, and chains by
`parent_version` naming the prior version's own `id` - conversation-
turn's `parent_turn_id` convention, not `TurnArtifact`'s bare `revision`
counter, because the wire needs a version's own id (the artifact-card/
canvas-split tool call and the message metadata both name one). Home's
own table (`backend/src/db/schema.ts`'s `artifacts`, migration `0053`)
adds two Home-internal, non-synced columns the spec record has no
concept of: `artifactKey` (minted once at version 1, copied onto every
later version, groups one artifact's whole chain) and `isCurrent` (a
partial unique index keeps exactly one current row per `artifactKey`,
flipped inside the same transaction that inserts the next version -
`backend/src/lib/artifacts.ts`'s `createArtifact`/`updateArtifact`).
Updating a version that is no longer current is refused (409): there is
nothing to redo forward to, and history is read-only once superseded.

**Child projection is an access gate, not a content strip.** Unlike
`TurnArtifact`'s citation-stripping child projection, an artifact has no
field that becomes unsafe for a child to see once flagged - the whole
version is either visible or it isn't. `visibleArtifactRow()` extends
`canAccessPerson()`'s existing "a child sees only their own turns" rule
with one more condition: the turn that produced this version must not
have been safety-refused (`conversationTurns.safetyAction !== "refuse"`
when the actor is a child). A refused turn produces no artifact today,
so this is defense in depth against a future path that could, proven by
a direct-insert test rather than a real refusal flow.

**Routes** (`backend/src/routes/artifacts.ts`, read-only - creating and
updating happens through the turn-engine tool below, never a route):
`GET /api/artifacts/:id` returns one version's spec-shaped JSON;
`GET /api/artifacts/:id/export` downloads its body with a slugged
filename and the content type its `kind` implies (`.md`/text/markdown,
`.txt`/text/plain, `.html`/text/html) - `canvas-split`'s export action
and a plain download link both point here.

## The turn-engine tool

**Landed:** the data layer above - the spec record, Home's table and
migration, `createArtifact`/`updateArtifact`/`getArtifactRow`/
`currentArtifactRow`, `visibleArtifactRow`, and the two read routes -
plus `TurnValue.artifact?: { id, version }` on the wire
(`backend/src/wire.ts`), additive next to `document_available`, naming
the version a turn minted or updated without carrying its body inline
(a client fetches the full version from the route above).

**Not landed, named as a real gap rather than shoehorned in:** the
actual tool the model calls to invoke this live, mid-turn. Every native
tool call the turn engine offers today (`turnEngine.ts`'s
`ordinaryToolSpecs()`/`selectOfferedTools()`, dispatched through
`runPlugin()`) assumes the tool is a catalog package with a manifest and
either a declarative recipe or a Tier 1 `handler.ts` running in
`denoHost.ts`'s sandbox - the same shape `websearch`, `remember`, and
every other offered tool use, real code enforced through recipe
primitives or a sandboxed handler, not a bare native function. Artifact
creation needs real version-chain logic (mint an id, resolve the current
pointer, insert transactionally) that has no recipe primitive today, the
same reason `TurnArtifact`'s own document building lives directly in
`composer.ts` rather than as a package at all - but `TurnArtifact` is
never a tool the MODEL calls, it's built after the fact from retained
outcomes, so that precedent doesn't answer how a model-invoked tool gets
real code to run. Wiring this into the model's live tool-offering loop
needs one of: a new recipe-interpreter primitive in `commons/spec` for
version-chain writes, or a new native (non-package) dispatch branch
alongside `runPlugin()`'s call sites - either is its own design pass and
integration surface across a large, delicate file, not a same-item
addition under a medium review budget. The intended shape, for whoever
takes this: one tool, args `{ action: "create" | "update", artifact_id?
(required for update), title, kind? (required for create), body }`,
`create` calling `createArtifact()` and `update` calling
`updateArtifact()` against the conversation's current artifact, streamed
as the part `artifact-card`/`canvas-split` bind to (this record's
earlier table), with `TurnValue.artifact` set from its result.

## Sessions and order

The order as it ran (updated 2026-09-21 afternoon): Session A did step
1, then the stand-up's defects (HOME-UI-04b, 04d, 04e), CHAT-SDK-01
and LOOK-01, and now takes SHELL-02 (`/next/chat`) in slices, the
first being the Elements thread and composer on Home's existing
adapters with one streaming turn and the reasoning element live, then
history, the thread list, attachments, suggestions, tools and
artifacts as follow-ups, each landed as it works. Session B did the
wire (REASONING-01/02, the memory-outcome notifications), SHELL-01
whole (backend and page) and SHELL-03, and takes the remaining SHELL
rows in order (04, 05, 06, 07, 08), each row one commit with its
tests, its captures from `scripts/screenshot.ts` and the BACKLOG row
ticked; the local-model lane takes HOME-UI-04g (the first paint of
`/next`) and S items beside; Codex takes docs and backlog. Each row's
reviewer first checks "is anything here Home-drawn", and a yes returns
the item; a vendored part with no data surface is composed from its
own primitives and the gap is named in this record's row.

## Risk and rollback

The old shell and chat stay untouched behind the flag until the last
row; every row is one commit; rollback is the flag. The vendored
snapshot's upstream drift is a manual merge, on a schedule (the
monthly dependency sweep), against the pinned sha in the upstream
note.
 The end state is SHELL-09 (docs/BACKLOG.md): once the rows are ticked and the owner says cut, `/next` becomes `/`, the flag goes, and the old shell, chat, kit pieces, tokens, look values and spec keys that existed only for the old interface are deleted in one release, so nothing of the hand-built interface survives as dead code or a second theme system.
