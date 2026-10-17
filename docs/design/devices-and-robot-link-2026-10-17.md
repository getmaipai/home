# Devices and the robot link, hub side (2026-10-17)

Design note, written in the 2026-10-17 design audit. The Robots, Row-Bot and "Portability and the link" areas hold about
forty rows, half of them built (ROBOT-CHANNEL-01, ROBOT-ASSETS-01, ROBOT-NOTIFY-01, INITIATIVE-01, LIVE-VIEW-01's hub half,
MOTOR-REBOOT-CARD, REMOTE-STACK-PAIR-01 for the engine computer) and cite designs that are not in this repo
(`bot/docs/dev/design-reachy-mini-2026-09-27.md` v2, `design-vision-still-image-2026-09-28.md`,
`robot-tailscale-access-2026-09-28.md`). The bot repo keeps the robot's own design; this note is the hub's half, in one
place: the Devices app, pairing, what crosses the link, what the hub shows and never shows. Rules in [RULES.md](RULES.md)
govern; principle 2 (the robot is complete without a hub) and principle 3 (no data debt) bind; nothing here asks for a
rule change.

## Purpose

One Devices app where an admin pairs and watches every device the household owns (a robot, a phone, a TV, a pod, a browser)
and where a person sees their own devices. The robot's own screens (its face, its spoken lines) belong to `bot`; the hub's job
is to be the robot's brain when reachable, its asset source, its notification channel, and the one place the family manages
it.

## Users and gates

| Person | Sees | May do |
|---|---|---|
| Child | nothing in Devices; the robot talks to them through its own gates | ask the robot anything its band allows |
| Teen | their own phone and browser sessions | sign one out |
| Adult | their own devices; the household's robot card | answer the robot's offers and asks (BRAKES-02), restart a latched motor (MOTOR-REBOOT-CARD), open the live view when its policy allows |
| Admin | every device's name, kind and health (no person beside an activity, rule 6a), pairing, the robot's settings, the link state, the engine computer | pair, unpair, name, set areas, the robot's quiet hours and watch level |

Rule 0 holds on the link: a child's turn on the robot runs the hub's child path with the child's band, and a robot with no
hub runs its own copy of the same gates (principle 2); a robot never loosens a gate to answer faster. Rule 6a holds on every
device row: the hub shows health, counts and timings, never what a person said to the robot.

## Screens and IA

Devices is reached from the profile menu's System status and from Settings (S1: it is not a rail app; it is a household
system page) and emulates the Home app's accessory list (S2).

1. **Devices** (`/devices`): a card per device from the `device` record: name, kind, area, last seen, battery when it has one,
   the link state pill. The robot card is the existing `RobotBody` (its state from `RobotState`, the offers, the restart
   ask, the Live view button). A person's own phone or browser row shows its last-seen time and Sign out; an admin's view
   of another person's device shows the device name, kind and link health only, never who it belongs to beside a time (rule 6a).
