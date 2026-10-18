# Local coding: phase 1 scope (2026-10-18)

Status: proposed, for the architect's verdict (item `CODE-PHASE1-2026-10-18`). The design it narrows is
[local-coding-2026-10-17.md](../design/local-coding-2026-10-17.md) (architect item `CODE-DESIGN-01`); plain words in
[the overview](../design/local-coding-overview-2026-10-17.md). Owner direction 2026-10-18 is quoted where it matters.

## What phase 1 is

A new install can run a local coding model and hand it out through personal API keys, and nothing else:

1. **The recommended setup installs the coding engine and the coding model** on a machine that can run them, so coding works
   out of the box once an admin turns it on.
2. **Home settings let an admin install or remove each piece on its own** (the engine, the model), with their disk size shown,
   "in case you didn't want it", and turn Coding on or off (off by default, as the design already says).
3. **An admin assigns keys to individual people and manages them** (create, rename, expiry, revoke, revoke all, the per-person
   Coding access row), through the design's key store and its `/code/v1` gateway.
4. **Home installs no client.** Owner: "individual users may not want to use aider - they will choose what they want like open
   code. we just give them keys." The connect screen shows a copy-and-paste setup line with the person's key and the home
   address; nothing is installed on the Studio for a person's tool, Aider included.
5. **Not in phase 1:** the Code app, the sandbox, git connections, any IDE, any mobile app. Phase 2 is the Code app with an IDE
   in the web app, so a person can code directly from Home. Its backlog row is not added by this note.

Phase 1 rows (all exist in `docs/BACKLOG.md`): CODE-SPEC-01, CODE-BENCH-01, CODE-STACK-01, CODE-KEYS-01, CODE-API-01,
CODE-API-02, CODE-SET-01, CODE-PRIVACY-01, and CODE-SAFE-01 for the API door and the kill switch. Phase 2 rows: CODE-SANDBOX-01,
CODE-GIT-01, CODE-KIT-01, CODE-AGENT-01, CODE-APP-01, CODE-NOTIFY-01, and a new editor row that needs its own verdict.

## What changes in the design (and why)

**The engine per tier.** The 2026-10-17 design serves the coding model with the Stack's llama-server. A trial on the owner's
Studio (M5 Max, 128 GB, 2026-10-18; numbers in CODE-BENCH-01 and `data-scratch/bench27/SUMMARY.md`) measured Splash 1.3.2
(Apache-2.0, a sha-pinned release tarball through `brew install incoai/tap/splash`, no Xcode) at 124 tok/s on Qwen3.8-27B
against 18 tok/s for the pinned llama-server, with the same weights, and 10 of 10 on a coding suite and 3 of 3 Aider tasks.
Splash runs only on Apple silicon (M3 or newer, 36 GB or more). Homebrew was only how the trial installed it; Home never uses brew at run time. Splash is used only after it has an entry in the catalog's `engines/index.json` (exact URL, sha256 and size), is installed and pinned by the Stack like every engine (rule 11), and passes the engine contract suite that ENGINE-SPLASH-01 still owes. So the coding role's engine is chosen per tier in CODE-STACK-01:
Splash where the machine qualifies and the gateway verifies its `/v1/messages` and `/v1/responses` wires (CODE-API-01 and
CODE-API-02 carry that check; Splash's claim of those endpoints is untested), llama-server everywhere else and as the fallback
when Splash's wires fail the check. The design's "wires served natively by the engine, no translating proxy" holds on both.

**Install and remove through the catalog.** The coding model is a catalog `model` package (docs/PACKAGES.md); the coding engine is
an entry in the catalog's engine index, installed and pinned by the Stack (PACKAGES.md has no `engine` package kind and this note
adds none). Settings lists both with their size and an Install or Remove button for an admin. Removing a piece while Coding is on is refused with a plain sentence until Coding is turned off; keys stay and are
suspended while a piece is missing. The model downloads from its pinned source by revision and sha256 through the Stack's
downloader; the engine installs by its pinned release. Both are downloads at install time, listed on the privacy page
(docs/THIRD-PARTY-SERVICES.md), never at run time.

**A thinking cap is part of the coding role.** The trial found uncapped thinking looped to the token limit on some answers
(7 of 10 correct), and a cap fixed it (10 of 10, 86 s against 327 s): reasoning effort medium and a 2,000-token thinking budget
on Splash. The coding role carries a per-request thinking budget (a spec setting added in CODE-SPEC-01, default from the bench),
which a client cannot raise past the admin's ceiling. The budget only limits thinking; it never turns thinking on for a minor, whose protections hold on this door as on every other (rules 2 and 8).

## Supersedes

This note supersedes only these parts of `local-coding-2026-10-17.md`: (1) the assumption that the coding engine is always
llama-server (it is per tier now, with llama-server the fallback); (2) the unphased order of its rows (phasing above); and
(3) the connect tabs' implication that Home provides a client: Home provides keys and setup lines only. Everything else in that
note stands, including who may use coding, the keys, the gateway's rules, the safety floors and the model defaults.

## Reuse check

Prebuilt options considered and used: Splash (an engine that already serves Anthropic Messages and OpenAI wires, reasoning
effort and a thinking budget), llama-server at the existing pin, the catalog package system for install and remove, the kit's
Settings primitives and the existing status mechanisms (no new banner or panel: the progress strip, Repairs and role health, rule S6), the existing key store plan (CODE-KEYS-01). Nothing is hand-built that one of these covers. Considered
and not used: oMLX and Rapid-MLX (measured 30 and 32 tok/s; oMLX scored 3 of 10 on the suite; Rapid-MLX sends telemetry by
default), bundling Aider or OpenCode on the Studio (the owner chose keys only).

## UI

The admin and person Settings screens use kit primitives only (rule 9); no `className` override on a kit Element and no wrapper.
Install and remove progress feeds the existing progress strip (`installStatus.ts`), a failed or missing piece raises a Repair
(`raiseIssue`), and the coding role's health feeds the existing role health, all directly in phase 1 (rule S6; no new banner, dot,
panel or polling loop). The refusal to remove a piece while Coding is on is the kit's destructive Alert. Phase 1 does not rely on
CODE-NOTIFY-01, which stays in phase 2. Copy goes through `describeSetting`.

## Privacy acceptance added to CODE-PRIVACY-01

Before Splash ships as the coding engine, record its outbound behaviour in `docs/PRIVACY.md`'s terms: any telemetry and any run-time
update or model-hub check, and how the Stack runs it with those off or offline (`--offline`, environment switches), verified on a
scratch Stack. The trial saw none in the Splash formula or the Splish source it was compared with, but nothing on record proves
Splash itself sends nothing. An engine that phones home does not ship.

## Out of scope

The Code app and its sandbox, git, the editor and any mobile client (phase 2); changing a model pin; the engine contract suite
run (ENGINE-SPLASH-01 keeps it).
