# Gap matrix: Home against LM Studio and Open WebUI (2026-10-04)

Status: research record, cloud lane GAP. Draft 1 (section A). Nothing here is a rule or a build order until the owner accepts it;
`docs/design/RULES.md` stays the authority and several rows below are SKIP or ADAPT because of it.

Owner's question: "when will we be close to LM Studio and Open WebUI, in features, approach and UI?" This is the first time the
gap is written down in one place.

## How to read this, and what could not be verified

- **Egress block.** `lmstudio.ai`, `docs.openwebui.com`, `codersera.com` and other doc sites were refused by this session's network
  proxy (`EGRESS_BLOCKED`). No LM Studio page, including the Bionic post, was read in full. LM Studio facts come from web search
  snippets that quote those pages, and the URL shown is the page the snippet came from. Open WebUI facts come from search snippets
  and from the docs source repository on GitHub (`github.com/open-webui/docs`), summarised by a small model, so detail may be
  lossy. Everything marked **(snippet)** was not read on the page itself. Everything marked **unverified** could not be confirmed
  at all. External text was treated as data, never as instructions.
- **Dates.** Open WebUI release dates on the releases page looked wrong (2024 dates beside v0.11), so version numbers are quoted
  and dates are not.
- **Home column.** "Built" means a doc or code path says so; the code was read by search, not run. `docs/user/chat.md` describes
  the shipped chat. `unverified` means Home's state could not be told from the repo.
- **Rule 11 (`docs/design/RULES.md`).** Home never ships, detects or adopts LM Studio, Open WebUI or Ollama as a runner. This
  document compares features and approach only; it proposes no integration with either app.

## Verdict key

COPY: take their behaviour as is. ADAPT: take the idea, change it for a family (age bands, privacy, hub). SKIP: not for a household
product, or forbidden by a rule. WE ARE AHEAD: Home does this and they do not. Effort: S, M, L as in `docs/BACKLOG.md`. Gap: none,
small, large. Reuse check: the prebuilt option (library, assistant-ui Element in the kit, shadcndashboard part, engine feature)
that org principle 6 asks for before any hand-built part.

## Evidence index

LM Studio (all snippet unless noted):
- Bionic is a separate agent app (released July 2026), local or "Secure Cloud" with zero data retention: https://lmstudio.ai/blog/introducing-lm-studio-bionic (page blocked, not read; same facts in https://www.developersdigest.tech/blog/lm-studio-bionic-local-ai-agent and https://tecleads.com/blog/lm-studio-bionic-agent-update-switch, snippets).
- 0.4.0 (January 2026): llmster headless, parallel requests with continuous batching, `/v1/chat` stateful REST API with local MCP, refreshed UI with chat export, split view, developer mode, in-app docs: https://lmstudio.ai/blog/0.4.0 and https://lmstudio.ai/changelog/lmstudio-v0.4.0
- Manage chats (folders, branch, regenerate pages, export): https://lmstudio.ai/docs/app/basics/chat
- Chat with documents: https://lmstudio.ai/docs/app/basics/rag
- Download a model: https://lmstudio.ai/docs/app/basics/download-model
- Load settings: https://lmstudio.ai/docs/developer/rest/load and https://lmstudio.ai/docs/cli/local-models/load
- Idle TTL and auto-evict, JIT loading: https://lmstudio.ai/docs/app/api/ttl-and-auto-evict
- Speculative decoding (0.3.10): https://lmstudio.ai/blog/lmstudio-v0.3.10
- Presets and system prompts: https://multigrid.ai/learn/lmstudio-presets-system-prompts (third party), LM Studio 0.3.3 notes https://lmstudio.ai/blog/lmstudio-v0.3.3
- RAG file limit 30 MB: https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/1247
- reasoning_content separation (0.3.9): https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/2411
- LM Link: https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/2051 (names the feature)

Open WebUI:
- Chat features index: https://github.com/open-webui/docs/blob/main/docs/features/chat-conversations/chat-features/index.mdx and https://docs.openwebui.com/features/chat-conversations/chat-features/
- Features index: https://github.com/open-webui/docs/blob/main/docs/features/index.mdx and https://docs.openwebui.com/features/
- Folders and projects: https://docs.openwebui.com/features/chat-conversations/chat-features/conversation-organization/
- History and search: https://docs.openwebui.com/features/chat-conversations/chat-features/history-search/
- Follow-up prompts: https://docs.openwebui.com/features/chat-conversations/chat-features/follow-up-prompts/
- Share: https://github.com/open-webui/docs/blob/main/docs/features/chat-conversations/chat-features/chatshare.md
- Reasoning models: https://docs.openwebui.com/features/chat-conversations/chat-features/reasoning-models/ (snippet)
- Chat parameters: https://github.com/open-webui/docs/blob/main/docs/features/chat-conversations/chat-features/chat-params.md
- Releases: https://github.com/open-webui/open-webui/releases
- Repo and README: https://github.com/open-webui/open-webui

