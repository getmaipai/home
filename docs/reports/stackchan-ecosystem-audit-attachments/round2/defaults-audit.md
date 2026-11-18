# StackChan ecosystem: what projects turn off, what they leave on

Read-only audit of 15 downloaded repos (nothing executed, built or installed). Paths are relative to
`/tmp/claude-0/-home-user-home/7524bf19-2972-532d-bd20-b8fb4e44bb56/scratchpad/repos/`. `[unverified]` marks a
claim taken from a doc or inferred, not confirmed in code. Earlier per-repo audits:
`/home/user/home/docs/reports/stackchan-ecosystem-audit-attachments/*.md`.

Short names used below: dot = dotty-stackchan, alv = stackchan_alive, loc = stackchan-local, nou = nous-girl-stackchan,
mcp = stackchan-mcp, ais = stackchan-ai-server, gpt = StackChan-GPT, xzf = stackchan-xiaozhi-firmware,
pet = stackchan-pet-fw, min = StackChan_Minimal, cmc = stackchan-cloud-mcp, ccb = stackchan-claude-bridge,
oap = stackchan-openapi, bts = stackchan-bluetooth-simple, sim = stackchan-simulator.

## 0. The one-paragraph answer

Almost everyone leaves ON: a single prebuilt wake word, tap or touch to start and stop, a face with blink and lip sync,
petting and shake reactions, dim state-coloured LEDs, a camera photo on request, and some battery or heat protection.
Almost everyone turns OFF, removes or never ships: voice barge-in, sound-direction head turns, continuous face
tracking, face recognition, proactive speech, saved history, web search, model-callable reboot/update tools, and
anything that keeps a second speech model or the camera running all the time. The reasons repeat: this board has one
I2S bus for mic and speaker and no working echo cancel, two cores that the face, audio and wake word already fill,
scarce internal RAM next to TLS and the camera, a camera that shares I2C pins with touch, servos that are loud, hot
and electrically noisy, and a small battery and power path that browns out.

## 1. Settings and defaults, per repo

### nous-girl-stackchan (firmware v3.6.7-dj7 + server add-ons) - the richest settings surface
Source of defaults: `nous-girl-stackchan/docs/SETTINGS.md:226-239` (NVS table) and the pages above it.

| Setting | Default | Where |
|---|---|---|
| Wake words master (`hg/ww_on`) | on | SETTINGS.md:72, 228 |
| "Hey Nous-Girl" custom phrase, MultiNet7 (`ww_nous`) | on, with a printed warning: "Turn off if you see choppy audio ... keeps one CPU core busy while she's idle" | SETTINGS.md:73 |
| "Hey Jarvis" WakeNet9 (`ww_jarvis`) | on ("Lighter and very reliable ... keep it on as the backup word") | SETTINGS.md:74 |
| "Hey YuB" short phrase (`ww_yub`) | OFF ("Short phrases wake by mistake more") | SETTINGS.md:75 |
| Interrupt with wake word (`ww_barge`) | hidden, compiled off | SETTINGS.md:76; `firmware-src/v3.6.7-dj7/main/audio/hg_barge.h:27-33` |
| Wake sensitivity (`ww_sens`) | Normal (MultiNet 0.20; Low 0.30, High 0.12) | SETTINGS.md:77-80 |
| Volume | 70, slider floor 10 ("can never be stuck silent") | SETTINGS.md:87; `.../core-s3/hg_settings.cc:348` |
| Screen brightness | 75 | SETTINGS.md:95 |
| Lip sync, vowel shapes, talking lights | on, on, on | SETTINGS.md:96-98 |
| Look around when idle (`fairy_motion/auto_motion`) | on | SETTINGS.md:110 |
| Follow faces (camera, on-device esp-dl) | OFF | SETTINGS.md:111 |
| Dance to music (`groove`) | on | SETTINGS.md:147 |
| DJ mode (`dj`) | OFF | SETTINGS.md:148 |
| Rave mode | OFF, voice only, never saved, off after every boot | `docs/FEATURES.md:160-162`; `.../core-s3/hg_agent_tools.cc:913-914` |
| Camera (`camera`) | on ("Off for privacy") | SETTINGS.md:185 |
| LED button brightness | 80 of 100, not saved; DJ frames capped at 112/255, party LEDs at 44% | SETTINGS.md:127; `.../core-s3/cores3_py32_led.cc:292`; `main/audio/hg_eq.h:306` |
| Server address (`wifi/ota_url`) | empty: "connects nowhere" until typed | SETTINGS.md:158, 239; `sdkconfig:965` `CONFIG_OTA_URL=""` |
| Dim | after 300 s on battery only; never on USB; never powers off | SETTINGS.md:213-220; `.../core-s3/m5stack_core_s3.cc:365` `PowerSaveTimer(-1, 300, -1)` |
| Settings screen auto-close | 60 s | SETTINGS.md:25 |
| sdkconfig | `CONFIG_SR_WN_WN9_JARVIS_TTS=y`, `CONFIG_SR_MN_EN_MULTINET7_QUANT=y`, `CONFIG_SPIRAM_MODE_QUAD=y`, `CONFIG_SEND_WAKE_WORD_DATA=y`, `CONFIG_USE_SERVER_AEC` not set | `sdkconfig.defaults.cores3-k151:3,16,20`; `sdkconfig:1142,1148` |
| Kid mode | no switch on the robot; prompt (SOUL.md) plus code guards on tools | `docs/FEATURES.md:213-218` |
| Radio, DJ, rave, games (fun-pack), memory (Hermes), email, memes | all separate server add-ons, none installed by default; radio has "no kid filter" | `VERSIONS.md:183-198`; `docs/FEATURES.md:172` |

