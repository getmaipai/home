# Media handoff: Continue here and Play on another screen (2026-10-17)

Status: design for HANDOFF-01, the handoff row of the [media apps note](media-apps-blend-2026-10-17.md) (section 10, the
"Handoff" bullet, and the section 12 "Handoff and remote" row). A Codex attempt stopped on three gaps, each decided here: the
spec has no media presence field and no play command, the command channel admits robots only (no browser can listen), and the
kit `play` action has no start position. Rules in [RULES.md](RULES.md) govern (0, 6a, 9, 9b, S1 to S6). No rule changes.

## 1. What exists today (from code)

| Part | Where | Today |
|---|---|---|
| Device record | spec `device.schema.json`; `devices` table | kinds robot, pod, tv, phone, desktop, browser; one `person_id` per row; a row is made when a device token is minted (Quick Connect) |
| Device state | spec `robot-state.schema.json`; `device_states` (one row per device) | a robot's state frame (`activity`, `muted`, `tracking` NOT NULL); written by `PUT /api/devices/me/state`; `lib/deviceStates.ts` |
| Command channel | spec `device-command.schema.json`; `device_commands`; `lib/deviceCommands.ts` | one WebSocket per device at `GET /api/devices/me/events`, admitted by `requireDeviceSession("robot")`; typed commands kept 24 h, replayed until acked, heartbeat 15 s |
| Browser sessions | `sessions.device_id` | null for a plain sign-in; set only when a device token is redeemed; `resolveHumanSession` refuses a device session |
| Realtime in the shell | `NotificationBell.tsx` | none held open: the bell polls every 15 s; the only socket is speech-to-text |
| Progress | `media_progress`, `writeProgress` | every 10 s from the dock, carries `device_id`, one row per person and item |
| Kit | `@maipai/ui` `Player`, `schema/actions.ts`, `schema/mediaHost.ts` | `Player.castSlot` exists (copy "Play on another screen") but the `player` node never fills it; `play` action is `{media_id}` only; `resumeFrom` reads the row's `position_s` |

## 2. Decision 1: the media presence shape

**Spec first.** New value shape `spec/schemas/media-presence.schema.json` (no id, no hlc: a hub-local projection like
`presence-state`, never synced, listed in the never-sync set when ROBOTLINK-01 lands it):
`{media_id (pattern ^media-), position_s (number, at least 0), playing (boolean), updated_at (date-time, the hub's clock)}`.
Nothing else: no title, no device name, no person id. A reader locator (books) is not carried; handoff covers timed media.
`robot-state` gains one optional property `media`: that shape or null (additive; a robot that never sends it is unchanged).

**Hub store.** The same `device_states` row, not a new table. Migration: one nullable `media` JSON column, and `activity`,
`muted`, `tracking` become nullable so a screen (a non-robot device) can own a row with only `media` set. SQLite needs a table
rebuild for that; robot rows are copied as they are and robot code keeps treating a missing robot field as "no state yet".
`lib/deviceStates.ts` gets the one writer `setMediaPresence(deviceId, presence | null)` and the one reader
`freshMediaPresence(personId, now)`.

**Cadence.** While playing, the client sends `PUT /api/devices/me/media` every 4 s, plus at once on pause, seek, end
(`playing: false`) and Close or sign-out (`null`). The hub stamps `updated_at`; the body's clock is ignored. One row per device
is overwritten in place, so a 4 s cadence is one small upsert, never a history. It is separate from the 10 s progress write
because progress has no `playing` flag and is coalesced (up to 12 s stale), and a handoff that lands 10 s behind feels broken.

**Retention.** Presence older than 10 minutes reads as absent and is nulled for every device by one statement run at boot and on each presence write and read (no new timer). It is
cleared on Close, on sign-out from that tab, when the device row is deleted (cascade) and when the person leaves
(`erasePersonData`). The backup snapshot nulls the `media` column, the same place that empties `device_tokens`.

