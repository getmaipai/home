# MaiPai Home and robots: findings (read-only research, 2026-11-18)

Repo: /home/user/home (shallow clone, 53 commits, HEAD cd315ba). Sibling checkouts: /home/user/getmaipai/bot (shallow, 1 commit,
Bot firmware 0.2.213) and /home/user/getmaipai/stackchan (only `.github/ISSUE_TEMPLATE`). No parent CLAUDE.md and no
`getmaipai/.github` checkout exist under /home/user, so the "org standards" and the numbered "platform principles" (principle 2
"the robot is complete without a hub", 3 "no data debt", 7 "hub first", 8 "hard-won logic reused") are cited by Home docs but their
text is NOT in this environment [unverified text].

## 1. Repo boundary rule

### 1a. What was NOT found
- Commit `df13ef9` is not in the Home clone, the bot clone or the stackchan clone (`git cat-file -t df13ef9` fails; clones are shallow).
- No design note named "repo boundaries" exists. `grep -ril boundar docs` hits only unrelated files (security-and-data-lifecycle,
  safety-factual-references, companion-maker, music-handoff, plans). The nearest landed design of 2026-11-16 is
  `docs/design/stack-home-catalog-separation-2026-11-16.md`, which covers Catalog / Stack / Home, and mentions the robot only as a
  LATER row (BOT-PARTS-01). So: there is NO single hard rule in Home that says "this stays in the Bot/StackChan app, that belongs
  in Home". The boundary is spread over the statements below. [If a robot-specific boundary note landed in df13ef9 it is in another
  repo or a newer main than this clone.]

### 1b. The hard rule that does exist: RULES.md "Engine boundary" (E1 to E8)
- File: docs/design/RULES.md:687-720. Status: "Owner rule (Jesse, 2026-11-16...). Owner-approved: 2026-11-16. The rules apply to new
  work at once". Record: docs/design/stack-home-catalog-separation-2026-11-16.md (Status line 3: "accepted (architect APPROVED
  2026-11-16, PARTS-SEPARATION-NOTE); amended the same day to a lean core").
- Who may change: RULES.md:8-10 "Only the owner changes a rule. A rule change is made here, names the design record that argues for
  it, and that record lists what it supersedes." AGENTS.md: "only Jesse changes a rule"; a `RULES.md` diff needs `Owner-approved`.
- The line (separation note section 1, lines 34-40), verbatim table:
  - Catalog: owns "Every package, and the signed published copy of the parts list that update checks read"; never holds "Running state, household choices".
  - Stack: owns "Every action and runtime fact: install, uninstall, update, enable, what fits, what is loaded, what runs or waits, what is wrong, the budget"; never holds "People, age, households, wording for people".
  - Home: owns "People, the age and surface gates, the household's choices, wording, notifications, drawing what the Stack serves"; never holds "Model names, descriptions, download links, checksums, sizes, fit math, engine processes, the Stack's health logic".
  - "The Stack has no users. Home sends the audience (`adult` or `minor`) with every read and every job, and the Stack enforces it. The age and surface gates (rule 0) run in Home before anything reaches the Stack."
- E1 "Home holds no part data." E2 "Home branches on what the Stack answers, never on which part it is." E3 install/uninstall/update
  are Stack calls by id. E4 "Home makes no fit decision." E5 household choice stored once, by Home. E6 a minor gets the minor's list
  only. E7 a model's own knowledge lives in its pack on the Stack. E8 enforced by tests (`lint:no-model-names`).
- Robot hook: "BOT-PARTS-01: the robot reads parts and status" (BACKLOG.md:3706, S, LATER): "the robot's setup lists parts with no
  part name in its code."
- Units (separation note section 9, lines 70-95): outside tools are "a plain MCP server"; components sit behind a role contract;
  "The boundary goes around a whole hot loop, never through it. A voice loop is one unit with one hook (`respond`)"; rule 11 stands
  (only our Stack components run models). Relevant to any robot voice-loop split.

### 1c. Robot-vs-Home statements (design notes; not RULES.md, so they bind as design records under RULES.md)
- AGENTS.md line 3-5: Home is "the platform and the household's master (identity, people, memory, the turn engine, settings, the
  package host, the credentials center, backups, updates, the shell). Every feature ships as a catalog package from
  `getmaipai/catalog`". Shared shapes live in `getmaipai/commons` `spec/`.
- docs/design/devices-and-robot-link-2026-10-17.md:7-21: "The bot repo keeps the robot's own design; this note is the hub's half";
  "The robot's own screens (its face, its spoken lines) belong to `bot`; the hub's job is to be the robot's brain when reachable,
  its asset source, its notification channel, and the one place the family manages it." And line 30-32: "a robot with no hub runs
  its own copy of the same gates (principle 2); a robot never loosens a gate to answer faster. Rule 6a holds on every device row:
  the hub shows health, counts and timings, never what a person said to the robot."
