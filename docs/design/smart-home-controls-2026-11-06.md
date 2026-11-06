# Smart home controls: animated cards, room and item permissions, server control, schedules (2026-11-06, revision 3)

Extends [smart-home-2026-10-17](smart-home-2026-10-17.md) (HOUSE-01 to 05) and
[agentic-build-plan-2026-11-06](../plans/agentic-build-plan-2026-11-06.md) (architect APPROVED, AGENTIC-BUILD-PLAN-01).
Revision 3 answers the architect's second rejection (teen locks named, privacy row rewritten, one sensitive list, the settings `matrix` card for the grid, S6 wording). Revision 2 answered the first: it reuses the existing Grant record and SCHED-02's
`ScheduledTask` instead of adding two records, keeps Home Assistant free of names, closes the scene loophole, and folds
the slices into existing ids.

Owner direction (2026-11-06): beautiful animated cards like the weather card for on and off and other states; control
everything Home Assistant exposes (scenes, switches, lights) and the Home Assistant server itself (restart); permissions by
room and by specific item; smart scheduling where "turn on the porch lights every day at 4pm" becomes a Home Assistant
automation and "remind me every day at 4pm" stays a hub reminder, both entering through one route and one shape.
Owner answers: server control is the Home Assistant host only and owner only; permissions are a rooms-and-items grid.

## 1. Cards

Reuse check (principle 6): Mushroom (Apache-2.0), Bubble Card (MIT), button-card (MIT), weather-card and clock-weather-card
(MIT) are Lit or custom-element cards for Home Assistant's own frontend and cannot run in our React kit, so they are design
references only; no code is copied. Home Assistant's tile features and thermostat dial are the behaviour baseline. The Elements are built from kit primitives (Switch, Slider, Sheet, Button, and the weather card's motion approach); the shadcn and Kibo check is recorded in a new `docs/design/UI-DECISIONS.md` row for HOUSE-08 before any code (rule 9b).

| Card | Motion and control |
|---|---|
| Light tile | State-tinted icon, a glow layer that fades in and out (opacity only), brightness arc or slider with throttled sends and commit on release, colour and temperature in a sheet. |
| Switch and outlet | Icon and track animate on and off; pending ring until the device confirms. |
| Fan | Icon spins, speed follows the percentage. |
| Cover and blind | Fill follows position; open, stop, close. |
| Lock, garage, alarm | Hold-to-confirm ring (about 700 ms), morph on success, an accessible confirm button as the alternative. |
| Scene tile | Ripple from the touch point, a short check; no persistent on or off. |
| Climate | Dial with the setpoint thumb and a heat or cool glow. |
| Room header | Master toggle, "3 of 5 on" counter, then the room's tiles. |

Rules for all cards: transform and opacity only, no animated blur or shadow; every motion has a `prefers-reduced-motion`
fallback that keeps the state readable; at most about ten concurrent animations; pause off-screen; no per-tile Lottie.
Optimistic update with a pending ring, confirmed by the state event, rolled back after 3 to 5 seconds through the Element's own
notice or error prop with copy from `lib/failureCopy.ts` that names the next step ("The kitchen light did not answer. Check
that it has power, then try again."); `unavailable` is dimmed with controls off and the last known state labelled.

Colour: every colour comes from theme tokens, with one allowed data exception. A light's own RGB reaches the kit Element as a
prop from the device state (never a literal), is shown only as a swatch with no text, and the glow and tint around it come
from tokens. The kit colour lint gets a commented allowlist entry for that prop, the same treatment as a cover-art tint.

Kit-first (rule 9): the parts do not exist, so each goes spec answer block, then a `commons` Element and tag (the glow layer
lives inside the Element), then a `TOOL_BINDINGS` entry in Home that only maps props. No `className` that changes an
Element's look; no wrapper. This note supersedes the smart-home record's "no new kit part" and "no new block kind" for
exactly these device cards.

## 2. Permissions: the existing Grant record, parameterized

No new access record. The Grant record (`grant.schema.json`, the `grants` table, the closed vocabulary `grant-actions.json`)
already carries per-person allow and deny, per-band approver cells that only get stricter from adult to teen to child
(`never` is a value), `by_parameter`, `limits` and `model_callable`. This note adds parameterized actions to that vocabulary:

- `house.see:<target>`, `house.control:<target>`, `house.confirm:<target>`, where the target is `area:<id>` or `entity:<id>`.
- **One sensitive-class list:** lock, alarm, garage, camera, entry-door cover and server targets. The gate passes the device
  class as the explicit parameter (`by_parameter` keys on the exact parameter, not on the `entity:<id>` text), the new ids join
  the classification sets in `backend/src/lib/grants.ts`, and sections 2, 3 and 4 all point at this one list.
- Policy cells: for a child, `house.see`, `house.control` and `house.confirm` on every sensitive class are `never`. For a teen,
  cameras and server are `never` for see, control and confirm; locks, alarms, garage and entry-door covers get no default grant,
  and are allowed only by a parent's explicit allow on that target (this replaces the `smarthome.locks` key, which is withdrawn
  and dropped from HOUSE-01; the approved smart-home record's stricter teen-lock rule stands, so the shipped
  `lock-doors` `min_role: teen` is superseded exactly as that record already says). `house.confirm` is `self` for an adult,
  including when an adult runs a scene or script that sets a sensitive item.