**Never in logs (rule 6a).** No log line, trace, status or admin view carries a media id, a position, or a device or person id
next to playback. `stateForViewer`, `GET /api/devices/robots` and the Devices page never return `media`; an admin's view of a
device stays name, kind and link health. Only the device's own person reads its presence, and only through the Continue here
card. A failed presence write is dropped silently by the client (no retry storm, no error surface).

## 3. Decision 2: the `play_media` command and how screens join the channel

**Spec first.** `device-command` gains one `oneOf` branch, kind `play_media`, payload `{media_id (pattern ^media-), position_s
(number, at least 0)}`. Its `expires_at` is `issued_at` plus 60 s (other kinds keep 24 h); the schema's description changes from
"hub-to-robot" to "hub-to-device". Additive: no existing kind changes.

**Screens.** A plain browser session has no device row, and binding its session to one would make it a device session that
`resolveHumanSession` refuses (the offline-scope grant route among them). So a browser joins as a *screen*: a `devices` row of
kind `browser` (the person may change it to `tv`, `desktop` or `phone` in Settings, Devices) with no token and no session binding.

- `POST /api/devices/me/screen {device_id?}` (signed in, not a guest): when `device_id` names a row of this person's with no token,
  it is reused; otherwise a new row is made, named from the session's user agent ("Chrome on macOS"). The shell keeps the id in
  `localStorage` under `maipai-screen:<personId>`, so a second person signing in on the same TV gets their own row, never the
  first person's. The id is not a credential: every call also needs that person's own session, and a row owned by anyone else is
  refused. The shell registers on the first playback, so a browser that never plays media never appears in Devices.
- A screen proves itself with its session plus `?screen=<device_id>` on the socket and `X-MaiPai-Screen` on `PUT /me/media`.
- **Go** pairs by Quick Connect as today and uses its own device session; it is a screen of kind `phone`, `tv` or `pod`.
- **Robots** are unchanged and are never a `play_media` target in this note.

**Transport.** The existing WebSocket `GET /api/devices/me/events`. Its admission widens additively: a robot device session
(unchanged), a Go device session of kind phone, tv or pod, or a human session naming one of its own screens. Only `time` and
`play_media` are ever issued to a non-robot; the settings, asset and offer publishers already filter to robots, and the robot
frames (alarm, offer answer) are refused from a non-robot. The shell opens the socket in one tab per browser, chosen with the
Web Locks API (`navigator.locks.request("maipai-device-channel")`), because a second connection for one device replaces the
first. There is no realtime path the shell already holds open to reuse; the bell's 15 s poll was weighed and rejected for a
command a person is waiting on. No SSE endpoint or second socket is added.

**Delivery.** `issueDeviceCommand` as today. A `play_media` past its 60 s expiry is never sent (a TV switched on an hour later
must not start a film), and its row is deleted on ack or expiry rather than kept 24 h, so the table never holds a playback
history. The receiving shell calls its media host's `onPlay(media_id, {}, {position_s})`, the same path a tap takes, then acks.
When the browser refuses autoplay without a gesture, the Player opens paused at the position with its play button ready.

**Network.** LAN only, to the hub; off the LAN only through the owner's own Tailscale where that switch already allows it.
Nothing leaves the home.

## 4. Decision 3: who may send to which screen, and who sees what

One function, `mayCastTo(sender, target)` in `backend/src/lib/handoff.ts`, decides; the target list and the send route both
call it.

| Sender | May send to | Why |
|---|---|---|
| Anyone (adult, teen, child) | their own screens only | same person, same rules |
| Owner or admin | not a child's, teen's or another adult's screen | NO-CROSS-USER-VISIBILITY-01: a list of a child's screens that are on now, and a refusal saying her screen time is done, would each show a parent what the child is doing |
| Child or teen | never another person's screen | rule 0: a minor never acts on someone else's device |
| Guest | nothing; no screen, no presence, no card | a guest reads as a child and has no devices |

A parent who wants a cartoon on Pippa's tablet signs in there as Pippa, or Pippa picks it; a guardian push is a later owner
decision, not built here.

