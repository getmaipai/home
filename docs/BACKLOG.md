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

- [x] **A real `quality_scale.yaml` per package** (S per package) -
      session-d-packages-and-store.md step 1, 2026-09-06: done for the 5
      packages D owns (define, joke, trivia, weather, storytime-style),
      each stating bronze/silver/gold against docs/PACKAGES.md's real
      criteria, checked by `spec/tests/ts/package-bronze.test.ts`.
      `remember`/`recall` are C's (session-d's ownership map); still
      open for those two.
- [x] **A `smoke` entry per package** (S-M per package, M to design the
      mechanism once) - session-d step 1, 2026-09-06: the mechanism is
      built (`lib/smoke.ts`: a `recipe_fixture` check against a
      `HostEmulator`-run recipe for a Tier 0 plugin, a `static` load
      check for a `skill`, `deno_test` reserved for Tier 1/step 5),
      wired to a daily core job and a boot-time pass (standing in for
      "at install" until the store's real install flow exists, step 6),
      and a failure disables the package and raises an issue
      (`lib/issues.ts`, a local stub until F's real one merges). Declared
      for D's 5 packages; `remember`/`recall` still need their own
      (C's). A package with no `smoke` entry is treated as "not yet
      bronze," never disabled - this session's infrastructure must not
      reach across ownership lines to break a package it doesn't own.
- [x] **A user-tier `README.md` and `CHANGELOG.md` per package** (S per
      package) - session-d step 1, 2026-09-06: done for D's 5 packages;
      `remember`/`recall` still open (C's).
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
All six are `kind: "plugin"` recipes (backend/packages/<name>/recipe.json),
not `kind: "skill"`s in this repo's own architectural sense (a `SKILL.md`
composed into the system prompt) - `storytime-style` is the only real one
of those today. "Bundled skills" in this doc is the colloquial, family-
facing sense, not the manifest kind.

- [ ] **Fix trivia: it reveals the question and the answer in the same
      reply** (blocked - see "Plugin/recipe `ask`-continuation" under
      Advanced tool calling below) - Jesse noticed (2026-09-06) that
      asking for a trivia question immediately gets both, which isn't
      really trivia. Root cause confirmed in `backend/packages/trivia/
      recipe.json`: its one `format` step interpolates `{question}` AND
      `{answer}` into a single output in one shot - there's no LLM
      authoring this reply and no instruction to fix, since the whole
      recipe is deterministic fetch -> pick -> format. Needs the
      `ask`-continuation primitive below before it can be rewritten as a
      real ask-then-reveal flow (`recipe.json` splitting into an `ask`
      step for the question and a resumed step that compares the user's
      answer) - not fixable by editing this recipe alone.

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
      mostly a recipe + manifest away. Session E's step 2 (2026-09-06)
      scoped "a running timer, as its own page and a card" here and found
      nothing to build against yet: no recipe, no manifest entry, no
      `host.schedule` caller for a timer specifically. Left for whoever
      lands the recipe; the frontend side is a small `list`/`card_grid`-
      shaped page once there's a route.
- [ ] Shopping / todo lists (M) - needs a new record type (a list, with
      items), so a small spec addition, not just a recipe. Session E's
      step 2 (2026-09-06) scoped "lists, as their own page and a card"
      here too and confirmed the backend side is genuinely unbuilt
      (D, step 8, not started): no `spec/schemas/list.schema.json` despite
      being referenced from `manifest.schema.json`, none of
      `GET/POST /api/lists`, `PATCH/DELETE /api/lists/:id`,
      `POST /api/lists/:id/items`, `PATCH/DELETE /api/lists/:id/items/:itemId`,
      `POST /api/lists/:id/clear` exist. The frozen shape (D to E,
      docs/plans/wave-2.md) is `{ id, person, scope, kind: "shopping" |
      "todo" | "custom", title, items: [{ id, text, done, due_at?,
      created_at }], hlc }` - once it lands, the frontend page is a real
      `list` schema node (bind `GET /api/lists`, `row_action` toggling
      `done` via a `PATCH`, `batch` for clear-all) the same way Memory's
      page was built, no new node kind needed; a per-list detail view
      (its own items) is a `split_view`/`detail_pane` pair, the first real
      use of either since they were added for catalog completeness.

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

**Sourced-answer UI (citations, favicons)** - Jesse's ask (2026-09-06):
noticed other chat apps mark which sentence used which source, researched
both prior art and current practice before adding these. Both items below
are blocked on any sourced skill actually existing (Web search above is the
first) - nothing to cite until then, so treat as groundwork to design
alongside the first sourced skill, not before it.

- [ ] **Inline citation markers on sourced answers** (M-L) - doesn't exist
      yet. Legacy (`home-legacy.git`, `loki-doki`) shipped this completely
      once (issue #8, Open WebUI-inspired) and it's worth reading before
      designing fresh, not porting verbatim (feature scope is re-examined
      per `getmaipai/.github`, not carried): a fixed `SOURCE_TOOLS`
      allowlist (search/news/youtube/where-to-watch/holidays/contentRating)
      produced a `Source[]`; `companionTurn.ts` appended a numbered
      `Sources:\n[1] Title — url` block to the prompt and instructed the
      model to cite inline as `[1]`, `[2]`; an SSE `sources` event carried
      the list to the client, persisted to a `messages.sources` column so
      chips survived a reload; the frontend rewrote `[1]` into a
      backtick-wrapped `` `CITE:1` `` token so react-markdown's own
      inline-code renderer could intercept it and swap in a hover-tooltip
      chip linking out, plus a numbered `SourcesCard` under the settled
      (non-streaming) reply. It was entirely prompt-trusted - no
      structural/tool-enforced citation - and scoped to that one tool
      allowlist, never general RAG/notes retrieval.
      Current practice (researched 2026-09-06, not recalled): two real
      patterns exist. Perplexity's is the same shape legacy already built -
      inject a numbered source list, instruct `[N]` markers, and on the
      client accumulate the FULL text buffer before parsing (a marker can
      split across streaming chunk boundaries - parsing one delta in
      isolation misses it), then map `N` to the source list. Anthropic's
      Citations API is structurally different and more reliable: the model
      returns separate content blocks, each carrying real citation
      objects (`document_index`, `cited_text`, a char/page/block location)
      instead of a bare `[N]` in prose, streamed via a dedicated
      `citations_delta` event - `cited_text` doesn't even count as output
      tokens. That needs either a hosted API with native support or real
      constrained-generation work on our own llama-server stack to fake
      structurally, so the pragmatic path here is almost certainly the
      first pattern (which is what legacy already validated), with the
      same streaming-safe accumulate-then-parse discipline Perplexity's
      own docs warn matters.
- [ ] **Favicon fetch-once, cache, and reuse for citation/source chips**
      (S) - doesn't exist yet, but legacy had a complete, two-layer
      version worth reusing as-is (hard-won resolver/cache logic, not
      feature scope, so this one IS a real port candidate per
      `getmaipai/.github`): client-side, `faviconCache.ts` kept an
      in-memory + `localStorage` cache (7-day TTL, `data:` URLs, in-flight
      dedup so concurrent callers for the same domain share one fetch);
      server-side, `/api/img` (`imageProxy.ts`) never let the browser hit
      a third-party favicon host directly, fetching once through an
      SSRF-guarded proxy, disk-caching bytes keyed by a URL hash with a
      negative-result cache for confirmed-missing icons, and a periodic
      size-bounded sweep. Confirmed by 2026-09-06 research this isn't just
      a performance nicety: browser favicon caches are a known privacy/
      fingerprinting vector (persist separately from cookies/history,
      survive some browsers' private-mode and cache-clears), and a raw
      `<img src="https://icons.duckduckgo.com/...">` leaks the household's
      IP and Referer to every cited domain on every reply - exactly the
      leak class the legacy proxy's own comment already named as its first
      reason for existing. Wire this in as part of the citation-chip work
      above, not standalone - a favicon cache with nothing to cache is
      pointless work today.

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
- [ ] **Find people and things** (L, Jesse's ask, 2026-09-06) - two
      distinct halves. (1) Live location, ideally via iCloud/Find My -
      real per-account OAuth/auth plumbing (same shape as Calendar/Email
      above: privacy-sensitive, needs its own consent design, and Find
      My specifically has no public API Apple supports, only reverse-
      engineered ones - a real feasibility/ToS check before committing to
      this path, not just an integration to wire up). (2) A static
      location entry with no integration at all - "remember my passport
      is in the safe" - which is a pure lookup already buildable on top
      of the existing `remember`/`recall` skills (Skills, above) with no
      new plumbing; ship this half first regardless of what happens with
      (1), by the same lookup-before-integration rule the Skills section
      already states.

## Vision

- [ ] `host.camera.still` (L) - no pipeline, no hardware path in this repo
      (the hub isn't the camera; this likely means "receive a photo the
      robot or a phone took," not "the hub has a camera").
- [ ] `host.ocr.read` (M) - RapidOCR already decided as the library
      (`docs/dev.md`); needs wiring, a recipe step, and a real image input
      path (upload? robot capture?) before it's reachable at all.
- [ ] **Pet recognition: name a pet, mark its owner, recognize it again**
      (L, Jesse's ask, 2026-09-06) - "facial"/body recognition from an
      image plus, ideally, bark/vocalization recognition from audio.
      Blocked on the same missing image-input path as `host.camera.still`
      above (no pipeline exists to get a photo INTO the hub at all yet),
      and bark/sound recognition is a real second model, not a
      by-product of the vision half. Ownership is not new scope to
      invent: "pets need ownership" is one of Jesse's own original
      points in `docs/dev.md`'s "Entities, relationships and grants" -
      a pet is a `kind: entity` record and "owns"/"belongs to" is exactly
      the Relationship edge that spec already defines, so this is a
      recognition-and-UI problem sitting on top of hub work that's
      already spec'd but not yet built ("The hub half of entities and
      relationships," People/relationships section above), not a new
      data model to design from scratch.

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
- [ ] **Plugin/recipe `ask`-continuation: let any plugin pause for a
      real answer, not just reply in one shot** (L) - surfaced fixing
      trivia (Skills above), and Jesse's own framing once he saw the
      cause (2026-09-06): this needs to be a capability every plugin can
      use, not a trivia-specific hack. It's a distinct gap from Tier 2
      tool calling above - not about the model choosing which plugin to
      call, but about a plugin that's already running needing to pause
      mid-recipe, show something, and resume once the person answers.
      Half-built already: `PluginResult.ask` is a real field in
      `result.schema.json`, and both interpreters (`spec/interpreters/
      ts/recipe-interpreter.ts` and its Python twin) support an
      `"op": "ask"` recipe step - proven by the conformance fixture
      `spec/fixtures/recipes/ask-disambiguate.json` - but nothing wires
      it to anything real: `turnEngine.ts`'s plugin branch only ever
      reads `result.value.reply`, silently falling back to "Done." if a
      recipe ever produced `ask` instead; no bundled package uses the
      `ask` op; and there is no cross-turn state anywhere remembering
      "this conversation is mid-recipe, paused at step N, waiting on an
      answer that binds to `expects`." `turnEngine.ts`'s own header
      comment (~line 1142) already names this gap, though it's gone
      slightly stale - it says the interpreter has no ask-producing step
      at all, which the fixture disproves, but its actual conclusion
      ("nothing routes a follow-up deterministically today") still
      holds. Real design work before code: where paused-recipe state
      lives and how a follow-up turn gets routed back into resuming the
      right pause instead of hitting the normal router again, a timeout/
      abandon story (the person never answers, or asks something
      unrelated instead), and whether `ask` should offer real UI (tap a
      multiple-choice option, not just type free text) given `spec/ui`'s
      schema-driven pages already exist elsewhere in this app. Once this
      lands, trivia's `recipe.json` is the first real caller: split into
      an `ask` step for the question and a resumed step that compares
      the answer, instead of today's one `format` step revealing both.

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

- [x] **Send prior turns to the model** (S-M) - shipped, Session A step 3
      (2026-09-05): `buildConversationWindow()` in `lib/conversationHistory.ts`,
      newest 4 turns always kept verbatim, older ones added
      most-recent-first under a 1,200-token (chars/4) budget, exactly
      legacy's numbers. `maybeRefreshConversationSummary()` refreshes the
      rolling summary post-turn (never in the request path) once at
      least 4 turns have fallen out of the window since
      `summary_through_turn`.
- [x] **A speaker block in the prompt** (S) - shipped, Session A step 1
      (2026-09-05): display name, nickname, role, an age band (derived
      from birthdate when present, role otherwise), and locale (the real
      key is `household.locale`, not `core.locale` as this item names it)
      with a locale-formatted local time replacing raw ISO UTC.
- [x] **A household context block** (S) - shipped, Session A step 1
      (2026-09-05): every active person's display name and role
      (`lib/access.ts`'s `listActivePeople()`). Presence and "what
      packages are installed" are not built - presence has no signal
      source yet (robot/ambient-context, not this session), and the
      plugins list already exists as its own separate prompt section
      (`pluginsListLine()`, predates this item).
- [x] **Stable-first prompt order with a persona re-anchor** (S) -
      shipped, Session A step 4 (2026-09-05): identity/companion/rules/
      standing-skills stable, household/speaker/memory/re-anchor/summary/
      matched-skills/time volatile; `companionReanchorLine()` repeats the
      persona's `display_name` right after the memory block,
      unconditionally.
- [x] **Per-section prompt budget test** (S) - shipped, Session A step 4
      (2026-09-05): every section (rules, companion, memory, plugins,
      skills, summary) has its own real cap via a shared `capSection()`
      (the ellipsis now counts inside the cap - a genuine off-by-3 bug
      the old per-section inline copies all had, fixed in the same pass).
- [ ] **Rate-limit `/api/turn` and `/api/llm/*` per person** (S) - named
      in `spec/llm/README.md`, tracked nowhere.
- [ ] **Decide what an emptied conversation becomes** (S decision, found
      by Session A step 3's own code review, 2026-09-05) -
      `runRetention()` purges aged-out `conversation_turns` but never
      touches the `conversations` thread record once every one of its
      turns is gone, so it lingers forever with `turn_count: 0` and a
      stale `updated_at`. Auto-close, auto-delete (tombstone), or a
      household setting are all real options; the contract in
      `docs/plans/session-a-intelligence.md` doesn't specify one.

**Memory**

- [x] **Scope recall to the actor** (S, privacy bug) - shipped, Session A
      step 2 (2026-09-05): `recall()`'s new `selfOnly` option makes the
      turn engine's own call require `record.person === actor.id` for
      person-scope, regardless of role; the parental view
      (`GET /api/memory`, `POST /api/memory/recall`) is unchanged.
- [x] **Person-scoped `remember`, with turn provenance** (S) - shipped,
      Session A step 2 (2026-09-05): a word-boundary first-person check
      in `packageHost.ts`'s `Host.memory.remember` writes `scope: person,
      person: actor.id` when the recipe step leaves scope unset (an
      explicit scope from a recipe step still always wins); `source` is
      the real turn id end to end (`turnEngine.ts` generates it once,
      up front, and hands it to `createHost()` and to the turn's own
      `conversation_turns` row).
- [x] **Wire `embed` into recall** (M) - shipped, Session A step 5
      (2026-09-05): `memory_embeddings`/`pending_embeddings` tables,
      embed on write with a `pending_embeddings` retry queue drained by
      a real `every:1m` core job, `recall()` scores real cosine
      (`0.7 cos + 0.2 importance + 0.1 recency`, floors 0.55
      episodic / 0.37 durable, legacy's tuned numbers ported verbatim),
      keyword overlap as the fallback when no vector exists either
      side, entity-first pass kept. **Still open**: the legacy eval
      probes are ported and passing 7/11 (`backend/scripts/bench/
      memory-eval.ts`), but only against the stub embed backend - the 4
      failures are the true paraphrase cases a stub can't fake. Re-run
      against a real downloaded chat model (unlocks the real
      nomic-embed-text-v1.5 spawn) before trusting either the floors or
      the weights for v0.1; see docs/dev.md's step 5 entry.
- [x] **The memory judge: extract at turn end, consolidate at idle** -
      shipped, Session A step 6 (2026-09-05): `lib/memoryJudge.ts`, a
      real `memory.judge` core job (every:1m) per `source: model` turn -
      one grammar-constrained (`response_format`/`json_schema`, added to
      `LlmCompleteOptions` and the wire types this pass) extraction call,
      tier derived from category in code (not asked of the model - "the
      schema is tiny on purpose"), dedupe against the speaker's own
      readable records at cosine 0.5/top 5 (`similarByVector()`), a match
      always supersedes rather than inserts, a contradiction closes
      `valid_to` on the old record. Poison guard (3 attempts, tracked
      persistently across ticks via new `judge_status`/`judge_attempts`
      columns, then `judge_failed`) and one `memory.updated` notification
      per run that wrote something (the notification registry already
      existed - this added one entry, not the system itself). Legacy's
      rules ported (source rule, time rule, discard rules) with one real
      adaptation: possessives resolve to the SPEAKER'S REAL NAME, not a
      generic "the user" - this platform has multiple named people per
      household reading the same facts, unlike legacy's one-account
      assumption, so "the user's wife" would be ambiguous the moment a
      second person can read it. `memory_ids` provenance needed no new
      column: `remember(..., source: turn.id)` is exactly what
      `listConversationTurns()` already joins on (step 3). Consolidate is
      scoped to what's cleanly buildable on existing primitives -
      contradiction detection (ported from legacy's own consolidate.ts)
      and demoting never-recalled durable records (`uses = 0`, 30+ days
      old) - not the near-duplicate MERGE pass (needs a "retire two old
      records into one new one" primitive this store doesn't have yet)
      or "re-tense expired states" (nothing consumes `valid_to` yet -
      real bi-temporal reads are step 10's own job). Entity-record
      creation and procedural/Notes routing are also real, deferred gaps:
      the plan's own step 6 schema has no `entities` or `kind` field, so
      neither was built. Bench (`backend/scripts/bench/judge-eval.ts`,
      LongMemEval-shaped): run against the stub chat backend, extraction
      never produces valid JSON (the stub only echoes text), so 0 facts
      were ever written - the honest result is abstention trivially
      passing (nothing to hallucinate) and the knowledge-update case
      failing (nothing to update). Needs a real chat model before this
      bench means anything; see docs/dev.md's step 6 entry.
- [x] **A maintained profile block per person** - shipped, Session A
      step 7 (2026-09-05): one pinned, person-scoped `category: identity`
      record per person (`lib/memory.ts`'s `PROFILE_SOURCE` marks it,
      `getProfileParagraph()` is the read side), written and rewritten
      ONLY by `memory.consolidate` (the weekly job, never the per-turn
      judge) from that person's own facts via a small chat call, capped
      in code at 600 chars regardless of what the model returns.
      Injected whole at the top of `buildSystemPrompt()`'s memory block,
      before any recalled item, sharing that section's existing budget
      rather than a separate cap of its own. ChatGPT and Claude both
      inject a maintained summary rather than a search-result list;
      Letta's memory blocks are the same idea.
- [x] **Dated memories in the prompt, and a closing reminder** (S) -
      shipped, Session A step 4 (2026-09-05): each bullet carries "(as of
      Sep 2, 8 days ago)" off `created_at`; the block ends with one fixed
      trust-these-facts reminder. Absolute day count, not legacy's "N
      weeks ago" rounding - the plan's own text asked for "<n> days ago"
      literally.
- [ ] **Use the bi-temporal fields, and add a clock to every memory**
      (S in the spec, then hub) - the `hlc` half shipped, Session A step
      10 (2026-09-05): `memory-record`/`person`/`grant` all carry `hlc`
      now, set from `lib/hlc.ts` on every real write (`remember()`,
      `supersede()`, `archive()`, decay, demotion, a person's own
      create/edit/role-change/delete, `logTurn()`) - `conversation_turns`
      and `conversations` (step 3) already had it. The `valid_from`/
      `valid_to` half shipped earlier, Session A step 6: `remember()`/
      `supersede()` accept and write real values (the judge sets
      `valid_to` on a dated state and closes it on a contradiction),
      where every write used to force both to null. **Still open**:
      nothing READS `valid_to` yet - recall doesn't prefer currently-
      valid facts over expired ones. "Did this change" and "we never
      discussed that" are the two cases assistants fail most
      (LongMemEval); the 2026 temporal-memory results say to organize by
      when things happened, not when they were said.
- [ ] **Schedule `runMaintenance`** (S) - decay exists and is only
      reachable by a manual route; step 5 wires it to the scheduler.
      (The other half of this item, `recall` bumping `uses` on 20
      matches while 5 reach the model, shipped in Session A step 2,
      2026-09-05: `recall()`'s new `bumpUsage` option lets the turn
      engine bump usage only on what actually reached the prompt.)
- [ ] **Memory in the chat UI** (S-M) - a "memory updated" chip when the
      judge writes, per-message "remember this" and "forget this"
      actions. **The per-person memory page is done** (session E step 5,
      2026-09-06, `frontend/src/apps/memory/MemoryPage.tsx`'s
      `OtherPersonMemories`): an owner/admin picks a child from the same
      person picker Conversations uses, sees that child's real memories
      (`GET /api/memory?person=`), and can export
      (`GET /api/memory/export`) or forget everything
      (`POST /api/memory/forget`) about them - both real routes with no
      frontend caller before this. "What changed since" from `?since=`
      (this step's own brief) is still not built: `GET /api/memory` has
      no `?since=` handling at all server-side (confirmed by reading
      `parseListOptions` in `backend/src/routes/memory.ts` - it only
      reads `scope`/`person`), unlike Conversations' `GET /:id/turns`,
      which already supports a real `since`.
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

- [x] **A Companion/Persona spec record** - shipped, Session A step 8
      (2026-09-05), as a `companion` block on the existing manifest
      shape rather than a new top-level `spec/schemas` record:
      "companions are packages" (`kind: "companion"` already existed in
      manifest.schema.json's own enum). Identity (`display_name`,
      `pronouns`, `tagline`), a short `backstory`, `interests`, 3-5
      few-shot `examples` (legacy's review: "the single biggest lever
      for small-model voice fidelity," now a real few-shot block in the
      composed prompt, not just stored), a linked `voice_id`, a
      per-companion confirmation pool (`replyVariation.ts`, scoped to
      the one constant worth it this pass, shared pool as the default),
      and the prompt prefix using `display_name` instead of a hardcoded
      "You are MaiPai" (already true since step 4; this step just made
      the catalog itself real packages). Four bundled companion packages
      (`default`/`buddy`/`pal`/`tutor`) replace `lib/persona.ts`'s old
      hardcoded array. Still open: the plan's nine sliders (four dials
      shipped, mapping or justifying the rest is unstarted) and
      activation steering (see that item below, unrelated to this one).
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
- [x] **A persona consistency test** - shipped, Session A step 8
      (2026-09-05), as a bench (`backend/scripts/bench/persona-eval.ts`)
      rather than the deterministic suite: ten scripted exchanges through
      the real turn engine per bundled companion, scored by string checks
      (address form, length cap, forbidden phrases). Run against the stub
      chat backend: address-form and length-cap pass structurally (40/40
      each - a content-blind echo can't leak another companion's name or
      run long), forbidden-phrases (12/40) is honestly uninformative
      against a stub that echoes the user's own words regardless of any
      system prompt. Needs a real chat model before this means anything
      for persona fidelity; see docs/dev.md's step 8 entry. A
      model-judged version is still real, unbuilt work.
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
- [x] **Output-side safety on streamed sentences** - shipped, Session A
      step 9 (2026-09-05): `runTurnStream()`'s own `tokens` generator is
      wrapped by a new `gateOutputSafety()` (`lib/turnEngine.ts`, not
      `streamTurnEvents` - the route layer just consumes whatever the
      engine hands back), buffering deltas into whole sentences (the
      chunker, moved to `spec/safety/ts/sentenceChunker.ts` per this
      item's own plan text) and checking each with the identical
      `evaluateSafety()` the input path uses. A refuse category throws
      before the offending sentence (or anything after it) is ever
      delivered; a new `spec/errors/errors.json` code
      (`safety_refused`) rides the wire's `error` event. `runTurn()`'s
      non-streaming twin got the same whole-text check for symmetry,
      beyond this item's own literal ask. `frontend/src/lib/
      sentenceChunker.ts` still has its own duplicate copy - Session A
      doesn't own `frontend/`; see docs/dev.md's step 9 entry for the
      Session B follow-up that finishes the "one definition" move.

Sources for this section (research pass, 2026-09-05): [Mem0, state of agent memory 2026](https://mem0.ai/blog/state-of-ai-agent-memory-2026), [Letta sleep-time agents](https://docs.letta.com/guides/agents/architectures/sleeptime/), [Letta memory blocks](https://www.letta.com/blog/memory-blocks/), [Zep temporal knowledge graph](https://arxiv.org/abs/2501.13956), [LongMemEval](https://arxiv.org/abs/2410.10813), [Temporal semantic memory](https://arxiv.org/abs/2601.07468), [AFA, multi-user memory](https://arxiv.org/html/2604.25022v1), [ChatGPT memory Dreaming, secondary](https://letsdatascience.com/news/openai-upgrades-chatgpt-memory-architecture-for-fresher-pers-b26b51d5), [Open WebUI memory](https://docs.openwebui.com/features/chat-conversations/memory/), [PERSONA steering vectors, ICLR 2026](https://arxiv.org/html/2602.15669), [llama.cpp control vectors](https://github.com/jukofyork/control-vectors), [AgentFloor, small-model tool use](https://arxiv.org/abs/2605.00334), [llama.cpp tool-call grammar issue](https://github.com/ggml-org/llama.cpp/issues/24807), [Home Assistant LLM API](https://developers.home-assistant.io/docs/core/llm/), [Anthropic, context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents), [semantic-router](https://github.com/aurelio-labs/semantic-router), [MCP Apps spec](https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/).

## People, relationships and permissions

The spec landed 2026-09-05 (`docs/dev.md`, "Entities, relationships and
grants"): Entity, Relationship and Grant, with the relationship-type and
grant-action vocabularies and the cross-field validators. None of it is
implemented on the hub yet.

**Session E's step 6 (2026-09-06) confirmed this section is still
accurate, and checked directly with F rather than assuming silence means
"not started" (the same coordination this session already did with D for
the store in step 3).** Zero backend exists for `/api/entities`,
`/api/relationships`, `/api/grants`, `GET /api/people/:id/permissions`,
or `/api/approvals` - F confirmed (2026-09-06) these are genuinely not
started, grouped as F's own step 7 ("bigger than step 6"), with steps
8-12 still ahead of it in F's own order. Content ceilings are **not
F's record at all** - F named them as C's (session C, per wave-2's
ownership split), and neither has a spec schema yet (the platform plan
describes the ceiling in prose only: dials `none | limited | open`,
band-defaulted with a non-movable safety floor). Time allowances/
schedules are F's (this file's own earlier "M, F backend, E controls
page" note, confirmed still accurate) and also not started, also with
no spec schema. **Devices and sessions with revoke are the one real
exception**: F's own step 6 (passkeys, device tokens, Quick Connect,
sessions, optional TOTP - `GET/DELETE /api/devices`,
`GET/DELETE /api/auth/sessions`) is done, code-reviewed, and merging to
`main` imminently as of this note - the frontend half of "sessions and
devices with revoke" is real, buildable work once that lands, unlike
everything else this step named. `AdminGatedPage.tsx`'s existing role-
based gate (already reused for Repairs, Backups, AI models, and the
person-pickers on Conversations/Memory) is confirmed the right mechanism
for a parent's controls page whenever the rest of this lands -
`settings.admin`'s own grant-action wording in
`spec/vocab/grant-actions.json` is a stated future state (line 744 of
this file's earlier note), not something to build against today.

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
- [ ] **Does the People directory grow beyond account holders?** (open
      question, Jesse's call, 2026-09-06) - `/people` was split from
      account management on 2026-09-06 (roster add/edit/remove moved to
      Settings -> Household -> Users, `UsersSection.tsx`) and today only
      ever lists people with a real account (`GET /api/people`). Jesse's
      own framing when asking for the split: "anyone with a user account
      should be able to browse people that are users - open question if
      we let users browse all people" - naming a non-account entity
      (an ex-partner, a delivery driver, a lunch lady) as his own example
      of what a broader "people" concept could include. This is exactly
      the Entity/Person-vs-User split "The hub half of entities and
      relationships" (above) would introduce - PeoplePage.tsx cannot
      answer this on its own since there is no Entity storage yet. When
      that work starts, this needs a real design pass before code, not
      just "show everything": the spec's own "Inference is the dangerous
      half" section is exactly this risk (a household member browsing an
      entry for someone else's relationship, an inferred connection
      nobody confirmed) - same shape as the already-recorded open
      question above ("may a parent see a relationship inferred from
      their teen's conversation") but for browsing rather than
      inference specifically.
- [ ] **A self-service way to change your own display name** (S) - a
      real, deliberate regression from the 2026-09-06 People/Users split:
      the old PeoplePage.tsx let anyone edit their own row (`canManagePerson`
      allows `actorId === target.id` regardless of role), which was the
      only way a non-admin could rename themselves. That Edit button
      moved to Settings -> Household -> Users with the rest of roster
      management, which is admin-gated - a non-admin has no path to
      renaming themselves at all today. Needs its own home (Settings ->
      Me is the obvious candidate, alongside Appearance/Personality/
      Voice) since `display_name` is a `Person` field, not a settings-
      registry key, so it doesn't fit `SettingsRenderer`'s generic
      schema without its own small hand-built section.

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

- [ ] **A household-location setting** (S-M) - found live, session-d-
      packages-and-store.md step 3, 2026-09-06: no settings key, no
      first-run prompt, no places picker exists anywhere for "where does
      this household live." `weather`'s own `warm.keys` had to hardcode a
      placeholder place (Seattle) instead of the household's real one for
      exactly this reason, and step 0's own verdict queue separately
      dropped `localNews.ts`/`localEvents.ts` on the identical gap. Once
      this exists (`household.home_place` or similar, `coreKeys.ts`), any
      package's `warm.keys` can resolve it directly with no further
      cache/warm changes - the mechanism doesn't care what the value is,
      only that a real one exists to resolve against.

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
- [ ] **A generic "share" mechanism in the UI schema/manifest system**
      (L, Jesse's ask, 2026-09-06) - the actual ask was sharing specific
      creations (images, videos, music playlists, video playlists,
      AI-generated podcasts), but Jesse's own follow-up reframed the
      shape: this should be "a mechanism in our app template/schema...
      ability to share," not a bespoke share button built per content
      type. Matches platform principle 1 (one definition, one place) -
      the right home is likely `spec/ui/schema.json` (a `share` action
      alongside the existing action union - see `EmptyState.tsx`'s
      comment on `navigate`/`call`/`play`/`confirm`/`ask`) or a manifest-
      level capability a package declares once and the generic renderer
      honors everywhere, rather than each of images/videos/playlists/
      podcasts growing its own share affordance independently. Needs a
      design pass on what "share" even means for a private, self-hosted,
      no-phone-home hub before any code (share TO whom - another
      household member only, or an exported file/link off the hub
      entirely; the org's privacy architecture rules govern the second
      case directly) - not just wiring up a button.
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
- [x] **The kit owns the batch-selection pattern** (S) - done 2026-09-05.
      `kit/primitives/BatchBar.tsx` (the count, the caller's own batch
      actions, Done) and `SelectModeToggle`; `PeoplePage.tsx` now consumes
      it instead of hand-rolling the row. Still page-specific: entering
      select mode's exact wording and the destructive confirmation panel
      (their copy differs per list). Memory is still the pattern's second
      real consumer, once its own batch actions land (below). See
      `docs/dev.md`, "Session B: step 1".
- [x] Notifications UI (done 2026-09-05, `docs/dev.md`'s "The
      notification system, a real working slice" entry) - `NotificationBell`
      (shell header: pending list + toast on new arrival). Still real gaps:
      no thirty-day history page yet (only the pending list and the
      `GET /api/notifications/history` route it would read from), and
      "clear all" isn't built (this item's own "batch actions" rule
      applies once it is).
- [ ] Package/skill catalog browsing and install (L) - blocked on the
      `catalog` repo existing for real; today only local bundled packages
      run at all. Confirmed again in session E's step 3 (2026-09-06):
      none of `GET /api/store/index`, `/packages`, `/packages/:id`,
      `POST /install`, `/install/confirm`, `/uninstall`, `/rollback`,
      `/channel` (docs/plans/wave-2.md's frozen D-to-E contract) exist
      yet - "not a line of it exists" below is still literally true.
      Deliberately not built against a fixture the way widgets/lists
      were in step 2: the store's own real UX (a two-call permission
      prompt, README rendering, channel/rollback/uninstall) is too large
      and too security-sensitive to build convincingly without a real
      install to drive it against, unlike a card that degrades to
      "nothing yet."
- [ ] Admin / parental-controls surface beyond the generic settings
      renderer (M)
- [x] **Wire the measurable half of accessibility into the screenshot
      pipeline** (S) - done 2026-09-06 (Session E, step 0).
      `scripts/screenshot.ts` now runs `@axe-core/playwright` plus a
      horizontal-overflow check against every route App.tsx declares, at
      every viewport (phone/tablet/desktop/far) and theme (light/dark);
      `bun run screenshots` is the full matrix (saves PNGs under
      `docs/assets/screens/` for a human to look at before a commit),
      `bun run a11y` is a fast two-combo subset meant for `scripts/
      check.sh`.
- [ ] **Wire `bun run a11y` into `scripts/check.sh`** (S, Session F -
      that file's owner per `wave-2.md`'s shared-file protocol) - the
      script exists and is fast (two combos, no screenshots saved); it
      just isn't called from the gate yet.
- [ ] **Parallelize `scripts/screenshot.ts`'s full matrix** (S) - a code
      review (2026-09-06) noted the 4 viewport x 2 theme x 11 route
      matrix runs fully sequentially against one browser (up to 88
      visits), taking several minutes; nothing about Playwright requires
      that (one Chromium process supports many concurrent contexts), a
      small concurrency pool would cut it roughly in proportion to pool
      size. Not done in the same commit that added the matrix: `bun run
      a11y`'s two-combo subset (the one that matters for check.sh) is
      already fast, and getting the full matrix's correctness right
      (the service-worker race it already found once) took priority
      over its wall-clock time.
- [x] **`--primary` contrast, done** (session E step 7, 2026-09-06) -
      white text on `--primary` (`#ffffff` on the original `#06a9c6`,
      `hsl(189 94% 40%)`) measured at 2.8:1, under WCAG AA's 4.5:1 floor
      for normal text, on every route with a default-variant `Button` or
      an active sidebar nav item (Home, Chat, People, Memory, Privacy,
      Settings and its sub-pages). Fixed at the token level (same hue
      and saturation, darkened to `hsl(189 94% 29%)`, `frontend/src/kit/
      tokens.css`) - measures ~5:1 now, checked against both light and
      dark themes (dark theme's own pairing was already ~10:1 and
      untouched). `--ring`/`--sidebar-ring` follow `--primary` to the
      same value rather than diverging (their own 3:1 non-text
      requirement was never the violation and stays clear). Re-running
      the full `bun run a11y` matrix confirms every one of these
      instances is gone.
- [ ] **A second, narrower contrast finding, found while verifying the
      fix above** (session E step 7, 2026-09-06) - `chat @ desktop/
      light` still shows 6 `color-contrast` nodes, all the same root
      cause: a `<time>` element (a message's timestamp,
      `class="text-base text-muted-foreground"`) measured at 3.66:1,
      still under 4.5:1. Not the `--primary` fix's territory at all -
      this text uses `--muted-foreground`, and the computed color axe
      reported (`#85858d`) doesn't match this repo's own
      `--muted-foreground` (`hsl(240 4% 46%)`, which computes to a
      visibly darker `#70707a`) when checked by hand - something in
      `@assistant-ui/react`'s own message-timestamp rendering (no
      `<time>` element is authored anywhere in `kit/assistant-ui/
      thread.aui.tsx`; it comes from the library's own internals) is
      resolving `text-muted-foreground` to a different, lighter value
      than the rest of this app gets from the same class - a real
      styling-integration gap between assistant-ui's own theme
      resolution and this kit's tokens in that specific scoped context,
      not a token value to darken further. Needs a live browser's
      computed-styles inspection to root-cause properly (which CSS rule
      is actually winning), not more token math - left for whoever picks
      this up next; the number is real and verified, not guessed at.
- [x] **`scrollable-region-focusable`, done** (session E step 6/7,
      2026-09-06) - re-running the full `bun run a11y` matrix after
      merging main (F's real `GET /api/health` landed with
      `requireAuth`, which needed `scripts/screenshot.ts`'s own
      `waitForHealth()` fixed to treat any response, not just a 200, as
      proof the backend is up - it is a liveness probe, not an
      authenticated health check) surfaced this rule failing on Setup,
      Home, and Privacy: a scrollable `overflow-y-auto`/`overflow-x-auto`
      region with no keyboard access. Privacy was already known (noted
      here as "pre-existing, unrelated"); Setup and Home were not.
      Grepped every `overflow-{x,y}-auto` container in `frontend/src` and
      found the same gap repeated across eleven files (`Wizard.tsx`,
      `SchemaPage.tsx` - covering every Settings sub-page that renders
      through it - `HomePage.tsx` (both its page body and the "Who is
      here" avatar strip), `SettingsPage.tsx`, `PrivacyPage.tsx`,
      `MemoryPage.tsx`, `ConversationsPage.tsx`, `NotificationsPage.tsx`,
      `PeoplePage.tsx`, `SearchPage.tsx`, `WidgetRow.tsx`'s horizontal
      item strip, and `ChatPage.tsx`'s thread-list sidebar) - only
      `DetailPane.tsx` and `SplitView.tsx` already had the fix. Applied
      `DetailPane.tsx`'s own
      established pattern (`tabIndex={0}` + `FOCUS_RING` + the same
      `eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex`
      comment) everywhere rather than only the three routes the matrix
      happened to catch: the other six pages don't overflow with today's
      demo data, but the same latent bug would resurface the moment a
      real household has enough people, notifications, or conversations
      to make them scroll. Full `bun run a11y` matrix confirms zero
      instances of this rule remain.
- [ ] A screen-reader read-through of each page, keyboard-trap testing,
      reduced motion verification, and the TV surface (session-e-ui-and-
      docs.md's own step 7) - the rest of this step's own scope, still
      open as of this note.
- [ ] Onboarding beyond the one-time initial household setup (M)
- [x] Accessibility audit (M) - done 2026-09-05, driven against the
      running app at phone and desktop, not read off the source: 142
      violations found, all fixed, re-measured at zero. See `docs/dev.md`,
      "The accessibility audit". Not covered and still open below: colour
      contrast, screen-reader flow, keyboard traps, and the TV surface.
- [ ] Any UI for calendar, email, camera/vision, or generation (blocked on
      each of those existing first)
- [ ] **The `app` kind: full, multi-page apps (Videos/Weather/Podcasts-
      style), re-decided 2026-09-06, not yet built.** The 2026-09-05
      "own nested route subtree" verdict is superseded: it contradicted
      plan 6.2 (pages are schema data; custom React only as a
      `platforms: [web]` federated bundle), couldn't install from a
      catalog without a rebuild, and couldn't be served by the robot's
      standalone shell or Go's native renderer. A `design-resolver` pass
      (session E, 2026-09-06) found the fix needs zero new node kinds:
      an `app` package's page is just a `page` document through the
      *existing* SchemaPage/NodeRenderer path (the same one
      `spec/ui/pages/memory.json` already runs through) - that identity
      is the proof "the app kind is data," not a new node could ever be.
      Concretely: `contributes.pages[]` entries `{id, icon, label, nav,
      kind: "schema" | "web", module}` (D's manifest file), no `to`
      field - the route is derived (`/apps/<package id>/<page id>`,
      `id: "index"` derives the bare `/apps/<package id>`), served at a
      new `GET /api/plugins/:id/pages/:pageId`. Data stays the existing
      `binding` mechanism with one required addition: `useBinding` needs
      package-scoped path resolution and a same-package guard (reject a
      package page's binding that reaches outside its own route
      namespace) via a `PackageScopeContext`, since today's bare
      `request(binding.path)` would let a package page read e.g.
      `/api/people` verbatim. No incremental-patch protocol is needed for
      v1 - poll via the query layer's normal cadence like every other
      page (widgets' own `refresh_s` is the only real refresh case that
      exists today); `binding.stream` (declared, unimplemented) is the
      named landing spot if real-time patches are ever wanted later. The
      `platforms: [web]` escape hatch is `contributes.pages[].kind:
      "web"` (valid only when the manifest's own `platforms` includes
      `"web"`) with the loader rejecting it outright for all of Wave 2 -
      a manifest field, never a sibling node kind, since a node
      SwiftUI/Go can't render would hollow out `catalog.test.ts`'s own
      agreement test. **Blocks on D**: `manifest.schema.json`'s
      `contributes` is currently an untyped array plus a redundant
      top-level `pages: string[]` - incompatible with the already-frozen
      wave-2.md `contributes.widgets[]` object shape. Recommended fix
      (flagged to D 2026-09-06, D's file to change): `contributes`
      becomes an object keyed by blueprint kind (`pages[]`, `widgets[]`,
      ...), the redundant top-level `pages` dropped - confirmed safe,
      nothing in `backend/src`/`frontend/src` reads either field today.
      E's own share (`PackageScopeContext`, the nav registry merge,
      `PackagePage.tsx`) waits on D's `contributes.pages` and the new
      pages route landing - nothing to prove it against yet
      (`lists`, D's own first page, is step 8 of D's plan, not started
      as of 2026-09-06).
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
      **The other half of this item, done 2026-09-05:** `frontend/src/
      shell/nav.ts` is now the data-driven nav registry `Shell.tsx` reads
      (matching `spec/ui/schema.json`'s new `nav_entry` def field-for-
      field); core's five pages register there by hand until a package's
      manifest `contributes.pages` can feed a sixth entry in without
      editing this file. See `docs/dev.md`, "Session B: step 2".
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
- [x] **Input-mode detection in the kit** (M, everything TV depends on
      it) - done 2026-09-05. `kit/useSurface.ts`: `{ pointer, hover,
      input, far }` from `usehooks-ts`'s `useMediaQuery` (`pointer`,
      `hover`) plus a hand-written keydown/pointerdown/gamepadconnected
      listener for `input`, and a webOS/Tizen/Fire TV user-agent check
      for `far` (arrow keys alone are indistinguishable from a keyboard's
      - the real signal legacy's own table row named). See `docs/dev.md`,
      "Session B: step 2".
- [x] **Two render profiles per component, near and far, partial** (M) -
      done 2026-09-05 for the shell's own nav: the Sidebar renders as a
      real focusable TV rail via `@noriginmedia/norigin-spatial-
      navigation`'s `useFocusable` when `useSurface().far` is true (arrow
      keys move focus, Enter navigates - verified live against a
      simulated webOS user agent), and a `.surface-far` class bumps the
      type scale. **Still open:** this is the shell's chrome only: no
      schema-level "TV in one rule" exists yet for a package's own pages
      (plan 6.4), and no free-text-entry-on-far rule is enforced anywhere
      (nothing on `far` takes free text yet to enforce it against).
- [x] **Phone chrome per UI.md** (M) - done 2026-09-05. `shell/PhoneNav.tsx`:
      a five-entry bottom bar (today's five real pages fit exactly, so
      "More" has no content yet; the mechanism exists for a sixth),
      replacing the icon-only rail under 640px. See `docs/dev.md`,
      "Session B: step 2".
- [x] **A profile switcher in the header** (S) - done 2026-09-05.
      `shell/ProfileSwitcher.tsx`: a Popover (matching NotificationBell's
      own non-modal pattern, not a Dialog) listing every other household
      member, a PIN prompt for secured ones (reusing `api.select`/
      `api.verifySecret`, the same routes SignIn's picker already calls),
      and sign-out moved inside it as a secondary item. A known, accepted
      duplication: the PIN auto-submit-on-4-digits behavior is copied
      from `SignIn.tsx` in small form rather than extracted into a shared
      hook under this session's time budget - a real follow-up.
- [x] The UiNode renderer, and the schema catching up to the kit (M-L) -
      done, session-b-ui.md step 5 (2026-09-05): `spec/ui/schema.json`
      now carries twelve node kinds (`list`, `card_grid`, `media_shelf`,
      `detail_pane`, `split_view` added alongside v0's set), each with a
      real `NodeRenderer.tsx` case, and `spec/ui/pages/memory.json` runs
      live through it. "Make Chat the first page rendered from JSON" was
      deliberately reversed instead (reasons in `spec/ui/README.md`), a
      closed decision, not outstanding work. This item's stale text
      (six kinds, nothing rendered) is corrected here rather than left to
      mislead the next reader; the `app`-kind re-decision it named is its
      own item above, resolved 2026-09-06.
- [ ] **Chat surface, the missing basics** (M total) - markdown via a
      maintained renderer (react-markdown plus rehype-sanitize; bubbles
      are `whitespace-pre-wrap` today so a list shows raw asterisks); a
      multi-line Textarea composer; stop generating (no abort exists,
      Send is just disabled); copy and regenerate; suggested prompts on
      the empty state; timestamps and day dividers; `aria-live` on the
      streaming bubble (a screen reader hears nothing during a reply);
      a resume cursor on the stream (legacy's `since=` auto-resume was
      added after a truncated reply was reported as success). **Done**:
      the "demo only" wake banner is reworded for a family (session E
      step 4, 2026-09-06).
- [x] **Conversations as records** (M, spec first) - done, session A step
      3 (backend: a real `Conversation` shape, `GET /api/conversations`
      as a real thread list, rename/delete/batch-delete/clear-all) plus
      session E step 5 (2026-09-06: the frontend page,
      `frontend/src/apps/conversations/ConversationsPage.tsx`, and a
      real, live bug this step found and fixed along the way -
      `chatHistoryAdapter.ts`'s own history load was still calling the
      bare `/api/conversations`, which session A's step 3 had already
      repointed to the new thread-list shape, so every Chat page load
      was fetching the wrong shape and silently rendering `undefined`
      user/assistant text; the fix pointed it at the real
      `/api/conversations/turns` instead. The companion axis per
      conversation plan 4.14 leaves unspecified is still open.
- [x] **Push-to-talk in the composer** (M) - done, session E step 4
      (2026-09-06): a real `DictationAdapter`
      (`frontend/src/lib/voice/sttDictationAdapter.ts`) against a real
      `WS /api/stt/stream` client, wired into assistant-ui's own stock
      mic button. Uses the server's own VAD for barge-in, not the named
      legacy Silero numbers specifically (0.5/0.35 hysteresis, 0.32 s
      pre-roll) - those stay recorded below for whoever tunes the
      server-side VAD itself, since this session's own barge-in just
      forwards whatever the server decides rather than running local
      detection.
- [ ] **A real bug this session found, not caused by it, and not fixed
      here** (session E step 5, 2026-09-06): Home's `WeatherCard`
      (`runFixedTurn.ts`) calls the exact same `POST /api/turn/stream`
      route Chat itself uses for a fixed "What's the weather like
      today?" utterance, and the turn engine persists every turn it
      handles regardless of caller (`chatHistoryAdapter.ts`'s own
      comment: "the backend already persists every turn server-side...
      independent of anything this adapter does"). That means every time
      a household member's Home page runs its own weather check, a
      visible "What's the weather like today?" turn silently appears in
      their REAL Chat history - previously invisible only because the
      bug above broke history loading entirely. Confirmed live: the
      screenshot matrix's own repeated Home visits (across viewports/
      themes, one shared session) left several duplicate weather turns
      sitting in Chat's thread once the load bug was fixed, visible in
      `chat-desktop-light.png`. Not this session's file to fix
      (`turnEngine.ts`, session A's/D's territory) - needs either a
      background/non-conversational turn kind the engine excludes from
      history, or a `surface` this route can pass that widgets use
      instead of `"chat"`.
- [x] **Kit gaps found by the audit, partial** (S each) - done 2026-09-05:
      `AsyncState` (loading, error with retry, empty - built, not yet
      wired into the five pages that hand-roll the triad; that's step 3's
      data-layer job) and Checkbox (`PeoplePage.tsx`'s select-mode row now
      uses `kit/ui/checkbox.tsx` instead of a raw `<input>`). See
      `docs/dev.md`, "Session B: step 1". **Still open:** Textarea, Tabs
      with a URL-bound active tab, a real Chip/Toggle (Chat's two pill
      toggles now use `Button` with a variant, which fixed the raw-
      element and focus-ring lint findings but isn't a dedicated Chip
      component); MemoryPage onto `List`; Shell and NotificationBell
      tests.
- [x] **The kit ESLint config UI.md mandates** (S) - done 2026-09-05.
      `frontend/eslint.config.js`: `typescript-eslint`, `react-hooks`
      (rules-of-hooks/exhaustive-deps only, not the full v7 React
      Compiler set - recorded why in dev.md), `jsx-a11y`, and
      `eslint-plugin-better-tailwindcss`'s three correctness rules
      (no-unknown-classes, no-conflicting-classes, no-restricted-classes
      banning hex/rgb arbitrary values). Bans `lucide-react` outside
      `kit/icons.ts`, raw `<button>`/`<input>` in `src/apps`, and (a
      hand-written rule, no plugin covers it) a `hover:` variant with no
      paired `focus` on a native element. `bun run lint` runs it;
      `scripts/check.sh` calls it. See `docs/dev.md`.
- [ ] **A real PWA** (S-M) - manifest only today: no service worker, no
      offline page, one oversized icon. Copy the rules legacy's `sw.js`
      v5 learned: navigations network-first with an offline page (a
      cached index once pinned old hashes for several reloads), full
      passthrough on Firefox (local network access), reload exactly once
      on `controllerchange`; plus `lazyRetry` (stale-chunk reload once
      per session, hit right after an update) and an error boundary,
      neither of which exists.
- [x] **Reduced motion, type floor, theme colour** (S) - done 2026-09-05.
      `kit/tokens.css` now has one global `prefers-reduced-motion: reduce`
      rule (zeroes animation/transition duration everywhere); the
      appearance setting (`ui.appearance`: system/light/dark, person
      scope, `backend/src/settings/uiKeys.ts`) exists and `shell/
      useAppearance.ts` applies it (a `.dark`/`.light` class, and drives
      `theme-color` off the resolved value instead of the hardcoded dark
      meta tag). **Still open:** the bell badge and thread timestamp
      `text-[10px]`/`text-xs` instances themselves weren't hunted down
      and fixed in this pass (a real, separate audit-style sweep, not
      folded into the shell rebuild).
- [ ] **A screenshot matrix in the pipeline** (M; sharpens the tracked
      "wire the measurable half" note) - every page at every surface,
      light and dark, with overflow and target checks, per UI.md; today
      one hero shot at one size.
- [ ] **Health and Repairs pages, the updates projection, self-update
      with stage, swap, health check and rollback** (L) - plan v0.1
      scope, absent here entirely; "cut a first release" below cannot be
      exercised end to end without them. **Repairs done** (session E,
      step 3, 2026-09-06): `GET /api/repairs` was the one real, fully
      landed contract of the five this step named (F step 1) - a real
      page, `frontend/src/apps/settings/RepairsPage.tsx`/`RepairsSection.tsx`,
      linked from Settings' Household tree next to Backups/AI models
      (owner/admin only, the same gate). Hand-written, not a schema
      `list` node: an `Issue`'s `fix` and `learn_more` are both nullable
      per-row, and the generic `list` node's `row_action` can't
      conditionally disappear per row - the same "stays hand-written"
      call already made for People/Privacy/Settings. **Health, Updates
      and Storage still not built** (all three confirmed backend-unbuilt
      2026-09-06): `GET /api/health` is still `{status: "ok"}`, an
      unrelated liveness check (F's own step 2 replaces it, not landed);
      `GET /api/updates`/`GET /api/storage` don't exist at all. Left for
      whoever lands each contract - the frozen shapes are in
      `docs/plans/wave-2.md`'s "F to E" section, and the frontend side of
      each is a small schema or hand-written page against a real
      `GET`, the same size of work Repairs just was.

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

- [x] **Forget and person-delete must write tombstone ops, not bare
      DELETEs** - shipped, Session A step 10 (2026-09-05):
      `memory.forget()` and `erasePersonData()`'s own memory-records
      handling both tombstone now (`status: archived`, `text` wiped to a
      real sentinel, `embedding_space` cleared, `deleted_at` set, row
      kept) instead of hard-deleting - a robot that synced before the
      forget can no longer push the memory back on reconnect. Settings
      and scheduled jobs still hard-delete on person deletion
      deliberately (see docs/dev.md's step 10 entry): only memory
      records carry the "a device could resurrect this via sync" risk a
      tombstone exists to close.
- [x] **A clock stamp on every spec record** - shipped for Person,
      MemoryRecord and Grant, Session A step 10 (2026-09-05): all three
      now carry `hlc`, set from `lib/hlc.ts` on every real write.
      `lib/hlc.ts` itself gets a real, dedicated test file
      (`tests/hlc.test.ts`) covering what the existing settings.test.ts
      coverage didn't - the counter's same-millisecond advance proven
      directly, `compareHlc()`'s own node tiebreak, and `seedHlc()`'s
      exact same-`wall_ms`-lower-counter boundary. Entity and
      Relationship still need this (Entity is memory-record's own
      `record_kind: "entity"`, already covered by this step's
      memory-record change; Relationship is a separate schema, not
      touched this pass).
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
      Quick Connect) and `/pair` had no limiter. Plan 7.1 is one flow for
      a ROBOT/pod pairing into the household (Wave 3, still deferred -
      touches every record table). Decided for the human sign-in half
      (Session F step 6, 2026-09-06): Quick Connect for TV sign-in is
      its own separate flow, not this one - `lib/quickConnect.ts`, rate
      limited from the start (`code + poll_token`, 5-minute expiry).
      This item now covers only the robot/pod pairing flow.
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
      `model.download_ready`/`failed` wired to real events. Session E
      step 5 (2026-09-06) adds the thirty-day history page
      (`frontend/src/apps/notifications/NotificationsPage.tsx`, reachable
      from the bell's own "View history" link) - a client-side window
      over the real, genuinely unbounded `GET /api/notifications/history`
      (confirmed by reading `lib/notifications.ts`'s `listHistory()`: no
      date filter or cap exists server-side), and "clear all" as a real
      loop over the real per-item `POST /:id/dismiss` (no
      `POST /api/notifications/clear-all` route exists to call instead).
      Still open: quiet hours and the web-push opt-in (both need new
      settings keys in `backend/src/settings/notificationKeys.ts`, F's
      file per `docs/plans/wave-2.md:113`'s grouping - not built, and not
      E's file to add them to), `passive`-level digest batching, browser
      push / Go / TV overlay / robot speech (no such clients exist yet),
      a real parent/guardian audience (see the Relationship/Grant work
      above), and package-declared notification types (the manifest's
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
- [x] **`@hono/zod-openapi` conversion, the scaffolding and F's own
      routes** (Session F step 4, 2026-09-06) - `lib/openapi.ts`
      (`apiRouter()`, `errorResponses()`, `PaginationQuerySchema`/
      `paginatedResponseSchema()`), `/api/docs` (Scalar), `docs/api/
      openapi.json` generated and drift-checked by `check.sh`.
      `repairs.ts`, `notifications.ts`, `settings.ts`, `backups.ts`,
      `people.ts` converted (five of F's six pre-existing route files);
      `auth.ts` deliberately left for a dedicated pass (a shared
      Response-building helper across two differently-shaped routes -
      see `docs/dev/session-f.md`'s step 4 for the real reason). The
      other 11 route files (C, D, E's) still need converting when each
      session next touches theirs, per the org rule.
- [x] **Rate-limit the remaining raw fetches** (Session F step 3,
      2026-09-06) - `telegramChannel.ts` and the HF voice catalog both
      go through `tryConsume` now.
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
- [x] **A household CA with `maipai.local` mDNS and a trust step**
      (Session F step 5, 2026-09-06) - `lib/householdCa.ts` (a real,
      node-forge-minted CA and leaf, boot-time-conditional TLS),
      `lib/mdns.ts` (`_maipai._tcp.local`, TXT fields designed for this
      step since plan 7.1 wasn't available in this checkout - Jesse's
      call, see docs/dev/session-f.md), `GET /api/setup/ca`. The
      TXT field list and the trust-step UI (a device downloading and
      installing the cert, rendering the QR) are not this - the fields
      may need revisiting against the real platform plan text, and the
      UI is E's kit work.
- [x] **Passkeys, device tokens, Quick Connect, sessions, optional
      TOTP** (Session F step 6, 2026-09-06) - `lib/passkeys.ts`
      (`@simplewebauthn/server`, self-service registration on an
      already-signed-in profile, shared lockout with PIN/password),
      `lib/deviceTokens.ts` + `lib/devices.ts` (365-day tokens, 20 per
      person, oldest-evicted, `spec/schemas/device.schema.json` laid for
      the link), `lib/quickConnect.ts` (code + a separate poll_token, 5-
      minute expiry, rate limited, TOTP re-confirmed at approval when
      the approver has it on), `GET/DELETE /api/auth/sessions`
      (per-device, revoke), `lib/totp.ts` (`otpauth`, owner/admin only,
      anti-replay via a last-used-step counter, its own shared lockout).
      Two review passes on this diff, both fixed: the first found seven
      issues on first pass (see docs/dev/session-f.md); the second found
      TOTP bypassable via Quick Connect's poll and a stolen device
      token's redeem (fixed by gating the approval step instead - a
      redeemed token stays silent by design, the standard "remembered
      device" shape), a stale `hasSecret()` letting a passkey-only
      person be promoted to admin/owner, a 500 instead of 401 on an
      unknown personId, and `auth.ts`'s own conversion to
      `@hono/zod-openapi` (deferred past the first pass since it wasn't
      new code, then required once this diff rewrote most of the file).
- [ ] **Identity and trust pieces plan v0.1 scopes and this file did not
      track, still open** (M each) - an approval queue, hub-key signing
      of the bundled default set, the emergency kit and hub/SMB backup
      targets, a restore drill in the release skill, and the `user/`
      docs tier (only `dev/` exists).
- [ ] **Tests the audit found missing** (S) - `hlc.ts` seed and compare,
      `personLifecycle`, `access`, and one test proving a specific
      recalled memory text actually lands in the prompt for a matching
      query (memory tests stop at `recall`; prompt tests use synthetic
      matches).
- [x] **Copy the legacy runtime guards, most of them** (Session F step 3,
      2026-09-06) - checked `llmSupervisor.ts`/`modelDownload.ts`/
      `telegramChannel.ts` for equivalents first, per this item's own
      instruction: the download stall watchdog (90s idle timeout) and
      6-attempt backoff already existed in `modelDownload.ts`, untouched.
      Shipped new: `lib/dirtyBoot.ts`'s crash-boot hold (Windows Kernel-
      Power 41, macOS `pmset -g log` Shutdown Cause, Linux journalctl
      boot-boundary check, all best-effort except Windows's real signal;
      30-minute hold on a REAL chat/embed spawn only, never the stub or a
      developer's URL override) and `lib/sidecars.ts`'s
      `sweepOrphanProcesses()` (a boot-time sweep for a stray engine
      process freePort() can't see because it isn't on the port a fresh
      spawn is about to claim - the actual fix for "orphaned runners once
      forced every load to CPU: a 90s 'hi'"; residency itself is already
      capped at one process per role by construction, chat and embed each
      being a single module-level singleton).
- [ ] **The two runtime guards without a clean home yet** (S) - negative
      caches for genuine misses: no analog exists in this architecture
      today (nothing here repeatedly re-probes a known-failing URL or
      resource the way legacy's media-stream resolution did; revisit once
      the scheduler's own download lane or a package's periodic re-check
      needs one, rather than inventing a cache for a problem that doesn't
      exist yet). A boot watchdog capped at three reloads: not backend
      code - that's the OS service manager's job (systemd's
      `StartLimitBurst`, launchd's `ThrottleInterval`, or `run.sh`/
      `run.ps1`'s own retry-with-a-cap), so it belongs in step 11's
      install/service work, not here.

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
      over 12 frames, legacy-only - `useHandsFree.ts` itself doesn't
      exist in this repo, only in the read-only `home-legacy.git`
      mirror). **Correction (session E step 4, 2026-09-06): the claim
      "`sentenceSpeechScheduler.stop()` exists and nothing calls it" was
      already stale** - `chatModelAdapter.ts` was calling it on every new
      turn since session B step 4 (stopping an earlier reply's speech
      when a new one starts). That's a different case from real barge-in
      though, which step 4 adds for real: `sttDictationAdapter.ts` calls
      it the moment the server's own VAD reports `speaking: true` while a
      reply is still playing, wired through the new push-to-talk mic
      button (`frontend/src/lib/voice/sttDictationAdapter.ts`,
      `sttSocket.ts`, `sttContract.ts` - a real `DictationAdapter`
      against C's frozen `WS /api/stt/stream` contract, C's route not
      shipped yet so pressing the mic fails fast and honestly rather than
      faking a transcript). **Still not built, left for whoever tackles
      the fuller hands-free loop**: wake-word detection auto-starting a
      dictation session (today the wake-word toggle only shows a
      reworded banner, deliberately not tied to the real mic button yet -
      compounding two still-partial features felt like a worse
      interaction than either alone); the re-listen-after-reply loop; and
      re-tuning the legacy RMS/probability thresholds for THIS browser
      pipeline (mic-capture.ts, a different capture path than the legacy
      hub's), which needs real held-out speech to validate against per
      this org's own training-data standards, not numbers copied in
      blind.
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
- [x] **Sessions per device with revoke, optional TOTP for owner and
      admin** (Session F step 6, 2026-09-06) - see the entry above under
      "Identity and trust pieces".
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
- [x] **A `Device` record** (Session F step 6, 2026-09-06) -
      `spec/schemas/device.schema.json`; see the entry above under
      "Identity and trust pieces". `lib/deviceId.ts` remains a separate,
      unrelated thing (the memory/entity/episode id suffix, its own
      header explains).

**Packages**

- [x] **The Tier 1 host under Deno, and the MCP spike** - shipped,
      session-d-packages-and-store.md step 5 (2026-09-06):
      `lib/denoHost.ts` (lazy-started, `--allow-read`/`--allow-write`
      scoped to exactly the package's source and data dirs, no env, no
      net), MCP over stdio via the official SDK (`Client`/`McpServer`,
      both directions of the `Protocol` base class's `request()`/
      `setRequestHandler()` used for real - `vscode-jsonrpc`'s recorded
      fallback was never needed), `host/fetch` proven end to end through
      `packageHost.ts`'s own cache/rate-limit/SSRF path. Three-strikes
      fault handling with a real Repairs issue, idle-kill, a graceful-
      exit hook. `knowledge` (Wikipedia's public REST summary API) is
      the first Tier 1 package, verified live against a running dev
      server. `deno_test` smoke (step 1's own reserved, unbuilt kind) is
      real now too.
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
