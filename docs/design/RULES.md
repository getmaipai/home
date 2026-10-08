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

Governs: backend/src/lib/turnMachine/**, backend/src/lib/turnEngine.ts, backend/src/lib/llm.ts, backend/src/lib/composer.ts, backend/src/lib/conversationHistory.ts, backend/src/lib/packageHost.ts, backend/src/lib/wellFormed.ts, backend/src/lib/register.ts, backend/src/lib/modelCatalog.ts, backend/src/routes/turn.ts, backend/packages/websearch/**, frontend/src/apps/chat/**, frontend/src/shell/pages/ChatPage.tsx

Each rule overrides any earlier design, plan or backlog item that says
otherwise. A change that breaks one is a defect, whatever older document
it cites.

**0. Age and surface gates outrank every rule below.** Nothing here
loosens a protection for a child or teen, and nothing here changes how
a spoken turn is shaped. Where a rule below would do either, this rule
wins.

1. **The model decides, not a word rule.** No regex, word list or
   classifier reads open-ended wording to decide whether a message needs
   a search or a tool. Tools are offered with `tool_choice: "auto"`,
   and the model decides when the person has not asked. When the person
   asks for a search explicitly (the search control on the composer, or
   an exact search command matched whole, never a word inside a sentence),
   code honors it: the engine's query writer writes the query, and the
   call passes the same policy checks as any model-proposed call (role,
   consent, temporary mode, crisis, the household-name gate, a minor's
   safesearch). An explicit request never reaches a tool the person's
   role or the household's settings do not allow. A learned or embedding
   signal about search need may run in shadow, logged as a number with no
   text; it changes no turn until a held-out bench row shows a paired gain
   and this rule is amended again. What stays deterministic: the safety
   floor on input and output, the credential catch, consent words, the
   household-name gate on search arguments, the crisis, temporary-mode
   and grounding refusals, and exact commands, forget among them. The
   turn signal is kept for the plan line, memory-judge eligibility, the
   wire `signal` event and spoken-cue suppression; it no longer decides
   a search. Memory reaches the model as injected context, never as a
   tool. The offered tool set is a measured budget: the base set is the
   ten on the record; a conditional set (pictures, a link reader, media
   tools on a file turn) is offered only on the turn that earns it, each
   with its own bench row, never more than 16 on a turn.
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
   tool-calling bench alone. A generation that offers tools is a tool
   decision as well as a reply. Its sampling is accepted only with a
   tool-decision measurement (evidence recall and false searches on the
   CHAT-AB-01 fresh set, at least 3 repeats) beside the reply-quality
   and repetition measurements above. The global `CHAT_SAMPLING` moves
   into per-model catalog fields.
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
   Every person gets the same reply; an admin sees the raw-error
   indicator only on their own replies, and it opens raw details (the
   tool, the error, the timing). Raw details never reach a non-admin or
   the model. Policy refusals (consent, crisis, temporary mode,
   ungrounded arguments) are not tool failures and keep their own
   replies. A robot with no hub and no network answers the same way.
   Fixed clips that play when no model can speak (an engine outage line,
   a robot's alarm, carry or pairing line) are not replies; each is
   reviewed by a person against the child floor when written and listed
   on the privacy page.
6a. **Logs and admin visibility protect each person's activity.** No log,
    trace, status or admin page carries text a person produced, a title,
    URL, filename, argument, a stable person or record id next to an
    activity, or a hash of any of these. A log line is a typed event from
    the registry. An admin troubleshoots from component health, error
    codes with their plain-words message, timings and counts that name no
    person; details reach an admin only through a report the affected
    person previews and sends.
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
   One small block-validation checker may validate answer blocks from
   tools before the kit draws them; all drawing stays in shipped kit
   Elements, never hand-written (owner-approved 2026-10-08; GENUI-02).
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
   **Kit Elements as they ship: no overrides, no wrappers (owner's rule
   2026-10-06, his words: "create whatever rules you need to prevent
   this in the future").** This holds for every kit Element in Home's
   frontend, chat or not: anything imported from the kit's
   `src/elements/**`, `src/ui/**` or the vendored
   `src/dashboard/components/ui/**`, and each of its parts.
   (a) No `className` (or `class`) on a kit Element or one of its parts
   that changes its shape, border, radius, shadow, background, padding,
   margin, size or layout (flex, grid, gap, alignment, position, inset).
   The look changes only through the tokens in the kit's `tokens.css`
   and the Element's own props and variants. Classes that only place
   the Element in its parent (`flex-1`, `shrink-0`, `self-*`, `order-*`,
   `col-span-*`) and text color or type tokens are allowed; a color token
   used as a background or border (`bg-card`, `border-border`) is still
   a background or border override. If the look is
   not reachable that way, the fix is an additive prop or variant in
   `commons`, pinned by a new tag, never an override in Home. The same
   holds in Home's stylesheets: no CSS rule whose selector targets a kit
   part (a kit `data-slot`, an `aui-*` class or another kit class) may
   set shape, size, layout, spacing, border, shadow, background or
   display properties (`width`, `height`, `border-radius`, `display`,
   including `display: contents`, `grid-template-areas`, `gap`,
   `padding` and the like). Home CSS aimed at a kit part only defines
   design tokens (CSS custom properties) the kit itself reads; a compact composer, for
   example, is a kit variant Home selects, never a block of Home CSS.
   (b) No Home component whose job is to wrap, compose or re-skin a kit
   Element (a wrapper): one whose root is a kit Element, one that draws
   its own box, row or overlay around an Element, or one named like a
   wrapper (`*Panel`, `*Card`, `*Wrapper`) in a file that imports one.
   Home renders the Element where it is used and passes it data,
   handlers and copy; Home provides routes, data and copy. The only
   allowed exceptions are the entries of the shrink-only allowlist
   `frontend/src/dev/kit-wrapper-baseline.json`, each with its reason;
   an entry is never added, only removed. One exception (owner-approved
   2026-10-06): a function registered as a render in `TOOL_BINDINGS` or
   `DATA_BINDINGS` of `elementBindings.ts` that returns only the kit
   Element (or null), draws no DOM of its own, passes no className, and
   only maps the part's data and Home's handlers and copy to the
   Element's props is the Element's use site, not a wrapper; an inline
   anonymous arrow function written to avoid the lint is forbidden.
   (c) A prop, slot or variant an Element lacks is a kit change first,
   landed in `commons` before the Home change that uses it.
   ELEMENTS-LINT-02 (`kit-classname-override-baseline.json` for
   `className`, `kit-css-override-baseline.json` for Home CSS) and
   ELEMENTS-LINT-03 (`kit-wrapper-baseline.json`), run by the frontend
   suite in `scripts/check.sh`, fail on each new override or wrapper they
   can detect statically (ELEMENTS-LINT-03 also fails an inline function
   registered as a render in `elementBindings.ts`); they are a floor, and review and the architect
   catch the rest. Both baselines only shrink, and the Elements slices
   empty them.
9b. **Outside chat, shadcn/ui is the only component source (owner's rule,
    2026-10-06).** Every non-chat surface is built from the kit's one
    primitive set, `@maipai/ui/src/ui/*` (shadcn/ui's own registry, Base UI
    flavor, `base-nova` style, pinned by shadcn version), and the kit
    blocks in `@maipai/ui/src/blocks/*` and `src/dashboard/*` that compose
    it. Chat stays rule 9 (assistant-ui Elements). Nothing else renders UI
    in Home: no other component library, no direct import of `@base-ui/*`,
    `radix-ui`, `sonner`, `cmdk`, `vaul` or `recharts`, no raw `<button>`,
    `<input>`, `<select>`, `<textarea>`, `<table>` or `<dialog>`, and no
    Home element that draws its own border, radius, shadow or background.
    A part the set lacks is added to the kit from the shadcn registry
    first, or from Kibo UI for a named gap, with a row in
    `docs/design/UI-DECISIONS.md`; anything else needs a ledger row before
    a line is written. The lints UI-LINT-01 to 03 enforce this with
    shrink-only baselines when the consolidation lands.
    **Changing the look and feel** (owner, 2026-10-06), for shadcn/ui
    parts and the chat Elements alike, in this order. First, design
    tokens: set a token value (colour, radius, spacing, type size) the part
    already reads; Home sets token values in one place and never touches
    the part. Second, a kit variant or prop: when tokens cannot reach the
    look, add an additive variant, size or slot to the part in the
    `commons` kit (default unchanged, tested, new kit tag, Home pin bump);
    never edit a copied registry file by hand outside this path. Third, a
    slot: content Home supplies fills the slot the part already exposes.
    Not allowed: className or CSS in Home that sets shape, size, spacing,
    border, shadow, background or layout on a kit part; wrapper
    components; a second copy of a part. Anything that cannot follow this
    needs a row in `docs/design/ELEMENTS-DECISIONS.md` with its reason,
    who decided and the slice that removes it. Upstream upgrades are taken
    only in the monthly sweep (`shadcn add --diff`).
10. **The safety gate stays, and its strictness follows the person.**
    The output gate is the safety floor and is not a formatting step.
    For a child, and for every spoken turn, every sentence is checked
    before it is released, and no setting loosens that. For an adult's
    written chat, text streams as it is generated and the gate checks it
    as it arrives; released text is never retracted. For a teen, an
    admin setting picks one of those two (owner's ruling, 2026-10-02).
    Those fixed clips (rule 6) are gated at authoring time, not at
    playback.
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
    after each stage, against one engine. A claim about search decisions
    cites the fresh set's held-out split with a recorded search stand-in,
    at least 3 repeats and paired 95% intervals. A single run of 30 items
    is a regression check, not evidence for a rate.
14. **Companion voice is a per-request mechanism, never prompt prose.**
    Voice adapters are chosen per request and keyed by base model; the
    rules above are compatible with a companion chosen per turn.

## App shell

Record: the owner's rule of 2026-10-04 (his words are the record: "that
column collapses to a rail; everything to the right of it should look and
feel like the native app we are emulating"), and his chat shell layout spec of
2026-10-06, which makes the rail a permanent 56 px icon rail that never
expands (S1 below). Owner-approved 2026-10-06: the app settings design
(S1 profile menu and More menu, S4) and the mobile design pass (S1 phone
drawer, S2 phone layout, S3 widths); they supersede the earlier S1
profile-menu list and the "every width" wording.

Governs: frontend/src/shell/**, frontend/src/apps/**, backend/src/settings/**, backend/src/wire.ts

S1. **The main navigation is permanent.** The column that lists the apps
    (Home, Chat, Library, Family today; more apps later) is present on
    every page from 640 px wide as a fixed 56 px icon rail. It never
    expands, has no labels or fold control, and names each icon through
    its accessible name and a tooltip. On a phone (narrower than 640, or
    a touch screen under 500 tall) there is no rail. The same entries
    live in one slide-over drawer, the kit's sidebar in its off-canvas
    mode, drawn from the same app list as the rail. A round menu button
    floating at the top left of every app's root screen opens it (and a
    swipe from the left edge in the installed app). Top to bottom the
    drawer holds the brand and Search, the apps with their status dots,
    the selected app's own sections, and at its foot the profile control
    and the selected app's Settings gear. The menu button and the edge
    swipe step aside only while an immersive screen is open, and that
    screen carries its own Close. The rail holds the brand, global
    Search, the app icons, a More button above the profile control, and,
    pinned at its bottom, the profile control whose menu holds
    Notifications, System status, Settings, Home settings (owner and
    admin only), Help and Log out; Incognito is in the rail's More menu
    (owner-approved 2026-10-06). It is never removed, hidden or merged
    into an app, and app content (thread lists, filters, sub-navigation)
    never lives inside it. On a phone the drawer holds the selected app's
    own sections below the apps; that is the only place app content meets
    the main navigation, and it never holds another app's.
S2. **Each app area emulates its native app.** Everything to the right of
    the rail looks and feels like the app it copies, with that app's own
    layout intact: chat is ChatGPT's layout, including its own history
    sidebar, slim title bar, centered message column and compact composer;
    video is YouTube's; and so on. Only the rail is ours. Parts are kit
    Elements and shipped primitives, restyled by tokens only (rule 9).
    On every width, the selected app owns the screen beside the main
    navigation and copies its native app's phone layout and behaviour as
    well as its desktop one: its own top controls, tabs, composer and
    player stay where that app puts them. Global things (switching apps,
    Home, Search everywhere, profile, settings, notifications, status)
    live only in the main navigation, and an app never draws a second
    copy of them.
S3. **A test holds the rail.** A test fails when the main navigation does
    not render on an app page: the rail at 640 and up, the menu button and
    its drawer below 640, with accessible names, at 360, 402, 874 x 402,
    744 and 1440.
S4. **Every settings screen is the one kit settings shell.** An app's
    settings, Account and Home settings are settings areas declared as
    data (spec `areas.json` or a package's `contributes.settings_area`)
    and drawn by the kit's `SettingsShell`; Home writes no settings
    layout, and each registry group is placed in exactly one card.
S5. **Copy is per person.** Setting text comes from the spec copy fields
    through `describeSetting`; a page never hand-writes setting help, option
    descriptions or a reason line. A description says only what the setting
    does for the reader; a subtitle states why only when the setting is
    disabled for them (Disabled for the home, Disabled by Dad).
    COPY-LINT-01 fails the gate on a new key that breaks the machine-checkable
    half; review holds the rest.
