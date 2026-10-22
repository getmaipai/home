# Home mode: Normal and Optimized for coding (2026-10-22)

Owner's request, 2026-10-22 (chat): on a big machine, let the household switch Home into a mode where one large coding model is loaded and also answers chat and the other
model jobs, so coding gets the memory and the family still has a working Home. A switch in the household settings, offered by the setup wizard, installed and configured
by the recommended plan, and never changeable until everything it needs is proven ready. This note is the design; rows are in `docs/BACKLOG.md` ("Home mode").

## Answer

One new household setting, `coding.home_mode`: `normal` (default, today's Home) or `coding`. In `coding` mode the Stack runs one large model on Splash (Ornith-1.5-122B,
4-bit, with its DFlash2 draft) and binds the chat role, and the judge and router that already share chat's model, to that same process. The separate chat model is
unloaded first, because the two do not fit together; chat is unavailable for the short switch (the existing chat starting state). Embeddings, speech to text and text to
speech stay as they are. Pictures, videos and songs queue with a plain reason. Going back to `normal` unloads the large model, then reloads the residents. The switch is
disabled, with the first unmet reason beside it, until a readiness check has passed: coding on, the pieces installed and verified, the hardware able, the memory plan fitting,
a self-test that the Stack ran once and unloaded, a connected client, and a recorded benchmark verdict.

## Why it exists (measured 2026-10-21 and 2026-10-22, M5 Max, 128 GB, GPU limit about 111 GB)

| | Models in memory | About |
|---|---|---|
| Normal today | chat, judge, embeddings, voice | 36 GB |
| Normal plus the 27B coder on demand | add the 27B on Splash | 59 GB |
| Large model beside full Home | 122B plus the above | 121 GB, does not fit |
| Coding mode | the 122B serving chat and coding, plus embeddings and voice | about 91 GB |

The 122B on a Splash build decodes code at about 144 tokens per second and reads a 72K-token prompt in about 62 seconds, using about 85 GB. The 27B on the Stack's own Splash
setup decodes at about 124 tokens per second and reads the same prompt in about 52 seconds, using about 23 GB. On four self-contained tasks (a four-bug multi-file fix, an
expression evaluator, a cron next-run calculator, a regex engine) both models passed nearly everything; the 122B was not shown to be smarter on them. The mode therefore has to
earn its place on one claim only: a household that wants the largest local model can have it without taking Home offline. Every number above is a small sample on one machine
and is rechecked by MODE-BENCH-01 before the mode is offered.

## What is different in coding mode

| Part | Normal | Coding mode |
|---|---|---|
| Chat, judge, router | the resident chat model | the large model, same process as coding |
| Coding | on demand, second process | the same process, always warm |
| Embeddings, STT, TTS | resident | unchanged |
| Pictures, videos, songs | run when memory allows | wait, with the existing busy line and the reason "Home is in coding mode" |
| A child's or teen's chat | as today | thinking off, and no tools until the model has a measured record (rule 8); an admin may pause minors for the mode (owner decision below) |
| Chat speed and style | the current chat model | the large model; Home's replies must not be shorter, plainer or slower to first text than the bare model's (rule 13) |
| Memory used | 36 to 59 GB | about 91 GB, capped by the engine's own memory limit |

## The switch and its gate

`coding.home_mode` is a household setting in the Coding card of Home settings, written by an admin only, declared in spec first (`keys.json`, area `household.coding`), copy
from the spec through `describeSetting` (S4, S5). It is disabled, with the first unmet item as its reason line, unless every item of the readiness record is true. The record
is one function in the backend (`codingModeReadiness`, eight items), read by the setting's gate, the wizard, Status and the Stack link, and never recomputed by a client (S6):

