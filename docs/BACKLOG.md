# Backlog

What's missing to go from "the hub can chat" to a usable family app. This is
a scannable list, not a narrative - full reasoning and decision history for
any item lives in `docs/dev.md` (linked where useful) or the relevant
platform standard in `getmaipai/.github`. Update this file whenever a gap
closes or a new one is found; don't let it drift from what `main` actually
does.

Rough size tags: **S** (a session or less), **M** (a real slice, days),
**L** (a platform-level capability, needs its own design pass first).

## The 2026-09-05 audit: where the gaps actually are

Jesse asked for an audit of goals, plans and code against what has been
built, with online research and a comparison against the legacy repos,
focused on three worries: the UI, portability and integration with the
robot, and intelligent, personified, memory- and data-driven chat. Five
read-only passes fed the sections below (backend, frontend, plan versus
built, legacy versus rebuild, the state of the art online); only their
conclusions are recorded here. Four findings rank above everything else
in this file:

1. **Chat is stateless.** The model is sent the system prompt and the
   current message only; the previous exchange is never in the prompt
   (`turnEngine.ts` sends `[system, user]` and says so in its own
   trailer). "And tomorrow?" has no referent. Nothing else here matters
   as much to how the hub feels to use.
2. **The prompt does not know who is talking.** No name, role, age band,
   locale or local time reaches the model, and recall is unscoped, so a
   parent's chat is fed a child's person-scoped memories. "Personified"
   today is a style fragment with no identity behind it.
3. **Memory is written only when someone says "remember", and recalled
   by keyword overlap** while a real embedding engine is already running,
   unused. There is no judge, no profile paragraph, no clock stamp on a
   memory record, and forget is a hard DELETE that a robot replica would
   push back on reconnect.
4. **Every page is hand-written React and the nav is hardcoded.** The UI
   schema in `spec/ui/` renders nothing, the five kit primitives built
   for the first app have no schema nodes, and there is no input-mode
   detection, so TV is undefined rather than unstyled. Neither Go nor the
   robot's standalone shell could render any page that exists today.

"Chat, memory and persona", "Portability and the link" and "Legacy: copy,
re-examine, record" are new sections; UI / shell, Settings and
Cross-cutting grew. Existing items were corrected where the audit found
them wrong (the `embed` role is built and unwired, not missing).

## Naming: rename `skill` to `plugin`, add real `skill` and `command`

Decided 2026-09-05 (full research and reasoning in `docs/dev.md`'s
"Naming: skill, plugin, command, connector" entry). The rename itself is
done; the other two items are still real, tracked work.

- [x] **Rename the `skill` manifest kind to `plugin`** (M-L, done
      2026-09-05, `docs/dev.md`'s "The skill -> plugin rename, executed"
      entry) - no behavior change to `weather`/`joke`/`trivia`/`define`/
      `remember`/`recall`, just the correct name for what they already
      are. Included a real data migration for `conversation_turns` rows
      with genuine data from tonight's live testing, not just a schema
      change. Still open: `getmaipai/.github/docs/PACKAGES.md` (org-wide,
      affects `bot` and `catalog` too) and the planned `catalog` repo
      layout haven't been updated to match yet - a separate repo's commit,
      tracked here so it isn't forgotten.
- [x] **Add a real `skill` kind: plain instructions, Claude-`SKILL.md`-
      compatible, no independent permissions** (M, done 2026-09-05,
      `docs/dev.md`'s "The real skill kind, shipped" entry) - composed
      into the chat model's system prompt when relevant (reusing the
      plugin floor's own `exampleScore` relevance matching, never
      executed on its own), safely user-authorable since it can't touch
      the network or any permission surface. Ships with a real bundled
      example (`storytime-style`) proving genuine Claude-format
      compatibility - real YAML frontmatter, stripped before composition,
      tested. Live-testing it found a real, honest cross-package routing
      collision (a bedtime-story request hijacked by the `joke` plugin's
      own keyword-overlap placeholder) - concrete evidence for the
      already-tracked `embed` role below, not something patched here.