- docs/design/robot-register-test-configure-2026-10-20.md:37-39 "What stays in the bot. A StackChan joining its Bot service (the
  per-device token flashed over USB) is the bot's own pairing and stays on the bot's local page for now." SUPERSEDED in part by
  docs/design/robots-switch-and-install-2026-10-20.md:9-11: "a StackChan installed from Home no longer joins its Bot app on the
  bot's local page. A StackChan whose Bot app runs on another computer still does."
- docs/design/music-identify-2026-11-13.md:21-23: "Home owns `identifySong`... A robot only captures the clip and shows the answer;
  nothing about fingerprinting or AcoustID lives in the bot repo."
- docs/design/robot-face-color-and-night-2026-10-20.md:33: the palette is "a background and ink pair the bot owns".
- docs/design/robot-admin-place-2026-10-20.md: owner ruling "a main subpage should be for user content" -> robot administration
  lives in Home Settings (ROBOT-ADMIN-PLACE-01), architect APPROVED with conditions.
- docs/user/robots.md last line: "For what the robot does, its lights, touch and voice commands, see the StackChan guide in the Bot repository."
- Bot side (/home/user/getmaipai/bot/AGENTS.md): Bot is "a headless service that Home pairs with and uses through one clean,
  vendor-neutral interface. The details of talking to a particular robot ... never leave that robot's profile"; "The household
  runtime (the turn engine, memory, guards, the link) is the hub's own TypeScript code, pinned and run on Bun as the same package".
  Marked "DRAFT 2026-10-14, pending architect review".
- BACKLOG.md:4 "the hub first, the robot for parity, Go last."; BACKLOG.md:2222 BOT-COPY-01 cites "principle 7: hub first".
- docs/plans/stackchan-tester-and-ecosystem-adoption-2026-11-18.md:10 says outright that repo placement is "my best reading of
  `AGENTS.md` ... Confirm the repo before the first commit [verify]" - i.e. the newest plan itself found no explicit boundary rule.
- docs/THIRD-PARTY-SERVICES.md: no robot content (only web "robots" rules for news fetches).

### 1d. Every RULES.md rule that touches a robot
- Rule 0 (RULES.md:23-33): age and surface gates outrank all; "nothing here changes how a spoken turn is shaped"; the talker-first
  opener "never reaches a child, a teen, an unknown speaker, a robot or a shared surface".
- Rule 0, robot paragraph (36-42, Owner-approved 2026-10-21): "A robot's controls set the band for its unknown speaker, never its
  companion"; robot with a companion takes the admin-set controls level (child/teen/adult); "a robot with no companion, and every
  other unknown speaker on a shared surface, gets the child result"; companion audience `all`/`teen`/`adult`, "a companion never
  loosens a filter"; "Speaker evidence alone decides memory access and acting on the signed-in account: an unknown speaker is judged
  at the child band for every effect and reaches none of that person's memories".
- Rule 1 (44-60): model decides search; the embedding rescue "never applies to a spoken turn".
- Rule 4 (around 120): "A spoken turn never tells the person a conversation is too long."
- Rule 5 (126-130): no length cap on adult written chat, but "any spoken turn (robot, pod, phone, or any client that flags the turn
  as spoken) and glance surfaces keep their own limits."
- Rule 6 (131-165): failed tool never fails the answer; "A robot with no hub and no network answers the same way."; fixed clips
  ("an engine outage line, a robot's alarm, carry or pairing line") are not replies, each reviewed against the child floor and
  listed on the privacy page.
- Rule 6a (166+): logs/admin pages carry no person text, ids next to activity; admin troubleshoots from "component health, error
  codes..., timings and counts that name no person". This directly constrains any robot diagnostics dashboard (no transcripts, no
  per-person activity).
- Rule 9 (191-204): NDJSON events (`turn_meta`, `signal`, `delta`, `status`, `spoken_cue`, `done`, `error`) "stay available to the
  robot, the satellites, Go and other clients, with additions only"; heard-prefix storage for interrupted voice replies;
  speculative start "never runs for a minor, a robot, an unconfirmed speaker". Kit Elements as shipped (no shape className) applies
  to any robot admin UI; 9b: shadcn/ui only outside chat.
- Rule 10 (303): output gate, child floor on every sentence. Rule 11 (305): only our own Stack components run models.
- Rule 12 (319-328): port list includes "robot speaker evidence, per-companion reply pools, server-side speech text ... the
  OpenAI-style and Wyoming callers (rewired as spoken turns)".
- Rule 13 (329+): bench carries "a spoken turn with a first-word bar of 3 seconds".
- S6 (511-545): status is defined in one place and "every client reads it (web, voice, robot, Go)"; "A new status surface is a new
  design: it needs an architect verdict" (a robot health tab is a new status surface -> architect verdict needed, DUPLICATE if an
  existing mechanism covers it).
