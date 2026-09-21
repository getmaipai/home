# Artifacts beside the conversation: shadcn.io AI against what Home has (2026-09-21)

The owner asked whether Home's chat should replace or augment its
chat components with shadcn.io's AI components, above all their
Artifact pieces, for a ChatGPT-style experience: the conversation
stays in the chat pane, a document, code or generated artifact opens
in a side panel beside it, a click on an artifact in the conversation
opens it, the panel closes without losing the conversation, the
conversation continues while it stays open, the model creates and
updates it across turns, Markdown renders, streaming works, versions
are kept, and the panel is Home's own, not a second application. This
is the evaluation; no code changes were made.

One correction of premise first: Home does not use
`miskibin/chat-components` and never did. Nothing in either repo
references it. The chat is built on **assistant-ui** (`@assistant-ui/react`
0.15.18 with `@assistant-ui/react-markdown`), which is itself the
shadcn-style, copy-the-source component set for AI chat, held in the
kit as `commons/ui/src/assistant-ui/*.aui.tsx`.

## 1. Current architecture

- **Runtime and thread**: assistant-ui's `useLocalRuntime` with Home's
  own adapters, every one in `home/frontend/src/apps/chat/`:
  `chatModelAdapter.ts` (468 lines; streams from Home's own
  `/api/chat` turn engine, not the Vercel AI SDK), `chatHistoryAdapter.ts`
  (loaded conversations), `chatThreadListAdapter.ts` (the thread list
  with pin, batch delete, the admin's person picker, server search,
  landed in HOME-UI-02e), `chatSuggestionAdapter.ts`, the attachment
  adapter, the dictation adapter, the memory chip and its state, the
  feedback adapter, citations, the child band, the senses dock.
  `ChatPage.tsx` (593 lines) composes them; `thread.aui.tsx` (974
  lines, Home-owned) is the thread and composer.
- **Kit pieces used** (commons `ui/src/assistant-ui/`): `thread-list.aui`,
  `markdown-text` (react-markdown + remark-gfm, the message renderer),
  `attachment.aui`, `reasoning.aui`, `tool-fallback.aui`,
  `tool-group.aui`, `follow-up-suggestions.aui`, `tooltip-icon-button`.
- **The existing document pane**: `chatDocumentPane.tsx` (237 lines).
  A reply whose turn carries a `TurnArtifact` (spec
  `turn-artifact.schema.json`: id, turn_id, revision, evidence_version,
  section, sources, provenance, hlc) shows a "Details" handle in the
  message's action bar; clicking it opens the kit's `DetailPane` beside
  the thread on desktop (a bottom `Sheet` on the phone) with the
  artifact's structured section (a lookup result, a film, person or
  place card, a procedure, a comparison) and its sources. The pane is
  Home's own primitive, the one every things page uses. The
  conversation continues with it open; it closes without touching the
  thread.
- **What the artifact is today**: a structured, evidence-bound record
  the turn engine writes (COMP-01's "documents"), revisioned by
  `revision` and `evidence_version`. It is not a free-form document or
  code the model authors and edits over turns. That capability is the
  open design item **CHAT-PARITY-06, "artifacts and canvas design
  pass"** (L, design first: artifact types, storage and retention,
  runtimes, permissions, revision identity, import and export, the
  child projection, a threat model).

## 2. shadcn.io AI, what is relevant

shadcn.io's AI set (50 components in eight families) is distributed
the shadcn way: TSX copied into the project by the CLI, owned and
editable, no runtime package of its own. Baseline React 19 and
Tailwind v4 (both are what Home runs; React 18 and Tailwind v3 also
work). Its stated dependencies are `react-markdown`, `streamdown`,
`shiki`, `lucide-react`, `clsx`, `tailwind-merge`; the tool-use
family is "built on top of the AI SDK's `ai` and `@ai-sdk/react`" but
"renders fine without it", and the set as a whole "accepts plain
React children so any shape can be adapted" to other runtimes.

Relevant to the ask:

