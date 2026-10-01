# Two reference apps, four screens: what Home takes from them (2026-10-01)

Design record, written by the coordinator (Fable) for Jesse. Docs only: nothing here is built, no backlog item below is filed, and no existing design doc has been changed. The edits this review asks for are listed word for word near the end so they can be applied in one step when Jesse says so.

## Ground rules

The evidence is two screenshots Jesse supplied, and nothing else. One shows a desktop chat app whose composer calls it Bionic. The other shows a local AI workspace whose sidebar calls it RigSpark. Every claim about them below is something visible in the pixels. Nothing is said about how either behaves, because a still image cannot show behavior.

One fact changes the second half of this review: Home has already studied RigSpark. `docs/plans/fit-verdict-ui-2026-09-30.md` records that RigSpark is a public tool, read for design only, and that Home's fit verdict screens took three shapes from it. So the Models screen below is mostly a check of that earlier work against the picture, not a first look.

We take layout, features and naming ideas. We do not take wording or look. Home's surfaces come from shadcndashboard, assistant-ui and the kit, styled by tokens, and nothing is hand-built. Each feature taken below names the shipped part that carries it, with the file, or names the gap.

The reader of every screen is a household. The dad test applies, a child's profile is restricted by default, and nothing leaves the home.

Each screenshot is read as two product screens, four in all:

| | Screen | What it is for | Home's equivalent |
|---|---|---|---|
| A | Bionic: the chat, with its sidebar | Find a past chat, read a reply, ask the next thing | `/next/chat` (`NextChatPage.tsx`) with the thread list |
| B | Bionic: the file pane | Read a file the assistant made, beside the chat | The canvas pane in `NextChatPage.tsx`, and Library (`/next/files`) |
| C | RigSpark: the Models page | Pick a model that this computer can run | The AI models page (`NextModelsPage.tsx`, `ModelsSection`) |
| D | RigSpark: the workspace frame | Move between areas, see past sessions, watch the machine | The shell (sidebar, header), `/status`, Performance |

## Screen A: the chat, with its sidebar

**What theirs shows.** A left sidebar headed Projects: a "new" row, then named groups with a folder icon, each holding chat titles; the open chat is highlighted. Settings sits at the bottom. The middle column has the chat title, the person's message in a bubble, one collapsed line saying how long the work took, the reply as plain text, a card for the file that was made (name, type, a three-dot menu), and two small icons under the reply (copy, and a branch glyph). The composer has an attach button, a model name with a cloud icon and a level word beside it, a microphone and send. Under the composer: the group's name on the left and a running context count on the right.

**What ours has today (read in source).** The thread list groups chats by date (Today, Yesterday, Earlier) and supports pin, rename, archive, delete and search (`thread-list.aui.tsx:112-171`, `chatThreadListAdapter.ts:41-53`). A reply's tool steps collapse under one line and animate open and closed (`tool-group.aui.tsx:160-162`, `ToolTimeline` in `NextChatPage.tsx:688-695`). A finished document shows as a card in the reply (`ArtifactCard`, `NextChatPage.tsx:386`). Copy is the shipped `ActionBarPrimitive.Copy` (`thread.aui.tsx:441`). An edited message keeps the old reply as a version the shipped `BranchPickerPrimitive` switches between (NEXT-BRANCH-01). The composer has an add menu, dictation, live voice, and a model selector with a mode choice (`ModelSelectorEffort`, `NextChatPage.tsx:253-273`).

**What ours does that theirs does not show.** Pinned chats. A temporary chat that is never saved. Listen (read aloud). Helpful and Not helpful. Sources with site icons. Live voice and a wake word. Starter prompts drawn from the installed packages. Per-person history, with a child's stricter rules applied by the hub. A status dot in the header.

**What theirs shows that ours lacks.** Named groups of chats. The time the work took, on the collapsed line. A menu on the file card. The group's name under the composer. An always-on context count (rejected below).

## Screen B: the file pane

