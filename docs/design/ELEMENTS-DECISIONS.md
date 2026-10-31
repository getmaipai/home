# Elements decisions ledger

Owner order (Jesse, 2026-10-06): "we need to keep track of these things - why we chose custom vs Element."

This ledger records every place Home does not use an assistant-ui Element as it ships, and why. It records exceptions and
grants none. [RULES.md](RULES.md) rule 9 and S2 stay the authority; a row here is never permission to add custom code, and a
row that cannot name a verified reason says so and is queued for removal.

Architect verdict: `ELEMENTS-DECISIONS-01` (APPROVED, 2026-10-06).

## How this file is enforced

- `frontend/src/dev/kitElementLints.test.ts` reads this file. Every entry in the three shrink-only baselines
  (`kit-classname-override-baseline.json`, `kit-css-override-baseline.json`, `kit-wrapper-baseline.json`) carries an `ed` and a
  `reason`. The `ed` is an id in this table or the value `NO-REASON-REMOVE`, and the `reason` is not empty.
- A baseline entry may cite any row here except a row marked `removed`: a `removed` row with a baseline entry fails the gate.
- New baseline entries are refused by the existing shrink-only check, so `NO-REASON-REMOVE` and the "NO REASON" rows below only
  ever shrink.
- Every architect verdict that leaves custom code or an Element non-adoption adds or cites a row here (ARCHITECT.md).
- The dev/ui Elements adoption panel shows the three counts. `elements-decisions-counts.json` holds them and a test keeps it equal
  to the table.

## Columns

Status is exactly one of `active exception`, `being removed`, `removed`. A row whose Why starts with "NO REASON" has no verified
reason; its status is `being removed` and it points at its item in the ELEMENTS CLEANUP PROGRAM
(`data-scratch/chat-ab/OVERNIGHT-QUEUE.md`, the numbered list from `queue/reports/elements-lint02-report.md`). Paths are under
`frontend/src` unless they start with `backend/` or `commons`.

## Ledger

