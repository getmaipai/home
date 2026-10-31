# Bots in the ambient companion spot (design, 2026-10-31)

Owner: Jesse, 2026-10-31: "In the upper right we have a fixed companion you can chat with, and you can change it to your other
companions. I'd like it to also include your bots, if you have any. You can talk to it the same way (it does not have to talk to
the physical robot for this). It should show a representation of the bot's physical face, use the bot's voice, show the bot's
physical location, and maybe a beep (find me) function."

Extends [ambient-companion-2026-10-27.md](ambient-companion-2026-10-27.md) (RULES.md S2). Builds on
[robot-companions-2026-10-21.md](robot-companions-2026-10-21.md) (a robot has its own companion persona and controls level),
[robot-own-name-and-memory-2026-10-20.md](robot-own-name-and-memory-2026-10-20.md) (a robot answers to its own name; `device_id`
on conversations and memories), [robot-face-color-and-night-2026-10-20.md](robot-face-color-and-night-2026-10-20.md) (the
face colours) and [household-voices-2026-10-20.md](household-voices-2026-10-20.md). Backlog row: BOTS-AMBIENT-01.

## Supersedes

- `robot-own-name-and-memory-2026-10-20.md` Mechanics 1 ("`device_id` conversations are `surface: "robot"` only") and 3 ("Chat
  and every other surface read no robot-bound record"): a chat-surface side chat may now carry a `device_id`, used for the
  robot's name and voice only. The memory rule stands in substance: a hub side chat with a robot reads and writes the viewer's
  own memories, never the robot's rapport or own-fact records. Recall (`memory.ts`) and the memory judge admit robot-bound
  records only when the turn surface is `robot`, never from the conversation's `device_id` alone; that guard is part of slice
  01c with its test.
- ROBOT-ADMIN-PLACE-01 and `routes/devices.ts` commands route ("only `mute` reaches non-pairers; children and guests excluded"):
  `find_me` is also accepted from every household member who may see the robot, children included (a chirp is harmless and a
  child looking for the robot is the point); guests stay excluded, as for every command.
- `routes/devices.ts` `/{id}/companion` (admin only): the robots list now carries `companion_id`, `companion_name`, `face_color`,
  `night` and `speaking` for each robot the viewer may use (section 2); a viewer who fails `mayUseCompanion` for a robot's
  companion gets that robot without those fields and the Bots group does not list it.
- `ambient-companion-2026-10-27.md` section 1 item 1 ("the person's default companion from settings"): the slot's occupant is
  `companions.ambient_bot` when set, else `persona.active_id`. Section 1 item 3 (the preview's contents): when a bot is in the
  slot the preview's single action button is "Find me" instead of "Review" (S2 keeps one button there; a bot's tasks never need
  a Review).

## 0. Decisions

1. **A robot stays a Device; it never becomes a companion record.** The picker gets a second group, "Bots", listing the
   household's robots (`GET /api/devices/robots`, which every signed-in person may read). Choosing one writes the new person
   setting `companions.ambient_bot` (the device id; empty means the companion in `persona.active_id` is shown). One slot, one
   occupant: a bot or a companion, never both (S2 "one companion at a time").
2. **Talking to a bot is talking to the robot's own companion persona, as yourself.** The side chat is created with
   `companion_id = robot.companion.id` and `device_id = <robot>` (the conversation field from robot-own-name-and-memory). On a
   chat-surface turn with a `device_id`, the identity line uses the robot's name and the reply voice is `voiceForSpeech({actor,
   deviceId})`, so the robot's own voice (`robot.voice.id`, else its companion's voice, else Home's) speaks. The band, memory
   scope and tools stay the viewer's (rule 0: the chat surface gates by the person, never by the robot's controls level); a
   robot whose companion the viewer may not use is not listed (decision 6), and neither is a robot with no companion assigned
   (`companion_id` empty): there is nothing to talk to. **It answers about itself.** A turn with a `device_id` carries a short
   context note of that robot's own record: battery level and charging, presence, room, last seen, firmware and app versions, and
   the open health rows the status page already holds for it; so "Rover, how is your battery?" or "are you okay?" is answered from
   the record (Jesse, 2026-10-31: "it can answer also about the bot's battery and health"). The note is read-only data in the
   prompt, never a tool that touches the unit.
3. **The face is a representation, never the camera.** The kit `RobotFace` Element draws the StackChan face (seven face
   colours, night mode, the eleven presence expressions) from `robot.face.color`, `robot.night.mode` and the robot's live
   `presence`; sleeping and offline draw as such. At header size it is a still (idle, sleeping or offline) plus the ring, never
   an animated expression (ambient record section 6a, AMBIENT-02); the stage in the pane may change expression. R1 to R4 stand:
   nothing from `/me/vision` or the live view reaches this spot.
4. **Location is the robot's room.** `Device.area` ("Living room") is the only location data a robot has; the preview and the
   pane header show "In the living room, on battery 62%" (or "Offline since 10:14"). No coordinates and no map exist, and none
   are added.
5. **Find me is a device command.** New spec kind `find_me` (optional `seconds` 1 to 30, default 5): the robot chirps and
   flashes its ring; it never speaks or moves. Any household member who can see the robot may send it (the robot is a shared
   object, like the doorbell); it queues like every command when the robot is offline. The bot firmware handles the kind in its
   own release; until then the command is accepted and expires unseen, which is the existing behaviour for every command.
6. **Teens and children see bots they may use.** The Bots group shows a robot only when the viewer's band fits the robot's
   companion floor (the same `mayUseCompanion` check as every companion). A child never gets a robot whose companion is adult.

## 1. What the person sees

- The pane's "Choose companion" select gains a "Bots" group under the companions: the robot's name and room ("Rover, living
  room"), with the face colour dot. Picking one swaps the top-right avatar for the robot's face at header size; the ring states
  keep working (listening, thinking, speaking come from the same presence hook, driven by the side chat).
- Hover preview: the robot's name, "In the living room, on battery 62%" as the context line, the last line of the viewer's own
  side chat with it (never what the unit said to someone else, rule 6a), the Ask field, and one action button: "Review" while a
  task of the viewer's own needs them, "Find me" otherwise. "Ready" still comes from `/api/health` only (S6), not from whether
  the robot is online.
- The pane's Talk tab is the usual side chat; the History tab lists the viewer's own side chats with that `device_id`, never a
  robot-surface conversation; the
  Settings tab shows the voice it speaks with ("Rover speaks with Rivet's voice") and links to Settings, Home, Devices for admins.
- A robot that is offline draws its face asleep with "Offline since 10:14"; Find me stays available (queued).

## 2. Reuse check (org principle 6, RULES.md rule 9)

- Picker: the kit `Select` with groups (already used for companions). Preview: the kit `CompanionPreview` with its existing
  action slot ("Find me"). The companion path keeps `CompanionAvatar`.
- Face, the one new part. Prebuilt options checked: (1) the open StackChan face renderers (m5stack-avatar, MIT; the stack-chan
  project's face, Apache-2.0): C++ and TypeScript for the unit's display, not web components, so they are the source to port the
  eye and mouth geometry from, with the licence named in the Element's header; (2) `CompanionAvatar` or `CompanionStage` fed
  still images of the face: 7 colours times 11 expressions times day and night is 154 shipped images that cannot follow a colour
  change and still need a renderer to make them. Neither fits as shipped, so `RobotFace` is a new kit Element (rule 9c, additive
  in commons). It takes its colour names from the spec registry options of `robot.face.color` and its expressions from the spec
  presence vocabulary, imported, never a second list (principle 1).
- Data: `GET /api/devices/robots` rows gain `companion_id`, `companion_name`, `face_color`, `night`, `speaking` for every viewer
  who may see the robot (today only admins read `/{id}/companion`); the room is `area`, the state is `state.presence`,
  `state.battery_level`, `state.on_battery`, `lastSeenAt`.
- Chat: `createConversation(mode, undefined, undefined, companion_id, "side", device_id)` and the existing turn path. One new
  branch in the turn: `conversation.device_id` on a chat surface applies the robot name and the robot voice, nothing else.
- Command: `issueDeviceCommand(deviceId, "find_me", { seconds })` through `POST /api/devices/{id}/commands`, whose `kind` enum
  grows by one; the admin-only check on that route relaxes to "may see this robot" for `find_me` only.
- Spec first: `companions.ambient_bot` and `find_me` (spec-v0.1.285), then the kit (`RobotFace`, ui-v0.5.435 or next), then Home.

## 3. Slices (each lands on its own)

- BOTS-AMBIENT-01a: spec key and command kind (commons spec). Done when the tag exists and Home pins it.
- BOTS-AMBIENT-01b: `RobotFace` Element (commons ui) with a test per expression. Done when the tag exists and Home pins it.
- BOTS-AMBIENT-01c: Home backend: robots list fields for every viewer, `find_me` on the commands route, `device_id` on side
  conversations, the turn's name and voice branch; tests for each.
- BOTS-AMBIENT-01d: Home frontend: Bots group in the picker, `companions.ambient_bot` in `useAmbientCompanion`, the face in the
  header and pane, the room line, Find me in the preview and pane; the dev seed gets one robot ("Rover", living room) so the
  preview shows the group; screenshots at desktop and phone width.
- BOTS-AMBIENT-01e: bot firmware handles `find_me` (bot repo, its own release; flashing the unit is Jesse's).

## Conditions (architect, 2026-10-31)

1. Review still works for a bot: the preview's one action slot shows Review while one of the viewer's own tasks needs them
   (the robot's companion activity, read as for a companion) and Find me otherwise; Find me always shows in the pane.
2. A robot with no companion assigned is not listed in the Bots group.
3. No timer: the face's presence, sleeping and offline state come from the robots list on a plain query that refetches on focus
   and navigation (ambient record 6a); the settings page's 5-second refetch is not reused in the shell.
4. History shows only the viewer's own side chats with that `device_id`; the colour swatch in the picker is a colour, never an
   online or offline indicator (S2: no count, dot or badge on the avatar).
Open reading for Jesse at the 01b screenshots: S2 says the stage draws the character with no background of its own; the coloured
plate is read here as the face itself (the shape of the unit's screen, nothing behind or around it). If he reads the plate as a
backdrop, that is a rule change for him.

## 4. Out of scope

Coordinates or a map for the robot (no data), driving the robot from the pane, streaming the camera into the pane (R1 to R4),
a robot speaking the side chat aloud on the unit (that is the robot surface, unchanged).