**What theirs shows.** A right pane with the file's name as a tab, page back and forward with "1 of 6", zoom out and in with a percentage, a fit control, a full-screen control and a folder icon. The body is the PDF itself: a heading, three small labels, five photos, a short text block and a four-row table. A control at the far top right folds the pane away.

**What ours has today.** A pane beside the thread on a wide screen and a bottom sheet on a phone, the same content in both (`NextChatPage.tsx:2847-2939`, `CanvasSplit` from `canvas-split.tsx`). It opens when a card is clicked and when a background project posts its result, and closing it leaves the chat alone. Its header carries a title, a version, Copy and Close (`canvas-split.tsx:73-85`). The stored artifact kinds are `markdown`, `code` and `html` (`artifact.schema.json:38-41`). The kit also ships a file card with a download action (`file.tsx`), an image part (`image.tsx`) and code colouring (`shiki-highlighter.tsx`).

**What ours does that theirs does not show.** Versions of a document. The pane following a document while it is still being written. A safety check on every produced file before it reaches the chat, with a child's rules applied.

**What theirs shows that ours lacks.** A PDF shown in the pane with page and zoom controls. Photos inside a produced file. A way from the pane to where the file is kept. No PDF viewer exists in the kit or in Home's dependencies (searched `ui/src` and both `package.json` files), so this is a named gap.

## Screen C: the Models page

**What theirs shows.** A page title with four pickers beside it (model, harness, runtime, agent) and a refresh button. A strip of raw facts (an address and port, a turn count, a token count). A second heading with three more pickers (source, context window, KV cache), two tick boxes and another refresh. One line saying the speed figures are offline estimates. Then a two-column grid of model cards: a raw model id, a fit badge in green or amber, one line of size, file format, memory, a speed range and a context figure, the words "context fit unknown" on most cards, and a Start button.

**What ours has today.** The AI models page shows the recommended chat model with the Stack's verdict worded by Home, a "Check a model" box that takes a link, a fit panel, a "Memory right now" card, and Compare with a copyable summary (HOME-FIT-02A, 02C, 03, 04, all landed 2026-09-30). The verdict on every row, search, the "Only models that fit" switch and the sizing strip are designed and not built (HOME-FIT-02). The page is reached from Settings, Household, AI, by owners and admins only.

**What ours does that theirs does not show.** A fourth answer, "can't tell yet", kept apart from yes and no. A reason in plain words under the verdict. What would make a model fit when it does not. A source and a date on every number. A check before download from a link.

**What theirs shows that ours lacks.** A speed range per model. We leave this out on purpose until a bench row measures it (`fit-verdict-ui-2026-09-30.md`, "Limits"). Nothing else on this screen is missing from our design.

## Screen D: the workspace frame

**What theirs shows.** A left sidebar with five areas (Chat, Models, Connectors, Library, Runtime), then a session block with a new button, a search box, a "Today" label and two sessions that carry the same raw title. A right rail with an "active model" card, a hardware card (platform, memory, GPU, free disk), live gauges for memory, CPU, disk and latency, and three figures for the last model call, two of them shown as not reported yet.

**What ours has today.** The sidebar holds Home, Chat, Library and Family, with Settings and Help at the bottom (`sidebaritems.ts:57-90`). Health is a dot in the header that leads to `/status`, where everyone reads plain sentences and admins get controls (STATUS-A2a, landed). Models, Engines, Repairs and Performance are admin pages behind Settings. The Home page opens with a greeting and cards.

**What ours does that theirs does not show.** Family as a first-class area. One search across chats, people, apps and settings. A status page with history and an admin's note. Different views for a member and an admin.

**What theirs shows that ours lacks.** Nothing a household needs. Their rail keeps the machine in view while a model is chosen; our "Memory right now" card does the same job on the one page where it matters.

## The ten questions

