# Home connections live in the Stack (design note, 2026-11-25)

Status: proposal. Needs Jesse's yes on the Stack rule change in "The rule this touches" before any build.

## What Jesse asked for

The Stack admin page should show and manage the Homes connected to it. The connection belongs to the Stack. Home shows the same list and can act on it, but the Stack owns it, the way models work now.

## What exists today

- **Link to the Stack:** Home's AI and models page already has a "Stack admin" section for owners and admins (`frontend/src/apps/settings/StackAdminLink.tsx`, route `/api/ai/stack/admin-link`). On the Stack's own computer it opens the local address. From other devices it opens the remote address when remote access is on, and otherwise shows the Stack's plain reason.
- **The connection is owned by Home.** Home's `/api/engine-link` routes pair, pin the host key, show credential status and revoke. Home keeps the engine address, the Tailscale toggle, the SSH private key and the host pin (`backend/src/lib/remoteStackSettings.ts`, `lib/stack/link.ts`).
- **The Stack knows nothing about its callers.** Its rules say no people, no clients, no keys: it listens on loopback only, and the SSH key and pinned host key belong to the operating system's SSH service and to Home.

## Design

**One record, owned by the Stack: a connection.** Fields: id, name, kind (`home`), how it reaches the Stack (this computer, home network, Tailscale), key fingerprint, paired at, last seen, state (connected, not seen lately, paused).

**Stack admin page:** a Connections section under Set up. Each row shows the fields above and offers Pause, Resume, Remove (revokes that Home's access) and Pair another. Remote access (home network or Tailscale) is a setting on this page, not in Home.

**Home:** Settings, AI and models gets a Connections section that reads the same list through a forwarder (`/api/ai/stack/connections`) and sends every action to the Stack. The pairing steps move behind that forwarder too. Same pattern as models and drives: a shared kit component (`StackConnections` in `commons/ui`) over a client, one adapter in the Stack admin and one in Home.

**What stays in Home, because it cannot move:** the private key, the host pin and the tunnel process. They are the client side. Home shows them as "this Home's link" status, read from the Stack's record plus its own tunnel state.

**Order of work (spec first):**
1. `commons/spec`: a `StackConnection` shape.
2. Stack: migration, `/stack/v1/connections` (list, pause, resume, remove, pair), an admission-time "last seen" stamp for each caller.
3. `commons/ui`: `StackConnections` component and client interface; tag.
4. Stack admin adapter and Home forwarder plus adapter; pairing UI in Home reduced to a thin section.
5. Pin bumps, previews on desktop and phone width, ship.

## Reuse check (RULES S4, 9b)

The list is drawn inside the kit's settings shell as a section, like Drives, using shipped primitives only (rows, status badge, Button, confirm dialog from `commons/ui`). No prebuilt kit block lists paired devices, so `StackConnections` is a thin composition of those primitives, not a new look. No Element gets a `className` that changes its shape.

## Status (RULES S6)

Connected, not seen lately and paused are not a new status display. The Stack's record only holds the facts. Home reads them into the existing mechanisms: `lib/stack/linkRepairs.ts` raises and resolves the link issue, and `/api/status` carries the state. The Stack admin page uses its own existing status badge pattern. No new banner, dot, toast or polling loop.

## Supersedes

- Home's `/api/engine-link` pairing, credential-status and revoke routes as the owner of the connection: they become thin calls to the Stack's `/stack/v1/connections`. The private key, host pin and tunnel stay in Home.
- The Stack's "no people, no clients, no keys" wording (docs/dev.md line 76, AGENTS.md), if Jesse picks option A below. Home's `RULES.md` is not touched.
- Adjacent, not duplicated: REMOTE-STACK-LIVE-01 and REMOTE-STACK-LOG-01.

## The rule this touches

The Stack's "no people, no clients, no keys" rule. This design gives the Stack a record of paired Homes and the power to revoke one. Two ways to square it:

- **A (recommended):** amend the rule to "no people, no end-user clients, no key material". The Stack stores only fingerprints and the paired-Home record. Revoking asks the same OS helper that wrote the SSH authorization when pairing. The private keys stay with the OS and Home.
- **B:** keep the rule as written. The Stack shows a read-only list built from callers it sees, and Remove stays in Home. This gives visibility only, not management, and does not meet the request.

## Not sure about

- Whether the existing OS helper can remove one Home's authorization without a restart of the SSH service. Check before step 2.
- Whether more than one Home can pair to one Stack today. The record assumes yes.
