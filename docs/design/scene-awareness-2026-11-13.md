# Scene awareness: the hub knows who is here, where, and what is going on (2026-11-13)

Status: Architect APPROVED 2026-11-13 (SCENE-01, SCENE-02); SCENE-02 build waits on SCENE-02a landing RULES.md A1 to A4 with Owner-approved: 2026-11-13.

Design note, no product code. Answers the architect's REJECTED verdict on SCENE-01
(2026-11-13; architect verdict records are kept in data-scratch/architect (local)) by splitting the work in two:

- **SCENE-01: who is here and where.** No new sensing. Built from inputs Home already receives.
- **SCENE-02: ambient sensing** (sound events, light, temperature, motion). Needs a new RULES.md section
  that only Jesse can approve; the proposed text is in section 5.2 of this note.

Owner rulings received 2026-11-13 and applied: (1) a child being present is told to the model only;
rule 10 and an adult's gate are unchanged. (2) The always-on sound rule A1 to A4 is approved as
written (the RULES.md edit lands later with its Owner-approved line); nothing is turned on. Every
other question is closed or decided in section 8's Decisions table. Added scope: how others do this (section 9), the robot's own recognition pipeline
and how the scene ties into face recognition (section 10), and the "who am I" acceptance scenario at
every confidence level (section 11). Added later the same day: movement awareness (section 12,
MOVE-SCENE-01 to 06), the bot's self-state (section 13, SELF-SCENE-01 to 04), dismissals and context
states (section 14, DISMISS-01 to 04), and the reuse of the bot's filed SOUND-EVENTS-01 as SCENE-02's
robot half (section 4.1, decision 17).

Reuse check: `backend/src/lib/turnContext.ts` (`sensitiveAllowed`, `effectiveBand`, `SpeakerEvidence`,
`PresentPerson`), the robot's `present` list and `speaker_evidence` on `POST /api/turn` (`routes/turn.ts`
411 to 496), `lib/robotVision.ts` (R1 to R4, `SCENE_TTL_MS` 90 s, `sceneContextLine`, people count, brightness),
the Stack Look component (`POST /v1/images/looks`), `frontend/src/lib/currentLocation.ts` and
`lib/places.ts` (PLACE-WEATHER-01: rounded GPS, host-injected, never a tool argument, never stored;
`resolveWeatherPlace`: a named place wins, then the turn's `current_location`, then the person's saved
place, then the household home, coordinates as `hostInputs` rounded to 2 decimals, 1 for a child),
`lib/weatherAlerts.ts` (the one bounded NWS lookup: `api.weather.gov/alerts/active?point=`, 5 min
cache, one request per 300 s, a 1 h backoff on 403 or 429, US only, behind the household setting
`weather.alerts`, `notifyWeatherAlertsForHome` through `trigger("weather.alert")` with the alert id
as `repeatKey`), the weather package (`backend/packages/weather`: the Open-Meteo recipe with current
temperature, apparent temperature, weather code, precipitation, wind, humidity, hourly precipitation
probability and daily UV max, a 1800 s cache keyed by place, the `weather.alert` notification
declared in its manifest as `time_sensitive` to the household, the privacy rows for Open-Meteo and
NWS), `lib/plugins.ts` (the first active alert rides on a weather result with its severity mapped to
`severe`, `warn` or `info`), WEATHER-KID-01 (an unknown robot speaker takes the household home),
the Home Assistant connector `lib/integrations/homeAssistant.ts` (`subscribeHomeAssistantEntities`,
`readHomeAssistantEntityState`, the `state_changed` socket) and the house registry
`lib/house/registry.ts`, `lib/safetyAlarm.ts` (SAFETY-ALARM-01: deterministic smoke, CO, gas, leak and
alarm-panel path with 10 s debounce, acknowledge, quiet-here, false-alarm, repeats),
`lib/robotOffers.ts` (INITIATIVE-01: offer queue, `may_address`, quiet hours, rate limit, backoff,
snooze), `lib/notifications.ts` and `lib/notificationTypes.ts` (audiences, levels, quiet hours
`household.quiet_hours.*`, `person.quiet_hours.*`, holds), the clock item and the volatile tail in
`lib/turnMachine/nodes/context.ts` (lines 498 to 545), `lib/promptPrefix.ts` and `lib/prefixPrewarm.ts`
(prefix stability), `lib/turnMachine/toolGates.ts` and `budget.ts` (the 16-tool cap, the
TOOL-OFFER-VOICEOVER-01 "offered by structure alone" precedent), the ACT-01 turn signal and ASK-01
`SubjectRef` resolver (read for the trace only, never to offer the tool), REVIEW-0922-01(a) and
ARCH-AMEND-01 (presence as a turn input on every surface), ARCH-POLICY-01 (the ingress boundary),
ARCH-LAYERS-01 (conversational state that dies with the conversation), the bot's BODY-05 presence funnel
and SPEAK-04 fusion (`bot/body/maipai_body/speaker_fusion.py`), BODY-09 room sensors (VL53L5CX, radars,
VEML7700 light, BME688 air, on the Pi build), the Stack's sherpa-onnx speech worker (Silero VAD,
smart-turn, pyannote segmentation and TitaNet-small diarization, CAM++ on the bot), openWakeWord
(STACK-WAKE-01 serving pattern), the wake-word UX record (`LauncherBubble` `listening` state, Turn
off, hidden-tab pause), S6 status rows, privacy rows in `lib/privacy.ts`, and the `boundedMap.ts`
in-process store. Not found anywhere in home, bot or stack: a sound-event classifier, a scene record,
a per-conversation roster of who is present, a calendar connector, or a Wi-Fi presence reader.

Rules this note stays inside: 0 (gates outrank), 1 (the model decides; no word rule), 2 (engine counts
tokens), 4 (prefix stability, window sizing), 6a (counts-only logs), 10 (an adult's gate is never
tightened by context), 11 (only Stack components run models), R1 to R4 (vision; copied to audio in
5.2), S2 (listening indicator), S6 (status through existing mechanisms), the robot paragraph ("speaker
evidence alone decides memory access and acting on the signed-in account"), PRIVACY.md (zero
phone-home, no new outbound), platform principle 2 (the robot is complete without a hub).

## Supersedes

### SCENE-01 (who is here, where, motion, self-state)

| What | Replaced, implemented or extended |
|---|---|
| REVIEW-0922-01(a) interim rule ("no shared-screen surface ships before a test proves it withholds by default") | Implemented, not replaced: SCENE-01b makes presence a turn input on every surface and adds the per-surface tighten-only tests; the interim rule closes when SCENE-01b lands |
| ARCH-AMEND-01 ("presence is a turn input on every surface; withhold by default when presence is unknown on a shared-screen surface") | Implemented as written by SCENE-01b; nothing withdrawn |
| ARCH-LAYERS-01 conversational state | The scene is that layer's input; nothing replaced |
| `robot.state` `motion` enum (`resting`, `held`) and `put_down_count` in `commons/spec` | Extended additively by MOVE-SCENE-01 (`lifted`, `carried`, `set_down`, `shaken`, `tilted`, `tapped`, `falling`, `bumped`, `rolling`, `pose`); old producers still parse; nothing removed |
| MOVE-CARRY-01 carry rule and `robot.motion.carry_reaction` (Reachy Mini only) | Extended to the StackChan by MOVE-SCENE-02 to 04; the Reachy behaviour, thresholds and tests are unchanged and re-pointed, not rewritten |
| KNOCK-01, RM-06 tip and freefall, the Pi hard-stop order | Unchanged; they outrank every new motion state |
| `robot.offline` notification (10 min, admins, passive) | Unchanged; SELF-SCENE-03 adds `robot.fallen`, `robot.battery_low`, `robot.needs_dock` beside it and replaces none |
| `sensitiveAllowed()` robot floor (confirmed speaker and confirmed alone) | Unchanged as the floor; SCENE-01b adds the chat, phone, tv, pod and overlay cases on top, tighten-only |
| PLACE-WEATHER-01 GPS handling | Unchanged; SCENE-01d reads the same host-injected rounded point and adds home or away |
| PLACE-WEATHER-01 place precedence, `weatherAlerts.ts` cache and pace, the weather package's recipe and cache, the `weather.alert` notification, `notifyWeatherAlertsForHome` (section 15) | Nothing replaced: the scene's weather cue calls the same recipe with the same host-added rounded point and reads the same alerts cache; SCENE-01j adds a caller-place alert check beside the home check and a template line on robots; `minutely_15` precipitation is an additive recipe field behind the existing Open-Meteo row. One shipped default changes (decision 31, 2026-11-13): the weather manifest's `weather.alerts` goes from false to true when the household home is in the US, an admin can turn it off, and the NWS privacy row's wording follows |
| PRESENCE-FIND-01 (live location, needs its own consent design) | Not touched; SCENE-01f reads only the actor's own linked Home Assistant tracker for a coarse home or away line and never another person's |
| Everything else | Nothing |

### SCENE-02 (ambient sensing, dismissals)

| What | Replaced, implemented or extended |
|---|---|
| SAFETY-ALARM-01 `acknowledge` semantics (ends the alarm; adults only; `false_alarm` admin-only) | Extended by DISMISS-01: `acknowledge` also holds that sensor kind on that sensor for 15 minutes with the deterministic re-alert margin (decision 24); the admin-only `false_alarm` stays exactly as built; Jesse's yes recorded 2026-11-13 (decision 25), superseding SAFETY-ALARM-01's "an adult's acknowledgement ends it"; ruling 27 (dismissal by whom the alert is for) extends `quiet_here` to a person's own device at any age, listed in question 28 |
| Decision 23 (ten-minute courtesy hold plus the ask-a-grown-up line for a child, teen or unconfirmed speaker; a teen fully dismisses notable kinds on their own robot) | Superseded by ruling 27 (2026-11-13): anyone may dismiss an alert directed at them, for themselves only; holds for a device, room or household and sensor-alarm dismissals for others stay with a confirmed adult or the owning adult; nothing turns on teens |
| SOUND-EVENTS-01 (bot: sound tags as hints only, off by default per robot, never a safety input, never recorded) | Reused as SCENE-02d with its default, scope and no-import test unchanged; promotion of two classes to the alarm path is decision 17's measured month, not this note |
| The earlier draft's DISMISS-01 test that `safetyAlarm.ts` never imports the suppression table | Withdrawn and reversed in the form of 14.5: the alarm module reads a suppression module that imports no model, turn, TTS or package-host code |
| Robot vision R1 to R4 | Unchanged; A1 to A4 are their copy for audio and the robot's own sensors |
| Wake-word invariants (off by default, adult, per device, visible indicator, one-step Turn off) | Reused for browser and phone listening; nothing changed |
| `platform:home-assistant-events` privacy row | Reworded to list the sensor domains now read; nothing removed |
| Everything else | Nothing |

## 1. Inventory of inputs, per surface

Legend: **have** = Home or the bot reads it today; **build** = software only; **hardware** = needs a
device the household buys.

### 1.1 Robot (Pi build and Reachy Mini)

| Input | Status | What it gives the scene | Where it is today |
|---|---|---|---|
| Camera, face match | have | `present` entries (person id or unknown, level), face count | bot SPEAK-04 fusion, SFace prints synced from `/api/biometric-prints/sync`; `present` on the turn |
| Camera, look | have | people count, brightness bucket, object tags, 90 s expiry | `robotVision.ts`, Stack Look; R1 to R4 |
| Mic array, voice match | have | `speaker_evidence` (CAM++ voice print) | bot speech process, turn request |
| Mic array, direction of arrival | have (bot only) | where the speaker is relative to the robot | BODY-03, XVF3800 beam; stays in the body |
| Mic, sound events | build (SCENE-02) | doorbell, glass, alarms, dog, baby, knock | none |
| IMU / accelerometer | have (bot) | still, lifted, carried, set down, shaken, tilted, tapped, falling | Reachy: `presence/motion_state.py` (MOVE-CARRY-01), `knock.py`, `safety.py`; StackChan: firmware events `shake`, `orientation`, `tap` (BMI270 read every 10 ms); `robot.state` already carries `motion: resting | held` and `put_down_count`; section 12 |
| ToF, radar, light, air (BODY-09) | hardware + build | someone near, room light, temperature, air quality | not fitted; Pi build only |
| Room the robot is in | build (admin sets it) | `room` for the scene | the robot's Device record has no area today |
| Battery, charging, Wi-Fi signal | have | "the robot is on its dock" | `robotCheckin.ts` |

### 1.2 Browser (chat on a computer) and phone (installed web app)

| Input | Status | What it gives | Notes |
|---|---|---|---|
| Typed words | have | claims: "I'm here with Bruno", "he just left", "Fluffy says hi" | the scene tool (section 2.5), the model decides |
| Mic (voice session, wake word) | have | `speaker_evidence` is `signed_in` today; voice match is possible (TitaNet or CAM++ in the Stack) | build: voice match on the hub's voice session, same prints as the robot |
| Mic, sound events | build (SCENE-02) | the same event list, classified on the device | off by default, adult, per device (wake-word invariants) |
| Camera | have (enrollment only) | people count | `frontend/src/lib/vision`; a continual browser look is **not proposed** (a laptop camera in a bedroom; no R2 equivalent exists for browsers) |
| Geolocation | have | home, away, area; rounded (2 decimals, 1 for a child) | `currentLocation.ts`, `places.ts`; sent only when permission is already granted |
| Device orientation | build, low value | face down, in a pocket | needs a permission prompt on iPhone; skip until a use is named |
| Battery, network type | build, Chrome only | "on battery", "on cellular" | not in Safari or Firefox; skip |
| Page visibility, page context | have | which screen is open, tab hidden | `page_context` on the turn; the wake-word hidden-tab pause |
| Hub-side: the device's LAN vs tailnet address | have | at home or away (coarse) | `getConnInfo`, tailnet ranges in `hubEndpoints.ts`; never a room |

### 1.3 Hub devices and smart home (through Home Assistant only)

| Input | Status | What it gives | Notes |
|---|---|---|---|
| `binary_sensor` motion, occupancy, door, window | have (connector), build (scene use) | someone is in a room; a door opened | the connector subscribes to any entity id; the registry template reads 9 domains today and must add `binary_sensor` and `sensor` |
| mmWave presence sensors | not planned (decision 5, 2026-11-13) | per-room occupancy and lux | no purchase; if one already exists in Home Assistant it is read like any other occupancy entity |
| `sensor` temperature, illuminance, humidity, CO2 | have (connector), build (scene use) | light and temperature buckets | whatever Home Assistant already exposes (thermostats, a lux sensor), plus BME688 on the robot when fitted; a soft cue |
| Smoke, CO, gas, leak, alarm panel | have | emergency | `safetyAlarm.ts`, already deterministic and quiet-hours-proof |
| `device_tracker` or `person` (router or phone app) | have (connector), build (scene use) | the speaker's own home or away, as a soft cue on their own place line | decision 6 and the architect's condition: only the actor's own linked entity is read (they link it themselves in their own settings; a parent links a child's), confidence 0.4, because the phone may be off, out of the app or without permission; another person's home or away never reaches the model; absence of a phone is never proof of absence of a person; never a room, route or history from a phone; Home scans no network itself |
| Doorbell (Ring, UniFi, Reolink via HA) | hardware | doorbell pressed, person at door | a `binary_sensor` or event entity; no camera picture reaches the model |
| Lights state | have | "the living room lights are off at 9 pm" | house registry |
| Wearables (watch, sleep, steps) | hardware | asleep, heart rate (health data) | **not proposed**: health data needs its own consent design; out of scope |

### 1.4 Hub-side world inputs

| Input | Status | What it gives |
|---|---|---|
| Clock, part of day, locale | have | the clock item, NAT-07b part of day |
| Weather at the household home | have | rain, cold, dark early (weather package; `householdHomeSkyInput`) |
| Weather at the caller's own place (section 15) | build (SCENE-01i, 01j) | current conditions, a short forecast change, active severe alerts, for the place the caller is at: the browser's or phone's own rounded position when granted, else the household home or the device's configured place; a named place in the turn always wins |
| Alarms, reminders, timers coming up | have | "dinner timer ends in 4 minutes" (`comingUp.ts`) |
| Calendar | build | no connector exists; a CalDAV read-only connector is its own backlog row, out of this note |
| Who is signed in on which device | have | sessions table, device kinds |

### 1.5 TV and Apple TV (Go client)

Go is not built yet (no local repo). A TV is a shared surface: presence is unknown unless a robot, a
sensor or a typed claim says otherwise, so sensitive records are withheld by default (ARCH-AMEND-01).
The Siri Remote mic is push-to-talk only; no ambient listening on tvOS. The iPhone Go client gets the
same inputs as the phone web app. The scene shape must be in `commons/spec` first (spec first when a
shape crosses to bot or Go; SCENE-01a).

## 2. One event model

### 2.1 Observations (typed, in process memory only)

```
SceneObservation {
  id: string                      // deterministic per source and time, never a stored record id
  source: { surface: Surface; device_id: string | null; sensor: "face" | "voice" | "typed" | "look" |
            "gps" | "ha_entity" | "robot_room" | "signed_in" | "sound" | "light" | "temperature" | "motion" }
  kind: "person_here" | "person_left" | "place" | "room" | "people_count" | "light" | "sound_event" |
        "temperature" | "motion" | "door" | "weather" | "weather_alert"
  value: PersonRef | PlaceValue | RoomValue | number | SoundEvent | Bucket
  confidence: number              // 0 to 1, from the sensor's own score or 0.5 for a claim
  strength: "strong" | "weak"     // strong: face or voice confirmed, signed-in, a sensor; weak: a typed claim, tentative match
  at: number                      // ms, hub clock
  expires_at: number              // per-kind TTL below
}
PersonRef = { person_id: string | null; label: string | null; relation: "household" | "guest" | "pet" | "unknown";
              band: "child" | "teen" | "adult" | "unknown"; level: "confirmed" | "tentative" | "claimed" }
PlaceValue = { where: "home" | "away" | "unknown"; setting: "indoor" | "outdoor" | "vehicle" | "unknown";
               area: string | null; precision: "area" | "room" }
SoundEvent = { class: SoundClass; score: number }   // SoundClass is the closed list in 4.2
MotionValue = { state: "still" | "bumped" | "lifted" | "carried" | "set_down" | "shaken" | "tilted" | "tapped" |
                "falling" | "rolling"; pose?: "upright" | "left_side" | "right_side" | "upside_down" | "face_down" | "on_back" }
```