1. `coding.enabled` is on and the coding role is installed.
2. The engine is Splash at a pinned build that serves the large model (the Stack's `resolveCodingEngine` says Splash, not a fallback).
3. The large model and its draft are installed and verified against the pinned sha256 and revision (the Stack's downloader, rule 11).
4. The hardware class allows it (128 GB or more, Apple silicon M3 or newer, macOS 26.4 or later).
5. The governor's admission dry run says the large model, its caches and only the residents that stay (embeddings, speech) fit under the memory budget with the margin. The chat
   model and the large model are never counted as loaded together.
6. A self-test has passed on this machine in the last 7 days: the Stack ran the full switch (chat unloaded, large model loaded), answered one chat turn with thinking off, one tool
   call and one coding turn through the real wires, then ran the switch back. Any engine, model or pin change clears it.
7. At least one coding client is connected, or the person chose "later" in the wizard (a key exists and the setup lines of the Coding settings, CODE-SET-01, were shown).
8. The MODE-BENCH-01 verdict for this large model on this memory class is `offer` or `offer with limits`, recorded in the catalog record.

Changing the mode while any item is false is refused in the backend with the same reason, not only greyed in the UI. A change is one transaction in a fixed order, because the
chat model and the large model do not fit together (121 GB against a 111 GB limit): chat shows the starting state with `cause: "mode_change"`, the Stack unloads the chat model,
loads the large model and passes the post-load check. On any failure it unloads the large model, reloads the residents, stays in `normal`, raises one Repairs item with the plain
reason and a link to the documentation, and the setting reads `normal`. Going back is the same transaction reversed: the large model leaves, then the residents load. The self-test
(item 6) is what makes this safe to try: the same steps already ran once at a quiet time.

## Status (rule S6: existing surfaces only)

| What | Surface | Data source |
|---|---|---|
| Switching modes, the large model loading | the chat starting state and the install strip | `roleHealth` with a new `cause: "mode_change"`; the Stack's job list |
| Chat paused for minors in coding mode | the existing pause line | a `chat.paused` style key per band, if the owner chooses it |
| Pictures, videos and songs waiting | the existing busy line | the Stack's governor reason `coding_mode` |
| The mode failed or a piece is missing | a Repairs item with Try again | `raiseIssue` with `learnMore` pointing at the coding-mode page |
| What is loaded and how much memory | the coding row on the Status page | `statusApps` over the role health |

No new banner, dot, panel or poll is added.

## The Stack (separate repo, own rows)

- Catalog: pin the large model (repo, revision, sha256, sampling from its model card with the source named, rule 3) and its draft; Splash's store accepts only an exact pinned
  model and draft, so both are added there.
- Engine source (owner's decision, 2026-10-22: "we can't wait for any release or update"): Splash 1.3.2 from the vendor refuses this model's shape, so the Stack ships a pinned
  build of a vetted fork as its own component (rule 11: the Stack builds, pins and tests it). The fork is the vendor's 1.3.2 plus the Ornith-122B topic branch (about 380 lines of
  kernel and model-shape code, read before use), built once on a machine with Xcode and its Metal toolchain, packaged in the vendor tarball's layout, hashed, published as a release
  asset of the org, and installed by the Stack's downloader by sha256 like every engine. No household machine builds anything. A vendor release that serves the model later replaces
  the pin; nothing else changes. Until the build is pinned and installed, readiness item 2 is false and the switch says why.
- Mode: a `stack.engines.coding.home_mode` setting. In `coding` mode `processRoleFor` maps chat, judge and router to the coding process; the resident chat model is unloaded first
  and reloaded on any failure or on return; the governor treats that process as the foreground resident (never evicted by a generator) and holds generators with the reason
  `coding_mode`.
- Memory: launch with the engine's own memory cap sized from the governor's admission so a long context cannot push the machine into the kernel-pressure evictions seen on
  2026-10-17; the engine's decode-share raised so a family chat turn keeps generating while a long coding prompt is read (measured, not assumed).
- Sampling and thinking: sampling stays from the catalog record for every request (a client's sampling is still dropped, CODE-API-01). Thinking effort is chosen per request: off for
  every chat turn, as for any chat engine, and the existing coding settings (effort and budget ceiling) for coding requests.
- Reuse check: the existing `coding` role, `sharesModelWith`, the governor, `splashStore`, the role-state events and the post-load check are reused. No new engine, no
  translating proxy, no second status channel.

## The wizard

A new step after the plan: "Coding on this Home". It explains the two modes in plain words and offers the recommended setup, which does everything Home can do by itself:
turn coding on, install the engine, the model and the draft through the plan (one progress strip, the existing job list), run the self-test, create the first personal key and
show the setup lines the Coding settings already show for OpenCode, Claude Code and Codex CLI (CODE-SET-01, CODE-API-02; no new client configuration). What Home cannot do on
another computer (install the coding tool itself, open the firewall for the tool's computer, add a key to a laptop) is listed as numbered steps with a link to the user page, each
step marked done only when Home can see it done (a request arrived on the gateway with the key). The wizard never switches the mode itself; the person does that from settings
once the gate is open. A person may skip the step and enable coding later from settings.

## Documentation

`docs/user/coding-mode.md` (grade 6): what the mode is, why it exists, what changes for the family while it is on, what it needs, how to switch and what the switch refuses.
`docs/dev/coding-mode.md`: the readiness record, the Stack binding, the memory numbers, how to add a model to the mode. The wizard copy is in the spec. The privacy page needs no
new row: the large model is downloaded the way every model is, and no new connection is made.

## Rule check

- Rule 0 and 10: age and surface gates are unchanged and still outrank the mode; a minor's thinking stays off; the output gate stays for every turn.
- Rule 2 and 3: the engine returns the template, reasoning split and tool parsing; sampling comes from the large model's catalog record with its source named, for chat and coding
  alike. Because the chat turn offers tools, the model is accepted for chat only with the tool-decision measurement (evidence recall and false searches on the CHAT-AB-01 fresh set,
  at least 3 repeats), the reply-quality measurement and the repetition measurement on spoken companion turns, all in MODE-BENCH-01.
- Rule 8: a model with no measured record keeps the no-tools fail-safe for minors until MODE-BENCH-01 records it.
- Rule 11: only the Stack's pinned, tested components run the models; the mode never points Home at an outside server.
- Rule 13: CHAT-AB-01 runs on the large model as chat before the mode is offered, with the child turn, the spoken-turn first-word bar, the two memory scripts, the safety rows and
  the companion-voice row.
- S4, S5, S6: settings area as data, copy from the spec, status on existing surfaces.
- No rule is changed.

## Supersedes

In `docs/design/local-coding-2026-10-17.md`, only while `coding.home_mode` is `coding`:
- the coexistence rule that the coding model is a second on-demand process beside a resident chat model that is never shared ("chat is the one resident foreground model"; "a coding
  loop cannot queue a family member's chat turn"): the large model is the foreground resident and shares its engine slots with chat;
- the p128 model table, which already offers two choices (Fast and Careful): the large model is added as a third, mode-only choice, not offered in `normal`;
- thinking set once at the server for the coding process (CODE-STACK-01): in this mode the one process serves chat and coding, so thinking effort is chosen per request (off for
  chat turns, the existing coding settings for coding requests). Sampling is unchanged: it stays from the catalog record and a client's sampling stays dropped (CODE-API-01).

Everything else in that note, the Coding switch, the keys, the gateway and the Code app, stands. The client setup lines (CODE-SET-01, CODE-API-02) are reused as they are.

## Slices (rows in the backlog)

1. MODE-SPEC-01 (`commons/spec`, first): `coding.home_mode`, the readiness record shape, the area placement, copy, the wizard step copy.
2. MODE-ENGINE-01 (`stack` and release tooling, before MODE-STACK-01): build, package, hash, publish and pin the vetted Splash fork.
3. MODE-STACK-01 (`stack`): pins, Splash store entry, the mode binding, the post-load check, the unload-first order and rollback, the memory cap, governor reasons.
4. MODE-HOME-01 (`home`): the setting's backend gate and `codingModeReadiness`, the Stack sync, status rows, the Repairs items, the settings UI row.
5. MODE-WIZARD-01 (`home`): the wizard step and its recommended-plan hook, the guided and manual steps with the user page links.
6. MODE-BENCH-01 (bench, GPU lock, not in the gate): CHAT-AB-01 on the large model, the contention test, memory on a 128 GB machine, the 27B and the large model on the same Splash
   settings. It also carries rule 3's tool-decision measurement (evidence recall and false searches on the CHAT-AB-01 fresh set, at least 3 repeats), the repetition measurement on
   spoken companion turns and the companion-voice row. The verdict (offer, offer with limits, do not offer) is readiness item 8.
7. MODE-DOC-01 (docs): the user and dev pages and the wizard copy, in the same commits as each slice.

## Decided

Engine source: the Stack ships a pinned, vetted build of the fork (owner, 2026-10-22). Slice MODE-ENGINE-01 does it.

## Open decision for the owner

Minors while the mode is on: keep them chatting with thinking off and no tools until the model is measured, or pause minors' chat for the duration with a plain message.
