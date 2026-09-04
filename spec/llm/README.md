# Models and the engine: the `chat` role's wire contract

Platform plan 4.11: "Roles, not model names, in code: `chat`, `router`,
`embed`, `vision`, `image`, `video`, `coding`, `tts`, `stt`, `wakeword`.
Each is a port with one wire contract: OpenAI-compatible HTTP for text
and embeddings... The engine is llama-server, only." This directory holds
that wire contract, language-portable in spirit (plain types and a plain
HTTP client, no TS-only tricks), the same precedent `spec/safety/` and
`spec/interpreters/` set. `backend/src/lib/llm.ts` and
`backend/src/lib/llmSupervisor.ts` in the hub are the real consumer.

## Scope of this pass

**One role only: `chat`.** `router`, `embed`, `vision`, `image`, `video`,
`coding`, `tts`, `stt`, `wakeword` are named in `backend/src/lib/llm.ts`'s
`LlmRole` type but every one throws `capability_missing`: `router` needs
tool-calling prompts the turn engine doesn't exist to build yet, `embed`
needs an embedder binary and a real recall path (`lib/memory.ts`'s recall
already documents this as its own gap), and the rest (vision/image/video/
coding/tts/stt/wakeword) have no consumer anywhere in this repo yet. This
is the same "narrow to what's genuinely buildable now" discipline
`docs/dev.md`'s other Hub v0.1 slices already followed.

**Non-streaming only.** 4.11's contract wants "chat completions with
streaming, tools, JSON schema, grammar, `chat_template_kwargs`."
`types.ts`/`client.ts` have none of tools, JSON schema, grammar, or
streaming: every request sends `stream: false` and reads one JSON body.
Real llama-server always speaks this subset regardless of what else it
supports, so this is a true subset, not a divergent contract; the
turn engine (4.5) will need tools and JSON-schema-constrained output for
routing and structured replies, and streaming for barge-in-aware speech,
before it can do its real job. Both are additive: the request/response
shapes above only grow fields, so a future pass doesn't need to change
what's here, just add to it.