- Who edits grants is the existing `people.grant` action. Resolution is the existing matcher: an explicit deny beats an allow
  at any specificity (revision 1's "entity beats room" is withdrawn). A more specific allow is how a parent adds an item outside
  the rooms already allowed; a deny is how a parent removes one.
- The exposure list stays the ceiling: nothing outside it is ever offered. Its `min_role` and kid-safe column are an input to the
  resolver's ceiling, not a second grant; the grid writes grants, and a grant can never exceed that ceiling.
- The grid is the existing settings-area `matrix` card (`commons` `spec/schemas/settings-area.schema.json`), extended additively:
  rows come from the exposure list, one column per person, and each cell writes Grant rows (S4, principle 6); no new grid.
- Defaults the Settings, House grid writes when a person is added: adult control on every exposed target (confirm on locks,
  garage, alarm); teen control on lights, switches and scenes in the rooms a parent picks; child control on lights, switches
  and scenes in the rooms a parent picks. "Their own room" is a parent's pick in the grid; with none set, a child or teen gets
  nothing. An unknown speaker gets nothing (rule 0).
- The turn engine builds the tool's entity list from the speaker's grants (rule 1), so the model never sees an entity the
  person cannot control, and the tool checks again at call time.

Scenes and scripts (rule 0): a Home Assistant scene can set locks, the alarm or covers, and a script can call any service.
So a scene is offered, scheduled or run for a person only when every entity it sets is within that person's grants and
ceilings (resolved from the scene's entity list at offer time and rechecked at run time). Scripts are never offered to a child
or a teen.

Supersedes: the smart-home record's "no per-device grants table" is replaced by parameterized Grant actions (owner,
2026-11-06). The exposure list's `min_role` and kid-safe column remain, as the ceiling.

## 3. Server control (Home Assistant host, owner only)

Placement: Settings, House, as an owner-only action in the kit settings shell declared as data (S4), not on the Rooms page.
Actions: restart Home Assistant core, restart a named add-on, reboot the Home Assistant host. Effect class: the design's
`account` class ("never by the model; the person does it"), grant action `house.server` with `model_callable: false`, owner
only. A hold-to-confirm, a receipt, a one-minute cooldown, and no Undo (the card says so before the hold).

Status (S6): the only existing Repairs item is `home-assistant-events`/`connection` (`integrations/homeAssistant.ts`). While an
owner-started restart runs it is held; if Home Assistant does not return it is raised as usual. The Status page has no Home
Assistant row today, so HOUSE-03 adds one as a new row fed into `lib/statusApps.ts` and `lib/statusBoard.ts` (no new panel), and
the tiles' `unavailable` state shows the rest. The existing Repairs item may offer "Restart Home Assistant" as its Try
again action. The Restart action in Repairs shows to the owner only. The Mac Studio hub and other homelab machines are out of scope by the owner's choice.

## 4. Schedules: SCHED-02's ScheduledTask, two executors

No new schedule record. SCHED-02's `ScheduledTask` spec record gains, additively and spec first: kinds `device_action` and
`scene`, and an `executor` field (`hub` or `home_assistant`). Alarms stay in the `alarms` record (CLOCK-03); reminders,
timers and `turn` stay on `scheduled_jobs`. Recurrence is `nextOccurrence` in `backend/src/lib/scheduler.ts` and ROUTINES-01's
forms; no second grammar.

The model fills the same arguments whatever the person said ("remind me at 4" and "porch light on at 4" differ only in
`kind` and `what`). `remind` and `timer` stay the front door for their kinds; a `schedule` action on the Home Assistant
tool is the front door for device kinds. HOUSE-04's bench row covers this tool including the remind-versus-device choice;
connector turns stay at 12 tools or fewer.

| Kind | Executor | Why |
|---|---|---|
| `remind`, `timer`, `turn` | hub | Person-facing, needs the hub's notification path. |
| `device_action`, `scene` | `home_assistant` when the recurrence is once, daily or weekly (the forms an automation expresses exactly); otherwise `hub` | A Home Assistant automation fires even if the hub is down. |

Home is the source of truth. It creates, updates and deletes automations through Home Assistant's automation config API
with the id `maipai_<opaque id>` and a generic description ("Made by MaiPai Home; edit it in Home"): no schedule title, no
person, no entity names in the alias or description, so Home Assistant learns the command and nothing about who asked
(privacy row `platform:home-assistant-events`). It never touches an automation without that prefix. On every connect it
reconciles; drift (missing, edited outside) raises a Repairs issue (`lib/issues.ts` `raiseIssue`) that carries a count only: no schedule title, entity or
person (rule 6a); the schedule row shows its own state. If the automation API is unavailable, the hub executor runs the action and the row says so.

Safety: a scheduled device action may only target what the creator could `house.control` at creation, stored with the task. Revoking
that grant pauses the task and disables or deletes its automation. Every item on the sensitive list in section 2, and scripts, cannot
be scheduled (an automation runs without Home's brakes); the person is offered a reminder instead.

List: device schedules join REMINDERS-02's Scheduled list (added by the SCHED-02 slice); the House page shows a filtered view of the same rows. A person
sees only their own rows (rule 6a); admins see counts, not names.

## 5. Audit and privacy

`toolAudit` rows hold the entity kind and the result only: no entity names, no arguments, no person beside an entity (rule 6a).
The privacy row `platform:home-assistant-events` in `backend/src/lib/privacy.ts` is rewritten in the same commit as the first slice that
sends a command to Home Assistant (HOUSE-02 or HOUSE-03, whichever lands first): it states what is sent (device commands and scene runs), what Home Assistant keeps and until when (automations
Home created, under opaque ids, until the schedule is deleted), and owner-started add-on and host restarts. It still says Home Assistant
learns the command and nothing about who asked.

## 6. Slices (folded into existing ids)

| Id | Change |
|---|---|
| HOUSE-01 (spec first) | Adds `house.*` parameterized Grant actions and the policy cells; SCHED-02's additive kinds and `executor` field. The `smarthome.locks` key is dropped from this row. One `commons` tag. |
| HOUSE-02 | Settings, House gains the rooms-by-people grid, the parent's room pick and the owner-only server action. |
| HOUSE-03 | The Rooms page uses the new Elements, optimistic update and rollback; adds the Status page Home Assistant row (fed into `lib/statusApps.ts` and `lib/statusBoard.ts`). |
| HOUSE-04 | Tools build the entity list from grants; scene check; the `schedule` action; the bench row. |
| HOUSE-05 with AGENT-LIVE-01 | Live proof on the owner's instance: one light on and off with the animation, one scene, one scheduled porch-light automation created, seen in Home Assistant, fired once, deleted; screenshots opened and judged. |
| HOUSE-08 (new, `commons`, split per card) | The kit Elements of section 1 with showcase tests and tags. |
| SCHED-02 | Carries the additive record fields and the `home_assistant` executor with reconcile. |

## 7. Supersedes

| Replaced | By |
|---|---|
| Smart-home record "no per-device grants table" | Parameterized Grant actions (section 2). |
| Smart-home record "no new kit part" and "no new block kind" | The device Elements of section 1, commons first. |
| Agentic plan "any connector tool for a child or teen" excluded | Lights, switches and scenes by grant, in a parent-picked room, never locks, alarms, garage, cameras, scripts or server control. Stricter than the smart-home table already allowed. |
| Agentic plan "revision 1's grants, device cards and Frigate page withdrawn" | Revision 1's grant table and schedule record stay withdrawn; the device cards return as in section 1. Frigate stays out. |
| Design 2026-10-29 "no agent surface for minors" | Narrowed as above, a child-gate change that stays stricter than rule 0's child band. |
| Smart-home record `smarthome.locks` user override | Withdrawn: a parent's explicit allow of `house.control` on a lock for that teen carries the same decision in one place. Teen locks stay off by default, as the record already says. |
| Unknown speaker getting the child band's exposed lights (smart-home record) | An unknown speaker gets nothing (stricter, rule 0). |
| Smart-home exposure list `min_role` and kid-safe column as the permission | Kept as the ceiling input only; Grant rows carry the permission. |

## 8. Conditions carried into the build (architect C3 to C5)

- The `matrix` card extension (rows from the exposure list, one column per person, cells that write Grant rows) is both a spec change
  and a kit `SettingsShell` renderer change; it lands in `commons` before HOUSE-02, inside HOUSE-01's tag or as a HOUSE-08 sub-slice.
- `grants.ts` classification: `house.server` joins `OWNER_ONLY_GRANT_ACTIONS`; the `house.see`, `house.control` and `house.confirm`
  targets join `ADMIN_HELD_GRANT_ACTIONS`, so `grantActionClassificationIsComplete()` stays true.
- Teen approver cells for lock, alarm, garage and entry-cover are never looser than the adult's `self` confirm; a parent's allow is a
  grant, and the band cell still keeps the order adult to teen to child.

## 9. Open and unverified

- Whether the owner's Home Assistant allows automation creation through the config API with the stored token (HOUSE-05 tests it).
- The exact reboot service for the host (`hassio.host_reboot` versus the supervisor API) on the owner's install.
- Whether ROUTINES-01's cron form lands before the first schedule slice; until then only once, daily and weekly are offered.
