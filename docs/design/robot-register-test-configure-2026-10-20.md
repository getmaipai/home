# A robot's place in Home: register, test, configure (2026-10-20)

Design note, hub side. Amends [devices-and-robot-link-2026-10-17.md](devices-and-robot-link-2026-10-17.md) sections 2 and 3
and cuts its DEVICES-02 slice. Written while the first StackChan unit is on the bench (bot repo, `docs/dev/stackchan-unit-measurements.md`).
Rules in [RULES.md](RULES.md) govern; nothing here asks for a rule change.

## The problem

The Devices page was built around the Reachy Mini. A StackChan (or any body that is not a Reachy) has three holes in Home today:

1. **Register.** The Bot service that drives a StackChan pairs with Home through Quick Connect (the bot's `link/client.py`), but
   `POST /api/auth/devices/redeem` refuses every robot with no rotated vendor password (`robot_password_unrotated`,
   `backend/src/routes/deviceAuth.ts`). A StackChan has no vendor SSH login to rotate, so it can never finish pairing.
2. **Test.** The robot card (`RobotBody.tsx`) offers mute, motor restart, live view and remove. An admin cannot ask a paired robot
   to say a line, show a face, move or light up to prove each part works. The only way today is the bot's bench script
   (`bot/body/scripts/stackchan_control.py`), a developer tool on the bot host.
3. **Configure.** Device-scope settings exist on the server (`robotSettingsKeys.json`: `robot.barge_in.open_mic`,
   `robot.camera.watch_level`, `robot.follow_up.seconds`, `robot.gestures.enabled`, `robot.idle.level`,
   `robot.initiative.allowed_here`) and nothing in the frontend reads or writes them. There is no route to rename a device or set its
   area, both promised by the 2026-10-17 note.

## Who

Admins only for all three, as the 2026-10-17 note's gate table says. Adults keep what they have on the robot card. Children and teens
see nothing new.

## 1. Register

- **The gate follows the body, not the kind.** The capability vocabulary gains `no_vendor_login`: "the body has no published login
  password to change". The redeem gate and the "rotate the password" step are skipped only for a robot whose Device row lists
  `no_vendor_login`. Every other robot keeps the gate, so a Reachy paired before this change, or a Reachy on an older bot, is gated
  exactly as today. The opt-out is safe by default: a body that forgets to declare it is gated, never waved through. The bot's
  StackChan profile declares it (bot half).
- **Threat model.** Capabilities are self-reported. A device that claims `no_vendor_login` falsely gains nothing: it still needs an
  admin to approve its spoken or shown code, and the gate exists to protect the household's own robot from its published password,
  not to authenticate the robot. The add dialog shows what the robot reported ("No vendor password to change") so the admin sees it.
- **What stays in the bot.** A StackChan joining its Bot service (the per-device token flashed over USB) is the bot's own pairing
  and stays on the bot's local page for now. Showing a body's join request on Home's Devices page is a later row
  (ROBOT-BODY-JOIN-01), after the bot exposes pending body requests over the paired link.

## 2. Test

- **A "Test this robot" panel on the robot card**, admin only, one button per part the robot reported: Speaker (says a fixed line
  with the robot's name), Face (cycles the expressions it has), Head (looks left, right, centre), Lights (one colour sweep),
  Microphone (listens 3 seconds and reports the level, never the audio). A part the robot did not report is not shown.
- **Wire, spec first.** `device-command` gains `self_test` with payload `{run_id, part}`, `part` one of `speaker`, `face`, `head`,
  `lights`, `mic`. The robot answers on HTTP `POST /api/devices/me/self-test/{run_id}` with the new `robot-self-test-result`
  record `{run_id, part, ok, detail, took_ms}`; `detail` is at most 200 characters of plain words and never audio, a transcript or
  an image (rule 6a). The hub keeps results in memory for 10 minutes, not in the database: a test is a check, not a record.
- **Route.** `POST /api/devices/{id}/self-test {part}` (admin) issues the command and holds the one request open until the
  robot's result arrives or 15 seconds pass. No client polling loop and no second route (rule S6).
- **Not ready is reported as not ready (S6).** If the robot's link state is not live when the button is pressed, the route answers
  at once with that state ("This robot is offline. It was last seen at 3:40 pm. Check that it is on and on your Wi-Fi."), and the
  button is disabled while the card's pill already says offline. A live robot that does not answer in 15 seconds gets the kit
  destructive Alert: "The robot did not answer the test. Restart it, then try again."
- **A failed part never fails the card** (in the spirit of rule 5): each button shows its own pass, fail or no-answer line.
- **Quiet hours do not block a test**: an admin pressing Speaker wants to hear it.
- **The Speaker line is a fixed clip (rules 6 and 10).** Text: "Hi, I am {name}. My speaker works." The robot's name is the
  admin-set Device name, already limited to 60 characters. The line, name slot included, is reviewed by a person against the child
  floor when written, and gains a row on the privacy page (what the test sends to the robot and that nothing comes back but a pass
  or fail line). It is rendered by the robot's own voice, never generated.
- **Drawn inline.** The test buttons are kit parts inside `RobotBody` itself, no `RobotTestPanel` or other wrapper component
  (rule 9b).

## 3. Configure

- **Name and area.** `PATCH /api/devices/{id}` (admin) with `{name?, area?}`, each 1 to 60 characters or `area: null`, validated as
  the `device` record already says. Additive (the API rule).
- **A robot's settings area** (the cut DEVICES-02): a "Settings" button on the robot card opens the kit `SettingsShell` for a new
  spec settings card `{label: "This robot", group: "robot.hello", scope: "device", min_role: "admin"}` in `spec/settings/areas.json`
  (added in SPEC-ROBOT-TEST-01; rule S4). Values go through the existing `GET/PUT /api/settings` with `scope=device:<id>`, and the
  text comes from the spec copy fields through `describeSetting` (rule S5), so a key added to the `robot.hello` group appears with
  no UI change. Name and area sit at the top; "Forget this robot" (the existing `DELETE /api/devices/{id}`) sits at the bottom with
  what it erases.
- Quiet hours stay household and person keys; the robot's settings link to them rather than copying them (principle 4).

## 4. Voice and what an admin sees (owner ask, 2026-10-20)

Jesse asked to assign a robot things like its name and voice and to see its info: online, IP address and the like.

- **Info (in DEVICES-02).** The robot card already shows online or not responding, last heard from, capability badges, battery,
  MaiPai version and body software (`RobotBody.tsx`). DEVICES-02 adds one admin-only `Row label="IP address"` to that card's
  existing `<dl>`, nothing else. The address is the socket address of the robot's last signed-in request (`getConnInfo`, never a
  forwarded header), kept in memory beside the robot state, never written to the database; after a hub restart it appears once the
  robot next checks in. A home-network address shown only to an admin; nothing leaves the home.
- **Voice (three later slices, after DEVICES-02).**
  1. UI-SETTINGS-OPTIONS-01 (commons `ui`): the kit settings renderer and shell take runtime options for a key whose range is
     `options_from`, through a prop, so a `select` with fetched options draws in the kit field part. No Home-side picker.
  2. SPEC-ROBOT-VOICE-01 (commons `spec`): device key `robot.voice.id`, group `robot.hello`, `select`, `range.options_from:
     "voices.tts"`, default `default`, label "Voice", honoured by home.
  3. ROBOT-VOICE-01 (home): `options_from: "voices.tts"` resolves to the one voice list `tts.voice_id` uses, in backend validation
     and in the options passed to the renderer. `POST /api/tts` on a robot device session speaks with the device's `robot.voice.id`
     when it is not `default`. Child floor: when the robot's person is a child, a non-preset voice is ignored and today's voice is
     used, the same rule `settings.ts` applies to `tts.voice_id`; a fail-first test proves it.
     Supersedes: `routes/tts.ts` choosing the voice only from the person's `tts.voice_id` (a robot session now checks its device
     key first).
  No bot or firmware change for voice: the robot already speaks through `POST /api/tts`.

