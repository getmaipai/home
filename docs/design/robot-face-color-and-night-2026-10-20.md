# A robot's face color and night mode (2026-10-20)

Design note, hub, spec and bot. Rules in [RULES.md](RULES.md) govern; nothing here asks for a rule change. Owner's ask (Jesse,
2026-10-20): the owner picks the robot's face background color; when it is dark the face turns black, when it is light it shows
the chosen color; at night the robot moves little or not at all, so nobody hears its motors while sleeping.

## Supersedes

Nothing. Both keys are new; `robot.sleep.auto` and `robot.idle.level` keep their meaning.

## Who

Admins, per robot, on the robot's card in Devices (the `robot.hello` device group, where `robot.idle.level` and `robot.sleep.auto`
already live). Nobody else sees them.

## Facts (StackChan session, 2026-10-20, from the pinned firmware source and bot main)

- The mint face colors are compiled into bot firmware patch 013 (background `0xC4F0DA`, ink `0x18241F`). Nothing changes them at run
  time. A black background needs a light ink, so a choice must set both.
- Darkness today is the camera's mean brightness in bot `presence/sleep_auto.py`; with the camera off it cannot run. The CoreS3 has
  an ambient light sensor (LTR-553) with no driver in the firmware at all.
- The firmware already has calls for screen brightness (`self.screen.set_brightness`), speaker volume
  (`self.audio_speaker.set_volume`) and the LED strip (`self.robot.set_led_colors`, patch 012).
- The servos already release torque when the head is at rest, so a still head is silent. The night noise is idle random movement,
  set by the firmware's own idle level with no remote command; `robot.idle.level` is not wired on StackChan yet.

## Design

Two device keys, spec first (`commons/spec/settings/keys.json`, group `robot.hello`, admin, `honoured_by: ["home", "bot"]`),
delivered to the Bot app by the existing `settings_changed` path. Home draws them with `SettingsRenderer` on the robot's card; no
Home code beyond the keys landing in the pinned spec.

1. **`robot.face.color`**, `select`, default `mint`. A fixed palette, each entry a background and ink pair the bot owns: mint, sky,
   peach, lavender, lemon, rose, cloud. A select, because the spec has no color selector and a free color could pick an ink the
   face cannot be read on. Label "Face color".
2. **`robot.night.mode`**, `boolean`, default on. Label "Night mode". Copy: "During quiet hours or when the room is dark, the face
   turns black, the screen dims, the voice gets quieter and the robot holds still, so it stays quiet. Talking to it or its wake
   word still works."
   - **Night starts** at household quiet hours (`household.quiet_hours.from`/`to`) or when the room is dark: the light sensor below
     a threshold for 2 minutes, or the camera's brightness where the light sensor is missing. **Night ends** at the end of quiet
     hours and when the light is back above a higher threshold for 2 minutes (two thresholds, so a flicker does not toggle it).
   - **At night:** black background with light ink; the screen backlight dimmed (a black face still lights a dark room); the
     speaker at about 40% of its day level, so an answer at 2 am does not wake the house; the LED strip off; idle movement off
     (still); no gestures; the head turns only to face someone who speaks to it, once, slowly, then rests and its torque releases.
     Day restores the owner's brightness, volume and lights.
   - **Thresholds pending measurement.** The light sensor sits beside the screen, so a bright face can raise its reading and keep
     a dark room from ever reading dark. The two thresholds ship as constants marked pending, and are measured on the unit after
     the first flash (a task waiting for Jesse). The camera fallback does not have this problem.
   - Night mode is separate from `robot.sleep.auto`: a robot can be awake at night (someone is talking to it) and still keeps the
     black face and stillness.

## Reuse check

The setting path (spec key, `SettingsRenderer`, `settings_changed`) is reused unchanged. Household quiet hours are reused, not a
second schedule. The bot's existing camera brightness rule is reused as the fallback. The existing brightness, volume and LED calls are reused. The only new parts
are two firmware calls and a light-sensor driver the body lacks.

## Rows

| Row | Repo | What | After |
|---|---|---|---|
| SPEC-ROBOT-FACE-NIGHT-01 | commons | the two keys and their copy | none |
| ROBOT-FACE-NIGHT-01 | home | pin bump; the card shows both keys; a test that an admin can set them and a non-admin cannot | SPEC-ROBOT-FACE-NIGHT-01 |
| BOT-FACE-NIGHT-01 | bot | one firmware patch (015 or later, after the stutter patch lands) adding `self.screen.set_face_background` (a palette entry, kept in NVS), `self.robot.set_idle_motion`, and a new LTR-553 I2C driver behind `self.screen.get_ambient_light`; the Bot app maps both keys to those and to the existing `set_brightness`, `set_volume` and `set_led_colors`, and runs the night rule with thresholds pending measurement | SPEC-ROBOT-FACE-NIGHT-01 |

Flashing the patched firmware onto the unit is Jesse's call.