### dotty-stackchan (server stack; firmware submodule is empty in this clone)
| Setting | Default | Where |
|---|---|---|
| `DOTTY_KID_MODE` | true | `dotty-stackchan/.env.example:14`; `docs/faq.md:55` |
| `DOTTY_ADMIN_TOKEN` | unset = admin routes open on LAN | `.env.example:22-31` |
| `DOTTY_LOCAL_ONLY` | 0 (cloud vision allowed) | `dotty-behaviour/config.py:60`; `.env.example:99` |
| `SOUND_TURN_ENABLED` | 0, "Disabled by default (2026-10-05)" | `dotty-behaviour/config.py:192-199` |
| `WAKE_TURN_ENABLED` | 1 (yaw 45, speed 200) | `dotty-behaviour/config.py:211-215` |
| `GREETER_ENABLED` | true; `GREETER_GREET_UNKNOWN=false`; `GREETER_USE_FACE_DETECTED=false`; cooldown 4 h; max 3 per person per day; 15 words | `.env.example:161-183` |
| `FACE_GREET_TEXT` | "Hi!" ("slightly noisy in everyday use"; "" keeps mic-open without speech); min interval 30 s; hours 06-21 | `.env.example:42-60`; `dotty-behaviour/config.py:387-389` |
| `IDLE_PHOTOGRAPHER_ENABLED` | 1: silent photo every 180-300 s when idle (text only kept) | `dotty-behaviour/config.py:327-339` |
| `SCENE_SYNTHESIS_ENABLED`, `DREAMER_ENABLED`, `DANCE_REFLECTOR_ENABLED`, `SECURITY_CYCLE_ENABLED` | 1, 1, 1, 1 (security state itself is "scaffolding, not a live path") | `dotty-behaviour/config.py:238,244,362,451`; `docs/modes.md:44` |
| Face-lost abort | grace 4 s, window 12 s, only in idle and talk | `dotty-behaviour/config.py:188-189`; `CHANGELOG.md:115` |
| Purr on head pet | cooldown 5 s | `.env.example:76` |
| Smart mode (cloud model) | off; "toggle-only today", no model swap | `docs/modes.md:33,76` |
| LEDs per state | idle off (0,0,0); talk dim green (0,60,0); sleep (0,0,16) | `docs/modes.md:40-46` |
| Sleep state | manual privacy sleep: camera, face detect, voice and wake word all off, torque released after 3 s, exit by head touch only | `docs/modes.md:45,63-65` |
| ASR guards | `noise_turn_limit` 3; `no_speech_threshold` 0.6; pre-roll 1.2 s; 4 barge-ins in 60 s end the session | `CHANGELOG.md:20,96,110,129` |
| Wake word | WakeNet9 "Hi, ESP" on device `[unverified, docs only]` | `docs/wake-word.md:20-33` |

### stackchan_alive (PlatformIO firmware + host bridge)
Compile-time defaults are nearly all 0; every capability is an explicit build flag.

| Setting | Default | Where |
|---|---|---|
| Default env `stackchan` | display only: `ENABLE_SERVOS=0`, `ENABLE_SPEAKER=1` | `stackchan_alive/platformio.ini:2,89-91` |
| `STACKCHAN_ENABLE_MIC_CAPTURE` | 0 ("Firmware mic capture remains compiled off by default") | `src/config/RobotConfig.hpp` (define); `docs/PRIVACY.md:29` |
| `ENABLE_CAMERA`, `ENABLE_CAMERA_HOST_VISION`, `ENABLE_IMU`, `ENABLE_BODY_TOUCH`, `ENABLE_BODY_RGB`, `ENABLE_LAN_OTA`, `ENABLE_WIFI_BRIDGE`, `ENABLE_MWW_WAKE_PROBE`, `ENABLE_SR_WAKE_*` | all 0 | `#define` defaults under `src/` (grep `#define STACKCHAN_ENABLE_`) |
| `BRIDGE_WAKE_ON_SPEECH` (open a turn on plain speech, no wake word) | 0 | same; `platformio.ini:336` |
| Release image `stackchan_release_full` | `AUTONOMOUS_MOTION_AT_BOOT=0`; camera and host vision compiled in but "unusable until the owner provisions pairing"; no Wi-Fi, pairing or OTA secret baked in | `platformio.ini` env `stackchan_release_full` (lines ~543-558); `docs/PRIVACY.md:44-46` |
| Servo envs | `MOTION_ENABLED_AT_BOOT=0`, session timeout 900 s, `SERVO_RELEASE_ON_STOP=1`, duty 120 s active / 30 s rest, thermal load shed 70 C (resume 64 C), voltage load shed 4550 mV (hard floor 4400 mV), 8 s motion cooldown after audio | `platformio.ini:379-394,443-455` |
| Voice volume | master 115 of 255 in the voice-out env (compile default 150) | `platformio.ini:440` |
| Bridge flags | `--enable-initiative`, `--enable-research`, `--room-observation`, `--memory-file`: all opt-in; room observation "default-off" | `bridge/lan_service.py:4790-4811`; `docs/PRIVACY.md:50` |
| Wake turn window | 6 s open, 15 s max turn `[from earlier audit]` | `src/io/BridgeWakeGate.*` |

### stackchan-local (firmware + desktop daemon)
| Setting | Default | Where |
|---|---|---|
| `STACKCHAN_FACE_TRACKING` | 0 | `stackchan-local/.env.example`; `README.md:320-331` |
| `STACKCHAN_VOLCENGINE_TTS_ENABLED` (only cloud piece) | 0 | `.env.example`; `README.md:409` |
| `STACKCHAN_PREVIEW_HOST` | 127.0.0.1; device WebSocket 0.0.0.0 | `.env.example`; `SECURITY.md:13` |
| `STACKCHAN_PAIRING_TOKEN` | `dev-local-token` (weak default) | `.env.example`; `firmware/main/services/local_companion/local_companion_service.cpp:281` |
| `CONFIG_SEND_WAKE_WORD_DATA` | n (upstream default is y) | `firmware/sdkconfig.defaults:12`; `firmware/main/Kconfig.projbuild:342-344` |
| Wake word | `CONFIG_SR_WN_WN9_HISTACKCHAN_TTS3=y` | `firmware/sdkconfig.defaults:13` |
| Brightness 75; `sleep_mode` true; rollback enabled | | `firmware/main/hardware/power/backlight.cc:35`; `firmware/main/system/power_policy/power_save_timer.cc:33`; `sdkconfig.defaults:5` |
| Cloud HTTP/MQTT/UDP (and so remote OTA) | replaced by `DisabledHttp`, `DisabledMqtt`, `DisabledUdp` | `firmware/main/services/local_companion/transport/esp_network.cpp:19-54,310-327` |

