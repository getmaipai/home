# Two reference apps, four screens: what Home takes from them (2026-10-01)

Design record, written by the coordinator (Fable) for Jesse. Docs only: nothing here is built. Jesse answered the seven open questions on 2026-10-01; his answers are under "Decisions, made by Jesse", the three edits are applied, and the items are filed in `docs/BACKLOG.md` under "From the reference screens review (2026-10-01)".

## Ground rules

The evidence is two screenshots Jesse supplied, and nothing else. One shows a desktop chat app whose composer calls it Bionic. The other shows a local AI workspace whose sidebar calls it RigSpark. Every claim about them below is something visible in the pixels. Nothing is said about how either behaves, because a still image cannot show behavior.

One fact changes the second half of this review: Home has already studied RigSpark. `docs/plans/fit-verdict-ui-2026-09-30.md` records that RigSpark is a public tool, read for design only, and that Home's fit verdict screens took three shapes from it. So the Models screen below is mostly a check of that earlier work against the picture, not a first look.

We take layout, features and naming ideas. We do not take wording or look. Home's surfaces come from shadcndashboard, assistant-ui and the kit, styled by tokens, and nothing is hand-built. Each feature taken below names the shipped part that carries it, with the file, or names the gap.

The reader of every screen is a household. The dad test applies, a child's profile is restricted by default, and nothing leaves the home.

Each screenshot is read as two product screens, four in all:

| | Screen | What it is for | Home's equivalent |
|---|---|---|---|
| A | Bionic: the chat, with its sidebar | Find a past chat, read a reply, ask the next thing | `/chat` (`ChatPage.tsx`) with the thread list |
| B | Bionic: the file pane | Read a file the assistant made, beside the chat | The canvas pane in `ChatPage.tsx`, and Library (`/files`) |
| C | RigSpark: the Models page | Pick a model that this computer can run | The AI models page (`ModelsPage.tsx`, `ModelsSection`) |
| D | RigSpark: the workspace frame | Move between areas, see past sessions, watch the machine | The shell (sidebar, header), `/status`, Performance |

## Screen A: the chat, with its sidebar

**What theirs shows.** A left sidebar headed Projects: a "new" row, then named groups with a folder icon, each holding chat titles; the open chat is highlighted. Settings sits at the bottom. The middle column has the chat title, the person's message in a bubble, one collapsed line saying how long the work took, the reply as plain text, a card for the file that was made (name, type, a three-dot menu), and two small icons under the reply (copy, and a branch glyph). The composer has an attach button, a model name with a cloud icon and a level word beside it, a microphone and send. Under the composer: the group's name on the left and a running context count on the right.

**What ours has today (read in source).** The thread list groups chats by date (Today, Yesterday, Earlier) and supports pin, rename, archive, delete and search (`thread-list.aui.tsx:112-171`, `chatThreadListAdapter.ts:41-53`). A reply's tool steps collapse under one line and animate open and closed (`tool-group.aui.tsx:160-162`, `ToolTimeline` in `ChatPage.tsx:688-695`). A finished document shows as a card in the reply (`ArtifactCard`, `ChatPage.tsx:386`). Copy is the shipped `ActionBarPrimitive.Copy` (`thread.aui.tsx:441`). An edited message keeps the old reply as a version the shipped `BranchPickerPrimitive` switches between (NEXT-BRANCH-01). The composer has an add menu, dictation, live voice, and a model selector with a mode choice (`ModelSelectorEffort`, `ChatPage.tsx:253-273`).

**What ours does that theirs does not show.** Pinned chats. A temporary chat that is never saved. Listen (read aloud). Helpful and Not helpful. Sources with site icons. Live voice and a wake word. Starter prompts drawn from the installed packages. Per-person history, with a child's stricter rules applied by the hub. A status dot in the header.

**What theirs shows that ours lacks.** Named groups of chats. The time the work took, on the collapsed line. A menu on the file card. The group's name under the composer. An always-on context count (rejected below).

## Screen B: the file pane

**What theirs shows.** A right pane with the file's name as a tab, page back and forward with "1 of 6", zoom out and in with a percentage, a fit control, a full-screen control and a folder icon. The body is the PDF itself: a heading, three small labels, five photos, a short text block and a four-row table. A control at the far top right folds the pane away.

**What ours has today.** A pane beside the thread on a wide screen and a bottom sheet on a phone, the same content in both (`ChatPage.tsx:2847-2939`, `CanvasSplit` from `canvas-split.tsx`). It opens when a card is clicked and when a background project posts its result, and closing it leaves the chat alone. Its header carries a title, a version, Copy and Close (`canvas-split.tsx:73-85`). The stored artifact kinds are `markdown`, `code` and `html` (`artifact.schema.json:38-41`). The kit also ships a file card with a download action (`file.tsx`), an image part (`image.tsx`) and code colouring (`shiki-highlighter.tsx`).

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
| 1 | Grouped chats | Adopt, as Projects | We have date groups and pins but no named groups. Jesse's decision: call them Projects, the word people know from the chat apps they use, and show two sections only (Projects, then Chats) | New spec field, then CHAT-PROJECT-01 |
| 2 | A side pane for produced files | The pane is covered; what shows in it is not | The pane, the phone sheet and the open and close rules exist, but a document shows as plain lines of small text, and PDFs and pictures do not show at all. See "The canvas, and the document in it" | CHAT-PARITY-06 (amended), CANVAS-READ-01, DOC-BLOCKS-01, DOC-RENDER-01, PANE-FILE-01 |
| 3 | Collapsed work trace with elapsed time | Adapt | The collapse and its animation exist; the resting line counts tool calls, which means nothing to a parent, where a duration does | TRACE-TIME-01 |
| 4 | Model picker with a level, and a context counter | Covered; counter rejected | The picker and its mode choice exist for owners and admins and are hidden from everyone else; a token count fails the dad test and the hub already summarises long chats | No change; one line added to the chat design notes |
| 5 | Fit badges and honest estimates | Covered, adapt the wording | The design already came from this tool; what is missing is a short word for the badge itself and fixed words for where a number came from | `fit-verdict-ui-2026-09-30.md` (edit 1), FIT-WORDS-01 |
| 6 | Live gauges and a hardware rail | Covered for admins, rejected for the household | A household needs one sentence and a dot; gauges belong to Performance | No change |
| 7 | Navigation | Covered | Our four areas fit a family; Models and Runtime stay out of the menu by Jesse's decision of 2026-09-30; Connectors is our Integrations, under Settings | No change |
| 8 | Branch, copy, file card menu | Copy and versions covered; card menu adapt; branch to a new chat rejected for now | The first two are shipped parts in use; the card has no menu; assistant-ui 0.15.21 has no part that starts a new chat from a reply | FILE-MENU-01 |
| 9 | A "this runs in your home" sign | Adapt | A house icon on every model would say nothing, since every model is local; say it once where a new person looks, and mark the one thing that does go out, a web lookup | CHAT-WELCOME-01 |
| 10 | Anything else | See the tables below and "What not to repeat" | | |

