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
wins. A child's or teen's search is protected by what it may fetch and show, not by refusing to search. The
SafeSearch level, the sources a kid or teen gets and the cleaning of fetched page text are user defaults (owner's
ruling, 2026-10-12): an admin may override them in either direction, globally (global defaults) or for one person (a
user override), and the kid or teen never can. Precedence is user overrides > global defaults > user defaults. Except web
sources (`search.web_sources`), which are one household setting only an admin sets, with no per-person override
([record](../plans/web-sources-household-2026-10-12.md)). The
adult-site host list (locked on for every kid and teen, a custom allow never lifts it) and the output gate stay fixed
and no setting reaches them. Web search runs without a parent's approval when the household has it on for their controls.
Picture, video and song generation under this rule (owner's rulings, 2026-10-17 and 2026-10-18): one set of content protections
per person, set by age, covers everything Home makes (chat, search, pictures, videos and songs), so a person who has swearing,
drugs, gambling or gore filtered gets none of it in a reply, a song, a picture or a video, including a picture of themselves and
friends doing it. Nothing sexual involving a minor is allowed anywhere, and that is not negotiable. Sexual content, gore and other
adult content are adult only. A teen makes pictures, videos and songs and edits pictures with nothing adult or sexual. A child
makes cartoon pictures and videos and kid-friendly songs of safe things in a strict lane (the cartoon look forced, a child-safe
topic gate, no photos, no references, no real people, edits only of their own cartoons, a daily limit, on by default with a switch
for the home and one per child). A child's request that is too scary or too adult is rewritten into a kid-friendly version and
not refused (a heavy rock song about a scary Halloween becomes a happy, light rock song about Halloween that is not too scary),
and the result is checked as finished, and as sung for a song. Family: anyone in the household may make pictures, videos and songs
with or of any household member, as a household option that is on by default. The age gate is not loosened by any of this: the
finished-item check (nothing nude or sexual for a teen or a child whoever is in it, a cartoon and child-safe for a child, a check
that cannot run withholds), the absolute line (nothing sexual involving a minor, anywhere, for anyone; teens and children never get a real person outside the household or a public figure at all) and the surface gate stay fixed, and no setting, including `generation.people_prompts`, reaches them. Owner-approved: 2026-10-25 (Jesse, chat: "everyone can do anything except teens and kids have filters blocking things like sexual"; record [content-policy-2026-10-18.md](content-policy-2026-10-18.md), Supersedes): an adult may make any picture or video of a real person, a public figure or a historical person (satire, scenes, humor), where before the absolute line refused them; a teen or a child keeps the real-person block unchanged.

**Models censor; the app filters only to protect kids (Owner-approved: 2026-10-25, Jesse in chat: "models do censorship, our app does filtering - and the only filtering we do is for kid protection"; record [models-censor-app-protects-kids-2026-10-25.md](models-censor-app-protects-kids-2026-10-25.md)).** For an adult on their own written screen the app adds no content filter, no word list, no classifier refusal on content, no consent step for content and no fail-closed content check; whether something is made is the model's own judgment. A person's own opt-in filter for themselves stays; the app imposes none. The app's content filtering is only for a child or a teen, plus the one line that holds for everyone: nothing sexual involving a minor, which includes the finished-item check that withholds an image or clip showing a possible minor in nude or sexual content, and the minor checks fail closed for everyone on adult-only or sexual work: when the check cannot run, the work is withheld. What also stays, because it is not content censorship: the age and surface gates, the credential catch, prompt-injection, jailbreak and PII-extraction handling, crisis handling, the one-time adult acknowledgment, a household's feature switches and quotas. This supersedes every earlier adult-side absolute line (sexual content of a real person, a photo of a real person becoming adult content, the household adult's per-use consent) and the real-voice song limit.
A robot's controls set the band for its unknown speaker, never its companion (owner's ruling, 2026-10-21; [record](dynamic-companions-2026-10-21.md)):
a robot with a companion assigned takes the controls level the admin set (child, teen or adult), a robot with no companion, and every
other unknown speaker on a shared surface, gets the child result. A companion declares an audience: `all` (dynamic, adapts to the
band, usable on any robot) or `teen` or `adult` (explicit, usable only on a robot whose controls are at or above it, refused in the
backend otherwise); a companion never loosens a filter. Speaker evidence alone decides memory access and acting on the signed-in
account: an unknown speaker is judged at the child band for every effect and reaches none of that person's memories, whatever the
companion. Owner-approved: 2026-10-21 (chat).

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
   signal about search need runs in shadow, logged as a number with no text, and changes no turn, with one exception. On a written turn where the person may search, when the model returns text with no tool call and the score is
   above the recorded threshold, the engine's query writer writes the query and the call passes the same policy
   checks as a model call. It never cancels a model call. For a child or a teen it applies only when web search is
   on for their controls, takes that person's own search path and protections, and a refused rescued call is
   dropped without a reply. It never applies to a spoken turn or the safety, consent, privacy or credentials paths,
   and an admin setting can switch it off.
   One scoped exception, weather only (owner, 2026-10-21, chat: "this is not about where input comes from (chat or voice),
   this is about the brain / intelligence"; every age band as relayed from his "kids can ask about weather and should get
   results", WEATHER-KID-01): a second small learned head on the same embedding (`weather-head.json`, trained by
   `scripts/train/weatherHead.ts`, no word list) runs the same way. When the model returns text with no call, the weather
   tool is offered, a household home is set and the score is over its recorded threshold, the weather tool is called for the
   place the person named (none means the household home) and the model phrases the result. It applies to spoken turns, to an
   unidentified speaker and to every band; the reply still passes the band's output gate, and `chat.search_assist` off or
   shadow switches it off or to scoring only. The search rescue keeps every limit above. What stays deterministic: the safety
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
   A second exception (owner-approved 2026-10-17, CF-SEARCH-02): an
   ungrounded search argument is not a dead end for a read-only lookup.
   Policy replaces the model's expression with a query built from the
   person's own words (filler stripped, nouns, names and dates kept,
   capped at 120 characters) and runs the search once, through policy
   again, so the age and surface gates, the household-name gate, the
   child search rules and the safety floor apply to the new query exactly
   as to the original. The trace records `retried_with_user_words`. It
   never loops, and the refusal line stays for every other ungrounded
   tool call (anything that writes or has a side effect).
   One narrow exception (owner-approved 2026-10-17, SEARCH-DOWN-EMPTY-01):
   when the only web source is down and the model's one retry after the
   failed lookup also came back with no visible words, the reply may be
   one fixed line that says web search is not answering and what to do
   (try again later, or ask something that needs no search). It applies
   only after that retry returned empty, only for a missing web source,
   never replaces any words the model wrote, and is never the raw error.
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
   reaches the model only after it passes the cleaning applied to that person (a user default, which an admin may
   override globally or for one person, never the kid or teen), with that person's safesearch level applied to the
   fetch; the adult-site host list is always applied. Fetches keep a
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
   whatever the wire; for a voice reply the person interrupts, it is the
   part they actually heard (the heard prefix), and the full generated
   text is not stored as if heard (owner's rule, 2026-10-14). Custom code in the chat path needs a named gap in
   this record first. Named gaps today: sentence-gated speech scheduling
   with the spoken cue, the `[n]` citation mapper, the output gate, the
   prose tool-call fallback, the chat header (the companion's character
   over a name pill with a menu button and a call button, drawn by the
   kit `ChatHeader` Element because assistant-ui has none; owner-approved
   2026-10-25, COMPANIONS-DOTS-01 / DOTS-CHAT-01).
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
    For an adult's chat, a minor word beside a sexual word is not a
    refusal by itself: discussion, news, fiction, health and advice are
    not filtered, and an adult's typed message has no word rule at all
    (producing such content is stopped by the model's own refusal and by
    the generation checks, as the leading providers do); every generation prompt and finished
    picture or clip keeps the minor check (nothing sexual involving a minor), and a child's and a
    teen's floors are unchanged (owner's ruling, 2026-10-19, amended
    2026-10-19 to drop the adult message check;
    docs/design/child-safety-text-2026-10-19.md).
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
    This is measured at the person's default, ease.reading_level =
    standard. A level the person or an admin chose is a setting, not a
    regression, and carries its own readability and accuracy rows.
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
profile-menu list and the "every width" wording. Owner-approved 2026-10-17: S6
(system status reaches the person through the existing mechanisms); his words are the
record: "make a rule for that: we already have a pattern and mechanisms to relay system
status to the user". Owner-approved 2026-10-23: S1 (one Settings entry; household
pages live in the same column for owner and admin); his words: "get rid of household
settings now since settings includes both".