### StackChan-GPT (official M5 firmware patched to call OpenAI directly)
| Setting | Default | Where |
|---|---|---|
| Rest movement (`idleRandomMovementLevel`) | 2 = Medium ("brief movement every 3 minutes for <= 20 seconds"); choices None / Little / Medium / High | `StackChan-GPT/firmware/main/hal/hal.h:120`; `README.md:60` |
| Idle camera motion tracking | runs only at Movement = High, so OFF at the default | `firmware/main/hal/idle_camera_tracker.cpp:57-61` |
| Idle shutdown | 600 s; `allowShutdownWhenCharging=false` | `firmware/main/hal/hal.h:118-119` |
| Launcher apps (Agent.ai, Avatar, ESPNow remote, App Center, EzData, Dance) | all visible; a settings page hides any of them | `firmware/main/hal/hal_toggles.h:12-34` |
| Wake word | WakeNet "Hi StackChan" plus custom text word "StackChan" matched in cloud STT of standby audio | `firmware/sdkconfig.defaults:15`; `firmware/main/hal/hal_openai.cpp:93` |
| `CONFIG_SEND_WAKE_WORD_DATA` | n | `firmware/sdkconfig.defaults:14` |
| Web search | on (prompt steers the model to search) | `docs/WEB_SEARCH_v1.8.7.md:10` |
| Dance | on request only, 45 s, range 5-120 s | `docs/DANCE_v1.8.9.md:11-12` |
| TLS | `CONFIG_ESP_TLS_INSECURE=y`, `CONFIG_ESP_TLS_SKIP_SERVER_CERT_VERIFY=y` (a bad default) | `firmware/sdkconfig.defaults:56-57` |

### stackchan-xiaozhi-firmware (xiaozhi fork, CoreS3 board)
| Setting | Default | Where |
|---|---|---|
| Wake | `CONFIG_USE_CUSTOM_WAKE_WORD=y`, "ni hao xiao zhi", MultiNet6, sensitivity HIGH in the file (README table says MEDIUM) | `stackchan-xiaozhi-firmware/sdkconfig.defaults:49-53`; `README_en.md:79-81` |
| `CONFIG_SPIRAM_MODE_QUAD=y` ("changed back to QUAD") | | `sdkconfig.defaults:2`; `README_en.md:136` |
| Sleep | README: 30 s idle = lights, servos, screen off; code: `PowerSaveTimer(-1, -1, -1)` (timer disabled) | `README_en.md:26`; `main/boards/m5stack-core-s3/m5stack_core_s3.cc:1911-1912` |
| IMU shake/lift | on, muted during speech, 5-minute global cooldown | `m5stack_core_s3.cc:1429,1490`; `README_en.md:23` |
| Head touch | on, 5 s cooldown | `m5stack_core_s3.cc:1664` |
| OTA host | Tenclass cloud by default (`main/Kconfig.projbuild:5` per earlier audit) | |
| Upstream Kconfig | `SEND_WAKE_WORD_DATA` y; `WAKE_WORD_DETECTION_IN_LISTENING` n; `USE_DEVICE_AEC` n; `USE_SERVER_AEC` n ("Unstable") | `main/Kconfig.projbuild:800-838` |

### stackchan-pet-fw (Arduino pet body, device is the server)
| Setting | Default | Where |
|---|---|---|
| `LISTENING_NOD_ENABLED` | 0 | `stackchan-pet-fw/src/config.h:504`; `docs/release_notes_0.4.0.md:61` |
| `STACKCHAN_IMU_PETTING` | 0 | `src/config.h:179` |
| `THERMAL_FACE_EXPRESSION_ENABLED` | 0 ("Keep thermal monitoring and low-power behavior active without replacing the face") | `src/config.h:765-767` |
| Thermal levels (CoreS3) | Warm 70 C or +18 C over baseline; Hot 82 C or +28 C; low-power suggestion after 30 s | `src/config.h:772-788` |
| `low_power` | false | `src/main.cpp:88,2529` |
| `SERVO_MIC_QUIET_AFTER_MS` 500; `AUDIO_SPEAKER_TO_MIC_DELAY_MS` 250; `CAMERA_PAUSE_MIC_DURING_CAPTURE` 1 | | `src/config.h:495,694,697` |
| Brightness 160 of 255 (min 40); speaker volume 120 or 180 by device | | `src/config.h:682-684,753-754` |
| `STACKCHAN_CLASSIC_FACE_ENABLED` 0 (image face is default) | | `src/config.h:80` |
| Mic | streams to the connected client unless muted by a tap overlay; no wake word | `src/main.cpp:5923`; earlier audit |

### StackChan_Minimal (AtomS3R, push to talk)
| Setting | Default | Where |
|---|---|---|
| `-DENABLE_SERVO` | commented out = servos off in the default build | `StackChan_Minimal/platformio.ini:36` |
| `vad_enabled` true; `vad_threshold` 180; `vad_min_speech` 4; `vad_max_silence` 40 | | `src/main.cpp:5816-5819` |
| Platform | pinned back to Arduino core 2 because core 3 made the servo jump at `ledcAttach` | `platformio.ini:12-14` |
| Talk trigger | button only; hold cancels TTS | `src/main.cpp:5999-6020` (earlier audit) |

### stackchan-ai-server (replacement cloud for stock firmware)
| Setting | Default | Where |
|---|---|---|
| `conversation_history_enabled` | false (90 days, 2000 messages when on) | `stackchan-ai-server/docs/conversation-memory-and-wake.md:10-11`; `README.md:189-198` |
| Follow-up window | 15 s in standalone; 0 = unlimited is the legacy HA add-on default | `README.md:200-204` |
| `gemini_enable_search` | off | `README.md:169` |
| `background_tasks_enabled` | off | `README.md:181` |
| `ha_enabled` / `gemini_enable_tools` | on in the HA add-on, off in standalone | `README.md:152,154,168`; `CHANGELOG.md:49,52` |
| `compatible_server_vad` on; `compatible_vad_silence_ms` 800 | | `README.md:175-176` |
| Advice | "For less power draw and fewer accidental activations, use touch/screen activation" | `README.md:246` |

### stackchan-mcp (MCP server + own Arduino firmware)
| Setting | Default | Where |
|---|---|---|
| `STACKCHAN_FACE_TRACKING` | 0 (and only after an explicit trigger, 8 s) | `stackchan-mcp/.env.example:92-95` |
| `STACKCHAN_ENABLE_PUBLIC_MCP_TUNNEL` | 0 | `.env.example:58` |
| `STACKCHAN_MCP_AUTH_TOKEN` | empty = HTTP transport refuses to start | `.env.example:61`; earlier audit |
| `STACKCHAN_AUDIO_MODE` | wav (whole utterance; PCM streaming exists but is not the default) | `.env.example:33`; `docs/booth-mode.md:46` |
| Booth / outing mode (all mic capture off, persisted) | off; explicit set, never a toggle | `docs/booth-mode.md:1-30` |
| Wake words | host-side transcript match, `STACKCHAN_VOICE_WAKE_WORDS="stackchan"` | `.env.example:73` |

