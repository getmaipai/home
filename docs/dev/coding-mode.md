# Coding mode (developer notes)

Design record: [coding-mode-2026-10-22.md](../design/coding-mode-2026-10-22.md). User page: [coding-mode.md](../user/coding-mode.md). Backlog: "Home mode" rows.

## Retired by the Max chat lease (TIER-HOME-05, 2026-10-31)

There is no household switch any more. `PUT /api/settings` for `coding.home_mode` answers 400, the Settings row and the "Home mode" wording are gone, and
`reconcileCodingModeAtStartup` resets a stored `coding` to `normal` and returns a Stack left in coding mode to normal when no lease is held. The key stays in
`@maipai/spec` until a spec tag removes it (nothing reads it). The Stack's coding-mode transaction is now the lease's swap: see
[max-chat-lease-2026-10-31.md](../design/max-chat-lease-2026-10-31.md) and `backend/src/lib/chatLease.ts`. Readers that used the switch ask
`chatLeaseHeld()`. The rest of this page describes the transaction and the readiness record, which the lease reuses unchanged.

## The setting and the gate (historical)

`coding.home_mode` (`normal` | `coding`) is a household setting declared in `@maipai/spec` (`settings/keys.json`, `lives_in: household.coding`, admin only). Home does not push it like the other coding settings: it is a
transaction run by the Stack. `PUT /api/settings` for this key goes through `routes/settings.ts`: `coding` is refused with a 409 and the first unmet reason unless `codingModeReadiness()` is `ready`; after the write Home calls the Stack's
`POST /stack/v1/coding/mode` and follows `GET /stack/v1/coding/mode` until it is `stable` or `failed`. A `failed` result writes the setting back to `normal` and raises one Repairs item (`source: coding_mode`). Home start reconciles the setting with the Stack.

## The readiness record

`backend/src/lib/codingMode.ts` builds the spec record `CodingModeReadiness` (`ready`, `first_unmet`, eight `items`). The items, in order: `coding_enabled`, `engine`, `pieces`, `hardware`, `memory`, `self_test`, `client`, `bench`.
Items 2 to 5 and 8 come from the Stack's `checks`, item 6 from `self_test`, item 7 from the personal keys (or the wizard's "later"). `ready` is derived, never stored. The plain reasons are the spec vocabulary `coding-mode-readiness-reasons.json`; each item's
`doc_anchor` is a heading in `docs/user/coding-mode.md`, so a heading rename needs the vocabulary and the page changed together.

## The Stack side (separate repo)

- Pins: `ornith-1-5-122b-mlx-4bit` (target, 23 files, about 69.6 GB, MIT) and `ornith-1-5-122b-dflash2-draft` (Apache-2.0) in the Stack's `modelCatalog.ts`; selectable on the 128 GB tier only; the target's `modeVerdict` (`pending`, `offer`,
  `offer_with_limits`, `do_not_offer`) gates `checks.bench`.
- Engine: the vendor's Splash 1.4.1 release, unchanged, pinned by sha256 in the Stack's engine catalog and the Catalog's `engines/index.json`. It serves Ornith-1.5-122B itself (a real run on the Mac Studio on 2026-10-28 loaded the pinned MLX model and answered a tool call). The org's earlier fork build (`1.3.2-ornith.1`) is retired and its release asset deleted.
- Switch order into `coding`: chat shows `cause: "mode_change"`, the Stack stops the chat and judge processes, starts Splash with the heavy model, runs the post-load check (chat turn with thinking off, a tool call, a coding turn), binds chat, judge and router to
  that process, and holds picture, video and music jobs with the governor reason `coding_mode`. Any failure unloads the heavy process and restarts the residents. Back to `normal` reverses it. The two sets never run together.
- Thinking is per request: off for chat turns, the coding settings (medium and the budget ceiling) for coding requests. Sampling stays from the catalog record; a client's sampling is dropped.

## Memory (M5 Max, 128 GB, GPU limit about 111 GB)

Normal about 36 GB; with the 27B coder about 59 GB; the large model alone about 85 GB at a 72K context; coding mode about 91 GB; the large model beside full Home about 121 GB (does not fit). The Stack caps the engine with `--max-memory` from the governor's admission.

## Adding another model to the mode

1. Pin the model and its draft in the Stack's catalog with sha256, revision and the model card's sampling (rule 3), and make the Splash store able to lay it out.
2. Run MODE-BENCH-01 for it and set its `modeVerdict`.
3. Nothing in Home changes: the readiness record reads the Stack.

## Testing without the real model

The Stack's `homeMode.ts` takes its runtime operations as an injected adapter; the tests script start, stop, check and bind and assert the order of calls. Home's tests script the Stack client. The real run is the end-to-end test on a scratch Stack with its own data folder.

## Coding from your own devices through Tailscale Serve

When the hub is reached through Tailscale Serve (a proxy on the same computer), the gateway sees a loopback peer and forwarding headers, so
`transportRefusal` in `lib/codeGate.ts` refuses it as a proxy. `lib/tailnetNode.ts` is the one narrow exception, and it runs before the API key
check, never instead of it. A request is let through only when all of these hold:

- the household setting `coding.api.away` is on (an admin allowed Tailscale);
- the socket peer is loopback, and the Host is not the configured public address;
- the only proxy headers are the three Serve adds (`x-forwarded-for`, `x-forwarded-host`, `x-forwarded-proto`), the protocol is https, and
  `x-forwarded-for` is a single tailnet address;
- Tailscale's own answer (the local daemon's whois for that address) says the device belongs to the same Tailscale account as this computer,
  and is not a tagged device, and the `Tailscale-User-Login` header, when present, matches that account.

Anything else, including no answer from Tailscale, is refused. The hub finds Tailscale's local socket from `TAILSCALE_SOCKET` when set, else
`/var/run/tailscaled.socket`, else the user-mode daemon's socket under a home folder (`Library/Application Support/tailscale-user/tailscaled.sock`).
Limiting this to named devices needs a household setting for the list (spec first); not built.