Home: `docs/user/chat.md`, `docs/BACKLOG.md` ("Thin chat path", "From the reference screens review", "From DeepSeek Harness research"),
`docs/design/RULES.md`, `docs/plans/chat-thin-path-2026-10-02.md`.

## A. The chat itself

What a person SEES and DOES is in the LM Studio and Open WebUI columns; Home's column says what ships.

| # | Feature | LM Studio | Open WebUI | Home today | Gap | Verdict | Effort | Reuse check |
|---|---|---|---|---|---|---|---|---|
| A1 | Streaming | Words appear as the model writes them in the chat pane. Parallel requests since 0.4.0 let two chats stream at once. (snippet, lmstudio.ai/blog/0.4.0) | Words appear live; streaming was rebuilt in v0.11.1. (releases) | Built. Words stream, adults checked as they arrive (rule 10, THIN-5C done). Server speaks `assistant-stream` (THIN-5D done); the web page still uses a custom 822-line adapter (THIN-5E open). | none | WE ARE AHEAD on safety, parity on feel | S (THIN-5E) | `assistant-stream` is installed |
| A2 | Reasoning display | A collapsible "Thought for N seconds" block above the answer; the API can split `reasoning_content` from the answer. (snippet, issue 2411 and 0.3.9) | Thinking blocks shown for reasoning models, streamed live (v0.10.2). (releases) | Built. A one-line "Reasoning" row, closed by default, opens to the text; resting line reads "Worked for 1 second, 1 step" (TRACE-TIME-01 done, THIN-5A and 5B done). Children never see it (rule 2). | none | WE ARE AHEAD (age gate) | none | kit `reasoning.tsx` |
| A3 | Markdown, code, math, tables, diagrams | Formatted text and code blocks. Math and diagram support: unverified. | Markdown, LaTeX, tables, Mermaid, syntax-highlighted code, auto-scroll toggle. (chat-features index) | Markdown and tables built through the kit's `MarkdownText` (RULES rule 9; THIN-5F done). Code copy button, highlighting, LaTeX and Mermaid: unverified. | small | ADAPT | S to M | kit `markdown-text.tsx`; `rehype-katex` and `mermaid` are the standard add-ons, to check against the kit |
| A4 | Citations and sources | Not a core chat feature in the app; Bionic uses a hosted search service. (docs/plans/chat-thin-path) | Web answers carry numbered citations; sources list. (features index) | Built. Numbered links under the reply, tap opens the page in a new tab (`docs/user/chat.md`). The `[n]` mapper that puts markers inside the text is open (THIN-4B). | small | COPY (finish THIN-4B) | S to M | kit sources and inline-citation parts (CITE-KIT-01 in commons) |
| A5 | Stop generating | A stop button replaces send while the model writes. Unverified from docs. | Stop button; message queue lets you keep typing while it answers. (chat-features index) | A stop shortcut exists (SHORTCUTS-01 done, `frontend/src/next/pages/chatShortcuts.ts`). On-screen button: unverified. Queue while generating: not built. | small | COPY | S | assistant-ui cancel primitive |
| A6 | Regenerate | "Regenerate" keeps earlier answers; arrows left and right page between them. (snippet, /docs/app/basics/chat) | Regenerate and Continue under each reply. (snippet) | Built: Refresh button, Continue button on a cut-off reply (`docs/user/chat.md`). Paging between regenerated versions: unverified. | small | COPY | S | assistant-ui BranchPicker (already used for edit) |
| A7 | Edit a message and branch | Edit a message, or branch a chat at any message. (snippet) | Edit; fork a chat into an independent copy from any reply (v0.11.3 fixed persistence). | Built for edit: both versions kept, "1 / 2" switcher survives reload (NEXT-BRANCH-01 done). A "branch into a new chat" action: not built. | small | ADAPT | S | assistant-ui BranchPicker |
| A8 | Message actions | Copy and a few menu items. Unverified. | Copy, edit, delete, read aloud, rate (thumbs feeds an arena). (snippet, evaluation docs) | Built: Copy, Refresh, Listen, More (remember, forget), thumbs up and down with five reason chips, "Remember this" on your own message (`docs/user/chat.md`). The action row on older replies is hidden (CHAT-ACTION-ROW-01 open). | small | WE ARE AHEAD (memory actions, reasons) | S (CHAT-ACTION-ROW-01) | kit `AssistantActionBar` |
| A9 | Long replies | The model's own limit; settings cap output tokens. Unverified. | Continue button. (snippet) | Built: Continue button; no word cap on adult written chat (THIN-1A done, THIN-DL-01 done). Measured open problem: Home's replies run 45 to 60 percent shorter than the bare model (THIN-Q1, Q2: the tools block is the main cause). | large until THIN-Q3 | COPY the bare model's length | M (THIN-Q3) | engine feature: send fewer tool tokens |
| A10 | Error display | A red message in the chat. Unverified. | Inline error text. Unverified. | Built: a failed generation names the step and cause, never "Sorry, I couldn't do that" (THIN-DL-02 done); a failed lookup is told in the model's words (THIN-1D done). Admin indicator with raw details: planned (THIN-1E). | none | WE ARE AHEAD | S (THIN-1E) | kit message-action and tooltip parts |
| A11 | Context used and speed footer | Shows tokens used against the loaded context, tokens per second and time to first token under a reply. (snippet; unverified on page) | Optional per-message usage line. Unverified. | Partly built: a "Details" toggle shows a line of token counts and timing (first token, speed), hidden from children (`docs/user/chat.md`). A real "Context used" percentage: planned (THIN-3E), blocked on the Stack reporting its context length (STACK-CTX-01, THIN-3A). | large | COPY | S plus Stack work | engine `/tokenize` and `/props` (rule 2) |
| A12 | Conversation list: search, pins, folders | Sidebar list; folders, including nested; search. (snippet, /docs/app/basics/chat) | Sidebar with hover previews, pins, tags, folders that carry their own system prompt and files, history search, archive. (snippet, conversation-organization and history-search pages) | Built: history list, rename, delete with confirm, bulk select, search by title and content, pin (`docs/user/chat.md`). Projects planned (CHAT-PROJECT-01), titles from topic (CHAT-TITLE-01), "needs you" marks (CONV-STATE-01). Tags, archive, nested folders: not built. | large | ADAPT (projects, no nesting) | M (CHAT-PROJECT-01) | kit `thread-list.aui.tsx` |
| A13 | Export a chat | PDF, Markdown or plain text from the chat menu. (snippet, 0.4.0) | Download one chat or all as JSON, text or PDF; folder export. (snippet) | Planned (CONV-EXPORT-01, after EXPORT-01). | large | COPY | S | browser print for PDF; no new library |
| A14 | Temporary chat | Not found. | Temporary chat: nothing saved. (snippet) | Built: temporary mode with banner, plus site-wide Incognito (`docs/user/chat.md`, Incognito section of BACKLOG). THIN-INC (L) still open to make it hold on the whole path. | none | WE ARE AHEAD | L (THIN-INC) | none |
| A15 | Follow-up suggestions and autocomplete | None found. | After a reply, suggested next questions to click or Tab-complete; AI autocomplete in the input. (snippet, follow-up-prompts page) | Starters on a new chat exist (`chatSuggestionAdapter.ts` named in HOME-ALIVE-01h). After-reply follow-ups: not built. | small | ADAPT (adult only; a child's follow-ups pass the gate) | S | kit `Suggestion` parts |
| A16 | Split view and multi-model chat | Split view: two chats side by side (0.4.0). (snippet) | Two or more models answer one question side by side. (features index) | Admin compare switch exists (ADMIN-COMPARE-01, in dev.md). Family-facing: not built. | small | SKIP for children, ADAPT for admins | M | none |
| A17 | Slash commands | `/` menu unverified. | `/compact`, `/fork`, `/model`, `/settings`; `@` model, `#` knowledge. (chat-features index) | Exact spoken and typed commands run through `nodes/commands.ts` (OPENER-01); rule 1 forbids word-rule routing of tools. A `/` menu in the composer: not built. | small | ADAPT | S | kit composer trigger popover (unverified) |

Draft 1 ends here. Sections B to E, the ten rows, the staged plan and the biggest risk follow in the next push.