- **The screen's own person decides what plays.** Before issuing, the hub checks the item against the target's person (always
  the sender today, so the check is the same person's): `readableItem` (band, `visible_to`, allowlist mode, trash) and
  `mediaTimeUpRefusal` (the daily budget). A refusal is the call's own response (S6, the action-failed surface, no new toast):
  "That screen can't play this right now. It may not be allowed there, or screen time is done for today." On arrival the screen
  opens the item through its own routes, so the content route's `media_time_up` 403, the allowlist and the player's budget
  pause hold on the receiving device anyway.
- **Presence never crosses people.** `freshMediaPresence` reads only devices whose `person_id` is the viewer's. A child's
  presence never reaches an adult's profile and an adult's never reaches a child's, on any screen.
- **Shared TV (SAFETY.md shared screen).** A TV signed in as one person is that person's screen; each person who signs in on it
  gets their own row (above), so Marlow's presence on the living room TV never appears when Pippa signs in there, and Pippa's
  never appears for Marlow. The card also re-checks `readableItem` for the viewer at read time.

## 5. Decision 4: the Continue here card and Play on another screen

**Continue here.** Each media app's host gets one data id, `continue_here` (`backend/src/lib/media/appHost.ts`): at most one row,
the viewer's newest presence from another of their devices (not the calling screen), updated within 10 minutes, playing or
paused, whose item is one of that app's kinds and readable now. The row is the host's usual row plus `position_s` and
`copy_label` "On Living room TV". The app index draws it with the existing kit `media_shelf` node (`hide_when_empty`, title
"Continue here", one row), whose `on_select` is `play` with `position_s: "{position_s}"`. One per app index, placed first.
It works on a plain browser too (no screen row needed to read it). The other screen keeps playing; a remote pause is not in
this note.

**Play on another screen.** The kit fills the Player's existing `castSlot` (section 6), so the household's screens are the cast
slot's first target, drawn by the kit. Chromecast and AirPlay stay the Player's own buttons, shown when the browser offers them,
with nothing of ours in their path. `GET /api/devices/screens` returns `{id, name, kind}` for the caller's own screens that
`mayCastTo` allows and whose channel is connected now, never the calling screen, with no activity. Choosing one calls
`POST /api/devices/{id}/play {media_id, position_s}` with the Player's current time; the sending screen keeps playing.

## 6. Decision 5: the kit `play` action gains a start position (spec, then kit)

- **spec** `ui/schema.json`: `action.play` gains optional `position_s` (a number, or a string with `{field}` placeholders).
- **kit** `schema/actions.ts` fills it and passes it: `MediaHost.onPlay(mediaId, item, options?: {position_s?: number})`.
- **kit** `MediaHost` gains two optional members: `castTargets?(item): Promise<{id, name, kind}[]>` and
  `castTo?(targetId, item, position_s): Promise<void>`. The `player` node fills `castSlot` with the kit's own DropdownMenu
  ("Play on another screen", one item per target, "No other screens are on" disabled when empty). Absent members draw nothing,
  so every other host is unchanged. Home renders no cast UI and writes no className or wrapper (rules 9 and 9b).
- **Home** `mediaHost.tsx`: `onPlay` puts `position_s` in the play page's state; the `item` data route answers that `position_s`
  in place of the stored one, so the Player's existing `resumeFrom` and resume line do the seek.

## 7. Reuse check

| Need | Considered | Verdict |
|---|---|---|
| Presence store | `media_progress.device_id`; a new `media_presence` table; `device_states` | `device_states`: it is the per-device state projection already; progress lacks `playing` and is coalesced; a new table is a second store |
| Command transport | the bell's 15 s poll; a new SSE stream; Web Push; the device WebSocket | the WebSocket: it is the one command channel, durable, acked, heartbeated; a poll is too slow, SSE would be a second channel, Push leaves the LAN path |
| Browser identity | Quick Connect token in the browser; binding the session's `device_id`; a token-less screen row | screen row: a stored bearer token in browser storage is a credential at rest (CREDENTIALS.md), and binding the session breaks `resolveHumanSession` |
| Cast menu | Google Cast SDK, Remote Playback API, a Home menu | the kit's DropdownMenu in the existing `castSlot`; Cast and AirPlay already ship as the Player's Media Chrome buttons |
| Continue card | a new card primitive; FileTube's card | the existing `media_shelf` node with one row |
| Tab election | BroadcastChannel leader code | Web Locks, built into every browser Home supports |

No Elements ledger row: nothing is hand-built in Home.

## 8. Slices (dependency order; rows in `docs/BACKLOG.md`)

| # | Slice | Repo | What lands | Acceptance and tests | Exit |
|---|---|---|---|---|---|
| a | HANDOFF-01a spec | commons `spec` | `media-presence` shape, `robot-state.media`, `play_media` kind with 60 s expiry, the device description line, `action.play.position_s`, fixtures, Python regen, tag | ajv: every fixture valid, a `play_media` with a title or an extra field invalid, `position_s` below 0 invalid; round-trip tests | commons gate, tag cut |
| b | HANDOFF-01b Home backend | home | pin bump; migration (rebuild, `media` column); `setMediaPresence`, `freshMediaPresence`; `POST /me/screen`, `PUT /me/media`, `GET /devices/screens`, `POST /devices/{id}/play`; socket admission; 60 s drop and delete on ack; `mayCastTo`; `continue_here`; snapshot nulls `media` | `tests/handoff.test.ts`: the section 4 table row by row (an admin's send to a child's screen is 403); a robot frame still round-trips; presence at 10 min 1 s is absent; no admin route returns `media`; another person's screen id is refused; a child's budget or band refusal; an expired `play_media` is not sent; a log capture holds no media or device id | full `check.sh` (migration and auth surface), `code-review` medium |
| c | HANDOFF-01c kit | commons `ui` | `onPlay` options, `castTargets`, `castTo`, the `player` node's cast menu, `play` passes `position_s` | kit tests: the menu lists targets, calls `castTo` with the current time, draws nothing without a host member; a `play` with `"{position_s}"` reaches `onPlay` as a number; rule 9 lints clean | commons gate, tag cut |
| d | HANDOFF-01d Home frontend | home, catalog (Videos page) | pin bump; screen registration; one-tab socket; `play_media` handler and ack; 4 s presence from the dock and Watch page; `castTargets` and `castTo` in `mediaHost.tsx`; the Videos index `continue_here` shelf | a phone-width browser plays, a desktop browser shows Continue here and resumes within 4 s of the phone's place; Play on another screen starts the desktop at the same position; Pippa's profile on the TV never shows Marlow's card; captures at 1440 and 390 opened and judged | `check.sh --pre`, the tests beside the files, `bun run lint:ui-rules` |

Order: a, then b and c in parallel, then d. Go and the other media apps adopt the same data id and channel in their own slices.

## 9. Privacy rows (added to the privacy page with slice b)

| Surface | Outbound | What is kept | Setting |
|---|---|---|---|
| Continue here presence | none; the device talks to the hub only | one row per device: item id, position, playing, time; gone after 10 minutes, on Close, sign-out or removal; not in backups | none; a screen is removed in Settings, Devices |
| Play on another screen | none; LAN, or the owner's Tailscale where already on | a command for at most 60 s, deleted on delivery | who may send is fixed (section 4) |

No MaiPai-operated service is in any path; nothing about playback leaves the home.

## Supersedes

- [media-apps-blend-2026-10-17.md](media-apps-blend-2026-10-17.md) section 10, the "Handoff" bullet's shapes: `{media_id,
  position}` becomes the `media-presence` shape of section 2, and `device_command` `play {media_id, position}` becomes the
  `play_media {media_id, position_s}` kind of section 3. Its target, "a chosen device of the household", narrows to the
  sender's own screens (section 4, NO-CROSS-USER-VISIBILITY-01). The rest of the behaviour it describes is unchanged.
- The HANDOFF-01 backlog row's same two shapes, replaced by slices a to d.
- The spec `device-command` scope "hub-to-robot" (now hub-to-device, additively) and the `device` description's "a row is made
  when a token is minted" (a signed-in browser's screen row is the second way).
- Nothing in RULES.md.
