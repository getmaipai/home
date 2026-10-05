# Design rules

The hard rules for MaiPai Home. This file is the authority: a change,
a backlog item or a design note that breaks a rule here is rejected,
whatever older document it cites. `docs/dev.md` and `docs/plans/` are
history and reasoning, never the authority.

Only the owner changes a rule. A rule change is made here, names the
design record that argues for it, and that record lists what it
supersedes.

## Chat turn

Record: [the thin chat path](../plans/chat-thin-path-2026-10-02.md),
accepted 2026-10-02.

Governs: backend/src/lib/turnMachine/**, backend/src/lib/turnEngine.ts, backend/src/lib/llm.ts, backend/src/lib/composer.ts, backend/src/lib/conversationHistory.ts, backend/src/lib/packageHost.ts, backend/src/lib/wellFormed.ts, backend/src/lib/register.ts, backend/src/lib/modelCatalog.ts, backend/src/routes/turn.ts, backend/packages/websearch/**, frontend/src/apps/chat/**, frontend/src/next/pages/NextChatPage.tsx

Each rule overrides any earlier design, plan or backlog item that says
otherwise. A change that breaks one is a defect, whatever older document
it cites.

**0. Age and surface gates outrank every rule below.** Nothing here
loosens a protection for a child or teen, and nothing here changes how
a spoken turn is shaped. Where a rule below would do either, this rule
wins.

1. **The model decides, not a word rule.** No regex, word list or
   classifier decides whether a message needs a search or a tool. Tools
   are offered with `tool_choice: "auto"`. What stays deterministic:
   the safety floor on input and output, the credential catch, consent
   words, the household-name gate on search arguments, the crisis,
   temporary-mode and grounding refusals, and exact commands, forget
   among them. The turn signal is kept for the plan line, memory-judge
   eligibility, the wire `signal` event and spoken-cue suppression; it
   no longer decides a search. Memory reaches the model as injected
   context, never as a tool.
2. **The engine's native feature is the implementation.** Chat
   templates, the reasoning split, tool-call parsing, JSON-schema
   output and token counts come from the engine. Home never re-wraps,
   re-parses or estimates what the engine already returns. Token counts
   are taken on the rendered messages, after credential redaction and
   note substitution. A minor's request sets thinking off, and any
   reasoning the engine returns anyway is dropped at the engine client.
   An adult's reasoning streams live as its own part, under the same
   check-as-it-arrives gate as the answer (rule 10).
3. **Each model runs on its own settings.** Sampling comes from that
   model's catalog record, with the source of the values named. A
   global override needs a reply-quality measurement on written chat
   and a repetition measurement on spoken companion turns, not a
   tool-calling bench alone.
4. **The window is the model's real context.** History is sized from
   the engine's reported context length with real token counts, per
   slot. The chat engine is never launched with a smaller context than
   the machine can hold. The window reserves room for the stable
   prefix, the tools block, the memory block, the reply ceiling and the
   thinking allowance. Trimming must not break the prompt-cache prefix
   on every turn. The rolling summary and episode recall are defined on
   the same boundary, and persisted and temporary conversations use one
   window builder. A conversation never fails because it is long. When
   history passes the window, old tool results are cleared first, then
   the oldest exchanges are folded into the rolling summary in blocks
   at checkpoints, never one turn at a time, and no exchange leaves the
   window before its fold is stored. The summary is data, passes the
   person's output floor before it is stored, and never holds crisis,
   consent or age state. A spoken turn never tells the person a
   conversation is too long. Only on written chat, and only when the
   stable prefix, the summary at its cap and the current message cannot
   fit together, the reply offers a new chat that carries the summary
   forward. (Owner-approved 2026-10-05; design note
   DESIGN-context-compaction-2026-10-05.)
5. **No length cap on adult written chat.** No instruction tells the
   model how many words to write, and `max_tokens` is a ceiling, not a
   target. A child's or teen's chat, any spoken turn (robot, pod, phone,
   or any client that flags the turn as spoken) and glance surfaces keep
   their own limits.
6. **A failed tool never fails the answer.** If search or any tool is
   unavailable, the model answers from what it knows and says in its own
   words, fresh each time and in the voice and register of the person's
   band and surface, that the lookup did not happen; there is no fixed or
   stored wording for it, for anyone (owner's rule 2026-10-03, replacing
   the fixed per-band line). It is told only the kind of failure (down,
   timed out, found nothing), never the raw error text, never invents a
   fact to fill the gap, and passes the same output gate as any reply.
   Every person gets the same reply; an admin also sees a small error
   indicator on that reply that opens the raw details (the tool, the
   error, the timing). Raw details never reach a non-admin, a child or
   the model. Policy refusals (consent, crisis, temporary mode,
   ungrounded arguments) are not tool failures and keep their own
   replies. A robot with no hub and no network answers the same way.
7. **Search gives the model pages, not snippets.** Result pages are
   fetched and their text is given with numbered sources; the
   instruction is to ground the answer in them and cite by number. Page
   text is data, never instructions. For a child or teen, page text
   reaches the model only after it passes the same deterministic floor,
   with that person's safesearch applied to the fetch. Fetches keep a
   stated request budget: a cap on pages per search and the existing
   per-host pace. Search works with no key and no account. A hosted
   search provider is an optional key, off by default, stored as a
   write-only secret, never used for a child's or teen's query, shown
   with what it sends, and added to the privacy page in the same commit.
8. **Every model gets every feature its template is proven to
   support.** Nothing is gated on one catalog model id. Age gates still
   win: a minor never gets model choice or thinking, and a model with no
   measured record keeps the no-tools fail-safe for minors.
9. **Shipped parts only.** The web chat's stream is `assistant-stream`;
   reasoning, sources, citations and markdown are the kit's and
   assistant-ui's parts; the canvas uses the chat's renderer. The
   existing NDJSON events (`turn_meta`, `signal`, `delta`, `status`,
   `spoken_cue`, `done`, `error` with crisis resources) stay available
   to the robot, the satellites, Go and other clients, with additions
   only. The stored reply is the concatenation of released text,
   whatever the wire. Custom code in the chat path needs a named gap in
   this record first. Named gaps today: sentence-gated speech scheduling
   with the spoken cue, the `[n]` citation mapper, the output gate, the
   prose tool-call fallback.
   **Chat UI is assistant-ui Elements, never hand-written (owner's rule
   2026-10-04).** Every piece of the chat screen (message parts, actions,
   composer, model chip, reasoning and tool disclosures, sources, lists,
   search, panes, charts, tables, errors, empty states, voice) is an
   Element from the kit's `src/elements` (assistant-ui's library, vendored
   by the `commons` ui package), used as it ships and wired to our data.
   Before writing any chat component the author looks the job up in
   `frontend/src/dev/elements-adoption.json`; if an Element does it, the
   hand-written version is a defect, found in review and deleted in the
   same change that wires the Element (tests re-pointed, never weakened).
   A real gap is named in this record first. `bun run elements:status`
   prints how many Elements are implemented; a lint keeps the list of
   hand-built chat components from growing.
10. **The safety gate stays, and its strictness follows the person.**
    The output gate is the safety floor and is not a formatting step.
    For a child, and for every spoken turn, every sentence is checked
    before it is released, and no setting loosens that. For an adult's
    written chat, text streams as it is generated and the gate checks it
    as it arrives; released text is never retracted. For a teen, an
    admin setting picks one of those two (owner's ruling, 2026-10-02).
11. **Only our own tested Stack components run the models.** Home
    talks to the engines the Stack installs, pins and tests, and to
    nothing else. No LM Studio, Open WebUI, Ollama or other outside
    runner is required, shipped, detected or adopted, including one an
    owner already runs (owner's ruling, 2026-10-02; STACK-ADOPT-01 is
    dropped). The reason is the same as rule 2's: an outside runner's
    template, sampling and context settings are unknown and unproven.
    Supporting services are different. By default the Stack installs,
    configures and owns everything chat needs, search included, so a
    new household sets up nothing. A service that speaks a standard
    interface and holds no model (SearXNG, a self-hosted page reader)
    may instead be an instance the owner already runs, on this machine
    or another, chosen by one setting; Home checks it at save time and
    shows its health like any other service.
12. **One path, ported before deleted.** When the thin path lands, the
    old `turnEngine.ts` path and every stage the rules above retire are
    deleted, not kept behind a setting. No stage deletes anything until
    each behaviour it holds is ported or retired in writing. The port
    list today: forget, the withheld signal and relay to an adult,
    episode recall, summary scheduling, judge status at insert and the
    turn lease, the parent notifier and stream-refusal types, robot
    speaker evidence, per-companion reply pools, server-side speech
    text, the exact-command router, the privacy-mode writers, and the
    OpenAI-style and Wyoming callers (rewired as spoken turns).
13. **Measured, not argued.** CHAT-AB-01 is the acceptance bench and
    stays out of `check.sh`. On adult written chat, Home's replies are
    not shorter, plainer or slower to first text than the bare model's
    beyond what the safety gate costs. It also carries a child turn, a
    spoken turn with a first-word bar of 3 seconds, the two 9-turn
    memory scripts, safety rows, and a companion-voice row. It reruns
    after each stage, against one engine.
14. **Companion voice is a per-request mechanism, never prompt prose.**
    Voice adapters are chosen per request and keyed by base model; the
    rules above are compatible with a companion chosen per turn.

## App shell

Record: the owner's rule of 2026-10-04 (his words are the record: "that
column collapses to a rail; everything to the right of it should look and
feel like the native app we are emulating").

Governs: frontend/src/next/**, frontend/src/apps/**

S1. **The main navigation is permanent.** The column that lists the apps
    (Home, Chat, Library, Family, Settings and Help today; more apps later)
    is present on every page at every width and collapses to an icon rail.
    It is never removed, hidden or merged into an app, and app content
    (thread lists, filters, sub-navigation) never lives inside it.
S2. **Each app area emulates its native app.** Everything to the right of
    the rail looks and feels like the app it copies, with that app's own
    layout intact: chat is ChatGPT's layout, including its own history
    sidebar, slim title bar, centered message column and compact composer;
    video is YouTube's; and so on. Only the rail is ours. Parts are kit
    Elements and shipped primitives, restyled by tokens only (rule 9).
S3. **A test holds the rail.** A test fails when the main navigation does
    not render on an app page at desktop and mobile widths, as the full
    column or as the rail with accessible labels.