- **Artifact** (`Artifact`, `ArtifactHeader`, `ArtifactActions`,
  `ArtifactContent`): a framed container with a header row, an
  actions slot (copy, download) and a content area. Presentation
  only. Its own page says it does not include state management, the
  side-panel layout, versions or history, or streaming.
- **Code Block** (shiki highlighting) and **Response** (streamdown, a
  Markdown renderer tuned for streaming text: renders partial
  Markdown without flashing raw syntax).
- **Canvas**, **Web Preview**, **Image**, **Commit**: more artifact
  bodies; Web Preview is an iframe frame; Canvas is a node-graph
  surface (unrelated to a document canvas).
- **AI Message With Artifacts** (a block, not a component): a demo
  layout of a message column on the left and an artifact panel on
  the right with tabbed Code, Preview and Diagram views, version
  tracking as a badge and buttons, `motion/react` animation, built on
  the AI SDK Message components. It is demo state: the panel's
  open/close, the version list and the streaming are not wired to a
  runtime; it shows the composition, not the behavior.

## 3. Gaps

What shadcn.io AI does not provide, against what Home has or needs:

- **Everything behavioral.** Panel state (which artifact is open,
  from which turn), the runtime link (which message owns which
  artifact, when the model updates it), streaming into the artifact
  rather than into the message, versions and their storage, the
  phone form (a sheet), the close-without-losing-the-thread rule.
  Home already has all of that for its structured artifacts in
  `chatDocumentPane.tsx` and the turn engine; for free-form artifacts
  it is CHAT-PARITY-06's design, which no component set can supply.
- **The thread itself.** shadcn.io's Message and Conversation are a
  parallel chat surface to assistant-ui's Thread; adopting them means
  two chat stacks or a rewrite of `thread.aui.tsx`, the adapters, the
  memory chip, citations, the child band, the senses dock, dictation,
  attachments, the thread-list functions just landed. Nothing in the
  ask needs any of that replaced.
- **Design system.** Their pieces are styled shadcn defaults; Home's
  are the kit's tokens, the Studio and Calm looks, the DetailPane's
  pinned header, the phone Sheet. A copied Artifact would be restyled
  to the kit on arrival, at which point it is a `Card` with a header
  row, which the kit has.
- **Provider assumptions.** The tool-use, agent and sandbox families
  assume AI SDK message part shapes; Home's turn engine has its own
  wire (`RoleRequest`, the turn envelope). Not a blocker for
  Artifact/Code Block/Response, which take children.
- **Markdown**: Home's `markdown-text` is react-markdown + remark-gfm,
  the same base as theirs; the one thing they add is `streamdown` for
  flicker-free streaming of partial Markdown, which matters for a
  document that streams into a panel.
- **Code highlighting**: Home has none in messages today; `shiki` is
  the piece worth taking when code artifacts arrive.

## 4. Migration impact, by option

- **Full replacement** (their Conversation/Message/Prompt Input for
  assistant-ui): touches every file in `home/frontend/src/apps/chat/`
  (about 30 files, 2,400 lines in the five largest alone), the kit's
  eight `.aui.tsx` files, and every chat test; adds `ai`,
  `@ai-sdk/react` (if the tool family is taken), `streamdown`, `shiki`,
  `motion`; removes nothing the product needs; forfeits the
  thread-list, memory, citation and child-band work. Weeks. Not
  justified by anything in the ask.
- **Partial adoption** (Artifact frame, Code Block, Response): three
  copied files restyled to the kit inside `commons/ui/src/blocks/chat/`,
  two dependencies (`streamdown`, `shiki`; `shiki` is 1 to 3 MB of
  grammars, loaded lazily per language, acceptable behind a code
  artifact only), no runtime coupling, no AI SDK. Days, and only once
  CHAT-PARITY-06 says what an artifact is.
- **Stay**: zero change now; the Details pane keeps serving the
  structured artifacts.

## 5. Recommended architecture