| # | Question | Verdict | Why, in one line | Lands in |
|---|---|---|---|---|
| 1 | Grouped chats | Adapt | We have date groups and pins but no named groups; a group is a per-person label on a chat and must not be called a project, a word Home already uses for background work | New spec field, then CHAT-FOLDER-01; Jesse's call 1 |
| 2 | A side pane for produced files | Covered, with one gap | The pane, the phone sheet and the open and close rules exist; PDFs and pictures do not show in it yet | CHAT-PARITY-06 (amended), PANE-FILE-01 |
| 3 | Collapsed work trace with elapsed time | Adapt | The collapse and its animation exist; the resting line counts tool calls, which means nothing to a parent, where a duration does | TRACE-TIME-01 |
| 4 | Model picker with a level, and a context counter | Covered; counter rejected | The picker and its mode choice exist for owners and admins and are hidden from everyone else; a token count fails the dad test and the hub already summarises long chats | No change; one line added to the chat design notes |
| 5 | Fit badges and honest estimates | Covered, adapt the wording | The design already came from this tool; what is missing is a short word for the badge itself and fixed words for where a number came from | `fit-verdict-ui-2026-09-30.md` (edit 1), FIT-WORDS-01 |
| 6 | Live gauges and a hardware rail | Covered for admins, rejected for the household | A household needs one sentence and a dot; gauges belong to Performance | No change |
| 7 | Navigation | Covered | Our four areas fit a family; Models and Runtime stay out of the menu by Jesse's decision of 2026-09-30; Connectors is our Integrations, under Settings | No change |
| 8 | Branch, copy, file card menu | Copy and versions covered; card menu adapt; branch to a new chat rejected for now | The first two are shipped parts in use; the card has no menu; assistant-ui 0.15.21 has no part that starts a new chat from a reply | FILE-MENU-01; Jesse's call 4 |
| 9 | A "this runs in your home" sign | Adapt | A house icon on every model would say nothing, since every model is local; say it once where a new person looks, and mark the one thing that does go out, a web lookup | CHAT-WELCOME-01 |
| 10 | Anything else | See the tables below and "What not to repeat" | | |

Notes on four of them.

**1, grouped chats.** A chat belongs to one person (`conversation.schema.json`, `person`), so a group is that person's own and never shared; an admin's person picker shows a person's groups along with their chats. A temporary chat creates no stored row, so it cannot sit in a group and the choice is absent there. A group changes where a chat is listed and nothing else: it does not scope memory, carry instructions, or change what the model recalls. The screenshot shows none of those, and each would be a design pass of its own. The word: **Folders**. "Projects" is taken (`harness-turns-and-projects-2026-09-26.md`: a project is durable background work), and two meanings for one word in one sidebar would be a defect.

**3, the trace.** `ReasoningTrigger` already accepts a duration (`reasoning.tsx:166-195`) and `ToolTimeline` takes its resting words as a prop (`NextChatPage.tsx:694-695`), so this is a change of words fed to shipped parts. A child sees the same line and the same step names; a child's reasoning text is never stored or shown (REASONING-03), and that does not change.

**4, the picker and the counter.** In source the picker shows only to an owner or admin who is not a minor, with two or more chat models installed (`NextChatPage.tsx:1538`). A minor has no thinking control, and the hub ignores one if sent (`NextChatPage.tsx:1442-1457`). The mode words are Instant and Thinking, which stay; a three-step level would be settings jargon. Model and mode are the person's own choices and may change the substance of a reply. The companion's voice is a layer over the reply and is the same at every mode, so the bare-reply floor is untouched. The context bar stays where it is, inside Details, for admins (`NextChatPage.tsx:1003-1036`). The conversation record already carries `summary` and `summary_through_turn`, so a long chat is summarised by the hub and a household never needs to manage a number.

**8, branching.** Two different things share the word. Switching between versions of a reply after an edit is built and stays. Starting a separate chat from a point in this one is not a shipped part (searched the installed `@assistant-ui/react` and `@assistant-ui/core` for a fork or duplicate call: none), so it would need a backend copy route and a new menu entry. Nothing a family has asked for needs it.

## Table 1: features