| ID | Element or area | What Home does instead | Why (evidence) | Decided | Exit condition and removal slice | Status |
|---|---|---|---|---|---|---|
| ED-001 | Speech scheduling with the spoken cue | Sentence-gated speech scheduling and the `spoken_cue` event, `backend/src/wire.ts` | RULES.md rule 9 "Named gaps today": no Element schedules speech by sentence with a spoken cue | Rule 9 (owner, 2026-10-04); cited, no new gap | A kit speech scheduler Element that takes sentence gates; no slice yet (TTS-ALIGN-01 is the nearest row) | active exception |
| ED-002 | Citations (inline-citation, `Citation`) | The `[n]` citation mapper, `apps/chat/chatStreamingMarkdown.ts`, bound by `apps/chat/chatCitationLink.tsx` | Rule 9 named gap "the `[n]` citation mapper"; STREAMING-TEXT-01 report: the file "only holds a partial `[n` citation tail and maps citations" | Rule 9; architect STREAMING-TEXT-01 (2026-10-06) | Native source parts (ELT-T1-23) so the mapper reads parts, not text | active exception |
| ED-003 | Output gate | Age-banded `StreamGate`, `backend/src/lib/turnMachine/nodes/outputGate.ts` | Rule 9 named gap "the output gate"; safety path, no Element exists | Rule 9 | None: child protections are non-removable architecture (SAFETY.md) | active exception |
| ED-004 | Tool-call parsing | The prose tool-call fallback, `backend/src/lib/llm.ts` (lines 234 to 264) | Rule 9 named gap "the prose tool-call fallback": local models emit tool calls as prose | Rule 9 | A model template that always emits native tool calls | active exception |
| ED-005 | streaming-text and markdown-text | The reply renders through the kit `MarkdownText` (Streamdown) with the streaming-text look in kit CSS (`commons ui/src/elements/markdown-text.css`), not the Element | The Element renders one `<p>`, splits on spaces and drops line breaks, so it has no headings, lists, code, tables, math, links or citations (`queue/reports/streaming-text-report.md`, from the docs page and `streaming-text.tsx`). Home has no Home-side animation code | Architect STREAMING-TEXT-01 (2026-10-06, amended 19:05) | Upstream streaming-text gains markdown support; then MarkdownText composes it. No slice | active exception |
| ED-006 | approval-card | `ToolFallback.Approval` through `ConfirmToolRender`, `apps/chat/chatToolUis.tsx`, `apps/chat/elementBindings.ts`, `shell/pages/ChatPage.tsx` | The old comment said the Element "can't be relabeled"; the master plan (D09) found it has `title` and `subtitle`, so the reason was false. Gaps (icon, optional command, status labels) are closed by additive kit props | Architect APPROVE-CARD-02 (2026-10-06), conditions C1 to C5 | Adopt `ApprovalCard`, delete the synthesized path: APPROVE-CARD-02 | being removed |
| ED-007 | computer-use | None; kept in the kit gallery | Home has no screen-driving agent (master plan section 2, "The 10 NF Elements") | Owner, 2026-10-06 (Q8: stay in the gallery, used later for the agent workspace) | A browser-control package; reopen then | active exception |
| ED-008 | confidence-marker | None; kept in the gallery | Renders the whole answer as claim buttons, replacing Streamdown and `[n]` citations; no graded-claims producer exists; rule 2 | Owner, 2026-10-06 (Q8) | A graded-claims output spec | active exception |
| ED-009 | file-tree | None; kept in the gallery | Needs per-file churn; Home has no multi-file change feature | Owner, 2026-10-06 (Q8) | A package-update review | active exception |
| ED-010 | flow-graph | None; kept in the gallery | Branching node graph; Home routines and projects are linear | Owner, 2026-10-06 (Q8) | Branching routines | active exception |
| ED-011 | logos | None; kept in the gallery | Only OpenAI, Anthropic and Google marks; Home runs local models; TRADEMARKS.md | Owner, 2026-10-06 (Q8) | Never for Home | active exception |
| ED-012 | score-breakdown | None; kept in the gallery | Numeric weighted criteria; Home fit verdicts are categorical | Owner, 2026-10-06 (Q8) | A scored review feature | active exception |
| ED-013 | settings-panel | None; kept in the gallery | System prompt and temperature knobs break rules 3 and 14 | Owner, 2026-10-06 (Q8) | An owner-approved advanced panel | active exception |
| ED-014 | subagent-list | None; kept in the gallery | Home runs no parallel sub-agents | Owner, 2026-10-06 (Q8) | Delegated agents (agent workspace) | active exception |
| ED-015 | syntax-highlighter | None; the live `shiki-highlighter` is used | Prism duplicate of the live `shiki-highlighter`; principle 1 | Owner, 2026-10-06 (Q8) | Never while shiki ships | active exception |
| ED-016 | terminal-block | None; kept in the gallery | Nothing streams command output | Owner, 2026-10-06 (Q8) | An update or backup run log | active exception |
| ED-017 | edit-message, message-actions, message-branches, scroll-anchor (standalone demos) | None; the kit `Thread` renders the runtime forms (`EditComposer`, `AssistantActionBar`, `BranchPicker`, `ThreadScrollToBottom`) | `elements-adoption.json` verdict reasons: the standalone files are demos of jobs the adopted Thread already does (scroll-anchor ships a `setInterval` demo) | ELT-SCANNER-01 audit (2026-10-06) | None needed: the Element is used, through Thread | active exception |
| ED-018 | removed; files gone | none | Removed; files gone. | Audit sets B to E (2026-10-06) | none | removed |
| ED-019 | removed; files gone | none | Removed; files gone. | Audit sets B to E (2026-10-06) | none | removed |
| ED-020 | removed; files gone | none | Removed; files gone. | Audit sets B to E (2026-10-06) | none | removed |
| ED-021 | removed; files gone | none | Removed; files gone. | Audit sets B to E (2026-10-06) | none | being removed |
| ED-022 | removed; files gone | none | Removed; files gone. | Audit sets B to E (2026-10-06) | none | removed |
| ED-023 | removed; files gone | none | Removed; files gone. | Audit sets B to E (2026-10-06) | none | removed |
| ED-024 | removed; files gone | none | Removed; files gone. | Audit sets B to E (2026-10-06) | none | removed |
| ED-025 | removed; files gone | none | Removed; files gone. | Audit sets B to E (2026-10-06) | none | being removed |
| ED-026 | removed; files gone | none | Removed; files gone. | Audit sets B to E (2026-10-06) | none | being removed |
| ED-027 | removed; files gone | none | Removed; files gone. | Audit sets B to E (2026-10-06) | none | removed |
| ED-028 | removed; files gone | none | Removed; files gone. | Audit sets B to E (2026-10-06) | none | removed |