A `motion` observation is about the device itself (the robot, a phone), never a person; it is always
`strong` (a sensor) and comes only from the device's own IMU (section 12).

A typed claim's `label` is whatever the person said ("Bruno", "my neighbour", "Fluffy"). It is resolved
against the roster by the same ASK-01 resolver the turn already runs (a household name becomes a
`person_id` with `band` from the record; an unknown name stays a label with `band: "unknown"`). A pet
is `relation: "pet"` and never counts as a listener.

### 2.2 The scene (one per conversation, dies with it)

```
Scene {
  conversation_id: string
  people: PersonRef & { basis: Sensor[]; last_seen_at: number; expires_at: number }[]   // never the speaker
  speaker: SpeakerEvidence | null     // copied from the turn request; the scene never edits it
  place: PlaceValue & { basis: Sensor; expires_at: number } | null
  ambient: { light?: Bucket; temperature?: Bucket; noise?: Bucket; events: SoundEvent[] } | null   // SCENE-02 only
  weather: WeatherCue | null          // section 15: for the caller's place, no coordinates, expires on its own
  alone: boolean                      // derived: people.length === 0 after expiry, and the surface is private
  child_present: boolean              // derived: any person with band child, any level
  updated_at: number
}
```

Store: `lib/scene.ts`, a `boundedMap` keyed by conversation id (cap 200 conversations, LRU), the same
place the interrupted-reply and robot-look data live. Nothing is written to disk, a stored turn, a
memory, the summary, a backup or a log. The memory judge never sees it (ARCH-LAYERS-01: conversational
state, never judge-extracted). A temporary or incognito chat gets a scene in memory like any other and
it is dropped with the conversation; since nothing persists, "keeps nothing" holds by construction. A
conversation that ends, folds or idles for 30 minutes drops its scene.

### 2.3 Fusion (one pure function, `fuseScene(previous, observations, now)`)

1. Expire first: drop every entry past `expires_at`.
2. Strong over weak: a strong observation about a person replaces a weak one about the same person; a
   weak one never replaces a strong one that is still live. "Bruno left" (typed, weak) removes a typed
   Bruno; a face-seen Bruno stays until his own 90 s expiry, and the model is told "the camera still
   sees him". A new strong sighting within the TTL re-adds a person the words removed.
3. Conflict between two strong sources (face says Nova, voice says Marlow) is `unknown`, never a pick,
   the same rule the bot's SPEAK-04 fusion applies.
4. People count from the look (R1) is a floor: if the robot counts 3 faces and the scene names 1, two
   `unknown` entries are added so `alone` is false.
5. Place: GPS (strong) beats typed (weak) beats signed-in device address (weak). A room comes only from
   a robot's admin-set room, a Home Assistant area on the device, or a typed claim; GPS never gives a
   room.