## Kit Elements and parts (rule 9)

`card`, `button`, `badge` (pass, fail, no answer), `dialog` (settings, forget), the kit settings shell and its field parts, `input`
(name, area). No `className` that changes shape or layout on any Element; no Home wrapper around one.

## Slices

| Row | Repo | Size | Needs |
|---|---|---|---|
| SPEC-ROBOT-TEST-01 | commons | S | `no_vendor_login` capability, `self_test` command, `robot-self-test-result` record, the `robot.hello` device card in `areas.json`, spec tag |
| ROBOT-PAIR-02 | home | S, T2 (auth) | the spec pin |
| DEVICES-02 | home | M | the spec pin; name, area, the settings card, the admin IP row |
| ROBOT-TEST-01 | home | M | the spec pin |
| BOT-SELF-TEST-01 | bot | M | the spec pin; the StackChan profile declares `no_vendor_login`; StackChan and Reachy answer `self_test` |
| UI-SETTINGS-OPTIONS-01 | commons | S | runtime options for `options_from` keys in the kit settings renderer, ui tag |
| SPEC-ROBOT-VOICE-01 | commons | S | UI-SETTINGS-OPTIONS-01; the `robot.voice.id` device key, spec tag |
| ROBOT-VOICE-01 | home | M | both tags; voice list resolution, `/api/tts` on a robot session, child floor test |
| ROBOT-BODY-JOIN-01 | bot, home | later | its own note |