| ED-029 | Composer family (composer, model-selector, composer attachments and menu) | The compact composer CSS block in `shell/tokens.css`, plus `ComposerModelSelector`, `ComposerAddMenuItem` and size classes in `apps/chat/composerAddMenu.tsx` | The kit composer had no compact density; ELT-COMPOSER-KIT-01 adds it in the kit (ui-v0.5.119 carries the label-only part) | Cleanup item 1 (2026-10-06) | ELT-COMPOSER-KIT-01, then pin | being removed |
| ED-030 | Touch targets on composer and message actions | 44 to 48 px `::before` hit areas in `shell/pages/chatTouchTargets.css` | The kit has no hit-area token or variant; K03 adds `hitArea48` | Cleanup item 7 (2026-10-06) | Pin the kit hit-area prop, delete the CSS | being removed |
| ED-031 | thread-list, thread-search, threadlist-sidebar | History column CSS in `shell/tokens.css`, `ThreadListRoot` classes, `ChatHistoryPanel` and `ChatColumnToggle`, `shell/pages/ChatColumn.tsx` | Kit thread list has no compact variant; the column shell is custom | Cleanup item 3; COLUMN-02 (2026-10-06) | ELT-T1-20 with a kit compact variant | being removed |
| ED-032 | Chat surfaces (user bubble, thread root, viewport footer, Incognito) | CSS in `shell/tokens.css` setting background, radius, max-width and padding on `.aui-user-message-content` and `.aui-root.aui-thread-root` | NO REASON: to be removed. No audit records why a token cannot carry these; move to kit tokens | None recorded | Cleanup item 4 | being removed |
| ED-033 | App rail (sidebar, rail-workspace, rail-body) | The collapsed-sidebar and chat shell layout block in `shell/tokens.css` | Kit has no permanent 56 px rail variant (RULES.md S1), per `elements-lint02-report.md` item 8 | RULES S1 (owner); cleanup item 8 | A kit rail variant, then delete the CSS | being removed |
| ED-034 | Chat wrappers with no recorded reason | `ChatThread`, `ChatQueueRow`, `ReasoningGroup`, `ChatThinkingIndicator`, `SpecSheetToolRender`, `ProjectToolRender`, `ToolTimelineToolRender`, `AnswerImagesDataRender`, `ChatConnectionBanner`, `MessageDetailsContextBar`, `MessageDetailsReveal`, `BareModelBadge` and similar | NO REASON: to be removed. Baseline text only said "retire in the Elements program" | None recorded | Cleanup item 5 | being removed |
| ED-035 | Chat className overrides with no recorded reason | Size and shape classes on icon buttons, `Kbd`, `DayDivider`, header bar Button and Input, `SheetContent`, voice and wake word controls | NO REASON: to be removed | None recorded | Cleanup item 6 | being removed |
| ED-036 | error-state | `className="max-w-none px-0 py-1"` in `apps/chat/chatErrorSlot.tsx` | The kit ErrorState had a fixed `max-w-sm` and card padding; K03 adds `layout="inline"` (ui-v0.5.116) | Master plan D07 (2026-10-06) | Pin 0.5.116 or later, use `layout="inline"`, delete the className (cleanup item 6) | being removed |
| ED-037 | Settings and models pages | Restyles of Button and Input (radius, background, shadow, padding, width) in `apps/settings/*` and `shell/pages/settings/*` | NO REASON: to be removed | None recorded | Cleanup item 9 | being removed |
| ED-038 | Dashboard, status, performance, people and page cards | `*Card` components returning `<Card>`, `CardHeader border-b border-border`, table row borders, tab and collapsible classes | NO REASON: to be removed. Baseline text only said "retire in the Elements program" | None recorded | Cleanup item 10 | being removed |
| ED-039 | Small sweeps (shell menus, status, dev panel) | `Button w-fit`, `Checkbox mt-*`, `Separator my-1`, `Input w-*`, shell menu Buttons, `ElementsAdoptionPanel`, `ThemeToggle` | NO REASON: to be removed | None recorded | Cleanup item 11 | being removed |
| ED-040 | Destructive button and badge in dark mode | Background rules in `shell/tokens.css` for `[data-variant="destructive"]` | NO REASON: to be removed; belongs in kit tokens | None recorded | Cleanup item 10 | being removed |


## Not in the baselines

These non-adoptions carry no baseline entry because the scanners do not see them. They are listed so the record is whole.

- The 36 `no-fit` rows in `frontend/src/dev/elements-adoption.json` carry the generic reason "No current Home feature needs this
  Element's specific data and interaction". Ten are ED-007 to ED-016, four are ED-017, and `streaming-text` is ED-005. The rest
  are superseded by the tier assignments in `ELEMENTS-MASTER-PLAN.md` (for example `task-card`, `model-picker`,
  `comparison-card` and `recommendation-card` are wired in ELT-T1-10, -10b and -11). ELT-T1-27 regenerates the JSON; until then
  those rows are a stale record, not a decision.
- `launcher-bubble`, `assistant-modal` and `assistant-sidebar`: master plan Q5 recommended no floating ask button. Ruled the other
  way by Jesse on 2026-10-24 (S2 edited, Owner-approved): the shell draws the person's companion launcher on non-chat areas and it
  opens a chat panel. Revised 2026-10-27 (REVAMP-PRESENCE-01, `companions-handoff-revamp-2026-10-26.md` section 5a): the corner card
  opens no panel, so it is the new kit Element `companion-dock`; `launcher-bubble` stays the wake-word indicator and `assistant-modal`
  is not needed; `assistant-sidebar` stays unclaimed.
