# Changelog

All notable changes to MaiPai Home. Format follows
[Keep a Changelog](https://keepachangelog.com); versions follow semver.
Everything stays `0.x` until the product passes its battle-tested
checklist (`docs/dev.md`). The first release is 0.1.0.

## [Unreleased]

### Apps
- Packages can now be apps. An app opens at `/apps/<package id>`, shows in search and favorites, and draws its pages from data, with no rebuild. A package app can declare a settings area, which opens from a Settings gear in the app's toolbar.
- Weather is the first app: a big animated weather card, a place picker (Current location, your home, your saved places), an hourly strip, and a temperature unit setting (Fahrenheit or Celsius) that also applies to chat answers. Removing a saved place now deletes it.
- The Today row on the Home page shows a compact weather card.

### Chat
- Pictures you send are shrunk to 2000 pixels on the long side before the model looks at them, and iPhone HEIC photos work.
- A lookup that finds nothing never ends in an empty reply: Home tries once more, then says what is missing and what to do.
- A picture request with nothing to show is dropped instead of answered with an empty gallery.
- Teen and child replies get longer deadlines and keep room for the reasoning a thinking model writes anyway.

### Sign-in
- Each digit of a PIN has its own box. A wrong code shakes the boxes red and clears them, and the lockout countdown turns the boxes off. The lock screen has a password option.

### Voice
- Voice capture works in Safari and Firefox, and each capture failure says what is wrong instead of a vague "blocked".
- Voice settings are one **Voice for you** list with a **Test** button, and every preset voice is listed.

### Search
- Settings, Home settings, Search has a Web search block: your SearXNG address with Test and Save, the source switches, and the teen and child DuckDuckGo choice (owner and admin only).
- Home asks the AI engine for DuckDuckGo search. The engine builds and supervises that small service itself, and Home says "still being set up" while it does.

### Chat start
- Send waits and reads "Getting ready, one moment" while the AI warms up.

### Under the hood
- The installer builds the Stack from the pin `STACK_TAG`, now at the commit with the projector fix for Muse pictures and the ddgs search service.

## [0.2.5] - 2026-10-17

Sign-in works for 6-digit passcodes.

### Sign-in
- A 6-digit passcode no longer fires a wrong 4-digit attempt, so it no longer burns a failed try or locks the account.
- The sign-in screen learns each account's passcode length and signs in at that length.

### Chat
- The empty chat rotates ten chat-only pictures, shuffled in each browser, never the same one twice in a row.

### Fixes
- The ChatPage test for a model that never reasons now matches the screen (INSTANT-01).

## [0.2.4] - 2026-10-17

Setup is clearer, Home searches the web more safely, the voice sounds better, and chat feels calmer.

### Setup
- Home installs Deno 2.9.7 itself (checksum-verified), so the built-in data packages work without installing it by hand. The installer opens the setup address in your browser when it finishes.
- Web search setup has one Test result in plain words, and Continue turns on only after a passed Test. There are no Save or Skip buttons.
- The Tune this computer step is redone, the plan names voice, and the Checks screen no longer moves on by itself.
- Setup errors show as a clear red alert. Passcode boxes turn green when they match and red when they do not.
- Setup installs the chat engine before it pulls models. A new art set covers search and warming up.

### Search
- A grown-up can let teens, or teens and children, use DuckDuckGo-style search beside SearXNG. It is off by default.
- If you skip the web search step, DuckDuckGo stays on for adults.

### Voice
- The new default voice is Chatterbox Turbo, picked by ear. It can add small cues such as a laugh, only the ones it really supports.
- Voice settings are one plain list with a preview and a one-tap choose.
- Conversation mode checks your microphone first and shows help for your browser. A mic problem no longer reopens the overlay in a loop.

### Chat
- Reasoning stays folded by default, with calm rotating words while the model thinks and "Thought for Ns" when it is done. Your choice is remembered.
- A model that always thinks shows a short Thinking badge instead of a mode picker.
- Chat titles come from the first message right away, then a model title replaces it.
- The chat menu matches the history menu: Rename, Pin, Archive, Delete. The plus menu opens above the plus. You can drop files anywhere on the chat page.
- The message box takes focus when you open Chat.
- Muse Glimmer models can take pictures on bigger computers.

### Home page
- A new Home page has an ask box, starter ideas, Today cards from your packages, and Getting started.
- Home asks for your city once, with Use my location or a typed city, so weather works.

### Fixes
- An empty dark box under the chat is gone.
- Weather with no place set gives a plain answer instead of an error.

## [0.2.3] - 2026-10-17

The installer now works on a Mac that has Bun but no Node, and Home starts without Deno.

### Fixed
- Installer: Bun is put on the path as `node` while dependencies install, so packages with install scripts (ssh2) build on a Mac without Node. The background service units carry the same path.
- Home no longer crash-loops when Deno is missing. The smoke checks that need Deno are skipped and the Deno-backed packages stay off until Deno is installed.

## [0.2.2] - 2026-10-17

Computers with more than 24 GB of memory get a stronger chat model, and a fresh install starts with every built-in package on.

### Added
- Muse Glimmer 30B is the chat model on any computer with more than 24 GB of memory. The installer measures memory and picks it by itself: 32 GB gets the 17 GB build, 64 GB and more get the 20 GB build. Computers with 16 or 24 GB keep Qwen3 8B. Muse thinks before every answer, so its first words can take a little longer. Speed on real machines is not measured yet.

### Fixed
- A fresh install no longer starts with 12 built-in packages switched off (music, news, sports, the almanac set and the lookups). The installer now fetches their pinned Deno dependencies once, and Home reads them from its own cache folder. (#217)
- Tests: files in one test run no longer leak state into each other, and each test gets 20 seconds under full-gate load instead of 5. The three flaky-test ledger entries are gone. (#216)

## [0.2.1] - 2026-10-16

A fresh install of 0.2.0 stopped at the dependency step. This release fixes that.

### Fixed
- Installer: Commons packages that point at a sibling package (Core needs Spec) now get that sibling linked in the staged folder, so `bun install` finishes on a clean machine.
- Gate script: `scripts/check.sh` runs when started by hand with no Commons path set, instead of stopping with an unbound variable.
- Tests: the port-ownership test finds the shared worktree script from the main checkout as well as from a worktree.

## [0.2.0] - 2026-10-16

Weather answers get a card and a place of their own, and the setup wizard can tune a Mac that runs the AI.

### Added
- Weather: asking about the weather now shows a weather card built from a single forecast lookup, instead of a paragraph of numbers.
- Weather place: the answer uses your current location when your browser shares it, otherwise a saved place, otherwise the household home. The card says which place it used by label, never by street address, and the model cannot change the coordinates it was given.
- Settings: the household home has a location field with a place lookup, so weather and other local answers know where home is.
- Setup wizard: an optional "This computer" step for a Mac that runs the AI. It applies the recommended power, GPU memory and indexing changes only with your consent, one at a time, and each change can be reverted. A checklist covers the advice that cannot be applied for you.
- Install guide page on the docs site, and `scripts/publish-docs.sh` to build the site and publish it with a dead-link check.

### Changed
- Installer: it checks the downloaded Commons archives against pinned digests and stages Home's own Commons pins before `bun install`, so a fresh install no longer fails on a missing pin.
- Removed setting alias: `household.home_place` is gone. Use the location field on `household.home`. Anything that still writes the old key must switch to the new one.
- The main-branch gate now survives the reduced PATH that launchd gives it, and names the line that crashed when a run fails.
- README: the install section is back and matches the current install line.

### Fixed
- Docs drift map: the install guide page is covered, so the docs check no longer fails on it.

## [0.1.0] - 2026-10-16

First release.

### Added
- Install: `scripts/install.sh` brings up Home and prints its address, then the setup wizard installs the AI engine (the Stack) when you choose that this computer runs the AI. Upgrades keep a snapshot of your data and `--rollback` returns to the last version. `uninstall.sh` keeps your data unless you type `DELETE MY DATA`. Home and Stack ports can be set with `MAIPAI_PORT` and `MAIPAI_STACK_PORT`.
- Setup wizard: a silent engine on the plan screen offers Check again, install errors say what to do next, and a failed retry shows an alert.
- Host tuning for an always-on Mac: `scripts/studio/host-tune.sh` checks and applies power, GPU memory, update and indexing settings, one at a time with your say-so.
- Pictures under an answer: for an adult, Commons structured data ("depicts") now brings in
  more pictures of the subject and puts them first, behind the same checks as every other
  picture. Photos with children in them, and photos filed under another person's own
  Commons category, are left out of a person's row.
### Changed
- Pictures when you ask: the assistant now shows pictures more often when an adult asks who or what something is. The check-again step (after the answer is on screen, add pictures when the question was about a famous person, place or thing) is built and off until it is switched on. Adults on written chat only.

### Fixed
- Pictures under an answer: a screenshot, signature or diagram saved as a PNG,
  a file whose name was mangled by a bulk rename, and a photo of something
  else that is only tagged with the subject no longer show up as pictures of it.

### Added
- Search assist bench: a search the assist makes on the model's behalf now counts
  as a search when the bench scores a run, and a small report compares recency
  recall with and without it. Measurement only; the assist stays off.
- The composer and streaming: replies now stream into the chat as they are
  generated instead of arriving all at once, and an interrupted stream resumes
  where it left off instead of losing what it already said.
- "How do you know" on a reply: a fact the model already knew is marked on
  the outcome, and a person can open the reply and see that source.
- Thumbs up and thumbs down on a reply, with the feedback kept per person.
- The details pane on a conversation, the turn artifact behind a reply, and
  advanced reply stats on the person.
- Attachments: a person can attach an image or a document to a message; local
  storage, extraction, and the document outcome path, with child attachment
  projection.
- Conversation search and pinning, and research mode on a conversation.
- The GPU validation bench, a developer-facing check that sizes the engine's
  validation fill in tokens.
- Pictures in a reply: typed picture results from a search appear inline,
  and a follow-up prompt lets a person ask about a picture directly.
- Grounded replies: a composed lookup reply now cites the search rows that
  produced it, so a person can see where each claim came from.
- A link answer: when a lookup returns a page to open, the reply carries
  the link directly and an article card beside it.
- Page reading: when a person asks about a specific page, MaiPai reads it
  and grounds the answer in that page, showing an article card with the
  source.
- A model picker beside the Chat title: a parent sees the available models,
  the one in use, and one repair action if a model is unreachable.
- Temporary chat: a per-conversation mode that keeps messages out of history
  and memory for the duration of that session.
- Continue: a control under a cut-off reply that picks up where the answer
  stopped, without altering the original.

### Changed
- Pictures in answers: a picture of a film, product or website must name it in its title or description, off-topic Commons pictures (wall details, parody signs, courtyards, factory workers, a person holding a product) are skipped, and the gallery no longer pads with weak pictures to reach five. MaiPai also offers pictures more often when asked who or what something is.
- The OpenAPI document was regenerated to cover the routes added since the
  last release, including the commands and privacy routes.
- The default package set gained the missing package README, changelog, and
  quality scale files for buddy, default, pal, recall, remember, and tutor.
- The voice, STT, and TTS routes are now documented in the OpenAPI file.
- Helper tests for shape and throttle validation were added to the backend
  test suite.

### Removed
- The old turn engine (`turnEngine.ts`) and everything that only it used are
  deleted (docs/design/RULES.md rule 12): every turn runs on the one path.
  The household setting `turn.pipeline.next` ("Use the new reply engine") is
  retired with it; nothing reads it, and a stored value for it is ignored. The
  old engine's reply guards that no live path calls, the pronoun-mismatch
  guard among them (retired by ruling: the model is given the pronouns), and
  the answer-from-this-conversation retry nothing could reach are gone too.

### Security
- A 2026-09-06 code review found `POST /api/llm/chat` and `POST /api/llm/embed`
  gave any signed-in person, including a child, raw model access with none
  of the turn engine's child-safety layer applied. Both routes now require
  owner or admin (`requireRole` instead of `requireAuth`) and are documented
  as owner/admin diagnostics only, not a household chat surface - `POST
  /api/turn` is that surface. This narrows who can call an existing route;
  no caller in this codebase used either route directly, and no release has
  shipped yet, but noting it here per the org's API-compatibility rule since
  it is a real behavior change for anyone who was.

### Added
- Backups (platform plan 2.5, split), the tenth slice of hub core:
  `backend/src/lib/backup.ts`'s `runBackup()` takes a real, consistent
  snapshot of the live database via SQLite's own `VACUUM INTO`, encrypts
  it AES-256-GCM with a dedicated key from the existing keystore, and
  writes it to the `local` target (a new sibling directory of `data/`,
  `MAIPAI_BACKUP_DIR` overridable). `pruneBackups()` is a real
  grandfather-father-son retention scheme (seven daily, four weekly,
  three monthly, bounded by real non-overlapping time windows, not just
  bucket counts) wired as a genuine daily scheduled job
  (`backup.run`) from the start. `restoreBackup()` decrypts an archive
  back into a valid, queryable SQLite file, proven by tests that actually
  open the restored database and read real rows back, including a
  deliberate bit-flip test confirming a tampered archive is refused
  (GCM's own auth tag) rather than silently restoring garbage; it's real
  and tested but deliberately not wired to any HTTP route, since safely
  swapping a running process's live database needs staged update/rollback
  machinery (2.4) that doesn't exist (no release has ever been cut). New
  routes, owner/admin only: `GET /api/backups`, `POST /api/backups/run`.
  A bug in the retention window logic (a same-day duplicate backup could
  spill into the weekly tier instead of being pruned) was caught by
  writing the test for it, not by a review, and fixed with strict
  non-overlapping windows instead of a cross-tier fallback. **Not built:**
  a multi-store declaration registry (only one store exists to declare),
  `hub`/`smb` targets, a per-target size cap, the emergency kit and
  Storage page (chapter 6), and the restore drill (no release cut yet).
  Full reasoning in `docs/dev.md`.
- Conversation history (platform plan 4.14, split), the ninth slice of hub
  core: `backend/src/lib/conversationHistory.ts`'s `logTurn()` writes a
  real row (new `conversation_turns` table, schema version 5) for every
  completed turn from `turnEngine.runTurn()`, refusals included. Visibility
  reuses the exact rule `memory.ts` and `settings.ts` already share
  (`lib/access.ts`'s `canAccessPerson`: self, or owner/admin only for a
  child, nothing of a teen's or an adult's, the same documented narrowing
  `memory.ts`'s scope:person visibility already made since there's no
  summarization mechanism yet to safely honor 4.14's "a summary and safety
  flags for a teen's"). `household.conversation_retention_days` (default
  90, `backend/src/settings/coreKeys.ts`) is the first core settings key
  besides locale to actually get read by anything; `runRetention()` hard-
  deletes turns past the window (no summarize-then-purge yet, no LLM to do
  it), except a safety-flagged turn from a minor speaker, which is never
  deleted before 90 days regardless of how short the household sets
  retention. Wired as a real daily scheduled job from the start
  (`conversation.retention`), not a manual trigger, since the scheduler
  (4.7) already existed. New routes: `GET /api/conversations` (own, or
  `?person=<id>` for owner/admin), `GET /api/conversations/export` (a real
  403 on denial, unlike list's empty-result browsing precedent). **Not
  built:** search across content types, summarization, an audit log, and a
  synced spec-shaped record for robot parity. Full reasoning in
  `docs/dev.md`.
- The turn engine (platform plan 4.5, split), the eighth slice of hub core:
  `backend/src/lib/turnEngine.ts`'s `runTurn()` is the real pipeline behind
  a conversation turn on the `chat` surface (the only surface implemented;
  overlay/pod/robot/tv/phone are a named gap, same shape as 4.11's role
  list). Safety runs first (a `refuse` verdict returns a deterministic
  refusal with no skill routing and no model call; `allow_with_resources`
  proceeds normally with crisis resources riding alongside the reply,
  never replacing it). Then the deterministic skill floor: a bundled
  package's `routing.patterns` (a single `*` wildcard capturing an
  argument) or `routing.examples` (keyword-overlap, the same
  documented-placeholder move `lib/memory.ts`'s recall() already made for
  real embeddings) can fire a Tier 0 skill with no model involved at all;
  a `consequential` package only fires on a real pattern match, never a
  fuzzy one. When nothing clears the floor, a stable-first prompt (persona
  and rules, content policy, standing instructions, the bundled skills
  list, then the volatile zone: recalled memories, then the current time)
  goes to the real `chat` role, with a hard character budget
  (`PROMPT_SYSTEM_CHAR_BUDGET`) proven by a test with 50 long memories.
  New route: `POST /api/turn`. `lib/text.ts` extracts the shared
  tokenizer memory.ts's recall() and the turn engine's example matching
  both need, one definition instead of two. **Deliberately not built:**
  tier 2 native tool calling, remote candidates, `ask`-continuation (the
  spec's `SkillResult.ask` exists but no recipe step type can ever produce
  one, a real interpreter-level gap, not a skipped feature), a real
  Persona/style record (a fixed default stands in), and conversation
  history/summary/cross-surface context (platform plan 4.14, not built:
  every turn is stateless beyond a fresh memory recall). Full reasoning in
  `docs/dev.md`.
- The `chat` model role and a llama-server router skeleton (platform plan
  4.11, split), the seventh slice of hub core: `spec/llm/` has a
  hand-written, language-portable wire contract for llama-server's
  OpenAI-compatible chat-completions surface (non-streaming; no tools,
  JSON schema, or grammar yet), a real `LlamaServerClient`, and an
  in-process stub server for dev and test that speaks the identical
  contract, so the router path (start a backend, health-check it, send a
  request, parse a response) is exercised for real end to end without a
  GGUF. `backend/src/lib/llmSupervisor.ts` picks the backend lazily on
  first use: `MAIPAI_LLAMA_SERVER_URL` to point at an already-running
  server, `MAIPAI_LLAMA_SERVER_BIN` + `MAIPAI_CHAT_MODEL_PATH` to spawn a
  real one, or the stub when neither is set, which is every dev machine
  and the test suite today. `backend/src/lib/llm.ts` is the role port:
  only `chat` is implemented, every other role (`router`, `embed`,
  `vision`, `image`, `video`, `coding`, `tts`, `stt`, `wakeword`) is a
  real, named `capability_missing`/`unsupported_role`, not a silent gap.
  New route: `POST /api/llm/chat`, the same "provisional real caller
  ahead of the turn engine" pattern `/api/safety/check` set for the
  safety layer. `host.llm.complete` in `packageHost.ts` deliberately stays
  `capability_missing`: the `Host` RPC boundary is synchronous and a real
  chat completion is inherently async network I/O, a real architectural
  gap (needs both recipe interpreters to support async host calls) kept
  distinct from "not built yet." No GGUF, engine binary, residency policy,
  or `ModelCapabilities` record exist yet; which default chat model to pin
  and what hardware to build the real (non-stub) path against are flagged
  as Jesse's call, not guessed. A same-day review found and fixed a real
  bug: a failed backend start left a rejected promise cached forever,
  permanently wedging the `chat` role after one transient failure until
  the process restarted; also flagged, and deferred rather than guessed
  at, a missing rate limit on `POST /api/llm/chat`. Full reasoning in
  `spec/llm/README.md`.
- The scheduler (platform plan 4.7), the sixth slice of hub core: a
  durable job store (`backend/src/lib/scheduler.ts`, `scheduled_jobs`
  table) with one-shot and recurring jobs, persisted and surviving
  restarts, polled every 60s by `backend/src/index.ts`. Backs
  `host.schedule` for real (previously `capability_missing`) and finally
  gives `lib/memory.ts`'s maintenance pass a real timer instead of a
  manual-only trigger: a `memory.maintenance` core job seeds itself
  idempotently at every boot. New routes: `GET /api/scheduler/jobs`,
  `POST /api/scheduler/jobs/:id/cancel`, `POST /api/scheduler/run-due`.
  Scope is deliberately narrower than 4.7's full description: no device
  target, no quiet-hours policy, no notification-system integration (all
  need infrastructure that doesn't exist yet), and recurrence is a
  minimal `every:<n><unit>` grammar, not RRULE. A same-day review found
  and fixed three real issues: a past one-shot time was silently
  accepted as immediately due despite the code's own docstring and error
  message claiming rejection; a recurring job's reschedule advanced from
  the moment it actually fired rather than from its own due time, which
  would have permanently drifted a daily job's time-of-day later on
  every late tick (the fix needed a second pass once tested against a
  very overdue job, landing on a direct "next aligned slot" calculation
  rather than catching up one interval at a time); and cancelling a job
  that had already run could silently flip its status after the fact.
  Full detail, including the one known gap (a job scheduled from inside
  a recipe can't carry that recipe's input scope through yet), in
  `docs/dev.md`.
- The package host (platform plan 4.9), Tier 0 only, the fifth slice of
  hub core: `backend/src/lib/packageHost.ts` builds a real `host.*`
  implementation per package invocation, backing `memory.recall`/
  `memory.remember`/`data.forget` and `config.get` against the real
  memory and settings stores, permission-checked against the manifest's
  declared `permissions` first. Everything without a real backing
  service yet (fetch, home control, integrations, speech, the LLM role,
  camera, OCR, scheduling, files, actions, diagnostics) honestly throws
  `capability_missing` rather than silently no-opping.
  `backend/src/lib/skills.ts` loads a bundled package's manifest and
  recipe from `backend/packages/<id>/`, validates both against spec's
  schemas, checks `min_role`, validates the call's inputs against the
  manifest's own `args` JSON Schema with `ajv`, and runs it through
  spec's real interpreter. `backend/packages/remember/` is the first
  bundled package, the plan's own named example. New routes:
  `GET /api/skills`, `POST /api/skills/:id/run`. `spec/emulators/ts/
  host-emulator.ts` gained an exported `Host` interface so the
  interpreter types against a contract instead of the concrete emulator
  class, which also surfaced and fixed a real bug: the generated
  `Recipe` step type was silently `any`, defeating the interpreter's
  exhaustiveness check. A same-day review found and fixed four real
  issues (a missing required input silently writing a literal
  `{placeholder}` to memory, a raw `TypeError` escaping `host.fetch` on
  a malformed url, duplicated redaction logic that had already drifted
  between the real host and the emulator, and a documented mismatch in
  `capability_missing`'s catalogue wording). Full detail, including what
  Tier 1 and every other deferred `host.*` method still need, in
  `docs/dev.md`.

### Fixed
- A manifest that fails validation (a bundled package edited to a shape
  the running hub's schema doesn't know yet) is now diagnosable: it's
  logged once in the hub log and refused with "I can't do that right
  now. Something on my end isn't working," instead of silently landing
  the ungrounded-knowledge line a household member would read as "the
  conversation doesn't have that," with no trace of what actually went
  wrong (fixes #166).
- A `code-review` pass (2026-09-04) across the identity, safety, and
  memory slices found and fixed real bugs, the most severe being a
  safety-invariant violation: `self_harm` co-occurring with another
  flagged category (e.g. a jailbreak framing wrapped around a genuine
  self-harm statement) silently withheld crisis resources instead of
  offering them. Also fixed: `csam` and `credible_threat` false-positives
  on ordinary text ("MCP", "Essex", gaming talk); a soft-deleted person's
  session and credentials still working; `X-Forwarded-Host`/`-Proto`
  trusted unconditionally (CSRF and cookie-security gaps matching a fix
  already applied to `X-Forwarded-For`); an owner/admin able to export or
  erase an adult's private memories despite being unable to browse them; a
  lost-update race in the sign-in lockout counter; a macOS Keychain
  failure mode that could silently corrupt every stored PIN/password. A
  second review pass on the fix diff itself, before committing, caught
  two regressions the first pass introduced (an over-broad CSAM
  false-positive fix, a dropped obfuscation-resistance check) plus four
   smaller gaps; all fixed in the same commit. Full list with fix-site
  details in `docs/dev.md`'s "Code review pass, 2026-09-04" section.
- The chat header, message actions, and reply stats visibility were
  corrected so they render and toggle as intended.
- A searched question is now answered in the shape it calls for: prose
  for an ordinary question, a numbered list only when the results
  themselves were asked for. The #156 fix's own list-format line fired
  on every searched reply with rows, so a plain yes-or-no question came
  back as a numbered list too (#168).
- A direct-topic search (the kind SearXNG answers with a knowledge-panel
  infobox instead of ordinary results) now reaches the model at all: the
  search rows the model reads used to skip infoboxes entirely, so the
  model saw only whatever generic results came alongside one, usually
  with no summary text. When a whole result set genuinely has no summary
  text, the reply now says so instead of rephrasing the titles as if
  they were an answer (#169).
- Correcting a fact MaiPai just stated now gets a real answer, not an
  empty promise: it searches again or concedes plainly instead of
  saying "I'll look that up" or "I'll update my information" and doing
  nothing (CORRECTION-02).

### Added
- Settings (platform plan 4.6), the fourth slice of hub core: the store,
  built on the `SettingValue`/`SettingsKey` shapes spec v0.1 already
  defined. `spec/settings/keys.json` is generated, not hand-edited, from
  `backend/src/settings/coreKeys.ts` via a new `bun run gen:settings`
  script wired into `check.sh`'s drift check; one real key so far,
  `household.locale`. Values are keyed by scope (`household`,
  `person:<id>`, `device:<id>`) with a real hybrid logical clock
  (`lib/hlc.ts`) generated and compared on every write for genuine
  per-field last-writer-wins, even before real sync exists. Household
  settings: read by anyone, written by owner/admin. Person settings: self,
  or owner/admin for a child (the same rule memory uses, now shared via a
  new `lib/access.ts` rather than a second copy). Chosen over the turn
  engine as the next slice since the turn engine fundamentally needs an
  LLM and packages that don't exist yet; full reasoning in `docs/dev.md`.
  A same-day review before committing found and fixed a real gap: a
  `secret: true` registry key had no redaction anywhere in the response
  path, untested only because today's one declared key isn't secret; also
  fixed an HLC-recovery gap (a wall-clock regression after a restart
  could permanently block writes to a key) and an inefficient full-table
  role lookup. Details in `docs/dev.md`.
- Memory (platform plan 4.4), the third slice of hub core: the store
  (`backend/src/lib/memory.ts`), built directly on the `MemoryRecord`
  shape spec v0.1 already defined, no spec changes needed. `remember`
  validates against the generated Zod schema before writing; `list`
  browses without touching usage; `recall` scores by entity-first-then-
  keyword-overlap (a documented deterministic stand-in for real
  embedding-based "scored vectors", which need the embed role, 4.11) and
  does touch usage; `supersede` and `archive` are the routine tombstoning
  lifecycle (a real status transition, never a row delete); `forget` and
  `exportPerson` are the per-person privacy pair (2.2), and `forget` is
  the one real DELETE in the file, a deliberate exception to "never
  hard-deletes" for the deliberate erasure right. `runMaintenance`'s decay
  scoring is adapted from the legacy hub's tuned exponential-decay
  formula (principle 8); durable memories are protected from decay, a
  `state`-category memory always expires after 7 days, and unlike the
  legacy source this pass never hard-deletes a tombstone, since platform
  plan 4.4 says the store never does outside `forget()`. Visibility rules:
  household memories to any signed-in person (sensitive ones admin/owner-
  only), a person's own `scope: person` memories, plus a child's (not a
  teen's or an adult's) to owner/admin; `scope: self` is never returned to
  anyone, per the schema's own description. Deferred: the sleep-time judge
  itself, profile paragraphs, and real embedding-based recall (all need an
  LLM and/or embedder that don't exist yet), mood/unfinished-business
  reads (robot-specific), and real scheduled maintenance (4.7).
- The safety layer (platform plan 4.3), the second slice of hub core: a
  deterministic multi-signal classifier for the eight floor categories
  (self-harm, harmful requests, credible threats, CSAM, grooming, PII
  extraction, prompt injection, jailbreak framing), text only. Design and
  code live in `spec/safety/` so a Python port can mirror it later the way
  `spec/interpreters/` does; TS only for now, no `bot` content exists yet
  to pin it. New shared shape `SafetyResult` (dual-codegen'd), a labelled
  corpus (`spec/safety/corpus/corpus.json`, synthetic and persona-roster
  only), and `spec/safety/README.md` as the full design record including
  known limitations. The CSAM detector is adapted from the legacy hub's
  hardened, obfuscation-resistant blocklist (principle 8); the legacy
  hub's model-trusting "text floor" is explicitly not reused, since 4.3
  replaces exactly that architecture with a pre-model refusal. Hub-side:
  `backend/src/lib/safety.ts` applies the per-band policy (self-harm never
  refuses, only offers resources; every other category refuses; a minor
  speaker always sets `notify_parent`), `POST /api/safety/check` is the
  real caller until the turn engine (4.5) exists to call it internally.
- Hub backend skeleton (`backend/`, Bun and Hono, per `STACK.md`): a Bun
  workspace root joins it to `spec/`, so both share one lockfile and the
  backend imports `home/spec/`'s generated Person schema directly.
- Identity and sign-in (platform plan 4.1) and people (4.2), the first
  slice of hub core (chapter 4): profiles with a PIN or password
  (Argon2id via `Bun.password`, HMAC-peppered, the pepper held outside the
  database by a keystore that uses the macOS Keychain, Windows DPAPI, or a
  0600 key file), per-profile lockout with exponential backoff plus a
  per-IP throttle, `HttpOnly`/`SameSite=Strict` session cookies with a CSRF
  origin check, the role ladder (owner, admin, adult, teen, child, guest)
  enforced on every mutating route, and first-run setup that creates the
  household owner. SQLite storage via Drizzle ORM, with the schema-version
  guard `docs/ENGINEERING.md` requires (a database stamped newer than the
  running build refuses to open). Deferred to a later hub release:
  passkeys, TOTP, Quick Connect, device tokens, capability grants and
  content ceilings, the approval queue (all noted in `docs/dev.md`).
- `home/spec/` v0.1: the household's shared record shapes (Person,
  Setting, Memory/Entity/Episode, the package manifest, recipe, and
  result shapes), as JSON Schema with generated Zod and Pydantic v2
  bindings, both proven against fixtures. Both Tier 0 recipe interpreters
  and both host emulators, with recipe conformance fixtures proving the
  TS and Python interpreters agree. UI schema v0 for the Chat page.
- `scripts/check.sh` regenerates and drift-checks the spec codegen, runs
  its tests, then the backend's typecheck and tests, before the pinned
  `@maipai/standards` core.

### Changed
- This repo's history was reset to start fresh on the platform rebuild
  design (`docs/dev.md`); the prior version's history and 21 releases are
  preserved locally, outside GitHub, never migrated.