- "Robot vision" R1 to R4 (570-596, Owner-approved 2026-10-21, R1 widened 2026-10-22): R1 picture looked at once and dropped, kept
  only in process memory max 90 s, never on disk/log/route, "no person, admin included, can read them"; R2 only the robot's own
  session, `robot.vision` = continual (default) | on_demand | none, rate/size limited JPEG; R3 look is context never a claim, never
  identify anyone by looks; R4 a robot turn carries no picture. NOTE: R1 forbids any route returning the scene, so a dashboard
  "what the robot sees" readout is ruled out; the separate LIVE-VIEW-01 path (admin/named adults, off by default, 10 min, not
  recorded) is the only camera view.
- "Ambient sensing" A1 to A4 (598-660, Owner-approved 2026-11-13): sound/light/temperature classified once and dropped, typed
  events only, memory 10 min, logs counts only; `device.ambient` default `none` on every device, robots included, admin turns on
  per device; emergency event takes the deterministic safety-alarm path; a proactive turn's listener on a robot is "an unknown
  speaker at the child band"; A4 a device turn carries no audio.
- Engine boundary E1 to E8 (above); C-rules (content ratings, ~731-767): "An unknown speaker and a shared surface get what chat
  rule 0 says"; per-sentence check of every spoken turn.

## 2. Everything Home does for robots today (backend/src)

Device identity and link
- Device record, kinds robot|pod|tv|phone|desktop|browser, hosted robot creation, delete (tombstones robot memories) - lib/devices.ts
- Per-device long-lived tokens (hashed, redeem for a session, prune) - lib/deviceTokens.ts, routes/deviceAuth.ts (`POST /redeem`)
- Durable typed hub-to-robot commands over one authenticated WebSocket per robot: SQLite 24 h, ack stops replay, 15 s heartbeat,
  settings snapshot + `time` on connect - lib/deviceCommands.ts (`/api/devices/me/events`, routes/devices.ts:53)
- Command kinds issued: settings_changed, time, asset_changed, notify, offer, alarm, announce, song_title, live_view_start/stop,
  motor_reboot, wifi_forget, wifi_use, wifi_add (ephemeral), self_test, plus admin `mute|unmute|find_me|dance|music_test|announce|
  prefer_tailnet` (`POST /{id}/commands`, routes/devices.ts:500-547)
- Robot state frames (activity, muted, tracking, battery, motion, thermal, motors latched, versions), stale after 45 s -
  lib/deviceStates.ts, `PUT /me/state`
- StackChan check-in (in memory only; online window 150 s): board, ip, firmware_version, bot_version, rssi, signal, timers_active,
  self_restarts, heal_hold, mic_level, free_heap_internal, free_heap_min, psram_free, boot_reason, crash_resets, battery_level,
  charging, updating, update_progress, wifi_saved, link_encrypted, link_path, link_state, link_attempt - lib/robotCheckin.ts,
  routes/devices.ts:181-199 (`PUT /me/checkin`)
- Offline watch: notification when a robot is silent 10 min (once) - lib/robotOfflineWatch.ts (`robot.offline`)
- Hub endpoints for reconnect (LAN, tailnet when `robot.offlan.tailnet`) - `GET /me/hub-endpoints`
- LAN discovery of Reachy Mini via mDNS - lib/robotDiscovery.ts (`GET /discover-robots`)
- Vendor SSH password rotation and storage (Reachy) - lib/robotSsh.ts, lib/robotCredentials.ts (`/{id}/rotate-robot-password`,
  `/{id}/robot-password-status`)
- Robots master switch `home.robots.enabled` and its one-time migration - lib/robots.ts, lib/robotsSwitchMigration.ts

Hosting and software
- Home runs each hosted StackChan's Bot app as a sidecar (leased ports voice/avatar/vision, single-use pairing secret) -
  lib/robotHost.ts, routes/robotHosts.ts (`POST /hosts`)
- Pinned Bot release download, sha256 + signed SHA256SUMS, safe extract - lib/botRelease.ts, lib/botReleasePin.json (pin 0.2.104,
  repo getmaipai/bot, darwin-arm64/linux-x64/linux-arm64 assets, stackchan firmware tarball, one signing key)
- Browser USB flash: verified signed manifest and parts, encrypted 16 MB flash backup, single-use enroll (NVS) image, revoke -
  lib/stackchanInstall.ts, routes/robotHosts.ts (`/stackchan/flash-parts/{path}`, `/hosts/{id}/enroll-image`, install-status, cancel)
- Firmware OTA check and app.bin download for the robot's own session - routes/devices.ts:228-260 (`/me/firmware-update`)
- Software status (firmware installed/available, Bot running/available/restart needed) - lib/robotSoftware.ts,
  `GET /robots/hosts/{id}/software`; internal key `robot.firmware.installed`
- Bot release check on GitHub only when Robots is on and a robot is paired - lib/updates.ts:202-208

Turn engine and safety
- Robot surface = spoken; unidentified robot speaker is child band unless the robot has a companion and controls level -
  lib/turnMachine/speaker.ts, lib/surfaceClass.ts, lib/robotCompanion.ts