### stackchan-cloud-mcp ("field-tested defaults")
| Setting | Default | Where |
|---|---|---|
| `PREF_BRIGHTNESS` | 40 ("deliberately low to reduce heat"); standby 20 after 600 s | `stackchan-cloud-mcp/cloud/reflex.py:60,80-81` |
| `TORQUE_RELEASE_MS` | 3000 ("holding torque is the main source of heat") | `cloud/reflex.py:82-83` |
| `TOUCH_COOLDOWN` | 15 s ("long enough that occasional false positives are not annoying") | `cloud/reflex.py:57-58` |
| `IDLE_MOTION` | on, starts after 40 s idle, then every 45-105 s, speed 80 | `cloud/reflex.py:67-75` |
| `PREF_VOLUME` | 100 | `cloud/reflex.py:79` |
| `quiet_hours` | 23-08: no head turns, no speech, base LEDs off | `cloud/xinchao_mood.py:55` |
| `move_every_s` | 300 per gesture ("small plastic gears, turn less, wear less") | `cloud/xinchao_mood.py:54` |
| Spoken lines | `{}` = silent; "miss you" max 6 per day, 1 h gap | `cloud/xinchao_mood.py:57-58` |
| Away schedule, wake alarm | None | `cloud/xinchao_mood.py:61-62` |

### Smaller repos
- stackchan-claude-bridge: firmware change "disable light sleep" (`PowerSaveTimer(-1,-1,-1)`) because sleep turned the mic and wake word off: `stackchan-claude-bridge/docs/firmware-changes.md:135-158`, `README.md:96`. Agent runs with `acceptEdits` / `bypassPermissions` by default (earlier audit).
- stackchan-openapi: `WiFi.setSleep(false)` (`firmware/firmware.ino:946`); speaker volume 255 (`firmware.ino:380`); face tracker "Lazy (default)" 3-10 s checks, "Active ... the servos are noisy" (`README.md:152-155`); no auth on anything.
- stackchan-bluetooth-simple: Bluetooth `starting_state: false`, `start_volume: 100`, `auto_power_off_time: 0`, LED brightness 32 of 255, `USE_LED_OUT` commented out, `secret_info_show: true` (`data/yaml/SC_BasicConfig.yaml:61-63,83`; `src/main.cpp:25-26,361`).
- stackchan-simulator: bind 127.0.0.1, LLM optional and off, volume 180 (`src/stackchan_sim/web/simloop.py:62`).

## 2. Built, then disabled, removed or gated (with the stated reason)

