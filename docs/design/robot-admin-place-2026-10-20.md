# Robot administration lives in Home settings (2026-10-20)

Design note for ROBOT-ADMIN-PLACE-01. Owner ruling (Jesse, 2026-10-20): "a main subpage should be for user content". Rules in
[RULES.md](RULES.md) govern; nothing here asks for a rule change. Layout from `design-resolver`; verdict from `architect`:
APPROVED with conditions, all met below except the one named under "Deferred".

## Supersedes

- [devices-and-robot-link-2026-10-17.md](devices-and-robot-link-2026-10-17.md) "Screens and IA" items 1 and 3: there is no
  `/devices` page. A robot's live card is on the Family page; a robot's settings and Forget are in Home settings, Devices.
  Item 4 (`/devices/:id/link`) is not built; when DEVICES-03 builds it, it opens from the robot's detail view.
- [robots-switch-and-install-2026-10-20.md](robots-switch-and-install-2026-10-20.md) section 2, "the robot card's existing Forget
  confirm": Forget is in the robot's detail view and keeps its memory-and-backup sentence.
- The robot Settings dialog in `RobotBody.tsx` (a dialog that grew taller than the screen), and the Family page's name-only Bots tab.

## What exists after this change

| Who | Where | What |
|---|---|---|
| Admin | Settings, Home, Devices | A row per household robot. Opening a row (`?device=<id>`) shows one detail view: status and IP, name and area, the robot's settings cards, and in its header the one lifecycle button, **Forget this robot** (or **Cancel install** while a hosted install has never connected). Add a StackChan, Add a robot and the robot password section stay below the list. |
| Everyone signed in | Family, Bots tab | A robot is a household member like a pet (owner's ruling 2026-10-20): everyone sees every robot and "Belongs to <name>". The live card: state, battery, versions, mute, live view (hub policy), motor-restart answer. Admins also get Test this robot and the IP row, which the hub limits to admins. No management control for anyone. A child sees the card and its owner with no controls. Anyone but a child or guest may mute any robot; unmuting stays with its owner and admins. |
| Everyone | Settings, Account, Profile and sign-in | Their own phones and browsers (Remove, offline copies switch), Copies in this browser, Signed-in sessions. The settings IA already files "signed-in devices" under Profile and sign-in. |

`/devices` and `/settings/devices` redirect to Account, Profile and sign-in for every role, so old links, bookmarks and the setup
checklist keep working.

## Decisions

1. **Detail view, not a dialog.** The kit `DetailPane` (header with Back and an actions slot, body scrolls itself) draws it; rows are
   the kit `Item` as a link, as Settings areas already do. The destructive action sits in the header, so at 1280 by 720 it is visible without
   scrolling. No kit Element carries a shape `className` (rule 9).
2. **One confirmation.** Pressing the lifecycle button swaps it for the kit `DestructiveConfirm` at the top of the body. One state, one confirm, no dialog.
3. **Settings values still go through `SettingsRenderer`** with the spec's `device_cards`. No new status UI: the status badge reuses
   the card's existing words; install progress and failures stay in `installStatus` and Repairs.
4. **Any admin may forget a robot.** `DELETE /api/devices/{id}` refused every admin but the one who paired the robot (Quick Connect
   mints the device under the approving admin). A robot is the household's, so an owner or admin may forget it; a phone is
   still only its owner's. Rename and Cancel install were already admin-only on the hub.
5. **The robot list is the existing `GET /api/devices/robots`,** now open to anyone signed in and carrying `ownerName` and `ownerId`; the IP address stays admin-only. Phones and browsers are personal and never appear in household lists.
   The robot password section stays its own section for now (see Deferred).

## Deferred

- Spec: the Data and privacy card's "Signed-in devices" link still points at `/devices` (now a redirect), and the account section is
  the existing `account.profile` view, not a new `account.devices` section. Repointing the link needs a commons release and pin
  bump; not done here because releases are the owner's call.
- Order on the page: the household Robot settings card draws above the robot list because the spec draws a section's keys before its
  trail view. Opening a robot scrolls its detail to the top. A spec `lead_view` for this section would put the list first; commons release.
- Folding the robot password row into the detail view (one place per robot).