| Feature | Who it is for | Size | Verdict | Lands in |
|---|---|---|---|---|
| Folders for chats: make, rename, delete, move a chat in or out | Parent, child | M, spec first | Adapt (Jesse's call 1) | CHAT-FOLDER-01 |
| A PDF or a picture shown in the pane | Parent, child | M | Adapt | PANE-FILE-01 |
| A menu on a produced file: open, download, show in Library, delete | Parent, child (delete follows the file's own rules) | S | Adapt | FILE-MENU-01 |
| "Show in Library" from the pane | Parent, child | S, inside PANE-FILE-01 | Adapt | PANE-FILE-01 |
| How long the work took, on the collapsed line | Parent, child | S | Adapt | TRACE-TIME-01 |
| A short word on the fit badge, and fixed words for a number's source | Admin | S | Adapt | FIT-WORDS-01 |
| One line on a new chat saying where it runs | Parent, child | S | Adapt (Jesse's call 3) | CHAT-WELCOME-01 |
| A plain line in an empty Library | Parent, child | S | Adapt | LIB-EMPTY-01 |
| An always-on context count | Nobody in a household | none | Reject | none |
| A three-step level beside the model name | Nobody in a household | none | Reject, Instant and Thinking stay | none |
| A speed range per model | Admin | none now | Reject until measured | `fit-verdict-ui`, "Limits", unchanged |
| Start a new chat from a reply | Parent | M | Reject for now (Jesse's call 4) | none |
| Live gauges beside every page | Admin | none | Covered by Performance | none |
| Pickers for harness, runtime, agent, KV cache on a household page | Nobody in a household | none | Reject; the one real choice (how much to remember) is already in the sizing strip in plain words | none |

## Table 2: layout and UI changes to our screens

| Screen | Change | Shipped part that carries it | New item or edit | Size |
|---|---|---|---|---|
| Chat, thread list | Folders listed above the date groups, each one opening and closing with the kit's animation; chats with no folder stay under Today, Yesterday, Earlier | The group labels already in `thread-list.aui.tsx:175-211`, with `Collapsible` (`ui/collapsible.tsx`). Gap: the list groups by date only. Smallest fix is an additive prop on the vendored list that accepts a grouping, the same class of patch as `onEditSend`, sent upstream | CHAT-FOLDER-01 | M |
| Chat, a thread's menu | "Move to folder" under Rename, opening a short list with "New folder" at the end | `ThreadListItemMorePrimitive.Item` (`thread-list.aui.tsx:416-434`) and `dropdown-menu.tsx` | CHAT-FOLDER-01 | inside it |
| Chat, a finished reply | The collapsed line reads as a duration, with the step count after it | `ToolTimeline` `restingLabel`, `ReasoningTrigger` `duration` | TRACE-TIME-01 | S |
| Chat, a produced file | A three-dot menu beside the card | `ArtifactCard` with `dropdown-menu.tsx` as its neighbour in one row. Gap: the card takes no children, so the menu sits beside it, not inside it | FILE-MENU-01 | S |
| Chat, the pane | A PDF shows in the browser's own viewer inside the pane on a wide screen; a picture shows with `image.tsx`; code uses `shiki-highlighter.tsx` | `CanvasSplitDocument` as the frame. Gap: no PDF viewer in the kit; the browser's built-in one is the prebuilt answer, so no library is added | PANE-FILE-01, and edit 2 | M |
| Chat, the pane on a phone | Same sheet, same header. A PDF shows its card and an "Open" button that hands it to the phone's own viewer, because a phone browser does not page a PDF inside a frame reliably | `Sheet`, `file.tsx` | PANE-FILE-01 | inside it |
| Chat, the pane header | Download and "Show in Library" beside Copy and Close | Gap: `CanvasSplitHeader` has only `onCopy` and `onClose` (`canvas-split.tsx:73-85`). Smallest fix is the same `dropdown-menu.tsx` composed beside the header, no edit to the shipped file | PANE-FILE-01 | inside it |
| Chat, empty state | One quiet line under the greeting | `NextChatWelcome`, which is Home's own slot (`NextChatPage.tsx:746-766`); copy only | CHAT-WELCOME-01 | S |
| Chat, composer | No change. The folder name under the composer and the context count are not taken: the header already shows the chat's title, and the count is rejected | none | none | none |
| Models, each row | A short badge word, then the reason sentence beside it | The status pill and `confidence-marker`, as the plan already says | Edit 1, FIT-WORDS-01 | S |
| Models, the list | "Only models that fit" starts switched on; the recommended model is the first row | `switch.tsx`, `data-table` | Edit 3 (HOME-FIT-02's row) | none extra |
| Library, empty | A sentence that says what will appear here and how | The `emptyMessage` of the table already in use (`NextFilesPage.tsx:115`) | LIB-EMPTY-01 | S |
| Shell | No change | none | none | none |

## Table 3: defaults and presets

Each default is declared once, in the place named. None holds household data. Sample content exists only in the demo household that the screenshot script seeds, and uses roster names only.

| What a new person sees | The default | Declared in | Household data? | Size |
|---|---|---|---|---|
| Starter prompts on an empty chat | Three, the first routing example of each installed package | Each package's manifest, `routing.examples` (read by `chatSuggestionAdapter.ts:25-37`). Exists | None; written by package authors | none |
| Folders | None. The list starts with date groups; a folder exists only once a person makes one. No "General" folder is created | Nothing to declare; the absence is the default | None | none |
| Folders in the demo household | Two, on the demo adult "juniper": "Homework help" and "Trip ideas", three chats each | The screenshot seed, beside the existing demo chats | Roster names only | inside CHAT-FOLDER-01 |
| Chat model | The model the Stack proposes for this computer | The chat role's Setting record. Exists | None | none |
| Mode | Instant | The absence of `Conversation.settings.thinking` (PERSIST-CONV-01, THINK-DEFAULT-01). Exists | None | none |
| A child's composer | No mode control, no model picker | The role and age rule on the hub (`routes/turn.ts`), mirrored in the page. Exists | None | none |
| The pane | Closed. Opens by itself once, when a background project posts its file | `NextChatPage.tsx` (the project-finished path). Exists | None | none |
| A produced file in the demo household | One finished storybook PDF and one written document, owned by "juniper" | The screenshot seed | Roster names only | inside PANE-FILE-01 |
| Models list filter | "Only models that fit" on | The page's own default, stated once in HOME-FIT-02. Not a stored setting | None | inside HOME-FIT-02 |
| Models list order | Recommended first, then good fits, slow ones, not tested, too big | HOME-FIT-02 | None | inside HOME-FIT-02 |
| Sizing strip | How much to remember: the model's own default from its budget record. Memory use: Auto | The Stack's setting keys (`stack.*`). Exists in the Stack | None | none |
| Status dot | "All good" until a check says otherwise, and it stays green when health data is missing | STATUS-A2a. Exists | None | none |
| Empty Library | The sentence in the wording table | `NextFilesPage.tsx` | None | LIB-EMPTY-01 |

## Wording

Our own words. Every line was read against the dad test.

| Where | Words |
|---|---|
| Sidebar heading | Folders |
| Create row | New folder |
| Thread menu | Move to folder |
| Thread menu, when in one | Remove from folder |
| Deleting a folder | Delete this folder? Your chats stay. They go back to the main list. |
| Empty folder | No chats here yet. Move one in from its menu. |
| Trace, finished, under a minute | Worked for 12 seconds, 3 steps |
| Trace, finished, longer | Worked for 4 minutes, 9 steps |
| Trace, running | Working… (unchanged) |
| File menu | Open, Download, Show in Library, Delete |
| Pane on a phone, PDF | Open |
| New chat, quiet line | Runs on your own hub. Your chats stay at home. |
| A reply that looked something up | Looked online (the step name in the trace, with the sites it read, as today) |
| Empty Library | Nothing here yet. Stories, pictures and documents you make in chat are kept here. |
| Fit badge: yes | Good fit |
| Fit badge: slow | Slow here |
| Fit badge: no | Too big |
| Fit badge: unknown | Not tested yet |
| Number source: measured | Tested on this computer on 30 Sep 2026. |
| Number source: dry-run | Checked on this computer without a full run, 30 Sep 2026. |
| Number source: estimated | An estimate. Not yet tested on a computer like this one. |
| Number source: unknown | Not known yet. |
| A figure nothing has reported | Not measured yet (never a zero, never a dash) |

The reason sentences already landed for the fit verdicts stay as they are (HOME-FIT-06, 09). The badge word is new and sits in front of them.

## Decisions that are Jesse's

1. **Folders for chats.** Recommended: yes, under the name Folders, as a plain label with no effect on memory, after the current core work. The alternative is to keep pins and date groups only.
2. **A PDF on a phone.** Recommended: the card with an Open button that uses the phone's own viewer. The alternative is a PDF library in the kit, which is a new dependency for one file type.
3. **The line on a new chat.** Recommended: yes, the one sentence in the wording table. It is the product's promise, said once, in the place a new person reads first.
4. **Start a new chat from a reply.** Recommended: not now.
5. **Apply the three edits below and file the seven items.** Nothing is applied or filed until Jesse says so.

Resolved by reading, not asked: the word Projects for chat groups (taken), the context count (rejected on the dad test and because the hub summarises), a level beside the model (Instant and Thinking are decided, RESP-04), Models and Runtime in the menu (decided 2026-09-30), live gauges for members (the status page design), a house icon per model (every model is local, so it carries no information). The design-resolver agent was not dispatched: each question was answered by a passage in an existing record, cited above.

## Exact edits to existing docs (not applied)

**Edit 1, `docs/plans/fit-verdict-ui-2026-09-30.md`.** In the table under "The words, in the dad test's terms", add a second column, "Badge", between "Verdict" and "Home says", with the values `Good fit`, `Slow here`, `Too big`, `Not tested yet`. After the sentence "A number that is an estimate says so in its tooltip with its source and date." add: "The source words are fixed: measured reads 'Tested on this computer on <date>.', dry-run reads 'Checked on this computer without a full run, <date>.', estimated reads 'An estimate. Not yet tested on a computer like this one.', unknown reads 'Not known yet.' A figure nothing has reported reads 'Not measured yet', never a zero."

**Edit 2, `docs/BACKLOG.md`, the CHAT-PARITY-06 row.** Append: "Amended 2026-10-01 (reference screens review): the design pass also covers files a project assembles (a PDF, a picture), how they show in the pane on a wide screen and on a phone, and whether a produced file is listed in Library; see `docs/dev/reference-screens-review-2026-10-01.md`."

**Edit 3, `docs/BACKLOG.md`, the HOME-FIT-02 row.** Append: "Amended 2026-10-01: 'Only models that fit' starts on; rows are ordered recommended first, then good fit, slow, not tested, too big; each pill carries the badge word from the plan's table."

## Proposed BACKLOG items (not filed)

Proposed area: `## From the reference screens review (2026-10-01)`.

- [ ] **CHAT-FOLDER-01: folders for a person's chats** (M, spec first; Jesse's call 1). Objective: a person can make a folder, move a chat in or out, rename and delete it, and sees folders above the date groups. Pointers: `commons/spec/schemas/conversation.schema.json` (an optional `folder_id`) and a new small `conversation-folder` record (id, person, name, order, provenance, hlc); `backend/src/routes` conversations; `frontend/src/apps/chat/chatThreadListAdapter.ts`; the kit's `thread-list.aui.tsx`. Mirror: how `pinned` travels from the record through the adapter's `custom` field to the list. Acceptance: a folder is one person's own and an admin's person picker shows that person's folders; a temporary chat offers no folder; deleting a folder keeps its chats; opening and closing a folder animates; the demo household has two folders on "juniper"; desktop and phone screenshots opened and judged. Out of scope: any effect on memory, instructions or recall; sharing a folder; the robot. Exit: `bash scripts/check.sh` in commons and Home, plus the screenshots.
- [ ] **PANE-FILE-01: PDFs and pictures in the pane** (M, after CHAT-PARITY-06's amended design pass). Objective: a produced PDF or picture opens in the same pane a document does. Pointers: `frontend/src/next/pages/NextChatPage.tsx` (the canvas panel and its sheet), the kit's `canvas-split.tsx`, `image.tsx`, `file.tsx`, `backend/src/routes/artifacts.ts`. Mirror: the existing document path through `ArtifactCanvasPanel`. Acceptance: the item starts by reading how a project's assembled file is stored and whether it is listed in Library, and records the answer; on a wide screen a PDF shows in the browser's own viewer and a picture shows whole; on a phone the sheet shows the card and Open; Download and Show in Library work from the header's menu; a child sees only files from their own turns that passed the safety check; no PDF library is added. Out of scope: editing a file, HTML preview, versions of a PDF. Exit: `bash scripts/check.sh` plus screenshots at both widths.
- [ ] **FILE-MENU-01: a menu on a produced file's card** (S). Objective: Open, Download, Show in Library and Delete from the card in the reply. Pointers: `NextChatPage.tsx` (`ArtifactCardToolRender`, `ProjectFinishedArtifact`), the kit's `dropdown-menu.tsx`. Mirror: the reply's own three-dot menu. Acceptance: the menu sits beside the card with no edit to the shipped card; every entry is reachable by keyboard; Delete asks first and follows the file's own delete rule. Out of scope: sharing, rename. Exit: `bash scripts/check.sh`.
- [ ] **TRACE-TIME-01: the collapsed line says how long the work took** (S). Objective: a finished reply's collapsed trace reads as a duration and a step count. Pointers: `NextChatPage.tsx:683-695` (`restingLabel`), the turn's stats in the message metadata, `reasoning.tsx:166-195`. Mirror: the Details reveal, which already formats the same stats. Acceptance: the item starts by naming the stats field that holds the turn's wall time; seconds under a minute, minutes above; a turn with no stats keeps today's words; the same line for a child. Out of scope: a per-step time, any change to what is stored. Exit: `bash scripts/check.sh`.
- [ ] **FIT-WORDS-01: badge words and source words for the fit verdict** (S, after edit 1). Objective: every verdict pill carries its badge word and every number's tooltip uses the fixed source words. Pointers: the backend module that words the Stack's plan for Home (HOME-FIT-02A, 06, 09), `ModelsSection`. Mirror: the existing reason sentences and their tests. Acceptance: four badge words, four source sentences, each with a test in those words; unknown is never red. Out of scope: the per-row list (HOME-FIT-02). Exit: `bash scripts/check.sh`.
- [ ] **CHAT-WELCOME-01: one line on a new chat that says where it runs** (S; Jesse's call 3). Objective: the empty chat shows the sentence from the wording table under the greeting. Pointers: `NextChatWelcome` in `NextChatPage.tsx:746-766`. Mirror: the temporary chat's own two-line welcome in the same function. Acceptance: shown on an ordinary new chat, replaced by the temporary chat's lines there; same on a phone; screenshot opened. Out of scope: a per-model icon, a badge in the header. Exit: `bash scripts/check.sh`.
- [ ] **LIB-EMPTY-01: an empty Library says what will appear** (S). Objective: the empty table shows the sentence from the wording table. Pointers: `frontend/src/next/pages/NextFilesPage.tsx:115`. Acceptance: the sentence shows for a person with no files; the existing test updated in the same words. Out of scope: anything else on the page. Exit: `bash scripts/check.sh`.

## What we already do better

A fit answer that admits when it does not know, with a reason, a source and a date. A status page a child can read, with admin controls kept apart. A member and an admin seeing different things from the same page. Starter prompts that are real things the hub can do. A temporary chat. Family as an area of its own. A pane that already works on a phone as a sheet.

## What not to repeat

Raw model ids as the names a person picks from. Two sessions with the same machine-made title. An address and port on a page a family opens. Two refresh buttons on one screen (ours update in place). Tick boxes that switch a safety estimate off with no explanation. Seven pickers above one list. A speed figure that is an estimate shown beside a memory figure that is not, with one small line to tell them apart. A running token count in the composer. One word, Projects, for a thing our own design already uses for something else.