| # | Repo | Feature | What happened | Stated reason | Where |
|---|---|---|---|---|---|
| 1 | nou | Wake-word barge-in | built v3.6.5 off by default, compiled off v3.6.6 (`kBuildAllowsBarge=false`), switch hidden, NVS key ignored | "no echo cancel: her own voice masks the phrase"; "running MultiNet next to the speaker/decoder is a crash risk" | `firmware-src/v3.6.7-dj7/main/audio/hg_barge.h:27-33`; `.../core-s3/hg_settings.cc:479`; `VERSIONS.md:133-134`; `docs/WAKE-WORDS.md:245` |
| 2 | nou | Custom wake phrase always on | restricted in v3.3 to idle only, around detected speech | detector "kept core 1 at 100%": no sound, slow repeating speech | `VERSIONS.md:119`; still listed as a known issue `VERSIONS.md:148` |
| 3 | nou | `self.skin.set` tool | removed | it "moved the robot to the official server (api.tenclass.net) and rebooted, from a voice request" | `.../core-s3/skin_manager.cc:269-272` |
| 4 | nou | Full-screen meme tool `self.screen.show_image` | removed in dj7 | 320x240 download used internal RAM and rebooted the robot | `VERSIONS.md:146-147` |
| 5 | nou | Rave by touch / on-screen DJ buttons | removed; rave is voice only and never saved | grown-up feature, photosensitivity caps | `VERSIONS.md:145`; `.../core-s3/hg_dj_logic.h:3`; `docs/FEATURES.md:160-162` |
| 6 | nou | Skin-colour face follow | replaced by esp-dl detection, then moved to PSRAM, default still off | TLS/connect errors from internal RAM running out; follow "never actually ran" for lack of internal RAM | `VERSIONS.md:126-131` |
| 7 | nou | IR remote | side build, "never run on hardware" | experimental | `VERSIONS.md:137-138` |
| 8 | dot | Sound-direction head turn | default off since 2026-10-05 | firmware localizer "stuck-left"; every sound reports left, "the turner snaps the head left on any noise"; issue closed not-planned | `dotty-behaviour/config.py:191-199` |
| 9 | dot | dlib face recognition | removed | never reached production, would not build, "conflicted with the project's no-storage identity posture" | `CHANGELOG.md:178` |
| 10 | dot | Blind mode (dusk-to-dawn camera gate) | removed, replaced by greeter hours 06-21 | wrong indoors with lights on; "Killing 3 AM 'Hi!' greets is the only gate worth keeping" | `CHANGELOG.md:179` |
| 11 | dot | Audio scene classifier (YAMNet) and "dance when music is detected" | removed | default-off scaffold that "sat dormant" | `CHANGELOG.md:180` |
| 12 | dot | Rich MCP tool surface; EngagementDecider (more proactive speech) | removed, both default false | "voice-only is the intended product surface; don't re-add" | `CHANGELOG.md:215-216` |
| 13 | dot | Dashboard reboot button, self-update | removed | "too easy to misclick"; no-op while reporting success | `CHANGELOG.md:81,157` |
| 14 | dot | Smart mode cloud model swap (Tier1Slim) | removed; toggle remains with no effect | depended on a retired bridge | `CHANGELOG.md:80`; `docs/modes.md:33` |
| 15 | dot | Power-save shutdown on USB | fixed to battery only | robot on USB "powered itself off 600 s after boot" | `CHANGELOG.md:47` |
| 16 | alv | ESP-SR WakeNet | rejected after a hardware probe | detection worked but the face fell to 85-102 ms per frame (about 11.7 fps) | `docs/BOT_LOCAL_WAKE_ARCHITECTURE.md:25-38` |
| 17 | alv | Voice barge-in | not attempted on purpose | mic RX and speaker TX share `I2S_NUM_1`; mic is paused before speaker output | `docs/SPEAKER_AUDIO_RESEARCH.md:144-156` |
| 18 | alv | Motion at boot, autonomous motion | off in servo and release envs | unexplained power blackouts are a release blocker | `platformio.ini:380`; `docs/POWER_BLACKOUT_FORENSICS.md:26-40` |
| 19 | loc | Sound direction finding | removed | "microphones are used for wake word and voice audio only" | `SECURITY.md:17` |
| 20 | loc | Cloud HTTP, MQTT, UDP (incl. vendor OTA) | stubbed out | local-only firmware | `firmware/main/services/local_companion/transport/esp_network.cpp:19-54` |
| 21 | xzf | Remote OTA, `self.upgrade_firmware`, `self.reboot` tools | removed / stripped | "causes issues"; "Reflash manually" | `main/mcp_server.cc:138-140`; `README_en.md:135` (`application.cc:435-436` still calls `UpgradeFirmware` when the server reports a new version `[unverified how it is blocked]`) |
| 22 | xzf | Morning greeting | removed | not stated | `README_en.md:135` |
| 23 | xzf / ccb | Idle light sleep | disabled (`-1,-1,-1`) | after sleep the mic and wake word are off; only touch wakes it | `stackchan-claude-bridge/docs/firmware-changes.md:147-158`; `m5stack_core_s3.cc:1912` |
| 24 | xzf | Octal PSRAM | changed back to QUAD | not stated | `README_en.md:136` |
| 25 | pet | Listening nods; servo motion during speech | nods disabled; servo held during speech; mic paused during petting, shake and servo moves | "to avoid speech-recognition retriggers from servo noise" | `docs/release_notes_0.4.0.md:61-62` |
| 26 | pet | Thermal and low-power faces | face swap off, protection kept | thermal state must not replace the face | `src/config.h:765-767`; `docs/release_notes_0.4.0.md:47` |
| 27 | min | Servos; Arduino core 3 | servo flag off by default; platform pinned back | servo jumps right after `ledcAttach` on core 3 | `platformio.ini:12-14,36` |
| 28 | gpt | `SEND_WAKE_WORD_DATA` | n | no server wants the wake audio | `firmware/sdkconfig.defaults:14` |
| 29 | gpt | Continuous camera tracking | gated behind Movement = High | default is bounded movement | `firmware/main/hal/idle_camera_tracker.cpp:57-61` |
| 30 | ais | Unlimited open conversation | replaced by a 15 s window in standalone | "Background speech within the window can still trigger a reply"; return to wake standby | `README.md:200-205`; `CHANGELOG.md:38` |
| 31 | cmc | LED updates while speaking | paused (`HUSH`) | LED commands share the WebSocket with audio and make speech stutter | `cloud/xinchao_mood.py:108` |
| 32 | cmc | Vendor OTA | answered by a fake "already latest" endpoint | keep the device off the vendor update path | `cloud/fake_ota.py` (earlier audit) |
| 33 | oap | Camera continuous grab (`fb_count=2`, GRAB_LATEST) | changed to capture on demand | camera DMA streaming 24/7 into PSRAM caused "sporadic crashes/reboots" | `firmware/firmware.ino:455-459` |
| 34 | mcp | PCM streaming playback | whole-utterance WAV is the deployed default | HTTP PCM push too slow, audible gaps; crackle | `docs/pcm-playback-stutter-troubleshooting-2026-07-04.md:42-55`; `docs/booth-mode.md:46` |
| 35 | mcp | Camera kept initialised | camera is opened per snapshot and touch suspended meanwhile | camera SCCB and internal I2C share GPIO 11/12 | `docs/touch-sensor-camera-i2c-troubleshooting-2026-08-30.md:9-17` |

## 3. What breaks, counted by theme (repos reporting it, of 15)

| Theme | Count | Repos and evidence |
|---|---|---|
| Servo noise, twitch, wear, or servo motion upsetting other sensors | 10 | min (ledcAttach jump, `platformio.ini:13`); pet (servo noise retriggers STT, `release_notes_0.4.0.md:62`); xzf (servo shake triggers IMU, `README_en.md:134`); nou (own head moves counted as shakes, `VERSIONS.md:120`); oap (active tracking "servos are noisy", `README.md:155`); cmc (plastic gears, `xinchao_mood.py:54`); dot (servo reads starving CPU 1, `CHANGELOG.md:48`); mcp (`docs/servo-troubleshooting-2026-05-16.md`); gpt (tracker waits for its own servo motion, `docs/IDLE_CAMERA_TRACKING_v1.8.7.md:30-31`); loc (motion gate during audio, earlier audit) |
| Choppy, stuttering, crackling or missing audio | 8 | nou (`VERSIONS.md:119,148`); dot (`docs/troubleshooting.md:40-48`, `CHANGELOG.md:28,107,123`); mcp (three dated docs: noise, stutter, consecutive audio); cmc (`xinchao_mood.py:108`, missing opuslib); bts (DMA buffer vs face flicker); pet (prebuffer, VoicePerfStats); ais (prebuffer 300 ms for jitter); alv (frame-time gate) |
| False wake, false trigger, room noise or own echo answered | 7 | nou (`docs/WAKE-WORDS.md:28-45,240`); dot (`CHANGELOG.md:20,110,129`); ais (`README.md:205,246`); xzf (`README_en.md:118`); oap (Whisper junk-phrase list); mcp (ambient sound started a recording that blocked touch, `docs/touch-admission-troubleshooting-2026-09-30.md:16-21`); gpt (standby audio to cloud STT) |
| No echo cancel / half-duplex mic and speaker | 6 | nou; alv; oap (`README.md:161-162`); pet (`config.h:694`); dot (echo storm guard); upstream Kconfig in loc, xzf, nou: `USE_DEVICE_AEC` default n and its board allow-list has no M5Stack entry (`stackchan-local/firmware/main/Kconfig.projbuild:366-376`) |
| Memory resets, panics, internal-RAM exhaustion | 6 | nou (`VERSIONS.md:129-131,146-147`, long-reply reboot :135); oap (`firmware.ino:455-459`); mcp (`spk_task` panic, `docs/consecutive-audio-troubleshooting-2026-07-03.md:35-43`); dot (`CHANGELOG.md:28,46`); gpt (TLS worker stack forced to internal RAM, earlier audit); alv (39 KB steady internal heap with camera, `platformio.ini` comment near line 486) |
| Wi-Fi and connection drops | 5 | cmc (NAT idle drop at about 90 s, `patches/README.md:48-70`); oap (`firmware.ino:946`); nou (2.4 GHz only, no scan while connected, `VERSIONS.md:134`); xzf (connect timeout, bad credentials cleared, `README_en.md:131`); dot (`CHANGELOG.md:46`) |
| False or lost touch | 5 | cmc (`reflex.py:57-58`); nou (swipes read as taps on a busy I2C bus, `VERSIONS.md:145`); mcp (two docs); pet (long-press misfires, `README.en.md:24`); xzf (5 s touch cooldown) |
| Battery, power path, blackouts | 5 | dot (project "on ice" over a battery/power issue, `README.md:2-4`; USB shutdown bug); alv (`docs/POWER_BLACKOUT_FORENSICS.md`); xzf ("Battery power + all LEDs on may fail to boot", `README_en.md:115`); nou (battery power-on soft-start fix, `VERSIONS.md:133`); bts (USB-unplug power-off timer) |
| Heat | 4 | cmc (`reflex.py:80-83`); pet (`config.h:772-788`); alv (`platformio.ini:448-449`); dot (torque off in sleep, `docs/modes.md:45`) |
| Sleep or power save killing the wake word or the robot | 3 | xzf / ccb (`firmware-changes.md:147-158`); dot (`CHANGELOG.md:47`); oap (Wi-Fi sleep) |
| Wake word CPU cost | 2 | nou (core 1 at 100%); alv (11.7 fps face) |
| Sound direction does not work | 2 | dot (stuck left); loc (removed) |
| Camera and touch pin conflict | 2 | mcp; oap (`firmware.ino:430` `M5.In_I2C.release()`) |
| Camera useless in the dark | 1 | dot (`.env.example:186-196`) |

