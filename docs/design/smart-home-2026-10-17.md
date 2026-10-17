# Smart home: lights, locks and sensors through Home Assistant (2026-10-17)

Design note, written in the 2026-10-17 design audit. The hub ships three stub plugins (`lights-on`, `lights-off`,
`lock-doors`), a Home Assistant websocket client (`backend/src/lib/integrations/homeAssistant.ts`, HA-EVENTS-01, built),
the deterministic safety alarm on HA sensors (SAFETY-ALARM-01, built) and a `host.integration.call` method nothing can reach
(Integrations backlog). The Integrations area has six open rows and no design. This note is that design. Rules in
[RULES.md](RULES.md) govern; nothing here asks for a rule change.

## Purpose

Home controls the house through the household's own Home Assistant and nothing else. MaiPai does not become a second smart
home hub: no device drivers, no Matter or Zigbee stack, no cloud bridges. Home Assistant (Apache-2.0, local, the most
complete device layer that exists) owns the devices; Home gives the family a voice, a chat and a few screens over the parts
of it a parent chooses to expose. Reuse check (org principle 6): Home Assistant's websocket and REST APIs do everything the
plugins need; writing a device layer would be building what did not have to be built.

Decision recorded: **one integration, Home Assistant, by its own API; Matter, HomeKit, Hue and the rest come through it.** A
household without Home Assistant sees the smart home app absent, not empty (S1: items a role cannot open are absent).

## Users and gates

| Person | May |
|---|---|
| Child | turn exposed lights and switches on and off, ask what a sensor says; never locks, never alarms, never the garage |
| Teen | lights and switches; locks only when a parent sets `smarthome.locks` for that teen (a user override) |
| Adult | everything exposed; locks and the alarm are `consequential` and confirm in chat (the `approval-card`) |
| Admin | the Home Assistant connection, the exposure list, each person's overrides |