- Robot companion/controls pairing rule, guise ("impression") tool, refusal copy - lib/robotCompanion.ts, lib/impressionTool.ts,
  `GET /{id}/companion`
- Voice choice order: robot voice > companion voice > default - lib/voiceForSpeech.ts
- "Robot status" read-only context block (battery, presence, room, software) for robot turns - lib/turnMachine/nodes/context.ts:350
- Tool gates per robot surface (no house tool on robot; song-name tool needs connected unmuted robot) - lib/turnMachine/toolGates.ts
- No talk-over, no speculative start on robots - lib/talkOver.ts, lib/speculation.ts
- Robot offers (INITIATIVE-01): tiers, hourly cap, snooze/backoff, voice-only acceptance, prepared text spoken through the output
  gate - lib/robotOffers.ts, lib/turnMachine/nodes/commands.ts, migration 0100
- Robot clips: fixed reviewed clip bundle per device/band, floor check, asset_changed push - lib/robotClips.ts
- Robot assets: pinned models (spec `robot-assets.json`) downloaded, verified and served - lib/robotAssets.ts (`/me/assets`)
- Robot people roster (person id, band, follow-up allowed; only enrolled faces) - lib/robotPeople.ts (`/me/people`);
  face print sync - lib/biometricPrints.ts
- Robot memory: device-bound records admitted only on that robot's turns; shown per robot in Memory - lib/memory.ts:416-464,
  lib/memoryProfile.ts:91
- Robot vision: `/me/vision` JPEG -> Stack look -> 90 s in-memory scene line - lib/robotVision.ts
- Scene/ambient: `/me/scene` observations, scene tool, alarm dismissal by speaker evidence - lib/scene.ts, lib/sceneTool.ts, lib/hear.ts
- Live view through the hub (5 fps 640x360, 10 min, admin or named adults, off by default) - lib/liveView.ts
- Self test: `self_test {run_id, part}` for speaker/face/head/lights/mic, 15 s timeout, results in memory 10 min -
  lib/robotSelfTest.ts, lib/robotSelfTestRuns.ts (`POST /{id}/self-test`, `POST /me/self-test/{run_id}`)
- Wi-Fi: add (ephemeral, encrypted link or confirmed LAN only, never stored/replayed), forget, use - routes/devices.ts:549-595,
  docs/dev/robot-wifi-command.md
- Motor reboot offer/answer (Reachy) - routes/devices.ts:597-635, lib/deviceStates.ts
- Safety alarm to robots (`alarm` command, fixed clip, child line, volume floor 70) - lib/safetyAlarm.ts:75,260
- Severe weather announce to robots - lib/weatherAlerts.ts:132; notifications to robots (`notify`) - lib/notifications.ts:281
- Song title on the robot face - lib/songNameTool.ts
- Timers/alarms: no robot delivery code in lib/alarms.ts / quickTimers.ts; robot timers are the bot's own
  (`robot.timers.enabled` "even when Home is off"); Home only shows `timers_active` from check-in. [verified by grep: no
  "robot|device" in those files]
- Wyoming and OpenAI-style callers as spoken turns - lib/wyomingServer.ts, routes/openai.ts
- Privacy rows for robot assets, Bot release, hub endpoints - lib/privacy.ts:137-143, 268, 449