- [x] **Formalize `command` as a first-class, user-creatable primitive**
      (M, done 2026-09-05, `docs/dev.md`'s "The `command` primitive,
      shipped" entry) - reuses `matchPattern` (`turnEngine.ts`) exactly
      as-is, checked before the plugin floor since a household's own
      trigger always wins. Two action shapes (`reply`,
      `home_call_service`, the latter reusing plugin's own
      `home.call_service` plumbing via a new shared `packageHost.ts`
      export). Security-domain commands (lock/alarm/cover/garage/valve)
      require an owner/admin creator and a `min_role` floor of `adult`,
      checked once at creation rather than re-derived per trigger. HTTP
      surface only so far - no authoring UI yet, tracked below.
- [x] **No new "connector" concept needed** - `integration` (an
      existing manifest kind) already is one. Nothing to build here;
      recorded so the question doesn't get re-asked.
- [ ] **A settings UI for authoring commands** (S-M) - `lib/commands.ts`
      and its `/api/commands` routes are done and tested; there's no
      household-facing "when I say X, do Y" builder yet, only the raw
      HTTP surface.

## Skill standards (definition of done)

Jesse's call (2026-09-05): this should rank alongside, not after, building
more skills - a standard nobody's held to gets more expensive to retrofit
the more packages exist, not cheaper. `getmaipai/.github/docs/PACKAGES.md`
already defines a real bar for every package (skills included); checked
against what the 6 bundled skills actually have today, none of them
clear it in full:

- [ ] **A real `quality_scale.yaml` per package** (S per package) - today
      `quality_scale` is one string field inside `manifest.json`, not the
      separate file with bronze/silver/gold criteria the standard
      describes (tests green, five-plus routing examples, a privacy row
      per data source, stated offline behavior, a smoke test, README and
      changelog present, lint clean). The routing-examples and privacy-row
      and offline-behavior parts are genuinely met already; the smoke test
      and the file itself are not.
- [ ] **A `smoke` entry per package** (S-M per package, M to design the
      mechanism once) - "runs where the package will live, at install, at
      every update, and on a schedule; a failure leaves it installed but
      disabled with a Repairs item." No smoke-test mechanism or Repairs
      concept exists anywhere in this codebase yet - this is real
      infrastructure, not just a per-package checkbox.
- [ ] **A user-tier `README.md` and `CHANGELOG.md` per package** (S per
      package) - the "store card" a household or the catalog's browse UI
      would show; none of the 6 bundled packages has either today.
- [ ] **Real i18n for skills** (L) - genuinely undecided, not just
      unbuilt: no `getmaipai/.github` standard mentions i18n at all today,
      so this needs a design decision before any code. At minimum:
      `manifest.json`'s `display`/`description` and a recipe's `format`
      step text are hardcoded English strings today, and `routing.
      examples`/`routing.patterns` (the deterministic floor's whole
      matching mechanism) would need real per-locale variants for
      anything beyond English to route at all - not a small addition
      once the `embed` role and Tier 2 both eventually depend on
      matching against those same examples.

Default packages are held to the same bar as community ones per
`PACKAGES.md` - the release skill is meant to refuse shipping a default
set with anything below bronze, which today it structurally can't check
(there's no `quality_scale.yaml`/smoke mechanism for it to look at).

## Skills (Tier 0 catalog)

Bundled today: `remember`, `recall`, `weather`, `define`, `joke`, `trivia`.
Everything else a family would reach for is missing, prioritized on one
rule Jesse set (2026-09-05): **a lookup (read a fact, return it) beats a
control/playback action (make something happen in the world) whenever
they'd otherwise tie.** A lookup is cheaper to build (no external device
or playback surface to actually drive, no failure mode beyond "the fetch
failed"), safer (no consequential-gate/permission story to design), and
still real, standalone value on its own - "what song is this" is useful
even before "now play it" exists. A control skill also usually *depends*
on the lookup half existing first anyway (you search for the song before
you can play it), so building lookups first is both lower-risk and
frequently a hard prerequisite, not just a preference.

**Priority 1 - lookups (read-only, no external device/playback surface):**

- [ ] Web search (S-M) - already decided as "permitted and required"
      (`docs/dev.md`'s 2026-09-04 tier 2 note); the highest-value single
      lookup missing, and the one most likely to replace a real fall-
      through-to-model miss today.
- [ ] Music / media search (S-M) - "what's this song," "who sings X,"
      show/movie info and availability. A pure lookup against a
      catalog/metadata API - explicitly NOT the same skill as playing
      anything (see Priority 3 below); this is the half of "media" that's
      cheap, safe, and useful standalone.
- [ ] Unit and currency conversion (S) - pure `host.fetch` shape, same
      pattern as `weather`/`define` (e.g. frankfurter.app for currency).
- [ ] Math / quick calculation (S)
- [ ] News headlines (S-M) - most free headline APIs need a key; find one
      that doesn't, or accept the config step.
- [ ] Sports scores (S-M)
- [ ] Translation (S-M)

**Priority 2 - simple local actions (writes to our own data, no external
device or service to control):**

- [ ] Reminders / timers (S-M) - `host.schedule` already exists; this is
      mostly a recipe + manifest away.
- [ ] Shopping / todo lists (M) - needs a new record type (a list, with
      items), so a small spec addition, not just a recipe.

**Priority 3 - control / playback (drives a real external device or
service; lower priority by the rule above, and often blocked on its own
Priority-1 lookup landing first):**

- [ ] Media playback control (L) - built extensively in the legacy
      pre-rebuild code (YouTube integration, cookie-jar auth, session
      keeper), none of it migrated to this platform yet. Largest single
      skill area by legacy scope, and the one this session's own priority
      rule pushes behind music/media search.
- [ ] At least one skill that actually calls `home.call_service` (S) - the
      permission/security model shipped 2026-09-05; nothing uses it yet.
      Lower priority than the lookups above by the same rule (it drives a
      real device), though it's already unblocked (no missing
      integration to build first, unlike media playback).

## Integrations

- [ ] **Calendar** (L) - doesn't exist. Needs a design decision first:
      local-only entry within MaiPai vs. a real CalDAV/OAuth connection to
      an existing family calendar (Google/Apple/Nextcloud). See the
      compose-step sketch in `docs/dev.md`'s "Notes for later" for how this
      feeds a real multi-source answer. Reading a calendar is itself a
      lookup (Priority 1 by the Skills rule above) - it's the auth/sync
      plumbing underneath that makes this L-sized, not the read.
- [ ] **Email search** (L) - doesn't exist. No permission-vocab slot fits
      inbox access yet; needs its own consent design (see `docs/dev.md`'s
      2026-09-05 note on this) before any client code. Same shape as
      calendar: the search itself is a lookup, the sensitivity and auth
      plumbing are what make it L.
- [ ] **Media/streaming integrations** (L) - see Skills above; split the
      same way: metadata/search auth (feeds the Priority-1 music/media
      search skill, and is the smaller, safer half to build first) versus
      real playback/streaming auth (feeds the Priority-3 playback-control
      skill - rate limiting, the "we are the user" pacing rules already
      written into `getmaipai/.github`, and meaningfully more integration
      surface than a metadata lookup needs).
- [ ] Verify Home Assistant against a real instance (S, blocked on
      hardware/access, not effort) - the client is built and mock-tested;
      never proven against the real thing.
- [ ] A recipe step (or Tier 1 path) that can actually reach
      `host.integration.call` (M) - the host method exists; nothing can
      invoke it today.

## Vision

- [ ] `host.camera.still` (L) - no pipeline, no hardware path in this repo
      (the hub isn't the camera; this likely means "receive a photo the
      robot or a phone took," not "the hub has a camera").
- [ ] `host.ocr.read` (M) - RapidOCR already decided as the library
      (`docs/dev.md`); needs wiring, a recipe step, and a real image input
      path (upload? robot capture?) before it's reachable at all.

## Generation (image, video)

- [ ] Image generation (L) - deliberately not started. The org's
      non-removable child-safety invariants for generation features (see
      `getmaipai/.github` > Safety invariants) mean this needs real design
      attention before any code, not a quick slice.
- [ ] Video generation (L) - same posture, same reason.

## Advanced tool calling (Tier 2)

- [ ] Real multi-source, multi-skill answers (L) - see `docs/dev.md`'s
      2026-09-04 tier 2 note and the 2026-09-05 stress-test against it.
      Explicitly NOT an open agentic loop by design; the current best
      candidate shape is a bounded `compose` recipe step (one model call,
      author-fixed tool sequence) plus richer chained recipes. Sequencing
      already decided: ship `embed` (real semantic routing) first, ship
      more real skills, measure the actual fall-through rate from real
      conversation history, then decide whether to build this at all.
- [ ] **Wire the `embed` role into routing** (M) - corrected 2026-09-05:
      the role itself is built and live-verified (nomic-embed-text on a
      second llama-server, `embedSupervisor.ts`), reachable only through
      a diagnostic route. What is missing is embedding `routing.examples`
      once at package load and matching by similarity (Tier 1), plus
      recall (see "Chat, memory and persona").

## Feature parity: ChatGPT / Gemini / Claude

Jesse's ask (2026-09-05): research what ChatGPT, Gemini, and Claude actually
ship today and add what's missing here. Real web research, not recalled
training data (this session's own standing rule after the persona-research
correction earlier tonight). Only genuinely new-to-this-list items get their
own bullets below; anything that overlaps a section above is a cross-
reference there instead, not a duplicate.

- [ ] **Projects: a persistent, instructed workspace scoped above a single
      conversation** (L) - doesn't exist in any form. ChatGPT Projects
      (custom instructions + a shared file Library scoped to the project,
      instructions now up to 5,000 characters as of July 2026) and Claude
      Projects (instructions + files, auto-switching to retrieval search
      once a project's files near the model's context limit, extending
      effective capacity roughly 10x) are the two real references. MaiPai
      has nothing between "one chat" and "the whole household's settings"
      - no scoped, reusable instruction+file container a person could set
      up once ("help with my woodworking projects," "track my training
      plan") and return to. This is closer to a new record type + a new
      chat surface than a skill.
- [ ] **Canvas / Artifacts: a side panel for iterating on a document or
      running code, not just chat text** (L) - doesn't exist. Real
      differences worth knowing before designing this, not just "build a
      canvas": Claude Artifacts actually execute and render results live
      in the panel (React components, HTML, SVG - as of June 2026 you can
      highlight part of an artifact and describe an edit in place), while
      Gemini Canvas is edit-only - it does not execute code, you copy it
      out to run it. Code execution itself is a separate, real capability
      none of the three vendors bolt onto raw chat text: Gemini's code
      execution tool runs actual Python server-side (30-second cap, learns
      iteratively from its own output). If this gets built, "does it run
      code or just display it" is the first real design fork, not a
      detail - and running arbitrary code has a real sandboxing story to
      design (Tier 1's Deno boundary is the closest existing precedent in
      this codebase, not a ready answer).
- [ ] **Deep Research: a multi-step, multi-source research mode that
      returns a cited report** (L) - doesn't exist, and it's a different
      shape than the Tier 2 note's own rejected "autonomous loop": ChatGPT
      and Gemini call it Deep Research, Claude calls it Research; all
      three run several minutes of multi-step web search/reading and
      return one cited report, which is closer to "one long, bounded,
      author-understood job with a fixed goal" than to open-ended runtime
      tool selection - worth a design pass of its own, not lumped into the
      Tier 2 note's already-decided "no autonomous loop" verdict without
      checking whether this specific bounded shape is actually the same
      risk the note was written against.
- [ ] **A stated policy on identifying a person from a photo** (S to
      decide, since it's a decision not code) - a real, undecided gap this
      research surfaced, distinct from the vision/generation gaps already
      listed. The three vendors disagree with each other: ChatGPT refuses
      identifying anyone from an image outright ("I can't identify people
      in images for privacy reasons"); Claude's model appears to recognize
      public figures internally but its output is trained to refuse
      disclosing it; Gemini will name a public figure on request, and
      Google's separate "Personal Intelligence" feature (expanded to all
      free US users March 2026) links Gemini directly to a user's Google
      Photos face-recognition data. `getmaipai/.github`'s existing hard
      rule ("no feature is built whose purpose is generating imagery of
      identifiable real people") governs generation only - there is no
      MaiPai stance at all on recognizing/naming a person from an uploaded
      photo, which is a real, separate question `host.camera.still`/`host.
      ocr.read` will eventually force regardless of which vendor's
      posture MaiPai ends up closest to.

Three more items the research turned up that are worth a one-line note
here but are NOT new gaps - they sharpen or confirm something already
listed above, so read them as amendments, not additions:

- **Barcode/QR reading** (Jesse's own example) turns out to already have a
  decided answer in this repo's own notes: `docs/dev.md`'s vision-review
  section already picked `zxing-cpp` for barcodes specifically (real
  dedicated decoders read a 1D UPC barcode far more reliably than asking
  a vision-language model to "read" one - confirmed general capability,
  not a barcode-specific one, in this research: all three vendors can
  read a clean QR code as an image-understanding task, which is a
  different and easier problem than decoding a real, imperfectly-lit 1D
  barcode). Nothing new to add to the Vision section above; it already
  lists `host.ocr.read`/`host.camera.still` as the real blocking gaps.
- **Scheduled automation** (ChatGPT Tasks, Gemini Scheduled Actions, Claude
  Scheduled Tasks) confirms the Proactive/ambient intelligence section
  above is aimed at something real and already shipped elsewhere, not a
  speculative idea - worth citing concretely: reporting says ChatGPT's
  original Tasks was "a glorified reminder app" and Gemini's was
  restricted to Google Workspace tools, while Claude's version does real
  automation (multi-step workflows, broad connectors, cloud-persistent
  execution independent of any device being on) - a genuine target shape
  for the "caching/freshness layer" piece already broken out in that
  section, not a reason to rewrite it.
- **Full-duplex, barge-in voice conversation** (GPT-Live, Gemini Live - both
  can listen and generate at the same time instead of waiting for a pause,
  sub-500ms median latency reported for ChatGPT's) is the concrete target
  shape for the Voice/robot section's "wake word past phase 1" line above,
  not a new item - a real number to measure against once that work starts,
  where today there is no number at all.
- **Custom GPTs / Gemini Gems** turn out to already be close to something
  MaiPai has, not a gap: a GPT/Gem is a closed, vendor-specific custom
  assistant, while MaiPai's own package manifest (skill/app/companion/
  integration, with declared permissions and routing) is structurally
  closer to the open, portable "Skill" format multiple vendors and tools
  now read (a SKILL.md-shaped standard, per this research, read by over
  30 different tools as of early 2026) than to a closed GPT/Gem. The real
  gap here isn't a new concept to design - it's the `catalog` repo
  existing for real, already listed above as its own item.

Sources consulted (this research pass, 2026-09-05): [ChatGPT Projects guide](https://www.ai-toolbox.co/chatgpt-management-and-productivity/how-to-use-chatgpt-projects-guide-2026), [ChatGPT custom instructions update](https://www.mywritingtwin.com/blog/chatgpt-projects-setup-guide), [Claude Artifacts 2026 guide](https://suprmind.ai/hub/claude/features/), [Claude Live Artifacts](https://www.eigent.ai/blog/claude-live-artifacts-guide), [Gemini Canvas](https://gemini.google/overview/canvas/), [Gemini Gems](https://geotoolbox.ai/blog/gemini-gems), [Gemini code execution docs](https://ai.google.dev/gemini-api/docs/code-execution), [Gemini/Google Photos face recognition](https://pasqualepillitteri.it/en/news/1055/google-photos-ai-scanning-gemini-recognition), [Google Personal Intelligence privacy concerns](https://vucense.com/privacy-sovereignty/surveillance-biometrics/google-gemini-personal-intelligence-photos-privacy-2026/), [ChatGPT/Claude photo-identification policy](https://github.com/openai/openai-python/discussions/2495), [Claude Scheduled Tasks vs. ChatGPT/Gemini](https://www.xda-developers.com/claude-scheduled-tasks-feature/), [voice mode comparison (GPT-Live/Gemini Live/Claude)](https://apidog.com/blog/gpt-live-vs-gemini-live/), [Claude voice moves to Opus/Sonnet/Haiku](https://www.techradar.com/computing/artificial-intelligence/claude-tipped-to-get-its-answer-to-chatgpts-advanced-voice-mode-soon-is-adding-an-ai-voice-to-a-chatbot-yet-another-tick-box-exercise), [Claude Skills vs ChatGPT GPTs vs Gemini Gems](https://www.open-claw.sh/blog/claude-skills-vs-chatgpt-gpts-vs-gemini-gems), [barcode/QR reading across vendors](https://www.dynamsoft.com/codepool/python-flet-chat-app-barcode-gemini.html).

## Chat, memory and persona (the intelligence gap)

What "intelligent, personified, memory- and data-driven chat" needs that
`turnEngine.ts`, `memory.ts` and `persona.ts` do not have today. Ordered
by payoff per day of work; the first five together turn stateless Q&A
into a conversation with someone who knows who is talking.

**Conversation and context**

- [ ] **Send prior turns to the model** (S-M) - a per-person, per-surface
      window from `conversation_turns`, newest few always kept whole, a
      rolling summary above that, under the existing prompt budget. Copy
      the tuned numbers from legacy `routes/chat.ts` (`trimHistory`,
      `refreshConversationSummary`: 1200-token window, newest 4 turns
      always kept, summary refreshed before the window drops a band, since
      "an uncovered band is real amnesia"). Plan 4.5 names "summary" and
      "context" in the volatile zone but never defines the window; this
      item defines it.
- [ ] **A speaker block in the prompt** (S) - pass the actor into
      `buildSystemPrompt`: display name, nickname, role and age band,
      locale (`core.locale` is declared and read by nothing), and a
      locale-formatted local time instead of raw ISO UTC the policy then
      asks the model to round. The cheapest large step toward
      "personified".
- [ ] **A household context block** (S) - who lives here (names, roles),
      who is present when known, what packages are installed, so "ask
      Nova to..." and "what can you do" answer from data, not guesswork.
- [ ] **Stable-first prompt order with a persona re-anchor** (S) - legacy
      `companionTurn.ts` put static policy first for KV reuse and
      repeated the persona reminder near the end because drift was
      measurable in about eight turns; plan 4.5 asks for the same
      stable-first shape. Today's order is right at the top and has no
      re-anchor.
- [ ] **Per-section prompt budget test** (S) - one 4,000-char cap today.
      The bot's `test_prompt_budget.py` capped each section (rules,
      memory, persona) after rules alone hit 68% of a prompt and produced
      8-14 s of silence. Same test here, per section.
- [ ] **Rate-limit `/api/turn` and `/api/llm/*` per person** (S) - named
      in `spec/llm/README.md`, tracked nowhere.

**Memory**

- [ ] **Scope recall to the actor** (S, privacy bug) - `recall()` in the
      turn passes no scope, so an owner's turn injects every child's
      person-scoped memories. Recall with the actor's own scope plus
      household; the parental view on the list route stays.
- [ ] **Person-scoped `remember`, with turn provenance** (S) - the recipe
      always writes `scope: household`, importance 0.5, `source:
      package:remember`. First-person facts write `scope: person`; the
      host passes the turn id so provenance is the spec's "conversation
      turn id", not the package name.
- [ ] **Wire `embed` into recall** (M) - the role runs (nomic-embed-text
      on a second llama-server) and its only caller is a diagnostic
      route. Store vectors (sqlite-vec, or a `memory_embeddings` table
      and brute-force cosine at household scale), embed on write, score
      on read, keyword as the fallback when the engine is down. Start
      from legacy `memory/recall.ts`'s tuned numbers, same embedding
      family: `0.7 cos + 0.2 importance + 0.1 recency`, floor 0.55 for
      episodic (top-5 used to be injected even for "hi"), 0.37 for
      durable (durables were "stored but never recalled"), entity-first
      pass. Re-run the legacy eval probes against the real embedder
      before trusting either number.
- [ ] **The memory judge: extract at turn end, consolidate at idle**
      (M-L; plan 4.4's "sleep-time judge", unbuilt) - a post-turn job on
      the scheduler asks the chat model for durable facts and preferences
      as a tiny, grammar-constrained list (Mem0's 2026 ADD-only shape),
      writes `tier: episodic` with the turn id, dedups by supersede. An
      idle-time pass (Letta's sleep-time agent) merges point facts into
      durative ones, re-tenses time-bound facts ("going to Boston in
      July" becomes "went in July"), demotes mis-tiered junk, and
      retries poison rows at most three times. Copy the rules legacy
      learned on real transcripts (`memory/judge.ts`: user-asserted
      facts only with a source quote, possessives resolved from the
      speaker's view, relative dates made absolute, trips stored as
      dated past-tense state; dedupe candidates at cosine 0.5, top 5,
      a DELETE always inserts the replacement) and the bot's extractor
      caps (8 entities, 12 facts, example names that never recur
      because a small model copies the example).
- [ ] **A maintained profile block per person** (S-M; plan 4.4's
      "profile paragraphs") - one pinned paragraph the judge rewrites
      ("who is talking, what they like, what is going on this week"),
      injected whole and capped in characters, with retrieval on top only
      for specifics. ChatGPT and Claude both inject a maintained summary
      rather than a search-result list; Letta's memory blocks are the
      same idea.
- [ ] **Dated memories in the prompt, and a closing reminder** (S) -
      legacy `formatMemoriesForPrompt` wrote "as of Aug 12, 2 weeks ago"
      on each fact and put a one-line reminder after the memory block
      because small models drift toward the freshest tokens. Today's
      block is bare bullets.
- [ ] **Use the bi-temporal fields, and add a clock to every memory**
      (S in the spec, then hub) - the record already has `valid_from`/
      `valid_to` next to supersede, and `memory.ts` writes null to both;
      nothing reads them. The judge sets them (a trip has an end), recall
      prefers currently-valid facts, and `hlc` is added to the shape.
      "Did this change" and "we never discussed that" are the two cases
      assistants fail most (LongMemEval); the 2026 temporal-memory
      results say to organize by when things happened, not when they
      were said. Spec change first, per the org rule; also listed under
      Portability because sync needs the clock.
- [ ] **Schedule `runMaintenance`, fix usage inflation** (S) - decay
      exists and is only reachable by a manual route; `recall` bumps
      `uses` on 20 matches while 5 reach the model.
- [ ] **Memory in the chat UI** (S-M) - a "memory updated" chip when the
      judge writes, per-message "remember this" and "forget this"
      actions, a per-person memory page that an adult can edit for a
      child. Every major assistant ships all three now.
- [ ] **A household memory bench** (M) - a LongMemEval-shaped fixture
      built on the persona roster, testing updates and abstention, run
      against the local model in the bench tier. Legacy had router (53),
      memory (11) and continuity (5) probes; the rebuild has unit tests
      only.
- [ ] **Skip the graph database** (decision, recorded) - Mem0 dropped its
      graph store for entity linking in a flat table; Graphiti needs
      Neo4j and a capable model. Entity columns, FTS5 and vectors on the
      one SQLite file is the local-first answer and keeps the robot
      replica trivial. The Entity/Relationship spec already gives the
      structured half.
- [ ] **Speaker resolution confidence on memory writes** (S, once voice
      ID exists) - a fact heard at low speaker confidence is stored in a
      quarantine scope and not injected until confirmed. The 2026
      multi-user memory research (AFA) names this exact shared-device
      failure, "persona confusion", and fixes it this way.

**Persona and companions**

- [ ] **A Companion/Persona spec record** (M) - plan 3.1 lists it,
      `spec/schemas` has none. Identity (name, pronouns, tagline), a
      short backstory, interests, three to five few-shot lines (legacy's
      review: "the single biggest lever for small-model voice fidelity"),
      a linked voice, a per-persona confirmation pool (one shared pool
      today, so every character acks identically), and the prompt prefix
      using the persona's `display_name` instead of "You are MaiPai".
      Map today's four dials onto the plan's nine sliders, or record why
      four is enough. Keep the prose card under about 150 tokens.
- [ ] **Persona is not the same as how to address the listener** - the
      "speech profile per person" item under People is the other half;
      build them as two records injected in order: who I am, then who
      you are, then memory, so style never blunts facts.
- [ ] **Activation steering spike** (M, before any nine-slider prose) -
      plan 5.4 and org principle 6 both say steering vectors over
      personality prose. llama-server (the mandated engine) already
      takes `--control-vector` and `--control-vector-scaled`, and ships a
      `cvector-generator` that trains one from paired prompts; the 2026
      PERSONA result reports fine-tuning-level trait scores on small
      models by this route, with Qwen3-4B strongest among those tested.
      Measure on the bench: does one vector hold register better than a
      paragraph over thirty turns, and what does it cost per token.
- [ ] **A persona consistency test** (S) - ten scripted exchanges scored
      by string checks (address form, length, forbidden phrases) in the
      deterministic suite, plus a model-judged version on demand.
- [ ] **The bot's honesty guards as a post-model pass** (M) - legacy
      `guards.py` (invention, unrelated recall, near-echo, medication
      doses, capability claims), `_marked_repeat` ("Like I said" never
      across conversations) and the attractor-removal rule for prompt
      examples were each fixed against a real broken reply, with tests.
      The hub has none of them.

**Data-driven answers**

- [ ] **Exposed state, the Home Assistant pattern** (M) - every package
      declares which records and actions it exposes; the turn engine
      builds the tool list per request (per person, device, persona),
      capped well under the model's limit. Community measurements: about
      thirty exposed items cost 1,300 tokens and past fifty a small model
      forgets devices. Tier 1 (`embed` similarity over `routing.examples`)
      is the pre-filter that keeps the offered set to a handful.
- [ ] **Typed query tools, never text-to-SQL** (decision, recorded) -
      each package exposes a few parameterized reads ("events between",
      "chores for person") backed by SQL we wrote. Small models fill
      parameters reliably and do not write safe SQL.
- [ ] **Grammar-constrained tool calls, verified before acting** (S, with
      Tier 2) - an unparseable call is "ask again", never a silent drop;
      llama.cpp's lazy grammars still let malformed calls through on
      recent Qwen builds (upstream issue 24807).
- [ ] **The routing eval corpus as a permanent test** (M) - plan 4.5 says
      routing accuracy "is the number that decides whether tier 2 is
      built at all"; no corpus exists. Utterance, expected package or
      none, expected arguments, near misses that must not fire, every
      real miss added before it is fixed. Legacy `llm/router.ts` had
      about twenty regex classes each annotated with a live misroute
      ("I GOT THE JOB" routed to remember; "do you know who X is" must
      never hit search); mine those for the first rows.
- [ ] **Bench models for tool calling** (S) - Qwen3-4B-Instruct-2507 and
      Gemma 4 E4B are the published sweet spots for on-device tool use
      in 2026; measure on our own tool set, not their leaderboards.
- [ ] **Speak MCP for local tools inside the hub** (M, decision first) -
      one tool contract that catalog packages and Go can share, and the
      route by which MCP Apps result panels could arrive later. Plan
      v0.1 named an "MCP spike"; nothing was spiked.
- [ ] **Output-side safety on streamed sentences** (S-M) - the classifier
      header promises "again on every streamed sentence"; only the input
      is checked. Run it per sentence in `streamTurnEvents` and cut the
      stream on a refuse category.

Sources for this section (research pass, 2026-09-05): [Mem0, state of agent memory 2026](https://mem0.ai/blog/state-of-ai-agent-memory-2026), [Letta sleep-time agents](https://docs.letta.com/guides/agents/architectures/sleeptime/), [Letta memory blocks](https://www.letta.com/blog/memory-blocks/), [Zep temporal knowledge graph](https://arxiv.org/abs/2501.13956), [LongMemEval](https://arxiv.org/abs/2410.10813), [Temporal semantic memory](https://arxiv.org/abs/2601.07468), [AFA, multi-user memory](https://arxiv.org/html/2604.25022v1), [ChatGPT memory Dreaming, secondary](https://letsdatascience.com/news/openai-upgrades-chatgpt-memory-architecture-for-fresher-pers-b26b51d5), [Open WebUI memory](https://docs.openwebui.com/features/chat-conversations/memory/), [PERSONA steering vectors, ICLR 2026](https://arxiv.org/html/2602.15669), [llama.cpp control vectors](https://github.com/jukofyork/control-vectors), [AgentFloor, small-model tool use](https://arxiv.org/abs/2605.00334), [llama.cpp tool-call grammar issue](https://github.com/ggml-org/llama.cpp/issues/24807), [Home Assistant LLM API](https://developers.home-assistant.io/docs/core/llm/), [Anthropic, context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents), [semantic-router](https://github.com/aurelio-labs/semantic-router), [MCP Apps spec](https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/).

## People, relationships and permissions

The spec landed 2026-09-05 (`docs/dev.md`, "Entities, relationships and
grants"): Entity, Relationship and Grant, with the relationship-type and
grant-action vocabularies and the cross-field validators. None of it is
implemented on the hub yet.

- [ ] **The hub half of entities and relationships** (L) - tables,
      migration, routes, and a UI. Held back deliberately: a parallel
      session was mid-edit across `db/schema.ts`, the migrations and
      `turnEngine.ts` when the spec landed, and a change this shape on
      top of that is how two sessions lose work.
- [ ] **Migrate authorization from roles to grants** (L) - `min_role` on
      every package manifest, `CREATABLE_BY`/`MANAGEABLE_BY` in
      `routes/people.ts` and `lib/personLifecycle.ts`, and every
      `requireRole` call become grant checks. Age stops deciding access
      entirely (see the spec's reasoning); it keeps its place in safety
      and retention only.
- [ ] **Resolve the unrestricted-mode age collision** (S, Jesse's call) -
      the org's Safety invariants unlock unrestricted chat and generation
      "per-user by an adult" and restrict child profiles by default, both
      age-shaped; the grant model removes age from authorization
      entirely, so nothing can check a grantee is an adult. The Grant
      record enforces what it can (the acknowledgment is signed and must
      be by the person it is about) and documents what it cannot. Two
      correct rules in genuine conflict, not an oversight.
- [ ] **Do roles keep age-flavoured names?** (S, Jesse's call) - once
      roles are authorization-only, `adult`/`teen`/`child` either become
      labels that seed a default grant set and mean nothing afterward, or
      go entirely. The second is the only one where nobody can mistake a
      label for a rule.
- [ ] **Relationship inference** (L, and its own design pass first) -
      the storage model is useful without it and safe on its own. Two
      questions to answer before any code: does inference ship at all in
      v1, and may a parent see a relationship inferred from their teen's
      conversation? Both are Jesse's, not research questions.
- [ ] **A speech profile per person** (M) - how to address someone
      (complexity, pace, vocabulary), distinct from persona, which is who
      the assistant is being. `persona.ts` already has a `complexity`
      dimension doing half the job for the wrong owner: two people
      sharing a companion must still be addressed differently.
- [ ] **An `enabled` state for a person** (S) - `Person` has only
      `deleted_at`; disabled-but-present has no representation today.
- [ ] **Retire the free-text memory entity** (M) - `record_kind: entity`
      keeps a name and description in one `text` field and recovers the
      name by splitting on the first colon, which `lib/memory.ts`
      documents as an approximation. Entity records replace it; memory
      stays narrative.
- [ ] **The Python half of `spec/records/ts/validate.ts`** (S) - lands
      when the robot writes one of these records, the same split
      `spec/safety/` takes today.

## Settings

- [ ] **Rebuild Settings as a real settings editor** (L) - Jesse,
      2026-09-05, with a VS Code screenshot: a tree sidebar showing the
      section and subsection you are in, search, scope as tabs, and each
      setting stacked title / description / control. Researched against
      `getmaipai/.github/docs/SETTINGS.md` and most of it is already
      decided there rather than new: Rule 1 ("a setting lives with the
      thing it configures, once") is violated by today's single long
      page, and Rule 5 already specifies a generated index with
      `@modified`/`@app:`/`@level:`/`@person` filters, which is VS Code's
      own filter model. Genuinely new and worth adding to the standard:
      the sidebar-as-table-of-contents, admin as its own area, and
      "regular users never see admin settings, even disabled ones" (which
      the grant vocabulary's `settings.admin` action now makes
      enforceable by rendering nothing rather than disabling controls).
- [ ] **Do NOT add a global "show advanced" toggle** - Jesse asked to
      double-check this one, and the answer is that SETTINGS.md Rule 4
      already forbids it deliberately: "three levels, disclosed locally,
      never a global mode... No per-person advanced mode switch." VS Code
      has no such toggle either; advanced-ness lives in groups and
      filters. Recorded here so it is not re-proposed.

- [ ] **Selector renderers so the custom sections can become declared
      keys** (M; the concrete reason Settings cannot be declarative
      today) - `SettingField` handles text, number, select and boolean,
      and secrets are read-only. Eight of ten sections on the page are
      custom React (voice catalog, cloned voices, PIN, commands, HF
      token, models, backups, routing stats) against SETTINGS.md Rule 1.
      Add `duration`, `time`, `person`, `media` and a secret-entry flow,
      then re-declare the sections that only needed those.

## UI / shell

- [x] Person edit and delete (M) - done 2026-09-05. `PATCH`/`DELETE`
      `/api/people/:id` plus `POST /api/people/batch-delete`, the rules
      in `lib/personLifecycle.ts`, and real UI with multi-select. A
      deleted person's memories, conversations, settings, jobs and
      recordings are erased for real; the person row becomes a tombstone.
      See `docs/dev.md`, "Person edit and delete".
- [x] Backup restore, end to end (S) - done 2026-09-05. Staged, not
      applied live: the route decrypts and verifies, `db/index.ts`
      swaps it in at the next start. Owner-only, with a real
      confirmation. See `docs/dev.md`, "Restore, staged and applied at
      boot".
- [x] A privacy page ("what leaves the house") (M) - done 2026-09-05.
      `GET /api/privacy` aggregates every bundled package's
      `data_sources[]` plus the hub's own downloads (models, engine,
      wake word, TTS program, TTS model, voice files, embeddings);
      `/privacy` renders it in dad-test language. See `docs/dev.md`,
      "The privacy page".
- [ ] **Batch select and clear-all everywhere else** (M) - the org rule
      landed 2026-09-05 (`getmaipai/.github/docs/UI.md` > Batch actions,
      Jesse: "every section should provide easy batch and or delete all
      mechanism"). People has it. Memory does not, and is the case Jesse
      named specifically: it needs multi-select archive/forget plus a
      real clear-all, which also finally gives `lib/memory.ts`'s
      `forget()` a UI (`MemoryPage.tsx`'s own comment deferred it for
      want of a confirmation pattern; `PeoplePage.tsx` now has one worth
      lifting into the kit). Conversation history and notifications
      inherit the same rule when they get surfaces.
- [ ] **The kit owns the batch-selection pattern** (S) - `PeoplePage.tsx`
      hand-rolls selection mode, the count, the confirmation panel and
      the partial-success report. The second consumer (Memory, above) is
      the moment that becomes a kit primitive rather than a copy.
- [x] Notifications UI (done 2026-09-05, `docs/dev.md`'s "The
      notification system, a real working slice" entry) - `NotificationBell`
      (shell header: pending list + toast on new arrival). Still real gaps:
      no thirty-day history page yet (only the pending list and the
      `GET /api/notifications/history` route it would read from), and
      "clear all" isn't built (this item's own "batch actions" rule
      applies once it is).
- [ ] Package/skill catalog browsing and install (L) - blocked on the
      `catalog` repo existing for real; today only local bundled packages
      run at all.
- [ ] Admin / parental-controls surface beyond the generic settings
      renderer (M)
- [ ] **The rest of accessibility** (M) - the 2026-09-05 pass measured
      what can be measured mechanically (targets, names, text size,
      overflow, focus rings). Untouched: colour contrast ratios against
      the real token palette in both themes, a screen-reader read-through
      of each page, keyboard-trap testing, reduced-motion, and the TV
      surface (which has no input-mode detection yet, so there is nothing
      to test). Worth wiring the measurable half into a script the
      screenshot pipeline runs, so it cannot regress silently.
- [ ] Onboarding beyond the one-time initial household setup (M)
- [x] Accessibility audit (M) - done 2026-09-05, driven against the
      running app at phone and desktop, not read off the source: 142
      violations found, all fixed, re-measured at zero. See `docs/dev.md`,
      "The accessibility audit". Not covered and still open below: colour
      contrast, screen-reader flow, keyboard traps, and the TV surface.
- [ ] Any UI for calendar, email, camera/vision, or generation (blocked on
      each of those existing first)
- [ ] **The `app` kind: full, multi-page apps (Videos/Weather/Podcasts-
      style), decided architecture, not built** (L; full reasoning in
      `docs/dev.md`'s "Naming" entry, 2026-09-05). Decided: same process,
      same origin, no iframe, no remote hosting - an `app` package is its
      own directory (mirroring `backend/packages/<id>/`) exporting its
      own nested route subtree, mounted into the one frontend the same
      way the legacy hub nested Videos'/Podcasts' many pages under one
      layout route. Picked explicitly over an iframe/postMessage model
      (the real precedent behind ChatGPT's Apps SDK, researched and then
      rejected here) for lower complexity, no new failure mode, and no
      new trust boundary - Jesse's own stated bar, not assumed.
- [x] **Build the missing kit primitives before the first full app, not
      alongside it** (M) - done 2026-09-05. `getmaipai/.github/docs/UI.md`
      decided that apps never build their own chrome (sidebar, search,
      cards): they declare typed blueprint contributions and compose
      pages from shared kit primitives, never hand-rolled UI. The five
      the standard names and the kit lacked - `CardGrid`, `MediaShelf`,
      `List`, `DetailPane`, `SplitView` - are now in
      `frontend/src/kit/primitives/`, generic and content-agnostic, with
      the breakpoints and density budgets owned by `kit/responsive.ts`.
      Building them first is what forces the first app into the shared
      vocabulary instead of risking a repeat of legacy's separate
      `VideosRail`/`MusicRail`/`PodcastRail`/`NewsLayout` for what should
      be one shared component. Details in `docs/dev.md`, "The five
      missing kit primitives".
      **Still open, the other half of this item:** a real data-driven nav
      blueprint. `Shell.tsx`'s nav list is still hand-hardcoded, by its
      own comment, pending "the moment a fifth package needs to add an
      entry" - which is whenever the `app` kind work above starts.
- [ ] **Skills as home-screen widgets - cards and rows** (L, needs its own
      design pass before any code - Jesse, 2026-09-05). The idea: a
      skill's data shown on a dashboard as a card (or, for some skills, a
      horizontal row of cards) instead of only being reachable by asking
      for it in chat. Nothing here is decided yet - the card/row system
      itself, which skills opt in, how a manifest declares it - this is
      a real gap, not a small addition.
      **Real prior art from the legacy app**, kept as reference for the
      design pass, not as something to port (the org's "copy from legacy"
      allowance is for hard-won logic, never UI or feature scope - so this
      informs a fresh design, it isn't the design):
      - `homeWidgets.ts` was a single source-of-truth catalog (id, title,
        description, icon, an `allowWide` flag for a full-width 2-column
        tile, and a `toolId` gating availability on whether the backing
        tool/skill was actually installed - the direct precedent for "a
        widget only exists if a real skill backs it," never a "coming
        soon" tile).
      - A `supportsRowMode` flag: some widgets, expanded to full width,
        switched from a vertical card to a horizontal strip of smaller
        cards - the actual "cards vs. rows" distinction Jesse's asking
        about, already had a real precedent.
      - `CardSizeControl.tsx` - a popover slider (range 180-560px, step
        10, default 260) driving one CSS variable
        (`--takeover-card-min`) that every grid consumed via `repeat(
        auto-fill, minmax(var(--takeover-card-min), 1fr))`, persisted per
        app per device. Its own comment names the inspiration directly:
        the Apple Photos / Plex / Lightroom toolbar-zoom pattern. This is
        the "slider to dynamically adjust card size" Jesse referenced -
        real, working code in the legacy app, a good reference point for
        a fresh implementation, not a drop-in port.
      **What a real design pass needs to decide, not guessed at here**:
      whether a manifest's existing `contributes`/`pages` field is the
      right hook for "this package offers a widget," how a lookup skill's
      recipe output (today just `reply.text`/`speech`) maps to structured
      widget data, whether cards refresh live or only on demand, and how
      this interacts with the proactive/caching idea noted below (a
      widget is the most natural place a proactively-fetched fact would
      actually surface).

- [ ] **The home screen: keep the dashboard, make it a real home**
      (decision for Jesse, then a design pass, M) - Jesse asked
      (2026-09-05) whether legacy's home (a grid of app shortcuts with
      favorites, search, a greeting and the weather, every app standalone
      with a consistent back-to-home) is still the modern answer. The
      honest read from the research and the 2026-08-25 navigation note:
      the bones are right and current, the emphasis is dated.
      - **Right and still current:** a consistent app shell with Back
        that always works (plan 6.4, Apple TV and every smart display do
        this); favorites as the family's own list, shipped with fewer
        pins than eleven so it never becomes a menu; search on the home
        screen; the home's row order following the pinned order (Plex's
        one-list-two-payoffs trick, already in the 08-25 note).
      - **Dated:** a grid of app icons as the *content* of home. That is
        a 2010 phone home screen. Every 2026 family surface (Hearth,
        Skylight, Echo Show, Nest Hub) leads with glanceable state (who
        is here, today's plan, one thing worth knowing) and keeps app
        shortcuts as a strip. Hearth's "built with the child as the
        primary user" is the closer reference for a shared kitchen
        screen than Skylight's parent-first calendar.
      - **Recommendation:** home is shell-owned (plan 6.1: the platform
        owns all chrome), composed from package contributions: a
        greeting with who is here (from sign-in now, voice or face ID
        later), a row of "today" cards (the "skills as home-screen
        widgets" item above is exactly this, so the two items merge),
        a pinned-apps strip driven by the same `pinnedIds` the sidebar
        uses, and one prompt box that is both search and chat (type or
        talk; finds apps, memories and answers). Each app keeps the
        consistent header with Back; on desktop the sidebar stays the
        one permanent navigation and auto-collapses in consumption
        modes, on phone it is the bottom bar, on TV the focusable rail,
        exactly as plan 6.1 already says, so "standalone app" is what
        every surface except desktop looks like anyway.
      - **Personal data on the shared screen only after the person is
        confirmed** (Nest Hub's voice-matched-only toggle is the model);
        until then home shows household-level cards only.
- [ ] **Unified search: one palette over everything** (M; Jesse,
      2026-09-05: "we need a unified search, I think we had that in the
      old app") - legacy did: a Spotlight palette (app entries and
      offline libraries client-side) over one `/api/search` endpoint
      that fanned out across twelve content types (bookmarks, news,
      companions, devices, saved videos, podcasts, clips, notes, books,
      music, chat) with FTS5, each provider independent and best-effort
      (a throwing provider contributes nothing rather than failing the
      search), six hits per provider, the last token prefix-matched so
      partial words match as you type, results grouped by type and
      navigating to a route on select. Nothing like it exists in the
      rebuild; `SearchBox` per page and "the shell palette for
      everything" are already the rule in plan 6.4 and UI.md. Build it
      as the shell's command palette (Cmd/Ctrl+K, and the Search row
      on every surface, since this audience will not learn a shortcut):
      core providers for apps, people, memories, conversations, settings
      keys and commands (the VS Code model the Settings rebuild already
      cites), a `search` blueprint so any package contributes a provider
      over its own tables, the web-search skill as the fall-through, and
      "ask MaiPai" as the last row so search and the chat prompt are one
      box. This is the same prompt box the home-screen item above
      describes; build it once. Legacy's web-search ladder
      (`webSearch.ts`: a local SearXNG metasearch sidecar first, keyless
      scrapers only as fallback) feeds the Priority-1 web search skill,
      with one caveat for that item: the local metasearch sidecar fits
      the "we are the user" rule, scraping Google from the hub's address
      does not.
- [ ] **Input-mode detection in the kit** (M, everything TV depends on
      it) - one `useSurface()` hook from `pointer: coarse`, `hover:
      none`, keyboard-only and remote/gamepad, so TV becomes a real
      surface instead of an undefined one. Legacy's `use-coarse-pointer`
      existed because Tailwind `hover:` made video controls unreachable
      on touch for months; its TV pages each hand-rolled `{row, col}`
      focus, the lesson being one spatial-navigation hook in the kit,
      never per page.
- [ ] **Two render profiles per component, near and far** (M, after the
      hook) - focus scale, the tvOS type scale, no free text entry on
      far, as schema-level rules per plan 6.4's "TV in one rule", so no
      package does TV work.
- [ ] **Phone chrome per UI.md** (M) - a five-entry bottom bar with More,
      replacing the 64 px icon-only rail that ships under 640 today (the
      08-25 note already warned icon-only nav raises cognitive load for
      occasional users; it is the phone default now).
- [ ] **A profile switcher in the header** (S) - sign-out is the only way
      to change person, which on a shared tablet or TV is the primary
      gesture. Sign-in already has the picker; reuse it with the PIN
      prompt.
- [ ] **The UiNode renderer, and the schema catching up to the kit**
      (M-L; sharpens the `app` item above) - `spec/ui/schema.json` has
      six node kinds and renders nothing; CardGrid, MediaShelf, List,
      DetailPane and SplitView have no nodes, and Form, EmptyState and
      Progress already drift from theirs. Add the five nodes now with a
      test that each React primitive's props are a superset of its node,
      then make Chat the first page rendered from JSON (bindings plus the
      five actions). **A re-decision is needed on the `app` item:** the
      dev-record's "same process, same origin, React route subtree"
      verdict contradicts plan 6.2 (pages are schema data; custom React
      only as a `platforms: [web]` federated bundle), cannot be installed
      from a catalog without a rebuild, cannot be served by the robot's
      standalone shell, and cannot render on Go. That is the single
      largest principle-7 risk in the codebase. Shape the schema like
      A2UI and json-render (a flat node list against a catalog of
      allowed components, data model separate from layout, incremental
      patches): the design that both LLM generation and native renderers
      have converged on. Do not adopt MCP Apps for Go; it is iframe-bound.
- [ ] **Chat surface, the missing basics** (M total) - markdown via a
      maintained renderer (react-markdown plus rehype-sanitize; bubbles
      are `whitespace-pre-wrap` today so a list shows raw asterisks); a
      multi-line Textarea composer; stop generating (no abort exists,
      Send is just disabled); copy and regenerate; suggested prompts on
      the empty state; timestamps and day dividers; `aria-live` on the
      streaming bubble (a screen reader hears nothing during a reply);
      a resume cursor on the stream (legacy's `since=` auto-resume was
      added after a truncated reply was reported as success); the
      "demo only" wake banner reworded for a family, not a developer.
- [ ] **Conversations as records** (M, spec first) - one endless thread
      per person today with no boundaries, titles, search or delete. A
      `Conversation` shape in `spec/`, new chat, a list, delete and
      clear-all (the batch rule's named consumer), and a companion axis
      per conversation, which plan 4.14 leaves unspecified.
- [ ] **Push-to-talk in the composer** (M) - `mic-capture.ts` exists for
      wake word only and there is no STT route. Legacy `sttSession.ts`
      carried the tuned numbers (Silero 0.5/0.35 hysteresis, 0.32 s
      pre-roll, decode kicked at the voiced-to-silence edge and reused,
      saving 0.6-0.8 s; ort-web WASM because ort-node segfaults under
      Bun); copy them.
- [ ] **Kit gaps found by the audit** (S each) - `AsyncState` (loading,
      error with retry, empty) to replace the triad copy-pasted across
      five pages; Checkbox (People uses a raw input), Textarea, Tabs
      with a URL-bound active tab, Chip/Toggle (Chat hand-rolls two);
      MemoryPage onto `List`; Shell and NotificationBell tests.
- [ ] **The kit ESLint config UI.md mandates** (S) - `lint` is `tsc`
      only; nothing bans raw colours, `lucide-react` imports outside the
      icon registry (one already leaks), or inline layout in apps.
      Legacy's `check-design-contract.mjs` had waivers and a ratchet
      baseline; the mechanism belongs in `@maipai/standards`.
- [ ] **A real PWA** (S-M) - manifest only today: no service worker, no
      offline page, one oversized icon. Copy the rules legacy's `sw.js`
      v5 learned: navigations network-first with an offline page (a
      cached index once pinned old hashes for several reloads), full
      passthrough on Firefox (local network access), reload exactly once
      on `controllerchange`; plus `lazyRetry` (stale-chunk reload once
      per session, hit right after an update) and an error boundary,
      neither of which exists.
- [ ] **Reduced motion, type floor, theme colour** (S) - no
      `prefers-reduced-motion` handling anywhere; `text-[10px]` and
      `text-xs` below the 16 px phone floor in the bell and thread; the
      `theme-color` meta is hardcoded dark. Add an appearance setting
      (light, dark, system) per person, the first step toward plan
      decision 13's per-person generated themes.
- [ ] **A screenshot matrix in the pipeline** (M; sharpens the tracked
      "wire the measurable half" note) - every page at every surface,
      light and dark, with overflow and target checks, per UI.md; today
      one hero shot at one size.
- [ ] **Health and Repairs pages, the updates projection, self-update
      with stage, swap, health check and rollback** (L) - plan v0.1
      scope, absent here entirely; "cut a first release" below cannot be
      exercised end to end without them.

## Proactive / ambient intelligence

- [ ] **Cache skill lookups proactively, and surface them unprompted when
      relevant** (L, needs its own design pass - Jesse, 2026-09-05).
      The example: a person who knows you like video games might say "oh,
      Grand Theft Auto VI comes out today" without being asked - MaiPai
      doesn't do anything like this today; every skill only ever runs
      when a person's own message routes to it. Three genuinely separate
      pieces, worth naming separately since they're different sizes:
    - **A caching/freshness layer for skill results** (S-M) - the
      scheduler (`host.schedule`/`runDueJobs`) already exists and is real;
      this is "run certain lookups on a schedule and keep the last result
      somewhere," which is mostly new plumbing on top of infrastructure
      that's already built, not a new subsystem.
      Sharpened 2026-09-05: plan 4.10 already declares the manifest
      fields for this (`cache: {key_template, ttl_s, stale_ok_s,
      max_bytes}` and `warm: {schedule, keys}`, `warm_on`), so this is
      implementing a declared shape, not designing one.
    - **Matching a cached fact to what a specific person actually cares
      about** (M-L) - needs a real answer to "how does the hub know
      someone likes video games" at all. `memory.ts`'s existing recall
      already does keyword-overlap matching against stored facts, which
      is a plausible starting point (a remembered "I love video games"
      fact matching a cached "GTA VI released" fact), but a dedicated
      interest/preference model would work better and doesn't exist -
      real design work, not just wiring.
    - **Deciding when and how to actually say it** (L) - the hardest and
      most product-sensitive part. Surfacing something unprompted in the
      middle of a conversation risks landing as useful or as intrusive
      depending entirely on timing and judgment a fixed `format` template
      cannot express (the same "no conditional branching in a recipe"
      limit the tier 2 compose-step note above already names). This
      overlaps real estate with the notification system below (both are
      "tell someone something they didn't ask for") but is a distinct
      surface - a notification is its own explicit channel; this is
      about weaving a fact naturally into an ongoing chat, which is
      closer to the persona work's "engagement depth" dimension
      (`docs/dev.md`, companion personas note) than to notifications.
      Worth deciding together with that note rather than separately.

## Portability and the link (hub <-> robot)

Plan chapter 7 (pairing, one oplog with HLCs, merge policies, the
never-sync allowlist, adoption) and principle 3 (every record is the
spec shape with id, provenance and clock stamp from first boot, so
pairing is a transfer, never a translation). The audit checked the code
built so far against that promise. `bot` itself is docs-only and blocked
on a spec tag that was never cut.

**Fixes (data debt already accruing)**

- [ ] **Forget and person-delete must write tombstone ops, not bare
      DELETEs** (S-M) - `memory.forget()` is a bulk DELETE and person
      deletion cascades hard deletes of memories, settings and jobs.
      Plan 7.3: delete is a tombstone "kept in the log so a restore
      cannot resurrect it; forget on either side is one op." A robot
      that synced before the forget would push those memories back on
      reconnect. The most direct principle-3 violation in the code.
- [ ] **A clock stamp on every spec record** (S spec, M hub) - only
      `SettingValue` carries `hlc`. Person, MemoryRecord, Entity,
      Relationship and Grant have `source` but no clock (plan 3.1 gives
      the grant one; the schema dropped it). Without it 7.3's "same id is
      a no-op unless newer" cannot be evaluated. `lib/hlc.ts` exists and
      is untested; test it while wiring it.
- [ ] **A spec-or-local verdict for each hub-internal table** (M) -
      `conversation_turns`, `scheduled_jobs`, `commands`,
      `notification_deliveries`, `cloned_voices`, `model_download_jobs`
      each say "promote when the robot needs it". Plan 4.14 syncs robot
      turns as conversation records, 4.7 runs timers on both nodes, and a
      household's "when I say X" command must work on a standalone robot
      (principle 2). Promote turns, jobs and commands now; record why
      the other three stay local.
- [ ] **Cut `spec-v0.1.0`** (S, Jesse's call: it is a release) - the bot
      repo pins a tag that does not exist. One tag unblocks Robot v0.1.
- [ ] **Mark `weather`, `define`, `joke`, `trivia` `platforms: ["home",
      "bot"]`** (S) - nothing in them is hub-specific; the robot needs
      weather offline-capable per plan 5.4.

**The link itself**

- [ ] **A Device record and `spec/link/`, spec-first** (M) - the
      envelope (`v, id, t, in_reply_to, ts_hlc, body, final`), the op
      shape (`opId, entity, entityId, upsert|delete|supersede, hlc, node,
      spec version, payload, prev`), link states, and the never-sync
      allowlist with its grep test, all in `spec/` before any transport.
      `deviceId.ts` is a plain-file stand-in; settings' device scope
      validates against nothing.
- [ ] **Sync engine decision** (design pass, L) - the research verdict:
      single-writer replicators (Litestream, LiteFS) are out; server-side
      engines (PowerSync, ElectricSQL, Turso Sync) need a database that
      is not SQLite; cr-sqlite gives column-level LWW from any language
      but calls itself not production-ready and loads a native extension
      into both runtimes. Recommendation: own a change-log table in the
      spec applied with column-level last-writer-wins by HLC, one
      algorithm in TS and Python with one fixture set, hub-authoritative
      as a policy (hub site id wins ties), memory as append-plus-
      invalidate so it never needs LWW on prose. Spike cr-sqlite first
      to validate the change-log design against a known implementation.
- [ ] **Copy the legacy link plumbing that was fixed on real reconnects**
      (S-M) - `deviceToken.ts` (365-day, sha256 stored, 20 per user),
      `hubIdentity.ts` (instance id minted once) and `hubEndpoints.ts`
      (an address book that must match the instance id before posting
      credentials: "a laptop on a cafe network gets a 200 from a
      stranger's box"), the bot's `pairing.py` (token 0o600, atomic,
      corrupt means "not paired", never a crash), `OfflineQueue` (max
      500, dedupe by key in place, drop oldest), duplicate-session
      eviction with `destroy()` on the old socket, a bounded writer,
      EADDRINUSE treated as down. Legacy had no HLC or merge; only the
      transport lessons transfer.
- [ ] **One pairing flow, with a rate limit** (M, verdict) - legacy grew
      three code flows (6-char pod, claim-by-hardware-id, 5-minute TV
      Quick Connect) and `/pair` had no limiter. Plan 7.1 is one flow;
      decide whether Quick Connect for TV is the same flow or a second.
- [ ] **Verdict: robot fallback order** (Jesse's call) - the legacy bot's
      `FallbackLanguageModel` is local-first; the plan is hub-as-brain
      with a sub-second connect timeout and no hedging. Decide before
      the robot's dialogue loop is rebuilt.
- [ ] **Python ports of the shared floor** (M, required for Robot v0.1)
      - the safety classifier, `normalizeForSpeech` and
      `records/ts/validate.ts` are TS-only; plan 4.3 says the floor runs
      on the robot even when the hub answers. Same corpus, both
      languages, kept identical like the recipe interpreters.
- [ ] **An export bundle** (M) - JSON, one file per record type,
      provenance kept; the fallback pairing path and the per-person
      export the spec already promises. Watch the W3C agent-memory
      interop group and the Agent Memory Protocol rather than adopting
      either; nothing is used widely enough to depend on.
- [ ] **Speak Wyoming and expose an OpenAI-compatible chat endpoint** (M)
      - Home Assistant satellites, Willow boxes and OVOS personas can
      then use the hub as their brain; the robot becomes one more
      Wyoming client. Hardware breadth for free, and it fits plan 8's
      ESPHome/HA posture. Legacy's Wyoming socket ran unauthenticated as
      admin; not that.
- [ ] **Round-trip fixtures across both repos** (S, once the link exists)
      - a record written on the robot and synced to the hub is byte-
      identical to one written on the hub; the robot never translates.

## Voice / robot

- [ ] Wake word past phase 1 (L) - mic capture + inference exists
      in-browser; everything else (barge-in in this repo, satellite mode,
      robot-side wiring) isn't built here.
- [ ] Robot pairing / the link API (L) - not implemented in `home` at all.

## Cross-cutting

- [ ] Cut a first real release (S, but blocking) - no tag has ever been
      made. The deploy-from-release-tag model, the clean-clone build
      check, and update delivery have never been exercised for real.
- [ ] Real i18n (L) - "language and region" is a stored preference today
      with no translation behind it.
- [x] The notification system (4.13) (L, a real working subset done
      2026-09-05, `docs/dev.md`'s "The notification system, a real
      working slice" entry) - declared types, `in_app` + Telegram
      channels, non-configurable types, `safety.flagged_turn` and
      `model.download_ready`/`failed` wired to real events. Still open:
      quiet hours, `passive`-level digest batching, browser push / Go /
      TV overlay / robot speech (no such clients exist yet), a real
      parent/guardian audience (see the Relationship/Grant work above),
      and package-declared notification types (the manifest's
      `notifications` field is read by nothing yet - a real, deliberately
      deferred extension point, not forgotten).

- [ ] **Doc drift the audit found** (S, but some of it is Jesse's call) -
      `.github/CLAUDE.md` says the rebuild follows `home/spec/design/`,
      which does not exist; the plan lives at
      `~/.claude/plans/purring-chasing-noodle.md`, outside every repo and
      unversioned. `.github/STACK.md` and the global `CLAUDE.md` point at
      a `home/agents.md` that does not exist either. Committing the plan
      into `home/spec/design/` needs a PII pass first (it names Jesse's
      machines) and is his call. Also stale: `spec/llm/README.md`
      ("non-streaming only") and `spec/ui/README.md` ("single-shot JSON")
      since streaming landed 2026-09-04; plan 5.1/5.6 still say `skill`
      for what is now `plugin`; "tier" means both routing tiers 0/1/2
      (plan 4.5) and package tiers 0/1 (plan 5.2), often in adjacent
      sentences, and one ladder should be renamed.
- [ ] **Roles versus grants is a wider conflict than the one item under
      People** (S decision) - the Grant spec removes age and role from
      authorization while `Person.role` stays required, `min_role` is on
      every manifest, and ENGINEERING.md, UI.md's kid presets and plan
      4.2/4.3/5.7 are all age-shaped. Safety still needs an age band
      either way: derive it from birthdate and put `age_range` in the
      turn context (S), then decide the rest once.
- [ ] **Content ceiling record and dials** (M) - `spec/README.md` lists
      it unbuilt; the safety classifier reads the band through a role
      proxy. Never mentioned here until now.
- [ ] **`@hono/zod-openapi` conversion** (M) - org rule: "any route you
      touch gets converted"; zero of 17 route files comply and dev.md
      tracks it as debt with no backlog line.
- [ ] **Rate-limit the remaining raw fetches** (S) - Telegram (fired per
      notification, no bucket) and the HF voice catalog bypass
      `tryConsume`; only `host.fetch` and Home Assistant go through it.
- [ ] **A generic wall, budget and probe layer before any media package**
      (M) - `rateLimiter.ts` is a non-blocking bucket only. Legacy's
      `quiet.ts`/`accessMonitor.ts`/`sessionKeeper.ts` trio encodes the
      2026-08-28 YouTube wall: a per-service wall remembered 24 h, daily
      caps split household 1500 / background 400 so background exhausts
      first, one probe per 6 h with the result persisted (the old probe
      ran five clients every 30 min and kept the wall up five days), a
      failure-quiet after three failures, one writer per cookie jar.
      Build it once, generically, before the first integration needs it.
- [ ] **The hub's Python runtime question in STACK.md** (S decision) -
      STACK.md gives the hub no Python, yet `tts` needs `uvx` at runtime;
      flagged in `spec/voice/README.md`, decided nowhere.
- [ ] **Identity and trust pieces plan v0.1 scopes and this file did not
      track** (M each) - passkeys, an approval queue, Quick Connect for
      TV sign-in, a household CA with `maipai.local` mDNS and a trust
      step (wake word phase 1 already needs a secure context on the
      LAN), hub-key signing of the bundled default set, the emergency
      kit and hub/SMB backup targets, a restore drill in the release
      skill, and the `user/` docs tier (only `dev/` exists).
- [ ] **Tests the audit found missing** (S) - `hlc.ts` seed and compare,
      `personLifecycle`, `access`, and one test proving a specific
      recalled memory text actually lands in the prompt for a matching
      query (memory tests stop at `recall`; prompt tests use synthetic
      matches).
- [ ] **Copy the legacy runtime guards** (S-M) - a download stall
      watchdog (a 7 GB checkpoint sat at "28 s left" for 21 min), 6-
      attempt backoff, negative caches that store only genuine misses
      (313 poisoned rows once purged), max resident models with an
      orphan sweep (orphaned runners forced every load to CPU: a 90 s
      "hi"), a boot watchdog capped at three reloads, and a crash-boot
      hold that refuses heavy compute for 30 minutes after a dirty boot
      (three power-offs in one night). Check `llmSupervisor.ts`,
      `modelDownload.ts` and `telegramChannel.ts` for equivalents first;
      the audit did not read them for that.

## Legacy: copy, re-examine, record

The rebuild is about 23k lines of app code against legacy's 413k
(172 route files, 168 pages, 60 chat tools, 22 releases). Per principle
8 nothing carries over by existing; per the org's "copy from legacy"
allowance, hard-won logic does. The chat, memory, link, voice, limiter
and UI copy items are filed in their own sections above; this section
holds what is left: features needing a verdict, and lessons that would
otherwise be lost with the mirror.

- [ ] **Verdicts for the features absent from both this file and the
      rebuild** (L, one line each, recorded here before anything is
      built) - MaiPai TV linear channels; Music Studio, karaoke and
      stems; Podcasts (with generated shows, gpodder, snips); Books,
      readers, OPDS and KOSync; Bookmarks, Reader and Clipper;
      Reference (Kiwix ZIM); the coding agent and sandbox; Remote (SSH,
      VNC, RDP); Notes and voice memos; Photo Frame; Cameras (Frigate);
      the Routines engine; Drop (file relay); Home Inventory; Maps
      (offline MapLibre plus GraphHopper); Recipes, Medical, Reverse
      Lookup, On This Day, Holidays, Moon, Local Events, Speed Test;
      File Converter; Spotlight search, Writing Tools, Watch and Listen
      Together, Cast; in-app docs; the Display/HUD pod pages; the DNS
      filter; family audio guardrails; storage locations; monitoring;
      uninstall; consent records; MCP in and out; remote engine pairing;
      SABnzbd/aria2; ESPHome flashing; the Electron desktop (HUD,
      hotkey, tray, dictation); Atom Echo and Tab5 firmware; the tvOS
      Top Shelf endpoint. Plus roughly 35 of legacy's 60 chat tools with
      no package and no line here (datetime, holidays, moonphase,
      onthisday, showtimes, recipes, medical, maps, forget,
      recall_conversations, request_media, set_status, sleep,
      service_status, machineStatus, others), and the bot's 83 skill
      classes in 55 modules (bot `dev.md` says "roughly 90").
- [ ] **The wake-word training and calibration pipeline** (L; bot
      `dev.md` already plans the port, the code is where the fixed
      pipeline lives) - `train_wakeword.py` plus `wakewordTrainer.ts`:
      event-replay calibration (per-window counting picked thresholds
      that measured 40-140 false accepts per hour live), gates of at
      most one false accept per hour and recall of at least 0.85 on
      held-out real audio, the possessive near-miss bucket, harvested
      false triggers. The trained manifest v2 reached 0.00 FA/hr and 85%
      recall over 34 minutes of real audio and still fires on "hey my
      pie".
- [ ] **The bot's voice loop numbers** (M, when the voice loop is
      rebuilt) - 0.3 s pre-roll with retry from the onset byte, 6 s wake
      patience, detector reset on every sleep (the robot re-woke
      itself); Smart Turn v3.2 endpointing (threshold 0.5, 0.2 s probe
      every 0.25 s, 1.2 s ceiling, 12 s max, 120 ms per probe budget);
      barge-in (0.6 s confirm, stop phrases bypass, backchannels never
      stop, duck 0.35 without AEC and 0.75 with, 0.25 s playout slices
      because blocking writes left the mic unwatched, 0.7 s re-arm
      grace, self-echo at 0.8 overlap, interrupted text clipped from
      history); output leveling to a target RMS and a sink drain sized
      from device latency plus 0.15 s (the last second of every line
      used to be lost); the browser's barge-in thresholds
      (`useHandsFree.ts`: 700 ms arm, RMS 0.04 plus probability 0.60
      over 12 frames). The hub's `sentenceSpeechScheduler.stop()` exists
      and nothing calls it.
- [ ] **The bot's four bench harnesses** (L) - honesty (105 questions,
      raw versus guarded), interaction (424 cases), latency (refuses to
      run on a busy machine), conversation (34 real broken replies),
      rebuilt against the turn engine. The plan's "bench on demand" tier
      has no benches.
- [ ] **Lessons to record in the right doc, so they survive the mirror**
      (S) - in org `CLAUDE.md`: cache only genuine misses, never a
      transient failure; never throw synchronously inside a socket
      callback (the 7/29 three-hour outage); the age-gate inversion
      (resolving a stream through an adult account removes a platform's
      own 18+ refusal for a kid profile: gate the stream route, not the
      search), which belongs with the safety invariants; a green tick is
      never inferred from the absence of bad news (`check.sh | tail`
      once shipped a lint failure by reporting tail's exit code). In
      `home/docs/dev.md`: the laptop power path caused the hub's hard
      power-offs (GPU clock cap re-asserted hourly, charge cap 28%); the
      Windows self-update rules (Defender holds `dist/` handles past
      3 s, untracked files are not dirty, an unresolvable upstream never
      reads "up to date"); VRAM hygiene (Vulkan ignores
      `CUDA_VISIBLE_DEVICES`; a context-size mismatch between warm-up
      and the real call costs a 930 ms reload per turn); the
      chat-latency "do not change without re-testing" list (warm-up
      prefix equals chat prefix, background LLM work must yield: the
      August 15-second regression); the HTTP/1.1 six-connection cap
      shared across tabs (SSE once starved `/api/health`); 16 px inputs
      or iOS zooms, never `maximum-scale=1`. In `bot/docs/dev.md`: the
      bodies of legacy `hardware.md` (pin map, I2C and USB budget,
      PCA9685 versus the mux) and `design-decisions.md` (58 dated
      sections), which the fresh repo cites by path and does not
      contain; the driver quirks (ST7789 at 16 MHz, 40 MHz draws
      nothing; the PCA9685 driver never clears ALLCALL; the Pi 5 cannot
      drive WS2812, hence the Pico; 22.05 kHz crashed Piper on the
      array); "instruments lie" (history primed with a clock answer,
      lifetime CPU from `ps`, repeated-prompt benches hiding prompt
      evaluation).

## The other three products (status, not this repo's job to fix)

- **`bot`** (robot companion) - only docs ported from the legacy
  pre-rebuild code onto the fresh repo; the hardware-bench work referenced
  elsewhere was on the *old* codebase, not this platform. Blocked on the
  `spec-v0.1.0` tag (see "Portability and the link"), and its `dev.md`
  cites legacy `hardware.md` and `design-decisions.md` by path without
  containing them (see "Legacy: copy, re-examine, record").
- **`catalog`** (public package store) - repo scaffolding only
  (LICENSE/NOTICE/README, standards pin).
- **`go`** (Apple TV/iPhone client) - marketing copy only, no real app yet.

## Wave 2 additions (2026-09-06)

Jesse asked for the backlog to be filled out to "a fully working app" and
split into four sessions that never collide. The split is in
`docs/plans/wave-2.md` (ownership, shared-file protocol, contracts) and
one work order per session (`session-c-brain-and-voice.md`,
`session-d-packages-and-store.md`, `session-e-ui-and-docs.md`,
`session-f-platform-and-trust.md`). This section lists only what the
2026-09-06 review found missing from this file; everything already
listed above is assigned in the plans, not repeated here. The review
read the platform plan's chapters 4, 5, 7, 12 and 13 against the code
on `main` plus the Wave 1 worktrees, the org standards, and the legacy
mirror's module list and header comments. Each item names the session
that owns it.

**First run and the household lifecycle**

- [ ] **The first-run wizard, end to end** (M, E for the screens, F for
      the routes) - plan 12 in full: language, locale and time zone,
      household name; the owner with a passkey or password; the
      AI-outputs disclaimer and the one-time adult acknowledgment; hardware
      detection and the model set that fits, with the first download's
      size and time shown; "trust this hub"; the default package set;
      Tailscale as an optional step; the emergency kit shown once; a
      backup target; done with "what to try"; restore always the second
      screen. Only `POST /api/auth/setup` (the owner) exists today. Legacy
      `SetupWizard.tsx` had welcome, profile, PIN, consent, area,
      components and download steps; its consent step (uncensored,
      internet, companions, liability) is superseded by the org's
      acknowledgment and privacy rules, kept as a reference only.
- [ ] **A family member joins, a kid profile, a guest** (S-M, E and F) -
      the QR from the admin's screen carrying the address and the CA, the
      picker, PIN or passkey; birthdate in, band out, presets shown to
      the parent with what they will see; a guest with an expiry and no
      memory (plan 12, 7.4).
- [ ] **Lifecycle events** (S-M, F) - `enabled` on Person, guest expiry
      removal, memorialise (read-only profile, PIN cleared, sessions
      revoked, export offered), the band change on a birthday with a
      passive notification to parents (plan 7.4). None exist.
- [ ] **Sessions per device with revoke, optional TOTP for owner and
      admin** (S-M, F) - plan 4.1; the identity slice deferred both.
- [ ] **Time allowances and schedules per category** (M, F backend, E
      controls page) - plan 4.2 names them as household settings enforced
      in the turn engine and package host; nothing exists.

**Health, updates, storage, install**

- [ ] **The sidecar contract** (M, F) - plan 4.12: one supervisor for
      llama-server, the voice programs, SearXNG and later Kiwix and
      ComfyUI, with declared startup order, health URL, ports, mounts,
      backup mode and exclude patterns. Today `llmSupervisor.ts`,
      `embedSupervisor.ts` and `ttsSupervisor.ts` are three copies of the
      same shape.
- [ ] **Storage: layout, quotas, disk-full policy, NAS mounts** (M, F) -
      plan 4.15's `data/` layout, per-person quotas, caches-first
      eviction then a Repairs item, media libraries as declared mount
      points; a Storage page (E). Only "storage locations" appears above,
      as a legacy feature awaiting a verdict.
- [ ] **Uninstall, factory reset, hub migration, two hubs** (S-M, F) -
      plan 4.15; none exist. Migration keeps the instance id and CA so
      pinned clients survive; two hubs are two instance ids and a client
      remembers its choice.
- [ ] **Redacted diagnostics with a `TO_REDACT` list in the spec** (S,
      F) - plan 4.13; a test that no secret, address or family name
      survives the download.
- [ ] **Service install and the one-line installer** (M, F) - a Windows
      service, launchd, systemd, the GPU power ordering legacy `run.ps1`
      learned, port-conflict detection; `install.sh`/`install.ps1`
      checking out the latest tag, never `main` (legacy had both under
      `docs/public/`).
- [ ] **The Windows self-update rules as tests** (S, F, with self-update)
      - Defender holds `dist/` handles past 3 s; untracked files are not
      dirty; an unresolvable upstream never reads "up to date". Listed
      above under "Lessons to record"; now a build item, not a note.
- [ ] **Performance budgets measured** (S-M, F) - ENGINEERING.md names
      budgets and plan 4.11 says the archived latency numbers gate the
      first release (legacy `chat-latency.md`: 200 to 900 ms warm first
      token after six fixes, each documented); no bench measures first
      token, page open or cold start here.
- [ ] **Web push as a notification channel** (S-M, F backend, E opt-in)
      - the PWA exists after Wave 1, so the "no such clients yet" note
      above no longer holds; legacy `push.ts` (VAPID keys generated once,
      never a manual step) is the reference.
- [ ] **A `Device` record** (S spec, F) - plan 7.1's device kind, name,
      area, capabilities, token, watermarks; needed by device tokens and
      Quick Connect now and by the link later. `deviceId.ts` is a plain
      file stand-in.

**Packages**

- [ ] **The Tier 1 host under Deno, and the MCP spike** (M-L, D) - Hub
      v0.1 scope ("the Deno process host and the MCP spike"); not a line
      of it exists, so no code package can run. The knowledge lookup is
      the first Tier 1 package, proving the sandbox.
- [ ] **The store host on the hub** (M-L, D) - plan 4.10: install from
      the signed index, verify twice, unpack per version, smoke before
      enable, per-package channel, rollback, the permission prompt, the
      tamper suite. The item above ("catalog browsing and install")
      covers only the page.
- [ ] **The catalog tooling and the signed index** (M, D) - lint, pack,
      sign, index, scorecard, the `check` CLI, TUF-shaped root, targets
      and timestamp, the second signer, the public CI; the catalog repo
      has none of it. The bundled default set moves there and `home`
      keeps a signed copy.
- [ ] **`ask` continuation, `confirm`, `end_conversation` from a result**
      (S-M, D produces, C consumes) - `result.schema.json` has them;
      `runRecipe` never sets `ask`, and the turn engine reads none of
      them. A lookup cannot ask "which Springfield" deterministically.
- [ ] **Consequential packages need a confirmation at run time** (S, C)
      - `consequential: true` exists in the manifest and raises nothing;
      the security-domain check happens at command creation only.
- [ ] **A `compute` recipe step** (S, D, both interpreters) - math and
      unit conversion need no network; a safe expression library beats a
      model doing arithmetic.
- [ ] **Audit `host.*` against plan 4.9** (S, D) - `host.log`,
      `host.config.get`, `host.data.forget`, `host.diagnostics` and the
      emulator twins are missing or unverified.
- [ ] **Package-declared notification types** (S, D and F) - the
      manifest's `notifications[]` is read by nothing (noted above under
      the notification system, now assigned).
- [ ] **Almanac: date, time, holidays, moon phase, on-this-day as one
      package** (S, D) - legacy shipped five tools for this.
- [ ] **The speech lint on every package `speech` string** (S, C
      defines, D runs) - `PACKAGES.md` requires it; nothing checks
      `speech` templates for the housemate test's mechanical half.

**Intelligence and voice**

- [ ] **A naturalness bench** (S-M, C) - plan 4.5's paired robotic and
      natural phrasings corpus scoring a model and prompt before it
      becomes a default; the framing example pairs (time as a fragment,
      yes/no as a fragment, a list as a sentence) joining the stable
      prefix. Neither exists.
- [ ] **Spoken numbers by library, in both languages** (S, C) -
      `normalizeForSpeech.ts` hand-rolls `numberToWords` (principle 6 says
      a library: `to-words` on the hub, `num2words` on the robot, licences
      checked), with the clock-time and unit ruleset beside it and one
      fixture set for both; the Python twin does not exist.
- [ ] **STT on the hub** (M, C) - no STT engine, route or session exists;
      push-to-talk (listed above under Chat surface) is blocked on it.
      sherpa-onnx with Moonshine is the robot's choice and should be the
      hub's too (one runtime, both products).
- [ ] **Import from the legacy hub** (M, C) - Hub v0.2 scope: people,
      memories and conversations from the legacy data directory into
      spec-shaped records with provenance, run once, dry run first,
      backup required. Without it the family starts from zero.
- [ ] **Routing embeddings persisted per package** (S, C, with Tier 1) -
      re-embed only when an example changes; a cold boot must not
      re-embed sixty packages.

**Deferred to Wave 3, recorded so it is not lost**

- The link transport, the oplog and sync engine, pairing over the
  network, the Python ports of the memory store, the Robots page: one
  session after the four merge, because it touches every record table.
  Wave 2 lays what it needs (Device, device tokens, Quick Connect, HLC
  everywhere, the never-sync allowlist as a spec test).
- Media: the player runtime (plan 4.8), Videos, Music and Podcasts
  rebuilt after their verdicts, the wall and budget layer before the
  first of them. Hub v0.2 scope; the lookups ship first by the rule at
  the top of this file.
- Generation (image, video), the Desktop shell, pods on ESPHome, Go.

## How to use this file

- Check an item off only when it's shipped and verified (per
  `getmaipai/.github`'s own definition of done), not when it's started.
- A new gap found while working on something else gets added here, not
  just mentioned in passing in `docs/dev.md`.
- Size tags are a rough gut check for planning, not a commitment.