Notes on four of them.

**1, grouped chats.** A chat belongs to one person (`conversation.schema.json`, `person`), so a project is that person's own and never shared; an admin's person picker shows a person's projects along with their chats. A temporary chat creates no stored row, so it cannot sit in a project and the choice is absent there. A project changes where a chat is listed and nothing else: it does not scope memory, carry instructions, or change what the model recalls. Each of those would be a design pass of its own. On the word: this review first proposed "Folders", because Home's harness design calls durable background work a project (`harness-turns-and-projects-2026-09-26.md`). Jesse asked whether two words would confuse people, and a check of the app showed the harness word is never shown to a person (they see the thing's own title, as in `backend/src/lib/projects/post.ts:147`). So the clash exists only in code and design docs, and the familiar word wins: **Projects**. The background-work feature keeps its name in code and is never labelled "project" on screen. Jesse also asked about the date labels: three ways of grouping at once (projects, pins, Today and Yesterday and Earlier) is too much, so the sidebar has two sections, Projects and then one plain Chats list, newest first with pinned chats on top and no date labels.

**3, the trace.** `ReasoningTrigger` already accepts a duration (`reasoning.tsx:166-195`) and `ToolTimeline` takes its resting words as a prop (`ChatPage.tsx:694-695`), so this is a change of words fed to shipped parts. A child sees the same line and the same step names; a child's reasoning text is never stored or shown (REASONING-03), and that does not change.

**4, the picker and the counter.** In source the picker shows only to an owner or admin who is not a minor, with two or more chat models installed (`ChatPage.tsx:1538`). A minor has no thinking control, and the hub ignores one if sent (`ChatPage.tsx:1442-1457`). The mode words are Instant and Thinking, which stay; a three-step level would be settings jargon. Model and mode are the person's own choices and may change the substance of a reply. The companion's voice is a layer over the reply and is the same at every mode, so the bare-reply floor is untouched. The context bar stays where it is, inside Details, for admins (`ChatPage.tsx:1003-1036`). The conversation record already carries `summary` and `summary_through_turn`, so a long chat is summarised by the hub and a household never needs to manage a number.

**8, branching.** Two different things share the word. Switching between versions of a reply after an edit is built and stays. Starting a separate chat from a point in this one is not a shipped part (searched the installed `@assistant-ui/react` and `@assistant-ui/core` for a fork or duplicate call: none), so it would need a backend copy route and a new menu entry. Nothing a family has asked for needs it.

> **Superseded in part 2026-10-02** by [docs/design/RULES.md](../design/RULES.md) chat rule 9: a new `StreamingMarkdown` kit block for the pane no longer holds; the canvas uses the chat's `MarkdownText`.

## The canvas, and the document in it

Added the same day, after Jesse asked about the part of screen B this review first passed over: the pane in the reference is good to look at, and so is the document inside it. Those are two separate things, and we are behind on both.

**The pane as a reading surface.** Theirs gives the file half the window, a calm page with wide margins, and a thin tool row that stays out of the way. Ours opens the right pane, but the body is the document's text split on line breaks and drawn one small grey line at a time (`ChatPage.tsx:1157-1162`, `CanvasSplitLine` at 13 px in `canvas-split.tsx:175-190`). A heading, a list or a table in the document shows as its raw Markdown characters. The plan of 2026-09-21 (`artifacts-evaluation-2026-09-21.md`, section 5) already chose the fix, a Markdown body in the pane, and that part was never built. The kit's `MarkdownText` cannot simply be dropped in: it reads its text from the chat message it sits in (`markdown-text.tsx:198-221`), so a document body needs the small `StreamingMarkdown` block that plan names. This is the gap, named.

**The document as a designed thing.** The page in the reference is laid out, with a small label line, a large title with a quieter second line, three short tags, a grid of photos, a boxed summary, and a table whose rows carry an icon. Markdown cannot produce that, and asking a small model to write the layout as HTML would be slow, unsafe to show a child, and different every time. The way that fits our rules is the one the harness already uses for projects: the model fills in a typed shape, and fixed code draws it.

- **A closed set of blocks**, declared once in the spec: title, label line, tags, text, picture grid, summary box, fact table, steps, sources. A new block is a spec change, never a package's invention, the same rule as the step vocabulary.
- **One renderer**, composed only of shipped parts: `Card` for the summary box, `Badge` for tags, `image.tsx` for pictures, `spec-sheet.tsx` for the fact table, `sources.tsx` for sources. The look comes from the tokens, so every theme restyles every document with no extra work, and the phone gets the same page in one column.
- **The PDF is the same page, printed.** Download makes a PDF from the rendered page with the browser's own print path, so the file a person saves looks like what they saw, and there is no second layout to keep in step.
- **Safety and privacy as today.** Each picture and each block passes the output gate before the page reaches the chat; a child's page follows the child's rules; a picture comes from the hub's own image role or from a search result that is cited, fetched through the hub, never loaded from the page.

This is the second half of CHAT-PARITY-06's design pass. The first step needs no design and is worth doing on its own: render the Markdown body properly in a readable column.

## How the four screens look and feel, ours beside theirs

Added the same day at Jesse's request: the same kind of look at every part of both pictures that the canvas got above. His own example sets the level: the chat reference "looks like Claude, looks like a professional ChatGPT desktop app, giving a familiar experience to the user". So each screen is judged first as a whole (is it familiar, does it read as finished) and then by the choices that produce that.

Ours was judged from fresh captures, made headless on 2026-10-01 from the seeded demo household at `origin/main`: the chat with a short conversation, the chat with a tool reply, the empty chat with its add menu open, Home, and the AI models page, at 1440 wide, plus the chat at 390. Two limits, stated plainly. The capture for the canvas failed (it timed out waiting for the document card), so the canvas is judged from source, as above. And a capture shows a seeded household, so content oddities in it (a card that says 57 degrees over a sentence that says 62) are the seed's, not the product's, and are not counted.

### Screen A, the chat

**Why theirs feels familiar and finished.** It is the layout people already know from the chat apps they use. One sidebar, and it is the list of chats. No bar across the top beyond the chat's title. One reading column in the middle. One composer, with every control inside its one rounded box. The reply is plain text with no box around it; the person's message is the only bubble. Work the assistant did is one quiet grey line. Under the reply there are two small icons. There is one strong colour on the whole screen, used twice: the selected chat and the send button. The type is large and even. Nothing on the screen asks to be understood before the conversation does.

**Ours.** The parts are right and the frame is not. The reading column, the bubble for the person and plain text for the reply, the rounded composer with add, microphone and send: all of that is the familiar shape, and it comes from shipped parts. What surrounds it makes the screen read as a dashboard with a chat inside it.

| What the capture shows | Why it costs us | The fix, and the part that carries it |
|---|---|---|
| Two sidebars side by side: the app's menu (Home, Chat, Library, Family) and then the chat list, about 510 px before the conversation starts | No familiar chat app looks like this; the conversation starts well right of centre and the eye has two lists to pass | The app menu starts folded to its icon rail for a person who has never opened or folded it, on every page; once they choose, their choice is kept everywhere and never overridden. The shipped sidebar already folds to icons. SHELL-FOLD-01 |
| A top bar with eight things in it: fold button, title, a caret, search, temporary chat, the status pill, the bell, the profile | Theirs has a title. Ours competes with the conversation | The fold button leaves the bar and sits in the menu column itself (Jesse's decision). The rest of the bar is not changed by this review. SHELL-FOLD-01 |
| The same sentence three times: the top bar, the selected row in the list, and the person's first bubble | A chat's title is the raw first message, so it repeats and long ones are cut off | A short topic title per chat, three or four words, the way theirs reads. CHAT-TITLE-01 |
| "New Thread", "Search threads" | Nobody in a family says thread | "New chat", "Search chats". The words live in the vendored list (`thread-list.aui.tsx:68-69, 248`), so this needs an additive labels prop, sent upstream. CHAT-WORDS-01 |
| "2 tool calls" on the collapsed line | Jargon, and it is the line a parent reads to see what happened | Already TRACE-TIME-01 |
| A reasoning block open above a one-line answer, showing the model's inner note for "what is 2 plus 2", on a tinted band that reads as a rendering fault | The most technical thing on the screen sits above the simplest answer | Reasoning rests closed as one line, like the tool line, and opens with the shipped animation. `ReasoningRoot` with its closed default. CHAT-QUIET-01 |
| Six icons under a reply (copy, listen, helpful, not helpful, try again, more), shown under the first and third replies and not the second | Theirs shows two. Ours is uneven, which looks like a fault | The shipped bar hides itself except on the last reply (`thread.aui.tsx:796`); the item finds why the first reply shows it, and keeps copy and listen in the bar with the rest under More. CHAT-QUIET-01 |
| The composer's box is a dark navy; the page is neutral black | Two near-blacks of different hue beside each other look unplanned | One surface token for the composer. Tokens only. CHAT-QUIET-01 |
| Result cards (the weather card) label their rows in a small monospaced face | Monospace reads as a developer tool; theirs uses one face throughout | The label face of `spec-sheet.tsx` comes from a token; set it to the body face. CHAT-QUIET-01 |
| Empty chat: a greeting and a composer, an empty list, no starters in the capture; the add menu has a heading and a single entry | The first screen a new person sees is blank, and a menu with one thing in it is a wasted click | Starters exist in source and need a seeded package to show; the item confirms they appear for a real new household. A one-entry menu becomes a plain attach button until a second entry exists. CHAT-QUIET-01 |
| Phone: a lone history icon on its own row with a rule under it, above the first message | About 70 px of the smallest screen spent on one icon | The history button joins the top bar's row. SHELL-FOLD-01 |

**Where ours is already as good or better.** The reply column and its type size. Listen and Sources in the same quiet row. The status pill is a kind thing to have on a home device. The phone layout is the same design, not a second one.

### Screen B, the file pane

Covered in "The canvas, and the document in it" above. One addition from this pass: theirs splits the window in half, so the document is a peer of the chat and not a drawer. Ours opens to a fixed narrow width (`max-w-xl`, `ChatPage.tsx:2896`). CANVAS-READ-01's "up to half the window" covers it. There is also no working capture of our canvas today, which is why nobody has looked at it side by side before. SHOT-FIX-01.

### Screen C, the Models page

**What theirs does well as a screen.** It is a grid you can scan in two seconds: every card is the same shape, the name is top left, the answer is a coloured word top right, and green and amber do the sorting for you before you read anything. One line of facts sits under each name. **What it does badly:** it is a technician's console. Seven pickers and two tick boxes sit above the list, the labels are tiny capitals in a monospaced face, and raw ids stand in for names. A parent would not know where to start.

**Ours** (the capture with a "slow" verdict). The words are better than theirs in every place: "This computer has plenty of free memory right now", "It fits only by using the processor, so answers will be slower". The layout undersells them.

| What the capture shows | Why it costs us | The fix |
|---|---|---|
| "AI models" three times in the first 160 px: the top bar, a page heading, and a card title | Reads as unfinished | One title. MODELS-LAYOUT-01 |
| A card inside a card inside a card (the page card, the Memory card, "Models using memory") | Three borders deep; the eye cannot tell what is a section | Sections sit directly on the page, one level of card. MODELS-LAYOUT-01 |
| The verdict "Runs, but slowly" is a grey pill | The plan says orange for slow and teal for yes; colour is the one thing theirs gets right at a glance | The shipped status pill with its colour token, as `fit-verdict-ui` already specifies. MODELS-LAYOUT-01 |
| One model is shown; the answer for any other model needs a pasted link | Theirs lets you compare a shelf of models at once | Already HOME-FIT-02 (a row per model). This review raises its priority, nothing more |
| "This counts only what the Stack has loaded. Home's own engines still run: chat, search, listening and speaking." | Two product-internal names in one sentence on a settings page | Goes away when Home runs on the Stack (STACK-16); until then it folds under Details. MODELS-LAYOUT-01 |
| Monospaced row labels again | As on screen A | CHAT-QUIET-01's token change covers it |

### Screen D, the frame, and our Home page

**Theirs** is a tool that is always showing you the machine. That is right for its reader and wrong for ours, and the verdict above stands: no rail of gauges.

**Ours.** The equivalent first screen is Home, and the capture is the weakest of our four. It greets by name, then shows four cards (People 3, Updates "Up to date", Repairs 1, Engines "No Stack"), a chart titled "Turns per day" that is a flat line at zero, and a "Recent activity" table that says "Nothing yet". The line under the greeting is the template's own ("Stay informed with today's activity"). It is an administrator's panel: three of its words are ours and not a family's (turns, engines, Stack), nothing on it invites a person to do anything, and a new household sees zeros. Jesse has said before what he wants here: glanceable state first, then shortcuts, favourites, search and the greeting. The page needs its own short design note before any item is cut. HOME-ALIVE-01.

### The pattern across all four

Theirs: one job per screen, one list, one accent colour, one typeface, almost no chrome, and words a person already knows. Ours: the right parts, wrapped in one layer too many (a second sidebar, a top bar, a card around the cards) and labelled in our own vocabulary (thread, tool calls, turns, engines, Stack). Both are fixable without building a component: fold what is already foldable, set three tokens, and change words.

## Table 1: features

| Feature | Who it is for | Size | Verdict | Lands in |
|---|---|---|---|---|
| Projects for chats: make, rename, delete, move a chat in or out; a two-section sidebar | Parent, child | M, spec first | Adopt (Jesse's decision 1) | CHAT-PROJECT-01 |
| A document in the pane reads like a page: real headings, lists and tables in a readable column | Parent, child | M | Adopt | CANVAS-READ-01 |
| A designed document: tags, picture grid, summary box, fact table, drawn from typed blocks | Parent, child | L, design pass, then two M slices | Adapt (Jesse's decision 6) | CHAT-PARITY-06, DOC-BLOCKS-01, DOC-RENDER-01 |
| Download a designed document as a PDF that matches the page | Parent, child | S, inside DOC-RENDER-01 | Adapt | DOC-RENDER-01 |
| A PDF or a picture shown in the pane | Parent, child | M | Adapt | PANE-FILE-01 |
| A menu on a produced file: open, download, show in Library, delete | Parent, child (delete follows the file's own rules) | S | Adapt | FILE-MENU-01 |
| "Show in Library" from the pane | Parent, child | S, inside PANE-FILE-01 | Adapt | PANE-FILE-01 |
| How long the work took, on the collapsed line | Parent, child | S | Adapt | TRACE-TIME-01 |
| A short word on the fit badge, and fixed words for a number's source | Admin | S | Adapt | FIT-WORDS-01 |
| One line on a new chat saying where it runs | Parent, child | S | Adopt (Jesse's decision 3) | CHAT-WELCOME-01 |
| A plain line in an empty Library | Parent, child | S | Adapt | LIB-EMPTY-01 |
| An always-on context count | Nobody in a household | none | Reject | none |
| A three-step level beside the model name | Nobody in a household | none | Reject, Instant and Thinking stay | none |
| A speed range per model | Admin | none now | Reject until measured | `fit-verdict-ui`, "Limits", unchanged |
| Start a new chat from a reply | Parent | M | Reject for now (Jesse's decision 4) | none |
| Live gauges beside every page | Admin | none | Covered by Performance | none |
| Pickers for harness, runtime, agent, KV cache on a household page | Nobody in a household | none | Reject; the one real choice (how much to remember) is already in the sizing strip in plain words | none |

## Table 2: layout and UI changes to our screens

| Screen | Change | Shipped part that carries it | New item or edit | Size |
|---|---|---|---|---|
| Chat, thread list | Two sections: Projects, each one opening and closing with the kit's animation, then Chats, one plain list, newest first, pinned on top. The Today, Yesterday and Earlier labels go | The group labels already in `thread-list.aui.tsx:175-211`, with `Collapsible` (`ui/collapsible.tsx`). Gap: the list groups by date only. Smallest fix is an additive prop on the vendored list that accepts a grouping, the same class of patch as `onEditSend`, sent upstream | CHAT-PROJECT-01 | M |
| Chat, a thread's menu | "Move to project" under Rename, opening a short list with "New project" at the end | `ThreadListItemMorePrimitive.Item` (`thread-list.aui.tsx:416-434`) and `dropdown-menu.tsx` | CHAT-PROJECT-01 | inside it |
| Chat, a finished reply | The collapsed line reads as a duration, with the step count after it | `ToolTimeline` `restingLabel`, `ReasoningTrigger` `duration` | TRACE-TIME-01 | S |
| Chat, a produced file | A three-dot menu beside the card | `ArtifactCard` with `dropdown-menu.tsx` as its neighbour in one row. Gap: the card takes no children, so the menu sits beside it, not inside it | FILE-MENU-01 | S |
| Chat, the pane | A PDF shows in the browser's own viewer inside the pane on a wide screen; a picture shows with `image.tsx`; code uses `shiki-highlighter.tsx` | `CanvasSplitDocument` as the frame. Gap: no PDF viewer in the kit; the browser's built-in one is the prebuilt answer, so no library is added | PANE-FILE-01, and edit 2 | M |
| Chat, the pane body | The document's Markdown is rendered (headings, lists, tables, links) in a column of readable width with the body text at the chat's own size; the pane takes up to half the window on a wide screen | Gap: `MarkdownText` is tied to a chat message. Smallest fix is the `StreamingMarkdown` kit block the 2026-09-21 plan names, inside `CanvasSplitBody` | CANVAS-READ-01 | M |
| Chat, the pane body, designed documents | Blocks drawn by shipped parts: `Card`, `Badge`, `image.tsx`, `spec-sheet.tsx`, `sources.tsx` | No new component; a block renderer that maps each block to its part | DOC-RENDER-01 | M |
| Chat, the pane on a phone | Same sheet, same header. A PDF shows its card and an "Open" button that hands it to the phone's own viewer, because a phone browser does not page a PDF inside a frame reliably | `Sheet`, `file.tsx` | PANE-FILE-01 | inside it |
| Chat, the pane header | Download and "Show in Library" beside Copy and Close | Gap: `CanvasSplitHeader` has only `onCopy` and `onClose` (`canvas-split.tsx:73-85`). Smallest fix is the same `dropdown-menu.tsx` composed beside the header, no edit to the shipped file | PANE-FILE-01 | inside it |
| Chat, empty state | One quiet line under the greeting | `ChatWelcome`, which is Home's own slot (`ChatPage.tsx:746-766`); copy only | CHAT-WELCOME-01 | S |
| Chat, composer | No change. The project's name under the composer and the context count are not taken: the header already shows the chat's title, and the count is rejected | none | none | none |
| Models, each row | A short badge word, then the reason sentence beside it | The status pill and `confidence-marker`, as the plan already says | Edit 1, FIT-WORDS-01 | S |
| Models, the list | "Only models that fit" starts switched on; the recommended model is the first row | `switch.tsx`, `data-table` | Edit 3 (HOME-FIT-02's row) | none extra |
| Library, empty | A sentence that says what will appear here and how | The `emptyMessage` of the table already in use (`FilesPage.tsx:115`) | LIB-EMPTY-01 | S |
| Shell | No change | none | none | none |

## Table 3: defaults and presets

Each default is declared once, in the place named. None holds household data. Sample content exists only in the demo household that the screenshot script seeds, and uses roster names only.

| What a new person sees | The default | Declared in | Household data? | Size |
|---|---|---|---|---|
| Starter prompts on an empty chat | Three, the first routing example of each installed package | Each package's manifest, `routing.examples` (read by `chatSuggestionAdapter.ts:25-37`). Exists | None; written by package authors | none |
| Projects | None. The list starts as one plain Chats list; a project exists only once a person makes one. No "General" project is created | Nothing to declare; the absence is the default | None | none |
| Projects in the demo household | Two, on the demo adult "juniper": "Homework help" and "Trip ideas", three chats each | The screenshot seed, beside the existing demo chats | Roster names only | inside CHAT-PROJECT-01 |
| Chat model | The model the Stack proposes for this computer | The chat role's Setting record. Exists | None | none |
| Mode | Instant | The absence of `Conversation.settings.thinking` (PERSIST-CONV-01, THINK-DEFAULT-01). Exists | None | none |
| A child's composer | No mode control, no model picker | The role and age rule on the hub (`routes/turn.ts`), mirrored in the page. Exists | None | none |
| The pane | Closed. Opens by itself once, when a background project posts its file | `ChatPage.tsx` (the project-finished path). Exists | None | none |
| A produced file in the demo household | One finished storybook PDF, one written document, and one designed page ("Plants for a shady room", made-up content), owned by "juniper" | The screenshot seed | Roster names only | inside PANE-FILE-01 |
| Models list filter | "Only models that fit" on | The page's own default, stated once in HOME-FIT-02. Not a stored setting | None | inside HOME-FIT-02 |
| Models list order | Recommended first, then good fits, slow ones, not tested, too big | HOME-FIT-02 | None | inside HOME-FIT-02 |
| Sizing strip | How much to remember: the model's own default from its budget record. Memory use: Auto | The Stack's setting keys (`stack.*`). Exists in the Stack | None | none |
| Status dot | "All good" until a check says otherwise, and it stays green when health data is missing | STATUS-A2a. Exists | None | none |
| Empty Library | The sentence in the wording table | `FilesPage.tsx` | None | LIB-EMPTY-01 |

## Wording

Our own words. Every line was read against the dad test.

| Where | Words |
|---|---|
| Sidebar headings | Projects, Chats |
| Create row | New project |
| Thread menu | Move to project |
| Thread menu, when in one | Remove from project |
| Deleting a project | Delete this project? Your chats stay. They go back to the Chats list. |
| Empty project | No chats here yet. Move one in from its menu. |
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

## Decisions, made by Jesse on 2026-10-01

1. **Projects for chats: yes.** Named Projects, not Folders. The sidebar has two sections, Projects and then one plain Chats list with pinned chats on top and no date labels. A project only groups chats in the first version. Filed as CHAT-PROJECT-01.
2. **A PDF on a phone opens in the phone's own viewer.** The chat shows the file's card with an Open button; no PDF library is added. On a wide screen the PDF shows in the pane. Inside PANE-FILE-01.
3. **One line on a new chat saying where it runs: yes.** Filed as CHAT-WELCOME-01.
4. **Start a new chat from a reply: not now.** Nothing filed.
5. **Record the answers, apply the three edits, file the items: yes, all.** Nothing is built until Jesse picks what to start.
6. **Good-looking documents in the pane: two steps.** First today's documents read like a real page (CANVAS-READ-01); then, after a short design pass, designed pages from typed blocks with a matching PDF (DOC-BLOCKS-01, DOC-RENDER-01).
7. **The app menu starts folded, and its button moves.** This review first proposed a new chat layout as its own item. Jesse's questions took it apart: every app needs its own menu column, so the frame we have (an app menu, then the current app's own column) is already the right one. What changes is small. The app menu starts folded for a person who has never opened or folded it; once they choose, that choice is kept on every page and never overridden. The fold and expand button sits in the menu column itself, not in the page header. Filed as SHELL-FOLD-01.

Resolved by reading, not asked: the context count (rejected on the dad test and because the hub summarises), a level beside the model (Instant and Thinking are decided, RESP-04), Models and Runtime in the menu (decided 2026-09-30), live gauges for members (the status page design), a house icon per model (every model is local, so it carries no information). The design-resolver agent was not dispatched: each question was answered by a passage in an existing record, cited above.

## Exact edits to existing docs (applied 2026-10-01)

**Edit 1, `docs/plans/fit-verdict-ui-2026-09-30.md`.** In the table under "The words, in the dad test's terms", add a second column, "Badge", between "Verdict" and "Home says", with the values `Good fit`, `Slow here`, `Too big`, `Not tested yet`. After the sentence "A number that is an estimate says so in its tooltip with its source and date." add: "The source words are fixed: measured reads 'Tested on this computer on <date>.', dry-run reads 'Checked on this computer without a full run, <date>.', estimated reads 'An estimate. Not yet tested on a computer like this one.', unknown reads 'Not known yet.' A figure nothing has reported reads 'Not measured yet', never a zero."

**Edit 2, `docs/BACKLOG.md`, the CHAT-PARITY-06 row.** Append to the row's first line: "Amended 2026-10-01 (reference screens review): the design pass also names the closed set of typed blocks for a designed document and how the same page prints to PDF, and covers files a project assembles (a PDF, a picture), how they show in the pane on a wide screen and on a phone, and whether a produced file is listed in Library; see `docs/dev/reference-screens-review-2026-10-01.md`."

**Edit 3, `docs/BACKLOG.md`, the HOME-FIT-02 row.** Append: "Amended 2026-10-01: 'Only models that fit' starts on; rows are ordered recommended first, then good fit, slow, not tested, too big; each pill carries the badge word from the plan's table."

> **Superseded in part 2026-10-02** by [docs/design/RULES.md](../design/RULES.md) chat rule 9: CANVAS-READ-01 planning a new `StreamingMarkdown` kit block no longer holds; the canvas uses the chat's `MarkdownText`.

## BACKLOG items (filed in docs/BACKLOG.md on 2026-10-01)

Area: `## From the reference screens review (2026-10-01)`.

- [ ] **CHAT-PROJECT-01: projects for a person's chats, and a two-section sidebar** (M, spec first; Jesse's decision 1). Objective: a person can make a project, move a chat in or out, rename and delete it; the chat list shows Projects, then one plain Chats list (newest first, pinned on top, no date labels). Pointers: `commons/spec/schemas/conversation.schema.json` (an optional group id) and a new small record for the group (id, person, name, order, provenance, hlc); `backend/src/routes` conversations; `frontend/src/apps/chat/chatThreadListAdapter.ts`; the kit's `thread-list.aui.tsx`. Mirror: how `pinned` travels from the record through the adapter's `custom` field to the list. Acceptance: the item starts by choosing record and field names that cannot be mistaken for the harness's `project` record (`project.schema.json`) and records the choice; on screen the word is Projects, and background work is never labelled "project"; a project is one person's own and an admin's person picker shows that person's projects; a temporary chat offers no project; deleting a project keeps its chats; opening and closing a project animates; the demo household has two projects on "juniper"; desktop and phone screenshots opened and judged. Out of scope: any effect on memory, instructions or recall; files in a project; sharing a project; the robot. Exit: `bash scripts/check.sh` in commons and Home, plus the screenshots.
- [ ] **CANVAS-READ-01: a document in the pane reads like a page** (M, kit then Home). Objective: the pane renders a document's Markdown (headings, lists, tables, links, code) in a readable column, where today it draws raw lines. Pointers: `frontend/src/shell/pages/ChatPage.tsx:1140-1168`, the kit's `canvas-split.tsx` and `markdown-text.tsx`, `docs/plans/artifacts-evaluation-2026-09-21.md` section 5 and step 4. Mirror: the chat's own Markdown look, so a document and a reply read as one design. Acceptance: a `StreamingMarkdown` block in the kit (one ui tag) that takes text as a prop; the pane uses it inside `CanvasSplitBody`; a document still being written updates in place without flashing raw characters; body text at the chat's size, column no wider than a comfortable line; the phone sheet shows the same page; screenshots of the demo document at both widths opened and judged. Out of scope: typed blocks, pictures, PDF. Exit: `bash scripts/check.sh` in commons and Home, plus the screenshots.
- [ ] **DOC-BLOCKS-01: the typed blocks of a designed document** (M, spec first, in `commons`; after CHAT-PARITY-06's design pass names the set). Objective: a closed block vocabulary (title, label line, tags, text, picture grid, summary box, fact table, steps, sources) as a spec schema with round-trip fixtures, as a new artifact kind beside `markdown`, `code` and `html`. Pointers: `commons/spec/schemas/artifact.schema.json`, `turn-artifact.schema.json` (its `card`, `procedure` and `comparison` sections are the precedent). Mirror: the project step vocabulary in `project.schema.json`. Acceptance: fixtures use made-up content and roster names only; a block the schema does not name is refused. Out of scope: any renderer, any tool. Exit: commons `bash scripts/check.sh`.
- [ ] **DOC-RENDER-01: draw a designed document from its blocks, and print it** (M, after DOC-BLOCKS-01 and CANVAS-READ-01). Objective: the pane draws each block with its shipped part, and Download saves a PDF of the same page. Pointers: the kit's `card.tsx`, `badge.tsx`, `image.tsx`, `spec-sheet.tsx`, `sources.tsx`; the pane in `ChatPage.tsx`; the tool the model calls to write a document (`write_document`). Mirror: how a `TurnArtifact` card section is drawn today. Acceptance: no hand-built component; both looks and both themes; one column on a phone; every picture passed the output gate and loads from the hub; the saved PDF matches the page; the demo page screenshot opened and judged against the reference for hierarchy and spacing, not copied. Out of scope: editing blocks by hand, HTML preview. Exit: `bash scripts/check.sh` plus the screenshots.
- [ ] **PANE-FILE-01: PDFs and pictures in the pane** (M, after CHAT-PARITY-06's amended design pass). Objective: a produced PDF or picture opens in the same pane a document does. Pointers: `frontend/src/shell/pages/ChatPage.tsx` (the canvas panel and its sheet), the kit's `canvas-split.tsx`, `image.tsx`, `file.tsx`, `backend/src/routes/artifacts.ts`. Mirror: the existing document path through `ArtifactCanvasPanel`. Acceptance: the item starts by reading how a project's assembled file is stored and whether it is listed in Library, and records the answer; on a wide screen a PDF shows in the browser's own viewer and a picture shows whole; on a phone the sheet shows the card and Open; Download and Show in Library work from the header's menu; a child sees only files from their own turns that passed the safety check; no PDF library is added. Out of scope: editing a file, HTML preview, versions of a PDF. Exit: `bash scripts/check.sh` plus screenshots at both widths.
- [ ] **FILE-MENU-01: a menu on a produced file's card** (S). Objective: Open, Download, Show in Library and Delete from the card in the reply. Pointers: `ChatPage.tsx` (`ArtifactCardToolRender`, `ProjectFinishedArtifact`), the kit's `dropdown-menu.tsx`. Mirror: the reply's own three-dot menu. Acceptance: the menu sits beside the card with no edit to the shipped card; every entry is reachable by keyboard; Delete asks first and follows the file's own delete rule. Out of scope: sharing, rename. Exit: `bash scripts/check.sh`.
- [ ] **TRACE-TIME-01: the collapsed line says how long the work took** (S). Objective: a finished reply's collapsed trace reads as a duration and a step count. Pointers: `ChatPage.tsx:683-695` (`restingLabel`), the turn's stats in the message metadata, `reasoning.tsx:166-195`. Mirror: the Details reveal, which already formats the same stats. Acceptance: the item starts by naming the stats field that holds the turn's wall time; seconds under a minute, minutes above; a turn with no stats keeps today's words; the same line for a child. Out of scope: a per-step time, any change to what is stored. Exit: `bash scripts/check.sh`.
- [ ] **FIT-WORDS-01: badge words and source words for the fit verdict** (S, after edit 1). Objective: every verdict pill carries its badge word and every number's tooltip uses the fixed source words. Pointers: the backend module that words the Stack's plan for Home (HOME-FIT-02A, 06, 09), `ModelsSection`. Mirror: the existing reason sentences and their tests. Acceptance: four badge words, four source sentences, each with a test in those words; unknown is never red. Out of scope: the per-row list (HOME-FIT-02). Exit: `bash scripts/check.sh`.
- [ ] **CHAT-WELCOME-01: one line on a new chat that says where it runs** (S; Jesse's decision 3). Objective: the empty chat shows the sentence from the wording table under the greeting. Pointers: `ChatWelcome` in `ChatPage.tsx:746-766`. Mirror: the temporary chat's own two-line welcome in the same function. Acceptance: shown on an ordinary new chat, replaced by the temporary chat's lines there; same on a phone; screenshot opened. Out of scope: a per-model icon, a badge in the header. Exit: `bash scripts/check.sh`.
- [ ] **LIB-EMPTY-01: an empty Library says what will appear** (S). Objective: the empty table shows the sentence from the wording table. Pointers: `frontend/src/shell/pages/FilesPage.tsx:115`. Acceptance: the sentence shows for a person with no files; the existing test updated in the same words. Out of scope: anything else on the page. Exit: `bash scripts/check.sh`.
- [ ] **SHELL-FOLD-01: the app menu starts folded, and its button lives in the menu** (S, kit then Home; Jesse's decision 7). Objective: a person who has never opened or folded the app menu sees it folded to its icon rail; the fold and expand button sits in the menu column, not in the page header. Pointers: the kit's dashboard layout (`dashboard/layouts/full`), `ui/sidebar.tsx` (the shipped trigger and rail), where the shell stores the menu's open state, `frontend/src/shell/railCollapsePreference.ts` (the chat list's own fold, a separate thing). Mirror: how `showThemeToggle` reached the vendored header, as an additive prop. Acceptance: the item starts by reading where the menu's state is stored today and records it; a stored choice always wins, on every page, and is never overridden by the default; with nothing stored the menu is folded; the button is in the menu column in both states and reachable by keyboard; every folded icon has its name as a tooltip and an accessible label; on a phone the chat's history button shares the top bar's row; captures at 1440 and 390 in both themes opened and judged. Out of scope: names under the folded icons, any other change to the top bar. Exit: `bash scripts/check.sh` in commons and Home, plus the captures.
- [ ] **CHAT-WORDS-01: chat, not thread** (S, kit then Home). Objective: "New chat" and "Search chats" in the list. Pointers: the kit's `thread-list.aui.tsx:68-69, 248`. Mirror: the additive `onEditSend` prop (NEXT-BRANCH-01), sent upstream the same way. Acceptance: an optional labels prop with today's words as its default; Home passes ours; screen readers read the new words. Out of scope: any other wording. Exit: `bash scripts/check.sh` in commons and Home.
- [ ] **CHAT-TITLE-01: a chat gets a short topic title** (S or M; the item starts by reading how a title is set today and records it). Objective: a chat's title is three or four words about its subject, not its first message. Pointers: the conversations route and where `title` is first written, `conversation.schema.json` (`title`). Mirror: how the summary fields are written after a turn. Acceptance: written by the hub's own model after the first reply, never blocking the reply; a renamed chat is never retitled; a temporary chat gets none stored; a child's title passes the same output check as a reply; two chats that open with the same question read differently or are told apart by date. Out of scope: retitling old chats. Exit: `bash scripts/check.sh`.
- [ ] **CHAT-QUIET-01: the chat's small noise, removed** (S, tokens and props only). Objective: reasoning rests closed as one line; the reply's action row is the same on every reply; the composer shares the page's surface colour; result cards use the body typeface; a one-entry add menu is a plain button. Pointers: `ChatPage.tsx` (`ReasoningGroup`, the composer add menu), `frontend/src/apps/chat/chatActionBar.tsx`, the kit's `thread.aui.tsx:796`, `spec-sheet.tsx`, `tokens.css`. Acceptance: the item first finds why the first reply shows its action row and records it; no shipped file is edited; the captures retaken and judged. Out of scope: the menu's fold (SHELL-FOLD-01). Exit: `bash scripts/check.sh` plus the captures.
- [ ] **MODELS-LAYOUT-01: the AI models page says its name once and colours its verdict** (S). Objective: one title, one level of card, the verdict pill in its colour, and the Stack sentence under Details. Pointers: `frontend/src/shell/pages/ModelsPage.tsx`, `frontend/src/apps/settings/ModelsSection.tsx`, `docs/plans/fit-verdict-ui-2026-09-30.md` (the colour column). Acceptance: the fit verdict captures retaken at both widths, opened and judged; yes is teal, slow is orange, no is red, unknown is neutral. Out of scope: the per-row list (HOME-FIT-02). Exit: `bash scripts/check.sh` plus the captures.
- [ ] **HOME-ALIVE-01: a Home page for a family, design note first** (M after the note). Objective: the first screen leads with what a person can do and what is going on at home, in a family's words. Pointers: `frontend/src/shell/pages/DashboardPage.tsx` and `dashboard/` (`Greeting.tsx:34`, `TurnsPerDayChart.tsx:34`, `EnginesCard.tsx:24`), `docs/design/home-pages-2026-09-20.md`. Acceptance: the note says what a member sees and what an admin sees, with no "turns", "engines" or "Stack" in a member's view, and what a brand-new household sees in place of zeros; Jesse reads it before items are cut. Out of scope: building it. Exit: the note, through `bash scripts/check.sh --docs`.
- [ ] **SHOT-FIX-01: the chat captures that no longer run** (S). Objective: `--next-chat-artifact-review`, `--next-chat-composer-review` and `--next-sidebar-review` finish and write their images. Pointers: `scripts/screenshot.ts`. Found 2026-10-01: the first times out waiting for the document card, the other two for a "Household" heading. Acceptance: all three exit 0 from a clean checkout; the canvas capture exists at 1440 and 390 and has been opened. Out of scope: any product change. Exit: the three runs, plus `bash scripts/check.sh`.

## What we already do better

A fit answer that admits when it does not know, with a reason, a source and a date. A status page a child can read, with admin controls kept apart. A member and an admin seeing different things from the same page. Starter prompts that are real things the hub can do. A temporary chat. Family as an area of its own. A pane that already works on a phone as a sheet.

## What not to repeat

Raw model ids as the names a person picks from. Two sessions with the same machine-made title (our own capture shows two chats with the same title too, see CHAT-TITLE-01). An address and port on a page a family opens. Two refresh buttons on one screen (ours update in place). Tick boxes that switch a safety estimate off with no explanation. Seven pickers above one list. A speed figure that is an estimate shown beside a memory figure that is not, with one small line to tell them apart. A running token count in the composer. Two words on screen for one idea, or one word for two.