**Stay on assistant-ui; do not replace the chat.** Build the
ChatGPT-style artifact panel as Home's own feature on the pane Home
already has, and take from shadcn.io exactly two leaf pieces when
that feature is built: `streamdown` (through a `StreamingMarkdown`
block in the kit, beside `markdown-text`) for the document body, and
`shiki` (through a `CodeBlock` block) for code bodies. The Artifact
frame itself is the kit's `DetailPane` (desktop) and `Sheet` (phone)
with a header carrying the artifact's title, kind badge, version
switcher and the copy/download actions, which is the reference's own
"floating right pane, pinned header and action rail, body scrolls"
pattern from the design doc.

Why: the hard parts of the ask (state, runtime link, streaming into
the panel, versions, storage, the child projection, the threat model)
are exactly what shadcn.io does not ship and what CHAT-PARITY-06
exists to design; the easy parts (a frame, Markdown, code colors)
are one afternoon on top of primitives the kit has. Adopting their
chat stack for a frame would trade a working, tested chat for a demo
layout.

## 6. Implementation plan, in order (nothing starts without the owner's go)

1. **CHAT-PARITY-06, the design pass** (this note is its first half;
   the second half decides): artifact kinds (markdown document, code
   file, and later HTML preview), the record (extend `turn-artifact`
   with a `kind` and a `body` section, or a new `artifact` record
   with `turn_id`, `kind`, `title`, `body`, `version`, `parent_version`,
   `created_by`), storage (SQLite table beside conversations, bodies
   size-capped, retention with the conversation), versions (one row
   per model edit, the current pointer on the conversation), the
   child projection (a child sees the artifact only if the turn was
   theirs and the safety pass allowed it), export (download as .md or
   the code file), the threat model (no execution, no external
   fetches from an HTML preview, sandboxed iframe if previews ship).
   Owner reviews; then items 2 to 6 are briefed.
2. **Spec**: the record and its fixtures in commons `spec/` (a
   spec-v tag), Home pins it.
3. **Turn engine**: a tool the model may call to create or update an
   artifact (title, kind, body, or a patch against the current
   version), streamed as its own event on the turn stream
   (`artifact.delta`, `artifact.done`) beside the reply text; the
   message carries `artifactId` and `version` in its metadata the
   way `document_available` is carried today.
4. **Kit** (commons, one ui-v tag): `StreamingMarkdown` on
   `streamdown`, `CodeBlock` on `shiki` with lazy grammars, an
   `ArtifactPane` block composed from `DetailPane` (header: kind
   badge, title, version switcher, copy, download, close; body:
   `StreamingMarkdown` or `CodeBlock`; phone: `Sheet`), styled by the
   tokens in both looks.
5. **Home chat**: `chatArtifactPane.tsx` beside `chatDocumentPane.tsx`
   (one pane slot in `ChatPage`, either a document or an artifact
   open at a time), an artifact chip in the message's action bar
   (title, kind, "updated" when a later turn changed it), click
   opens, close keeps the thread, the thread keeps working with the
   pane open, the pane follows a streaming update live; the version
   switcher reads the stored versions.
6. **Tests and captures**: adapter tests for the stream events, pane
   state tests (open, close, continue, update, version switch), the
   1440 and 390 captures in both looks and themes opened and judged
   against the reference's detail-pane pattern.
7. **Later**: HTML preview (sandboxed), export to a package or a
   file, the robot's projection.

## 7. Risk and rollback

- The current chat stays as it is throughout; nothing is removed.
  The artifact pane is additive (a new file beside the document
  pane, a new event on the stream, a new record); each step is one
  commit on its own gate.
- Rollback at any step is reverting that commit; the two new
  dependencies (`streamdown`, `shiki`) arrive in the kit tag that
  introduces them and leave with it. No step changes the message
  renderer, so a rollback never touches existing conversations.
- The one risk worth naming: `streamdown` is young and moves fast;
  pin it, wrap it in the kit's own block so Home imports the block,
  never the package, and the swap back to react-markdown is one file.

## Verdict

Not a migration. Stay on assistant-ui, design the artifact record and
its panel as Home's own (CHAT-PARITY-06), and take two leaf pieces
from shadcn.io when that lands. The owner reviews this note; nothing
in the codebase changes until the design's second half is approved.