## 4. Privacy and safety defaults

| Topic | What the repos do by default |
|---|---|
| Camera | Photo on request is on nearly everywhere it exists (dot, nou, gpt, xzf, mcp, loc, pet, oap, cmc). Only alv compiles it out by default and needs pairing in the release image. Only nou and dot's sleep state give a user-facing off switch. mcp shows the captured frame on screen for 6 s as an indicator. dot is the outlier that photographs silently every 3-5 min when idle. |
| Mic | Wake-gated in dot, nou, xzf, gpt (with a cloud-STT standby path for the custom word), loc, alv. Always streaming while a client is connected in pet (tap to mute) and pollable without auth in oap, mcp, min. Push to talk only in min. Wake audio upload turned off in loc and gpt (`SEND_WAKE_WORD_DATA=n`); left on in nou and xzf. |
| Cloud | Off or not needed by default in dot, alv, loc, nou, min, oap, sim. On by design in gpt, ais, cmc, ccb, and by default endpoint in xzf. nou ships with no server address at all. |
| History / memory | Off by default in ais and alv; needs a separate brain in nou; on in dot (brain.db) with later fixes to stop storing prompt scaffolding (`dotty-stackchan/CHANGELOG.md:130`). Elsewhere absent. |
| Kid mode | Only dot has a switch, on by default and fail-closed. nou is prompt-only by its own admission. The other 13 have nothing. |
| Face recognition | Shipped on by default nowhere. dot removed it; alv, loc, mcp state "no identity"; nou needs enrolment; oap is an optional host script. |
| Idle motion | On in nou, dot, gpt (bounded), xzf, cmc (sparse), bts. Off at boot in alv; off unless built in min; none in mcp ("never sweeps"). |
| LED brightness | Low everywhere: dot idle off and talk (0,60,0); nou caps 44%; bts 32/255; cmc off in quiet hours; xzf off in sleep. |
| Volume | nou 70 (floor 10); alv 115/255; pet 120 or 180/255; cmc 100; oap 255; bts 100. No repo has a child volume cap. |
| Screen brightness | nou 75; loc 75; pet 160/255; cmc 40 (20 in standby). |
| Sleep / dim | nou: dim after 300 s on battery only. gpt: shutdown after 600 s on battery only. cmc: dim after 600 s. dot: manual privacy sleep; battery-only shutdown after 10 min. xzf: sleep disabled in code. |
| Quiet hours | cmc 23-08 (no motion, no speech, LEDs off); dot greeter hours 06-21. Nobody else. |

## A. Feature matrix

Cell codes: `ON` = present and on by default. `OFF` = present, off by default or opt-in. `XX` = built, then disabled or
removed. `-` = absent. `?` = present per docs but default not confirmed in code. Notes follow the table.