**`ModelCapabilities` landed 2026-09-04, narrower than 4.11's full list.**
This section originally deferred it ("nothing to populate it and no code
that reads it... a speculative shape") until a real producer and consumer
existed. Both do now: `backend/src/lib/hardware.ts` (real hardware
detection) and the model-selection wizard's informational half
(`frontend/src/apps/settings/ModelsSection.tsx`). `spec/schemas/model-
capabilities.schema.json` only carries the fields those two actually use
(id, role, license, engine, sizing, pros/cons, implemented) - 4.11's
fuller list ("tools, JSON schema, grammar, vision, think-mode key,
template source, sampling, safety notes") stays a named gap, still
unpopulated because nothing yet produces or reads those specific fields.
See `docs/dev.md`'s "Hardware detection and the model-selection wizard"
entry for what was built and what's still deferred (the download queue,
engine-launch auto-tuning, and any real image/video backend to run the
catalog's `image`/`video` entries against).

## What's real vs. stubbed

`client.ts`'s `LlamaServerClient` is a real HTTP client: it makes actual
requests to whatever base URL it's given, and works unmodified against
either a real llama-server or `stubServer.ts`'s in-process stand-in,
because both speak the same three endpoints (`/health`, `/v1/models`,
`/v1/chat/completions`). `backend/src/lib/llmSupervisor.ts` decides which
backend to point the client at: a configured `MAIPAI_LLAMA_SERVER_URL`
(point at an already-running server) or `MAIPAI_LLAMA_SERVER_BIN` +
`MAIPAI_CHAT_MODEL_PATH` (spawn a real one) if either is set, otherwise
the stub, which is what every dev machine and the test suite uses today
since neither is configured anywhere in this repo. **The stub is not a
mock of the client, it's a real, if canned, server**: the router code
path (start a backend, health-check it, send a real HTTP request, parse
a real HTTP response) is exercised for real end to end, the only thing
that differs when a real engine is configured is which process answers.

## Deliberately deferred, all real 4.11 scope not attempted this pass

- **The real engine.** No GGUF is downloaded, pinned by sha256, or
  installed by this pass; no llama-server binary is fetched for any
  platform (Windows CUDA, macOS Metal, Linux CUDA/Vulkan). `llmSupervisor.
  ts`'s spawn path is real code (`Bun.spawn`) but has never been run
  against a real binary in this repo; it needs a real binary and model to
  prove.
- **The residency policy.** 4.11 describes a router process fronting many
  models with `/models/load`/`/models/unload`, role-specific residency
  (chat and embedders pinned, router 30 minutes, vision 15), GPU
  placement, KV cache tuning, slot save. This pass has exactly one role
  and one process; there is no policy to write yet with only one thing to
  place.
- **Bring your own model, the eval flow, the safety-floor gate on model
  choice.** All need a real catalog and a real install/config UI, chapter
  5 and 6 work that hasn't started.
- **Embeddings**, real or otherwise: the `embed` role throws
  `capability_missing`.
- **`host.llm.complete` is still `capability_missing` in
  `backend/src/lib/packageHost.ts`, on purpose, not because this role
  doesn't exist any more.** The `Host` interface's methods are all
  synchronous (`spec/emulators/ts/host-emulator.ts`), and so is
  `runRecipe()` (`spec/interpreters/ts/recipe-interpreter.ts`): no step
  handler ever awaits a host call. A real chat completion is inherently
  asynchronous network I/O; there is no correct way to make that
  synchronous. Wiring `host.llm.complete` for real needs the interpreter
  itself to support async host calls, a change to both TS and Python
  interpreters kept behaviorally identical, out of scope here, the same
  category of deferral as the scheduler's recipe-input-carrying gap
  (`docs/dev.md`). No recipe step calls `llm.complete` today either
  (`recipe.schema.json` has no "llm" step type), so this has zero live
  blast radius. `backend/src/routes/llm.ts`'s `POST /api/llm/chat` is
  today's real (if provisional) caller instead, the same pattern
  `/api/safety/check` set for the safety layer ahead of the turn engine.

## A tracked gap, not silently repeated: no rate limit on `/api/llm/chat`

A `code-review` pass (medium effort, 2026-09-04) found `POST /api/llm/chat`
has no throttle in its chain (unlike `auth.ts`'s `secretThrottle.ts`),
so any signed-in person, including a `guest` or `child`, can fire
unlimited concurrent requests against the one supervised `chat` process.
This is a real gap, but the same posture `/api/safety/check` already has
(no rate limit either, any signed-in person checking their own text), and
fixing it well needs information this pass doesn't have: llama-server's
own `-np` (parallel slot count) determines whether concurrent requests
serialize gracefully or contend, which depends on the real engine and
hardware Jesse hasn't picked yet (see below). A generic per-person token
bucket (the "we are the user" pattern) is designed for *external*
services with a real risk of getting the household's address flagged;
this is the household's own hardware, a different kind of problem
(fairness and cost control, not abuse prevention). Deferred to whichever
of 4.5 (the turn engine, which will own real request budgeting) or a
later 4.11 pass (once a real engine's concurrency behavior is known)
addresses it, not fixed with a guess here.

## Narrowed, not fully closed

The hardware is now known (2026-09-04): this dev machine (Apple Silicon,
24GB unified) and Jesse's MSI laptop (RTX 2070 Super 8GB built-in, RTX
3070 8GB always-docked eGPU). `modelCatalog.ts`'s catalog recommends
Qwen3 8B Instruct (Q4_K_M) as the `chat` role's pick, fit-checked against
both. What's still genuinely open: no GGUF has been downloaded, no
`llama-server` binary fetched for either platform (Metal vs CUDA), and no
download-job queue exists to do either safely (a multi-GB action onto
Jesse's real machines, deliberately not auto-triggered - see docs/dev.md).
`MAIPAI_LLAMA_SERVER_URL`/`_BIN`/`MAIPAI_CHAT_MODEL_PATH` are still ready
to point at a real answer the moment that queue exists and downloads one.