## Reuse check (principle 6)

- **The `device-command` channel and the `/api/devices/me/*` routes:** reused. `self_test` is one more command kind on the same
  socket with the same replay; the answer is one more `/me/` route beside `/me/state`.
- **The existing `play_move` and `notify` commands:** weighed for the Head and Speaker tests and not used. `play_move` plays a recorded
  move with no pass or fail answer, and `notify` speaks to a person (it needs a `person_id` and obeys quiet hours), so neither proves
  a part works.
- **`GET/PUT /api/settings` with the kit `SettingsShell`:** reused unchanged for the robot's settings.
- **The bot's `stackchan_control.py` bench page:** not exposed. It is a developer tool on the bot host with no sign-in and
  StackChan-only controls; Home must not learn a vendor name and needs the admin gate.
- **A shipped diagnostics or self-test component:** none in the kit registry or the shadcn dashboard pages fits a per-part
  pass or fail list; the `card`, `button`, `badge` and `alert` Elements cover it.
- **`VoiceBrowserSection.tsx` (the person voice picker):** weighed for `robot.voice.id` and not reused. It is a Home-side picker
  outside the settings shell, which S4 rules out for a device card; its voice list is reused as the one `voices.tts` source.
- **`lib/robotClips.ts` `adultVoice`:** ROBOT-VOICE-01 routes it and `routes/tts.ts` through one voice-choosing function, so a
  robot's clips and its live speech use the same voice. Order on a robot session: a turn's companion voice (COMP-04) first, then
  `robot.voice.id` when not `default`, then the person's `tts.voice_id`; the child floor applies to the result.

## Supersedes

- [devices-and-robot-link-2026-10-17.md](devices-and-robot-link-2026-10-17.md) section 2's robot pairing step, as built in
  ROBOT-DEVICE-01: the redeem gate refusing every robot with an unrotated password. It now follows `no_vendor_login`.
- `routes/tts.ts` choosing the voice only from the person's `tts.voice_id` (ROBOT-VOICE-01): a robot session checks its device
  key `robot.voice.id` first.
- The same note's section 3 "A robot's settings" wording and its slice 4, DEVICES-02 (S). DEVICES-02 is cut here as an M row.

## Legacy verdicts (rule 8)

- Legacy per-robot diagnostics page with raw logs: **dropped**; a pass or fail line per part is what an admin acts on, and raw logs
  stay on the bot host.