Governs: frontend/src/shell/**, frontend/src/apps/**, backend/src/settings/**, backend/src/wire.ts, backend/src/lib/roleHealth.ts, backend/src/lib/healthSnapshot.ts, backend/src/lib/installStatus.ts, backend/src/lib/issues.ts

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
    Notifications, System status, Settings, Help and Log out; Incognito is
    in the rail's More menu (owner-approved 2026-10-06). It is never removed, hidden or merged
    into an app, and app content (thread lists, filters, sub-navigation)
    never lives inside it. On a phone the drawer holds the selected app's
    own sections below the apps; that is the only place app content meets
    the main navigation, and it never holds another app's.
    The rail is 56 px at the standard target size. When the person's
    resolved ease.targets is large, its width follows the kit
    target-minimum token, still icons only, still never expanding, and
    S3's test runs at that width too.
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
    copy of them. A search box that searches only that app's own
    records and never other apps (chat's thread search; News's search
    over its own stories, topics, sources and saved items) is part of
    that app's own native layout, not a second copy of Search
    everywhere, and is allowed beside it. The shell may draw the person's
    companion launcher at the bottom corner of any app except Chat; it
    opens Chat or a chat panel, carries no count or status, and the
    person can turn it off (Owner-approved 2026-10-24, design record
    companions-shared-chat-and-presence-2026-10-24.md section 7).
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
S6. **System status reaches the person through the existing mechanisms.**
    (Owner-approved 2026-10-17.) A change that must tell a person something
    about the system's state (starting, restarting, paused, low memory, a job
    running, an install in progress, a service down, a failed background
    action) uses the surface that already carries that kind of status and
    feeds its data source a new reason or state. It never adds a banner, dot,
    panel, toast or polling loop of its own.

    | Kind of status | Surface (file) | Data source | Who sees it |
    |---|---|---|---|
    | Background progress (engine setup, model downloads) | the progress strip, `InstallStrip.tsx` (`ShellInstallStrip`, the setup wizard, the Home ask box) | `lib/installStatus.ts` over the Stack's job list, `/api/install` | everyone, while it runs |
    | Something needs fixing | a Repairs item with Try again, `RepairsPage.tsx` | `lib/issues.ts` `raiseIssue` / `resolveIssue`, `/api/repairs` (the Stack link raises one in `lib/stack/linkRepairs.ts`) | owner and admin |
    | The AI or chat is not ready | the chat paused or starting state: composer line, Send hold, Welcome state, `useEngineDownReason` | `lib/roleHealth.ts` through `lib/healthSnapshot.ts` (`/api/health`, `availability`, `reason`, `cause`); the admin pause switch is `lib/chatPause.ts` | everyone in chat; a child gets only the composer line |
    | Whole-system health | the Status page and the header pill and rail menu, `StatusPage.tsx`, `StatusIndicator.tsx` | `lib/statusApps.ts`, `lib/statusBoard.ts`, `/api/status` (the Stack's health list is synced by `lib/stackHealthSync.ts`) | the Status page everyone; the pill hidden from a child |
    | One job's progress | that job's own card (picture, video, download) | the job record | whoever started it |
    | A companion's summary of one person's jobs (Owner-approved 2026-10-24) | one line on that companion's Yours card, "1 working · 2 waiting on you", the kit Status Element as shipped | the same job records, the viewer's own rows only (rule 6a) | the person whose jobs they are |
    | Needs an admin's attention, not a person's screen | Notifications: the bell, `NotificationBell.tsx`, `BrowserAlerts.tsx` | `lib/notifications.ts`, declared in `lib/notificationTypes.ts` | the audience the type declares |
    | A form or action failed | the kit destructive Alert in that form, with the next step | the failing call's own response, `lib/failureCopy.ts` | the person acting |
    | A spoken turn is not ready | the voice session's spoken line | the same readiness function as the written chat | the person speaking |

    Status is defined in one place: one readiness function per concern
    (chat is `roleHealth` through `collectHealth`), and every client reads
    it (web, voice, robot, Go). A client never recomputes it or keeps its
    own copy of the rule. A failure that coincides with a not-ready state
    is reported as that state ("Chat is starting", "Chat is paused") and
    never as a generic error. Status copy says what is happening and what to
    do (STYLE.md: the problem as the person sees it, then the next step). A
    new status surface is a new design: it needs an architect verdict, and
    the verdict is DUPLICATE when an existing mechanism covers the kind of
    status. Rejected in review: a new status UI that duplicates an existing
    one.

## Live video services

Record: [live web video for everyone](live-video-2026-10-17.md), with its
history in [the Loki Doki lessons](live-video-lessons-2026-10-17.md).
Owner-approved 2026-10-17: V1, authored by Jesse in chat; his reason is the
record: otherwise the household IP gets blocked (YouTube walled the home
address on 2026-08-28).

Governs: backend/**, frontend/**, scripts/**, docs/design/live-video*.md

V1. **No request to a live video service without Jesse's approval in the
    moment.** No code, test, script, bench, agent or session sends a
    request of any kind (a page, an API call, a loaded embed or player, a
    thumbnail, a caption, a yt-dlp run, a search-engine pass-through, a
    probe) to YouTube or any other live video service (its hosts and
    CDNs, and any Invidious, Piped or other front end for one) until the
    Loki Doki history has been reviewed, the research done, a design
    proposed to Jesse, and Jesse has approved it in the moment. An
    approval covers only the requests it names; approving a design is not
    approving a request. Tests use hand-written fixtures, never a capture
    from the live service. Reason: the household's one IP gets blocked.

## Robot vision

Record: [robot vision](robot-vision-2026-10-21.md). Owner-approved 2026-10-21 (chat): Jesse ruled that a robot keeps a constant,
short-lived idea of what its camera sees, that this is not an age question, that the protection is the data's handling, and that an
admin picks per robot between always watching (the default), only when asked, and camera off.
Owner-approved: 2026-10-21
Owner-approved: 2026-10-22 (R1 widened to look results, per docs/design/look-component-2026-10-22.md)

Governs: backend/src/lib/robotVision.ts, backend/src/routes/devices.ts (`/me/vision`), backend/src/lib/turnMachine/**, frontend/src/apps/settings/**

R1. **A picture from a robot is looked at once and dropped.** The robot posts one JPEG to `/api/devices/me/vision`. Home passes it once
    to the Stack's look capability (object labels with counts, scene tags, light). For a person's ask, or for an object that is new or
    changed, Home also passes it to the Stack's vision role for one short sentence or per-object details (colour, kind, make, model). No
    crop of a person is sent for details, and no detail describes a person or a body. Home keeps, per robot and in this process's memory
    only, the latest sentence, tags and details, each for at most 90 seconds after the object was last seen. It drops the picture and every
    crop when the call returns. A pending detail request holds its crop in memory only and is dropped when it expires. No picture, crop,
    sentence, tag or detail is ever written to disk, a stored turn, memory, the library, a backup, a log, a stat, telemetry or a persisted
    queue. No route returns any of them, and no person, admin included, can read them or their history (there is none). Logs carry counts
    and timings only, never a label, tag or detail.
R2. **Only the robot's own session reaches it, and the setting decides.** The route is in the robot-session allow-list and nowhere else;
    it needs a robot device session. `robot.vision` is per robot and admin-set: `continual` (default), `on_demand` (a picture only for
    an ask) or `none` (every picture refused, nothing kept). Pictures are rate limited, size limited and must be JPEG.
R3. **The look is context, never a claim.** A live description rides into that robot's turns as labelled background data with its age;
    the guidance next to it says to state only what it says, never to name or identify anyone from how they look, and to say plainly
    when it cannot see. It applies to every age band; a child's or teen's robot gets the same data protections and the usual output gate.
R4. **A robot turn still carries no picture.** The turn route's rule that pictures ride only on written chat turns is unchanged; the
    robot's look reaches the model only as the description above.

