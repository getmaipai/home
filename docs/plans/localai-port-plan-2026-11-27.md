# LocalAI review: what we port, in what order (2026-11-27)

Status: proposal for the architect, owner answers recorded below. Source: a code review of LocalAI
(`mudler/LocalAI`, MIT, commit 08f74d1, read from a local clone, nothing run) by three reviewers on the server core,
the UX and media, and the agents and safety areas, then a second pass on connectors, recognition and engines.

## Supersedes

| Replaced or corrected | Where | What happens |
|---|---|---|
| The `BRAKES-01` remainder "background-turn limits and T4 taint" | `docs/BACKLOG.md`, `BRAKES-01` | The allowlist half moves to `ACT-POLICY-ALLOWLIST-01`; the `tool_action` kind, child ask and cards stay in `BRAKES-01`. |
| An outbound PII scrub as a new row | this plan's first draft | Dropped as a DUPLICATE of `CAP-06`. |
| Incognito proof as a new store | `THIN-INC` | `PRIVACY-LEVEL-PROOF-01` extends it with one decision function and a test, nothing else. |
| The order of agent work in the agentic design | `docs/plans/agentic-actions-design-2026-10-29.md` | Phase order here is M1 to M7 below; the design's slices and rules are unchanged. |

## Decision

We stay on our own Stack. LocalAI is a general model server for developers and teams. Home is a private family hub
with age gates, per-person grants and a no-phone-home rule, and LocalAI has none of those. Switching would not remove
the cost of building Home on top of it.

What the review found that matters for the decision:

- Its auth is off by default, and single-node YAML hot reload is not wired.
- On one node it never checks free memory before a model loads. It treats Apple unified memory as 100% VRAM.
- Its image, video and music endpoints are plain request and response, with no queue or progress.
- Its stuck-request watchdog kills a backend by wall-clock age, which would kill our long jobs.
- Its injection defense is a prompt line. It has no per-run taint rule and no age tier.
- Its backend images use mutable tags with no hashes, and its upgrade checker polls on a timer.

We are ahead on memory admission, engine integrity, voice endpointing and media jobs. LocalAI is ahead on
connectors, the files workspace, change history, running code and office files.

## Owner answers (2026-11-27)

1. File this plan as backlog rows and a plan note: yes.
2. Browser work (the companion operates a real website): run `BROWSER-BENCH-01` first and decide from the numbers.
3. First connector in the calendar, files and mail step: calendar, read-only.
4. Review of the Kubernetes, GitHub, PiKVM and SSH add-ons: skipped, out of scope.

## Baseline for agent work

ChatGPT's agent mode has been retired. Its help page points to ChatGPT Work, so Work is the baseline. Its sources
disagree on dates and limits, so no figure from it is quoted here.

Where we stand against it: web research with checked citations, lists, reminders, alarms and one smart-home device
with Undo are built. Scheduled model turns, a progress page, running code, office files, calendar, mail and a real
browser are not. Most have a design and no code. Our measured tool-choice accuracy on the 27B is 71 to 78% against a
95% bar, so unattended multi-step browsing is unproven until the bench runs.

## Order of work

### Phase 0: check and fix cheap holes

| Step | Row | Size |
|---|---|---|
| Fill the rerank role with a pinned model and prove search calls it | Stack row, see below | S |
| Test that every route either refuses an unauthenticated write or is on a named allowlist | `WRITE-ROUTE-COVERAGE-01` | S |
| Check four unknowns: a ship killing in-flight turns, boot repair after a crashed swap, context overflow status, dial-time SSRF checks | Stack and Home, see below | S |

### Phase 1: safety foundations for all agent work

These come before any agent that acts. `BRAKES-01` is the parent: its `tool_action` approval kind should carry an
"outcome unknown" state and an expiry. The audit keeps no arguments and no hash of them (rule 6a).

| Step | Row | Size |
|---|---|---|
| Unattended runs start read-only; an unknown tool is refused | `ACT-POLICY-ALLOWLIST-01` | S |
| Write a "about to run X" note before a risky tool | `TOOL-INTENT-LINE-01` | S |
| Check the privacy level at every persistence point, with a proof test; never for minors | `PRIVACY-LEVEL-PROOF-01` | S to M |
| Default-deny floor under the per-person Home Assistant matrix, which an admin may override | `HOUSE-FLOOR-01` | S |
| Workspace rules, below | `WORKSPACE-RULES-01` | S |

### Phase 2: visible wins

