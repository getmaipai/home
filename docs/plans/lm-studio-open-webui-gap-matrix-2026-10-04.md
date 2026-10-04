# Gap matrix: Home against LM Studio and Open WebUI (2026-10-04)

Status: research record, cloud lane GAP. Draft 2 (all sections). Nothing here is a rule or a build order until the owner accepts it;
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
| A3 | Markdown, code, math, tables, diagrams | Formatted text and code blocks. Math and diagram support: unverified. | Markdown, LaTeX, tables, Mermaid, syntax-highlighted code, auto-scroll toggle. (chat-features index) | Markdown and tables built through the kit's `MarkdownText` (RULES rule 9; THIN-5F done). BACKLOG CHAT-RICH-02 says shiki, mermaid and katex load lazily from the kit (kit source not checked out here, so code copy button, highlighting, LaTeX and Mermaid are unverified on screen). | small | ADAPT | S to M | kit `markdown-text.tsx`; `rehype-katex` and `mermaid` are the standard add-ons, to check against the kit |
| A4 | Citations and sources | Not a core chat feature in the app; Bionic uses a hosted search service. (docs/plans/chat-thin-path) | Web answers carry numbered citations; sources list. (features index) | Built. Numbered links under the reply, tap opens the page in a new tab (`docs/user/chat.md`). The `[n]` mapper that puts markers inside the text is open (THIN-4B). | small | COPY (finish THIN-4B) | S to M | kit sources and inline-citation parts (CITE-KIT-01 in commons) |
| A5 | Stop generating | A stop button replaces send while the model writes. Unverified from docs. | Stop button; message queue lets you keep typing while it answers. (chat-features index) | A stop shortcut exists (SHORTCUTS-01 done, `frontend/src/next/pages/chatShortcuts.ts`). On-screen button: unverified. Queue while generating: not built. | small | COPY | S | assistant-ui cancel primitive |
| A6 | Regenerate | "Regenerate" keeps earlier answers; arrows left and right page between them. (snippet, /docs/app/basics/chat) | Regenerate and Continue under each reply. (snippet) | Built: Refresh button, Continue button on a cut-off reply (`docs/user/chat.md`). Paging between regenerated versions: unverified. | small | COPY | S | assistant-ui BranchPicker (already used for edit) |
| A7 | Edit a message and branch | Edit a message, or branch a chat at any message. (snippet) | Edit; fork a chat into an independent copy from any reply (v0.11.3 fixed persistence). | Built for edit: both versions kept, "1 / 2" switcher survives reload (NEXT-BRANCH-01 done). A "branch into a new chat" action: not built. | small | ADAPT | S | assistant-ui BranchPicker |
| A8 | Message actions | Copy and a few menu items. Unverified. | Copy, edit, delete, read aloud, rate (thumbs feeds an arena). (snippet, evaluation docs) | Built: Copy, Refresh, Listen, More (remember, forget), thumbs up and down with five reason chips, "Remember this" on your own message (`docs/user/chat.md`). Share is not built (SHARE-CONV-01 planned). The action row on older replies is hidden (CHAT-ACTION-ROW-01 open). | small | WE ARE AHEAD (memory actions, reasons) | S (CHAT-ACTION-ROW-01) | kit `AssistantActionBar` |
| A9 | Long replies | The model's own limit; settings cap output tokens. Unverified. | Continue button. (snippet) | Built: Continue button; no word cap on adult written chat (THIN-1A done, THIN-DL-01 done). Measured open problem: Home's replies run 45 to 60 percent shorter than the bare model (THIN-Q1, Q2: the tools block is the main cause). | large until THIN-Q3 | COPY the bare model's length | M (THIN-Q3) | engine feature: send fewer tool tokens |
| A10 | Error display | A red message in the chat. Unverified. | Inline error text. Unverified. | Built: a failed generation names the step and cause, never "Sorry, I couldn't do that" (THIN-DL-02 done); a failed lookup is told in the model's words (THIN-1D done). Admin indicator with raw details: planned (THIN-1E). | none | WE ARE AHEAD | S (THIN-1E) | kit message-action and tooltip parts |
| A11 | Context used and speed footer | Shows tokens used against the loaded context, tokens per second and time to first token under a reply. (snippet; unverified on page) | Optional per-message usage line. Unverified. | Partly built: a "Details" toggle shows a line of token counts and timing (first token, speed), hidden from children (`docs/user/chat.md`). A real "Context used" percentage: planned (THIN-3E), blocked on the Stack reporting its context length (STACK-CTX-01, THIN-3A). | large | COPY | S plus Stack work | engine `/tokenize` and `/props` (rule 2) |
| A12 | Conversation list: search, pins, folders | Sidebar list; folders, including nested; search. (snippet, /docs/app/basics/chat) | Sidebar with hover previews, pins, tags, folders that carry their own system prompt and files, history search, archive. (snippet, conversation-organization and history-search pages) | Built: history list, rename, delete with confirm, bulk select, search by title and content, pin (`docs/user/chat.md`). Projects planned (CHAT-PROJECT-01), titles from topic (CHAT-TITLE-01), "needs you" marks (CONV-STATE-01). Archive planned (CONV-ARCHIVE-01; the adapter's `archive()` throws). Tags, nested folders: not built. | large | ADAPT (projects, no nesting) | M (CHAT-PROJECT-01) | kit `thread-list.aui.tsx` |
| A13 | Export a chat | PDF, Markdown or plain text from the chat menu. (snippet, 0.4.0) | Download one chat or all as JSON, text or PDF; folder export. (snippet) | Planned (CONV-EXPORT-01, after EXPORT-01). | large | COPY | S | browser print for PDF; no new library |
| A14 | Temporary chat | Not found. | Temporary chat: nothing saved. (snippet) | Built: temporary mode with banner, plus site-wide Incognito (`docs/user/chat.md`, Incognito section of BACKLOG). THIN-INC (L) still open to make it hold on the whole path. | none | WE ARE AHEAD | L (THIN-INC) | none |
| A15 | Follow-up suggestions and autocomplete | None found. | After a reply, suggested next questions to click or Tab-complete; AI autocomplete in the input. (snippet, follow-up-prompts page) | Starters on a new chat exist (`chatSuggestionAdapter.ts` named in HOME-ALIVE-01h). After-reply follow-ups: the adapter comment says the kit covers it, unverified in Home. | small | ADAPT (adult only; a child's follow-ups pass the gate) | S | kit `Suggestion` parts |
| A16 | Split view and multi-model chat | Split view: two chats side by side (0.4.0). (snippet) | Two or more models answer one question side by side. (features index) | Admin compare switch exists (ADMIN-COMPARE-01, in dev.md). Family-facing: not built. | small | SKIP for children, ADAPT for admins | M | none |
| A17 | Slash commands | `/` menu unverified. | `/compact`, `/fork`, `/model`, `/settings`; `@` model, `#` knowledge. (chat-features index) | Exact spoken and typed commands run through `nodes/commands.ts` (OPENER-01); rule 1 forbids word-rule routing of tools. A `/` menu in the composer: not built. | small | ADAPT | S | kit composer trigger popover (unverified) |


## B. Models and engine

Approach difference first. LM Studio and Open WebUI are model workbenches: the person picks any model, any quantisation and any
setting. Home is a household product on a tested Stack: the household gets one proven choice per role (RULES rule 3, 8 and 11).
So most "COPY" rows here become an admin-only view or a Stack default, not a family control.

| # | Feature | LM Studio | Open WebUI | Home today | Gap | Verdict | Effort | Reuse check |
|---|---|---|---|---|---|---|---|---|
| B1 | Model library and download | A Discover tab searches Hugging Face, shows size and quantisation variants, and a download bar; a fit warning says if it will not run. (snippet, /docs/app/basics/download-model) | Pulls models from a connected runner (Ollama) by name; no library of its own. (README) | Models page with a fit verdict per model (yes, slow, no, unknown) in plain words, a Hugging Face link check, a signed catalog of tested models (`apps/settings/ModelsSection.tsx`, FIT-WORDS-01 done, MODELS-LAYOUT-01 done). Free browsing of Hugging Face: not built, and rule 11 and the catalog design keep it out. Live catalog source and browse: planned (tools design K7.1 to K7.3, STORE-01). | small | WE ARE AHEAD on fit, ADAPT on browse | M (K7) | `shadcndashboard` data table and cards; signed index code exists |
| B2 | Switching and loading a model | Pick from a top-bar menu, a load bar fills; JIT loading on first API call, idle TTL (60 min default) and auto-evict. (snippet, /docs/app/api/ttl-and-auto-evict) | Model dropdown in the chat; `@` to pick a model in a message. (chat-features index) | Built: model picker beside the chat title (children see a label only), Engines page with start, stop, restart (`NextEnginesPage.tsx`). Starter model then swap: planned (STACK-START-01, SETUP-START-01). Idle unload: the Stack's memory governor (unverified detail). | small | ADAPT | M (STACK-START-01) | llama-server router mode or llama-swap, decided large and low value in the thin-path record |
| B3 | Per-model settings | Gear on a model card in My Models sets default context size, GPU layers, flash attention, KV cache. (snippet, tecnobits and herdingbots guides) | Workspace Models wrap a base model with parameters, system prompt, tools, knowledge. (features index) | Not built as a screen. Rule 3 says sampling comes from the model's catalog record; THIN-6A and SAMPLING-SPEC-01 planned. | large | ADAPT: admin-only advanced panel, never a family control | M (THIN-6A, then new GAP-ADMIN-PARAMS-01) | none; kit form parts |
| B4 | Presets | A preset is a named bundle of system prompt and sampling values, shareable and publishable. (snippet, /docs/cli presets and multigrid) | A custom model is the preset, with access control by user or group. | Companions are the nearest thing (buddy, pal, tutor packages) and carry voice adapters (RULES rule 14). Presets as a feature: not built. | small | WE ARE AHEAD for a family (companions), SKIP the rest | none | none |
| B5 | Sampling controls | A sidebar with temperature, top-p, top-k, min-p, repeat penalty, max tokens. (snippet) | A Controls panel per chat, per account and per model; confirmed by name: `top_k` 0 to 1000. (chat-params.md) | Not built, by rule 3: one tested set per model, a global override needs a measured reply-quality bench. | large (by design) | SKIP for family; ADAPT as admin "developer mode" later | S after THIN-6A | LM Studio's own "developer mode" idea (0.4.0) |
| B6 | Context length control | A slider on load with a memory estimate (`--estimate-only` in the CLI). (snippet, /docs/cli/local-models/load) | A `num_ctx` style parameter in Controls. Unverified. | No control. Rule 4: the window is the model's real context. Today's window is 4 newest turns plus 1,200 estimated tokens and the live engine launches with 4,096 (thin-path record, 2026-10-02); THIN-3A, 3B, 3C and STACK-CTX-01 planned. | large | ADAPT: show it read-only, size it automatically | M plus Stack | engine `/tokenize` and reported `n_ctx` |
| B7 | Speed and memory dashboard | RAM and VRAM use while a model is loaded, tokens per second under a reply. (snippet) | Admin analytics of message volume and tokens. (features index) | Built: Performance page (queues, routes, turns by engine, disk and hardware), status page, memory governor in the Stack (`NextPerformancePage.tsx`). | none | WE ARE AHEAD | none | kit chart wrappers |
| B8 | Several models at once | Load several models, parallel requests with continuous batching since 0.4.0. (snippet, /blog/0.4.0) | Several models answer one question side by side. | Stack serves a role per engine (chat, embed, vision, speech) under one memory governor. Slots per engine: `--parallel` is named in THIN-3A; real use unverified. | small | ADAPT | M | llama-server `--parallel` |
| B9 | Quantisation choice | Every variant listed with its size; the person picks. (snippet) | Whatever the runner has. | One pinned quantisation per catalog entry (`modelCatalog.ts`); no picker. | small | SKIP for family; the fit verdict is the answer | none | none |
| B10 | GPU and Apple silicon use | llama.cpp with a GPU offload slider; MLX engine on Mac; llmster headless. (snippet) | Via the runner. | Stack runs llama.cpp on Apple silicon (measured on M4 Pro 24 GB, engine b10797, thin-path record); CUDA devices read in `hardware.ts`; MLX planned (ENGINE-HOST-04, ENGINE-HOST-03 for Metal). | small | ADAPT | M (ENGINE-HOST-04) | MLX engine |
| B11 | Speculative decoding | A draft-model picker in the sidebar since 0.3.10: faster tokens, same answers. (snippet, /blog/lmstudio-v0.3.10) | Not found. | Not built, unverified in the Stack. | small | ADAPT (measure first) | S bench, M build | llama-server draft model flags |
| B12 | Local API for other apps | A developer tab with a local server, `/v1/chat/completions` and the stateful `/v1/chat`. (snippet, 0.4.0) | Admin API keys, OpenAI-style endpoints. (API endpoints page) | Built: `routes/openai.ts` (THIN-7B), as spoken turns. | none | none | none | none |
| B13 | Use my machine from another device | LM Link: link machines over a private mesh and use models from a phone app. (snippet, bug tracker issue 2051) | Browser from any device on the network. | The hub is the server and the web app is a PWA; the robot and satellites link to it. Remote outside the house: unverified (see "Portability and the link" in BACKLOG). | small | WE ARE AHEAD inside the house | M | Tailscale-style mesh is the prebuilt answer; check against PRIVACY.md |

## C. Tools and knowledge

| # | Feature | LM Studio | Open WebUI | Home today | Gap | Verdict | Effort | Reuse check |
|---|---|---|---|---|---|---|---|---|
| C1 | Web search | Not in the base chat app; Bionic uses a hosted LM Studio search service. (docs/plans/chat-thin-path; Bionic snippet) | About 28 providers (SearXNG, Brave, Tavily, Google, Kagi and more), agentic search, save results to knowledge. (docs/features/chat-conversations/web-search/providers) | Built: the model decides, SearXNG owned by the Stack, no key needed, optional hosted key for adults only (THIN-2A, THIN-4A, THIN-4H done). Fewer providers by design. | none | WE ARE AHEAD (child floor, keyless) | none | SearXNG |
| C2 | Reading a page | Bionic reads files and pages (snippet). | A URL-fetch tool extracts a site's text. | Built: `read_page` (PAGE-01) and page reading in search (THIN-4A) with budget and floor (THIN-4C, 4D). | none | WE ARE AHEAD | none | Readability, linkedom (installed) |
| C3 | MCP and tool servers | Local MCP via the API and app config; tool calls ask for permission. (snippet, 0.4.0) | Native MCP over HTTP, MCP via the `mcpo` proxy, OpenAPI tool servers, Python tools, Skills, human-in-the-loop approval (v0.11.1). (docs/features/extensibility/mcp and tool-servers) | Not built: no MCP client in the backend. Design accepted: tools declared by packages (T1, T2), confirmation for physical tools (T4), one retry round (T5), MCP client manager with Home Assistant first (H1 to H4), signed catalog (K1 to K7); nothing built (`docs/plans/tools-ecosystem-design-2026-10-03.md`). 9 of 35 bundled packages are offered to the model today (same note, section 1). | large | ADAPT (admin-vetted, local or LAN only, minors Tier 0 only) | L | official TypeScript MCP SDK 1.32 (design H2) |
| C4 | Code interpreter | Bionic runs and edits code and files for the person. (snippet) | Run Python blocks in the browser (Pyodide), model-driven code interpreter (Pyodide or Jupyter), Open Terminal recommended; artifacts render HTML and SVG. (docs code-execution page) | Not built. | large | SKIP for children, ADAPT for adults later | L | Pyodide in the browser (prebuilt, no server sandbox) |
| C5 | Chat with documents | Drag a PDF, docx or text file into the chat; the model reads it; LocalDocs uses an embedding model; 30 MB file limit. (snippet, /docs/app/basics/rag, issue 1247) | Knowledge bases in a Workspace, hybrid keyword and vector search with rerank, many vector stores and extraction engines. (features index) | Attach a PDF or office file with the "+" button; stays on the hub, deleted with the chat (COMPOSER-DOC-ATTACH-01 done). Preview pane planned (ATTACH-PREVIEW-01). Searching a household's own files across chats: no code found, unverified; reference libraries (Kiwix) and knowledge sources are done or in their own section. | small for one file, large for a library | ADAPT | M | embedding role already in the Stack; a vector store is the missing part |
| C6 | Memory | Not found in the chat app. | Settings, Personalization, Memory: add, edit, delete; with native tool calling the model saves and corrects memories itself. (docs memory.mdx) | Built and deeper: per person, a judge grounds each fact in the speaker's words, an age projection withholds records from children, "forget that" works, "Memory updated" chip, memory page (`apps/memory/PersonMemories.tsx`, THIN-0A, 0B). | none | WE ARE AHEAD | none | none |
| C7 | Image input | Attach an image to a vision model. (snippet) | Upload an image for analysis. | Attach path and a vision route exist (`localImageAttachmentAdapter.ts`, `routes/vision.ts`); a model that reads photos is planned (VISION-01). | large | COPY | M (VISION-01) | engine multimodal projector in llama-server |
| C8 | Image generation | Not in the chat app. | GPT-Image, Gemini, ComfyUI, AUTOMATIC1111, with prompt-based editing. (snippet, features index) | Planned (IMAGE-01, IMAGE-02, CHAT-MEDIA-01). | large | ADAPT (child filter on output) | L | ComfyUI-style local backend |
| C9 | Voice in and out | Bionic: speak and it transcribes locally (Voxtral, snippet). | Speech to text, text to speech, hands-free voice and video calls. (README) | Built and wider: dictation with waveform, a live voice session with an orb, read-aloud, Wyoming voice satellites, a robot, companion voices (`liveVoiceSession.tsx`, `routes/stt.ts`, `routes/tts.ts`, THIN-7A done). Wake word experimental. | none | WE ARE AHEAD | none | none |
| C10 | Canvas and artifacts | Bionic makes documents, slides and spreadsheets. (snippet) | Artifacts: HTML, SVG, JS and Mermaid render live in a side panel; Notes. | Built in part: a document pane beside the chat on the chat's own markdown (`NextChatPage.tsx` `CanvasSplit`, THIN-5F done), produced-file cards with a menu. PDF and picture pane planned (PANE-FILE-01); typed documents (DOC-BLOCKS-01, DOC-RENDER-01). Live HTML or code artifacts: not built. | small | ADAPT | M | kit `canvas-split.tsx` |
| C11 | Prompts library | Presets hold prompts. (snippet) | Workspace prompts opened by `/` commands; skills. (features index) | Starter chips on a new chat; no library or slash menu. | small | ADAPT: admin-curated family prompts | S | kit suggestion parts |
| C12 | Custom assistants and agents | Bionic is an agent app; presets for chat. (snippet) | Workspace Models (system prompt, tools, knowledge); sub-agents (v0.11.0). | Companions (buddy, pal, tutor) with per-request voice adapters; background projects through `start_project` (THIN rules, BACKLOG "Projects"); COMP-03 and COMP-04 planned. | small | WE ARE AHEAD (companions, voice) | M (COMP-03) | none |
| C13 | Automations and reminders | Not found. | Automations (scheduled prompts), timers, calendar, webhook notifications. (features index, README) | Reminders and timers built (`remind`, `timer` packages, `scheduler.ts`); scheduled prompts planned (ROUTINES-01). | small | COPY (ROUTINES-01) | M | `scheduler.ts` |
| C14 | Notes workspace | Not found. | Notes: a rich editor outside any chat, AI rewrite in place, attach to a chat. | Planned (NOTES-01). | large | SKIP for now | M | none |
| C15 | Ratings and an evaluation arena | Not found. | Thumbs feed a blind arena with an Elo leaderboard. | Thumbs with five reason chips, labels used by the hub (`docs/user/chat.md`). No arena. | none | SKIP the arena | none | none |

## D. Multi-user and admin

| # | Feature | LM Studio | Open WebUI | Home today | Gap | Verdict | Effort | Reuse check |
|---|---|---|---|---|---|---|---|---|
| D1 | Accounts | None: a single-user desktop app. | Accounts, first user is admin, pending approval. (RBAC docs) | Built: people, passkeys, TOTP, sign-in page (`routes/passkeys.ts`, `routes/totp.ts`, `NextSignInPage.tsx`). | none | WE ARE AHEAD | none | none |
| D2 | Roles | None. | Admin, User, Pending. | Owner, admin and adult, teen, child bands (`ageBand.ts`). | none | WE ARE AHEAD | none | none |
| D3 | Permissions and groups | None. | Groups with additive permission flags and per-resource access to models, knowledge and tools. (docs rbac/groups, permissions) | Per-person permissions and grants (`permissions.ts`, `routes/grants.ts`, APPS-VIS-01); groups: unverified. | small | ADAPT | S | none |
| D4 | SSO, LDAP, SCIM | None. | OIDC SSO, LDAP, SCIM 2.0, API keys. (docs authentication-access) | Not built. | large | SKIP: a household signs in with passkeys | L if ever | an OIDC library |
| D5 | Child safety and age bands | None. | None found. | Built: age and surface gates outrank every rule, output gate, per-person safesearch, crisis resources, parent relays (RULES rules 0 and 10; THIN-0B, 0E, 0L, 0M). | none | WE ARE AHEAD | none | none |
| D6 | Audit | None. | Request audit log, off by default, written to `audit.log` (snippet, docs security page); other sources did not confirm it. | No audit log. Per-turn trace exists (`turnMachine/trace.ts`); TRACE-VIEW-01 planned for one admin view. Owners and admins can read members' conversations for oversight (`docs/user/chat.md`). | small | ADAPT | M | none |
| D7 | Backups and restore | None needed (local files). | Operator backs up the database and storage; no one-click backup found. | Built: Backups page, restore route; BACKUP-GATE-01 planned (`NextBackupsPage.tsx`, `routes/backups.ts`). | none | WE ARE AHEAD | S (BACKUP-GATE-01) | none |
| D8 | Usage and analytics | Tokens per second in the app. | Analytics dashboard: message volume, tokens, costs per model. (features index) | Performance page and dashboard cards for the hub; no per-person usage page. | small | ADAPT (a parent's view, no cost) | S | kit charts |
| D9 | Share a chat | Export only. | Share a link: private, signed-in users or anyone; a dashboard lists and revokes links. (chatshare.md) | Planned (SHARE-CONV-01, SHARE-LINK-02 to 04). | large | ADAPT (adult only, opt-in) | M | none |
| D10 | Shared rooms | None. | Channels: rooms with `@model`, threads, reactions. | Planned (CHANNELS-01, L, design pass first). | large | ADAPT (age bands per speaker) | L | none |
| D11 | Updates and rollback | In-app auto update. | `docker pull` or pip. | Updates page, signed releases, rollback (`NextUpdatesPage.tsx`, UPDATES.md). | none | WE ARE AHEAD | none | none |
| D12 | Privacy stance | Local; Bionic offers a "Secure Cloud" with zero data retention (snippet). | Self-hosted; hosted search and model keys are the operator's choice. | Privacy page, outbound switches, Incognito, hosted search key off by default and never for a minor (RULES rule 7; `NextPrivacyPage.tsx`). | none | WE ARE AHEAD | S (PRIVACY-SWITCH-01) | none |
| D13 | Licence | Closed-source app, free to use (unverified here). | Open WebUI License keeps "Open WebUI" branding; older code under earlier licences. (repo README, terms unread) | Sole ownership rule; this document proposes copying no code from either. | none | n/a | none | none |

## E. Look and feel

| # | Feature | LM Studio | Open WebUI | Home today | Gap | Verdict | Effort | Reuse check |
|---|---|---|---|---|---|---|---|---|
| E1 | Layout | A desktop app with a left icon rail (chat, developer, models, discover, from general knowledge, unverified here), model bar at top, settings sidebar on the right. | A ChatGPT-style page: sidebar of chats on the left, one chat in the middle, a Controls panel on the right; v0.11.0 redesign. (releases) | Built: a rail (Home, Chat, Family, Privacy, Settings in `shell/nav.ts`), chat list, canvas pane, folded rail by default (SHELL-FOLD-01). Built from shadcndashboard and assistant-ui. | none | WE ARE AHEAD in structure for a family | none | shadcndashboard |
| E2 | Themes | Light and dark; app themes. Unverified. | Themes and custom fonts (v0.11.3); full system unverified. | Light and dark toggle, two looks (`ThemeToggle.tsx`, `useNextAppearance.ts`). | small | COPY | S | kit tokens |
| E3 | Phone and PWA | Desktop only; a separate "Locally" phone app reaches a linked machine. (snippet, issue 2051) | Installable PWA, swipe navigation, expandable message box. (README, chat-features index) | PWA with a service worker and manifest, phone tab bar, 48 px targets, 390 px captures judged (`vite.config.ts`, `sw.ts`, `nextChatTouchTargets.css`). | none | WE ARE AHEAD of LM Studio, parity with Open WebUI | none | VitePWA |
| E4 | Onboarding | First run offers a starter model download. Unverified on page. | Create the first admin account. | Setup wizard (`routes/setup.ts`); chat within minutes on a starter model planned (SETUP-START-01, STACK-START-01); "Getting started" card planned (HOME-ALIVE-01g). | small | COPY (starter model) | M | none |
| E5 | Empty states | A blank chat with a model prompt. | Greeting and suggestions. | A greeting plus "Runs on your own hub. Your chats stay at home." (CHAT-WELCOME-01 done), Library empty text (LIB-EMPTY-01 done). | none | none | none | none |
| E6 | Keyboard shortcuts | A shortcut list in the app. Unverified. | Rebindable shortcuts. (chat-features index) | Cmd+K search, Cmd+B menu, Cmd+/ reference, new chat, focus composer, stop (`chatShortcuts.ts`, SHORTCUTS-01 done). | small | COPY if asked | S | none |
| E7 | Accessibility | Unverified. | Menu and dropdown fixes in v0.11.3. (releases) | Aria in about 46 files, 48 px touch targets, an axe script (`bun run a11y`); reduced motion in Home's own CSS: not found, unverified for the kit. | small | COPY | S | axe-core (in use) |
| E8 | Help inside the app | In-app docs since 0.4.0. (snippet) | Docs site. | Docs in `docs/user/`; in-app help: unverified. | small | ADAPT | S | none |
| E9 | Simple view and advanced view | "Developer mode" reveals advanced options (0.4.0). (snippet) | Admin Panel versus user settings. | Admin versus member views by role; a child sees plain labels. | none | WE ARE AHEAD | none | none |

## The ten rows a family would notice first, in order

Ranked by what a parent or child sees in the first week, using the owner's own evidence (replies shorter and slower than a bare model,
`docs/BACKLOG.md` THIN-Q1).

1. **A9 Reply length and time to first text.** Home's adult replies run 45 to 60 percent shorter and start 2.7 s late against 0.2 s on the bare model; the tools block is the main cause (THIN-Q1, THIN-Q2). Every other row is judged after this one.
2. **A12 Chat titles, projects, archive.** LM Studio and Open WebUI show a tidy list with topic titles and folders; Home titles a chat by its first message (CHAT-TITLE-01, CHAT-PROJECT-01, CONV-ARCHIVE-01).
3. **C7 Picture input.** "What is this?" with a photo works everywhere else (VISION-01).
4. **B6 and A11 Context and the "memory of the chat".** Long chats forget because the window is 4 turns and 1,200 estimated tokens; no "context used" figure (THIN-3A to 3E, STACK-CTX-01).
5. **A3 Code and math that look right, with a copy button.** Homework and recipes; kit support is claimed in BACKLOG but not seen on screen (new GAP-RENDER-01).
6. **A4 Inline source numbers.** Sources list exists; markers inside the sentence do not yet (THIN-4B).
7. **C8 Making pictures.** Open WebUI offers it; Home has nothing yet (IMAGE-01).
8. **A5, A6, A7 Stop, flip between regenerated answers, branch into a new chat.** Each is one small button the family expects (GAP-STOP-01, GAP-FORK-01).
9. **D9 Share a chat.** A link to send to a grandparent (SHARE-CONV-01).
10. **A15 Follow-up suggestion chips.** Cheap and visible; absent after replies (GAP-FOLLOWUP-01).

## Staged plan: close the gap

Item ids marked **new** do not exist in `docs/BACKLOG.md` yet; the rest do.

**Stage 1, about 2 weeks: make the answer feel as good as the bare model, finish what is half done.**
- THIN-Q3 (shrink or conditionally offer the tools block; needs the architect check against rule 1) and THIN-Q4 (rerun arm B on a quiet machine).
- THIN-5E (web chat on `assistant-stream`), THIN-4B (`[n]` mapper and kit sources), CHAT-TITLE-01, CHAT-ACTION-ROW-01, CONV-EXPORT-01, CONV-ARCHIVE-01.
- STACK-CTX-01 with THIN-3A, 3B, 3C, 3E: the real context length, token-counted window, "Context used" figure.
- **New** GAP-RENDER-01 (S): confirm on screen, then fix, copy button, highlighting, LaTeX, Mermaid in a reply; reuse the kit parts.
- **New** GAP-STOP-01 (S): a visible stop button and a message queue while a reply streams; assistant-ui cancel primitive.
- **New** GAP-FORK-01 (S): "branch into a new chat" and paging between regenerated answers; BranchPicker is already in use.
- **New** GAP-FOLLOWUP-01 (S): after-reply suggestion chips for adults (the kit's `ThreadFollowupSuggestions`, unverified).

**Stage 2, about 6 weeks: the features a family compares.**
- CHAT-PROJECT-01, SHARE-CONV-01, VISION-01 (image input), ATTACH-PREVIEW-01, THIN-6A (per-model sampling) and **new** GAP-ADMIN-PARAMS-01 (M): an admin-only "developer mode" showing each model's source of values, context and quantisation, read-only first.
- TOOLS-PROGRAM build order steps 1 to 4 from the tools design: bench, `model_tool` block, failure kind and confirmation, MCP client with Home Assistant first. Stack: STACK-START-01 and SETUP-START-01 so a new household chats in minutes.
- **New** GAP-RAG-01 (M): ask across a household's own documents (embedding role exists; vector store and a Library hook are the work). Check first what `docs/BACKLOG.md` "Knowledge sources" already covers before cutting it.
- **New** GAP-SPEC-01 (S, bench only): speculative decoding on the Studio, using llama-server's draft-model flags.
- HOME-ALIVE-01b to 01h, which make the first screen read like a product.

**Stage 3, later.**
- IMAGE-01 and IMAGE-02 (image generation, child filter on output), **new** GAP-CODE-01 (L, adult-only Pyodide code interpreter), K7.4 to K7.8 (kill switch, tiers, storefront), ROUTINES-01, COMP-03 and COMP-04, CHANNELS-01, NOTES-01, ENGINE-HOST-04 (MLX), TRACE-VIEW-01 with **new** GAP-AUDIT-01 (M, an admin audit view), CHAT-PARITY-08 (compare for admins), **new** GAP-OIDC-01 (L, only if a household asks).

Honest answer to "when will we be close": the chat, list, sources, pictures-in and share rows can match by the end of stage 2, about 8 weeks of work
if the lanes run as listed. The power-user surface (sampling sliders, any Hugging Face model, MCP from any source, a code sandbox for
everyone) stays unmatched on purpose, and that is where Home chooses to be different, not behind.

## The single biggest risk to parity

**The model and window ceiling, not the UI.** Everything above can land and Home will still read as less capable if the answer comes from a
Qwen3-8B Q4_K_M with a 4,096-token launch and a 4-turn window while the people comparing run 20B to 30B-class models in LM Studio (a
third-party review runs Gemma 4 26B at 103 tokens per second on a 64 GB M4 Max, snippet, https://medium.com/macoclock/lm-studio-bionic-on-a-64-gb-m4-max-a-fully-local-ai-agent-with-gemma-4-26b-at-103-tok-s-f3fd1bee2b0f). The Stack
does not yet report its context length (STACK-CTX-01, THIN-3A open), so Home cannot size the window or show "Context used". The unbuilt
catalog (K7) is the second risk: it limits which stronger model a household can add safely. What to do first: measure a larger tested
model on the Mac Studio tier with CHAT-AB-01 (rule 13) before any UI work is blamed for the gap, and land STACK-CTX-01 in stage 1.
