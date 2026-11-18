# MaiPai Bot: state of the StackChan product (read-only research, 2026-11-18)

Repo: `/home/user/getmaipai/bot` (one squashed commit, `846f85c`, 2026-11-17: "StackChan firmware 0.2.213: roam to a stronger access
point of the same Wi-Fi name when the signal stays weak (patch 154); recipe clears the edited setup-page component before reconfigure").
Nothing was modified or run. Paths below are relative to the repo root unless absolute. `SC` = `body/maipai_body/bodies/stackchan`.
`FW` = `SC/firmware`. `[unverified]` marks what I could not confirm from the files.

Headline facts to keep in mind while reading:

- The record stops before the code does. `CHANGELOG.md` and `body/pyproject.toml:10` end at **0.2.106 (2026-11-14)**; the HEAD commit
  message says firmware **0.2.213 (2026-11-17)** and patch 147 line 285 mentions 0.2.211. About 107 firmware versions have no changelog
  entry. The HEAD message says roaming is "patch 154" but `FW/patches/154-wifi-use-now.patch` header describes only "use this network
  now" [unverified whether roaming was folded into 154].
- `docs/BACKLOG.md` (3,067 lines, 95 open / 59 done rows) is mostly the Pi build and Reachy Mini. Only ~12 rows concern StackChan. The
  StackChan feature record is the CHANGELOG plus ~45 dated notes in `docs/dev/`.
- Nearly every design note says "nothing has run on a unit" at the time it was written. What is proven on hardware is mostly what the
  CHANGELOG "Fixed" entries describe from live logs (2026-10-19 to 2026-11-14).
- Nothing in the Bot repo mentions a move to an own `stackchan` repo, "wave 0", `unit-protocol.md` or ESP-IDF 6.1.1 (section 12).

---

## 1. Original vision and promised features

### 1a. Sources

| Doc | What it is |
|---|---|
| `docs/BACKLOG.md:285` BODY-STACKCHAN-01 | Owner ordered a unit 2026-10-06; "second robot body"; firmware that pairs with hub or bot host, shared spec shapes, servos, screen face, mic/speaker, a body profile. Starting point warble. |
| `docs/dev/design-stackchan-2026-10-14.md` | Body design (DRAFT). Thin body, host translator, Home's STT/turn/TTS, no third party. |
| `docs/dev/design-stackchan-pieces-and-gaps-2026-10-14.md` | Supersedes the above where they differ: custom firmware needed; pieces/gaps/verdicts. |
| `docs/dev/design-stackchan-own-firmware-2026-10-14.md` | 100% own firmware and one own protocol. Marked "Not the chosen path" (Jesse: modify as little as possible). Kept as long-term option. |
| `docs/dev/design-stackchan-firmware-build-2026-10-14.md` | The chosen minimal-patch recipe. |
| `docs/plans/stackchan-companion-2026-10-20.md` | Seven owner-requested companion behaviors plus "more candidates". |
| `docs/user/stackchan.md` | The user-facing promise (156 lines). |
| `README.md:36-52` | Short StackChan pitch. |
| `docs/dev.md` | No StackChan text at all (grep: zero hits). It is the Pi-build design record. |

### 1b. Promised feature list (every item found)

Core promise (`design-stackchan-2026-10-14.md` section 5.2a, `docs/user/stackchan.md:9-17`):

1. No live third party, no data funnel; no vendor hosts compiled in; Home replaces M5/xiaozhi cloud.
2. Answers with Home: same assistant, memory, voices, companions; age gates and output gate apply.
3. Voice conversation with wake word and tap-to-talk; short spoken answers.
4. Face and emotion display mapped from expression cues (model never emits a face token).
5. Head motion (yaw/pitch), clamped host-side.
6. LED ring as state and privacy indicator; "never red"; camera/mic cues that no setting can hide.
7. Camera: on-demand photo ("what is this"), continuous stream for tracking.
8. Face tracking (anonymous) and face recognition on the host ("greet the person at the desk by name"), with a measurement gate.
9. Speaker identity by voice on the host.
10. Reminders/timers.
11. Touch.
12. Battery reading.
13. Offline ladder: with a bot host and no hub it still talks.
14. Pairing through Home's Devices page; per-device token; admin approval.
15. Signed, deliberate firmware updates; OTA reply never offers a URL; full flash backup first.
16. Reproducible pinned build (ESP-IDF 5.5.4, checksums, not vendored).
17. Private-CA `wss://` (later step).
18. Remote reach over Tailscale via the host (later superseded by the unit joining the tailnet itself).
19. Egress proof by packet capture; idle-camera watch.
20. Software e-stop latch; physical stop is the power switch.

Companion plan (`docs/plans/stackchan-companion-2026-10-20.md:21-34`):

21. BOT-SC-WIFI-01: swipe the face to switch/edit Wi-Fi; saved networks; hotspot.
22. BOT-SC-ANIM-01: drowsy, asleep, waking routines.
23. BOT-SC-GAZE-01: look at the speaker gently; setting `robot.look_at_speaker` (default on).
24. BOT-SC-DANCE-01: dance on command; auto-dance to music (`robot.auto_dance`, default off); BOT-SC-DANCE-02 song id.
25. BOT-SC-VISION-01: silent ambient vision (`robot.ambient_vision`, default off) plus a visible "take a picture" mode.
26. BOT-SC-NIGHT-01: Alexa-style whisper in, whisper out (`robot.night_whisper`, default on).
27. BOT-SC-SCREEN-01: display router; hub-made pictures (photo, weather card, camera_feed/Frigate snapshot, alert, status).
28. `robot.wifi_auto_switch` (default on).
29. More candidates (lines 63-72): touch/pet/shake/pick-up reactions; full emotion-to-face mapping with decorators (`self.robot.set_emotion`);
    hardware-truth mic and camera mute from the face menu; alarm, timer and medicine reminders; a single mode state on the ring;
    later: bedtime stories, games (Simon, rock-paper-scissors), Home Assistant control, ambient status on ring and idle screen,
    sentry mode, low-battery event, mmWave presence.

User guide promises (`docs/user/stackchan.md`): "Hi, StackChan" wake or face tap (l.21); ring meanings (l.31-38); face meanings
(l.46-53); sound family (l.61-70); offline phrases (l.72); touch: tap, pet, shake/lift, swipe up quick settings, power-key hold
(l.80-84); spoken commands for volume, brightness, head, nod/shake, dance, "can you see me", "what are you looking at", stop,
repeat, "what did I miss" (l.90-102); little dance (l.108-116); dance to music (l.118-125); repeat/missed (l.129-131); day/night
(l.135); camera privacy (l.139-142); companions and voice (l.146).

Later owner asks that became scope: bring-the-robot-anywhere networking (2026-11-14), wireless update, setup screen with QR "like
professional products", bot management in Home, expressive faces, music notes and song title, mute/vision-off/full-quiet on the face.

README's repo-level tagline also promises (for the Bot in general, `README.md:12-15`): "sees, hears, talks, thinks, moves,
self-charges, and guards your home in sentry mode. It recognizes each person by face and voice". For StackChan: self-charge and
sentry are not built; face/voice recognition is partial (below).

---

## 2. Built vs not built

Legend: BUILT-UNIT = seen working on the unit per live-log changelog entries; BUILT = code and tests exist, unit state unknown or
"not flashed" when written; PARTLY; NOT BUILT; DROPPED.

| # | Feature | State | Evidence |
|---|---|---|---|
| 1 | No vendor hosts / no third party | BUILT (egress capture not recorded) | patches 001, 002, 004, 005, 007; `FW/host-search.sh`; `scripts/stackchan-no-third-party.sh`, `scripts/stackchan-egress-proof.sh`; "no camera watch has been performed yet", egress proof procedure only (`docs/dev/stackchan-unit-measurements.md:280-302`). Tailnet build contacts Tailscale control/DERP by design. |
| 2 | Home answers the turn | BUILT-UNIT | `SC/turn.py` (69 KB), CHANGELOG 0.2.2 to 0.2.11 fixes from live turns. |
| 3 | Wake word + tap | BUILT-UNIT | patches 030, 032, 047, 059, 083, 086; CHANGELOG 0.2.1, 0.2.2, 0.2.29. |
| 4 | Faces | BUILT-UNIT (10 base faces); 7 new faces BUILT, need firmware >= 0.2.93 | `SC/face_set.json`; patches 013, 073, 110, 132; `SC/face_vocabulary.py:12`. |
| 5 | Head motion + spoken head commands | BUILT-UNIT | `SC/head_commands.py`, `head_gate.py`, patch 038; CHANGELOG 0.2.15, 0.2.60 to 0.2.63. |
| 6 | Ring standard, never red | BUILT-UNIT | `docs/dev/led-standard-2026-10-20.md`; `body/maipai_body/indicator/looks.py`; `SC/light_service.py`; CHANGELOG 0.2.65. Stale text: `docs/dev/stackchan-service.md:19` still says the camera cue "lights the full RGB ring red". |
| 7 | Camera photo + stream | BUILT-UNIT | patches 054, 060, 063, 064, 066, 069; `SC/avatar/server.py`; CHANGELOG 0.2.33, 0.2.38, 0.2.58. |
| 8a | Anonymous face/person tracking | BUILT-UNIT | YuNet + YOLOX-nano on host: `SC/person_tracker.py`, `head_search.py`, `presence_watch.py`; CHANGELOG 0.2.59, 0.2.64. |
| 8b | Face recognition (name the person) | PARTLY | `SC/vision_bridge.py` calls `vision.recognize` with consent check (l.219, 290); match/false-accept rates "remain unmeasured" (`stackchan-service.md:125,133`). BACKLOG FACE-01 open. |
| 9 | Speaker identity by voice | NOT BUILT (seam only) | `/api/stt/stream` returns no speaker evidence (`stackchan-service.md:129`). |
| 10 | Timers and alarms on the unit | BUILT (not run on unit when written) | patches 090 to 094, `SC/timers.py`; needs Home tools (`stackchan-timers-and-announcements-2026-11-13.md:64-77`). |
| 11 | Touch: tap, pet, shake, head tap | BUILT-UNIT | patches 021, 046 to 048, 052, 056, 057, 076, 078, 080, 081; `SC/reactions.py`, `head_touch_filter.py`. Pick-up/lift event: NOT BUILT (emitter commented out upstream; user guide l.82 says "Shake it or lift it"). Front-shell tap built but off (`kFrontTapEnabled=false`, patch 081 l.171). |
| 12 | Battery | BUILT-UNIT | patches 009, 010, 141; CHANGELOG 0.2.65 charging flap fix. |
| 13 | Offline behaviour | BUILT | Tier 1 host line (`turn.py _offline_line`), tier 2 sixteen on-unit phrases (patch 118), offline look (112), offline music dance (121, 124). A StackChan with no host cannot converse (stated limit). |
| 14 | Pairing | PARTLY | Token, enrollment code, local `/pairing` page built (`SC/xiaozhi/pairing.py`, `dashboard/server.py`). "No user-facing pairing command" still listed open (`stackchan-unit-measurements.md:83`; `docs/user/stackchan-setup.md:19`). |
| 15 | Signed release + wireless update | BUILT (bench proof list not recorded as done) | `FW/release.sh`, `verify.sh`, `flash_manifest.py`, `scripts/sign-release-sums.sh`; patch 133; `SC/firmware_update.py`. BACKLOG BOT-RELEASE-FLASH-01 still unchecked. |
| 16 | Reproducible pinned build | BUILT | `FW/pins.toml`, `FW/pins/dependencies.lock`, `FW/recipe.sh` (128 `apply_repo_patch` lines + 149 under `--tailnet`). |
| 17 | Private-CA `wss://` | PARTLY (build flag only) | patch 008, `recipe.sh --ca-file`, `SC/xiaozhi/tls.py`. Unit link is plain `ws://` today; "host-side time handoff and TLS transition remain unverified" (`FW/README.md:9`). |
| 18 | Away from home | PARTLY | Trip stopgap built (patches 144, 146, 152; `body/scripts/trip_relay.py`). Unit tailnet client built, on-device test open (147 to 149, 153; BACKLOG ANYWHERE-01). |
| 19 | Egress proof, idle-camera watch | NOT DONE (tooling only) | above. |
| 20 | Software e-stop | BUILT | `SC/estop_recovery.py`; `docs/user/stackchan.md:156`. |
| 21 | Wi-Fi from the face | PARTLY | Quick settings lists up to four saved networks to switch (patch 036); tools `self.wifi.list_saved/add/forget/switch/use_now` (023, 154); Home `wifi_add`/`wifi_forget` (0.2.97). Adding a network on the touchscreen (stage 1b), QR scan (135), strict priority (134), setup window (137 to 139): NOT BUILT (no such patch files). |
| 22 | Drowsy/asleep/wake routines | BUILT-UNIT | `SC/routines.py`, `expression/rest.py`; CHANGELOG 0.2.52 to 0.2.57. Sleep-Z animation off (`routines.py:20`, `sleep_z.py:9` `SLEEP_Z_FIRMWARE=None`; no firmware tool). |
| 23 | Look at the speaker | PARTLY | Face-based turn to the speaker works (0.2.18). `SC/speaker_gaze.py` not wired in `app.py`; sound direction rejected (section 3). `robot.look_at_speaker` never registered. |
| 24 | Dance on command, dance to music, song naming | BUILT-UNIT | `SC/dance.py`, `music_dance.py` (43 KB), `music_identify.py`; patches 020, 100, 101, 121, 123 to 131, 140; 20+ changelog entries from live logs. |
| 25 | Silent ambient vision | PARTLY | `SC/ambient_vision.py` built, not wired (no reference in `app.py`). A different path shipped instead: `SC/vision_post.py` posts scene pictures to Home (`robot.vision`). |
| 26 | Whisper night | NOT BUILT | No "whisper" anywhere in `body/maipai_body`; plan status "not started" (plan l.89). Night mode itself is built (`presence/night.py`). |
| 27 | Display router, hub pictures, weather, Frigate | NOT BUILT beyond a pure router | `body/maipai_body/robot/display.py` has no caller; JPEG decoder removed from firmware (099), so host-sent images cannot be shown without dropping that patch. |
| 28 | `robot.wifi_auto_switch` | NOT BUILT | key not in code. |
| 29a | Mute / vision off / full quiet on the face | BUILT | patches 105 to 108, 122; `SC/privacy.py`. |
| 29b | Heart symbol tool `self.screen.show_symbol` | NOT BUILT in firmware | host asks (`SC` reactions, 1 reference); no patch defines it (grep of `FW/patches`: none). Falls back to smile; patch 132 added a `love` face instead. |
| 29c | Medicine reminders | NOT BUILT | BACKLOG MEDS-01 open. |
| 29d | Games, bedtime stories, Home Assistant, sentry, mmWave, self-charge | NOT BUILT | no code. |
| 29e | Announcements from Home | BUILT | `SC/announce.py`. |
| 29f | "Say that again" / "what did I miss" | BUILT | `SC/repeat.py`; CHANGELOG 0.2.66. |
| 29g | Self-healing | BUILT | patches 083 to 086, `SC/self_heal.py`, `SC/xiaozhi/watchdog.py`. |

### Open StackChan backlog rows (id, size, short text)

| Id | Size | Text (short) | Line |
|---|---|---|---|
| BODY-STACKCHAN-01 | none given | second robot body, M5Stack StackChan; "Not built yet" (stale: the body exists) | 285 |
| BOT-SELF-TEST-01 | M | paired robot reports its parts and answers Home's part-by-part test; add `mic`, `screen`, `no_vendor_login` capabilities | 286 |
| ANYWHERE-01 | L | robot joins the household tailnet itself; spike done, on-device test open; 25 KB internal RAM gate | 2820 |
| ANYWHERE-06 | L | setup window and diagnostics page, iPhone first (QR, WPA3 hotspot, captive page) | 2822 |
| ANYWHERE-07 | M to L | bot management in Home (path, versions, Update button, restart, rename, forget key) | 2823 |
| ANYWHERE-05 | L | permanent away-from-home connection; trip stopgap in progress | 2824 |
| ANYWHERE-04 | S | `stackchan_flash.py` no-NVS mode (a separate `stackchan_flash_nonvs.py` already exists, CHANGELOG 0.2.102) | 2825 |
| ANYWHERE-03 | L | settings window and page served by the robot (design only, after security review) | 2827 |
| ANYWHERE-02 | M | saved Wi-Fi list, sharing and priority; host portion shipped; strict priority is patch 134 (not written) | 2829 |
| BOT-RELEASE-FLASH-01 | M | release ships a flashable set with a signed manifest; "release half built; firmware NVS patch open" | 3017 |
| BOT-MEMORY-01 | M | Bot app keeps only its own robot's memories | 3059 |
| MEDS-01 | M | robot delivery for private medicine reminders | 3009 |
| ROBOT-TAILSCALE-01 (bot half) | M | detect a hand-joined tailnet; superseded for StackChan by ANYWHERE-01 (l.2403) | 1859 |

Done StackChan rows: BOT-STACKCHAN-ENROLL-01 (3025), BOT-HUB-BUILD-01 (3031), BOT-FACE-NIGHT-01 (3037). ANYWHERE-08 is named in
CHANGELOG 0.2.104 but has no backlog row. The backlog's own profile still lacks `mic`/`screen`: `SC/profile.py:69-77` lists
`lease, estop, head_pan_tilt, light_ring, speaker, camera, battery_readout`.

---

## 3. What was cut, parked or deferred, and why

Firmware strip (`docs/dev/stackchan-firmware-strip-2026-11-13.md`; owner: voice agent and its settings only, no Bluetooth):

| Cut | Patch | Saved | Consequence |
|---|---|---|---|
| Chinese font + emoji set | 096 | 1,301,243 bytes of assets | CJK and emoji draw as nothing; a Chinese Wi-Fi name shows blank (l.85-86) |
| Mooncake apps (launcher, Setup incl. servo calibration, app center, ESP-NOW controller, EzData, vendor dance app, phone-call app) | 097 | 548 KB flash, 24,252 bytes internal RAM | no way to the vendor Setup app; servo calibration no longer on the unit (l.103-105) |
| Bluetooth | 098 | 10 KB flash, 788 bytes RAM (most already gone with 097) | phones cannot reach the unit over BLE (l.119) |
| 4G/RNDIS boards, ten activation sounds | 099-wifi-only | 14,000 bytes | none |
| JPEG decoder | 099-no-jpeg-decoder | 63,968 bytes flash, 18,252 bytes internal RAM | host-sent video/images cannot be shown (l.150) |
| Total | | app -635,504 bytes (-16.7%), static internal RAM -43,292 bytes | |

Memory- or stability-driven cuts and reversals:

- Stop word (MultiNet `mn5q8_en`): first flash turned itself off (cost 10,752 bytes against a 6 KB limit); moving the opus stack to
  PSRAM (051) freed 24 KB but 0.2.24 stalled 30 to 45 s and reset; 053 reverted and turned the stop word off
  (`docs/dev/stackchan-spoken-stop-2026-10-21.md:105-164`). It is back in the build config (`recipe.sh:460`
  `CONFIG_SR_MN_EN_MULTINET5_SINGLE_RECOGNITION_QUANT8=y`, strip note l.63 "wake word and stop word still load"); its reliability on
  the unit is [unverified].
- PSRAM task stacks: any task that touches flash/NVS must have an internal stack; a PSRAM-stack task aborted the unit (patch 069
  stall record, fixed by 074; CHANGELOG 0.2.55). Rule restated in `stackchan-combined-image-proposal-2026-11-14.md:48`.
- `CONFIG_SPIRAM_TRY_ALLOCATE_WIFI_LWIP=y`: measured worse on the unit (low-water 2 KB, largest block 6.6 KB against 29.7 KB and
  28.7 KB without); stays off (`recipe.sh:465-466`). CHANGELOG 0.2.104 line 28 says "Wi-Fi and lwIP buffers try PSRAM first", which
  contradicts the recipe comment.
- Patch 042 (uplink Opus voice mode, complexity 3) overflowed the 24 KB wake-word encode stack; removed (CHANGELOG 0.2.12).
- Patches 040, 041, 043 (decoder priority, update-task sleep, cached head angles) removed "until each can be booted on the unit by
  itself" (0.2.13). Files no longer in `FW/patches`.
- Avatar/camera channel held off until 32 KB internal RAM was free (patch 054; `stackchan-vision-channel-2026-10-21.md:31-35`).
- MicroLink with all stacks internal "does not fit" (42 to 52 KB against a 53 KB low-water) (`stackchan-anywhere-network-2026-11-14.md:38`).

Parked or unapplied patch files (present in `FW/patches`, absent from `recipe.sh`):

- `045-control-panel.patch`: top-edge drop-down sheet; parked 2026-10-21 "until swipes work; the stock panel may then be enough"
  (`stackchan-control-panel-2026-10-21.md:106-107`).
- `082-sound-direction.patch`, `082-sound-tap.patch`: the two mics are stacked vertically, so left/right cannot be told by sound
  (CHANGELOG 0.2.61; `docs/dev/stackchan-sound-direction-2026-11-12.md`).
- Missing numbers: 006, 022 ("reserved for the emotion tool, not written"), 024 to 029, 031, 035, 040 to 043, 087 to 089, 102 to 104,
  109 ("intentionally unused"), 134 to 139 (strict priority, QR scan, MicroLink slot, settings window: designed, not written), 150.

Behaviour removed on the owner's word:

- Ring rows: sleep glow, charging breathe, thinking, speaking, connecting, error, offline double pulse, alarm, held, muted, offer,
  updating, pink "I see someone"; settings `robot.indicator.sleep_eyes`, `.alarm`, `.sees` (CHANGELOG 0.2.65 "Removed").
- Three-tap dance trigger (0.2.66). Dance start chime and all "routine" chimes (0.2.96). Hourly/daily dance caps (0.2.76).
- Sleepy face at idle and `doubtful` as the thinking face (owner read them as creepy/confused; 0.2.18, led-standard l.99).
- Screen flip when upside down: compiled out after it froze tool calls (0.2.40, 0.2.42).
- Charging "stay still" rule lifted for spoken commands and face search (0.2.59, 0.2.62).
- Tailscale key minted by Home through the API: dropped 2026-10-15 (paste-only) (`stackchan-anywhere-network-2026-11-14.md:74`).
- Travel router and iPhone relay app: rejected by owner (same doc l.7). UDP beacon discovery rejected without auth.
- `esp_local_ctrl` / `wifi_provisioning` Security 2: rejected (needs a native app) (l.118).
- NVS encryption: not done now (burns an eFuse) (`stackchan-permanent-away-and-management-plan-2026-11-14.md:106`).
- xiaozhi `notify {audio_url}`: off (`SC/profile.py:113` `STACKCHAN_NOTIFY_ENABLED=False`); v2.3.0 archive has no handler.
- Own firmware / own protocol: not chosen.

Temporary switches still in code: `SILENCE_UNIT_SOUNDS = True` (`SC/sounds.py:120`, applied only to firmware older than 0.2.102,
l.284); `SLEEP_ANIMATION_ENABLED = False` (`SC/routines.py:20`).

---

## 4. Memory budget

Hardware: CoreS3, ESP32-S3 240 MHz, 16 MB flash, 8 MB PSRAM (`design-stackchan-2026-10-14.md:26`).

Flash partition table (after patch 095; `stackchan-firmware-strip-2026-11-13.md:30-37`, `stackchan-wireless-update-2026-11-14.md:8`):

| Partition | Offset | Size |
|---|---|---|
| nvs | 0x9000 | 0x4000 (16 KB) |
| otadata | 0xd000 | [unverified size] |
| phy_init | unchanged | [unverified] |
| ota_0 / ota_1 | unchanged | 0x4f0000 = 5,177,344 bytes each |
| assets | 0xA00000 | 0x5F0000 = 6,225,920 bytes (was 4,194,304) |
| coredump | 0xFF0000 | 64 KB (was at 0xE00000) |

Sizes:

| Build | App image | Assets image | Source |
|---|---|---|---|
| Baseline, patches 001 to 081 | 3,812,368 | 3,794,083 (400,221 free of 4 MB) | strip note l.21 |
| After strip (to 099) | 3,176,864 (2,000,480 free in slot) | 2,492,840 (3,733,080 free) | strip note l.27, 35-36 |
| + sounds 115 to 118 | 3,238,000 (1,939,344 free) | 2,625,313 (3,600,607 free) | `stackchan-sounds-2026-11-13.md:100-103` |
| Timers build | 3.83 MB of 4.99 MB slot [pre-strip measure] | | timers note l.43 |
| Tailnet build (147 to 149) | 3,421,920 (34% of slot free); static internal RAM +2.2 KB; PSRAM +131 KB | | permanent plan l.15-16 |
| Wake model `wn9_histackchan_tts3` | 292 KB (assets) | | spoken-stop note l.10 |
| Stop model `mn5q8_en` | about 2.1 to 2.2 MB (assets) | | spoken-stop l.34; `recipe.sh:406` |

Internal RAM (the constraint; PSRAM is not: about 7.1 MB free of 8 MB, anywhere note l.33):

| When | Free | Low-water | Largest block | Source |
|---|---|---|---|---|
| 2026-10-20, after boot | 53.6 to 55.5 KB | 41.4 to 42.1 KB | | spoken-stop l.27 |
| 2026-10-20, steady use | 23.4 to 34.2 KB | 12.5 KB lowest seen | | l.28-29 |
| 0.2.25 stable build | about 18 KB | 9,971 bytes | 6,656 bytes | vision-channel l.33, 50 |
| 0.2.24 with opus stack in PSRAM | | 27 KB (but stalled) | | spoken-stop l.160 |
| 2026-11-14 live unit (after strip) | about 76 KB | 53 KB | 55 KB | anywhere note l.37 |
| Static DIRAM | 211,583 before strip, 168,291 after | | | strip note l.21, 27 |

Per-item costs: opus_codec stack 24,576 (uses 20,036; cannot shrink much); LVGL draw buffer 12,800 halved to 6,400 (058);
audio_input 6,144 to 4,096; ws_reconnect 6,144 to 4,096; stop model 10,752 to 11,092 internal; avatar channel needs 32 KB free to
start; MicroLink stacks 42 to 52 KB (46 KB per patch 149 header), estimated about 20 KB internal after the PSRAM-stack patch;
setup window estimated 20 to 30 KB while open (not measured). sdkconfig: `SPIRAM_USE_MALLOC=y`, `MALLOC_ALWAYSINTERNAL=512`,
`MALLOC_RESERVE_INTERNAL=64 KB`, `MBEDTLS_EXTERNAL_MEM_ALLOC=y`, `FREERTOS_TASK_CREATE_ALLOW_EXT_MEM=y`.

Gates: tailnet image needs internal low-water >= 25 KB for 10 minutes and largest block >= 16 KB with voice, camera watching and
MicroLink all running (BACKLOG ANYWHERE-01; proposal l.49). Plan calls it "plausible but thin".

Known not to fit or not to work: MicroLink with internal stacks; stop word under the original 6 KB limit; any flash-writing task on
a PSRAM stack; Wi-Fi/lwIP pools in PSRAM; Opus complexity 3 on the wake encode stack; TLS on a similar board failed when LVGL held
internal RAM (i41 report, gap O); `wss://` RAM on our build is unmeasured.

Other measured limits: 9 Wi-Fi RX buffers and a 3-packet block-ack window (bursts of 30 frames stalled 1.5 s); decode queue 40
frames (2.4 s); MCP tool latency 13 to 834 ms, `get_head_angles` up to 2,040 ms; ambient light sensor reads 1 to 2 percent of true
lux behind the glass; relay-only tailnet OTA took 498 s against 26 s direct.

---

## 5. Wake word and speech stack

Wake word:

- Engine: Espressif ESP-SR AFE with WakeNet 9, model `wn9_histackchan_tts3` (292 KB), on the unit, core 1, priority 1, 512-sample
  feed at 16 kHz (`stackchan-spoken-stop-2026-10-21.md:9-33`). Phrase: "Hi, StackChan" (the vendor's stock model; not "hey maipai",
  which is the Reachy/openWakeWord path in `AGENTS.md`).
- Loaded from the assets partition (patch 030); fixed for the persistent socket (032); visible to the host through `wake_stats`
  (059); on-unit digital self-test and rebuild (086) run by the host 60 s after every turn and hourly.
- Default: always armed at idle; off while muted/full quiet (107). No sensitivity setting exposed.
- Known issues: went deaf after hours because the AEC used MIC2 as its reference and "cancelled the person"; now runs with the
  canceller off and no reference (083; `FW/README.md:78`). A true speaker-loopback reference (MIC3) was tried and rejected (clock
  broke on 3 of 5 boots). So wake during the robot's own speech has no echo cancellation; barge-in by wake word is unproven.
  Wake could not fire while the robot danced (motor noise), fixed with a 2 s listening gap (0.2.98). False-accept rate never
  measured.
- Stop word: MultiNet `mn5q8_en`, seven commands (stop, stackchan stop, be quiet, quiet, that's enough, never mind, cancel), armed
  only while speaking (049), also ends a timer ring (094). History in section 3.

Speech stack (all recognition and synthesis are off the unit):

| Stage | Where | How | File |
|---|---|---|---|
| Uplink | unit to host | Opus 16 kHz, 60 ms frames over the xiaozhi WebSocket | `SC/xiaozhi/server.py` |
| Decode | host | PyAV Opus to mono 16 kHz float32 blocks | `SC/turn.py` |
| STT + VAD + end of turn | Home | `/api/stt/stream` (`ready`, `vad`, `partial`, `final`, `no_speech`); host gives up after 1.5 s with no VAD event, waits up to 12 s for a final after speech; 0.5 s minimum speech; 2 reconnects | `turn.py:80-82`, `speech/stt_stream.py`; CHANGELOG 0.2.9, 0.2.10 |
| Unit VAD | unit | WebRTC VAD inside AFE (stats only: `vad_speech`) | spoken-stop l.18 |
| Turn | Home | turn route; built-in answers from the final message | `speech/turn_client.py` |
| TTS | Home/Stack | `/api/tts` (Chatterbox Turbo), resampled to 24 kHz, Opus 24 kbps SILK, one 60 ms frame per packet; 14-frame lead, paced | `turn.py:36-48`; unit-measurements l.133-144 |
| Local intents (before the hub) | host | volume, brightness, head, dance, stop phrases, repeat, "can you see me" | `SC/volume.py`, `brightness.py`, `head_commands.py`, `stop_phrases.py`, `repeat.py` |
| Follow-up window | host | 5 s after a reply (`FOLLOW_UP_S`); `robot.follow_up.seconds` default 8 on the Reachy path | `turn.py:56`, `speech/follow_up.py:27` |
| AEC | unit | off for the wake front end; hello never advertised `features.aec` (bench: `{"mcp": true}` only) | unit-measurements l.39 |
| Barge-in | unit + host | tap, swipe down, wake word or stop word abort and drop queued frames (061, 063); uplink during speech is dropped unless `features.aec` is true, plus a 180 ms guard | `stackchan-service.md:146`; open-mic barge is `robot.barge_in.open_mic` default off (`speech/barge.py:64`) |
| Offline voice | unit / host | 16 pre-rendered phrases on the unit; host tier-1 clips (Pocket TTS) | patch 118; `speech/offline_clips.json` |

Unmeasured: abort-to-silence, first-audio latency, AEC duplex ("no duplex rows have been recorded on the unit yet",
unit-measurements l.316). A small start/end stutter was "still open" in BOT-SELF-TEST-01.

---

## 6. On-robot UI inventory

### Faces (mint skin, `FW/patches/013-mint-face-skin.patch`, `skins/mint/mint.cpp` in the patched tree)

| Face | Look | Defined by |
|---|---|---|
| neutral | two round dots, soft smile | 013 |
| happy | "^" arcs, wide smile | 013 |
| sad | dots with raised inner brows, flat mouth | 013 |
| angry | ">" "<" slants, teeth | 013 |
| doubt (sent `doubtful`) | left dot, right flat line with brow, wavy mouth | 013 |
| sleepy | "u" arcs, small oval, "Zzz..." | 013 (096 made the ellipsis ASCII) |
| surprised | larger dots, open oval | 013 |
| wink (sent `winking`) | left dot, right "^", tongue | 013 |
| sleeping | eyes and mouth shut, no Zzz | 073 |
| listening | dot radius 10, short closed mouth | 110 |
| thinking | eyes up-right, small level mouth | 110 |
| joy, content, excited, shocked, curious, love (heart-outline eyes), worried | seven new shapes | 132 |
| dizzy, silly | logical names only; no firmware face (fall back to doubt, wink) | `SC/face_vocabulary.py:33-34` |

Host maps: `SC/face_set.json` (10 names, generated), `SC/face_vocabulary.py` (19 logical names, `NEW_FACES_FIRMWARE=(0,2,93)`),
`SC/expression_map.py` (cue and mood maps), `SC/idle_faces.py` (weighted idle looks every 30 to 90 s), `SC/meeting_faces.py`
(arrived/recognised/child/stranger/left/returned; only `returned_after_long` is wired), `SC/sleep_z.py` (no-op),
`SC/xiaozhi/server.py:44-60` (`FIRMWARE_EMOTIONS`). Doc drift: `docs/dev/stackchan-faces-2026-11-14.md:28` says
`NEW_FACES_FIRMWARE` is `None`; the code says `(0, 2, 93)`.

Face modifiers and states: blink, idle eye drift and mouth animation (upstream); mute = flat sealed mouth, vision off = eyes shut
(108, 122; was half-lidded); full quiet = sleeping face with a pause mark (105); seven palettes mint, sky, peach, lavender, lemon,
rose, cloud plus a black night face (017; `settings_keys.py:9`); reserved grey-blue `offline` palette (112); heart and dizzy
decorators (upstream; stock stroke reaction switched off in 048).

### Overlays, banners, pages

| Element | Patch |
|---|---|
| Shared link screen (black, glyph + text): "Connecting to Wi-Fi...", "Wi-Fi setup needed" + hotspot name + address, "Connecting to Home...", "Waiting for Home to approve me" (key glyph) | 111 (replaced 033's boot cover) |
| Corner strip: "Offline" (after 45 s since patch 143; was 10 s), connecting glyph cycling after 3 s, approval strip, "Can't reach Home" note for 3 s | 112, 113, 143, 075 |
| Quick settings (swipe up): Volume slider 20 to 100, Brightness slider 10 to 100, up to four saved Wi-Fi buttons, Done; toast "Volume N", "Switching Wi-Fi" | 036 |
| Timer/alarm/announcement card with label on a happy face | 091 (upstream reminder card) |
| Music notes: up to three notes hopping between eight anchors | 123 |
| Song title: bottom centre, 28 characters, cleared after 60 s; white bold on a solid black bar | 123, 140 |
| Updating: spinner arc 34 px plus 110 px progress bar | 133 |
| Status bar and toast (upstream `apps/common`, kept) | 097 |
| Wi-Fi setup captive web page (phone browser, `esp-wifi-connect`), edited to stay open after a save | `recipe.sh:549-562` |
| Not built: touchscreen Wi-Fi keyboard, QR setup screen, diagnostics page, on-robot settings beyond quick settings, any game | plan stages 1b, 4 |

### Gestures

| Gesture | Action | Patch |
|---|---|---|
| Tap face (not in a toggle zone) | start listening; tap again stops; 0.8 s debounce; taps starting in the top 24 px ignored | 047 |
| Swipe left / right | volume -10 / +10 | 036 |
| Swipe down | stop talking | 036 |
| Swipe up | quick settings | 036 |
| Tap mouth | mute on/off (was a 0.5 s hold; changed to tap in 0.2.72) | 105 |
| Tap an eye | vision off/on | 105 |
| Tap forehead | full quiet on/off | 105 |
| Edge margins 28 px top, 20 px sides/bottom never toggle | | 105 (`maipai_touch_core.h`) |
| Pet / rub / tap the head strip | smile or heart for about 3 s | 048, 052, 056, 076, 078, 080, 081 |
| Shake | surprised face + spoken line | 057 |
| Tilt / upside down / face down | pose face + joke line | 067, 071, 072; `SC/orientation.py` |
| Touch during a timer ring | ends the ring | 093 |
| Hold power key about 1 s | ring dark, eyes shut before the PMIC cut | 114 |

Doc drift: `FW/README.md:64` and `home-needs-bot-0.2.71` still describe holds for mute and quiet.

### LED ring (`docs/dev/led-standard-2026-10-20.md:29-37`; `body/maipai_body/indicator/looks.py`; `SC/light_service.py`, `ring.py`, `ring_indicator.py`, `light_wiring.py`)

| Key | Colour / style | When |
|---|---|---|
| live | green steady, floor 0.5 | audio streaming to Home |
| camera | pink, two flashes then steady, floor 0.5 | a picture is taken |
| pairing | cyan pulse 2 s, 0.6 | setup/pairing waits for a person; also a ringing timer |
| attention | amber pulse every 10 s, 0.3 | Home unreachable, fault, battery < 15% (dark at night) |
| listening | blue steady | wake/tap until the turn closes |
| dance | magenta fact; the dance paints gold, lime, mint | little dance (dark at night) |
| idle | dark | everything else |

Channel max 168, 12 pixels; a test parses the table.

### Sounds (`docs/dev/stackchan-sounds-2026-11-13.md`; `FW/assets/sounds`, `FW/assets/phrases`; `SC/sounds.py`)

- Seven earcons in the app image: `needs_you`, `plug_in`, `charged`, `unplug`, `offline`, `goodbye` (no caller), `shutter`.
- Five stock tones: `success`, `popup`, `vibration`, `exclamation`, `low_battery`.
- Sixteen offline phrases in five groups: `no_wifi` x4, `no_host` x4, `connecting` x3, `refused` x3, `back` x2.
- `wake_selftest.pcm` (test fixture).
- Host gate `CHIME_ALLOWED`: needs_you, plug_in, unplug, charged, low_battery, shutter, goodbye, exclamation; 60 s gap, 20 a day.

### Motion "effects"

Firmware keyframe dances Happy, Robot, Panic, LookAround (upstream `dance.h`) through `self.robot.dance`; "bob" (131); beat sway
(128, 130, `FW/assets/maipai_beat.h`); host primitives listen, glance, tilt, nod, perk, attend, settle, speak (`SC/renderer.py`);
person/face follow and search (`SC/person_tracker.py`, `head_search.py`); rest stages (`SC/routines.py`).

### `docs/dev/stackchan-faces-preview-2026-11-13/`

Two files only: `gen.py` (5,830 bytes, draws stills from `mint.cpp` numbers) and `sheet.png` (47,904 bytes). It is the only image
in the repo. I viewed it: a 3x3 grid of 320x240 stills.

1. Row 1: `neutral (today)` mint background, two dots, curved smile; `listening (NEW)` larger eyes, shorter smile;
   `thinking (NEW)` eyes shifted up-right, short flat mouth.
2. Row 2: `offline: muted palette, strip` grey-blue face with a dark pill top-left reading "Offline" beside a slashed Wi-Fi glyph;
   `connecting: normal palette, glyph cycles` mint face with a small Wi-Fi pill; `waiting for approval` grey-blue face with a pill
   "Waiting for Home to approve me" plus slashed Wi-Fi and key glyphs.
3. Row 3 (black link screens, white text): "Connecting to Wi-Fi..."; "Wi-Fi setup needed / Hotspot: <name> / Config URL:
   <address>"; "Waiting for Home to approve me" with slashed Wi-Fi and key glyphs.

No preview exists for the seven patch-132 faces, the song bar or the update overlay (the notes mention preview sheets that are not
committed).

---

## 7. Host settings page / dashboard

There is no settings page on the Bot host. All settings are Home registry keys that arrive in the hub's `settings_changed` frame
and hello values; the Bot only honours them.

What the host does serve:

- `body/maipai_body/dashboard/` + `static/dashboard.html/.js/.css` (EXPR-05, port 8050 by default, `__main__.py` wires it to the
  Reachy profile): three schematic views (top, front, side), Telemetry table, Funnel table, a Direction slider, one button per
  expression primitive, a Mute button, and a nav link to `/pairing`.
- `/pairing` (`dashboard/server.py:284-316`): table of pending Device-Id, Client-Id, first seen, with Approve and Refuse.
- `static/index.html`: the link page (pairing code, Connected, Reconnecting/Asleep).
- `body/scripts/stackchan_control.py`: bench page on `127.0.0.1:8790` (LED, head, faces, volume, say box).
- `body/scripts/trip_relay.py`: local status page on `127.0.0.1:8899`.

Settings honoured by the Bot (defaults are the Bot's fallback when the key is absent):

| Setting | Default | What it does | Where |
|---|---|---|---|
| `robot.face.color` | `mint` | face palette (mint, sky, peach, lavender, lemon, rose, cloud) | `settings_keys.py:3,9,12-17` |
| `robot.night.mode` | on | night rule: dim, quieter, still | `settings_keys.py:4,20-25` |
| `household.quiet_hours.from` / `.to` | 21:00 / 07:00 | quiet hours | `settings_keys.py:5-6`; `indicator/settings.py:50-51` |
| `robot.power.warn_at` | 20 (clamped 16 to 50) | battery percent for the low-battery line | `settings_keys.py:7-8,55-62` |
| `robot.timers.enabled` | on | setting new on-unit timers/alarms | `settings_keys.py:30` |
| `robot.announce.enabled` | on | Home announcements | `settings_keys.py:33` |
| `robot.muted` | off | hard mic mute request | `settings_keys.py:34` |
| `robot.quiet` | off | full quiet: no listening, sound or movement | `settings_keys.py:35` |
| `robot.repeat.enabled` | on | "say that again" / "what did I miss" | `settings_keys.py:39` |
| `robot.vision_off` | off | stop camera capture and analysis | `settings_keys.py:42` |
| `robot.mute.local_unmute` | on | whether the face may unmute (doc calls it `mute.local_unmute`) | `settings_keys.py:43` |
| `robot.sounds.enabled` | on | event sounds | `settings_keys.py:48` |
| `robot.sounds.night` | off | event sounds at night | `settings_keys.py:49` |
| `robot.dance.enabled` | on | dance when asked | `SC/dance.py:49,182` |
| `robot.dance.show_ring` | on | light show during the dance | `SC/dance.py:50,183` |
| `robot.dance.auto` | off | dance to music; also switches on-unit music analysis | `SC/dance.py:51,184` |
| `robot.dance.auto_sensitivity` | `medium` | low / medium / high | `SC/dance.py:52,185` |
| `robot.camera.watch_level` | `identify` | off / presence / identify (camera watching) | `app.py:1833,1880` |
| `robot.vision` | `continual` | scene pictures to Home: continual / on demand / none | `SC/vision_post.py:133,143`; `app.py:1901` |
| `robot.greetings.mode` | `gesture` | off / gesture / spoken | `app.py:375,1891` |
| `robot.idle.level` | `still` (Home's default `calm` is treated as still) | still / calm / lively | `app.py:239,1894-1899` |
| `robot.volume` | 70 | default owner volume | `presence/night.py:29,273` |
| `robot.brightness` | 100 | default owner screen brightness | `presence/night.py:30` |
| `robot.indicator.enabled` | on | "Light up when I am listening or need you" (never hides live/camera) | `indicator/settings.py:39,48` |
| `robot.indicator.brightness` | 0.6 | ring brightness by day | `indicator/looks.py:44` |
| `robot.indicator.night_brightness` | 0.15 | ring brightness at night | `indicator/looks.py:46` |
| `robot.firmware.auto` | `on` | wireless firmware update when idle | `SC/firmware_update.py:113,120` |
| `robot.follow_up.seconds` | 8 | follow-up window (Reachy path; StackChan uses a fixed 5 s) | `speech/follow_up.py:27`; `app.py:3181` |
| `robot.sleep.auto` | on in the registry, but the code is off unless `MAIPAI_BOT_SLEEP_AUTO=1` | dark-and-quiet sleep (Reachy path) | `app.py:3279-3290` |
| `robot.motion.carry_reaction` | `look` | reaction when picked up (declared; Reachy) | `link/hello.py:15`; `presence/carry_reaction.py:29` |
| `robot.barge_in.open_mic` | off | open-mic barge-in | `speech/barge.py:64` |
| `robot.voice.id` | Home default voice | the robot's voice (Home side) | `design-stackchan-voice-2026-10-20.md:10` |
| Planned, never registered: `robot.ambient_vision` (off), `robot.look_at_speaker` (on), `robot.auto_dance` (off, became `robot.dance.auto`), `robot.night_whisper` (on), `robot.wifi_auto_switch` (on) | | | plan l.33-34 |
| Removed: `robot.indicator.sleep_eyes`, `.alarm`, `.sees` | | | CHANGELOG 0.2.65 |

Persisted on the host: `owner_levels.json` (volume, brightness, last hub defaults; `SC/owner_levels.py`), `stackchan-pairing.json`.
Persisted on the unit (NVS namespaces): `websocket` (url, token, avatar_url), `board` (uuid), `maipai_priv`, `mp_timers`,
`mp_sounds`, `mp_music`, `microlink`, `ml_peers`, `face_pal`, `heal_n`/`heal_s`, Wi-Fi list (up to 10).

Home's own contract tables: `docs/dev/home-needs-bot-0.2.65-2026-11-13.md`, `home-needs-bot-0.2.71-2026-11-13.md`.

---

## 8. Protocol

Two unit-facing WebSocket channels plus one HTTP listener, all served by the host:

| Channel | Default bind | What |
|---|---|---|
| xiaozhi | `127.0.0.1:8765` (`MAIPAI_XIAOZHI_HOST/PORT`) | JSON text + binary Opus; MCP JSON-RPC inside `{"type":"mcp"}` |
| avatar | `127.0.0.1:8766`, path `/stackChan/ws?deviceType=StackChan` | M5 binary frames `[type:1][len:4 BE][payload]`: 0x02 JPEG from unit, 0x03 ControlAvatar, 0x04 ControlMotion, 0x05 start camera, 0x06 stop; hello JSON |
| vision HTTP | `127.0.0.1:8767` (`MAIPAI_VISION_HOST/PORT`) | `POST /vision/{device_id}`, `GET /notify/{device}/{id}.ogg`, `GET /firmware/{device}/{token}`, `GET /selftest/checks`, `POST /selftest/run`, `POST /robot/updating`, `POST /robot/updated` (`SC/xiaozhi/server.py:410-417`) |

xiaozhi message types handled (`server.py:558-631`): from unit `hello`, `listen` (start/stop/detect), `abort`, `mcp`; to unit
`hello` (with one-time `maipai_token`), `tts` (`start`, `sentence_start`, `stop`), `llm {emotion}`, `system {command}` (`idle`,
`reboot`, `updating`, `updated`, `wake_selftest`, `wake_rebuild`), `notify {audio_url}` (off), `mcp`. Headers: `Device-Id`,
`Client-Id`, `Protocol-Version: 1`, `Authorization: Bearer`.

MCP tools the host calls (51 names, grep of `body/maipai_body`); args where the docs state them:

- Upstream/M5: `self.robot.get_head_angles`, `self.robot.set_head_angles {yaw, pitch, speed 100..1000}`, `self.robot.set_led_color
  {r,g,b 0..168}`, `self.robot.create_reminder`, `get_reminders`, `stop_reminder`, `self.audio_speaker.set_volume`,
  `self.screen.set_brightness`, `self.camera.take_photo`, `self.get_device_status`.
- Added by patches: `self.battery.get_status` -> `{percent, charging}` (010); `self.robot.set_led_colors` (12 RGB triplets, 012);
  `self.screen.set_face_background`, `self.robot.set_idle_motion`, `self.screen.get_ambient_light` (017); `self.robot.dance {name}`,
  `self.robot.stop_dance` (020); `self.robot.get_events` (021); `self.wifi.list_saved/add/forget/switch` (023), `self.wifi.use_now
  {index}` (154); `self.screen.set_rotation {0|180}` (067, flip compiled out); `self.power.keep_awake` (074); `self.timer.set
  {seconds,label}`, `.alarm {hour,minute,label}`, `.list`, `.cancel {id}`, `.stop`, `.snooze {seconds}` (092); `self.music.set
  {enabled}` (100), `self.music.capture_clip`, `read_clip`, `drop_clip` (129); `self.privacy.set`, `.get`, `.set_policy
  {local_unmute}` (106); `self.audio.play_sound {name, urgent, test}`, `set_sound_policy {enabled, night_ok, muted, dark,
  quiet_from, quiet_to}`, `sound_info` (116); `self.face.music_notes {count}`, `self.face.song_title {text}` (123);
  `self.firmware.update {url, sha256, size, version}` (133); `self.tailnet.status`, `self.tailnet.set` (147);
  `self.network.prefer_tailnet` (153).
- Called by the host but defined in no patch: `self.screen.show_symbol`, `self.face.sleep_z`, `self.audio.alert`,
  `self.audio.listen`, `self.audio.notify`.

Unit events (polled through `self.robot.get_events`, 16-slot queue): `head_touch`, `head_swipe_forward`, `head_swipe_back`,
`shake`, `level_changed`, plus diagnostics (`SC/companion.py:60-76`): boot, fw, wake_stats, heap_stats, stack_stats, camera,
barge_stats, head_touch_stats, imu_stats, orientation, playback, stop_word, privacy, coredump, heal, wake_selftest, timer_fired /
ended / missed, music_feat / stats / clip_ready / clip_cancelled, sound_played, power_poll, wifi_use_ok / revert, tailnet_state,
firmware_update_started / progress / done / failed / validated.

Hub device commands the Bot answers: `dance`, `timer_set`, `alarm_set`, `timer_list`, `timer_cancel`, `timer_stop`,
`timer_snooze`, `announce`, `mute`, `unmute {confirm}`, `sound_test`, `song_title`, `listen_song`, `music_test`, `wifi_add`,
`wifi_forget`, `wifi_use`, `prefer_tailnet`, `self_test`, `settings_changed`. Host to hub: `PUT /api/devices/me/checkin`,
`POST /api/devices/me/vision`, `POST /api/music/identify`, `GET /api/devices/me/firmware-update[/app.bin]`, `/api/stt/stream`,
`/api/tts`, the turn route.

Single schema source of truth: **no**. Tool names and argument shapes are string literals in Python (`SC/*.py`) and in C++ inside
the patch files; the unit-facing wire has no schema file. `docs/dev/xiaozhi-protocol.md` is 10 lines (enrollment token only);
`docs/dev/stackchan-service.md` describes parts and is stale in places (camera frame type "0x01", ring "red", "app wiring does not
yet connect that callback"). Only the hub-facing shapes are pinned (`@maipai/spec` at `spec-v0.1.208`, `body/maipai_body/spec_pin.py`).
A few plain-C cores are shared and host-tested (`maipai_music_judge.h` "tested equal to the Python one").

Fake unit / simulator / bench tooling:

| Tool | Path |
|---|---|
| Firmware simulator (async fake unit over WebSocket) | `body/tests/stackchan_sim/firmware.py` |
| Fake avatar peer, fake camera sender | `body/tests/stackchan_sim/avatar_peer.py`, `camera_sender.py` |
| Fake device client for adapter tests | `SC/fake.py` |
| Fake body (`MAIPAI_BODY=fake`) | `body/maipai_body/bodies/fake/` |
| Recorded fixtures | `body/tests/fixtures/stackchan/` (replay.json, head_strip_idle_2026-11-12.txt, destinations-allowed.txt, vision fixtures) |
| Face still renderer (SVG/PNG from mint.cpp numbers) | `docs/dev/stackchan-faces-preview-2026-11-13/gen.py` |
| Bench control page | `body/scripts/stackchan_control.py` |
| Fixture recorder | `body/scripts/record_stackchan_fixtures.py` |
| Flash tools | `body/scripts/stackchan_flash.py`, `stackchan_flash_nonvs.py` |
| Asset renderers | `body/scripts/render_unit_sounds.py`, `render_unit_phrases.py`, `stackchan_face_set.py` |
| Measurement kit | `SC/measure/run.py`, `vision_run.py` (`--sim` only; no paired-unit client) |
| Self-test CLI | `python -m maipai_body.selftest` (`body/maipai_body/selftest/stackchan.py`) |
| Host-compiled firmware C tests (8) | `body/tests/firmware/`: beat, fallback_core, music_core, music_judge, sounds_core, tailnet_core, timers_core, touch_core |
| Patch hygiene tests | `body/tests/test_stackchan_patch_context.py` (+ 14 other tests that read the patch files) |
| Check-only build | `STACKCHAN_CHECK_ONLY=1 FW/recipe.sh`; upstream bump check `FW/bump.sh` (covers only six early patches) |

No LVGL/screen simulator exists: screens are "not rendered by LVGL" (faces-and-link l.26).

Tests: 262 `test_*.py` files under `body/tests`, 2,947 `def test_` functions; 90 files named `*stackchan*`, 107 mention StackChan.
CI: **none in the repo** (no `.github/` directory). The gate is local: `scripts/check.sh` (ruff, ruff format, pytest, pinned
`@maipai/standards` std-v0.3.0) plus `scripts/wt.sh`, `wt-tests.sh`, `gate-report.sh`.

---

## 9. Security posture

| Area | State | Evidence |
|---|---|---|
| WebSocket auth | Per-device bearer token (`token_urlsafe(32)`), stored as SHA-256, constant-time compare; Device-Id + Client-Id allowlist; revocation checked on every message | `SC/xiaozhi/pairing.py:74-83,212-227`; `server.py:441-455,531-540` |
| Enrollment | Single-use code, 24 h, hashed; long-lived token delivered once in hello (`maipai_token`) and saved to NVS | `pairing.py:85-143`; patches 018, 019 |
| Pairing flood limit | Per-source limit, "Too many pairing requests ... Wait 10 minutes" | `server.py:461-470` |
| Avatar channel auth | Same token and ids; M5's constant `hi-stack-chan` replaced | `SC/avatar/server.py:209-224,257`; patches 011, 060 |
| TLS | Off by default. Token, audio, camera and commands travel as cleartext `ws://`/`http://` on the LAN. Optional `MAIPAI_XIAOZHI_TLS_CERT/KEY` and a private-CA firmware build exist; untested on the unit; RAM unmeasured | `stackchan-service.md:5`; `README.md:48-50`; `SC/xiaozhi/tls.py`; `app.py:2204-2205` |
| Token in URL | The photo upload accepts `?token=` as well as a Bearer header | `server.py:879` |
| Default binds | xiaozhi, avatar and vision listeners default to `127.0.0.1`; a deployment sets the LAN address | `server.py:334,396`; `app.py:2716-2722` |
| Admin HTTP | Pairing approve/refuse/revoke, self-test and `/robot/updating|updated`: loopback only, same-origin Host/Origin check, JSON only. No CORS headers sent | `dashboard/server.py:74-90,142-160`; `server.py:732-742,783-793` |
| Unauthenticated dashboard routes | `GET /api/state`, `/api/primitives`, `/events`, `/` and `POST /api/primitive/*`, `/api/muted` have the same-origin check only, no login (default host 127.0.0.1) | `dashboard/server.py:94-141,227-246` |
| Setup hotspot | Open access point (`WIFI_AUTH_OPEN`), plain HTTP captive page, up to 4 clients, runs only when no saved network connects; name `stackchan-XXXX` (patch 155). WPA3-SAE single-use passphrase window is designed, not built | permanent plan l.27-33; anywhere note l.116-144 |
| Wi-Fi password handling | From Home: write-only, never logged, refused unless the link is encrypted (`link_encrypted`); from the setup page: phone to robot over the open AP. The removed M5 BLE path logged the password over serial | CHANGELOG 0.2.97, 0.2.104; unit-measurements l.87 |
| OTA signing | Release: Ed25519-signed flash manifest and `SHA256SUMS`, key in macOS Keychain; Home verifies the signature. The unit cannot verify Ed25519: it checks only a SHA-256 and size delivered in the same plain `ws` MCP call, and downloads over plain HTTP from a one-time URL. Stated residual risk: a LAN attacker who can alter traffic can already command the unit | `stackchan-wireless-update-2026-11-14.md:15-20`; `away-trip` note l.86; `FW/release.sh`, `verify.sh`, `scripts/signing-key.sh` |
| OTA rollback | Inactive slot only; pending-verify; validated after about 15 healthy seconds or rolled back; bootloader rollback enabled | patch 133 header; wireless-update l.10, 38-40 |
| Secure boot / flash encryption / NVS encryption | None. Token, Wi-Fi passwords and a tailnet node key sit in plain flash; a stolen unit gives them up | anywhere note l.76, 174; plan l.106 |
| Secrets on the host | Token file 0600 in a 0700 directory; pairing store written 0600; token never returned over HTTP; recipe redacts the token; a token leaked once and was rotated. Still open: token visible in `ps` (`--pairing-token` on the command line) | `pairing.py:233-242,353-356`; unit-measurements l.78, 93 |
| Dev overrides | `--dev-voice-url/--dev-avatar-url/--dev-token` print `DEV-OVERRIDE`; private tailnet image prints `PRIVATE-BUILD` | `FW/README.md:46-56`; `recipe.sh:537` |
| Away fallback | Token is sent to the Wi-Fi gateway only on a network whose name starts with `maipai`; compiled out with `--no-gateway-fallback` | patches 146, 152 |
| Tailnet | Outbound only; auth key paste-only, tag `tag:robot`; boot-loop guard; Google STUN removed (Tailscale DERP only) | patches 147, 149; BACKLOG ANYWHERE-01 |
| Camera indicator | Software only: pink ring and shutter click, floors no setting can dim; the click is silenced by Mute. Silent capture exists for local watching (`stream(silent=True)`), so the ring does not light for face watching by design | led-standard l.31-32, 51-57; `app.py:1887`; user guide l.74, 139-142 |
| Mic indicator | Green ring while audio streams to Home; hard mute powers the ES7210 down and reads the registers back (`mic_off_verified`); Home shows Muted only after confirmation | patch 106 header; `home-needs-bot-0.2.71` |
| Vision off | Stops camera reads on the unit; host drops and reports any frame that still arrives | patch 106; `stackchan-mute-2026-11-13.md:104` |
| Kid controls | No on-unit child lock. Anyone holding the robot can toggle mute/vision/quiet, change volume, switch Wi-Fi and open setup ("Physical presence is trusted ... not gated"). `robot.mute.local_unmute=false` stops the face from unmuting. Age bands, output gate and adult unlock live in Home; print consent for child/teen recognition is enforced host-side (`SC/vision_bridge.py:290`); ambient vision policy refuses with a child present (`SC/ambient_vision.py:68`); night ring level is lower for a child (led-standard l.42) | anywhere note l.101 |
| Egress | Static host scan of the image (`FW/host-search.sh`), `scripts/stackchan-no-third-party.sh`, capture checker `scripts/stackchan-egress-proof.sh`; no capture on the unit recorded | unit-measurements l.280-286 |
| Secret scanning | `.gitleaks.toml` (default rules, two path allowlists) | repo root |
| Logs | Counts only: no audio, words, tokens, song titles above debug | CHANGELOG 0.2.1, 0.2.83 |
| Not in the Bot repo | `SECURITY.md`, `CONTRIBUTING.md` (org-level files in `getmaipai/.github`) | |

An "independent security review" of the settings-page design is cited (anywhere note l.110; proposal title) but the review text is
not in the repo.

---

## 10. Repo boundary rules

Quoted rule text:

- `AGENTS.md:9-11`: "A body is a profile under `body/bodies/` behind one HAL seam, never a fork of anything above it."
- `AGENTS.md:13-17`: "MaiPai Bot is the framework every robot plugs into, the way the Stack is the framework for local AI: a
  headless service that Home pairs with and uses through one clean, vendor-neutral interface. The details of talking to a
  particular robot (StackChan, Reachy Mini, a future wheeled or legged build) never leave that robot's profile."
- `AGENTS.md:28-29`: "Nothing above the interface checks which robot is installed."
- `AGENTS.md:39`: "The shared record shapes live in `getmaipai/commons`'s `spec/` workspace."
- `AGENTS.md:55-59`: "Python ... for the body (everything that touches hardware). The household runtime (the turn engine, memory,
  guards, the link) is the hub's own TypeScript code, pinned and run on Bun as the same package".
- `docs/BACKLOG.md:18-20`: "Nothing in `body/` or `packages/` may copy a hub package or a hub record type (`dev.md` section 2)."
- `docs/dev/design-stackchan-2026-10-14.md:88-89`: "Home never learns a vendor name. It sees a paired bot with capabilities." and
  (Jesse, 2026-10-14) "the bot repo is the framework for every kind of bot; a StackChan is one robot type, so its translator code
  lives in the bot repo ... It is a headless service that Home pairs with and uses, never code inside Home ... the code and its
  release cadence belong to the bot repo either way. Whether a firmware that talks to the bot service directly is worth building
  later is an open question."
- `docs/dev/design-stackchan-pieces-and-gaps-2026-10-14.md:79-82`: "Home pairs with the service; Home never speaks either
  protocol." and "A firmware build recipe in the bot repo ... Fetched and checksummed, not vendored."
- `docs/plans/stackchan-companion-2026-10-20.md:3-5`: "Each is a bot verb or service first (vendor-neutral, `NotSupported` on a
  body that lacks it) with a StackChan translation underneath ... Firmware work is a numbered patch under
  `body/maipai_body/bodies/stackchan/firmware/patches/`."
- `docs/dev/home-needs-bot-0.2.65-2026-11-13.md:3`: "The Home repo was not touched by the integration. Spec first
  (`commons/spec`), then Home."
- Org `docs/PLATFORM.md` (found in `/home/user/getmaipai/dotgithub`, a clone of `getmaipai/.github` that appeared beside the repos
  during this session; HEAD `aa5f3c1`, 2026-11-17), products table: `bot` = "One body layer in `bot`, a profile per body, never a
  fork above it"; `commons` = "`bot` and `go` pin `spec`. Nothing in it imports a product"; `catalog` = "Hub and robot install
  from it"; `home` = "Every feature ships as a catalog package". That table lists stack, commons, home, catalog, go, bot, .github.
  **No `stackchan` repo is listed.** No org doc mentions StackChan (grep of `CLAUDE.md`, `docs/*.md`, `README.md`, profile).

No rule in the Bot repo says what belongs in a `stackchan` repo.

`/home/user/getmaipai/stackchan` (remote `https://github.com/getmaipai/stackchan`, one commit `c50de19`, 2026-11-15, "Issue form:
speak as we"): the checkout holds only `.github/ISSUE_TEMPLATE/config.yml` (`blank_issues_enabled: false`) and `report.yml`. No
README, licence, code or docs. The issue form says "MaiPai for StackChan is a hobby project. We read everything (eventually), but
may be slow and can't promise to build it", asks "What is this?" (bug / feature request), "Does it need MaiPai Home?" with the
options "Works on the bot alone (like a game)", "Needs MaiPai Home (like notes, a doorbell camera picture or Home Assistant)",
"Not sure", then a free-text field and an optional version. That wording implies a product called "MaiPai for StackChan" with a
bot-alone mode and games, neither of which exists in the Bot repo.

---

## 11. README and user docs quality (StackChan)

- `README.md` (119 lines): logo, tagline "A robot friend with its own onboard AI." (not true of StackChan, which is a thin
  body), two doc links, a Status section still describing v0.1.0 Reachy Mini, a 17-line StackChan section, a macOS ESP-IDF 5.5.4
  toolchain install, the legal/AI disclaimer and AGPL-3.0.
- Promoted: turns/nods, ring, face, sound, pictures; pink ring on a picture, green ring when sound goes to Home, "never red"; custom
  firmware flashed once; audio and camera stay on the home network; press Approve on the pairing page.
- Stale or contradictory: `README.md:50` "StackChan has not yet been verified on real hardware" (it has been on a unit since
  2026-10-19); "Reads the battery level" yes. Status says "not yet a complete conversational robot".
- Honest disclosures present: unencrypted LAN traffic (l.48-50); "The robot cannot be stopped from software alone" (user guide
  l.156).
- Screenshots: none. `docs/user/stackchan.md` has four `<!-- picture: ... -->` placeholders (l.5, 25, 44, 86) and no images.
- Quick start: `docs/user/stackchan-setup.md` (64 lines) is a developer procedure (ESP-IDF, USB flash, a "developer command" to
  pair, l.19) and is stale against the current firmware: it tells the user to tap **Skip** and open **AI Agent** from the app
  list (l.37-43; removed by patch 097, the unit boots into the agent) and to look for a hotspot named `Xiaozhi-` (l.45; now
  `stackchan-XXXX`, patch 155). The intended path "installed from Home in one step" (user guide l.15) depends on Home.
- User guide drift: "Swipe up ... volume and brightness sliders" omits Wi-Fi switching and the swipe left/right/down gestures;
  the mute/vision/quiet face taps are not in the user guide at all; "Shake it or lift it" (lift is not detected); "Offline" timing
  not stated; night "40%" vs half volume in the changelog.
- AI transparency: README footer ("The AI in this product runs on third-party models you choose to download. What they say can be
  wrong, offensive, or harmful ... Parents decide what children in the household can reach."); user guide credit that the offline
  phrases "are made by a computer. They are not a recording of a person" with the Chatterbox (Apache-2.0) and Pocket TTS
  (CC-BY-4.0) credits (l.76); `NOTICE` carries the same.
- Security policy / contributing: not in this repo; org-level `SECURITY.md` (private vulnerability reporting, solo maintainer)
  and `CONTRIBUTING.md` (issue first, copyright assignment) live in `getmaipai/.github`. README links neither.
- Licence note: repo is AGPL-3.0; `NOTICE` says the earcons are "MIT with the rest of this repo's firmware work" and patch
  headers cite MIT upstream files. The licence of the patch series itself is not stated in one place.
- Developer docs are extensive but dated notes, several superseding each other without an index; `docs/dev/stackchan-service.md`
  mixes current and stale statements; one note is referenced but missing: `docs/dev/stackchan-self-healing-2026-11-13.md`
  (`FW/README.md:76`); `docs/dev/robot-wifi-command.md` is said to be in Home.

---

## 12. Migration to an own "stackchan" repo, "wave 0", unit-protocol.md, ESP-IDF 6.1.1

Searched the whole Bot repo (all file types, excluding `.git`) for `wave 0`, `wave-0`, `unit-protocol`, `6.1.1`,
`getmaipai/stackchan`, `stackchan repo`, `own repo`, `migrat`: **no relevant hit**. What the repo does say:

- ESP-IDF: pinned 5.5.4 (`FW/pins.toml`); "ESP-IDF 6.x does not build M5's tree" (`README.md:64`); "ESP-IDF 6.x is known to fail
  (missing `mqtt` component), so the pin is hard" (`design-stackchan-firmware-build-2026-10-14.md:52`). One mention of an
  ESP-IDF 6 MicroLink fork (`fugo101/microlink`, away-trip note l.104).
- The nearest thing to a migration design is `docs/dev/design-stackchan-own-firmware-2026-10-14.md`: own firmware, one own
  protocol designed from the robot API ("Protocol spec in the bot repo plus the fake device and a test server", l.67), marked not
  chosen and "kept as the long-term option if the patches ever stop being small". With 128 applied patches (994 KB of patch
  text) that condition has arguably been reached; the note itself does not say so.
- "Later wave" appears only in the LED standard for firmware-side ring changes (l.71, 77).
- The `getmaipai/stackchan` repo exists but is empty apart from the issue form (section 10). Any plan for wave 0, a
  `unit-protocol.md` or ESP-IDF 6.1.1 must live outside these two checkouts (Home's docs, memory, or not yet written).

---

## Appendix: other inconsistencies worth knowing

- `CHANGELOG.md` has two `[Unreleased]` headings and 0.2.101 placed after 0.2.96; 0.2.71 lists the same "Changed" entry twice.
- BACKLOG BODY-STACKCHAN-01 still says "Not built yet".
- `docs/dev/stackchan-timers-and-announcements` says battery idle shutdown is 10 minutes; CHANGELOG 0.2.55 made it 60 minutes
  with a host keep-awake.
- `FW/bump.sh` checks only six early patches against a new upstream commit, not the series.
- `FW/pins.toml` `firmware_version = "1.5.1-maipai.1"` is the upstream-style identity; the release version the unit reports comes
  from `MAIPAI_FIRMWARE_VERSION` at build time (`recipe.sh:403-405`).
- `docs/dev/measurements.md` has no StackChan rows (Pi/Reachy only).
