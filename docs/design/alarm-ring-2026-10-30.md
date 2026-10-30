# The ringing alarm: the companion's dialog and alarm settings (design, 2026-10-30)

Owner: Jesse, 2026-10-30. Built on [agentic-actions-design-2026-10-29](../plans/agentic-actions-design-2026-10-29.md) (alarms and
reminders first) and [ambient-companion-2026-10-27](ambient-companion-2026-10-27.md) (the companion in the top right of every app).
Rules in [RULES.md](RULES.md) govern; nothing here asks for a rule change.

The owner's words, from setting a real alarm on the live hub: the alarm did not go off (fixed: alarms, reminders and timers now run
in their own scheduler lane, `161c6814b`); it should go off in the web app when it is open; "the alarm needs to come from the
companion in the upper right, so the alarm dialog should be there. It should be animated, like a ringing bell or something modern";
"settings for alarms, including a choice of alarm sounds where none is an option"; "companion, not robot."

## Supersedes

Nothing. The `alarm.due` notification, its in-app row and its optional channels are unchanged; this adds how an alarm shows and sounds
in the open web app and where its settings live. The kit toast stays a silent courtesy for everything else (docs/UI.md).

## 1. What the person sees

1. **The alarm rings from the companion, top right.** When an `alarm.due` arrives while Home is open (within the 15 s poll of the
   shared notifications query), a dialog opens anchored under the header companion avatar. The avatar itself is unchanged: it keeps
   its still look and its listening, thinking and speaking ring only, with no count, dot or badge (RULES.md S2; ambient note
   condition 6a). The animation is inside the dialog.
2. **The alarm dialog** is a kit `popover` (non-modal, never trapping focus) showing: a large **ringing bell** (the kit `bell` icon,
   swinging; still under reduced motion), the label in the companion's own short line ("Time to get up: gym" for label "gym"; "Your
   alarm" when there is none), the time it was set for, and two actions: **Done** and **Snooze** (a menu of the shared snooze
   choices; the main button uses the person's default). On a phone the same content opens as the kit `sheet` from the top, because
   the avatar is also top right there (S1, S3).
3. **It stays until the person acts.** Done dismisses the notification. Snooze puts the same alarm's own job back to pending at the
   chosen time (one record, never a copy, as the Household design says) and dismisses the notification. A second alarm that
   rings while the dialog is open adds a row to it ("2 alarms"), each with its own Done and Snooze.
4. **The sound** plays while the dialog is open: the person's chosen sound, looping, at the chosen volume, for up to 2 minutes; after
   that it falls silent and the dialog stays. If the browser blocks sound (no click yet on this page), the dialog shows a one-line
   "Tap to turn the sound on" and plays on that tap. No sound plays for a person whose sound is None.
5. **If Home is not open**, the existing paths decide: the bell and history hold it, the optional browser alert (BrowserAlerts) and the
   optional Telegram or Bark messages (NOTIFY-OUT-01, NOTIFY-BARK-01) tell the person, and the robot's own alarm clip stays
   ROBOT-CLIPS-02's. The dialog appears on the next open if the alarm is still pending, with "Missed at 6:30" instead of a sound.
6. **The companion is the voice, the robot is not asked.** The line is the companion's text in the dialog. Nothing is sent to a robot
   by this slice, and nothing is spoken aloud.

## 2. Alarm settings (person scope, in the Clock app's own settings area)

| Key | Choices | Default |
|---|---|---|
| `alarms.sound` | None, Bell, Chime, Digital, Rise, Gentle | Bell |
| `alarms.volume` | Low, Medium, High | Medium |
| `alarms.snooze_minutes` | 5, 10, 15, 30, 60 | 10 |

The Clock area (APP-SET-02) shows them with a **Preview** button on the sound picker (plays one cycle at the chosen volume). A child and
a teen may change their own (comfort keys, listed with the ease-of-use keys), because a sound on their own device is not a safety
control; quiet hours still decide whether a push goes out, and an adult's or teen's own alarm still rings through them (ALARM-05).
Settings keys are declared in Home ahead of the spec tag, as the Telegram keys were (`scripts/settings-ahead-of-spec.json`), with
the spec tag owed.

## 3. How it is built (reuse, rule 9b)

- **Sounds are synthesized in the browser** with the Web Audio API from short note patterns (no audio files, no license, no
  download, nothing leaves the home); one small module `frontend/src/lib/alarmSounds.ts` owns the six patterns, the volume and the
  2-minute cap. A test checks each pattern's note list and that None plays nothing; the real sound is checked by ear by the owner.
- **The ring state** reads the one notifications query the bell and toaster already share (`useNotificationsQuery`, 15 s poll; the
  alarm lane makes the row arrive on time). A new component mounted beside `NotificationToaster` finds pending `alarm.due` rows the
  person has not dismissed and drives the dialog; it does not add a second poll. The first load never rings old alarms: only rows newer
  than the last dismissal ring, rows already past show "Missed at".
- **Dialog and bell**: kit `popover` (desktop) and `sheet` (phone) for the container, kit `button` and `dropdown-menu` for Done and
  Snooze, the kit `bell` icon sized by its own size prop. The swing is a CSS keyframe class on the icon that sets only `animation` and
  `transform-origin` (never size or layout), with theme tokens only and no Home CSS rule targeting a kit part (rules 9a and 9b).
  A kit `ringing` prop on the icon or a dialog variant is the cleaner later option and needs a `commons` tag, which only Jesse says yes to.
- **Done** is the existing `POST /api/notifications/{id}/dismiss`. **Snooze** is the existing `snoozeComingUp`
  (`backend/src/lib/comingUp.ts`) and `POST /api/coming-up/{id}/snooze`, extended additively: the fired alarm's own job goes back to
  pending at the new time (the `alarm.due` notification carries its job id). There is one list of snooze choices, 5, 10, 15, 30 and 60
  minutes plus tomorrow morning, used by the Clock rows and by this dialog, and the route's zod union is widened to match. No new
  route and no new job record; own rows only, no alarm text in a log line (rule 6a).
- **Reuse check (principle 6):** a prebuilt CC0 sound pack was considered. It needs a download, file storage in the app, a licence
  review per file, and a fixed set of sounds. Browser synthesis needs none of those, so Home keeps six short note patterns. The bell
  uses the kit icon, the dialog the kit `popover` and `sheet`; nothing is hand-built.
- **No second status surface** (rule S6): this is an alarm the person asked for, not a status; it adds nothing to the avatar.

## 4. Slices

1. **ALARM-06:** the three settings keys, the Clock settings area, the sound module with Preview. Exit: pick Chime, press Preview, hear it.
2. **ALARM-07:** the ring dialog under the companion avatar, Done and Snooze on the existing routes, sound and volume, phone sheet,
   reduced motion, missed state. Exit: set an alarm for a minute ahead on the preview hub, watch the dialog ring under the avatar,
   snooze it, mark it done.

If the owner wants the avatar itself to carry a ring or badge for alarms, that changes RULES.md S2 and is his call; it is not built.

## Legacy verdicts (rule 8)

- A silent toast for an alarm: **dropped** for alarms (it is easy to miss); kept for everything else.
- A full-screen alarm page: **dropped**; the dialog is non-modal and the person can keep working.
