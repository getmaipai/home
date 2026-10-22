# Robot vision (2026-10-21)

Status: built in Home (ROBOT-VISION-01). The robot side is ROBOT-VISION-02, in the bot repo.

Owner ruling, 2026-10-21, in chat: the StackChan needs constant vision. It continually knows where it is, what it is looking at and
whether it is dark. This is not an adult versus child question. What matters is that the data is never retained, is protected, and
cannot be exposed or intercepted. Each robot gets a setting: continual (the default), on demand (the stock StackChan behaviour) or
none (no camera at all), so an admin decides.

## What it does

- `robot.vision` is a device setting with three values. Labels in Settings, Devices: "Always watching (default)", "Only when I ask",
  "Camera off". It shows on the robot's page with the other robot settings and reaches the bot as `settings_changed`.
- The bot posts a JPEG (a 320 to 640 pixel frame, at most 512 KB) to `POST /api/devices/me/vision`. Home hands it once to the chat
  model's picture input (the same local engine that reads chat pictures) with a fixed prompt that asks for one plain sentence of at most
  25 words and forbids naming anyone or describing bodies. The picture is dropped as soon as the call returns.
- Home keeps the sentence, the bot's own face count and a light bucket (dark, dim, bright) in process memory for 90 seconds, one entry
  per robot, replaced by the next one. A robot's turn gets it as one labelled line: "Looked N seconds ago (it may be out of date): ...".
  The line is volatile context after the cached prefix, so it does not break the prompt cache.
- The bot answers "can you see me", "what are you looking at" and "is it dark" itself from its own face detector, gaze state and light
  reading when it can. The caption is for everything else the model is asked about the room.

## What it never does

Writes either the picture or the description to disk, a stored turn, memory, the library, a backup, a log, a stat or telemetry; returns
them from any route; shows them to any person; names or identifies a person from a face (face identification stays with the face
enrollment and its consent rules); describes a body. RULES.md, "Robot vision", R1 to R4, is the binding text.

## Why a separate route and not a turn picture

The turn route allows pictures on written chat turns only, as an uploaded attachment owned by a signed-in person. A robot is a device
session making spoken turns, and a constant look is not an attachment. Rather than loosen the turn gate, the look travels on its own
route with its own protections and enters a turn only as the description (R4).

## Contract for the bot (ROBOT-VISION-02)

- Auth: the robot's own device session cookie. The route is in `ROBOT_SESSION_ROUTES`; any other session gets 403.
- `POST /api/devices/me/vision?purpose=scene|ask&people=<0..20>&light=dark|dim|bright`, body is the raw JPEG (`Content-Type: image/jpeg`).
  `purpose=scene` is the background refresh; `purpose=ask` is a look the person asked for. Query values are optional.
- 200 `{ "ok": true, "expires_in_s": 90 }`. The description is never returned.
- 403 `vision_off` (robot.vision is none) or `vision_on_demand` (a `scene` post while on demand): stop sending and do not retry until
  `settings_changed` says otherwise. 413 too large, 415 not a JPEG: a bug on the bot, drop the frame. 429 `too_fast`: wait and keep the
  interval at or above 10 seconds. 503 `no_vision` (the chat model is not reading pictures): back off for 60 seconds and keep going.
- Cadence in continual mode: post only when something changed (a face count change, a brightness bucket change, or the head turned to
  a new place), at most one every 10 seconds, and never while the robot is speaking a reply. The hub floor is one picture per 4 seconds.
- The bot keeps no frame after the post, writes none to disk or logs, and logs counts only.
- On `robot.vision = none` the bot must not start the camera stream at all. On `on_demand` it starts it only for an ask.

## A look never competes with real work (ROBOT-VISION-BUSY-01, 2026-10-22)

Priority is chat, then pictures, then video, then everything else, so the robot's own look is the lowest. `acceptFrame` answers 503
`busy` without touching the model when: Coding mode is on (every look, asked or background); a chat turn is running or queued (a
background look only; an asked look is part of someone talking to the robot, so it goes through); or that robot's previous picture is
still being described (one at a time per robot, a second is dropped, never queued). Background pictures are accepted at most every
30 s per robot, asked pictures every 4 s. The signals are the existing ones (`coding.home_mode`, the turn-activity lease count); no new
status UI. Not covered: low free memory has no existing signal in Home, so it is not checked here; the Stack's own queue is the place
for it when LOOK-01 lands.

## LOOK-01 in Home (2026-10-22)

Pinned to spec-v0.1.208 (`LookResult`, the household vocabulary, the `yolox-nano-0_1_1rc0` asset). The hub already serves every entry of
`robot-assets.json` to a paired robot by id, fetched by digest from the entry's source URL and never vendored, so the detector arrives
with the pin. `acceptFrame` asks the Stack's Look for `fast` on a background picture and `detailed` on an asked one (the caller decides, no
word rule); a person is only ever counted, any detail the Stack sends for a person is dropped. Each kind of thing is kept in memory for 90 s
after it was last seen (not after the picture it came from) and read as one line: "Looked 12 seconds ago: a person, 3 chairs, a blue Tesla
Model 3 car (a guess); room: living room; colours: blue, white. Light: bright." Until the Stack's Look tool lands, `lookViaStack` returns
null and the one-sentence caption is the fallback, so nothing changes for a robot today. A model tool call for details is the other allowed
source of a detail request; no such tool exists yet.

## Not built here

Naming people by face. A second look model. Any retention. The commons spec carrying `robot.vision` (it rides in Home's registry,
like `robot.controls`, until a spec tag takes it).