| Feature | dot | alv | loc | nou | mcp | ais | gpt | xzf | pet | min | cmc | ccb | oap | bts | sim |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Wake word | ON | OFF(a) | ON | ON | ON(b) | - | ON | ON | - | - | - | - | - | - | - |
| Custom wake phrase | - | OFF | - | ON(c) | ON(b) | - | ON(d) | ON | - | - | - | - | - | - | - |
| Voice barge-in | ON(e) | - | - | XX | - | ON(f) | ? | OFF(g) | - | - | - | - | - | - | - |
| Tap or button to stop | ? | - | - | ON | - | - | ? | ? | - | ON | - | - | - | - | - |
| Follow-up listening window | ON | ON 6 s | - | ? | - | ON 15 s(h) | ? | ON | - | - | - | - | - | - | - |
| Idle head motion | ON | OFF | ? | ON | - | - | ON(i) | ON | ? | OFF(j) | ON(k) | - | - | ON | - |
| Face tracking | ON(l) | OFF | OFF | OFF | OFF | - | OFF(m) | ON(n) | - | - | - | - | OFF | - | - |
| Sound direction turn | XX | ? | XX | - | - | - | - | - | - | - | - | - | - | - | - |
| Dance to music | ON(o) | - | - | ON | - | - | ON(o) | - | - | - | - | - | - | ON | - |
| LED ring effects | ON | OFF | ? | ON | - | - | ON | ON | - | - | ON | - | - | ON | - |
| Camera vision (photo to a model) | ON | OFF | ON | ON | ON | - | ON | ON | ON | - | ON | - | ON | - | - |
| Face recognition | XX | - | - | OFF | - | - | - | - | - | - | - | - | OFF | - | - |
| Memory / history | ON | OFF | - | OFF | - | OFF | - | - | ON(p) | - | - | ? | - | - | - |
| Cloud LLM | OFF(q) | OFF | - | OFF | ON(r) | ON | ON | ON | - | OFF | ON | ON | OFF | - | OFF |
| Web search | - | OFF | - | - | - | OFF | ON | - | - | - | - | - | - | - | - |
| OTA (network update) | ? | OFF | XX | ? | - | - | ? | XX | - | - | XX | - | - | - | - |
| Kid mode / content filter | ON | - | - | ON(s) | - | - | - | - | - | - | - | - | - | - | - |
| Proactive speech / greetings | ON(t) | OFF | - | - | - | OFF | - | XX | - | - | OFF | - | - | - | - |
| Touch petting reactions | ON | OFF | ON | ON | ON | - | ON | ON | ON | - | ON | - | ON | - | - |
| Shake reactions | ? | OFF | ON | ON | - | - | ON | ON | ON | - | - | - | ON | - | - |
| Sleep / dim | ON | ? | ON | ON | - | - | ON | XX | OFF | - | ON | - | - | OFF | - |
| Games | - | - | - | OFF | - | - | - | - | - | - | - | - | - | - | - |
| Timers / alarms / reminders | ? | - | - | - | - | - | ? | - | - | - | OFF | - | - | - | - |
| Music / radio | ON | - | - | ON(u) | - | - | - | - | - | - | - | - | - | ON | - |
| Smart-home control | - | - | - | - | - | ON(v) | - | - | - | - | - | - | - | - | - |
| MCP / agent tools | ON(w) | - | ON | OFF | ON | OFF | ON | ON(x) | - | ON | ON | ON | - | - | - |
| Subtitles / speech bubble | ? | - | ? | ? | - | - | ? | ? | ON | ON | - | - | ON | ON | ON |
| Battery / thermal protection | ON | ON(y) | ON | ON | - | - | ON | - | ON | ON(z) | ON | - | - | OFF | - |

Notes: (a) off in the default display-only build, microWakeWord in the uplink and release envs `[release inheritance
unverified]`. (b) host-side transcript match, not on device. (c) "Hey Nous-Girl" on, short "Hey YuB" off. (d) matched in
cloud STT of standby audio. (e) server side, with a 4-in-60 s storm guard. (f) only forwards the device's own abort.
(g) upstream `WAKE_WORD_DETECTION_IN_LISTENING` default n; text interruption exists. (h) unlimited in the HA add-on.
(i) Medium: bounded bursts every 3 min. (j) servo flag off in the default build. (k) after 40 s idle, sparse.
(l) overlay during talk state `[docs]`. (m) motion tracker only at Movement = High. (n) frame-difference tracker, paused in
conversation. (o) on request only; dot removed automatic "dance when music is detected". (p) affection score only.
(q) local LLM, but vision goes to a cloud VLM unless `DOTTY_LOCAL_ONLY=1`. (r) cloud TTS and ASR. (s) prompt only, no switch.
(t) known people only, 06-21, 3 per day, 4 h cooldown, plus "Hi!" on any face. (u) SD music on; radio, DJ, rave off.
(v) on in the HA add-on, off in standalone. (w) firmware tools on; rich MCP removed. (x) reboot and upgrade tools removed.
(y) in servo and release envs; compile default 0. (z) servo detach at boot and an e-stop.

## B. Consensus

**Left on by nearly everyone who has it**
- One prebuilt on-device wake word (WakeNet "Hi StackChan" / "Hey Jarvis" / "Hi ESP"): 6 of the 7 voice firmwares. It is the cheap, reliable path.
- Touch: tap to talk and stop, head petting reaction (10 of 11 repos with touch). Always with a cooldown (5 s xzf and dot purr, 15 s cmc).
- Shake reaction (7 of 8 with an IMU), but muted during speech or own motion (xzf, nou).
- Face animation, lip sync, state-coloured LEDs at low brightness.
- Photo on request.
- Idle head motion, but bounded: sparse intervals, cooldowns, torque release, paused in conversation.
- Battery-only dim or shutdown; never sleep on USB.
- Kid mode where it exists (dot) is on by default.

**Turned off, removed or never shipped by nearly everyone**
- Voice barge-in: disabled in nou, declined in alv, absent in loc, pet, min, mcp, oap; only dot keeps it, with a storm guard against "the robot's own echo". Hardware reason: CoreS3 mic and speaker share one I2S port and clock (`stackchan_alive/docs/SPEAKER_AUDIO_RESEARCH.md:144-149`), upstream device AEC is default off and not offered for this board (`Kconfig.projbuild` `USE_DEVICE_AEC`), server AEC is labelled "Unstable".
- Sound-direction turn: disabled in dot (always reads left), removed in loc, absent elsewhere. Two close mics in a plastic head next to a speaker and servos do not localize.
- Continuous face tracking: default off in 5 of 7 (nou, loc, mcp, gpt, alv). Reasons: servo noise and wear, heat, camera DMA pressure on PSRAM and internal RAM, the camera/touch I2C pin conflict.
- Face recognition: on by default nowhere; removed in dot on privacy grounds.
- Second or custom speech model running all the time: nou restricts MultiNet to idle and still lists choppy audio; alv rejected ESP-SR for frame time. Two cores are not enough for face + audio + two recognizers.
- Proactive speech: off or removed in alv, xzf, cmc, ais; dot keeps it with hours, per-day caps and unknown faces excluded, after "3 AM Hi!" greets.
- Saved history, web search, background agents: off by default wherever they exist except gpt's search.
- Model-callable reboot, firmware update, server switch: removed in xzf and nou after a voice request moved or rebooted the robot; vendor OTA is cut in loc, xzf, cmc.
- Automatic sleep that turns the mic off: disabled in xzf/ccb; fixed in dot.
- Games, timers, smart-home, kid mode: absent in almost all repos. This is a gap in the ecosystem, not evidence that users do not want them.

**What this says about users.** People keep the things that make the robot feel alive and answer quickly (wake word, face,
touch, small motion, lights) and switch off the things that surprise them: the head snapping toward noise, the robot
talking unprompted or at night, answering the TV, getting hot, clicking servos, and dying on battery. Every maintainer
who went past a demo ended up adding cooldowns, caps and quiet hours.

