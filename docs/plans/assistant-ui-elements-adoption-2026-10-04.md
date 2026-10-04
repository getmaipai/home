# assistant-ui Elements adoption audit (2026-10-04)

Status: research record, cloud lane ELEM. Plan only: no code changed. `docs/design/RULES.md` stays the authority (rule 9: shipped parts only,
no hand-built UI). Nothing here is a build order until the owner accepts it.

## What could not be reached or verified

- **Website.** `www.assistant-ui.com` is blocked by this session's egress proxy (EGRESS_BLOCKED). No website page was read, so descriptions come from the
  kit's own source (props and comments) and **I cannot say which website Elements the kit does not vendor**. Every kit file below is covered; website-only
  Elements are an open check for whoever has network access.
- **Kit source read at tag `ui-v0.5.90`** from the public `getmaipai/commons` clone (`ui/src/elements`). It holds **144 files** (the owner's 129 counts top-level
  entries; the rest are `ui/` 14, `hooks/` 3). Rows: 144, one per file.
- **No `bun install`, no tests run.** The deliverable is a document, so there was no code to test. No tag worktrees were created in this checkout.
- **Reuse check (org principle 6).** Nothing was built. The document and JSON are plain text; the first-party prebuilt option for every piece is the Element itself.
- **Scope notes on three peer requests** (sessions `fable-chat-rework`): the second table (hand-built inventory), the bindings table and the in-use accounting
  are done here. The machine-readable registry is written as **data only** at `docs/plans/elements-adoption-2026-10-04.json` (not `frontend/src/dev/`, because
  the work order says no code changes). The scanner `scripts/elements-adoption.ts`, its `bun:test` and the `elements:status` script in `package.json` are **not
  written**: they are code, they were added after the work order, and they need the owner's go-ahead. The JSON's USED and IMPLEMENTED fields are left for that
  scanner to compute.

## Legend

