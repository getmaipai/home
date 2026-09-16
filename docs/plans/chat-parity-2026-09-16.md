# Chat parity program

Date: 2026-09-16

This is a product design pass for making MaiPai's chat familiar to a parent
who has never read a manual, while keeping owner controls available to the
person who runs the household. It compares the feature surface of ChatGPT,
Claude, Gemini, Open WebUI, LM Studio, Jan, and Msty. The competitor column
is a point-in-time read of official documentation on 2026-09-16. `Y` means
the documentation clearly describes the feature, `N` means I did not find it
in the reviewed official material, and `?` means the feature or plan split
was not clear enough to assert. A question mark is intentional uncertainty,
not a negative claim.

## The inventory

MaiPai status uses `built`, `designed`, `missing`, `merge`, or `drop`.
The last column is the default disclosure level: `basic`, `advanced`, or
`expert`. A feature can still be available at a lower level when it is a
normal action, but its settings and diagnostics stay at the named level.

| Feature | ChatGPT | Claude | Gemini | Open WebUI | LM Studio | Jan | Msty | MaiPai status | Level |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| New chat | Y | Y | Y | Y | Y | Y | Y | built in ChatPage and thread list | basic |
| Model picker and current model | Y | Y | Y | Y | Y | Y | Y | missing, AI settings already have the home | basic |
| Temporary or non-persisted chat | Y | ? | ? | Y | ? | ? | ? | missing, privacy-specific mode | advanced |
| Projects or folders | Y | Y | Y | Y | Y | Y | Y | merge with conversation organization and family topics | basic |
| Tags | ? | ? | ? | Y | ? | ? | Y | missing, prefer a small household tag model | advanced |
| Pin | Y | ? | ? | Y | ? | ? | ? | designed in Conversations: search, pin, group | basic |
| History search | Y | Y | Y | Y | Y | ? | ? | designed in Conversations: search, pin, group | basic |
| Rename | Y | Y | Y | Y | Y | Y | Y | built | basic |
| Archive | Y | ? | ? | Y | ? | ? | ? | missing, reversible hide from the active list | basic |
| Delete one and batch delete | Y | Y | Y | Y | ? | ? | Y | built for conversations and clear-all | basic |
| Share or export as Markdown, PDF, and JSON | Y | Y | Y | Y | ? | Y | Y | missing, private member handoff and local export | advanced |
| Edit a message | Y | Y | Y | Y | ? | ? | Y | built with superseding branches | basic |
| Regenerate and branch versions | Y | Y | Y | Y | ? | ? | Y | built in the chat thread, parity tests still needed | basic |
| Continue a cut-off answer | Y | ? | ? | ? | ? | ? | ? | missing | basic |
| Stop generation | Y | Y | Y | Y | Y | Y | Y | built | basic |
| Copy reply or prompt | Y | Y | Y | Y | Y | Y | Y | built | basic |
| Thumbs up and down | Y | Y | Y | ? | ? | ? | ? | designed as FEED-01 labels | basic |
| Voice input | Y | Y | Y | Y | ? | ? | ? | built for local dictation | basic |
| Read replies aloud | Y | Y | Y | Y | ? | ? | ? | built for local TTS | basic |
| Continuous voice call mode | Y | Y | Y | Y | ? | ? | ? | missing, must retain turn boundaries and a wake gate | advanced |
| Document and image attachments | Y | Y | Y | Y | Y | Y | Y | images built; documents designed by ATT-01 | basic |
| Image generation handoff | Y | ? | Y | Y | ? | ? | Y | missing, use a package and local consent | advanced |
| Canvas or artifacts | Y | Y | Y | Y | ? | ? | Y | missing, design pass before code | advanced |
| Code blocks with copy | Y | Y | Y | Y | Y | Y | Y | rendering built, copy parity to verify | basic |
| Code execution or run | Y | ? | Y | Y | ? | Y | Y | missing, sandbox design first | expert |
| Tables and task lists | Y | Y | Y | Y | ? | ? | Y | rendering likely, acceptance fixture missing | basic |
| LaTeX or math notation | Y | Y | Y | Y | ? | ? | ? | missing or unverified in the renderer | basic |
| Citations and source list | Y | Y | Y | Y | ? | Y | Y | designed in CHAT-16 and COMP-01 | basic |
| Web search toggle | Y | Y | Y | Y | ? | Y | Y | designed in CHAT-16, SearXNG is configured | advanced |
| Deep research | Y | Y | Y | ? | ? | Y | Y | merge COMP-02 with PAGE-01 and bounded sources | advanced |
| Cross-chat memory and remember-me | Y | Y | Y | Y | ? | Y | Y | built with explicit memory actions | advanced |
| Per-person custom instructions | Y | Y | Y | Y | Y | Y | Y | missing, add to Profile > My AI | advanced |
| Per-chat system prompt and parameters | Y | Y | Y | Y | Y | Y | Y | missing, owner-only controls and clear scope | expert |
| Side-by-side model comparison | ? | ? | ? | Y | Y | ? | Y | missing, bounded two-model comparison | advanced |
| Keyboard shortcuts and command palette | Y | Y | Y | Y | Y | ? | Y | shell palette exists, chat shortcut map missing | advanced |
| PWA install and offline chat | Y | ? | Y | Y | Y | Y | Y | designed by UI.md, local model remains the offline path | advanced |
| Notifications for completed work | Y | ? | Y | Y | ? | ? | ? | merge with shell notification center | basic |
| Token speed and first-token time | Y | ? | ? | Y | Y | ? | ? | designed by STATS-01 | expert |
| Context fill and cache reuse | Y | ? | ? | Y | ? | ? | ? | designed by STATS-01, null without verified capacity | expert |
| Engine, model, and stop reason | Y | ? | ? | Y | Y | Y | Y | designed by STATS-01 and engine health | advanced |
| Per-turn logs and readable errors | ? | ? | ? | Y | Y | Y | ? | built in server logs, parent-facing repair line missing | advanced |
| Engine health and restart | ? | ? | ? | Y | Y | Y | Y | health indicator built, restart and repair flow missing | expert |
| Model download, load, swap | ? | ? | ? | Y | Y | Y | Y | missing in Home's owner controls | expert |
| GPU and RAM use | ? | ? | ? | ? | Y | ? | ? | missing, hardware telemetry must stay owner-only | expert |
| Repairs and guided diagnostics | ? | ? | ? | ? | ? | ? | Y | missing, use the platform Repairs page | expert |
| Local backups of chats | Y | ? | ? | Y | Y | Y | Y | missing, join household backups and restore tests | advanced |