Rule 0 holds: exposure is an allowlist, not a blocklist; a child's turn never offers a tool over an entity outside their list
(rule 1's budget: smart home tools are a conditional set, offered on the turn that earns it). The safety alarm stays
deterministic (SAFETY-ALARM-01) and no setting here reaches it. A spoken turn ("turn off the lights") takes the same path and
the same gates.

## Screens and IA

An app on the rail named by the household (default **House**), emulating the Home Assistant mobile app's Overview (S2).

1. **Rooms** (`/house`): a card per area the admin exposed, each with its lights (a switch row each), its locks (a lock row
   with the state and a confirm on tap), its sensors (a value row). Data is Home Assistant's live state over the existing
   websocket subscription, never polled.
2. **Scenes**: Home Assistant's scenes and scripts the admin exposed, one button each ("Movie night", "Goodnight").
3. **Settings, House** (an app settings area per S4, declared as data): the existing `home.base_url` and `home.access_token`
   keys (the token a write-only secret, CREDENTIALS.md), a Test button, the exposure list (areas and entities, with a kid-safe column per
   entity), the per-person overrides (teen locks), and the alarm sensors (existing SAFETY-ALARM-01 mapping, moved here).
4. **Chat and voice**: the three plugins become real: `lights-on`, `lights-off` and a new `switch-set` call `host.integration.call`
   with the entity id resolved from the exposure list by its area and name ("the kitchen light"), and `lock-doors` asks first.
   The answer block is the existing `status_list` style block; no new block kind.
5. **Phone**: Rooms is a single column of cards; the drawer per S1.

## Data and spec records (spec first)

- **Integration record (new, spec first):** `integration.schema.json` with `id` (`home_assistant`) and `exposed: [{entity_id, area, name, kind: light|switch|lock|sensor|scene,
  min_role, consequential}]`, `health`, `provenance`, `hlc`. The address and token stay where they already are, the household
  keys `home.base_url` and `home.access_token` (`backend/src/settings/homeAssistantKeys.ts`); the record carries neither
  (principles 1 and 4: one definition, one place). One record per household; the robot (bot) pins the same shape
  so a paired robot can drive a light the hub exposed (principle 2: on its own the robot keeps its own record).
- **Settings keys (spec `keys.json`, spec first):** `smarthome.app_name` (household), `smarthome.locks` (user override,
  default off for a teen, absent for a child), `smarthome.alarm_sensors` (moves the existing mapping to a declared key).
- **Permissions vocab:** `integration:<id>` exists (`spec/vocab/permissions.json`); the plugins declare
  `integration:home_assistant` and the manifest lint refuses a smart home plugin without it.
- **Provenance and logs:** a device action logs a typed event (`smarthome.action`, rule 6a: the entity kind and the result,
  never the person next to it). Home Assistant's own logbook keeps the rest.

## Offline and privacy

Home Assistant is on the LAN; the link is the household's own address and token. The privacy page already carries the row
`platform:home-assistant-events` (`backend/src/lib/privacy.ts`); this note rewords it to cover commands as well as events ("Your
Home Assistant, on your network, when you ask or when a sensor changes; it receives the command and nothing about who asked"),
one row, not a second. Nothing leaves the house. When Home Assistant is down the app shows the kit's `error-state` with Home Assistant's
own health (STATUS-SVC rows), chat says in its own words that it could not reach the house (rule 6), and the alarm's
unreachable state is its own `immediate` notification as SAFETY-ALARM-01 already defines. No command is queued for later: a
light command that cannot run now is dropped and said so; a lock command is never replayed.

## Kit Elements and parts (rule 9b)

`card`, `switch`, `button`, `badge`, `alert`, `sheet` and the `SettingsShell` for the settings area; in chat the
`approval-card` Element for a lock (ED-006 is being removed in favour of the shipped Element, so this waits on
APPROVE-CARD-02) and the existing answer blocks. No new kit part. The Rooms page is a grid of kit cards with switch rows;
nothing is drawn by hand.

## Slices

1. **HOUSE-01 (S, spec first):** the `integration` record and the three keys in `commons`; pin bump.
2. **HOUSE-02 (M):** Settings, House: address, token, Test (reuses the SEARXNG-SET Test pattern), the exposure list from
   Home Assistant's `config/entity_registry/list` and `config/area_registry/list`, the alarm mapping moved in.
3. **HOUSE-03 (S):** the Rooms page on the live websocket state; switch, lock with confirm, sensor rows; the phone column.
4. **HOUSE-04 (S):** the plugins reach `host.integration.call` through the exposure list; `lock-doors` is consequential;
   the conditional tool set with its bench row (rule 1).
5. **HOUSE-05 (S):** verify against a real Home Assistant (the open "blocked on hardware" row); the privacy row and the user
   page `docs/user/house.md`.

## Legacy verdicts (rule 8, one line each)

- Legacy direct Hue and Kasa drivers: **dropped**; Home Assistant owns devices.
- Legacy "Cameras (Frigate)" page: **dropped here**; a camera is a Home Assistant entity and a later live-view design, never a
  Home page of its own (LIVE-VIEW-01 covers the robot's camera).
- Legacy ESPHome flashing: **dropped**; Home Assistant's own add-on does it.
- Legacy "DNS filter" and "Speed test": **not smart home**; verdicts belong to the status and privacy designs.
- Legacy per-user device permissions: **rebuilt** as the exposure list's `min_role` plus one user override, no per-device
  grants table.

## Supersedes

One built behaviour: `lock-doors` ships with `min_role: teen`, so a teen may lock today; under this note a teen's locks are
off until a parent sets `smarthome.locks` for that teen (stricter, never looser; rule 0). Otherwise nothing built. It gives
the Integrations area its design and replaces the open row "Verify Home Assistant against a real
instance" with HOUSE-05, and "A recipe step that can actually reach `host.integration.call`" with HOUSE-04. The Calendar,
Email and Find-people rows stay open; they are their own consent designs, not smart home.

## Architect verdict

See the record `DESIGN-HOUSE-2026-10-17` in `data-scratch/architect/` (rules 0, 1, 6, 6a, 9b, 11, S1, S2, S4, S5).
First round REJECTED (a second copy of the address and token, a second privacy row, the teen lock change unnamed); this
revision fixes all three.