Verdicts: **IN USE** (Home already imports it, directly or through the kit's Thread), **WIRE NOW** (data exists, small), **WIRE AFTER** (needs a named backend piece),
**FOR LATER** (a feature we plan), **DOES NOT FIT** (agent, computer-use or trace tool, or a duplicate of one we use), **SUPPORT** (primitive, hook, style or kit test, not
an Element). Size S or M. Batch column B1 to B7 is the plan in section 5.

Wanted features: F1 tables, F2 code with copy, F3 math, F4 mermaid, F5 sources with inline markers, F6 follow-up suggestions, F7 stop/regenerate/branch/edit,
F8 model and effort chip, F9 context footer, F10 chat titles/search/archive, F11 "Worked for N s" disclosure, F12 tool disclosure, F13 file card and document panel,
F14 charts, F15 errors in plain copy, F16 admin error details, F17 empty state, F18 voice.

Wire cheat sheet (all in `backend/src/wire.ts` unless named): `delta` and `reasoning` events (`:378`, `:387`), `status` and `spoken_cue` (`:389-390`), `error {error, code, crisis_resources}` (`:401`),
`done.value` carrying `sources` (`:244`), `media` and `media_items` (`:245-247`), `structured_part` (`:261`, spec-sheet only today), `artifact {id, version}` (`:272`), `project {id}` (`:283`),
`confirm {package_id, open}` (`:~290`), `stats: TurnStats` (`:64`), `model_status` (`:224`). Tool events `tool_call`, `tool_result`, `tool_error` ride the assistant-stream wire
(`backend/src/lib/assistantStreamWire.ts:88`). The frontend turns `done` fields into tool-call parts keyed by tool id (`frontend/src/apps/chat/chatModelAdapter.ts:674-708`; reload twin
`chatHistoryAdapter.ts:166-200`).

## 1. Already in use: the 17 direct imports, and what is left to wire

Direct imports of `@maipai/ui/src/elements/*` in Home today (grep, matches the coordinator's 17). An 18th, `elements/ui/button`, is a primitive (`NextChatPage.tsx:36`).

| Element | Import | What is left to wire |
|---|---|---|
| thread.aui | `NextChatPage.tsx:6` (mounted `:2854`) | See transitive table below. Slots Home fills: Welcome, AssistantMoreItems, AssistantActionBarExtra, AssistantMessageFooterExtra, Indicator, ComposerExtra, ComposerAddAttachmentOverride, ComposerExtraEnd, ComposerInputOverride, ReasoningGroup (`:2856-2889`). Slots **not** set: `ToolGroup` (kit default used), `TaskGroup`, message-level `UserMessageExtra`. |
| markdown-text | `NextChatPage.tsx:7` | Tables, Copy, katex and mermaid load lazily inside it (`markdown-text.tsx:47-90`). Nothing to wire: needs showcase scenarios and tests (table, code, math exist on `cloud/ui-showcase`; mermaid is new). |
| reasoning.aui | `NextChatPage.tsx:16` | In use through `NextReasoningGroup` (`:817`). Left: none for F11; a test per age band (children never see it). |
| thread-list.aui | `NextChatPage.tsx:17` (list `:1372`) | `archive()` still throws in `chatThreadListAdapter.ts` (CONV-ARCHIVE-01); titles from topic (CHAT-TITLE-01). Search by content is hand-built (see section 4). |
| spec-sheet | `NextChatPage.tsx:18`, `ModelsSection.tsx:13` | Only `weather` and `almanac-date` produce a `structured_part` (`composer.ts:584-591`). More producers: see section 6. |
| artifact-card | `NextChatPage.tsx:19` (used `:397`) | Complete for `write_document`. |
| sources.aui | `NextChatPage.tsx:20` (used `:961`) | Footer pills only. The inline `[n]` marker is not wired (THIN-4B). Favicon goes through the hub route (`:907`), not the kit's DuckDuckGo default. |
| surfaces | `NextChatPage.tsx:22` | Style helper only. |
| tool-timeline | `NextChatPage.tsx:23` (used `:722`) | In use for the "Worked for N s" disclosure. Left: a test per state. |
| job-progress | `NextChatPage.tsx:24` (used `:608`) | In use for projects. Left: showcase scenario. |
| thinking-indicator | `NextChatPage.tsx:25` (used `:759`) | In use. Left: none. |
| message-timing | `NextChatPage.tsx:26` (used `:1087`) | Adult-only "Details" row. Left: showcase scenario. |
| context-display | `NextChatPage.tsx:27` (Bar `:1075`) | Admin-gated; the true context window needs STACK-CTX-01. |
| model-selector | `NextChatPage.tsx:29` (`:255`, effort `:273`) | Instant/Thinking effort only; no per-model effort list. |
| canvas-split | `NextChatPage.tsx:37` (`:1150`, `:1222`) | In use for artifacts and the admin compare. Left: showcase. |
| composer | `composerAddMenu.tsx:27` | Only `ComposerAttachButton`, `ComposerMenu`, `ComposerMenuItem`. The box, slash menu, `@` mention, model trigger and context pieces of `composer.tsx` are unused (Thread has its own composer). |
| voice-conversation | `liveVoiceSession.tsx:31` | In use for live voice. Left: read-aloud highlight, speaker labels. |

**Used through Thread (kit import graph, `thread.aui.tsx`), and whether our wiring mounts them:**

| Element | Mounted? | Evidence |
|---|---|---|
| message-branches (BranchPicker), edit-message (EditComposer) | yes | `thread.aui.tsx:334, 781, 932`; edit sends `onEditSend` (`NextChatPage.tsx:2857`) |
| attachment.aui, image, file | yes | `thread.aui.tsx:566, 915`; `attachments` adapter set (`NextChatPage.tsx:1783`) |
| tool-fallback.aui, tool-group.aui | yes (defaults) | `thread.aui.tsx:677-720, 743`; Home also uses `assistant-ui/tool-fallback.aui` (`NextChatPage.tsx:15`) for the confirm card |
| reasoning, thinking-indicator, markdown-text | yes | `thread.aui.tsx:730, 762, 739` |
| shiki-highlighter, mermaid-diagram | yes, lazily | `markdown-text.tsx:47, 50` |
| **follow-up-suggestions.aui** and the new-chat starters (`ThreadSuggestions`) | **mounted but switched off** | `thread.aui.tsx:315, 318` render them, but Home's runtime adapters are `{feedback, speech, attachments, dictation}` (`NextChatPage.tsx:1779-1784`): **no `suggestion` adapter**. `createChatSuggestionAdapter` (`chatSuggestionAdapter.ts:25`) is imported nowhere outside its test. Starters are a one-line WIRE NOW; follow-ups need a generator (WIRE AFTER). |
| empty-state.tsx | no | Thread uses its own `ThreadWelcome`; Home passes `Welcome: NextChatWelcome` (`:780`) |
| day-separator (Home's hand-built `DayDivider`), `ChatSourceCaption`, `ChatTurnStats` | **dead code** | `chatDayDivider.tsx`, `chatSourceCaption.tsx`, `chatTurnStats.tsx` are imported by no non-test file |

## 2. The table: one row per kit file (144)

| element (file) | what it is | group | used in Home today | data it needs and whether the wire has it | verdict | size | wish-list features | batch | effort | backend or tool work |
|---|---|---|---|---|---|---|---|---|---|---|
| activity-graph.tsx | A year-style grid of days shaded by how busy each was. | charts/data | no | Daily counts per day; none on the wire (no usage-by-day endpoint) | FOR LATER | S | none (admin usage page, Performance) | - | - | admin usage endpoint |
| agent-card.tsx | A business card for an AI agent: name, provider and skills. | agent/workflow | no | Agent directory data; Home has companions, not agents | DOES NOT FIT | S | none (companions use their own persona page) | - | - | - |
| agent-handoff.tsx | Shows one agent passing a task to another and what it carried over. | agent/workflow | no | Multi-agent handoff events; none | DOES NOT FIT | S | none (no multi-agent in a family hub) | - | - | - |
| agent-plan.tsx | A step list showing an agent's plan and which step is running. | agent/workflow | no | Plan steps; none (project steps come from GET /api/projects/:id, JobProgress covers them) | DOES NOT FIT | S | none (JobProgress already shows project steps) | - | - | - |
| agent-status.tsx | A small badge saying an agent is working, waiting, done or failed. | agent/workflow | no | Agent state; none | DOES NOT FIT | S | none | - | - | - |
| approval-card.tsx | A card asking "allow this action?" with Allow once, Always allow and Deny. | reasoning/tools | no (Home uses assistant-ui ToolApprovalOption in ConfirmToolRender, NextChatPage.tsx:421-480) | done.value.confirm {package_id, open} (wire.ts:~290), chatToolCallPart.ts; answers go to ConfirmAskAnswerContext | WIRE NOW | S | F12 (plain confirm card for physical or costly tools) | B3 | QUICK | none |
| artifact-card.tsx | A tappable card for a document the assistant wrote, with a title and size line. | canvas/artifacts | yes NextChatPage.tsx:19 (used at :397) | done.value.artifact {id, version} (wire.ts:272) plus GET /api/artifacts/:id | IN USE | S | F13 | B2 | QUICK | none |
| attachment.aui.tsx | Small picture or file tiles for what you attached to a message or the box you are typing in. | composer | kit only (thread.aui.tsx) | Composer attachment state, localImageAttachmentAdapter.ts and the document attach path | IN USE | S | F13 | B2 | QUICK | none |
| background-inbox.tsx | A list of jobs running in the background with a ready or failed mark. | agent/workflow | no | Background project runs: GET /api/projects (CHAT-PROJECT-01 style); JobProgress already polls one | WIRE AFTER | M | none from the wish list (projects, later) | B6 | LARGE | backend project list endpoint (BACKLOG PROJECT-PROGRESS-01 follow-up) |
| canvas-split.tsx | A chat on the left and a document panel on the right. | canvas/artifacts | yes NextChatPage.tsx:37 (ArtifactCanvasPanel :1150, BareCompareCanvasPanel :1222) | artifact id/version, GET /api/artifacts/:id | IN USE | S | F13 | B2 | QUICK | none |
| chart.tsx | A small line, area or bar chart. | charts/data | no | A series of numbers; no structured_part kind for a chart (StructuredPart is spec-sheet only today, wire.ts:261) | WIRE AFTER | M | F14 | B6 | LARGE | StructuredPart kind "chart" in backend/src/wire.ts and lib/composer.ts structuredPartForOutcomes |
| chat-panel.tsx | A ready-made frame for a whole chat window (messages, typing dots, box). | message | no | none (layout only) | DOES NOT FIT | S | none (Thread already owns the frame) | - | - | - |
| checkpoint-history.tsx | A list of saved checkpoints of an agent's file changes to roll back to. | agent/workflow | no | Checkpoints of file edits; none | DOES NOT FIT | S | none (code-agent idea) | - | - | - |
| code-diff.tsx | Shows lines added and removed, like a code review. | canvas/artifacts | used by the kit only (reviewable-diff.tsx) | Diff hunks; none | DOES NOT FIT | S | none (a document-edit "what changed" view could reuse it later) | - | - | - |
| code-runner.tsx | A code block with a Run button and the output under it. | agent/workflow | no | A code sandbox; none (gap matrix C4: skip for children) | FOR LATER | M | none (adult-only code interpreter, C4) | - | - | sandbox runtime |
| command-palette.tsx | A Ctrl-K box that lists commands and their shortcuts. | other | no (Home search uses its own shell/search/useSearchCommand.ts and cmdk) | Command list; frontend ChatShortcutReference.tsx already lists shortcuts | WIRE NOW | S | F10 (jump to a chat) | B4 | QUICK | none |
| comparison-card.tsx | Two or three options side by side with their traits. | agent/workflow | no | Structured options; none | DOES NOT FIT | S | none (tables cover comparisons, F1) | - | - | - |
| composer.tsx | The message box pieces: attach, slash and @ menus, model chip, voice, send. | composer | yes composerAddMenu.tsx:27 (only for the add menu; the box itself is the kit Thread's own) | Models list (/api/engines), roster for @ mentions, commands list | WIRE AFTER | M | F8, F18 | B5 | MEDIUM | none for slash (nodes/commands.ts exists); mention list via roster |
| computer-use.tsx | A screen with a cursor showing an agent clicking around. | agent/workflow | no | Computer-use steps; none | DOES NOT FIT | S | none (agent that drives a computer, not a household task) | - | - | - |
| confidence-marker.tsx | Underlines claims as grounded, inferred or uncertain. | sources/citations | no | Per-claim confidence; no field (rule 1: no word-rule routing, and nothing measures model confidence, wire.ts:242 says so) | DOES NOT FIT | S | none (would mislead: the backend has no real confidence) | - | - | - |
| connection-state.tsx | A banner saying you are offline, reconnecting or back. | errors/states | no | Browser online state and the stream resume token (turn_meta.resume_token, wire.ts:375) | WIRE NOW | S | F15 | B4 | QUICK | none |
| context-breakdown.tsx | A coloured bar showing what fills the context window (system, history, tools). | other | no | Per-part token counts; stats has only context_tokens (wire.ts:64) | WIRE AFTER | M | F9 (admin detail) | B6 | LARGE | TurnStats split by part (THIN-3E, STACK-CTX-01) |
| context-display.tsx | A "context used" bar and token counts under a reply. | composer | yes NextChatPage.tsx:27 (Bar at :1075) | done.value.stats.context_tokens plus the model context window | IN USE | S | F9 | B2 | QUICK | STACK-CTX-01 for the true window |
| conversation-map.tsx | A hover map of the conversation's turns to jump around a long chat. | thread/list | no | Turn list of the open thread (already in the thread state) | WIRE NOW | S | F10 | B4 | QUICK | none |
| conversation-search.tsx | Find-in-chat bar with matches highlighted and next/previous. | thread/list | no | Open thread's message text (client side) | WIRE NOW | S | F10 | B4 | QUICK | none |
| cost-meter.tsx | Money spent per model. | charts/data | no | Cost per token; Home is local, no billing | DOES NOT FIT | S | none (no prices in a self-hosted hub) | - | - | - |
| data-table.tsx | A neat table of rows (the kit demo uses model, context, cost). | charts/data | no (markdown tables render through markdown-text, NextChatPage.tsx:7) | Typed rows; none (tables arrive as markdown today) | WIRE AFTER | S | F1 (styling check only; the markdown table already works) | B5 | MEDIUM | none for markdown; StructuredPart kind "table" only if a package returns rows |
| day-separator.tsx | A "Today" or "Yesterday" line between messages. | message | no (Home has a hand-built DayDivider, apps/chat/chatDayDivider.tsx:62, but nothing imports it: dead code) | Message created_at on each turn | WIRE NOW | S | F10 | B3 | QUICK | none |
| diagram.tsx | A frame with zoom and expand around a diagram. | canvas/artifacts | no | Diagram content; mermaid goes through markdown-text | WIRE AFTER | S | F4 (zoom frame for mermaid blocks) | B5 | MEDIUM | none |
| directive-text.tsx | Turns special markers in text into small inline chips. | message | no | A formatter for markers like :memory[...]; none defined | FOR LATER | S | none (could chip "remembered" or person mentions) | - | - | - |
| document-reference.tsx | A page-numbered quote pointing into an uploaded document. | sources/citations | no | Anchors {page, quote}; documents attach (COMPOSER-DOC-ATTACH-01) but no anchors on the wire | WIRE AFTER | M | F5, F13 | B5 | MEDIUM | retrieval anchors from the document tool (ATTACH-PREVIEW-01) |
| draft-restore.tsx | "Restore your unsent draft?" prompt. | composer | no | Local draft in browser storage | WIRE NOW | S | none (quality of life) | B4 | QUICK | none |
| edit-message.tsx | Edit your sent message in place, with a note that later replies will be replaced. | message | kit only (thread.aui.tsx EditComposer, used through Thread) | Edit and branch state (NEXT-BRANCH-01 done, chatEditSupersedes.ts) | IN USE | S | F7 | B1 | QUICK | none |
| elicitation-form.tsx | A small form the assistant shows to ask you for missing details. | reasoning/tools | no | Form request from a tool; none (tools design T4 only has confirm) | WIRE AFTER | M | none from the wish list | B6 | LARGE | tool elicitation event (docs/plans/tools-ecosystem-design T-series) |
| empty-state.tsx | The greeting and starter prompts on a new chat. | settings/onboarding | kit only (thread.aui.tsx ThreadWelcome; Home wraps it as NextChatWelcome, NextChatPage.tsx:780) | chatSuggestionAdapter.ts (package routing examples) | IN USE | S | F17 | B2 | QUICK | none |
| error-state.tsx | A plain error panel with a Try again button. | errors/states | no (Home renders errors through the kit's MessageError in thread.aui) | error event {error, code, crisis_resources} (wire.ts:401), spec/errors catalogue | WIRE NOW | S | F15, F16 | B4 | QUICK | none |
| feedback-dialog.tsx | A thumbs-down dialog asking what was wrong. | message | no (Home hand-builds FeedbackReasonRow, chatActionBar.tsx:47) | Reply feedback adapter (createChatFeedbackAdapter) with reasons | WIRE NOW | S | none (replaces a hand-built row) | B3 | QUICK | none |
| file-tree.tsx | A folder and file tree. | canvas/artifacts | no | File listing; none | DOES NOT FIT | S | none (code-agent view) | - | - | - |
| file.tsx | A card for a non-image file in a message (name, type, size). | canvas/artifacts | kit only (thread.aui.tsx UserFilePart) | Attachment content part | IN USE | S | F13 | B2 | QUICK | none |
| flow-graph.tsx | A node and arrow diagram of workflow steps. | agent/workflow | no | Workflow graph; none | DOES NOT FIT | M | none | - | - | - |
| follow-up-suggestions.aui.tsx | Clickable next-question chips under a finished reply. | composer | kit only (thread.aui.tsx:315 mounts it) | SuggestionAdapter.generate(messages); Home's adapter only returns starters (chatSuggestionAdapter.ts), no after-reply source | WIRE AFTER | S | F6 | B5 | MEDIUM | backend follow-up generator (adult only, passes the gate; gap matrix A15) |
| github.tsx | The GitHub logo. | other | kit only (threadlist-sidebar.aui.tsx) | none | DOES NOT FIT | S | none (a logo; links to a third party) | - | - | - |
| globals.css | Tailwind and shimmer styles the Elements rely on. | other | yes through the kit stylesheet | none | SUPPORT | S | none | - | - | - |
| hooks/use-attachment-src.ts | Gives an attachment a displayable address. | other | kit only (image.tsx, attachment.aui.tsx) | none | SUPPORT | S | none | - | - | - |
| hooks/use-copy-to-clipboard.ts | Copy-to-clipboard with a "copied" flag. | other | kit only (message and code copy buttons) | none | SUPPORT | S | F2 | - | - | - |
| hooks/use-mobile.ts | Tells if the screen is phone-sized. | other | kit only (ui/sidebar.tsx) | none | SUPPORT | S | none | - | - | - |
| image-generation.tsx | A placeholder that fills in while a picture is being made. | canvas/artifacts | no | Image job events; IMAGE-01 not built | FOR LATER | S | none (IMAGE-01, CHAT-MEDIA-01) | - | - | IMAGE-01 |
| image.tsx | A picture in a message with zoom and a full-screen view. | canvas/artifacts | kit only (thread.aui.tsx) | done.value.media and media_items (wire.ts:245-247) | IN USE | S | F13 | B2 | QUICK | none |
| inline-citation.tsx | A [1] marker inside the text that shows the source on hover. | sources/citations | no (Home has no inline marker; sources sit in a footer, NextChatPage.tsx:986) | sources array (wire.ts:244) plus the [n] mapper (THIN-4B, open) | WIRE AFTER | M | F5 | B5 | MEDIUM | THIN-4B [n] to source mapping (chatCitations.ts) |
| job-progress.tsx | A progress card with named stages for a long job. | agent/workflow | yes NextChatPage.tsx:24 (used at :608) | GET /api/projects/:id polled (done.value.project, wire.ts:283) | IN USE | S | F12 | B2 | QUICK | none |
| launcher-bubble.tsx | A floating chat bubble for a website. | other | no | none | DOES NOT FIT | S | none (Home is the app, not an embed) | - | - | - |
| loading-state.tsx | An animated dot loader with a label. | errors/states | no (Home uses ThinkingIndicator) | Turn status/stage (wire.ts:389) | WIRE NOW | S | F11 | B4 | QUICK | none |
| map-answer.tsx | A small schematic map with named pins and an optional route, drawn as plain shapes (no map tiles). | charts/data | no | pins {id,label,detail,x,y} normalised 0-100; weather's geocoder already finds a place (weather recipe, data.place) but the result has no lat/lon | WIRE AFTER | M | none from the list (places answers, in context) | B6 | LARGE | places-style result must carry lat/lon (additive on weather and a future places tool) |
| markdown-text.test.tsx | Kit test for markdown-text. | other | n/a (kit test) | none | SUPPORT | S | none | - | - | - |
| markdown-text.tsx | Renders the reply's formatting: headings, lists, tables, code with Copy, math, diagrams. | message | yes NextChatPage.tsx:7 | delta text; lazy shiki, mermaid, katex loaded inside (markdown-text.tsx:47-90) | IN USE | S | F1, F2, F3, F4 | B1 | QUICK | none |
| math-block.tsx | A step-by-step worked formula panel. | charts/data | no (LaTeX in replies goes through markdown-text katex) | Steps of an expression; none | FOR LATER | S | F3 only for a tutor companion | - | - | tutor package |
| mcp-server-panel.tsx | A list of connected tool servers and their status. | settings/onboarding | no | MCP client state; no MCP client in the backend (gap matrix C3) | FOR LATER | M | none (admin tools page) | - | - | MCP client (tools design H1-H4) |
| memory-chips.tsx | Small chips "Remembered: ..." with a Forget button. | other | no (Home hand-builds the memory state: chatMemoryState.ts, chatActionBar.tsx RememberThisButton :183) | memory_ids on the turn (ConversationTurnWithMemoryIds, wire.ts:353), chatMemoryActions.ts | WIRE NOW | S | none (memory is Home's edge; replaces hand-built) | B3 | QUICK | none |
| mermaid-diagram.tsx | Draws a diagram from text in a reply. | canvas/artifacts | used through markdown-text (lazy import, markdown-text.tsx:50) | Fenced mermaid text in the delta | IN USE | S | F4 | B1 | QUICK | none |
| message-actions.tsx | The Copy, thumbs, Regenerate and More row under a reply. | message | no (Home composes the kit's action bar with chatActionBar.tsx pieces) | Feedback adapter, speech adapter, memory actions | WIRE NOW | S | F7 | B3 | QUICK | none |
| message-attachment.tsx | Chips for files attached to a sent message. | composer | no | Attachment content parts | WIRE NOW | S | F13 | B3 | QUICK | none |
| message-branches.tsx | A "1 / 2" switch between versions of a message. | message | kit only (thread.aui.tsx BranchPicker) | Branch relationship parent_turn_id, branch_chosen (wire.ts:228) | IN USE | S | F7 | B1 | QUICK | none |
| message-pair.tsx | A static question-and-answer pair for docs. | message | no | none (demo layout) | DOES NOT FIT | S | none | - | - | - |
| message-queue.tsx | Shows messages waiting while one is still being answered. | composer | no | Client-side queue; no queue in the runtime (gap matrix A5) | WIRE AFTER | M | F7 | B5 | MEDIUM | client queue logic in chatModelAdapter (no backend change) |
| message-timing.tsx | A "first token, speed" line under a reply. | reasoning/tools | yes NextChatPage.tsx:26 (used at :1087) | done.value.stats (wire.ts:64) | IN USE | S | F9, F11 | B1 | QUICK | none |
| mobile-composer.tsx | A phone-sized message box with quick actions. | composer | no | none | FOR LATER | S | none (check Thread composer on a phone first) | - | - | - |
| model-picker.tsx | A simple model dropdown. | composer | no (Home uses ModelSelector, :29) | Models list | DOES NOT FIT | S | none (model-selector.tsx covers it) | - | - | - |
| model-selector.tsx | The model chip with search and an effort (Instant or Thinking) choice. | composer | yes NextChatPage.tsx:29 (ComposerModelSelector :255) | /api/engines models; done.value.model_status (wire.ts:224) | IN USE | S | F8 | B2 | QUICK | none |
| number-ticker.tsx | A number that counts up smoothly. | other | no | none (presentational) | FOR LATER | S | none (dashboard polish) | - | - | - |
| onboarding.tsx | A step-by-step first-run tour card. | settings/onboarding | no | Tour steps (static) | FOR LATER | S | F17 (first-chat tour) | - | - | SETUP-* backlog |
| permission-grant.tsx | A card asking you to give an agent access to something. | settings/onboarding | no | Capability request; Home's Credentials center is its own page | FOR LATER | S | none | - | - | tools T4 |
| prompt-library.tsx | A searchable list of saved prompts to insert. | composer | no | Saved prompts; none in the backend | FOR LATER | M | F17 | - | - | saved-prompts store |
| quota-banner.tsx | A "you have used 80 percent" bar. | errors/states | no | Quota; Home has storage caps (usage.ts storageUsageOverview, wire.ts:903) not message quotas | WIRE AFTER | S | F15 (storage full) | B5 | MEDIUM | none beyond existing storage overview |
| quote-reply.tsx | Select text in a reply and reply to just that. | message | no | Selection in the DOM | FOR LATER | M | F7 | - | - | composer quoting in the adapter |
| range.ts | Small clamp and slice helpers. | other | kit only | none | SUPPORT | S | none | - | - | - |
| read-aloud.tsx | A player that highlights words as they are spoken. | voice | no (Home has ListenButton, chatActionBar.tsx:116, and chatListenStore.ts) | Sentence speech scheduler and the speech text on done | WIRE AFTER | M | F18 | B6 | LARGE | per-word timing from the voice engine (VOICE-LIVE-*) |
| reasoning-effort.tsx | A picker for how hard the model thinks. | composer | no (Home uses ModelSelectorEffort, :273) | Thinking mode flag | DOES NOT FIT | S | none (model-selector effort covers it) | - | - | - |
| reasoning-panel.tsx | A static "Thought for N seconds" block. | reasoning/tools | no (Home uses reasoning.aui through NextReasoningGroup, :817) | reasoning events | DOES NOT FIT | S | none (reasoning.aui covers it) | - | - | - |
| reasoning.aui.tsx | The collapsible Reasoning row inside a reply. | reasoning/tools | yes NextChatPage.tsx:16 | reasoning event (wire.ts:387); dropped for children (rule 2) | IN USE | S | F11 | B1 | QUICK | none |
| reasoning.tsx | The visual shell for the reasoning row. | reasoning/tools | kit only (reasoning.aui.tsx) | reasoning event | IN USE | S | F11 | B1 | QUICK | none |
| recommendation-card.tsx | A suggestion with Accept or See alternatives. | agent/workflow | no | Recommendation events; none | DOES NOT FIT | S | none | - | - | - |
| regenerate-menu.tsx | A menu to regenerate with a different model or style. | message | no (Home has Refresh, a single button) | Models list and per-request model (wire.ts:224) | WIRE NOW | S | F7, F8 | B3 | QUICK | none |
| research-report.tsx | A long report with sections and a count of sources read. | canvas/artifacts | no | Deep-research output; none planned | DOES NOT FIT | M | none (documents go through the artifact card) | - | - | - |
| retrieval-chunks.tsx | Shows the passages found in your documents. | sources/citations | no | Retrieved chunks; no chunk list on the wire (no document search yet, gap matrix C5) | FOR LATER | M | F5 | - | - | document library search |
| reviewable-diff.tsx | A diff with Keep and Discard buttons. | canvas/artifacts | no | Diff hunks; none | DOES NOT FIT | M | none | - | - | - |
| schedule-card.tsx | A card for a reminder or timer: what, when, next run, on/off. | settings/onboarding | no | remind and timer recipes pick {task or label, when_text} (packageHost.ts:2130-2148) into the reply text only; no structured result, no fire time or id | WIRE AFTER | M | none from the list (reminders and timers, in context) | B6 | LARGE | remind/timer return {id, label, when_text, fire_at} as structured data (additive) |
| score-breakdown.tsx | A verdict with scored criteria. | charts/data | no | Scores; none | DOES NOT FIT | S | none | - | - | - |
| scroll-anchor.tsx | Keeps the view pinned while a reply streams. | message | kit only (thread.aui.tsx has its own scroll handling) | none | WIRE NOW | S | F7 (stop jumping on stream) | B3 | QUICK | none |
| settings-panel.tsx | A panel with model, system prompt and temperature. | settings/onboarding | no | Sampling controls; rule 3 forbids family controls (gap matrix B5) | DOES NOT FIT | S | none (admin developer panel only, later) | - | - | - |
| shared-conversation.tsx | A read-only shared chat page with Continue this chat. | thread/list | no | Share link; SHARE-CONV-01 not built | FOR LATER | M | F10 | - | - | SHARE-CONV-01 |
| shiki-highlighter.tsx | Colours code in fenced blocks. | message | used through markdown-text (lazy, markdown-text.tsx:47) | Fenced code in the delta | IN USE | S | F2 | B1 | QUICK | none |
| sources.aui.tsx | Source pills with a favicon and title. | sources/citations | yes NextChatPage.tsx:20 (used at :961, favicon via hub route :907) | done.value.sources (wire.ts:244) | IN USE | S | F5 | B2 | QUICK | none |
| sources.tsx | A "Sources" drop-down list of the pages read. | sources/citations | no (Home builds SourcesActionBarTrigger :929 and SourcesFooterContent :986) | done.value.sources | WIRE NOW | S | F5 | B3 | QUICK | none |
| speaker-identity.tsx | Labels who is speaking in a voice chat. | voice | no | Speaker turns; Home voice knows the person from the wake word | FOR LATER | S | F18 | - | - | VOICE-LIVE-* |
| spec-sheet.tsx | A key-value card (weather, almanac date, model fit). | charts/data | yes NextChatPage.tsx:18 and ModelsSection.tsx:13 | done.value.structured_part (wire.ts:261) | IN USE | S | none | B2 | QUICK | none |
| stopped-run.tsx | "You stopped this reply" with Continue and Discard. | errors/states | no (Home has Continue, chatContinue.ts) | stop_reason on stats; continued_from_turn_id (wire.ts:231) | WIRE NOW | S | F7, F15 | B3 | QUICK | none |
| streaming-text.tsx | A demo of words arriving one by one. | message | no | none (demo) | DOES NOT FIT | S | none | - | - | - |
| subagent-list.tsx | A list of sub-agents and their progress. | agent/workflow | no | Sub-agent runs; none | DOES NOT FIT | S | none | - | - | - |
| suggestions.tsx | Starter prompt chips (demo layout). | composer | no (Home uses the Thread's own ThreadSuggestions) | Suggestion adapter | DOES NOT FIT | S | none (thread.aui covers it) | - | - | - |
| surfaces.test.tsx | Kit test for the shared surface styles. | other | n/a (kit test) | none | SUPPORT | S | none | - | - | - |
| surfaces.tsx | Shared panel, field and button styles. | other | yes NextChatPage.tsx:22 | none | SUPPORT | S | none | - | - | - |
| task-card.tsx | A task with a state icon and elapsed time. | agent/workflow | no | Task state; JobProgress covers projects | DOES NOT FIT | S | none | - | - | - |
| task.ts | Task state helpers. | other | kit only | none | SUPPORT | S | none | - | - | - |
| terminal-block.tsx | A command and its output in a terminal box. | agent/workflow | no | Command output; none | DOES NOT FIT | S | none | - | - | - |
| thinking-indicator.test.tsx | Kit test. | other | n/a (kit test) | none | SUPPORT | S | none | - | - | - |
| thinking-indicator.tsx | The shimmering "Thinking..." line before the first word. | reasoning/tools | yes NextChatPage.tsx:25 (ChatThinkingIndicator :759) | status and spoken_cue events (wire.ts:389-390) | IN USE | S | F11 | B1 | QUICK | none |
| thread-list.aui.test.tsx | Kit test. | other | n/a (kit test) | none | SUPPORT | S | none | - | - | - |
| thread-list.aui.tsx | The chat history list: new chat, search, Today/Yesterday groups, rename, archive. | thread/list | yes NextChatPage.tsx:17 (NextThreadList :1372) | ConversationSummary (wire.ts:~330), chatThreadListAdapter.ts; archive() throws today | IN USE | M | F10 | B2 | QUICK | CONV-ARCHIVE-01, CHAT-TITLE-01 |
| thread-list.tsx | A static chat list for docs. | thread/list | no | none | DOES NOT FIT | S | none (thread-list.aui covers it) | - | - | - |
| thread-search.tsx | Search across chats with matched text. | thread/list | no (Home searches by title and content in its own box) | GET /api/conversations search | WIRE NOW | S | F10 | B4 | QUICK | none |
| thread.aui.test.tsx | Kit test. | other | n/a (kit test) | none | SUPPORT | S | none | - | - | - |
| thread.aui.tsx | The whole chat: messages, action bars, edit, branches, scroll, box, welcome, errors. | thread/list | yes NextChatPage.tsx:6 | Entire turn stream (assistant-stream) and history | IN USE | M | F6, F7, F15, F17 | B1 | QUICK | none |
| threadlist-sidebar.aui.tsx | A ready sidebar with the chat list and links to assistant-ui. | thread/list | no | none | DOES NOT FIT | S | none (links to assistant-ui.com and GitHub, see section 3) | - | - | - |
| timeline.tsx | A vertical timeline of events. | agent/workflow | no | Event list; none | DOES NOT FIT | S | none | - | - | - |
| todo-list.tsx | A checklist card for the household list. | agent/workflow | no | list-view recipe returns one text string (list_summary); no items array | WIRE AFTER | S | none from the list (shopping list, in context) | B6 | LARGE | list-view and list-add return items[] beside the text (additive) |
| tool-call.tsx | A collapsible "Searched the web" row with request and result. | reasoning/tools | no (Home uses ToolTimeline :23 and the kit tool-fallback) | tool_call, tool_result, tool_error (assistantStreamWire.ts:88) | WIRE NOW | S | F12 | B3 | QUICK | none |
| tool-error.tsx | A failed tool row with Retry and Skip. | errors/states | no | tool_error event; retry round exists (tools design T5) | WIRE NOW | S | F15, F16 | B4 | QUICK | none (admin-only raw detail: THIN-1E) |
| tool-fallback.aui.tsx | The default tool row for tools without their own card. | reasoning/tools | kit only (thread.aui.tsx; Home also imports assistant-ui/tool-fallback.aui at NextChatPage.tsx:15) | tool-call parts | IN USE | S | F12 | B1 | QUICK | none |
| tool-group.aui.tsx | Groups consecutive tool calls under one disclosure. | reasoning/tools | kit only (thread.aui.tsx) | tool-call parts | IN USE | S | F12 | B1 | QUICK | none |
| tool-group.tsx | A static grouped tool list. | reasoning/tools | no | none | DOES NOT FIT | S | none (tool-group.aui covers it) | - | - | - |
| tool-timeline.tsx | A "Worked for N seconds" disclosure with steps and site pills. | reasoning/tools | yes NextChatPage.tsx:23 (used at :722) | tool_timeline part from chatToolCallPart.ts | IN USE | S | F11, F12 | B1 | QUICK | none |
| tooltip-icon-button.tsx | An icon button with a hover label. | other | kit only (Home wraps it: HomeTooltipIconButton.tsx) | none | SUPPORT | S | none | - | - | - |
| trace-waterfall.tsx | A bar chart of how long each trace span took. | agent/workflow | no | Trace spans; TurnStats.nodes exists (wire.ts:~96) but traces are admin-only | FOR LATER | M | F16 (admin timing view) | - | - | TurnStats.nodes |
| typing-indicator.tsx | Three bouncing dots. | errors/states | no (Home uses ThinkingIndicator) | none | DOES NOT FIT | S | none | - | - | - |
| ui/avatar.tsx | Avatar primitive for the Elements. | other | kit only | none | SUPPORT | S | none | - | - | - |
| ui/badge.tsx | Badge primitive. | other | kit only | none | SUPPORT | S | none | - | - | - |
| ui/button.tsx | Button primitive. | other | yes NextChatPage.tsx:36 | none | SUPPORT | S | none | - | - | - |
| ui/collapsible.tsx | Collapsible primitive. | other | kit only | none | SUPPORT | S | none | - | - | - |
| ui/command.tsx | Command-menu primitive (cmdk). | other | kit only | none | SUPPORT | S | none | - | - | - |
| ui/dialog.tsx | Dialog primitive. | other | kit only | none | SUPPORT | S | none | - | - | - |
| ui/input.tsx | Input primitive. | other | kit only | none | SUPPORT | S | none | - | - | - |
| ui/popover.tsx | Popover primitive. | other | kit only | none | SUPPORT | S | none | - | - | - |
| ui/separator.tsx | Separator primitive. | other | kit only | none | SUPPORT | S | none | - | - | - |
| ui/sheet.tsx | Slide-over sheet primitive. | other | kit only | none | SUPPORT | S | none | - | - | - |
| ui/sidebar.tsx | Sidebar primitive. | other | kit only | none | SUPPORT | S | none | - | - | - |
| ui/skeleton.tsx | Loading skeleton primitive. | other | kit only | none | SUPPORT | S | none | - | - | - |
| ui/textarea.tsx | Textarea primitive. | other | kit only | none | SUPPORT | S | none | - | - | - |
| ui/tooltip.tsx | Tooltip primitive. | other | kit only | none | SUPPORT | S | none | - | - | - |
| voice-conversation.test.tsx | Kit test. | other | n/a (kit test) | none | SUPPORT | S | none | - | - | - |
| voice-conversation.tsx | A hands-free voice call screen with the orb and captions. | voice | yes liveVoiceSession.tsx:31 | Live voice session (voice engine, VOICE-LIVE-*) | IN USE | M | F18 | B2 | QUICK | none for the screen |
| voice.tsx | The animated orb that shows listening and speaking. | voice | kit only (voice-conversation.tsx) | Audio level meter (lib/voice/audioLevelMeter) | IN USE | S | F18 | B2 | QUICK | none |
| web-preview.tsx | A browser-like frame (URL bar, reload) around a preview. | canvas/artifacts | no | HTML artifact; the caller must sandbox the frame (file comment says so) | FOR LATER | M | F13 | - | - | sandboxed HTML artifact kind |
| web-search.tsx | A demo of a search tool run with results appearing. | reasoning/tools | no (ToolTimeline plus Sources cover search) | Search results; sources already ride on done | DOES NOT FIT | S | none | - | - | - |
| guardrail-notice.tsx | A notice explaining why a request was declined, with alternatives to pick instead. | errors/states | no | error event code safety_refused plus crisis_resources (wire.ts:401), done.value.safety, crisis_resources (wire.ts:210) | WIRE NOW | S | F15 | B4 | QUICK | none |

Size is frontend wiring (S or M). The "backend or tool work" column is the additive piece; `none` means the wire already carries the data. **Spec or commons tag needed: no for every
row** (`StructuredPart` lives in `backend/src/wire.ts`, not in `@maipai/spec`; new part kinds are backend plus frontend only; confirm with the coordinator before the first new kind). **New dependency: no for every row**
(the kit already depends on `react-shiki`, `katex`, `beautiful-mermaid`, `heat-graph`, `cmdk`, `@base-ui/react`; Home's `frontend/package.json` has `cmdk`, `recharts`, `zustand`, `remark-gfm`).

## 3. Bindings: which package output renders in which Element

**Mechanism (read from source).** The backend names the tool id on the wire; the frontend registers a renderer keyed by that id with assistant-ui's `useAssistantToolUI({ toolName, render, display: "standalone" })`
(`NextChatPage.tsx:128, 417, 741`); the kit mounts `part.toolUI ?? <ToolFallback/>` (`thread.aui.tsx:743`). `structured_part.tool_id` becomes the part's `toolName` (`chatModelAdapter.ts:674`, history twin
`chatHistoryAdapter.ts:166`). The producer is `structuredPartForOutcomes()` (`backend/src/lib/composer.ts:584`), which keys on `outcome.packageId` and reads `outcome.result.data`; each new binding adds one producer there and one `useAssistantToolUI` in a new
frontend file. Every addition below is **additive** to the tool's `data`; `text` and `speech` stay untouched (a child's reply is released exactly as today).

| Package or tool | Output today | Element | Fields the Element needs, and do we carry them | Small additive change | Status |
|---|---|---|---|---|---|
| weather | recipe `data {place, temperature, conditions, high, low, precipitation_chance, unit}` (`weather/recipe.json`) | spec-sheet | all carried | none | bound today (`composer.ts:635`) |
| weather (place) | same, no coordinates | map-answer (one pin) | pins {label, detail, x, y}: no lat/lon in result | add `data.lat`, `data.lon` from the geocoder the recipe already calls | WIRE AFTER |
| almanac-date | handler `data {date, weekday}` (`almanac-date/handler.ts:19-23`) | spec-sheet | carried | none | bound today |
| almanac-time, almanac-moon, almanac-holiday, almanac-onthisday | handler returns `{text, speech}` only | spec-sheet (one or two rows) | no data object | add `data` (time and zone; phase; holiday and date; year and event) | WIRE AFTER, low value: text alone reads well |
| remind, timer | recipe picks `task` or `label` and `when_text` into the reply text (`packageHost.ts:2130-2148`) | schedule-card | name, cadence, nextRun, enabled, history: only name and when text exist | add `data {id, label, when_text, fire_at, kind}` | WIRE AFTER |
| list-add, list-view | recipe returns `list_summary` text | todo-list | items[] with checked state | add `data.items[]` | WIRE AFTER |
| sports | handler `{text, speech}` (`sports/handler.ts:58,65`) | data-table | rows (teams, score, status) | add `data.games[]` | WIRE AFTER |
| news | handler `{text, speech}` | sources.aui pills (existing `sources` field) plus text | title, site, url | put the headline pages into `Source[]` (`wire.ts:244`), no new part | WIRE AFTER |
| media-lookup, music | handler `{text, speech}` | spec-sheet | title, director, cast, runtime, rating (artist facts) | add `data` rows | WIRE AFTER |
| currency | handler `{text, speech}` | spec-sheet (amount, rate, as-of date). number-ticker is decoration only | amount, rate, date | add `data` | WIRE AFTER |
| convert, math | recipe text | plain text; spec-sheet for a unit result. math-block needs steps no recipe produces | steps[] (math-block) | none now; steps need a new compute op | FOR LATER |
| define | recipe text | spec-sheet (word, part of speech, meaning) | word, meaning | add `data` | WIRE AFTER, low value |
| translate, joke, trivia | recipe text | none (text) | none | none | text is the right form |
| knowledge | handler text with `summary.title` and extract (`knowledge/handler.ts:39`) | sources.aui pill for the page | source url | add the page to `Source[]` | WIRE AFTER |
| remember, recall | recipe text; the turn carries `memory_ids` (`wire.ts:353`) | memory-chips | text, change (added, updated, existing): ids carried, change kind not | add `change` to the turn's memory record | WIRE NOW for added and existing |
| lights-on, lights-off, lock-doors | consequential; park a confirm (`done.value.confirm`, `wire.ts:~290`) | approval-card | package_id, open | none | WIRE NOW (batch 3) |
| websearch | recipe `data {rows, query, page, pages, floor_dropped}`; `sources` on done | tool-timeline and sources.aui (both in use), inline-citation | sources carried; the `[n]` mapper is THIN-4B | THIN-4B mapper | in use; inline marker WIRE AFTER. The kit `web-search.tsx` is a demo of the same tool: DOES NOT FIT |
| write_document | recipe `data {artifact_id, artifact_version}` (`composer.ts:603`) | artifact-card and canvas-split | carried | none | in use |
| start_project, bedtime-storybook (project kind) | `data.projectId` (`composer.ts:624`) | job-progress, then artifact-card | carried; stages polled from `GET /api/projects/:id` | none | in use |
| answer_from_this_conversation (virtual tool) | not read in this audit: the handler lives in `backend/src/lib/turnMachine/nodes/tool.ts`; check before binding | tool-call row (tool-timeline step) | none expected | none | tool row only |
| buddy, default, pal, tutor, storytime-style | no tool output (persona and skill packages) | none | none | none | n/a |
| Model answers with structure | markdown in `delta` | markdown-text: tables (F1), code with Copy (F2), katex math (F3), mermaid (F4) | carried | none | in use |
| A model chart | no part kind | chart | series of numbers | a tool (not free model text, rule 9) returns a `chart` part | WIRE AFTER |
| comparison-card, score-breakdown, recommendation-card, number-ticker, math-block, research-report | no package emits comparisons, scores, picks or reports | none | none | none | FOR LATER or DOES NOT FIT as marked; tables cover comparisons |

**Privacy check for the map card and any Element that loads remote assets.** `map-answer.tsx` draws an inline SVG on `viewBox 0 0 100 100` with pins from normalised `x, y` (`map-answer.tsx:45`): **it calls no host and loads
no tiles, fonts or images**, so it already meets the rule. Binding needs a lat/lon to x/y projection done in Home (place card, pin, and a user-clicked "Open in maps" link; remote tiles only as an adult-only household opt-in, a setting not built).
Hosts found in the kit source (`grep` for URLs, `fetch`, `src=`, `import()`):

| Element | Host or call | Evidence | Verdict |
|---|---|---|---|
| sources.aui | `icons.duckduckgo.com` favicon by default | `sources.aui.tsx:53` | Home overrides with `/api/favicon` (`NextChatPage.tsx:907`, `backend/src/lib/favicons.ts`, hub-side fetch with an SSRF guard and a cache). Keep the override on every use (`tool-timeline` takes `faviconUrl` too, `tool-timeline.tsx:48`) |
| image | `fetch(part.image)` for any image part | `image.tsx:114` | a remote image part would call that host from the browser. Allow hub-served or `data:` URLs only; route `media.url` and thumbnails through the hub (`chatMedia.test.tsx` renders `https://img.example.com/...` straight) |
| threadlist-sidebar.aui | anchors to `assistant-ui.com` and `github.com/assistant-ui` | `threadlist-sidebar.aui.tsx:27, 54` | plain links, not loads; the Element is DOES NOT FIT anyway |
| attachment.aui | `<img src>` of the attachment blob | `attachment.aui.tsx:51, 100` | local blob, no host |
| web-preview | an iframe the caller supplies | `web-preview.tsx` header comment | no isolation of its own; sandbox it before any use (FOR LATER) |
| markdown-text | lazy `import()` of shiki, mermaid, katex and the katex CSS | `markdown-text.tsx:47-90` | bundled chunks, no CDN. Check the built chunks do not pull a CDN font |
| globals.css | `@import "tailwindcss"`, `tw-shimmer` | `globals.css:1-2` | build-time, no URL |

No telemetry, analytics, beacons, WebSockets, hosted-model calls or external fonts were found in `src/elements` (one `fetch`, one favicon URL, two anchors). The kit's `elements/ui/*` primitives
make no network calls. Speech and microphone use lives in Home's own files (`lib/voice/*`), not in the kit Elements read here.

## 4. Hand-built chat code to replace (the "hackiness" list)

Rule for every batch: wiring an Element deletes its hand-built equivalent in the same change (port before delete, tests re-pointed, never weakened). Line ranges are function spans read from the files.
`frontend/src/apps/chat/chatDayDivider.tsx`, `chatSourceCaption.tsx` and `chatTurnStats.tsx` are **imported by no non-test file** (leftovers of the old page): delete with their tests once an Element covers them.

| Hand-built | Lines | Replaced by | Behaviour that could be lost | Batch |
|---|---|---|---|---|
| DayDivider, MessageTimestamp (dead) | `apps/chat/chatDayDivider.tsx:35-93` | day-separator, or Thread's own `UserMessageTimestamp` | the 16px type floor fix (keep via kit tokens) | B3 |
| ChatSourceCaption (dead) | `apps/chat/chatSourceCaption.tsx:19-67` | sources.tsx | none | B3 |
| ChatTurnStats (dead) | `apps/chat/chatTurnStats.tsx:24-61` | message-timing (already used) | none | B1 |
| SourcesActionBarTrigger, SourcesFooterContent, SuppressSourcesFallback, SourcesOpenContext | `NextChatPage.tsx:929-1040, 1131-1149, 197-207` | sources.tsx (list) plus sources.aui pills, then inline-citation | the side-panel open state and the tap-to-open-source behaviour must port first | B3, B5 |
| MessageDetailsContextBar, MessageDetailsReveal, MessageDetailsMenuItem | `NextChatPage.tsx:1041-1100, 314-343` | message-timing plus context-display (both imported already) | adult-only gate and the Details toggle persistence | B2 |
| FeedbackReasonRow, FeedbackButtons | `apps/chat/chatActionBar.tsx:33-114` | feedback-dialog with message-actions | the five reason chips and their order | B3 |
| ListenButton | `apps/chat/chatActionBar.tsx:116-181` | read-aloud (needs per-word timing) or keep until B6 | sentence scheduler and `chatListenStore.ts` state | B6 |
| RememberThisButton, RememberThisMenuItem, ForgetThisMenuItem | `apps/chat/chatActionBar.tsx:183-265` | memory-chips (Forget) plus message-actions More | judge-grounded remember semantics stay in `chatMemoryActions.ts` | B3 |
| ComposerModelSelector, MODEL_EFFORTS | `NextChatPage.tsx:243-282` | model-selector (already) with composer's `ComposerModelTrigger` | the minors' label-only view | B2 |
| ComposerAddMenuItem, GroupLabel, AddPhotosAndFilesItem, TakeAPhotoItem, WebSearchItem, AppsGroup | `apps/chat/composerAddMenu.tsx:87-222` | composer.tsx `ComposerMenu*` items (partly imported) | camera capture, package scope list | B5 |
| ConfirmToolRender | `NextChatPage.tsx:421-480` | approval-card | the `ToolFallback.Approval` options and turn-id matching | B3 |
| ProducedArtifactCard wrapper, ArtifactCanvasPanel, BareCompareCanvasPanel | `NextChatPage.tsx:392-415, 1150-1371` | artifact-card and canvas-split (already) | admin compare columns | B2 |
| NextThreadList (about 500 lines: bulk select, pin, delete confirm, title and content search) | `NextChatPage.tsx:1372-1875` | thread-list.aui plus thread-search and conversation-search | bulk select, content search, pin and delete confirm may have no Element: **loss risk, verify first** | B4 |
| NextChatWelcome | `NextChatPage.tsx:780-816` | empty-state | per-person greeting copy | B2 |
| ChatThinkingIndicator, ToolTimelineToolRender, NextReasoningGroup | `NextChatPage.tsx:759-779, 698-758, 817-890` | thinking-indicator, tool-timeline, reasoning.aui (all imported; these are thin wrappers) | none; keep as the binding layer | B1 |
| Continue button logic | `apps/chat/chatContinue.ts` | stopped-run | continuation sibling semantics (`continued_from_turn_id`) | B3 |
| HomeTooltipIconButton | `apps/chat/HomeTooltipIconButton.tsx:14-42` | tooltip-icon-button | none; a wrapper, keep | none |
| ChatHeaderBar and rename | `apps/chat/chatHeaderBar.tsx:93-212` | no Element (page chrome) | n/a | none |
| BareModelBadge, admin compare menu items | `NextChatPage.tsx:284-362, 1102-1115` | no Element (admin only) | n/a | none |
| composerDictationWaveform | `apps/chat/composerDictationWaveform.tsx` | no Element (composer slot; voice.tsx is the orb) | n/a | none |

## 5. Batch plan, ordered by effort (quick wins first)

Effort buckets: **QUICK** (under about half a day: the Element is already mounted or the data is on the wire; the work is a showcase scenario, a test, and deleting the hand-built twin), **MEDIUM** (1 to 2 days),
**LARGE** (a new backend feature). "Implemented" means used in Home plus a showcase scenario plus a test; counts below are of the **116 real Elements** (144 files minus 28 support files; the owner's 129 includes files
that are not Elements). The counter after each batch is cumulative. Showcase scenarios named in lower case exist on `origin/cloud/ui-showcase` (`backend/src/lib/uiFixtures.ts`: table, code, math, lists, headings, essay, reasoning, search,
failed-tool, failure-engine-down, failure-engine-down-spoken, failure-unavailable, failure-generic, failure-cancelled, failure-safety, cutoff, crisis, incognito, child, spoken, links); `NEW:` ones are to be added to that registry by the batch.
Each batch owns its files; `NextChatPage.tsx` is the one shared file, so each batch takes only a one-line mount there and puts everything else in new files.

| Batch | Effort | Elements | Files touched (new unless named) | Showcase scenarios | Counter after |
|---|---|---|---|---|---|
| B1 Prove the Thread shell (13) | QUICK | thread.aui, markdown-text, shiki-highlighter, mermaid-diagram, reasoning.aui, reasoning, thinking-indicator, tool-fallback.aui, tool-group.aui, tool-timeline, message-timing, message-branches, edit-message | `backend/src/lib/uiFixtures.ts` (scenarios only), `frontend/src/next/pages/NextUiShowcasePage.test.tsx` and per-element tests under `frontend/src/apps/chat/`; delete `chatTurnStats.tsx` | table, code, math, NEW: mermaid, reasoning, child, search, essay, NEW: edit-branch, NEW: timing-footer | 13 |
| B2 Prove panels, lists, composer parts, voice (14) | QUICK | artifact-card, canvas-split, job-progress, sources.aui, spec-sheet, model-selector, context-display, thread-list.aui, attachment.aui, file, image, empty-state, voice-conversation, voice | fixtures and tests; `NextChatPage.tsx` hunks `:243-282, 780-816, 1041-1100` | NEW: artifact-card, NEW: canvas-open, NEW: job-progress, search, NEW: spec-sheet, NEW: model-chip, NEW: context-footer, NEW: thread-list, NEW: attachments, NEW: file-card, links, NEW: empty-state, spoken | 27 |
| B3 Reply chrome (11) | QUICK | sources, tool-call, message-actions, feedback-dialog, regenerate-menu, day-separator, scroll-anchor, message-attachment, memory-chips, approval-card, stopped-run | new `frontend/src/apps/chat/chatReplyChrome.tsx`; edit `chatActionBar.tsx`, `chatContinue.ts`; delete `chatDayDivider.tsx`, `chatSourceCaption.tsx` | search, failed-tool, NEW: action-bar, NEW: feedback-reasons, NEW: regenerate-with, NEW: day-divider, essay, NEW: memory-chips, NEW: confirm-ask, cutoff | 38 |
| B4 Plain errors and chat navigation (10) | QUICK | error-state, guardrail-notice, tool-error, connection-state, loading-state, command-palette, conversation-map, conversation-search, thread-search, draft-restore | new `chatErrorPanel.tsx`, `chatFindInChat.tsx`; edit `chatModelAdapter.ts` (error mapping only), the `NextThreadList` span `NextChatPage.tsx:1372-1875` | failure-engine-down, failure-engine-down-spoken, failure-unavailable, failure-generic, failure-cancelled, failure-safety, crisis, failed-tool, NEW: connection-dropped, NEW: command-palette, NEW: find-in-chat, NEW: thread-search, NEW: draft-restore | 48 |
| B5 Medium (8) | MEDIUM | follow-up-suggestions.aui (starters first: mount the existing adapter in `NextChatPage.tsx:1779`), inline-citation, diagram, data-table, message-queue, quota-banner, composer, document-reference | `chatSuggestionAdapter.ts`, `chatCitations.ts` (THIN-4B mapper), `composerAddMenu.tsx`, new `chatRichParts.tsx`; backend `follow-up` generator only for the second half | NEW: follow-ups, search, NEW: mermaid, table, NEW: message-queue, NEW: quota-storage, NEW: composer-menus, NEW: document-reference | 56 |
| B6 Needs a backend piece (8) | LARGE | map-answer, schedule-card, todo-list, chart, background-inbox, context-breakdown, read-aloud, elicitation-form | additive tool output in the `remind`, `timer`, `list-view`, `list-add`, `weather` packages and `backend/src/lib/composer.ts` (new producers), `backend/src/wire.ts` (`StructuredPart` kinds), new `frontend/src/apps/chat/chatPackageParts.tsx`; STACK-CTX-01 and VOICE-LIVE-* for the last three | NEW: map-place, NEW: schedule, NEW: todo, NEW: chart, NEW: context-breakdown, spoken | 64 |

Dependencies: B5's follow-up generator (a small model call after each adult reply, passed through the age gate) and B6's context split (STACK-CTX-01) and read-aloud (per-word timing) are the long poles. B1 and B2 should run first because they prove what is
already mounted and fix the starters being switched off. Not in any batch: the 17 FOR LATER and 35 DOES NOT FIT elements. `elicitation-form` sits in B6 but also waits on a tool elicitation event (tools design). The upper bound of this plan is 64 of 116; the remaining FOR LATER items (voice extras, projects, MCP,
code runner, image generation, share, prompt library, onboarding) need their own feature records.

### 5a. IMPLEMENTED definition and order by real chat capability (owner priority, added after the first push)

Normal chat comes first; the playground only verifies it. An Element counts as **IMPLEMENTED** only when all three hold: (a) it is mounted in the shared chat thread
(`frontend/src/apps/chat/ChatThread.tsx` or `elementBindings.ts` from `cloud/shared-chat-thread`; until that lands, mounted in `NextChatPage.tsx`), (b) a **real turn** can
produce the part or data it renders today (backend or tool output exists, cited in the row's data column), and (c) a test references it. A showcase fixture alone never counts: such
Elements are reported as **in playground only**. The scanner reports three counts: implemented, in playground only, not yet. It is not written (needs the owner's go-ahead), so no count is
asserted here; the JSON carries the definition and a `realTurnToday` flag per item for the scanner to confirm.

Real-turn status from this audit: **real today** (data on the wire now): every batch B1 to B4 element, `follow-up-suggestions.aui` starters (adapter exists, only unmounted), `inline-citation` (sources
exist; the `[n]` mapper THIN-4B is the missing piece), `data-table` and `diagram` (markdown tables and mermaid arrive in `delta`), `message-queue` (client only), `quota-banner` (storage overview, `wire.ts:903`),
`composer` pieces. **Playground only until a backend piece lands:** `map-answer`, `schedule-card`, `todo-list`, `chart`, `background-inbox`, `context-breakdown`, `read-aloud`, `elicitation-form`, `document-reference`,
and the follow-up generator half of `follow-up-suggestions.aui` (batch B6 and the second half of B5).

Order by what gets a real chat capability live first (replaces the effort order above where they differ):
1. **B1** (reasoning, tools, markdown, branches, edit are all real now) then **B4** (plain errors, find, command palette: real error events exist, `wire.ts:401`).
2. **B3** (sources list, action bar, confirm card for lights and locks, stop and continue).
3. **B2** (artifact, job progress, model chip, thread list, attachments, voice).
4. **B5 starters first** (one-line mount of the existing adapter: a real capability at once), then inline `[n]` citations (THIN-4B), then the rest of B5.
5. **B6** last: each element goes live only with its additive tool output (section 3), and stays "in playground only" until a real turn emits it.

## 6. Elements that need a new dependency or a spec or commons tag

- **New dependency: none.** Every Element's imports are in the kit's `package.json` (verified against the tag: `@base-ui/react`, `beautiful-mermaid`, `cmdk`, `heat-graph`, `katex`, `react-shiki`).
- **spec or commons tag: none for wiring.** A new `StructuredPart` kind (chart, table, schedule, todo, place) is a backend type in `wire.ts` read by the frontend through `lib/api`. If the owner wants those shapes shared with the bot, they would go in `@maipai/spec`
  and need a tag (decision for the owner; this audit cut none).
- **Kit changes (a `ui-v0.5.x` tag) worth asking for:** none required; one optional: make `sources.aui.tsx:53` default to no favicon so a caller who forgets the override never calls DuckDuckGo.

## 7. Conflicts with our rules

1. **Remote asset load:** `sources.aui` default favicon host (`icons.duckduckgo.com`), already overridden in Home; `image.tsx:114` fetches any image part URL from the browser. See the host table in section 3.
2. **Branding links:** `threadlist-sidebar.aui.tsx` links to `assistant-ui.com` and GitHub: never mount it.
3. **Rule 2 (children never see reasoning):** `reasoning-panel` and `reasoning.aui` would show reasoning if a minor's turn carried it; the backend drops it for minors (`wire.ts:387` comment), so keep the gate on the wire, not in the Element.
4. **Rule 1 and the backend's honesty:** `confidence-marker` shows grounded, inferred or uncertain claims, which nothing in the backend measures (`wire.ts:242` says the tool score is not model confidence): DOES NOT FIT.
5. **Rule 3 (no family sampling controls):** `settings-panel` exposes temperature and system prompt: DOES NOT FIT for the family; admin only, later.
6. **Hosted-model calls and telemetry:** none found in `src/elements`.
7. **Rule 9 (no hand-built UI):** the hand-built list in section 4 is the debt; the `NextThreadList` and action-bar pieces are the ones where an Element may not cover all current behaviour.

## 8. Counts

144 rows. By verdict: IN USE 27, WIRE NOW 21, WIRE AFTER 16, FOR LATER 17, DOES NOT FIT 35, SUPPORT 28. Registry: `docs/plans/elements-adoption-2026-10-04.json` (144 items; `bindings`, `replacesHandBuilt`, `effort`, `batch` filled by hand; USED and IMPLEMENTED are for the scanner to compute).