6. Derived flags are recomputed on every fuse; nothing stores them.
7. Home Assistant cues are soft (decision 6) and a person's tracker is theirs alone (PRIVACY.md, "a
   person's activity stays theirs"). An occupancy, motion, door, lux or temperature entity (room-level,
   naming nobody) enters at confidence 0.6 for occupancy and 0.4 for the rest, `strength: "weak"`, so
   it can add an `unknown` entry or a bucket but never confirms a person, never removes one a strong
   source saw, and never makes `alone` true on its own. A `device_tracker` or `person` entity is read
   only when it is the actor's own: the person links their own entity in their own settings
   (`scene.ha_person_entity`, person scope, set by that person; a parent sets a child's), and its
   `home` state adds "you are probably home" to that person's own place line at confidence 0.4 and
   no presence entry; `away` adds nothing (absence of a phone is never absence of a person). Another
   person's tracker is never read for a turn, never becomes a presence entry, and never reaches the
   model in any form ("Marlow's phone is away" is not a sentence the block can contain). An entity
   whose state is `unavailable`, `unknown` or older than its own `last_updated` plus 30 min is
   ignored, and a connector that is down drops every HA cue at once (its health row already says so).

### 2.4 Staleness and decay

| Kind | TTL | Why |
|---|---|---|
| face sighting | 90 s | matches `SCENE_TTL_MS` |
| voice match | 120 s after last speech | one exchange |
| typed presence claim | 30 min, or the conversation's end | a claim is about this conversation |
| people count (look) | 90 s | R1 |
| GPS place | 10 min | matches `maximumAge` in `currentLocation.ts` |
| weather conditions for the caller's place | 30 min, or sooner when the rounded point moves by 0.02 degrees (about 2 km) or the place source changes | matches the weather package's 1800 s cache; a cue older than its TTL is dropped, never shown stale |
| weather forecast change ("rain likely within the hour") | 15 min | the hourly probability changes slowly; `minutely_15` later |
| active weather alert | 5 min, and never past the alert's own `ends` | matches `weatherAlerts.ts` `CACHE_MS` |
| device-address place | the session | coarse |
| HA motion or occupancy | the entity's own state (live) | the connector already tracks it |
| sound event, ambient class | 60 s | context only |
| sound event, emergency class | 10 min | the safety path owns the alarm itself |
| motion state `lifted`, `carried`, `tilted` (a pose other than upright) | live while the body reports it, then 5 min as "was carried" | the next turn should know it moved |
| motion event `set_down`, `shaken`, `tapped`, `bumped` | 60 s | a cue, not a state |
| motion event `falling` | 10 min | the safety stop owns the moment; the model should still know |
| room after a carry | unknown until a cue sets it (section 12.4) | the old room is wrong by definition |
| light, temperature | 5 min | slow |

The rendered block says the age in three buckets (just now, a few minutes ago, a while ago) so the text
is stable across turns inside a bucket.

### 2.5 The scene tool: conditional, earned by structure

The model maintains the roster through one tool, `scene` (a bundled package like `remember`), with
three actions: `arrived` (label or person, relation), `left` (label or person), `place` (home, away,
indoor, outdoor, room, free label). The tool writes observations of `strength: "weak"`, so it can only
add people or remove typed people: **it never changes the speaker, the memory owner or the acting
account** (the robot paragraph: speaker evidence alone decides those), and it never removes a
sensor-seen person. A child or teen actor's tool has no `left` action for a sensor-seen or household
adult (a child cannot declare the parent gone).

Base or conditional: **conditional**, so the base set of ten does not grow. The signal that earns it
is structural and reads no words (the TOOL-OFFER-VOICEOVER-01 precedent): offered on every turn of a
spoken or shared surface (robot, pod, tv, overlay, phone spoken), and on every written turn of a
member who is not a guest whose budget runs tool rounds. Never on a bare turn. It is dropped last-in by
`budget.ts`'s existing order when 16 would be exceeded, and SCENE-01c records the offered count on a
plain adult written turn before and after. Its own CHAT-AB-01 bench row (`scene-01.json`, section 7)
measures false calls (the model noting a scene change that was not said) and missed calls.

The model is told, as data: whoever the scene lists is in the room; engage them when they speak to it;
when a line is plainly between two people and not aimed at the assistant, answer with nothing (the
spoken path already has a no-reply shape: the `spoken_cue` suppression and the held resume). Whether
a line is aimed at it stays the model's decision (rule 1); a bench row measures it.

### 2.6 Who may know what (the gates)

- `sensitiveAllowed` becomes tighten-only on every surface (REVIEW-0922-01(a), ARCH-AMEND-01). The
  deterministic floor stays exactly as today: robot, confirmed speaker and confirmed alone. Added: on
  chat and phone, sensitive records are withheld when the scene lists anyone besides the actor at any
  level or basis (a typed "Bruno is here" counts); on tv, overlay and pod they are withheld unless a
  strong observation says the actor is confirmed and alone. The function takes the scene as one more
  input and can only return false where it returned true; a test per surface proves each direction.
- `effectiveBand` is unchanged. A child present with an adult actor changes **only what the model is
  told** ("A child is in the room" as labelled data); the adult's output gate stays rule 10's (open
  question 1 for Jesse). For a child or teen actor nothing loosens, ever. On a robot or shared surface
  the listener is an unknown speaker at the child band already (rule 0).
- Memory recall withholds the same way the summary and episode recall already do with
  `withholdSensitive`.
- Logs and the turn trace carry counts only: `scene: { people: 2, strong: 1, typed: 1, place_known: true,
  child_present: false, events: 0 }`. No name, label, room, place, sound class or person id (rule 6a).

## 3. Rendering into the prompt

One item in the volatile tail of the context message, after the stable prefix, beside the clock,
the robot look and the interrupted reply (`context.ts` 498 to 545), id `scene`, source `scene`,
disclosure `child_ok`. It never enters the system prefix, so `promptPrefix.ts` reports the same
`first_diff` as today (the clock line already makes the tail volatile; `prefixPrewarm` is untouched).

```
Right now (background data, may be out of date; state only what it says; never name or identify anyone
from how they look):
With Sage: Marlow (teen, seen by the camera just now), someone the camera does not know (just now),
Bruno (Sage said so a few minutes ago). A child is in the room.
Place: at home, indoors, kitchen (the robot's room). Dark.
Heard: a doorbell, just now.
```

Budget: at most 320 tokens by the engine's own count (rule 2), measured once per render; when over, drop
in this order: ambient events, light and temperature, place detail, the oldest typed people, until it
fits. `alone`, `child_present` and the speaker line are never dropped. The reserved room joins the
window's reserved list in rule 4's terms (the clock and roster already do). A robot's existing
`robot-scene` look line stays as it is; the scene block does not repeat its caption.

## 4. Local classifiers (SCENE-02 and the voice half of SCENE-01)

All candidates run on the hub inside a Stack component or on the device itself; none is an outside
runner (rule 11). Every new model is a wizard and AI & models row with size, licence and readiness.

### 4.1 Sound events

| Model | Size | Licence | AudioSet mAP | Fit |
|---|---|---|---|---|
| sherpa-onnx Zipformer small audio tagging (k2-fsa, 2024-04-15) | 26 MB int8, 88 MB fp32 | Apache-2.0 (sherpa-onnx) | not published; RTF 0.03 on one CPU thread | **first choice**: the Stack's speech worker already runs sherpa-onnx-node for STT and diarization; one runtime, one pin pattern |
| EfficientAT mn10_as (dynamic MobileNet) | 4.9 M params, about 20 MB | MIT | 47.1 | alternative if the Zipformer misses the bar on our 12-event set; needs an ONNX export in the Stack's image-tools environment |
| YAMNet | 3.7 M params, 17 MB | Apache-2.0 | about 0.31 | floor for the Pi robot only; weakest |
| CED-Tiny | 5.5 M, 48.1 | GPL-3.0 | 48.1 | rejected: licence |
| PANNs CNN14, AST, BEATs | 80 to 90 M params | MIT / BSD / MIT | 0.43 to 0.50 | rejected: 20 times the size for 3 points of mAP; chat memory comes first |

Where it runs: on the hub, a `hear` component of the `stt` role (like Look is a component of
image-tools): `POST /v1/audio/events` takes 1 to 4 s of 16 kHz mono PCM, returns the classes over
threshold from the closed list, logs counts and milliseconds only, keeps nothing. In the browser and
phone the same ONNX model runs on the device through onnxruntime-web (the Stack serves the pinned file,
STACK-WAKE-01's pattern), so no audio leaves the device at all; only typed events go to the hub. On
the robot the body runs it in its own speech process through sherpa-onnx (principle 2: the robot builds
its own scene without the hub and posts only events). On Go (decision 8), both: our pinned model
through sherpa-onnx's iOS build is the baseline on every surface, and Apple's Sound Recognition
(`SNClassifySoundRequest`, SoundAnalysis) runs beside it on iPhone as an enhancing extra cue; its
classes map through the same closed label list into the same `sound_event` observation record (source
`sound`, `source.extra: "apple"`), agreement between the two raises the confidence one notch, and
Apple's alone never creates an emergency-tier event. In practice this is iPhone only: on Apple TV the
framework exists but the box has no always-on microphone (the Siri Remote's opens only on its
button), so there is nothing to classify there and Go on Apple TV adds no sound cue.

Closed event list (12): smoke or CO alarm, siren, glass breaking, doorbell, door knock, dog barking,
cat, baby crying, shouting, water running, appliance beep, music or TV. Each maps from AudioSet class
ids in one table; nothing else is reported. Thresholds are per class and set from a measured bench
(section 7, `SCENE-SOUND-BENCH-01`), never by hand.

**Relation to SOUND-EVENTS-01 (bot backlog line 2381; Jesse recalled it 2026-11-13).** That row is
the robot half of SCENE-02 and is reused, not duplicated: "on-robot sound tags as hints only", a
YAMNet-class Apache-2.0 tagger pinned via the hub at 1 Hz, off by default with a switch per robot,
labels from a closed list sent as `sound_event` observations that can only create tier 2 offers, never
a safety input, never a capture trigger, never recorded; the capability id `sound_events` already
exists in `commons/spec/vocab/capabilities.json` (BODY-VOCAB-01, vocabulary only). Checked for an
earlier build: `loki-doki` has only the pod's device cue sounds panel (`DeviceSoundsPanel.tsx`), no
classifier; no `legacy-backups` mirror is on this machine to check, so nothing is known to have been
built or benched. The model pick: the sherpa-onnx Zipformer small tagger is YAMNet-class (AudioSet
labels, Apache-2.0, 26 MB int8 against YAMNet's 17 MB) and runs in the runtime the bot already ships
for CAM++ and the keyword spotter and the Stack ships for speech, so it is the one tagger on every
surface; YAMNet stays the named fallback if the CM4 bench cannot hold 1 Hz. The label list and the
observation record are one: a `sound-events.json` vocabulary in `commons/spec` (the 12 classes with
their AudioSet ids and per-class thresholds) read by the hub's `hear` component, the browser's
onnxruntime-web classifier and the bot, and every producer emits the same `SceneObservation` of kind
`sound_event`. The StackChan's body process runs on the hub machine, so its tagger runs there inside
the bot process; the Reachy's runs on its CM4 (principle 2 either way: the body builds its own scene).

**The conflict, ruled (decision 17, 2026-11-13).** SOUND-EVENTS-01 says a sound tag is never a safety
input; the emergency tier wanted glass-break and alarm sounds in the alarm path. Ruling: hints first.
For the first month sound events only offer and notify on every surface; `SCENE-SOUND-BENCH-01`
measures false emergencies per device per month on the live devices; `smoke_alarm` and
`glass_breaking` are promoted to the alarm path only when they measure under one false emergency per
device per month and Jesse says yes then. SOUND-EVENTS-01's no-import test stays until that day.

### 4.2 Speaker identification

Reuse: the household's voice prints (SPEAK-04, CAM++ 512-d on the bot) and the Stack's TitaNet-small
(CC-BY-4.0, diarization component) or CAM++ through sherpa-onnx. One model household-wide, chosen by the
bench already planned for the bot's voice gallery. No new model. A guest's voice is never enrolled or
matched (enrollment rules in `biometricPrints.ts`); an unmatched voice is an `unknown` entry.

### 4.3 Presence and people counting

Reuse: SFace face prints and the bot's gallery; the Stack Look person detector (COCO class, a count only);
Home Assistant occupancy, motion and `device_tracker` entities. No new vision model. R3 holds everywhere:
the scene names a person only from an enrolled match or the person's own words, never from how they look.

## 5. Proactive behaviour and the privacy promise

### 5.1 Three tiers of events

| Tier | Events | What happens | Path |
|---|---|---|---|
| E, emergency | the existing HA smoke, CO, gas, leak and alarm panel sensors today; the smoke or CO alarm sound and glass breaking join only after decision 17's month of measurement (under one false emergency per device per month) and his yes then | deterministic, no model: `safetyAlarm.ts` gains sound sources with the same 10 s debounce and acknowledge, quiet-here and false-alarm actions; every robot and open client speaks the existing fixed reviewed clip; Notification `safety.alarm` (immediate, overrides quiet hours as today) to every adult, present or away; any person may dismiss the alert directed at them, for themselves only (their own notification, the spoken alert on their own device); a confirmed adult present, or the owning person when a confirmed adult, may dismiss it for the household ("I got it", "that's just a movie") through the deterministic `acknowledge` path, which quiets that event and its kind for 15 minutes and sends one passive "dismissed at home" update to the adults already notified; it re-alerts once if the same kind escalates past the margin in 14.5 | S6 Notifications and the robot's alarm clip; nothing leaves the house (no call, no text, no outside service) |
| N, notable | doorbell, door knock, baby crying over 30 s, dog barking over 60 s, a door opened while everyone is away (HA) | one scene observation; on a robot whose person allows `person.robot.may_address`, an INITIATIVE-01 offer ("Someone is at the door. Want me to say who, if I can?") through the existing queue: quiet hours hold it, at most 1 per event kind per 10 min and 6 per day, backoff after 2 ignored; for an adult who is away, Notification `house.sound_event` (passive, held through quiet hours) | existing offer queue and Notifications; no new banner, toast or poll |
| A, ambient | music or TV, water running, appliance beep, cat, light, temperature | context only; never speaks or notifies | the scene block |

A proactive turn runs as the owning person with write and physical tools excluded (assistant-layer
design, slice 11). The listener on a robot or shared screen is an unknown speaker at the child band.
A child's robot gets Tier E clips only, never an offer; a teen's offers follow their own
`may_address` setting (admins never reach a teen's settings); a guest's device gets nothing.

### 5.2 RULES.md section for SCENE-02 (owner-approved 2026-11-13 as written; the RULES.md edit lands later with its `Owner-approved: 2026-11-13` line and nothing is turned on until SCENE-02c)

> ## Ambient sensing
>
> Record: scene awareness (this note). Governs: backend/src/lib/scene.ts, backend/src/lib/hear.ts,
> backend/src/routes/devices.ts (`/me/scene`), frontend/src/lib/ambient/**, the Stack `hear` component,
> and (PROPOSED addition, question 28, the architect's recommendation) backend/src/lib/safetyAlarm.ts
> and backend/src/lib/sceneSuppression.ts.
>
> A1. **Sound, light and temperature are classified once and dropped.** A device runs the Stack's pinned
> sound-event model on its own audio, or posts at most 4 seconds of audio to the hub's `hear` component,
> which classifies it and drops it when the call returns. On an iPhone the platform's own on-device
> sound classifier (Apple Sound Recognition) may run beside the Stack's model; its result is mapped to
> the same closed list, handled exactly like the Stack's, and alone never raises an emergency event. Only
> typed events from the closed list reach Home, held in this process's memory for at most 10 minutes,
> one scene per conversation. No audio, transcript, label, class, score or sensor reading is ever
> written to disk, a stored turn, a memory, the summary, the library, a backup, a log, a stat,
> telemetry or a persisted queue. No route returns them; nobody, admin included, can read them or a
> history (there is none). Logs carry counts and timings only, never a class. The one exception is the
> dismissal state of A3: the kind being ignored, the device, its expiry and a count, held in this
> process's memory only, cleared by a restart back to normal alerting, never written to disk, and shown
> on the robot card and the Status page as what is being ignored until when, so it can be undone. No
> new outbound connection exists for this: the model is a pinned Stack download.
>
> A2. **An admin enables it per device, and the person sees it.** Robots and hub devices (pods, a
> kiosk) carry `device.ambient` with `continual`, `on_demand` (only during a turn) and `none`, the
> default for every device, robots included (SOUND-EVENTS-01, OWNER-ANSWERS 5); an admin turns a robot
> or a hub device on, per device, and the owner has one household switch that turns every device off.
> Browser and phone listening follows the wake-word invariants: off by default, an adult turns it on for
> their own device, the listening indicator with its one-step Turn off shows on every page while the
> microphone is open, and a hidden tab stops it. A guest or a minor never enables it, and a child's own
> device never runs it. Audio from a device is never used to identify a person it is not enrolled to
> recognise.
>
> A3. **An event is context, never a claim, and speaks only through the existing paths.** Events ride
> into a turn as labelled background data with their age. An emergency event takes the deterministic
> safety-alarm path and its fixed reviewed clip; a notable event may become a robot offer under
> INITIATIVE-01's gates and a Notification for an adult who is away; anything else never speaks or
> notifies. *(PROPOSED revision of the next three sentences, ruling 27 of 2026-11-13, question 28;
> the approved wording of question 26 is quoted under question 28.)* Dismissal follows whom the alert
> is for (owner's ruling, 2026-11-13, "anyone may dismiss alerts to themselves"): any person of any age
> may dismiss an alert directed at them (their own notification, the spoken alert on their own device,
> their own card), which stops it for them only; a dismissal that holds a sound kind quiet for a device,
> a room or the household, and any dismissal of a real sensor alarm for others, is a confirmed adult's or
> the owning adult's; a child's or an unconfirmed speaker's "ignore that" therefore silences their own
> alert while the alarm and every other person's alert continue. The dismissal covers that event and
> its kind for a set, visible time, never a different kind; a real sensor alarm (smoke, CO, gas, water
> leak, temperature and the like from Home Assistant or other hardware) is dismissed for 15 minutes
> whatever the reason given, a heard sound for the time its reason sets; Home confirms aloud what it
> dismissed and for whom; the same kind that persists or escalates past the stated margin re-alerts
> once with a short line and can be dismissed again; every dismissal is undoable and logged as a count.
> No model code reaches the safety-alarm module: a sensor alarm is dismissed only through the existing
> deterministic actions (`acknowledge` for the household by a confirmed adult or the signed-in adult;
> `quiet_here` for a person's own device at any age) with the turn's own speaker evidence or the
> signed-in person, never a model argument, and only while that alarm is sounding; marking an alarm
> false stays an admin's action. A proactive turn runs as the owning person without write or physical
> tools; its listener on a robot or shared surface is an unknown speaker at the child band.
>
> A4. **A device turn still carries no audio.** The turn route accepts no sound; events reach the model
> only as the scene block.

**Question 28 (OPEN): where A3 and the Governs line now differ from the text Jesse approved in
question 26, plainly.** The approved A3 said: "Any confirmed adult present, or the owning person when
a confirmed adult, may dismiss any event, an alarm included; a child's, a teen's or an unconfirmed
speaker's dismissal is a ten-minute courtesy hold on the robot's own line, and the alarm continues."
It now says, from his ruling 27: (a) any person of any age may dismiss an alert directed at them, for
themselves only; (b) a hold on a kind for a device, room or household, and a sensor-alarm dismissal
for others, stays with a confirmed adult or the owning adult; (c) a child's or unconfirmed speaker's
"ignore that" silences their own alert while the alarm and the others' alerts continue (the courtesy
hold and the ask-a-grown-up line are gone, teens are not mentioned); (d) "Home confirms aloud what it
dismissed" gains "and for whom"; (e) the deterministic-path sentence names `acknowledge` as the
household action and `quiet_here` as the own-device action at any age, because the shipped
`applyAlarmAction` refuses `quiet_here` to a non-adult today and (a) needs it for a child's own robot;
(f) the Governs line gains `backend/src/lib/safetyAlarm.ts` and `backend/src/lib/sceneSuppression.ts`
(the architect's recommendation, since A3 binds both). Everything else in A1 to A4 is the approved
text. Recommend: approve all six; (e) is the one that changes shipped code and lands inside DISMISS-01's
risky-surface review.

**What changed between the first approval and question 26 (approved 2026-11-13; kept for the
record), each change in plain words:**

1. **A1, Apple.** Added: on an iPhone, Apple's own on-device sound classifier may run beside ours, mapped
   to the same list, handled the same way, never an emergency on its own. Why keep it rather than drop
   it: he ruled for it (decision 8), it is on-device, no audio leaves the phone, and it costs nothing;
   without this sentence A1 forbids it.
2. **A1, the dismissal state.** Added the one exception: the kind being ignored, the device, the expiry
   and a count live in memory only, a restart clears them back to normal alerting, nothing is written to
   disk, and the robot card and Status page show what is ignored until when. This is the least that
   works: without it a dismissal cannot be undone or seen, and the earlier design's settings row
   (`scene.suppressions`) is dropped, as is any log line that names a class.
3. **A2, robot default.** Changed from "continual by default for a robot with vision on" to off by
   default for every device, robots included, matching SOUND-EVENTS-01 and OWNER-ANSWERS 5; an admin
   turns each on; the owner's household off switch is named in the rule.
4. **A3, owning person.** "Any adult present or the owning person" became "any confirmed adult present,
   or the owning person when a confirmed adult"; a child's or teen's dismissal, or an unconfirmed
   speaker's, was the courtesy hold (decision 23, since superseded by ruling 27 and question 28).
5. **A3, safety conditions.** Added: no model code reaches the safety-alarm module; a sensor alarm is
   dismissed only through the existing deterministic actions with the turn's own speaker evidence or
   the signed-in adult, never a model argument, only while the alarm sounds; marking it false stays
   admin-only. Decision 24's 15 minutes fits as an extension of `acknowledge` (question 25).

### 5.3 Consent and visibility, reused

- The privacy page gains rows in the same commit as each slice: `platform:scene-hear` (what the hub
  classifies and drops), `platform:scene-device` (what a device posts: events, not audio), and
  `platform:home-assistant-events` is reworded to list the sensor domains now read.
- Status: the Engines page row for the `hear` component (not installed, installed, ready) through
  `lib/statusApps.ts`; a Repairs item when it keeps failing; the chat composer line when a device's
  ambient classifier is on but the component is down. No new surface.
- Minors and guests (decision 3): a robot in continual mode keeps classifying when a guest or child
  walks in (the classifier holds no words and names nobody); speaker matching never runs on a voice
  that is not enrolled; nothing about a guest is stored; a child's own device never runs it.
- Who enables (decision 4, A2 as revised): off by default on every device, robots included
  (SOUND-EVENTS-01); an admin turns a robot or hub device on, per device; the owner has one household
  off switch in Settings, Privacy that stops every device's ambient listening at once, shown on the
  privacy page beside the rows above.

## 6. Context cost

- 320 tokens for the scene block, engine-counted; the trace records `scene_tokens`.
- The tool's description is about 120 tokens in the tools block; it is part of the prefix only on
  surfaces where it is always offered (spoken and shared), so there it is cache-stable; on written
  turns it joins the conditional set the way `voiceover` does, and `promptPrefix.ts` shows whether
  the tools part changed between turns (first_diff "tools"), which SCENE-01e checks on 20 consecutive
  turns and records.
- A robot's offered set is small (the Pi budget), so the tool is offered there only when
  `budget.rounds > 0`, as every tool is.

## 7. Phased build plan

Sizes: S under a day, M one to three days, L more. Every row carries a test that can fail.

| ID | Size | Files | Acceptance test (can fail) | Bench rows | What the AI can do after it that it cannot today |
|---|---|---|---|---|---|
| SCENE-01a: spec shapes | S | `commons/spec/schemas/scene-observation.schema.json`, `scene.schema.json`; `scripts/pin.sh` bump | schema validation tests for every kind; a bot fixture `present` list parses into observations | none | nothing yet; the shape exists once for Home, bot and Go |
| SCENE-01b: fusion, store, render, gate | M | `backend/src/lib/scene.ts` (new), `turnContext.ts` (`sensitiveAllowed` takes the scene), `turnMachine/nodes/context.ts` (the `scene` item), `turnMachine/turnNext.ts` (feeds robot `present`, `speaker_evidence`, look count, GPS, device address), `turnMachine/trace.ts` (counts) | `fuseScene` unit tests for rules 1 to 6 and every TTL; `sensitiveAllowed` tests per surface in both directions (never looser); a render test that the block is under 320 tokens and the system prefix is byte-identical across two turns; a test that a temporary conversation's scene is gone after it ends; a log test that no name, label or room appears | CHAT-AB-01 `scene-01.json` (24 items: not alone withholds, child present wording, robot two-person) | knows it is not alone on a robot from faces and voices and stays discreet; knows a child is nearby and is told so |
| SCENE-01c: the scene tool | M | `backend/packages/scene/` (manifest, recipe), `toolGates.ts`, `budget.ts` order, `elementBindings.ts` (no UI), bench dataset | the tool adds and removes typed people and places and never touches the speaker, memory owner or acting account (test); a child actor cannot remove a household adult; offered count on a plain adult written turn recorded before and after, at most 16 | `scene-01.json` gains 20 typed items (arrive, leave, pet, not aimed at me); false-call and missed-call rates with 3 repeats | tracks "I'm here with Bruno", "he left", "Fluffy says hi", engages Bruno, stays quiet on lines not aimed at it |
| SCENE-01d: where | S | `routes/turn.ts` (GPS already parsed; passes a `place` observation), `places.ts` (`home` vs `away` from the household home within 1 km), devices settings (a robot's or hub device's room, kit settings shell, S4), `house/registry.ts` (areas) | GPS never appears in a tool argument, stored turn, trace or log (test); home vs away rounding test; a robot with a room renders it, without one renders nothing | 8 weather-style items with a place | answers "is it cold out" and "what's near me" knowing home vs away without asking; knows which room the robot is in |
| SCENE-01e: prefix and cost proof | S | `scripts/bench/` prefix check, trace fields | 20 consecutive turns show `first_diff` after the system message; `scene_tokens` at most 320 on every row | the prefix row in CHAT-AB-01's report | nothing new; proves rule 4 |
| SCENE-01f: Home Assistant cues, soft, and a tracker is the person's own | S | `house/registry.ts` template (add `binary_sensor`, `sensor`, `device_tracker`, `person`), `scene.ts` subscription through `subscribeHomeAssistantEntities`, fusion rule 7, the person-scope setting `scene.ha_person_entity` (kit settings shell, S4), privacy row reword | a fake `state_changed` for an occupancy entity adds an `unknown` weak entry with the area and expires with the entity; the actor's own linked tracker at `home` adds "you are probably home" to their place line and no presence entry; at `away` it adds nothing and never makes `alone` true; a second person's tracker changing state changes nothing in the rendered block, the trace or the evidence list (the PRIVACY.md test); a turn with no linked entity reads no tracker at all; an `unavailable` or 30-min-stale entity is ignored; a connector outage drops every HA cue; a person's own switch, where one exists, is honoured; no household opt-in gate exists (decision 6) | none | uses what Home Assistant already knows (room occupancy, lux, temperature, and the speaker's own phone home or away) as low-confidence cues, with no new hardware (decision 5) |
| SCENE-01g: a body without a face counts (bot) | S (bot) | `bot/body/maipai_body/speaker_fusion.py` `build_present`, `vision/watch.py` (person boxes from `look_fast.py`) | a fixture frame with one torso and no face yields one `unknown` present entry; a face track and its own person box yield one entry, not two | bot presence M-row | the robot knows it is not alone when someone stands with their back to it |
| SCENE-01h: "who am I" | S | `context.ts` speaker line (names only through the roster and `greet_by_name`), bench dataset | the 14 rows of section 11 as fixtures: the speaker line matches the evidence exactly, no name below `confirmed` or `signed_in`, no candidates on a tie, nothing learned on the spot | `scene-01.json` who-am-i rows, 3 repeats, every band | answers "who am I" honestly at every confidence level |
| MOVE-SCENE-01: motion in the spec and the scene (hub) | S | `commons/spec` `robot-state.schema.json` (`motion` enum widened additively: `lifted`, `carried`, `set_down`, `shaken`, `tilted`, `tapped`, `falling`, `bumped`, `rolling`; `pose`), `scene-observation.schema.json`; `lib/scene.ts` (motion kind, room reset, the nearby-person entry), `lib/deviceStates.ts` (feeds the scene from the state frame), `context.ts` (one motion line) | a `held` frame yields a `lifted` observation and sets `place.room` to unknown; a `set_down` frame adds nothing to the room until a cue; a `lifted` frame with no confirmed person present adds one `unknown` nearby entry that expires in 60 s; an old producer sending `resting`/`held` still parses; logs hold counts only | `scene-01.json` gains 8 motion items (you just picked me up; I am on my side; was I moved?) | the AI knows it was picked up, carried, set down, shaken or tipped, and that its room is now unknown |
| MOVE-SCENE-02: the StackChan classifies its own motion (bot, firmware patch) | M (bot) | StackChan firmware IMU task (one patch in the 078/081 line: a `motion` event from the 100 Hz BMI270 read), `bodies/stackchan/companion.py` (`EVENT_KINDS` gains `motion`), `bodies/stackchan/orientation.py` (poses reused), the state frame producer (`motion`, `put_down_count`), `docs/dev/measure-runbook.md` rows | fail-first on scripted IMU fixtures: a bump is never `carried`; a carry is never `falling`; `set_down` only after `lifted` or `carried`; a 150 ms free fall reads `falling`; a tap never reads `shaken`; events are at least 200 ms apart and at most 5 a second; the host maps every event to one observation and nothing else changes | a unit row: 20 real lifts, carries, set-downs and shakes on the bench unit, miss and false rates recorded before thresholds are trusted | the StackChan knows it is in someone's hands without the hub |
| MOVE-SCENE-03: hold still while held, settle on set-down (bot) | S (bot) | Reachy: already built (MOVE-CARRY-01b `held` suppression); StackChan: `bodies/stackchan/adapter.py` head driver (`stop` on `lifted`, no head target while `carried` or `shaken`, one `settle` on `set_down`), `safety` order unchanged | while `lifted` or `carried` no head command is sent (test on the fake); `falling` sends `stop` first; after `set_down` the head resumes after 2 s; the hard-stop order on the Pi build is untouched (test pins it) | none | the robot does not move its head in your hands and does not fight a fall |
| MOVE-SCENE-04: what it says and when (hub and bot) | S | `robotOffers.ts` (motion offers under the existing gates), `robotClips` carry line (exists, rule 6 fixed clip), `settings` `robot.motion.carry_reaction` (exists on Reachy; add to the StackChan keys), bench dataset | the fixed carry line plays at most once per lift and never with a child, teen or unknown present (existing test, re-pointed to the StackChan); a model-written reaction runs only as an INITIATIVE-01 offer, never in quiet hours, at most 1 per 10 min and 4 per hour; a child-owned robot gets a face reaction and no line; a shaken robot on a child band never scolds (bench) | `scene-01.json` motion rows at every band, 3 repeats | reacts to being handled in character, without nagging, and never at a child |
| MOVE-SCENE-05: re-check who is near after handling (bot) | S (bot) | `run_loop.py` (`set_down` triggers the 0.2.59 face search and a voice re-check on the next speech), `orientation.py` `SENSOR_SETTLE_S` extended to carries | after `set_down` the face search runs once within 5 s; light and camera readings are ignored for 30 s after a carry (existing settle); `present` is rebuilt from fresh tracks, old tracks dropped | bot presence M-row | after being moved the robot looks again for who is there instead of trusting a stale track |
| MOVE-SCENE-06: phone motion cue (web, later) | S | `frontend/src/lib/ambient/deviceMotion.ts` (DeviceMotion at 60 Hz, `face_down` and `in_hand` only, iPhone permission from a user gesture), setting `ui.motion_cues` off by default, adult only | no event without the setting; `face_down` for 3 s marks the spoken session quiet; the permission prompt opens only from the switch | none | a phone laid face down tells a voice session to go quiet |
| SELF-SCENE-01: self-state in the spec and the scene (hub) | S | `commons/spec` `robot-state.schema.json` (additive: `battery_level`, `charging`, `docked`, `thermal`, `link`, `fault[]`, `update_pending`, `sleeping`), `scene-observation.schema.json` (`self_state` kind), `lib/scene.ts`, `lib/deviceStates.ts`, `context.ts` (one self line) | a frame at 9 percent and not charging renders "battery nearly empty, needs the charger"; the same at 23 percent renders nothing; a `fault: camera` renders "camera not working"; a frame older than 45 s renders "last known"; a child-band turn gets the child wording from the fixed pool, never a percentage; logs hold counts only | `scene-01.json` 8 self-state items ("how are you doing", "do you need charging") | the AI answers "how are you" about its body honestly |
| SELF-SCENE-02: the battery and heat ladder (bot) | M (bot) | `presence/power.py` (new; reads `get_battery_status` on the StackChan, the UPS on the Pi), `run_loop.py` (degrade order), clips (child and adult pools), `settings_keys.py` (`robot.power.warn_at`, default 20) | fail-first on scripted battery curves: warn once per discharge at 20 with 3-point hysteresis; degrade at 15 (head, look, breathe off, screen dim); ask to be docked once at 10; at 5 the goodbye grace, safe pose, sleep; charging clears every state and resets the once-per-cycle counters; no line in quiet hours except the 5 percent goodbye; thermal 70/76/82 with 3 C hysteresis stops motion at critical | a unit row: one full discharge on the bench unit, every rung observed | the robot never dies silently and asks for its charger at the right times |
| SELF-SCENE-03: the fall path (bot and hub) | S | `presence/motion_state.py` (`falling` then a non-upright pose = `fallen`), clips, `routes/devices.ts` state frame, `notificationTypes.ts` (`robot.fallen`, `robot.battery_low`, `robot.needs_dock`), `robotOfflineWatch.ts` pattern for once-only | a fall sends `stop`, plays the safety clip, speaks the help line once only if someone is present (child wording when a child is present), raises `robot.fallen` once to adults; upright again clears it and thanks once; a second fall inside 10 min raises nothing new; no outbound request of any kind (test asserts no fetch) | `scene-01.json` fall rows at every band | "I fell over, can someone stand me up?" reaches the room and the adults, and nothing else |
| SELF-SCENE-04: faults, link and updates through the existing surfaces (hub) | S | `lib/statusApps.ts`, `lib/statusBoard.ts` (robot row states), Repairs via `lib/issues.ts` (stuck servo rung 4 exists; camera or mic self-test failure), `robotSoftware.ts` (update pending already a card state), robot card | a failed self-test part raises one Repairs item and the robot card line; a link that is `reconnecting` shows on the card within one poll; `update_available` shows on the card and never speaks; no new banner, toast or poll (lint and review) | none | admins see every robot fault where they already look |
| DISMISS-01: dismissals and context states (hub). **Risky surface** (it touches the alarm audience, a child gate): full `check.sh` under the machine lock, `code-review` medium, architect verdict on its staged diff. Carries decision 25 (`acknowledge` also holds that sensor kind quiet 15 min via the deterministic speaker check, superseding SAFETY-ALARM-01's "an adult's acknowledgement ends it") and ruling 27 (dismissal by whom the alert is for; `quiet_here` for the device's own person at any age) | M | `commons/spec` `scene-observation.schema.json` (`context_state` kind with `scope`), `backend/packages/scene` (actions `dismiss`, `resume`, `party`), `lib/sceneSuppression.ts` (new: the in-memory table, durations, ceiling, the escalation margin; imports no model, turn, TTS or package-host code), `lib/scene.ts` and the scene package (write it for heard sounds only), `lib/safetyAlarm.ts` (imports it; `acknowledge` gains the 15-minute hold and the re-alert; `false_alarm` unchanged, admin-only), `turnMachine/nodes/policy.ts` (maps a `dismiss` on an active sensor alarm to `acknowledge` with the turn's actor and speaker evidence), `notificationTypes.ts` (`safety.alarm_dismissed`, passive); no settings row, nothing on disk | fail-first: "that's just a movie" (as a tool call from the model, never matched by code) suppresses `glass_breaking` on that device for 1 h and the tool result says so; "I got it" on a heard smoke-alarm sound quiets its offers and notifications for 30 min and a `co_alarm` ten seconds later still offers (a different kind is never silenced); "I got it" on an active HA smoke sensor alarm reaches `applyAlarmAction` with the turn's actor and never a model argument (a test passes a forged kind, device and duration and sees them ignored), the clip stops, the adults already notified get one passive update, the same sensor raises no new alarm for 15 min and re-alerts when a second sensor agrees or it is still on at the end of the hold; the same call with no active alarm is refused; `false_alarm` is unreachable from the tool (a test); a grep test keeps `safetyAlarm.ts` free of model, turn, TTS and package-host imports through `sceneSuppression.ts`; a hub restart clears every dismissal (a test); no file or settings row ever holds a class (a test greps the data directory after a dismissal); a second dismissal inside the window extends to 2 h, then 4, never past 8 (heard emergency sounds: 30 min, 1 h, 2 h, ceiling 4 h; a media reason on a heard sound: until playback ends or 3 h, 6 h, ceiling 8 h); a real HA sensor alarm is covered 15 min whatever the reason, "it's just a movie" included, another 15 on a repeat, never past 1 h (decision 24); the same kind re-alerts once with the short line when it escalates past the margin (louder by 6 dB, still sounding after 60 s, a second device or room, a second sensor agreeing, or a certified HA smoke or CO device after a sound-only dismissal) and can be dismissed again; a child's or an unconfirmed speaker's "ignore that" on a sounding sensor alarm quiets that device only (`quiet_here` through the policy node, with the turn's own evidence), the alarm state, the other devices and every adult's notification continue, and the tool result says "for you only" (ruling 27); the same person asking for a device, room or household hold gets the self dismissal and no hold (a test reads the table after the call); a person's own notification is marked dismissed for them and nobody else's changes; `resume` clears at once; expiry is silent; the audit holds one count per day and no kind, words or who; a temporary chat's dismissal still lives household-wide (it is about the house, not the chat) | `scene-02.json` 16 dismissal rows (dismiss a notable kind, dismiss a heard alarm sound, dismiss a sensor alarm through the relay, the spoken confirmation grounded on the result, re-alert on escalation, resume, self-only for a child) plus a row counting unasked `dismiss` calls on emergency kinds across the whole set, target zero | "no, that's just a movie" and "I got it" are understood, confirmed aloud and honoured for the set time |
| DISMISS-02: automatic context states (hub) | S | `lib/scene.ts` fed by the music, radio, podcast and video players' playback state, the voice session (`call_in_progress`), quiet hours, the away state from SCENE-01f, the Go client's playback | playback on a device raises `media_playing` for that device and room until 2 min after it stops; `music_or_tv` is suppressed and `glass_breaking` and `shouting` need the raised threshold there; a call suppresses offers on that device; away turns notable events into notifications only; the emergency tier is untouched by every automatic state | `scene-02.json` 6 auto-state rows | the hub does not report its own movie as a break-in |
| DISMISS-03: status and undo (hub) | S | robot card (`deviceStates.ts` state), Status page robot row (`statusApps.ts`), the scene tool's `resume` | the card and the Status row say "Ignoring glass sounds until 9:40 pm"; a Resume control on the card clears it (owner, admin, or the person who set it); no new surface | none | you can see and undo what it is ignoring |
| DISMISS-04: the robot does it without the hub (bot) | S (bot) | `hear/` suppression table (kind, until) set from the turn's `commands` (`scene_state`), rung 1's closed command list gains "ignore that sound" (fixed reply "Okay, for an hour"), `link/` offline behaviour | with the hub down, the offline command suppresses the last heard kind for 1 h and the table expires on its own; a hub-sent `scene_state` replaces the local one; nothing is written to disk | bot rung 1 false-accept row | a robot alone still stops nagging about the TV |
| VOICE-MATCH-01: "sounds like you" on browser and phone voice sessions (SCENE-01, its own row) | M | `backend/src/lib/biometricPrints.ts` (`KNOWN_MODELS` gains the voice model: the one speaker-embedding model the bot's gallery uses, id and sha256 pinned; `modality: "voice"` already exists in the record), a voice enrollment capture in `frontend/src/apps/people/` (one read sentence of 6 to 30 s, hub-owned like FACE-01), the Stack `stt` worker's embedding call (the diarization embedding already installed), `turnMachine/turnNext.ts` (voice evidence on chat and phone spoken turns), person setting `person.voice.match` | consent scope exactly `biometricPrints.ts`'s: an adult enrols themself; a child never consents for themself (a parent enrols); a teen's consent comes from the teen; a guest is never eligible; a new enrollment replaces the old set; the print is encrypted at rest and compared only server-side. Matching on a private screen is a yes-or-no against the signed-in person's own prints only, never a search over the household (a test: a second person's print is never loaded for a chat or phone turn); agree gives `speaker_evidence` `signed_in` plus `voice` `confirmed`; disagree keeps the session's account and memory owner and withholds sensitive records (tighten-only test); no match data is stored, logged or shown; the setting off skips the call | `scene-01.json` who-am-i rows 11 and 12 | "who am I" on a phone can say "signed in as Sage and it sounds like you", and a stranger on Sage's open phone gets no sensitive memory |
| CLIPS-SCENE-01: the new fixed lines, reviewed and listed (rule 6) | S (bot and hub) | `bot/body/maipai_body/clips/` (child and adult pools: fall help, fall thanks, battery warn, dock ask, goodbye, carry confirmation, dismissal confirmation "Okay, for an hour", the re-alert line, the for-you-only line), `backend/src/lib/privacy.ts` (a new row `platform:robot-fixed-lines` listing every fixed clip and when it plays; the alarm, carry and pairing lines join it) | every new line is reviewed by a person against the child floor when written and the review is recorded in the clip manifest (a test fails on a clip without a review line); the child pool carries no percentage, "fault", "critical" or "error"; the privacy page lists every clip (a test compares the manifest with the row); a clip is never a reply (rule 6) and is never stored as one | none | the robot's fixed words are known, reviewed and listed where the household can read them |
| SCENE-01i: the weather cue from the caller's own place | M | `lib/scene.ts` (`WeatherCue`, the per-conversation cache keyed by the rounded point, TTLs, the move rule), `turnMachine/nodes/context.ts` (the weather lines inside the scene block, drop order), `routes/turn.ts` (the existing `current_location` feeds the cue), `lib/places.ts` (`resolveWeatherPlace` reused as is; an optional `device.weather_place` for a fixed device), the weather recipe (optional additive `minutely_15` precipitation), the scene tool's `place` action (`outside`, `inside`) | fail-first: a browser turn with a granted rounded position renders "Weather here: 41 F, light rain, wind 12 mph (checked 4 minutes ago)" and no coordinate (a test greps the block, the trace and the log for the digits of the point); a child's turn uses the 1-decimal point; a robot with no position renders the household home's weather and names no place beyond "here"; a turn that names a place runs the weather tool and the scene line is unchanged; `outside` plus rain plus under 45 F renders "The person said they are outside" beside the weather so the model can mention a coat (bench); `inside` renders the weather as background only; a fetch that fails renders no weather line and no error (the model is told nothing); a cue older than 30 min is dropped before render; a 2 km move refetches, a 500 m move does not; the weather lines fit inside the 320-token block and drop right after the ambient events; counts only in the log; a temporary chat's cue dies with it | `scene-01.json` gains 10 weather items (coat outside in rain, nothing volunteered inside, a named place goes to the tool, no position makes no local claim, a child's rounding, the alert when asked "anything I should know") | knows it is raining and cold where the person actually is, and says "take a coat" only when they are heading out |
| SCENE-01j: severe weather alerts for the caller's place | S | `lib/weatherAlerts.ts` (`weatherAlerts(lat, lon)` reused as is for the caller's point; the hourly home check kept), the weather manifest (`weather.alerts` default becomes true when the household home is in the US, decision 31, a shipped default change; an admin can turn it off; the privacy row text follows), `lib/scene.ts` (`weather_alert` observation, 5 min TTL, never past `ends`), `notifications.ts` and the weather manifest (`weather.alert` reused, `repeatKey` the alert id, so a caller-place alert and the home alert for the same id notify once), bot `clips/` (a rung-2 template line "A {event} is in effect here until {ends}", child and adult pools, CLIPS-SCENE-01), `robotOffers.ts` gates for the spoken line | fail-first: an `extreme` or `severe` alert for the caller's point raises `weather.alert` to the household once per alert id and renders one alert line; a `moderate` or `minor` alert renders the line and raises nothing; the robot speaks the template line once per alert id for `severe` and `extreme` only, held by quiet hours except `extreme`, which overrides them like the safety alarm (decision 32), never a second time for the same id, and never on a child's robot except the child-pool line for `extreme`; a dismissal follows ruling 27 (self for anyone; a household hold on that alert id until its `ends` for a confirmed adult), is not the 15-minute sensor rule (decision 30), and re-alerts once when NWS raises the severity or a new higher-severity id arrives; outside the US bounding box nothing is requested and nothing renders; NWS paced at one request per 300 s with the 1 h backoff, as built; a fresh household with a US home has `weather.alerts` on and one with a home outside the US off, and an admin's off stays off across restarts (decision 31); no coordinate in the notification, the line, the trace or the log | `scene-01.json` 4 alert rows (mention when asked, do not repeat, dismissed, upgraded) | warns the household about a tornado warning where they are, once, and stops when told |
| SCENE-01k: the caller's alerts on the Weather app page and the weather card | S | `frontend/src/shell/pages/PackageAppPage.tsx` (the Weather app page from the catalog `weather` package, the kit `WeatherForecastPage` alert banner prop from WEATHER-PORT-07), `frontend/src/lib/elementBindings.ts` (`weather_card` alert prop in chat), `lib/scene.ts` (the `weather_alert` observation is the one source: the same alert ids and the same `weatherAlerts.ts` cache the notification path uses, no second fetch), `GET /api/scene/alerts` (the caller's active alerts with their dismissal state, read from the same in-memory table as DISMISS-03), the kit banner's severity variant by tokens only (rule 9: no `className`, no wrapper; a missing variant is a `commons` prop first) | fail-first: with an active `severe` alert for the caller's place the Weather app page and the chat `weather_card` show the kit banner with the `severe` variant and the same alert id the notification carried (a test compares the three ids and asserts one `weatherAlerts` call); a self dismissal shows "dismissed for you" and keeps the banner for another person; a household hold by a confirmed adult shows "dismissed for the household until 6 pm" with the kit Resume control that clears it (ruling 27 scopes); a `minor` alert shows the `info` variant and no dismiss state; expiry removes the banner without a reload; the lints find no `className` on the kit Element and no wrapper; previews at 1440 and 390 in both themes opened and judged | `scene-01.json` 2 banner rows | the tornado warning the hub spoke about is also on the Weather page and the card, with its dismissal state, and nothing is fetched twice |
| SCENE-02a: the rule | rule | `docs/design/RULES.md` (Owner-approved line), this note's 5.2 | architect verdict APPROVED on the resubmitted SCENE-02 | none | unblocks the rest |
| SCENE-02b: Stack `hear` component | M (stack) | `stack/backend/src/speech/` (sherpa-onnx AudioTagging), `POST /v1/audio/events`, model pin with sha256, `/stack/v1/privacy` row, Engines row, wizard row | 12 fixture clips (hand-written or synthesised, never a capture of a live service) classify to the right class; a clip of speech returns nothing; logs hold counts only; memory admission measured | `SCENE-SOUND-BENCH-01`: per-class precision and recall on 120 held-out clips, thresholds chosen from it | nothing visible yet |
| SCENE-02c: Home events and switches | M | `lib/hear.ts` (device event intake, expiry), `routes/devices.ts` `POST /api/devices/me/scene` (events only, device session), `settings` keys `device.ambient`, `ui.ambient_listening`, `frontend/src/lib/ambient/` (onnxruntime-web classifier, `LauncherBubble` listening), privacy rows | route refuses audio bodies and non-list classes; a child's device cannot turn it on; the indicator renders on every page while open (S3-style test at 360 and 1440); events expire | `scene-02.json` 12 items (heard a doorbell, ignore the TV) | hears the doorbell, the dog, a crying baby, and mentions them when relevant |
| SCENE-02d: the robot hears, which is SOUND-EVENTS-01 | M (bot, the existing row, scheduled) | `bot/body/maipai_body/hear/` (the sherpa-onnx tagger at 1 Hz, the shared `sound-events.json` list), per-robot switch off by default, posts `sound_event` observations to `/me/scene` | SOUND-EVENTS-01's own fail-first tests kept: the alarm module has no import path to this module; a `smoke_alarm` label creates at most an offer; plus: the body's fakes and the hardware run agree; a robot with no hub still builds its own scene (principle 2) | bot M-row for CPU cost on the CM4 at 1 Hz; `SCENE-SOUND-BENCH-01` false-alarm rate per device per week | the robot hears a doorbell or a crying baby on its own and offers, never alarms (until question 17 is answered) |
| SCENE-02e: proactive paths (hints only, decision 17) | M | `robotOffers.ts` (event offers, limits), `notificationTypes.ts` (`house.sound_event`), tests; `safetyAlarm.ts` untouched by sound | a heard glass-break or smoke-alarm sound raises an offer and the `house.sound_event` notification and never the alarm path (the SOUND-EVENTS-01 no-import test stays); a doorbell at 2 am is held; the 7th doorbell offer in a day is dropped; a child's robot never receives an offer; a proactive turn's offered set has no write or physical tool | `scene-02.json` proactive rows; `SCENE-SOUND-BENCH-01` running for the month | offers help at the door; keeps quiet at night; tells an adult who is away that it heard glass |
| SCENE-02g: two sound classes join the alarm path (after the measured month and his yes) | S | `safetyAlarm.ts` (sound sources `smoke_alarm`, `glass_breaking` with the same 10 s debounce), the no-import test replaced by an allow-list test for exactly those two classes | gated on `SCENE-SOUND-BENCH-01` showing under one false emergency per device per month and Jesse's yes then (decision 17); a heard smoke-alarm sound then raises the alarm path and the immediate notification through quiet hours; every other class still cannot reach the alarm module (test) | the bench's monthly row | speaks up on an emergency it heard, not only one a sensor reported |
| SCENE-02f: light, temperature, air | S | `house/registry.ts` (`sensor` domain with device_class), bot BODY-09 bridge when fitted, scene buckets | buckets from fixture states; nothing rendered when no sensor exists | none | knows it is dark, cold or stuffy in the room |

Not planned here: wearables and health data; calendar (its own connector row); a continual browser
camera; any network scan by Home itself; Go client slices until Go exists.

## 8. Decisions and open questions

Every question below is answered. Jesse ruled on 2, 3, 4, 5, 6, 7, 8, 11, 12, 17, 18, 19, 20, 21, 22
and 23 on 2026-11-13; 1 was ruled earlier the same day; 9, 10, 13, 14, 15 and 16 are decided here on
the recommendations as instructed. Nothing waits on him for SCENE-01 or SCENE-02 except the RULES.md
edit itself (decision 2) and the yes after the measured month (decision 17).

| # | Topic | Decision (2026-11-13) | Where it lands |
|---|---|---|---|
| 1 | A child present and an adult's gate | CLOSED, ruled: the model is told only; rule 10 and the adult's gate are unchanged | 2.6, `scene-01.json` |
| 2 | Ambient sensing rule A1 to A4 | CLOSED, APPROVED as written; the RULES.md edit lands later with its `Owner-approved: 2026-11-13` line; nothing turned on until SCENE-02c | 5.2, SCENE-02a |
| 3 | Guests or children present and ambient listening | CLOSED, ruled: no pause; never match an unenrolled voice; a child's own device never runs it | 5.3, A2 |
| 4 | Who enables hub-device listening | CLOSED, ruled: an admin per device; the owner has one household off switch in Settings, Privacy | A2, SCENE-02c |
| 5 | Room presence sensors | CLOSED, ruled: none bought; only the robot, browser, phone, Go and the Home Assistant entities that already exist | 1.3, SCENE-01f |
| 6 | Home or away from phones and other HA data | CLOSED, CHANGED: any Home Assistant information is fair to use (`device_tracker`, occupancy, lux, temperature and the rest) as a soft, low-confidence cue with no opt-in gate; a person's own switch, where one exists, is still honoured; never a room, route or history from a phone; absence of a phone is never proof of absence of a person. Architect's condition applied: only the speaker's own linked tracker sets their own place line; another person's home or away never reaches the model (PRIVACY.md) | 1.3, fusion rule 7, SCENE-01f |
| 7 | Outside calls on an alarm | CLOSED, ruled: no outside call or message, ever, for now | 5.1, 13.2, SELF-SCENE-03 |
| 8 | Go: our model or Apple's | CLOSED, CHANGED: both; our pinned model is the baseline on every surface, Apple's Sound Recognition is an enhancing extra cue on iPhone (and Apple TV, see the note in 4.1) through the same label list and record; agreement raises confidence; Apple's alone never makes an emergency-tier event | 4.1, 12.3 |
| 9 | Silent on lines not aimed at it | DECIDED here: no code rule; the model decides from the scene block; a bench row of 20 two-person exchanges, under 10 percent wrong replies, revisited after the first robot week | 2.5, `scene-01.json` |
| 10 | HA temperature and light: which rule | DECIDED here: the connector's privacy row covers them (entity states Home already reads); A1 governs microphones and the robot's own sensors | 5.3, SCENE-02f |
| 11 | Learning a stranger on the spot | CLOSED, ruled: never; the robot says where enrollment lives; a one-conversation claimed name is allowed and opens nothing | 11 |
| 12 | Naming tie candidates | CLOSED, ruled: never; ask for a few more words | 11 |
| 13 | Picked up: fixed line or model words | DECIDED here: the fixed carry line at the lift; the model's own words only on the next turn or as a rate-limited offer | 12.7, MOVE-SCENE-04 |
| 14 | Learning rooms from pictures | DECIDED here: not now (R1 forbids storing anything from a picture); the admin's room setting and a spoken "I brought you to the kitchen" cover it; revisit if the robot moves rooms daily | 12.4 |
| 15 | Phone motion | DECIDED here: build MOVE-SCENE-06 last, off by default, adult only; nothing on Apple TV | 12.3, MOVE-SCENE-06 |
| 16 | A shaken robot and a child | DECIDED here: a face reaction and a settle only at the child band; an adult gets the model's words under the offer limits | 12.7 |
| 17 | Sound tags as a safety input | CLOSED, ruled: hints first; for the first month sound events only offer and notify; measure `SCENE-SOUND-BENCH-01`; promote `smoke_alarm` and `glass_breaking` to the alarm path only under one false emergency per device per month and his yes then | 4.1, 5.1, SCENE-02d |
| 18 | A fall at night | CLOSED, ruled: speak once only if someone is present; adults get a `time_sensitive` notification that respects quiet hours; no outside call | 13.2, SELF-SCENE-03 |
| 19 | Battery rungs | CLOSED, ruled as written: warn 20, degrade 15, ask for the dock 10, sleep 5, 3-point hysteresis, `robot.power.warn_at` the one admin setting | 13.2, SELF-SCENE-02 |
| 20 | Dismissal durations | CLOSED, CHANGED: the duration follows the model-set reason from a closed list (`media`, `handled`, `false_alarm`, `party`, `other`; rule 1, no word matching): `media` lasts until the media session ends when the hub knows the playback, else 3 h, doubling to a ceiling of 8 and extendable; `handled`, `false_alarm` and `other` get the base 30 min (emergency) or 1 h (notable); a party flag 4 h | 14.1, 14.3, 14.5 |
| 21 | Who may dismiss | CLOSED, ruled: any adult present or the owning person may dismiss any event kind, smoke, CO and glass break included, in the safe form of 14.5 | 14.2, 14.5 |
| 22 | Scope of a dismissal | CLOSED, ruled: the device and room that heard it, visible to the whole household on the robot card and the Status page, independent of any conversation | 14.2, 14.6 |
| 23 | A child, unknown, claimed or tentative speaker dismissing | SUPERSEDED by ruling 27 (2026-11-13). Was: a 10-minute courtesy hold plus the ask-a-grown-up line; a teen fully dismisses notable kinds on their own robot | see 27 |
| 25 | How a sensor alarm is dismissed without model code | CLOSED, Jesse's yes 2026-11-13: `acknowledge` is extended to also hold that sensor kind quiet for 15 minutes, through the deterministic speaker check, reached by the alarm card, the bot's alarm keyword path, or the scene tool as a relay the policy node maps with every model argument ignored; `false_alarm` stays admin-only; supersedes SAFETY-ALARM-01's "an adult's acknowledgement ends it"; recorded in DISMISS-01, which lands as a risky surface | 14.2, A3, DISMISS-01, Supersedes |
| 26 | Re-approval of A1 to A4 as revised | CLOSED, approved 2026-11-13 (chat): the five plain-words changes under 5.2; SCENE-02a lands A1 to A4 with "Owner-approved: 2026-11-13 (chat; revised A1 to A4 and question 25)" | 5.2, SCENE-02a |
| 27 | Dismissal by whom the alert is for (replaces the teen question) | CLOSED, ruled 2026-11-13, supersedes ruling 23: "this has nothing to do with teens; anyone may dismiss alerts to themselves." Any person of any age may dismiss an alert directed at them (their own notification, the spoken alert to them, their own device or card), which stops it for them only; a dismissal that holds a sound kind quiet for a device, room or household, and any dismissal of a real sensor alarm for others, stays with a confirmed adult or the owning adult; a child's or unconfirmed speaker's "ignore that" silences their own alert and the alarm and the other adults' alerts continue, with the safe re-alert kept | A3 (proposed), 14.2 to 14.5, DISMISS-01, Supersedes |
| 28 | Re-approval of A3 and the Governs line after ruling 27 | OPEN for Jesse: the six plain-words differences listed under 5.2 ("Question 28"); recommend approve all six | 5.2, SCENE-02a |
| 29 | A phone's position for its own scene (Go app or companion) | CLOSED, ruled 2026-11-13 as recommended: yes; a phone's coarse position feeds its own scene through the existing Current-location opt-in (`weather.default_place = current`), the same rounding (2 decimals, 1 for a child), sent only with a turn, never in the background, memory only, never stored; a child's phone is a parent's choice | 15.1, SCENE-01i |
| 30 | Is an official weather alert a "real sensor alarm" for the 15-minute rule (decision 24)? | CLOSED, ruled 2026-11-13 as recommended: no; normal dismissal rules apply (self for anyone, a household hold by a confirmed adult until the alert ends, a re-alert once on a severity upgrade) | 15.6, SCENE-01j |
| 31 | `weather.alerts` default (false today in the weather manifest) | CLOSED, ruled 2026-11-13 as recommended: defaults ON when the household home is in the US, an admin can turn it off, off elsewhere. This changes a shipped default (the weather manifest's `weather.alerts` default and its privacy row text), recorded in SCENE-01j and the Supersedes section | 15.6, SCENE-01j, Supersedes |
| 32 | An `extreme` alert in quiet hours | CLOSED, ruled 2026-11-13 as recommended: `extreme` overrides quiet hours on robots and notifications like the safety alarm; `severe` and lower respect them (`severe` is spoken in the morning if still active; nothing below `severe` is spoken) | 15.6, SCENE-01j |
| 33 | Alerts on the Weather app and the weather cards | CLOSED, owner 2026-11-13: active alerts for the caller's place show as the kit banner on the Weather app page and the chat `weather_card`, severity by kit tokens, with the dismissal state and Resume, from the same ids and cache as the notifications (no second fetch); SCENE-01k, which depends on the open WEATHER-PORT-02 | 15.7, SCENE-01k |
| 24 | Real sensor alarms versus heard sounds | CLOSED, ruled: a dismissal of a real sensor alarm (smoke, CO, gas, water leak, temperature and the like from Home Assistant or other hardware) lasts 15 minutes regardless of reason, a media reason included; a repeat inside the window gives another 15 minutes, no doubling; ceiling 1 hour (my recommendation, adopted); the re-alert margin still applies; sound-event tags (a heard smoke-alarm or glass-break sound) keep the reason-driven durations of decision 20 | 14.1, 14.3, 14.5, DISMISS-01 |

The earlier wording of each question is kept below for the record, marked CLOSED or DECIDED.

1. **A child in the room and an adult's gate (rule 10).** CLOSED. The model is told only; rule 10 and
   the adult's gate are unchanged. A bench row (`scene-01.json`, child-present wording) measures that
   the model keeps it suitable.
2. **The ambient-sensing rule A1 to A4.** CLOSED, APPROVED as written 2026-11-13. The RULES.md edit
   still lands later, carrying `Owner-approved: 2026-11-13`; nothing is turned on until SCENE-02c.
3. **A guest's or a child's presence and ambient listening.** CLOSED. No pause; never a voice match on
   an unenrolled voice; a child's own device never runs it.
4. **Who turns a hub device's ambient listening on.** CLOSED. An admin, per device; the owner has one
   household off switch in Settings, Privacy.
5. **Room presence sensors.** CLOSED. None bought; the Aqara purchase plan is withdrawn. The scene uses
   only the robot, browser, phone, Go and the Home Assistant entities the household already has.
6. **Home or away from phones, and the rest of Home Assistant.** CLOSED, CHANGED from the
   recommendation. Any Home Assistant information is fair to use (`device_tracker` home or away,
   occupancy, lux, temperature and the rest), always as a soft, possibly wrong cue at low confidence,
   because a person may not have the app, the permission or the phone on them. No opt-in gate; a
   person's own switch, where one exists, is still honoured. Never a room, a route or a history from a
   phone. Fusion rule 7 (2.3) carries the confidence and staleness design: absence of a phone is never
   proof of absence of a person. Reading against the privacy rules: coarse home or away read from the
   household's own Home Assistant, which an admin already connected, is not the live location that
   PRESENCE-FIND-01 says needs its own consent design, and nothing new leaves the house. The
   architect's condition (2026-11-13) narrows the use, not the ruling: only the speaker's own linked
   tracker may set their own place line, and another person's home or away is never named to the
   model, because "a person's activity stays theirs" (PRIVACY.md); SCENE-01f carries the test.
7. **The emergency path and the outside world.** CLOSED. No outside call or message, ever, for now;
   adults are alerted through Notifications and the robots speak.
8. **Go: our model or Apple's Sound Recognition.** CLOSED, CHANGED: both. Our pinned model is the
   baseline on every surface; Apple's `SNClassifySoundRequest` runs beside it on iPhone (and Apple TV
   where a microphone exists, see 4.1) as an enhancing cue, merged through the same observation record
   and closed label list; agreement raises confidence one notch; Apple's alone never creates an
   emergency-tier event.
9. **"Stay silent on lines not aimed at it".** DECIDED here. No code rule; the model's call from the
   scene block, with the bot's own listening gates on a robot; a bench row of 20 two-person exchanges,
   target under 10 percent wrong replies, revisited after the first robot week.
10. **Temperature and light from Home Assistant.** DECIDED here. The connector's privacy row covers
    them (entity states Home already reads); A1 governs microphones and the robot's own sensors.
11. **Learning a stranger's name from the robot.** CLOSED. Never on the spot; the robot says where
    enrollment lives (Home, People) and nothing more; a one-conversation name claim (`claimed`,
    `tentative`) is allowed and opens nothing.
12. **Naming the two candidates on a close tie.** CLOSED. Never; the robot asks for a few more words.
13. **Picked up: a fixed line, or the model's own words?** DECIDED here. The fixed carry line at the
    moment of the lift (rule 6, offline, child-floor reviewed); the model's own words only on the next
    turn or as a rate-limited offer (MOVE-SCENE-04).
14. **Learning rooms from pictures.** DECIDED here. Not now: R1 forbids storing anything derived from
    a picture; the admin's room setting plus a spoken "I brought you to the kitchen" covers it; the
    question returns only if the robot moves rooms daily.
15. **Phone motion.** DECIDED here. MOVE-SCENE-06 is built last, off by default, adult only, the
    permission prompt opened only from the switch; nothing on Apple TV (no sensor).
16. **A shaken robot and a child.** DECIDED here. A face reaction and a settle only at the child band;
    an adult gets the model's words under the offer limits.
17. **Sound tags as a safety input, or hints only?** CLOSED. Hints first: for the first month sound
    events only offer and notify on every surface; `SCENE-SOUND-BENCH-01` measures false emergencies
    per device per month; `smoke_alarm` and `glass_breaking` are promoted to the alarm path only when
    under one false emergency per device per month and he says yes then. SOUND-EVENTS-01's "the alarm
    module has no import path to the tagger" test stays until that day.
18. **A fall at night.** CLOSED. The robot speaks once only if someone is present; `robot.fallen` is
    `time_sensitive` to adults and respects quiet hours; no outside call.
19. **Battery rungs and the degrade order.** CLOSED, as written: warn at 20, degrade at 15 (head, look,
    breathing off, screen dim), ask for the dock at 10, goodbye and sleep at 5, 3-point hysteresis, one
    line per rung per discharge; `robot.power.warn_at` is the one admin setting.
20. **Dismissal durations.** CLOSED, CHANGED: the duration follows the reason the model sets on the
    dismissal from a closed list (`media`, `handled`, `false_alarm`, `party`, `other`; rule 1, no word
    matching). A media reason ("it's just a movie", "it's just TV", "it's a show") lasts until the media
    session ends when the hub knows the playback, otherwise 3 h, doubling to a ceiling of 8 h and
    extendable; a plain "I got it" or "don't worry" (`handled`) gets the base 30 min for an emergency
    kind or 1 h for a notable kind; a party flag 4 h. Tables in 14.3.
21. **Who may dismiss.** CLOSED. Any adult present or the owning person may dismiss any event kind,
    smoke, CO and glass break included ("that's just a movie", "I got it", "don't worry", "ignore
    that"); the safe form is 14.5, as defaults he can see.
22. **Scope of a dismissal.** CLOSED. The device and room that heard it, visible to the whole household
    on the robot card and the Status page, independent of any conversation.
23. **A child, unknown, claimed or tentative speaker dismissing.** SUPERSEDED by 27. The courtesy hold,
    the ask-a-grown-up line and the teen clause are withdrawn.
25. **How a sensor alarm is dismissed without model code.** CLOSED, his yes 2026-11-13: `acknowledge`
    extended to also hold that sensor kind quiet for 15 minutes via the deterministic speaker check;
    supersedes SAFETY-ALARM-01's "an adult's acknowledgement ends it"; DISMISS-01 lands as a risky
    surface (full `check.sh`, code-review medium, architect verdict on its staged diff).
26. **Re-approval of A1 to A4 as revised.** CLOSED, approved 2026-11-13 in chat; SCENE-02a lands the
    text with "Owner-approved: 2026-11-13 (chat; revised A1 to A4 and question 25)".
27. **Dismissal by whom the alert is for.** CLOSED, ruled 2026-11-13, supersedes 23: anyone may dismiss
    an alert directed at them, for themselves only; a hold on a kind for a device, room or household,
    and a sensor-alarm dismissal for others, is a confirmed adult's or the owning adult's; a child's or
    unconfirmed speaker's "ignore that" silences their own alert and nothing else; the safe re-alert
    stays. Nothing turns on teens.
28. **Re-approval of A3 and the Governs line after 27.** OPEN: the six differences are listed under 5.2.
    Recommend approve all six; the one that changes shipped code, `quiet_here` for a person's own device
    at any age, lands inside DISMISS-01's risky-surface review.
29. **A phone's position for its own scene.** CLOSED, 2026-11-13: yes; through the existing
    Current-location opt-in, coarse, sent only with a turn, memory only, never stored (15.1).
30. **An official weather alert and the 15-minute sensor rule.** CLOSED, 2026-11-13: not a real sensor
    alarm; normal dismissal rules (self for anyone, a household hold by a confirmed adult until the
    alert ends, a re-alert once on a severity upgrade) (15.6).
31. **`weather.alerts` default.** CLOSED, 2026-11-13: on when the household home is in the US, an admin
    can turn it off, off elsewhere; a shipped default changes (SCENE-01j, Supersedes).
32. **An `extreme` alert in quiet hours.** CLOSED, 2026-11-13: `extreme` overrides them like the safety
    alarm; `severe` and lower respect them.
33. **Alerts on the Weather app and the weather cards.** CLOSED, owner 2026-11-13: shown as the kit
    banner on the Weather app page and the chat weather card for the caller's place, with the dismissal
    state and Resume, same ids and cache as the notifications (15.7, SCENE-01k; depends on
    WEATHER-PORT-02).

## 13. The bot's own situation (self-state), part of the scene

Jesse's examples: "I've fallen and need help", "my battery is low and I need charging soon". The body
knows its own situation without the hub (principle 2); the hub mirrors it into the scene from the
state frame and the check-in it already receives, and every surface shows it through the existing
status mechanisms (S6). Nothing new is drawn.

### 13.1 Self-state observations

Kind `self_state`, one per aspect, strong, read where the fact lives:

| Aspect | Read where | Today | Threshold and hysteresis | Expiry |
|---|---|---|---|---|
| battery level, charging, docked | StackChan firmware (`get_battery_status`: percent, charging) through the body; the Pi's UPS HAT and INA228; the hub's check-in (`battery_level`, `charging`, every minute) | check-in fields exist; `robot.state` has no battery field | warn at 20, degrade at 15, dock at 10, goodbye at 5; 3 points of hysteresis; charging clears all; `docked` = charging and `still` | live while frames arrive; a frame older than 45 s (`ROBOT_STATE_STALE_MS`) is "last known" |
| fallen or tipped | the body's IMU (section 12): `falling` then a non-upright pose, or `tipped` | Reachy `tipped` and `freefall` (RM-06); StackChan poses | fallen = `falling` followed by `left_side`, `right_side`, `face_down`, `on_back` or `upside_down` settled 2 s; cleared by `upright` settled 2 s | live; the event 10 min |
| stuck or blocked servo, motor strain | the body: MOTOR-RECOVER-01's position watchdog (`STUCK_AFTER_S`), the XL330 error register and input voltage; the StackChan's head-move cap and tool time-outs | Reachy: built, raises a Repair at rung 4 | one rung per `STUCK_AFTER_S` while the error lasts; cleared when the pose follows again | live |
| overheating | the body: the Pi's thermal reads; the StackChan's `heap_stats`/`imu_stats` carry no temperature today (firmware ask) | Pi: warm 70 C, hot 76, critical 82 with 3 C hysteresis | as built; critical stops motion | live |
| Wi-Fi and hub link | the body: `LinkLifecycle` (`connected`, `reconnecting`, `sleeping`, LINK-STATE-01), rssi; the hub: check-in `rssi` and `signal`, `robotOfflineWatch` (offline after 10 min, `robot.offline` passive to admins, once) | built | weak when `signal` is weak for 30 s; lost when the link is silent 60 s (firmware 077) | live |
| storage and memory | the body: free heap, min heap, PSRAM (StackChan check-in), disk free (Pi) | check-in fields exist | low under 10 percent free for 60 s | live |
| mic or camera fault | the body's self-test parts (`robotSelfTest.ts`: speaker, face, head, lights, mic) and the camera bridge's "looked at 0 with frames arriving" case | self-test runs exist | a failed part until the next passing run | live |
| firmware or update pending | the hub: `robotSoftware.ts` `update_available` | built, a card state | state only | live |
| held versus docked | section 12 motion plus charging | `motion: held` exists | as in 12.2 | live |
| sleeping, drowsy | the body: `sleep_auto.py` (drowsy after 2 min, asleep after 5) | built | as built | live |
| phone | the installed web app: nothing worth reading (the Battery API is Chrome-only) | none | none | none |

### 13.2 How the bot says it

| Aspect | Unprompted | Only when asked | To whom, through what |
|---|---|---|---|
| fallen | once, right after the fall, only if someone is present ("I fell over, can someone stand me up?"); a thanks once when upright | "I'm on my side" | the room: the body's fixed clip pool (rule 6, reviewed, child and adult pools); adults: `robot.fallen` through Notifications (S6), `time_sensitive`, quiet hours respected (decision 18), once per fall, a second fall inside 10 min raises nothing new; no outside call, text or service, ever |
| battery 20 | one line if someone is near, else nothing | the level in words | `robot.battery_low` passive to admins, once per discharge |
| battery 15 | nothing said; features degrade (head moves, the look, breathing off; screen dim) | "I'm saving power" | the robot card and the Status row say "low power" |
| battery 10 | one line asking for the dock ("Could someone put me on my charger?") | the same | `robot.needs_dock` `time_sensitive` to adults, once; escalation: if still off the charger 30 min later and under 10, one more to every adult, then no more |
| battery 5 | the goodbye line (5 s grace), safe pose (head level, settle), sleep; this one line plays through quiet hours too, since silence would look like a crash | n/a | the card says "asleep, needs charging"; `robot.offline` is not raised for a battery sleep (the check-in says why) |
| stuck servo | one line at rung 2 ("my head is stuck, please don't push it") | the same | Repairs at rung 4 (exists); the card |
| overheating critical | one line, motion stops | "I'm warm" at warm or hot | the card; Repairs if it persists 10 min |
| link lost | nothing spoken until asked or a wake ("Can't reach Home" bubble and the rung 2 status line exist) | "I can't reach Home right now" | `robot.offline` after 10 min (exists) |
| storage low, update pending, mic or camera fault | never spoken unprompted | plain words when asked | the card, the Status row, Repairs for a fault (SELF-SCENE-04) |
| sleeping, drowsy | the face only | "I was dozing" | the card |

Rules: one line per state per cycle (a counter the body keeps, reset by the clearing condition), never
over a turn, never twice inside the state's window, quiet hours hold every line but the fall-with-
people-present and the 5-percent goodbye. The wording for a child-band listener (a child present, a
child's own robot, an unknown speaker) comes from the child clip pool: "I'm sleepy, I need my charger",
"I tipped over, can you help me up?", never a percentage, "fault", "critical" or "error". An adult gets
the adult pool or, in a turn, the model's own words grounded on the self line. Through the hub every
notification above is a declared type in `notificationTypes.ts` with its audience, level and channels;
no new banner, toast or poll (S6). Logs carry counts per state transition and never a robot name
beside a person (rule 6a).

### 13.3 Never silent

Every rung has a visible mirror even when nobody is around to hear: the robot card's state from the
state frame, the Status page's robot row, the Repairs item for a fault. A robot that cannot reach the
hub keeps its own counters and clips and reports the missed states in the first check-in after
reconnecting, and the hub raises what is still true then, once.

## 14. Dismissals and context states ("no, that's just a movie")

### 14.1 The observation

Kind `context_state`, set by the model through the scene tool (rule 1: the model reads "no, that's just
a movie" and calls `dismiss`; code matches no words) or by the hub itself for the automatic states:

```
ContextState = { state: "false_alarm" | "media_playing" | "call_in_progress" | "quiet_hours" | "away" | "party";
                 kinds: SoundClass[] | "notable";        // what it suppresses
                 device_id: string | null; room: string | null;   // where it applies
                 set_by: "person" | "system"; by_level: "confirmed" | "signed_in" | "system";
                 reason: "media" | "handled" | "false_alarm" | "party" | "other";   // model-set, closed list (decision 20)
                 scope: "self" | "device" | "room" | "household";   // ruling 27: self is anyone's; the rest an adult's
                 until: number; dismiss_count: number }
```

Tool actions: `dismiss` (kind, reason from the closed list, duration optional), `resume` (kind or
all), `party` (on, hours). The reason is the model's reading of what the person said ("it's just a
movie", "it's just TV", "it's a show" are `media`; "I got it", "don't worry" are `handled`; "ignore
that" with nothing more is `other`); code never matches the words (rule 1), and the reason sets the
duration (14.3). The tool result states exactly what was set ("glass sounds ignored on the
living-room robot until 9:40 pm"), and the model's confirmation is grounded on that result like any
package result (`groundOutcomes`), so "okay, I'll ignore glass sounds for an hour" is the model's own
words about data, not a template. `resume` ("start listening again") clears at once and the result
says so. Expiry is silent: no line, the card and the Status row just return to normal.

### 14.2 Who may dismiss, and what

Ruling 27 (2026-11-13) shapes this by whom the alert is for, not by age: "anyone may dismiss alerts to
themselves."

- **A dismissal for yourself (any person, any age, any level).** An alert directed at a person is theirs
  to dismiss: their own notification (marked dismissed for them), the spoken alert on their own device
  or the robot speaking to them (that device stops repeating it to them), their own card. It stops it
  for them only: scope `self`. Nothing changes for anyone else, no kind is held quiet for a device, room
  or household, and the alarm state, the other devices and every other person's notifications
  continue. A child's or an unconfirmed speaker's "ignore that" is always this. The confirmation says
  so ("Okay, I'll stop telling you; the others still get it"). For a real sensor alarm the own-device
  stop is the shipped `quiet_here` action on that device, which the policy node applies with the
  turn's own speaker evidence or the signed-in person; the shipped adult-only check on `quiet_here`
  widens to "the device's own person at any age" (question 28 (e), DISMISS-01 risky surface); the
  re-alert margin still speaks once on that device when the alarm escalates.
- **A hold for the device, room or household (a confirmed adult, or the owning person when a confirmed
  adult).** Notable kinds (doorbell, knock, dog, cat, baby, shouting, water, beep, music or TV) and
  heard emergency sounds (`smoke_alarm`, `co_alarm`, `siren`, `glass_breaking` tags) through the scene
  tool, in the form of 14.5, for the reason-driven time (decision 20), scope `device`, `room` or
  `household`. This changes what others are alerted to, so it is an adult's. While decision 17's month
  runs the emergency tags only offer and notify, so holding one quiets offers and notifications. A
  child or an unconfirmed speaker asking for a hold gets the self dismissal above and the tool result
  says "for you only"; the model's reply is grounded on that result.
- **A real sensor alarm dismissed for others (a confirmed adult, or the owning person when a confirmed
  adult; decisions 21, 24 and 25).** Never through model code. The path is the shipped deterministic
  one: `applyAlarmAction(actorId, alarmId, "acknowledge")` for a signed-in adult on chat or phone,
  `applyRobotAlarmAction(robotId, alarmId, "acknowledge", speakerEvidence)` on a robot with the turn's
  own speaker evidence (confirmed, a named household adult, never `claimed` or `unknown`, exactly the
  check that exists today). The entrances are the alarm card's button, the bot's existing alarm
  keyword path, and the scene tool's `dismiss` as a relay only: when an alarm is active and the model
  calls `dismiss` on an emergency kind, the tool does nothing itself; the policy node maps the call to
  `acknowledge` (an adult) or `quiet_here` (anyone, own device) for the active alarm with the turn's
  actor and speaker evidence, ignoring every model argument (kind, device, duration, reason), and
  refuses when no alarm is active. `acknowledge` gains decision 24's hold: that sensor kind on that
  sensor raises no new alarm for 15 minutes, another 15 on a repeat, 1 hour at most, with the re-alert
  margin (another sensor agreeing, or the sensor still on at the end of the hold) deterministic in
  `safetyAlarm.ts`. `false_alarm` stays admin-only and is not reachable from the tool at all.
- Scope: by kind, device and room; a dismissal from a browser with no device applies to the room the
  person names or, with none, to the household's notable offers only; a sensor-alarm dismissal applies
  to the alarm that is sounding now, wherever it is.
- Module boundary (SAFETY-ALARM-01's grep test holds): the suppression table lives in its own module,
  `lib/sceneSuppression.ts`, which imports no model, turn, TTS or package-host code; `safetyAlarm.ts`
  imports it; `lib/scene.ts` and the scene package write to it only for heard sounds and never for a
  sensor alarm. A bench row counts unasked `dismiss` calls on emergency kinds with a zero target.

### 14.3 How long

| State | Default | Repeat | Ceiling |
|---|---|---|---|
| reason `handled`, `false_alarm` or `other`, notable kind | 1 h | a repeat inside the window doubles it: 2 h, 4 h | 8 h; never forever except the admin's per-device class switch (`device.ambient` classes, SCENE-02c) |
| a real sensor alarm (HA or other hardware: smoke, CO, gas, water leak, temperature and the like), any reason, a media reason included (decision 24) | 15 min, that event and that kind | a repeat inside the window gives another 15 min, no doubling | 1 h (recommended and adopted); the admin setting `safety.sensor_dismiss_ceiling_minutes` (default 60) is the only way past it, and never forever; the re-alert margin of 14.5 still runs |
| reason `handled`, `false_alarm` or `other`, a heard emergency sound (`smoke_alarm`, `co_alarm`, `siren`, `glass_breaking` tags) | 30 min, that event and that kind | a repeat doubles it: 1 h, 2 h | 4 h; the admin setting `safety.dismiss_ceiling_minutes` (default 240) is the only way past it, and never forever |
| reason `media` ("it's just a movie", "it's just TV", "it's a show"), a heard sound of any kind (decision 20) | until the media session ends when the hub knows the playback (its own players or the Go client, plus 2 min), otherwise 3 h | a repeat doubles it: 6 h | 8 h, extendable by another dismissal up to the ceiling; the re-alert margin of 14.5 still runs, and a real sensor alarm is never covered by it (decision 24) |
| `party` | 4 h | re-set only | 8 h |
| `media_playing` (automatic) | while the hub's own player, the radio, podcasts, video or the Go client plays on that device, plus 2 min | n/a | none needed; it follows playback |
| `call_in_progress` (automatic) | the voice session | n/a | follows the session |
| `quiet_hours`, `away` (automatic) | the existing settings and the presence state | n/a | n/a |

### 14.4 What each state changes

- `false_alarm`: the named kinds raise no offer and no notification from that device or room; they are
  still written into the scene as context ("a glass sound 10 minutes ago, dismissed as a movie"), so the
  model can mention it if asked.
- `media_playing`: `music_or_tv` is suppressed; `glass_breaking`, `shouting` and `siren` need the raised
  threshold on that device (one notch, set from the bench); offers for them are held.
- `call_in_progress`: no offers on that device; the scene still updates.
- `away`: notable events become notifications only (nobody is home to hear a line); the emergency tier
  is untouched by every automatic state (only a person's dismissal reaches it, 14.5).
- `party`: shouting, music, knocks and the doorbell are suppressed for the duration; never an emergency
  kind.
- `false_alarm` for an emergency kind: the clip stops on every device, that event and that kind raise
  no new alarm for the set time, the adults already notified get one passive `safety.alarm_dismissed`
  update ("the smoke alarm was dismissed by someone at home"), and the escalation watch of 14.5 runs
  for the whole window.

### 14.5 Dismissing an alarm: the safest form that honours the ruling (defaults he can see)

Jesse's rules, kept as written: any adult present or the owning person may dismiss any event kind,
smoke, CO and glass break included (the owning person when a confirmed adult), and anyone may dismiss
an alert directed at themselves, for themselves only (ruling 27). The defaults below make that safe
without narrowing it; each is a setting he can see under Settings, Safety, and none is hidden in code.
A sensor alarm is dismissed only through the deterministic path of 14.2, never by model code; a self
dismissal never changes what anyone else is alerted to.

1. **What a dismissal covers.** That event (the firing that is sounding now) and that kind, on the
   device or room that raised it. A real sensor alarm (decision 24) is covered for 15 minutes whatever
   the reason, another 15 on a repeat, 1 hour at most. A heard sound is covered for the time its
   reason sets (14.3: 30 min for an emergency sound or 1 h for a notable kind on "I got it" or "don't
   worry"; until the show ends, or 3 h, on "it's just a movie"; 4 h for a party). It never silences a
   different kind: a CO alarm after a dismissed smoke sound still alarms, a glass sound after a
   dismissed doorbell still offers, and "it's just a movie" said to a sensor alarm buys 15 minutes,
   not the show.
2. **The margin that re-alerts once.** During the window the same kind is still watched, silently.
   It re-alerts once, with a short line ("The smoke alarm sound is still going and louder; say 'I got
   it' again if it's fine") and the same notification, when any of these holds: louder (6 dB over the
   dismissed level), longer (still sounding after 60 s continuous, or heard 3 times in 10 min), a new
   source (another device or room hears it), several sensors agreeing (a sound plus an HA sensor, or
   two HA sensors), or a certified HA smoke or CO device alarm after a sound-only dismissal. The
   margins are `safety.realert.*` settings with these defaults.
3. **Dismissed again.** The re-alert can be dismissed the same way; the window doubles (14.3) and the
   margin resets against the new level. A third escalation re-alerts again; nothing is ever silenced
   past the ceiling.
4. **Confirm out loud.** The model's confirmation is grounded on the tool result and names the kind,
   the place and the time ("Okay, ignoring the smoke alarm sound in the kitchen for 30 minutes. I'll
   speak up once if it gets louder or another sensor agrees."). On a robot with no model reachable,
   the fixed confirmation clip says the same from a template (rung 2 pattern). A child-band listener
   hears the child wording.
5. **Always undoable.** `resume` ("start listening again", or the Resume control on the robot card and
   the Status page) clears the dismissal at once; an owner or admin can clear any dismissal; expiry is
   silent.
6. **Adults away.** The immediate `safety.alarm` notification already went out; the dismissal sends one
   passive `safety.alarm_dismissed` update so nobody drives home for a movie, and a re-alert sends the
   immediate one again.
7. **Counts only.** One count of dismissals per day in the hub log, with no kind, no words, no who and
   no room beside a person (rules 6a and A1: a log never carries a class). No settings row and nothing
   on disk: the table is memory only and a restart clears it (14.6).
8. **The robot alone.** The body applies the same table to its own alarm clip and sound tags; rung 1's
   "I got it" and "ignore that sound" fixed commands write it offline with the fixed confirmation clip,
   and the hub's table replaces it on reconnect.

What changes in the tests (against the earlier draft): the DISMISS-01 test that `safetyAlarm.ts` never
imports the suppression table is dropped and reversed (it must read it); SOUND-EVENTS-01's test that
the alarm module has no import path to the sound-tagger module stays (a tag is still never a safety
input; decision 17); new fail-first tests: a dismissed smoke sound quiets the clip on every device and
raises `safety.alarm_dismissed` once; a CO alarm 10 s later still alarms; a 6 dB louder repeat inside
the window re-alerts once and only once until dismissed again; an HA smoke sensor after a sound-only
dismissal re-alerts; an HA smoke sensor dismissed with "it's just a movie" alarms again after 15 min
and a fifth repeat never passes 1 h; a heard sound's second dismissal doubles the window and a fifth never passes the ceiling; a
child's, unknown, `claimed` or `tentative` speaker's dismissal of a sounding sensor alarm quiets their own device only and leaves the alarm
sounding and speaks the child line; `resume` and the card's Resume clear it; the audit row carries no
person, words or audio; the robot's offline table expires on its own and is replaced on reconnect.

### 14.6 Learning without drift, audit, status, the robot alone

- A dismissal changes no threshold, retrains nothing and stores no audio, words or class: only an
  in-memory counter per kind per device and an expiry (A1's one exception). When a device's dismissals
  reach 5 in a week the Status row carries one classless admin hint ("sounds were dismissed 5 times
  this week on this robot; you can lower a class in its settings"); the admin decides, the system never
  does; the weekly count is in memory too and resets with a restart.
- Audit: one count of dismissals per day in the hub log, with no kind, no words, no who and no room
  beside a person (rules 6a and A1: a log never carries a class).
- Memory only: the suppression table lives in process memory; a hub restart clears every dismissal
  back to normal alerting (the architect's "least that works"); nothing about a class is written to
  disk; the robot's own table is memory only in the same way.
- Status (S6, A1's exception): the robot card state and the Status page robot row show "Ignoring glass
  sounds until 9:40 pm" with a Resume control; a browser dismissal with no device shows on the Status
  page only. No new surface.
- The robot alone: the body keeps its own table for its own tags (SOUND-EVENTS-01 offers), set from the
  hub's turn `commands` (`scene_state`) when connected, and offline by rung 1's closed command list
  gaining "ignore that sound" with the fixed reply "Okay, for an hour" (an exact command, the class rule
  1 allows). A hub-sent state replaces the local one on reconnect; nothing is written to disk.

## 9. How others do it (and what we take from each)

| Who | What they do | Where it runs | What we take, and what we do not |
|---|---|---|---|
| Home Assistant Assist (2025.10) | The satellite's own area scopes a command ("turn off the lights" means this room); a short beep replaces the reply when the action stayed in the room; presence via `person` entities fed by `device_tracker` (router or companion app); mmWave occupancy with a configurable hold time | local | take: the device's room is a scene input (SCENE-01d), occupancy and `device_tracker` through the connector (SCENE-01f). Not: a second presence engine in Home |
| Frigate 0.16 and Double Take | Local NVR: person detection, then face recognition against a face library, sub-labels on events, MQTT to Home Assistant; community add-ons for room presence | local | take: the order (object first, then face, then identity), which the robot already follows. Not: house cameras feeding the scene; a camera picture never reaches the model (R4) and Frigate stays out (smart-home note) |
| Apple HomePod (2023) | Smoke and CO alarm sound recognition on the device, nothing uploaded; a notification with a check-in; "do not rely on it in an emergency" | on device | take: on-device classification, one notification path, the honest disclaimer line in the privacy row. Apple Sound Recognition on iPhone lists alarms, animals, household (doorbell, knock, glass, kettle, water) and people (baby, cough, shout): our 12-class list is a subset of it |
| Google Gemini for Home and Nest (2025 to 2026) | Familiar Faces with thumbs up and down feedback, now also body size and clothing cues; speakers detect smoke, CO and glass breaking (US); camera events trigger routines; paid Premium tier | cloud | take: sound classes and event-triggered routines (our Tier N offers). Not: identifying people by body or clothing (R3 forbids it), cloud processing, a subscription |
| Amazon Alexa | Guard listens for glass and alarms only in Away mode, on-device RNN first then cloud verification, alerts carry a 10 s recording; Hunches act on habits; Visual ID is opt-in face enrollment processed on the Echo Show; ultrasound motion detection on newer Echos only while a feature needs it | device then cloud | take: emergency sounds listened for everywhere but acted on by a deterministic path, opt-in enrollment, sensing only while a feature needs it (our `on_demand`). Not: cloud verification, stored recordings, ultrasound |
| Eufy HomeBase 3 | Face, human, vehicle and pet detection on the base, no subscription, family versus stranger | local | take: local, no subscription. Not: camera-based identity of visitors |
| Matter occupancy (Sonoff SenseGuard, Meross MS605, Aqara FP1E, Shelly Presence Gen4) | Every presence sensor is an Occupancy Sensing cluster with an illuminance entity beside it; Home Assistant 2025.10 added hold time | local | take: buy Matter or ESPHome sensors, read them through Home Assistant only |
| Research: ProMemAssist (UIST 2025), Sensible Agent (Google, UIST 2025), ProAgent (2025), "Do proactive agents need an LLM?" (2026) | Decide when to help from the person's load and the setting; cheap always-on sensors, costly ones on demand; people want control over when the agent acts; a small trigger model, the LLM only when it fires | research | take: cheap sensors always on, the model only when a trigger fires (our tiers), a person's own switch for every unprompted turn, discretion in company (the not-alone rule) |

## 10. What the robot already does, and how the scene ties into it

The body's pipeline, in order, on every frame it chooses to look at (`bot/body/maipai_body/vision/`):

1. **Fast object detection first.** `look_fast.py`: YOLOX-nano (Apache-2.0, the Stack's own decode),
   synced from Home by digest. Names household things and finds a person box even when no face is in
   view (an arm, a torso at desk distance). Labels, scores and boxes only; nothing logged.
2. **Face detection.** `detect.py`: YuNet with five landmarks, at 5 Hz on a 320 x 240 frame (2 Hz at
   70 C), with a continuity rule that follows a face as one track (`watch.py`).
3. **Face recognition.** `align.py`, `embed.py`: SFace, one 128-d vector per aligned 112 x 112 crop,
   embedded once per new track and every 2 s per tracked face; `gallery.py` scores cosine against the
   synced prints (threshold 0.363, a margin against the runner-up) and gives a three-way verdict:
   `tentative` at one person, `unknown` with two candidates on a close tie, `unknown` with none on a
   miss. A face alone is never `confirmed`. A print from another model id is refused, never compared.
4. **Voice recognition.** `speech/voiceprint.py`: CAM++ through sherpa-onnx, direction of arrival from
   the array within 0.35 rad, `MATCH_SCORE` 0.35, `CONFIRM_SCORE` 0.55, margin 0.08 (starting values,
   M-07 measures them). A voice alone can be `confirmed`.
5. **Fusion.** `speaker_fusion.py` (SPEAK-04): voice confirmed with no conflicting face, or a face match
   with an agreeing voice (even tentative), is `confirmed` (`voice_and_face`); a face alone is
   `tentative`; two sources naming different people are `unknown`; with two or more faces the face is
   not attached to the speaker. `present` lists everyone with a fresh track or voice at their own level,
   and an unmatched face is an `unknown` entry (a visitor means not alone).
6. **Watch levels.** The stricter of the device's `robot.camera.watch_level` (`off`, `presence`,
   `identify`; default `identify`) and each person's `person.vision.watch` (default `presence`) applies:
   `presence` counts faces and never embeds; a name only ever comes from a synced print of a person who
   consented; nothing is compared across appearances.
7. **Enrollment is hub-owned** (`biometricPrints.ts`): the browser's guided pose capture (FACE-02) makes
   the prints; an adult enrols themself; a child never consents for themself (a parent enrols); a teen's
   consent comes from the teen; a guest is never eligible; a new enrollment replaces the old set; a
   print is encrypted at rest and reaches a robot only through its own device session
   (`/api/biometric-prints/sync`, FACE-03). `robotPeople.ts` gives the robot only ids, bands and the
   follow-up switch, never a name.

What the scene adds, without a second recognition path:

- `present` and `speaker_evidence` are the scene's strong observations, taken as they arrive (2.1).
  The scene never re-scores, re-matches or lowers a level.
- A person box from step 1 with no face behind it becomes an `unknown` presence entry on the bot
  (SCENE-01g, a bot row): "someone is here" from a torso, so `alone` is false even when nobody faces
  the camera. This is the one bot change SCENE-01 asks for, and it is still "no new sensing".
- The name the model may speak comes from the hub's roster, keyed by the id the bot sent, and only
  when `person.robot.greet_by_name` allows it for that person (adults on, children off until a parent
  enables it, teens their own). Otherwise the block says "a household member whose name is not to be
  spoken".
- R3 everywhere: a label in the scene exists only from an enrolled match or the person's own words.
  The look caption and the Look tags describe no person (R1), and the model's guidance line repeats
  it: never name or identify anyone from how they look.

## 11. Acceptance scenario: "who am I"

Jesse stands in front of the robot and asks "who am I". No word rule answers this; the model answers
from the scene block's speaker line, which states exactly what the evidence says and no more, and the
reply passes the band's output gate. The lines below are what the block says and what a good reply
sounds like; the bench row holds 24 such cases and the acceptance is the behaviour, not the wording.

| Evidence | Speaker line in the block | Reply behaviour | Opens memory or acting? |
|---|---|---|---|
| Voice `confirmed` (0.55 or more, margin held), no conflicting face | "Speaker: Sage, confirmed by voice." | names him: "You're Sage." | yes, if also alone (the existing bar) |
| Face `tentative` and voice `tentative`, same person, one face in view | "Speaker: Sage, confirmed by face and voice." | names him | yes, if alone |
| Face `tentative` alone (one face, no voice match yet) | "Speaker: probably Sage (seen, not yet heard clearly)." | hedges and invites more speech: "I think you're Sage. Say a bit more and I'll be sure." | no |
| Voice `tentative` alone (0.35 to 0.55) | "Speaker: probably Sage (voice, not sure)." | the same hedge | no |
| Close tie, two candidates | "Speaker: unknown; the voice is close to two household members." | asks for more words; never names the candidates (decision 12) | no |
| Face says Sage, voice says Marlow | "Speaker: unknown; the camera and the voice disagree." | says it is getting mixed signals and asks them to say their name; a name given is `claimed`, `tentative` | no |
| Two or more faces in view, voice `confirmed` | "Speaker: Sage, confirmed by voice. Others present: 1 unknown." | names him, speaks as to a group | no (not alone) |
| No match at all | "Speaker: unknown." | "I don't know you yet. If you live here, someone can add you in Home under People." Never learns a face or voice on the spot (decision 11); never guesses from looks (R3) | no; child band |
| `greet_by_name` off for the matched child | "Speaker: a household child, confirmed by voice; name not to be spoken." | "I know you, but I'm not set up to say names out loud." | per the child's own rules |
| Browser or phone, signed in, no voice session | "Speaker: Sage (signed in)." | "You're signed in as Sage." | yes (private screen, alone by default) |
| Browser or phone voice session, voice match agrees (after the SCENE-01 voice half) | "Speaker: Sage, signed in and confirmed by voice." | names him | yes |
| Browser or phone, voice match disagrees with the sign-in | "Speaker: signed in as Sage, but the voice does not sound like Sage." | says so plainly; the account and memory owner stay Sage's session, sensitive records are withheld (tighten-only) | no for sensitive |
| TV, pod or overlay, nobody identified | "Speaker: unknown on a shared screen." | the child-band answer: "I can't tell who's speaking on this screen." | no |
| "Who is that?" about a second person | from `present` only: a named entry or "someone I don't know" | names an enrolled match the speaker may hear about; otherwise "someone I don't recognise"; never a description | n/a |

How this fits the rules: the speaker, the memory owner and the acting account come from
`speaker_evidence` and the session alone (the robot paragraph); the scene and the model can only make
the hub more cautious. A `tentative` or `claimed` level never opens anything (the bot's
`opens_ceiling` and the hub's `effectiveBand` already say so). A name is spoken only from an enrolled,
consented print or the sign-in, and only when `greet_by_name` allows it, which is R3 plus the
enrollment consent rules in `biometricPrints.ts`. An unknown speaker gets the child band and no
memory (rule 0). Nothing about a stranger is stored: the scene dies with the conversation, the
embedding is a local variable of one cycle on the bot, and logs count only.

## 12. Movement awareness (SCENE-01, no new rule)

Added at Jesse's ask (2026-11-13): the robot knows when it is picked up, carried, set down, moved,
tilted, shaken or tapped, and the scene carries it so the AI can react.

Rule check: the IMU is the body's own sensor about itself; it sees no person, no face, no voice and no
room, so R1 to R4 (camera) and the proposed A1 to A4 (microphones and room sensors) do not govern it.
What does: rule 6 (the carry line is a fixed reviewed clip, listed on the privacy page), rule 6a
(counts-only logs), rule 0 (a child present changes nothing for the worse), and the spec-first rule
(the `robot.state` `motion` enum crosses to the bot). `robot.state` already carries `motion: resting |
held | null` and `put_down_count` in `commons/spec`, and the bot already builds `held` on the Reachy
(MOVE-CARRY-01), so this is SCENE-01 scope: an existing input, widened additively. No new rule.

### 12.1 What we have, per body

| Body | IMU and rate | Reaches the host as | State machine today | Limits |
|---|---|---|---|---|
| Reachy Mini (reachy-mini 1.11.0) | accelerometer, gyroscope, fused quaternion through `ReachyMini.imu`, read by the body's own tick | raw readings | `presence/motion_state.py` (MOVE-CARRY-01a, b): `resting`, `bumped`, `lifted`, `carried`, `put_down`, `tipped`, `freefall`; `held` suppresses every primitive but `stop`; the head holds on the lift and settles on put-down; `knock.py` (KNOCK-01): impulse under 120 ms, double within 1 s, never while lifted or carried; `robot.motion.carry_reaction` (`off`, `look`, `look_and_line`, default `look`) | thresholds are design defaults marked UNMEASURED (`measure-runbook.md` rows); a body held perfectly still reads as put down after 2 s |
| StackChan (M5Stack CoreS3, BMI270) | the firmware's IMU task reads every 10 ms | events only: `shake` (with a `shake_peak` diagnostic), `orientation` (a gravity axis, mapped by `orientation.py` to six poses), `tap` (patch 078 and 081: a strip touch plus a jolt within about 100 ms, a tap counts as a pet), `imu_stats`; raw IMU is not readable (`_UnsupportedSensorAdapter("imu")`: the pinned xiaozhi MCP tools have no IMU read) | poses with faces and a line pool (`LINE_GAP_S` 120 s, `POSE_CHANGE_GAP_S` 2 s), sensors ignored for 30 s after a pose change (`SENSOR_SETTLE_S`), the head-move cap of 40 a minute, wake from drowsy on touch, swipe or shake (polled every 5 s) | no lifted, carried or set-down event exists; a classifier has to live in the firmware's IMU task (an `imu_read` tool polled over MCP at 10 ms is not viable); screen rotation on flip is off since 2026-10-22 |
| Pi build | IMU in `safety.py`: tip and free-fall reads, in the hard-stop order (e-stop, tilt, falling, airborne, impact, silent tilt, rollaway, reflex stop, ...) | within the body | safety only | the hard-stop order outranks every new state and is not touched |

The hub side: `lib/deviceStates.ts` already keeps `motion` and `put_down_count` from the state frame
(short-lived telemetry, never a Device field) and the robot card can show "being carried".

### 12.2 One small deterministic motion classifier (runs on the device)

No learned component in a safety path (MOVE-CARRY-01's own reuse check); thresholds and durations
only, the same shape on every body so the fakes and the tests are shared. Design defaults, all marked
UNMEASURED until the unit row in MOVE-SCENE-02 records real lifts:

| State or event | Rule (g = 9.81 m/s2) | Enter after | Debounce or spacing | Notes |
|---|---|---|---|---|
| `still` | magnitude within 0.15 g of 1 g and gyro under 0.4 rad/s | 2.0 s quiet (`PUT_DOWN_STILL_S`) | reported on change only | the resting state |
| `bumped` | a jolt while still that is over within 0.5 s and leads to no lift | at once | 0.5 s (`BUMP_REPORT_S`) | a knock on the table, a push |
| `lifted` | moving (gyro over 0.4 rad/s or vertical deviation over 0.25 g) for 0.4 s (`LIFT_MIN_S`) from still | 0.4 s | once per lift | holds the head, starts "held" |
| `carried` | still moving 1.5 s after `lifted` (`CARRY_MOVING_S`) | 1.5 s | once per carry | room becomes unknown |
| `set_down` | quiet 2.0 s after `lifted` or `carried`, pose upright | 2.0 s | once per set-down; bumps `put_down_count` | triggers the re-check (12.5) |
| `shaken` | three or more sign changes of acceleration over 1.5 g inside 1 s | 1 s window | at most one per 2 s | the StackChan's existing `shake` event is this |
| `tilted` | gravity axis settles on a pose other than upright for 2 s | 2 s | one per settled pose (`POSE_CHANGE_GAP_S`) | the six StackChan poses; past 45 degrees while held is `tipped` on the Reachy |
| `tapped` | impulse under 120 ms and over about 2 g with no longer movement around it, plus the strip touch on the StackChan | at once | 200 ms minimum spacing | KNOCK-01 and patch 081; a tap is touch, not a reason to speak |
| `falling` | magnitude under 0.3 g for 150 ms or more (a 40 cm drop is about 285 ms) | 150 ms | once | `stop` first, then the event; the safety clip, never the model |
| `rolling` | wheel encoders move with no command (Pi build only) | the drive stage's own rule | its own | the existing rollaway stop |

Reporting: on change only, at most 5 events a second, each event at least 200 ms from the last; a
state is sent in every state frame (`motion`), an event once. Expiry in the scene is in 2.4. Logs on
the body and the hub carry counts per state and nothing else.

### 12.3 The same cue on a phone, the browser and Go

- Phone and browser: `DeviceMotionEvent` (acceleration with gravity, rotation rate, about 60 Hz) and
  `DeviceOrientationEvent`. On an iPhone they need `requestPermission()` from a user gesture over
  HTTPS (iOS 13 and later); Android Chrome asks nothing; a desktop has no sensor. The only cue worth
  having is `face_down` (go quiet) and `in_hand` versus `on_table` for a spoken session. MOVE-SCENE-06,
  off by default, adult only, the prompt opened only from the switch. A phone's motion never says
  anything about who is near it.
- Go on iPhone: CoreMotion gives the same; the same two cues; Apple TV has no sensor.

### 12.4 Room change: re-localize

A `carried` observation sets `place.room` to unknown and marks the robot's admin-set room stale; the
scene says "it was carried a few minutes ago; the room is unknown". The room comes back only from a
cue: the person's words ("I brought you to the kitchen", through the scene tool), the admin's room
setting re-confirmed from the robot's page, or a Home Assistant occupancy event in one room within 10
s of `set_down` when every other room is empty (weak, `tentative`). The bot's 0.2.59 empty-room picture
comparison can say "this looks like where I usually am" only as a `tentative` cue, since nothing from a
picture is stored (R1; decision 14 on a stored room fingerprint). Nothing ever infers a room from
Wi-Fi signal.

### 12.5 Who is here, after handling

A `lifted` observation means a person is within arm's reach: the scene adds one `unknown` nearby entry
(basis `motion`, 60 s) unless a confirmed person is already present, so `alone` is false while held.
On `set_down` the body drops its old face tracks, runs the face search once (0.2.59) within 5 s, ignores
light and camera readings for 30 s (the existing orientation settle, extended to carries), and the next
spoken turn's voice match rebuilds `speaker_evidence`. A motion observation never names anyone and
never raises a level (R3 and the tighten-only rule hold).

### 12.6 Safety while held

The Reachy already commands no motion while held (every primitive but `stop` is suppressed, the head
holds on the lift, settles on put-down; MOVE-CARRY-01b). The StackChan gets the same through its head
driver (MOVE-SCENE-03): `stop` on `lifted`, no head target while `carried` or `shaken`, one `settle` 2 s
after `set_down`; the 40-a-minute head cap stays. `falling` sends `stop` before anything else and plays
the safety clip; `tipped` and the non-upright poses keep the existing faces. The Pi build's hard-stop
order is untouched and outranks every state here.

### 12.7 Proactive limits

- The moment of the lift: the existing fixed carry line (rule 6, reviewed against the child floor, on
  the privacy page), at most once per lift, never over a turn, and never when any present entry is a
  child, a teen or unknown (the MOVE-CARRY-01 rule, kept). `carry_reaction` `off` keeps the holds and
  drops the look and the line.
- The model's own words ("whoa, put me down gently"): only as an INITIATIVE-01 offer or on the next
  turn, with the scene block saying what happened; never in quiet hours (a face reaction only); at
  most 1 per 10 minutes and 4 per hour of handling; backoff after 2 ignored as every offer.
- A child-owned robot, or a child present: a face reaction and a settle, no line and no offer; a shaken
  robot never scolds at the child band (decision 16). A teen: their own `may_address` and
  `carry_reaction` settings. A guest's handling: faces only.
- A tap is touch (a pet, a wake), never a reason for an unprompted sentence beyond the existing wake
  behaviour.

## 15. Local weather, from the caller's own place (SCENE-01, added 2026-11-13)

Jesse's addition: awareness includes the local weather where the caller actually is. Nothing new
leaves the house: the cue is the weather package's own Open-Meteo recipe and the existing NWS alerts
lookup, called with the same host-added rounded point the weather tool already uses.

Reuse check: `lib/places.ts` `resolveWeatherPlace` (named place, then the turn's `current_location`,
then the person's saved place, then the household home; `hostInputs` rounded to 2 decimals, 1 for a
child; `uncached` for a current-location run), `frontend/src/lib/currentLocation.ts` (rounded
coordinates sent only when permission is already granted and the person's weather default is
Current location, PLACE-WEATHER-01), `lib/weatherAlerts.ts` (NWS, 5 min cache, one request per 300 s,
1 h backoff, US only, `weather.alerts` household setting, `notifyWeatherAlertsForHome` through
`trigger("weather.alert")` with the alert id as `repeatKey`), the weather package (Open-Meteo current
conditions, hourly precipitation probability, daily UV max, 1800 s cache; the `weather.alert`
notification `time_sensitive` to the household; the Open-Meteo and NWS privacy rows), `lib/plugins.ts`
(the first alert on a weather result, severity mapped to `severe`, `warn`, `info`), WEATHER-KID-01,
the scene block and its 320-token budget (section 3), INITIATIVE-01's robot offer gates, ruling 27's
dismissal scopes, the rung-2 template line pattern (LINK-STATE-01). Nothing is built twice.

### 15.1 The place the caller is at

| Caller | Place for the cue | Source |
|---|---|---|
| Browser or phone (web app) with location granted and weather default "Current location" | its own rounded position | the turn's `current_location`, exactly as the weather tool gets it today |
| Browser or phone without a position | the person's saved place, else the household home | `resolveWeatherPlace`, unchanged |
| Phone with the Go app or a companion | its own rounded position (decision 29: opt-in by the person through the same Current-location weather default, coarse, sent only with a turn, memory only, never stored) | the same `current_location` field on the turn |
| Robot, pod, TV and every fixed device | the household home, or the device's configured place when an admin set one (`device.weather_place`, optional, for a robot that lives elsewhere) | `householdHomeEntity`, the device setting |
| An unknown robot speaker | the household home, rounded for the child band | WEATHER-KID-01, unchanged |
| Any turn that names a place | the weather tool for that place; the scene cue is unchanged | rule 1: the model calls the tool |

Inside or outside: when the person says so (the scene tool's `place` action, `outside` or `inside`,
set by the model from their words, never a word rule), the block renders the setting beside the
weather. Outside plus rain plus cold is the cue the model needs to mention a coat; inside makes the
weather background only. The combination is data, never an instruction to say anything.

### 15.2 What the cue holds

```
WeatherCue = { conditions: { temperature: number; feels_like: number; sky: string; precipitation: number;
                              wind_mph: number; uv?: number; air?: string };     // uv and air only when the recipe already has them
               change: "rain likely within the hour" | "clearing" | null;       // from the hourly probability; minutely_15 later
               alert: { event: string; severity: "extreme" | "severe" | "moderate" | "minor"; ends: string | null } | null;
               checked_at: number; expires_at: number; source: "current" | "saved" | "home" | "device" }
```

No coordinates, no place name beyond "here" for a current-location cue (the package already labels
those "your current location" and never caches them by name), the unit from the person's own
`weather.unit`.

### 15.3 Fetching, staleness, offline

- One fetch per conversation per TTL through the same `runPlugin` path the weather tool uses, with the
  same `hostInputs`; the scene never calls Open-Meteo or NWS itself. Conditions live 30 min (the
  package's 1800 s cache), the forecast change 15 min, an alert 5 min (`weatherAlerts.ts` `CACHE_MS`)
  and never past the alert's own `ends`. A cue is dropped before render when its TTL has passed; the
  block never shows a stale one. The age renders in the three buckets of 2.4.
- Location change: a new rounded point more than 0.02 degrees (about 2 km) from the cached one, or a
  change of source (current to home), refetches at once; smaller moves reuse the cue. A
  current-location cue is cached in memory keyed by the rounded point, never by a name.
- Offline or a failed fetch: no weather line and no error in the block; the model is told nothing and
  answers a weather question through the tool, where rule 6 applies. The next fetch waits for the TTL.
- The fetch runs on the first turn of a conversation and after each TTL, never on a bare turn, and only
  when a place resolves; a temporary chat's cue dies with it like everything else in the scene.

### 15.4 Privacy

No new outbound connection: Open-Meteo and NWS are the rows the weather package already lists, called
with the same rounded point (2 decimals, 1 for a child). The position stays host-added: never in a
tool argument, the stored turn, the trace, a log or the rendered block. The block carries conditions
and an alert's event name, never a coordinate. Logs carry counts only (fetches, cache hits, alerts
raised). A temporary chat keeps nothing. A child's cue is rounded to 1 decimal like their weather.

### 15.5 Budget and bench

The weather lines take at most 60 of the scene block's 320 tokens, engine-counted; when the block is
over budget they drop right after the ambient events and before the place detail (section 3's order
becomes: ambient events, weather change, weather conditions, light and temperature, place detail, the
oldest typed people). `scene-01.json` gains 14 items (SCENE-01i and 01j): coat outside in rain,
nothing volunteered inside, a named place goes to the tool, no position makes no local claim, a
child's rounding, the alert when asked, and never a coordinate in any reply.

### 15.6 Alerts for the caller's place

- The same `weatherAlerts(lat, lon)` call, for the caller's rounded point, at the same pace and cache;
  the hourly home check stays. `weather.alert` (declared in the weather manifest, `time_sensitive`,
  household audience) is reused with the alert id as `repeatKey`, so one alert notifies once whether
  it came from the home check or a caller's turn.
- Severity: `extreme` and `severe` raise the notification and the spoken line; `moderate` and `minor`
  render a scene line only. On robots the line is a rung-2 template from the alert's own fields ("A
  tornado warning is in effect here until 6 pm"), child and adult pools, once per alert id, under
  INITIATIVE-01's gates and quiet hours, except `extreme`, which overrides them like the safety alarm
  (decision 32). A child's
  robot gets the child-pool line for `extreme` only.
- Dismissal follows ruling 27: anyone dismisses the alert to themselves; a confirmed adult or the
  owning adult holds that alert id for the household until its `ends`. It is not a real sensor alarm
  for decision 24's 15-minute rule (decision 30: no); a severity upgrade or a new
  higher-severity id re-alerts once, which keeps the safe re-alert of 14.5.
- Outside the US bounding box nothing is requested and nothing renders; Open-Meteo carries no alerts.

### 15.7 The alerts on the Weather app and the weather cards (ruling 33)

Jesse (2026-11-13): the alerts must also show in the Weather app and the weather cards. What exists:
WEATHER-PORT-05 (the alerts lookup), WEATHER-PORT-06 (the notifications) and WEATHER-PORT-07 (the kit
`WeatherForecastPage` and `weather_card` take `advice` and an alert banner prop) are done;
WEATHER-PORT-02 ("advice on the page and the card", which wires that banner and the advice chips into
Home's Weather app page and the chat weather card from the tool result's `alert` field) is still
open at BACKLOG line 1124. SCENE-01k **depends on** WEATHER-PORT-02 and does not absorb it:
WEATHER-PORT-02 lands the wiring from the tool result (the place the person asked about);
SCENE-01k then feeds the same banner from the scene's `weather_alert` observation for the caller's
own place, with the same alert ids and the same `weatherAlerts.ts` cache the notification path uses
(no second fetch), adds the dismissal state ("dismissed for you"; "dismissed for the household until
6 pm" with Resume, ruling 27 scopes, read from the same in-memory table as DISMISS-03), and styles
severity by kit tokens only (rule 9: no `className`, no wrapper; a variant the kit lacks is a
`commons` prop first). WEATHER-PORT-02's checkbox is not touched by this note.

## Sources

- EfficientAT (MIT; mn10_as 4.88 M params, 47.1 mAP): https://github.com/fschmid56/EfficientAT
- sherpa-onnx audio tagging models (Zipformer small, 26 MB int8, RTF 0.03): https://k2-fsa.github.io/sherpa/onnx/audio-tagging/pretrained_models.html
- sherpa-onnx AudioTagging API (CED or Zipformer, 16 kHz mono): https://k2-fsa.github.io/sherpa/onnx/javascript-api/examples/api_audio_tagging.html
- CED (GPL-3.0; Tiny 5.5 M, 48.1 mAP): https://github.com/RicherMans/CED
- AHEAD-DS and OpenYAMNet, YAMNet 3.7 M params, about 0.31 mAP; PANNs and AST 81 and 86 M: https://arxiv.org/pdf/2508.10360
- AST paper (0.485 mAP ensemble): https://arxiv.org/pdf/2104.01778
- PANNs reference code and LiteRT CNN14 (162 MB fp16): https://huggingface.co/litert-community/PANNs-CNN14-AudioSet-LiteRT
- WeSpeaker (Apache-2.0; ECAPA-TDNN EER 0.728 percent on VoxCeleb): https://github.com/wenet-e2e/wespeaker
- 3D-Speaker (ERes2Net-base 6.61 M params): https://github.com/modelscope/3D-Speaker
- Aqara FP2 on Home Assistant (presence, lux, zones, Wi-Fi and HomeKit): https://community.home-assistant.io/t/aqara-new-people-presence-sensor-fp2/545374
- Everything Presence Lite (LD2450, ESPHome): https://smarthomescene.com/reviews/everything-presence-one-vs-aqara-fp2-comparison-review/
- Apple Sound Recognition class list (alarms, animals, household, people): https://appleinsider.com/articles/20/09/22/how-to-set-up-sound-recognition-alerts-in-ios-14-and-why-you-want-to
- Apple HomePod smoke and CO alarm recognition, on device, nothing uploaded: https://support.apple.com/en-gu/guide/homepod/apd1f1921722/homepod
- Home Assistant Voice Chapter 11 (2025.10): the satellite's area scopes commands, beep instead of reply: https://www.home-assistant.io/blog/2025/10/22/voice-chapter-11
- Home Assistant 2025.10 occupancy hold time and Matter 1.4: https://www.matteralpha.com/news/home-assistant-2025-10-adds-new-mounted-device-support-and-more-matter-enhancements
- Frigate 0.16 face recognition (sub-labels, Face Library): https://newreleases.io/project/github/blakeblackshear/frigate/release/v0.16.0-beta4
- Double Take with Frigate for room presence: https://community.home-assistant.io/t/facial-recognition-room-presence-using-double-take-frigate/290943
- Google Home Premium: smoke, CO and glass-break detection on speakers (US): https://support.google.com/googlenest/answer/13315909
- Gemini for Home camera features, Familiar Faces feedback and body cues: https://support.google.com/googlehome/answer/15542305 and https://engadget.com/2165331/google-home-gains-more-gemini-powered-camera-features
- Alexa Guard on-device RNN then cloud verification, glass training: https://amazon.science/latest-news/the-science-behind-an-amazon-echo-feature-that-helped-save-a-puppy
- Alexa Guard alerts carry a 10 s recording, Away mode only: https://www.cnbc.com/amp/2019/05/14/how-to-set-up-alexa-guard-on-an-amazon-echo.html
- Alexa Visual ID, opt-in, processed on the Echo Show: https://digprjsurvey.amazon.com/csad/help/node/GVPZZGGU8N6A9QJK
- Echo ultrasound motion detection, only while a feature needs it: https://digprjsurvey.amazon.com/csad/help/node/GSR22RYDWS3KBUYW
- Eufy HomeBase 3 detection types (face, human, vehicle, animal), local: https://service.ankersolix.com/article-description/What-detection-types-does-S380-HomeBase-HomeBase-3-support
- Sonoff SenseGuard Matter presence sensor review (occupancy and illuminance entities): https://smarthomescene.com/reviews/sonoff-matter-presence-sensor-snwf-06p24/
- Shelly Presence Gen4 (Matter, multi-zone): https://homekitnews.com/2026/03/31/shelly-presence-gen4-brings-matter-support-multi-zone-tracking/
- ProMemAssist (UIST 2025), working-memory model for when to help: https://arxiv.org/pdf/2507.21378v1.pdf
- Sensible Agent (Google, UIST 2025), unobtrusive proactive agents: https://research.google/blog/sensible-agent-a-framework-for-unobtrusive-interaction-with-proactive-ar-agents/
- ProAgent, always-on cheap sensors plus on-demand costly ones: https://arxiv.org/pdf/2512.06721
- Generative-agent user studies on proactive timing and control: https://arxiv.org/pdf/2505.09938
- Do proactive agents really need an LLM? (trigger model first): https://arxiv.org/abs/2605.30152
- Bot MOVE-CARRY-01 (lifted, carried, put down from the IMU; thresholds UNMEASURED): `bot/docs/BACKLOG.md` line 2078, `bot/body/maipai_body/presence/motion_state.py`
- Bot KNOCK-01 (impulse under 120 ms, double knock in 1 s): `bot/docs/BACKLOG.md` line 2352, `presence/knock.py`
- StackChan firmware patches 078 and 081 (head tap from strip plus jolt, IMU read every 10 ms) and the orientation poses: `bot/CHANGELOG.md` lines 50 and 70, `bodies/stackchan/orientation.py`
- `robot.state` `motion` and `put_down_count`: `commons/spec/schemas.resolved/robot-state.schema.json`
- DeviceMotionEvent permission on iOS (requestPermission from a user gesture): https://developer.mozilla.org/en-US/docs/Web/API/DeviceMotionEvent/requestPermission_static
- Bot SOUND-EVENTS-01 (on-robot sound tags as hints only, YAMNet-class, 1 Hz, never a safety input): `bot/docs/BACKLOG.md` line 2381; capability `sound_events`: `commons/spec/vocab/capabilities.json`
- Bot MOTOR-RECOVER-01 (stuck servo ladder, Repair at rung 4): `bot/body/maipai_body/presence/motor_health.py`; LINK-STATE-01 (the offline ladder, rungs 0 to 2): `bot/docs/BACKLOG.md` line 1923
- Hub robot check-in fields (battery, charging, rssi, heap) and the offline notice after 10 minutes: `home/backend/src/lib/robotCheckin.ts`, `robotOfflineWatch.ts`, `notificationTypes.ts` `robot.offline`
- Bot power defaults (thermal 70/76/82 C with 3 C hysteresis, the 20 percent return request, the 5 s goodbye grace): `bot/docs/dev.md` lines 1951 to 1956 and 770 to 774