### Robot setting keys
A. backend/src/settings/robotSettingsKeys.json (38 entries; key | scope | type | default | honoured_by | meaning)
- household.quiet_hours.from | household | time | 21:00 | home,bot | quiet hours start; safety alarms override
- household.quiet_hours.to | household | time | 07:00 | home,bot
- person.quiet_hours.from / .to | person | time | null | home | inherit household when unset
- person.robot.follow_up | person | bool | true | home | robot may listen for a follow-up (children off unless parent enables)
- person.robot.greet_by_name | person | bool | true | home
- person.robot.may_address | person | bool | true | home
- person.robot.playful_clips | person | bool | true | home
- person.robot.topics | person | off/nudges/chit_chat/both | nudges | home
- person.vision.gestures | person | bool | true | home
- person.vision.watch | person | off/presence/identify | presence | home
- robot.barge_in.open_mic | device | bool | false | home,bot | advanced; "Off until arrival-day echo-cancellation measurements pass"
- robot.camera.watch_level | device | off/presence/identify | identify | home,bot | stricter of this and the person's level
- robot.follow_up.seconds | device | 0-20 | 8 | home,bot
- robot.gestures.enabled | device | bool | false | home,bot
- robot.greetings.mode | household | off/gesture/spoken | gesture | home
- robot.idle.level | device | still/calm/lively | calm | home,bot
- robot.initiative.accept_phrases | household | default | default | home
- robot.initiative.allowed_here | device | bool | false | home,bot
- robot.initiative.enabled | household | bool | true | home
- robot.initiative.max_offers_per_hour | household | 0-20 | 3 | home
- robot.initiative.tiers_spoken | household | tier_1/tier_1_2/all | tier_1 | home
- robot.live_view.enabled | household | bool | false | home
- robot.live_view.who | household | adults list | [] | home
- robot.offlan.tailnet | household | bool | false | home | advanced
- safety.alarm.child_line | household | text | "Smoke alarm. Please go to your grown-up." | home
- safety.alarm.repeat_seconds | household | 10-60 | 20 | home
- safety.alarm.sensors | household | entity | [] | home
- safety.alarm.voice | household | default | home
- safety.alarm.volume | household | 70-100 | 70 | home
- vision.on_request.enabled | household | bool | true | home
- robot.dance.enabled | device | bool | true | home,bot
- robot.dance.show_ring | device | bool | true | home,bot
- robot.dance.auto | device | bool | false | home,bot
- robot.dance.auto_sensitivity | device | low/medium/high | medium | home,bot
- robot.timers.enabled | device | bool | true | home,bot | robot sets and rings timers itself, even when Home is off
- robot.announce.enabled | device | bool | true | home,bot
- robot.repeat.enabled | device | bool | true | home,bot
B. Home-local keys (ride in Home's registry until a spec tag carries them)
- robot.companion.id | device | text | "" (settings/robotCompanionKeys.ts)
- robot.controls | device | child/teen/adult | child
- robot.companion.guise | device | text | ""
- robot.vision | device | continual/on_demand/none | continual (settings/robotVisionKeys.ts)
- robot.volume | device | 20-100 step 5 | 70 ; robot.brightness | device | 10-100 step 5 | 100
- robot.firmware.installed | device | text | "" internal (settings/robotSoftwareKeys.ts)
C. Referenced in code but defined in the pinned spec (`@maipai/spec` v0.1.422, not installed here): robot.voice.id,
  robot.face.color (default mint per design note), robot.night.mode, home.robots.enabled, device.ambient, device.voice [unverified defaults].
D. Requested by the bot (bot/docs/dev/home-needs-bot-0.2.71-2026-11-13.md) but NOT found in Home source: robot.muted,
  robot.vision_off, robot.quiet, mute.local_unmute, and the `mic_off_verified` read-back.

## 3. Home's robot admin UI (frontend/src)

Entry: Settings > Apps and devices > Devices tab (`/settings/apps?tab=robot`, view `home.devices_admin`;
shell/pages/settings/settingsViews.tsx:32-35,121). People page lists robots under "Pets and robots" linking to the detail
(shell/pages/FamilyPage.tsx:73-77). Updates page has a robot row and `robotsError` (shell/pages/UpdatesPage.tsx:57,183).
Companions page shows which robots use a companion. Ambient companion pane can pick a bot and draws the kit `RobotFace`
(header size; shell/Routes.tsx:332, AmbientCompanionPane.tsx) - a drawn face from settings, not the live unit's face.

- HouseholdRobotsSection.tsx (222 lines): list (name, area, Online / "Offline, last seen" / "Never connected"), "Add a robot";
  detail pane with three tabs:
  - overview: online badge, last seen, IP; RobotSelfTests; RobotActions; RobotWifi (admin); "Software" group for hosted installs:
    Connection (link path home/away/other, link state, Wi-Fi strong/medium/weak, battery %, IP, timers count, self-restarts,
    restart guard, mic level, updating), Robot firmware (installed/available, Update available, Test build), Bot software on this
    computer (running/available, Restart needed); Update firmware button.
  - behaviour: RobotCompanionChoices + generic SettingsRenderer cards for device-scope groups (voice, face colour, night mode,
    follow-up, camera, volume, brightness, dance, timers, announce, repeat ...).
  - access: name, area, Forget this robot / Cancel install.
- RobotSelfTests.tsx: "Test this robot" buttons Speaker / Face / Head / Lights / Microphone -> Passed/Failed + detail + took_ms.
- RobotActions.tsx: Dance, Test music detection, Announce (text + Urgent).
- RobotWifi.tsx: saved networks, Use this network now, Forget, Add network (name, password, "This is my own home network"),
  "Test the tailnet path for 10 minutes".
- RobotCompanionChoices.tsx: Controls (child/teen/adult), Companion, which voice it speaks in.
- AddRobotSection.tsx: mDNS search, six-digit code pairing, 2FA, vendor password rotation. StackChanInstallDialog.tsx +
  lib/stackchan/flash.ts: WebSerial flash (connect, backup, write, check, restart), firmware update. RobotPasswordSection.tsx.
- RobotBody.tsx / RobotCards.tsx (live card: activity badge Starting/Ready/Listening/Thinking/Speaking/Reconnecting/Sleeping,
  mic muted, tracking, being carried, battery bar, body health (stuck/latched motors, thermal), versions, motor reboot yes/no,
  Live view image, Mute/Unmute): `RobotCards` is imported only by DevicesSection.test.tsx - it is NOT mounted in the app today
  (grep). So Live view, mute and the activity state have a backend and a component but no reachable page [verified by grep;
  LIVE-VIEW-01 is still open in the backlog].
- Docs: docs/user/robots.md (66 lines: add, cancel, update, see software, settings, camera memory, companion, voice). No robot
  screenshot anywhere: docs/assets has `hero.png` and `screens/` (397 files) with only generic `settings-devices-*` captures.

Missing versus a diagnostics dashboard
- No per-sensor status page (available / reason); self tests are one-shot buttons, no history, no camera, IMU, touch, servo
  feedback, battery gauge or I2C scan entries.
- Collected but never shown: free_heap_internal, free_heap_min, psram_free, boot_reason, crash_resets, rssi (only the bucket),
  update_progress, connected_since, link_encrypted.
- No latency: no per-stage voice timing (wake, STT, first token, TTS, first audio), no WebSocket round trip, no FPS/frame time.
- No logs or event timeline (rule 6a allows only typed events, codes, counts, timings - none is surfaced per robot).
- No live face preview of the real unit; no state control (set face/expression, head pose, LED, volume now, sleep/wake, reboot,
  mute is unmounted); no "say this as the robot" beyond Announce.
- No command queue view (pending/unacked commands, last ack), no charts or history (check-ins are in memory, latest only).
- The newest plan already proposes this: W7 "Robot health tab" (docs/plans/stackchan-tester-and-ecosystem-adoption-2026-11-18.md):
  "Per sensor: available, with a reason; top KPI strip (online, FPS, battery, Wi-Fi, drops, free RAM); I2C scan; raw JSON toggle;
  per-stage voice latency ... Needs the robot to report these fields (small firmware change)"; W8 "State pills ... with a live
  face preview". Status of that plan: "draft for the owner's go or no-go. Nothing is built."

## 4. Open robot work in Home

Unchecked BACKLOG.md rows (line, ID, size, objective)
- 732 ACTIVITY-01f (S) robot activity surface; needs architect verdict
- 883 MUSIC-ID-06 (M) Home player now-playing reaches the robot face and chat
- 1184 GENUI-12 (S each) answer blocks on Go and the robot (robot speaks `alt`)
- 1226 WAKEWORD-CATALOG-01 (S, catalog) wake word detectors as catalog packages (`catalog/wakewords/` is empty)
- 1844 "Speak MCP for local tools inside the hub" (M, decision first) -> built by CREATOR-32
- 1860 BOTS-AMBIENT-01 (L, commons+Home) the household's bots in the top-right companion spot (01e: firmware `find_me`)
- 1870-1877 SCENE-01a..h (S/M) scene spec shapes, fusion, scene tool, where, prefix proof, HA cues, body without a face (bot), "who am I"
- 1879 MOVE-SCENE-02 (M, bot) StackChan classifies its own motion (BMI270)
- 1885 SELF-SCENE-02 (M, bot) battery and heat ladder; 1886 SELF-SCENE-03 (S, bot+hub) fall path, `robot.fallen`/`battery_low`/`needs_dock` notices
- 1891 DISMISS-04 (S, bot) dismiss a sound without the hub
- 1894-1901 SCENE-02a..g, SCENE-SOUND-BENCH-01: the ambient rule row (rule text is already in RULES.md), Stack `hear`, Home events
  and `device.ambient`, the robot hears (02d = SOUND-EVENTS-01, bot), proactive hints, light/temp, two sound classes on the alarm path, bench
- 1902-1909 SCENE-01i..k2, 01b2, 01j2 weather cue/alerts and "robot already said it" persistence
- 2149 FACE-03 (M) hub-synced face prints on the robot
- 2222 BOT-COPY-01 (S, bot) robot settings guard and copy follow the copy rule
- 2282 APP-KIND-06 (S each) robot and Go parity for package apps
- 2529 APPSTORE-DESIGN-01 app-discovery pages (Bot app page later)
- 2783 BOT-PIN-01 (S) bot to the current spec tag (bot pins spec-v0.1.208; Home pins v0.1.422)
- 2948-2979 link rows: LINK-TABLES-01 (M), "A Device record and `spec/link/`" (M), Sync engine decision (L), LINK-EXPORT-01 (M), round-trip fixtures (S)
- 2991 ROBOT-UPDATE-APPLY-01 (M) one-click Bot release install on a paired robot from a wheelhouse
- 3049 DUPLEX-05 (M, bot) full-duplex robot spike; also DUPLEX-07/08, DUPLEX-NOISE-01, DUPLEX-BENCH-01, STT-SMARTTURN-01 (M), INSTANT-FILLER-01a..d
- 3057 ROBOT-VOICE-02 (S) robot spoken lines "written to bounce"
- 3058 LOOK-01 (L, Stack+Home+commons+bot) shared Look component, robot first
- 3065 STACKCHAN-ADD-FLOW-01 (S) one Add robot flow that asks for the type
- 3066 STACKCHAN-UPDATE-01 (M) firmware update from the page (phase 1 built), then over the air
- 3069 STACKCHAN-ONLINE-TRUTH-01 (S) hosted StackChan shows its own address; online only when the unit is connected
- 3070 STACKCHAN-WIFI-SETUP-01 (M, bot fw) friendlier Wi-Fi setup on the unit
- 3071 STACKCHAN-BACKUP-READ-01 (M) esptool-js readFlash returns no data on ESP32-S3 USB-JTAG
- 3075 ROBOT-BODY-JOIN-01 (later) body whose Bot app runs elsewhere joins from Home's Devices page
- 3076 ROBOT-CLIPS-02 (S) remaining clip classes and bot playback; needs architect verdict
- 3077 CAPTURE-REQ-01 (M) hub asks the robot for one frame inside a turn
- 3078 LIVE-VIEW-01 (M) live view through the hub (hub routes + card button landed 2026-10-16; row still open)
- 3089 ROBOT-VISION-02 (M, bot) the bot posts its camera look
- REALTIME-DOOR-01 (L, later, owner's go) OpenAI-Realtime-compatible door, hub side
- 3374 FORM-CHAT-ROBOT-01 (S, robot) speak package asks on the robot
- 3393 ROBOT-COMPANION-04 (S, commons+home) robot keys move into the commons spec registry
- 3466 AGENT-SPIKE-01 (S) Bun spike of the MCP client; 3589 CREATOR-32 (M) MCP face over Home's tools
- 3706 BOT-PARTS-01 (S, bot, LATER) robot reads parts and status; 3711 PORTABLE-01 (S, LATER) design note for outside units
- 527 FLOOR-ACCEPT-01 (S) floor acceptance run uses "the robot's model as a stand-in for an 8 GB machine"

Notes and design records
- `docs/dev/home-needs-*`: none in Home. They live in the bot repo: bot/docs/dev/home-needs-bot-0.2.65-2026-11-13.md (keys
  robot.dance.*, robot.timers.enabled, robot.announce.enabled ... - these ARE now in robotSettingsKeys.json) and
  home-needs-bot-0.2.71-2026-11-13.md (robot.muted, robot.vision_off, robot.quiet, mute.local_unmute - NOT in Home).
- docs/dev/robot-wifi-command.md: built (Wi-Fi add bypasses the durable table; ANYWHERE-08 tailnet test).
- docs/design/devices-and-robot-link-2026-10-17.md: hub-half design note from the design audit; about half its rows built.
- robot-register-test-configure-2026-10-20.md: design, amends the link note; register/test/configure largely built; "what stays in the bot" superseded in part.
- robots-switch-and-install-2026-10-20.md: owner decisions 2026-10-20; built (switch, Bot host, browser install).
- robot-admin-place-2026-10-20.md: architect APPROVED with conditions; built (ROBOT-ADMIN-PLACE-01).
- robot-face-color-and-night-2026-10-20.md: design for hub, spec, bot; keys referenced in code.
- robot-own-name-and-memory-2026-10-20.md: design; ROBOT-MEMORY-01 visible in Memory UI.
- robot-companions-2026-10-21.md: superseded in part by dynamic-companions-2026-10-21.md (owner ruling, rule 0 edit).
- robot-vision-2026-10-21.md: "built in Home (ROBOT-VISION-01). The robot side is ROBOT-VISION-02, in the bot repo."
- look-component-2026-10-22.md: NEEDS-RULE-CHANGE then R1 edit approved 2026-10-22; "Nothing is built beyond measurements".
- bots-in-the-ambient-companion-2026-10-31.md: owner ask; BOTS-AMBIENT-01 open.
- scene-awareness-2026-11-13.md (1329 lines): architect APPROVED 2026-11-13 (SCENE-01, SCENE-02).
- full-duplex-voice-2026-10-24.md: architect APPROVED; robot spike DUPLEX-05 open.
- NEW 2026-11-18 (HEAD commits): docs/reports/virtual-stackchan-tester-2026-11-18.md, docs/reports/stackchan-ecosystem-audit-2026-11-18.md
  (+15 per-project audits in `stackchan-ecosystem-audit-attachments/`), docs/plans/stackchan-tester-and-ecosystem-adoption-2026-11-18.md
  (draft, nothing built; items W1 to W21: exposure audit/lint, safety scan, SECURITY.md + AI transparency page, camera indicator,
  one speech safety floor, README refresh, Robot health tab, face/emote spec, MCP server with `robot_*` tools, scenario runner on
  a fake unit, golden frames, one schema, software unit, frame-time gate, single servo writer, reflex layer, smart end-of-turn,
  release hygiene, wake-word cost). Its "reality check" table confirms the hub already has reconnect snapshot/replay, durable
  commands, capability list, Smart Turn endpointer (`lib/sttSession.ts`), revocable device tokens and check-in telemetry.
  The plan says "Extend the existing fake unit script" but no fake-unit script was found under scripts/ [unverified; may be in bot].

## 5. MCP status in Home

- README.md:24: "**Plug in more tools with MCP servers.** *Planned.*"
- Already in code: Home's package host runs code packages as MCP servers (`lib/denoHost.ts`) and there is an "unused general MCP
  client" `backend/src/lib/mcp/connector.ts` (+ nameMap.ts, schemaSanitiser.ts; `@modelcontextprotocol/client`, stdio and
  Streamable HTTP, tool allowlist, definition-hash pins, timeouts, result caps). BRANCH-MCP-01 landed 2026-11-06 (7168506)
  (BACKLOG.md:2825). No non-test importer of the connector was found.
- Client side plan (docs/plans/agentic-build-plan-2026-11-06.md, architect APPROVED with six conditions): order SPIKE-01,
  BRANCH-MCP-01, NET-01 (done: one admin-set LAN host per connector), BRAKES-01, HOUSE-01..04, CARDS-01, SVC-01, SELECT-01,
  HOUSE-05 + LIVE-01. Connector choice order: maintained MCP server, then maintained TS client, then our own. First MCP connector:
  official `gitea-mcp` (pinned by commit, read-only allowlist). UniFi/Plex/Uptime Kuma native. MCP and native connectors share one
  registry, pinned by version and digest; offered set at most 12 tools with `find_tools` (AGENT-SELECT-01). Excluded: "any
  connector tool for a child or teen". Spec drift noted (2025-11-25 vs 2026-07-28). Open: AGENT-SPIKE-01, AGENT-CARDS-01,
  AGENT-SVC-01, AGENT-SELECT-01, AGENT-LIVE-01, SPEC-INSTANCES-01. Survey: docs/plans/mcp-connectors-survey-2026-10-03.md
  (proposal: yes for tools we lack, no for weather/sports/music/news/websearch). TOOLS-PROGRAM (L) says MCP work waits on it.
- Server side plan: CREATOR-32 (BACKLOG.md:3589, M, decision first): "Settings > Developer exposes Home's existing chat tools as an
  MCP server for the person's own agents with the same gates", official TS SDK, tokens per docs/CREDENTIALS.md, exit "one tool
  called from an MCP client" (docs/design/creatoros-port-2026-11-13.md section 2.3; "MCP server (15 tools) and agent skill").
- Outside units: separation note section 9 and PORTABLE-01: an outside tool is a plain MCP server with a Catalog entry we write
  and sign; off for children and teens by default; draws nothing of its own.
- Robot MCP: only in the 2026-11-18 draft plan W9 (`robot_say`, `robot_see`, `robot_face`, `robot_move`, `robot_status`,
  `robot_health`, `robot_playback_status`, `robot_privacy_mode`; stdio then loopback HTTP, fail closed without a token; "No tool
  bypasses the age and surface gates"; OpenAPI 3.1 file). Not a backlog row yet. Note `robot_see` would have to respect Robot
  vision R1 (no route returns the scene).

## 6. README.md (259 lines)

- Robots: exactly one mention, line 28: "**Pick a companion.** It gives your chat its voice and look. A robot can use it too and
  speaks in that voice." No robot section, no StackChan mention, no link to docs/user/robots.md or the Bot repo.
- Safety (lines 158-165, "### Adults, family and safety"): "Give everyone a profile. Children are filtered by default and teens get
  more privacy. Guests get the teen limits. Parents set the rest, and the safety filters for children and teens cannot be switched
  off."; "Uncensored for adults. Home adds no content filter for adult profiles..."; "Sign in safely. Passcode boxes, optional
  two-step codes, and a lockout that is per person and per device".
- Privacy (lines 216-220, "## Private by design"): "What you create, say and remember stays on your own computer... nothing trains
  anyone's AI." and "Home does reach out for information it needs from the world: web searches, weather, news and podcast feeds,
  downloads of models and updates, and a daily check for a new release... The Privacy page in Settings lists each one and what it
  sends. There is no tracking and no crash reporting."
- Footer disclaimer (lines 246-257): "The AI in this product runs on third-party models you choose to download. What they say can
  be wrong, offensive, or harmful; it is not medical, legal, or professional advice... Parents decide what children in the
  household can reach." Licence AGPL-3.0.
- AI transparency: ABSENT (no statement of AI-assisted development, no model/data-flow page beyond the Privacy paragraph).
- SECURITY.md: ABSENT at repo root (root holds AGENTS.md, CHANGELOG.md, CLAUDE.md, LICENSE, NOTICE, README.md). No `.github/`
  directory in Home. Also absent in the bot checkout root. May exist in org `getmaipai/.github` [unverified, not checked out].
- CONTRIBUTING: ABSENT as a file; README line 242 says "Contributing starts in the Developer guide. `scripts/check.sh` is the gate;
  it needs a sibling checkout of `getmaipai/.github`."
- Screenshots: README shows only the logo (`<img>` from getmaipai/.github brand). `docs/assets/hero.png` and 397 files in
  `docs/assets/screens/` exist but none is embedded in the README and none shows a robot.
- Parent dir: /home/user holds only `getmaipai/` and `home/`; no CLAUDE.md, no `.github` checkout.