| Step | Row | Size |
|---|---|---|
| Per-turn latency waterfall, counts only | `TURN-WATERFALL-01` | M |
| Voice session as a pure state machine with seeded random-walk tests | `VOICE-MACHINE-01` | M |
| Route preload on hover and one reload on a stale chunk | `CHAT-PRELOAD-01` | S |
| Find in thread, kit Element first (rule 9) | `CHAT-FIND-01` | S to M |
| Resume a turn after a hub restart | `CHAT-RESUME-01` | S to M |
| Model update safety, fit wording, engine tuning and the sound and speech engines | Stack rows, see below | S to M |

### Phase 3: new capability, in agent order

| Step | Rows |
|---|---|
| M1 safe actions everywhere | `BRAKES-01`, `ACT-POLICY-ALLOWLIST-01`, `TOOL-INTENT-LINE-01`, `AGENT-ACTION-BENCH-01` |
| M2 scheduled and long tasks | `SCHED-02`, `ACTIVITY-01`, `PROJ-TOOLSTEP-01`, `HEARTBEAT-01`, `ERRAND-01` (all need `MODEL-BG-SPEC-01`) |
| M3 code and documents in a sandbox | `CODE-SANDBOX-01`, `AGENT-DOCS-OUT-01` |
| M4 calendar, files, mail | calendar read-only first (owner answer 3), then `INBOUND-CONNECT-01`, `INBOUND-TELEGRAM-01`, `CONTACTS-01`, `EMAIL-DRAFT-01` |
| M5 read-only browser | `BROWSER-BENCH-01` first; build only if it passes |
| M6 browser that acts | after M5 passes; logged-in sessions through a credential broker, an approval on each submit, a takeover window |
| M7 parity extras | routines saved from runs, then narrow standing approvals |

Also here: `WORKSPACE-STORE-01` (needs its own design record first), `PAIR-INVITE-01`,
`PKG-LIFECYCLE-JOURNAL-01`, and Slack and Discord after Telegram. The outbound PII scrub is the existing `CAP-06`;
its gap for exported traces is added there, not filed as a second row.

## Workspace rules (the file-safety model)

These stop two sessions clobbering each other and keep local files safe. LocalAI traces showed its writers have no file
locks, `write_file` is last-writer-wins, and anyone with write access can undo someone else's change.

1. A session writes only to its own workspace. A shared folder is read-only unless the owner grants write to that session.
2. Code goes on a branch per session, merged by a person after a diff review. Never two sessions on one branch.
3. Saving back household files checks the version the session started from. If the file changed, keep both versions and tell both sides. No blind overwrite tool.
4. Every change records its session. Undo works on your own session's changes only, and never over newer edits.
5. "Undo this run" reverts a whole session at once.
6. Commands never run on the hub itself, only in the sandbox.
7. A risky tool writes "about to run X" first, so a restart never repeats it blindly.

## The three gates every connector goes through

1. Identity: each outside sender maps to a household member with an age band, by numeric ID only. Nothing acts as the account owner. A group chat counts as an unknown speaker at the child band (rule 0).
2. Capability ceiling: default-deny, and sensitive actions need pairing.
3. Taint: anything inbound marks the run, so a tainted run cannot send, spend or delete without approval.

## Do not port

- Their backend contract and installers (mutable tags, no hashes, timed phone-home).
- Their P2P transport and relay: once enabled it contacts public bootstrap peers. The pairing design is worth taking, the transport is not.
- The cloud passthrough and its MITM proxy.
- The admin assistant: its confirmation lives in a prompt, not in code.
- Context compression: it promotes user text to system authority.
- Their face store and consent model, and age estimates from faces.
- FizzBee specs and AutoMigrate.

## Stack rows to file in the Stack backlog

These belong to `getmaipai/stack`, so they are listed here and filed there.

- Rerank: fill the role with llama-server `--reranking` and a pinned bge-reranker GGUF (S).
- Model update safety: a load check after an update, auto rollback and a crash journal (M).
- Fit wording on measured peaks in the admin page, then fit-aware variant selection and the HF importer's shard and quant parsing (S to M).
- Startup sweep of interrupted engine swaps, context overflow returned as 400, and a no-progress watchdog (S each).
- Per-engine redacted log buffer (S).
- N-gram speculative flags, if the pinned llama.cpp has them (S).
- CED sound tagging through sherpa-onnx, Parakeet v3 and then streaming ASR, and LocalVQE echo cancellation (S to M).
- Failover chains (M) and a `/metrics` endpoint (optional).

## What was not verified

- Nothing was run on either side. Effort sizes are estimates.
- LocalAI speed claims are unmeasured, and the licenses of its liveness, PII and echo-cancellation models are unchecked.
- Whether the live hub has the latest research and tool rows was not checked.
- The Kubernetes, GitHub, PiKVM and SSH add-ons were not reviewed.
- Some inventory of our own code came from helper reports and was spot-checked, not fully re-read.