2. **Add a device**: the existing `DEVICE-PHONE-01` QR with a one-time code for a phone; the robot's pairing code shown on the
   hub and spoken by the robot (the bot's pairing clip, ROBOT-CLIPS-02); the engine computer's check code (REMOTE-STACK-PAIR-01,
   built). All three are the same code pattern: one-time, ten minutes, stored hashed (CREDENTIALS.md).
3. **A robot's settings** (an app settings area, S4): name, area, quiet hours (QUIET-HOURS-01), watch level, whether it may
   offer (INITIATIVE-01), the off-LAN switch (`robot.offlan.tailnet`, ROBOT-ENDPOINTS-01), the people it may recognise (the
   consent list from FACE-CONSENT-02), and "Forget this robot" with what that erases.
4. **The link page** (`/devices/:id/link`, admin): the link state machine (paired, syncing, live, stale, unreachable), the
   last sync time, the oplog high-water marks per direction, counts of records by kind, and the never-sync list in plain words
   ("your chats stay on whichever device you had them on").
5. **Phone:** cards in one column; the robot's settings as the kit settings shell on a phone.

## What crosses the link (spec first, no data debt)

Principle 3: every record on either side is the spec shape with `id`, `provenance` and `hlc`, so pairing is a transfer, never
a translation. The decision this note records, closing the "Sync engine decision" row:

- **One oplog, hybrid logical clocks, column-level last-writer-wins with the hub's site id winning ties, and memory as
  append-plus-invalidate so prose never needs LWW** (the backlog's sync research under Portability, kept as written). Reuse
  check (principle 6): cr-sqlite gives column-level LWW from any language and is spiked first in ROBOTLINK-02; a hand-rolled
  oplog is built only if the spike fails on Bun's SQLite. Yjs and Automerge were weighed and carry a document model Home's
  records do not have; the spec already has `hlc` on every record. A memory edited on both sides inside a sync gap shows as
  "changed on the robot too" with both versions, because append-plus-invalidate keeps both.
- **Syncs:** `person` (the roster, FACE-CONSENT-02's prints when consented, `vision_watch`), `memory-record` (person-scoped,
  the person's own read-path projection), `list`, the `robot-asset-manifest`, settings in `robot` and `person` scope, the
  robot's `device` and `robot-state`.
- **Never syncs (the allowlist is in the spec, `spec/link/never-sync.json`, spec first):** conversations and turns (they are
  spec-shaped records per the "spec-or-local verdict" row and still stay on the device that holds them), a
  temporary chat, credentials and secrets, another person's memories, a teen's private records, the hub's own logs. The link
  page shows this list in words.
- **Adoption:** a robot that lived alone and then pairs transfers its records up with their original provenance; the hub
  never rewrites `provenance.origin`. A person who exists on both sides is matched by the pairing wizard ("Is this Astro the
  same Astro?"), never by name alone.

## Data and spec records

- `device`, `robot-state`, `device-command`, `robot-channel-frame`, `robot-offer`, `robot-asset-manifest`, `link-state`,
  `presence-state` (all exist in `commons/spec/schemas`). **Additions, spec first:** `link-state` gains `oplog: {sent_hlc,
  received_hlc, pending}`; `spec/link/never-sync.json` as the one allowlist; `device.kind` already closes the set.
- The hub's routes exist: `/api/devices/me/events`, `/api/devices/me/hub-endpoints`, `/api/devices/me/state`,
  `/api/devices/me/people`, `/api/biometric-prints/sync`, the live view routes. New: `GET /api/devices/:id/link` for the link
  page (admin), `POST /api/link/oplog` both directions (additive; the API rule).

## Offline and privacy

The link is the LAN; off-LAN only through the owner's own Tailscale when `robot.offlan.tailnet` is on, listed on the privacy
page (ROBOT-ENDPOINTS-01's row). A robot with no hub answers from its own copies (principle 2, rule 6's last sentence). The
live view is hub-only, adult-only, with the robot's own light on while it streams (LIVE-VIEW-01). Nothing about a device
leaves the house; the robot's assets come from the hub's store, downloaded once by the Stack.

Cross-app features (the [media apps blend note, section 12](media-apps-blend-2026-10-17.md#12-cross-app-platform-features-from-filetube)):
handoff and remote ("continue here", "play on the TV") ride the existing `device_states` and `device_commands` this note
already names; the kit cast slot lists the devices this page knows, and a device's `offline_scope` (Keep on this device) is
set here, never per app.

## Kit Elements and parts (rule 9b)

`card`, `badge` (the state pill), `button`, `dialog` (pairing code, forget), `data-table` (the link page's counts), `alert`
(unreachable), the `SettingsShell` for a robot's settings, the kit `qr` block if the registry has one (else the QR is an
`<img>` of a server-rendered SVG, no component). The robot card stays the existing `RobotBody`. The `companion-presence`
block (CHAR-01) is the robot's presence on the chat screen, not a Devices part.

## Slices

1. **ROBOTLINK-01 (S, spec first):** `link-state.oplog`, `never-sync.json`, pin bump. (LINK-03 is already FACE-03's oplog
   replica id, so this note's slices use the ROBOTLINK prefix.)
2. **ROBOTLINK-02 (M):** the cr-sqlite spike, then the oplog routes both ways with the merge policy above and the three
   conflict cases tested on fixtures; the adoption
   match in the pairing wizard.
3. **DEVICES-01 (S):** the Devices page on the `device` records with the state pill, the own-rows-only last-seen and Sign
   out; the phone column.
4. **DEVICES-02 (S):** a robot's settings area as data (S4) gathering the keys that exist today.
5. **DEVICES-03 (S):** the link page with its counts and the never-sync list in words.
6. **ROBOTLINK-BENCH-01:** a 24-hour disconnected robot re-pairs with no lost record and no duplicate; measured, not argued.

## Legacy verdicts (rule 8, one line each)

- Legacy "Robots" page with per-robot logs of what was said: **dropped**; rule 6a.
- Legacy Display/HUD pod pages: **not this note**; a pod is a Go surface, designed when Go starts.
- Legacy Electron desktop (tray, hotkey, dictation): **dropped**; the PWA and Go cover it; revisit only on a measured need.
- Legacy remote engine pairing: **rebuilt** as REMOTE-STACK-PAIR-01 (done) and shares this note's code pattern.
- Legacy Atom Echo and Tab5 firmware: **dropped from Home**; a satellite is a bot body profile, never a hub feature.
- Legacy Drop (file relay between devices): **merged** into household storage sharing; a device is not a file destination.

## Supersedes

The open "Sync engine decision (design pass, L)" and "A Device record and `spec/link/`, spec-first" rows in Portability, which
this note decides in the research's own terms; and the sync half of "A spec-or-local verdict for each hub-internal table"
(turns, jobs and commands are promoted to spec shapes as that row says; this note adds that turns never cross the link).
The Reachy design v2's hub-side sections are implemented as the built rows cite them, unchanged.

## Architect verdict

See the record `DESIGN-DEVICES-2026-10-17` in `data-scratch/architect/` (rules 0, 6, 6a, 9b, S1, S2, S4; principles 2, 3).
First round REJECTED (an admin row naming a person beside a time, the turns conflict, the LINK-03 id, the cr-sqlite reuse
check); this revision applies the four edits.