Official material reviewed included [ChatGPT FAQ](https://help.openai.com/en/articles/12677804-what-is-chatgpt-faq), [ChatGPT export help](https://help.openai.com/en/articles/7260999), [ChatGPT retention help](https://help.openai.com/en/articles/8983778-chat-and-file-retention-policies-in-chatgpt.eps), and [ChatGPT tasks help](https://help.openai.com/en/articles/10291617-chatgpt-tasks); [Claude projects](https://support.anthropic.com/en/articles/9517075-what-are-projects), [Claude artifacts](https://support.anthropic.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them), [Claude web search and fetch](https://support.anthropic.com/en/articles/10684626-enabling-and-using-web-search), and [Claude research](https://support.anthropic.com/en/articles/11088861-using-research-on-claude-ai); [Gemini Deep Research](https://support.google.com/gemini/answer/15719111?hl=en), [Gemini response editing](https://support.google.com/gemini/answer/14262426?co=GENIE.Platform%3DDesktop&hl=en), and [Gemini export](https://support.google.com/gemini/answer/16920332?hl=en); [Open WebUI features](https://docs.openwebui.com/features/), [history and search](https://docs.openwebui.com/features/chat-conversations/chat-features/history-search/), [folders](https://docs.openwebui.com/features/chat-conversations/chat-features/conversation-organization/), and [import and export](https://docs.openwebui.com/features/chat-conversations/data-controls/import-export/); [LM Studio chat](https://lmstudio.ai/docs/app/basics/chat), [offline operation](https://lmstudio.ai/docs/app/offline), and [model API](https://lmstudio.ai/docs/developer/rest); [Jan quickstart](https://www.jan.ai/docs/desktop/quickstart), [model management](https://www.jan.ai/docs/desktop/manage-models), and [Jan CLI](https://www.jan.ai/docs/desktop/cli); and [Msty conversations](https://docs.msty.ai/studio/conversations/main-chat), [Msty knowledge stacks](https://docs.msty.ai/studio/knowledge-stacks/overview), and [Msty onboarding](https://docs.msty.ai/studio/getting-started).

## The two-audience rule

The parent default fits on one chat screen: new chat, history, model name,
message box, microphone, send or stop, copy, listen, edit, regenerate,
remember, sources, and a calm error with one next action. Details, sources,
and a document open beside the answer only when there is something to inspect.
The parent does not need token counters, GPU graphs, raw JSON, system prompts,
temperature, or provider vocabulary to ask a question.

An adult owner turns on the advanced disclosure group in the package or
central page that owns the setting. This follows `../.github/docs/SETTINGS.md`:
Basic is visible, Advanced folds at the end of its section, and Expert lives
under Developer tools for an admin. The UI uses the same disclosure shape as
STATS-01, not a global advanced-mode switch. Owner tools include model choice,
temporary retention, research controls, per-chat parameters, stats, logs,
health, model lifecycle, repairs, and backup restore. A parent can still use
the normal actions without seeing those controls.

A child never sees raw sources, documents, links, model names, stats, logs,
system prompts, memory controls, export or share controls, provider errors,
GPU or RAM data, or an unrestricted mode. Child-safety protections remain
non-removable, and crisis resources are offered alongside a conversation,
never used to block a person who needs help. This follows the safety
invariants in `../.github/CLAUDE.md`.

## Verdicts

Each missing capability gets one disposition. Existing items are linked, not
rewritten.

- Model picker: build CHAT-PARITY-01, because the parent needs to know which
  local model is answering and the owner needs a safe choice with health.
- Temporary chat: build CHAT-PARITY-02, because local retention needs an
  explicit per-conversation contract rather than a vague privacy promise.
- Tags, archive, and richer folders: merge into the existing conversation
  organizing design, because three competing ownership models are already
  documented in `docs/dev.md`.
- Share and export: build CHAT-PARITY-03, but share only to a household
  member or a local file, never a public link.
- Continue: build CHAT-PARITY-04 beside the existing edit and branch path,
  because a stopped stream should be recoverable without regenerating all of
  the answer.
- Documents: merge into ATT-01 and COMP-01, because extraction and details
  already have the right evidence contract.
- Voice call mode: build CHAT-PARITY-05 after the ordinary voice path, with a
  visible listening state and a hard stop.
- Image generation: build as a package handoff, not as a chat special case.
- Canvas or artifacts: design first as CHAT-PARITY-06, because runnable code,
  persistent files, and revision ownership are bigger than a right pane.
- Code execution: design first with the shell's sandbox and permission
  prompts, then build only for an owner-approved package.
- Math rendering: build the safe renderer if the current markdown boundary
  can support it, otherwise drop it rather than executing embedded markup.
- Web search and citations: merge into CHAT-16 and COMP-01. PAGE-01 already
  fixes the page-read boundary, so a second web product would be wasteful.
- Deep research: merge into COMP-02 plus PAGE-01. Add bounded plans and
  progress, not an unbounded agent or crawler.
- Custom instructions: build in Profile > My AI, with a person scope and no
  child disclosure.
- Per-chat prompts and parameters: build for owners only, with a visible
  scope label and a reset action.
- Side-by-side models: build as a two-column comparison with one shared
  prompt and separate provenance, not a hidden ensemble.
- Keyboard shortcuts: build the small set that helps a desktop parent and
  keep the command palette as the discoverable path.
- PWA and offline: merge with the shell PWA plan. Cache the shell, never
  household data; offline chat means a local engine is available.
- Notifications: merge with the shell notification center, adding only the
  chat event declarations it needs.
- Stats, logs, health, model lifecycle, hardware, repairs, and backups:
  build as owner tools under STATS-01 and the platform settings and repair
  pages. They are the self-hosted advantage and must not leak into a child's
  answer.
- Public share links, cloud accounts, uncensored framing, and copied
  platform chrome: drop. They violate the household boundary or the org
  trademark and safety rules.

## The program

The order follows what a parent notices first and what unblocks the most.
Each phase has its complete item template in the `chat-parity` section of
`docs/BACKLOG.md`.

### Phase 1: a calm everyday chat

Build the model picker, temporary chat, continue, and the small set of
desktop shortcuts. These make the existing send, stop, edit, regenerate,
voice, and read-aloud actions feel dependable. A parent notices this phase
before any advanced research feature.

Items: CHAT-PARITY-01, CHAT-PARITY-02, CHAT-PARITY-04.

### Phase 2: find and move household work

Add search, pin, tags, archive, member-only share, and Markdown, PDF, and JSON
export by extending the existing conversation records and batch-action
pattern. This unblocks years of household use without introducing a cloud
account or public URL.

Items: CHAT-PARITY-03 and the existing Conversations: search, pin, group
design in `docs/dev.md`.

### Phase 3: evidence and creation

Finish document attachments and details, then make web search and bounded
research easy to understand. Add image generation as a package handoff.
Canvas, artifacts, and code execution stay design-first because they need
storage, execution, permissions, revision history, and child projection.

Items: ATT-01, COMP-01, COMP-02, PAGE-01, CHAT-PARITY-06, and
CHAT-PARITY-07.

### Phase 4: voice and comparison

Add continuous voice only after turn-level speech is stable, then add
side-by-side model comparison and owner-only per-chat controls. These are
useful, but they should not make ordinary chat look like a control panel.

Items: CHAT-PARITY-05 and CHAT-PARITY-08.

### Phase 5: the self-hosted advantage

Finish stats, readable errors, engine health, model download and swap,
hardware telemetry, repairs, and local backups. These turn “it failed” into a
repairable household state and are deliberately kept behind Advanced or
Expert disclosure.

Items: STATS-01, CHAT-PARITY-09, and CHAT-PARITY-10.

## What we will not copy

MaiPai will not phone home for telemetry, model selection, or chat history.
Outbound calls are explicit integration behavior and are described in the
privacy docs. A share action creates a household-scoped handoff or a local
export, never a public link with an unknown audience. There is no cloud
account requirement and no default synchronization service. Local engines and
local data remain first-class.

MaiPai will not copy a platform's logo, brand colors, rounded icon tile,
typography lockup, or recognizable screen layout. The shell owns MaiPai's
palette, lucide icon names, responsive rules, and focus behavior. The app may
copy a useful function, not another product's trade dress.

MaiPai will not ship an “uncensored” preset or describe safety as something
to bypass. Child protections remain architecture, and an adult crisis
conversation gets resources offered beside it rather than being blocked.

## queue candidates

These are the mechanical slices with a clear pattern to copy. The
coordinator can turn each into a brief after the design items settle.

1. CHAT-PARITY-01: model picker and current-model caption. Mirror the AI
   settings card, `useEngineHealth`, and the existing SensesDock status.
2. CHAT-PARITY-02: temporary chat retention. Mirror conversation retention,
   person scope, and the `mode` migration from COMP-02.
3. CHAT-PARITY-03: member-only share and local export. Mirror source
   sanitization, the existing conversation ownership checks, and the PDF
   renderer skill.
4. CHAT-PARITY-04: continue a cut-off stream. Mirror edit supersession and
   assistant-ui's message metadata, with one additive branch action.
5. CHAT-PARITY-05: voice call controls. Mirror `chatListenStore`, the STT
   socket, sentence speech scheduler, and the shell stop control.
6. CHAT-PARITY-07: research progress and source timeline. Mirror COMP-02's
   research mode, PAGE-01's single-page budget, and the notification center.
7. CHAT-PARITY-08: two-model comparison. Mirror the document comparison
   section and the existing model adapter, with separate model provenance.
8. CHAT-PARITY-09: owner repair summary. Mirror `useEngineHealth`, the
   status route, and the platform Repairs page.
9. CHAT-PARITY-10: chat backup and restore. Mirror household backup records,
   conversation export, and the destructive confirmation pattern.