## C. Ten recommended defaults for a family product

1. **One prebuilt wake word ON; custom phrase OFF and labelled as a trade-off; sensitivity Normal with Low/High.** Evidence: WakeNet words are "lighter and very reliable" while the MultiNet phrase "keeps one CPU core busy" and makes audio choppy (`nous-girl-stackchan/docs/SETTINGS.md:73-77`, `VERSIONS.md:119,148`); short phrases false-wake (`docs/WAKE-WORDS.md:79`); ESP-SR cost 11.7 fps in alv (`docs/BOT_LOCAL_WAKE_ARCHITECTURE.md:32`), so measure frame time on our build.
2. **Voice barge-in OFF; tap the screen or head to stop, always.** Evidence: nou compiled it off for lack of echo cancel (`hg_barge.h:27-33`); shared I2S in alv (`SPEAKER_AUDIO_RESEARCH.md:144-156`); half-duplex note in oap (`README.md:161`); pet waits 250 ms after the speaker before opening the mic (`config.h:694`). If it is ever enabled, copy dot's guard: 4 interruptions in 60 s end the session, injected turns do not count (`dotty-stackchan/CHANGELOG.md:88,110`).
3. **Follow-up window of about 15 s, then back to wake standby; silence and room noise must not renew it.** Evidence: ais standalone default and reason (`README.md:200-205`); alv 6 s window / 15 s max turn; dot closes after 3 noise-like turns and drops near-silence hallucinations (`CHANGELOG.md:20,129`).
4. **Idle head motion ON but bounded ("Medium"), with a visible None/Little/Medium/High choice, torque release about 3 s after each move, no motion while speaking, and the mic gated for about 500 ms after servo motion.** Evidence: gpt levels (`README.md:60`); cmc torque release and gear wear (`reflex.py:82`, `xinchao_mood.py:54`); pet servo held in speech and mic pause (`release_notes_0.4.0.md:61-62`, `config.h:495`); xzf mutes the IMU during speech (`README_en.md:134`); alv duty cycle 120 s / 30 s and thermal shed at 70 C (`platformio.ini:444-449`).
5. **Face tracking OFF by default, sound-direction turn not shipped; a single turn toward the person at wake is enough.** Evidence: follow off in nou, loc, mcp, gpt, alv (section 1); dot's sound turner disabled for snapping left (`config.py:191-199`), wake turn kept (`config.py:211`); loc removed direction finding (`SECURITY.md:17`); "Active ... servos are noisy" (`stackchan-openapi/README.md:155`).
6. **Camera: photo only on request, with an on-screen indicator, capture on demand (never a continuous grab), no idle photos, no face recognition, and one obvious privacy gesture that turns camera, mic and wake word off.** Evidence: mcp shows the frame for 6 s (earlier audit); oap crash from 24/7 camera DMA (`firmware.ino:455-459`); camera/touch I2C conflict (`stackchan-mcp/docs/touch-sensor-camera-i2c-troubleshooting-2026-08-30.md:9-17`); dot privacy sleep exits by head touch only (`docs/modes.md:45,63-65`); dot removed biometric recognition (`CHANGELOG.md:178`); nou rate-limits photos to 1 per 5 s.
7. **Proactive speech OFF by default; if enabled: known people only, daytime hours, a per-day cap and a long cooldown, never to an unknown face.** Evidence: dot defaults `GREETER_GREET_UNKNOWN=false`, 4 h, 3 per day, hours 06-21 after 3 AM greets (`.env.example:161-177`, `CHANGELOG.md:179`); xzf removed the morning greeting (`README_en.md:135`); cmc ships silent with daily caps (`xinchao_mood.py:57-58`); alv initiative is opt-in (`lan_service.py:4805`).
8. **LEDs dim and state-only; idle = off; distinguish states by hue, not brightness; hard cap near 40-45%; no LED traffic while audio streams; screen brightness about 40-75 and volume about 70 with a floor above zero.** Evidence: dot LED table and the RGB565 quantisation note (`docs/modes.md:40-46,128`); nou caps (`hg_eq.h:306`, `cores3_py32_led.cc:292`); xzf "Battery power + all LEDs on may fail to boot" (`README_en.md:115`); cmc LED commands stutter speech (`xinchao_mood.py:108`) and brightness 40 "to reduce heat" (`reflex.py:80`); nou volume 70, floor 10 (`SETTINGS.md:87`).
9. **Kid mode ON by default and enforced in code on every speech path; history OFF until a grown-up opts in, with retention and one-tap clear; grown-up extras (radio, rave, email, web search) not installed by default.** Evidence: dot `DOTTY_KID_MODE=true` and fail-closed output filter, but greeter and admin say bypass it (earlier audit); nou admits prompt-only safety and "no kid filter" on radio (`docs/FEATURES.md:172,213-218`); ais history off by default with 90-day retention and clear (`docs/conversation-memory-and-wake.md:10-11`); search off in ais (`README.md:169`).
10. **Power and update safety: dim on battery only, never auto-sleep on USB in a way that stops the wake word, thermal and low-voltage load shedding for servos, a crash report page, updates only from the family's own host with rollback, and no model-callable reboot, update or server-switch tool.** Evidence: dot USB shutdown bug (`CHANGELOG.md:47`) and project paused over a power fault (`README.md:2-4`); alv blackout forensics and load-shed thresholds (`docs/POWER_BLACKOUT_FORENSICS.md:26-40`, `platformio.ini:448-453`); xzf/ccb sleep killed the wake word (`firmware-changes.md:147-158`); nou dim at 300 s on battery only and boot crash report (`SETTINGS.md:213-220`, `VERSIONS.md:134`); tools removed in xzf (`mcp_server.cc:138-140`) and nou (`skin_manager.cc:269-272`); rollback enabled in loc, gpt, xzf sdkconfig.

## Limits of this audit
- dot's firmware submodule is empty, so its firmware defaults (wake word model, AEC, idle motion, LED values) come from its docs only.
- Cells marked `?` were not traced to code. The alv release env inheritance chain and the xzf OTA block were not fully traced.
- All clones are single-commit snapshots: "built then disabled" comes from changelogs, comments and docs, not from git history.
- No issue trackers were available offline; theme counts are counts of repos that document the problem, not of user reports.
