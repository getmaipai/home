# Changelog

All notable changes to MaiPai Home. Format follows
[Keep a Changelog](https://keepachangelog.com); versions follow semver.
Everything stays `0.x` until the product passes its battle-tested
checklist (`docs/dev.md`); no release has been cut yet.

## [Unreleased]

### Added
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
