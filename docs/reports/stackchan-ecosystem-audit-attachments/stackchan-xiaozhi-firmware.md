# Audit: stackchan-xiaozhi-firmware

Root: /tmp/claude-0/-home-user-home/7524bf19-2972-532d-bd20-b8fb4e44bb56/scratchpad/repos/stackchan-xiaozhi-firmware
(Paths below are relative to that root.) Audit was read-only; nothing run or built.

## 1. What it is
- A fork of the xiaozhi-esp32 firmware (78/xiaozhi-esp32, ~109k LOC of C/C++/py incl. ~90 upstream boards) with ONE board heavily customised for M5Stack CoreS3 Stack-chan: `main/boards/m5stack-core-s3/m5stack_core_s3.cc` (2477 lines, almost all the product). Derived from mo-hantang/Stackchan-HtSz (README_en.md).
- README.md title: "StackChan-XiaoZhi (Claude Code bridge adapted)". Latest commit 2026-09-06 "notify HTTP server with attention/dismiss MCP tools for Claude Code approval alerts" (author "WorkBuddy"). Clone is shallow (1 commit); stars not recoverable [unverified]. README_en badge points at howecheung/Stackchan-XiaoZhi, so this clone is a downstream copy.
- License: MIT (LICENSE, copyright Shenzhen Xinzhi Future Technology + Project Contributors). Size 17 MB. Languages: C++ (firmware), a little Python/JS tooling (`scripts/`).
- ESP-IDF 5.5.x (README_en.md, CI image espressif/idf:v5.5.2). Not 6.1.

## 2. Architecture
- Firmware only; there is NO server in this repo. It speaks the xiaozhi protocol (docs/websocket.md, docs/mqtt-udp.md, docs/mcp-protocol.md): WebSocket JSON + binary Opus frames, or MQTT+UDP; MCP JSON-RPC 2.0 tools are carried inside the same channel (`main/mcp_server.cc`).
- Default OTA/config endpoint is Tenclass cloud `https://api.tenclass.net/xiaozhi/ota/` (`main/Kconfig.projbuild:5`), overridable by NVS `wifi/ota_url`. Server is expected to be self-hosted `xinnan-tech/xiaozhi-esp32-server` (README) or the vendor cloud. So privacy depends entirely on which server you point at; default is cloud.
- Device-local pieces: wake word, AFE (AEC/VAD/NS), camera frame-diff motion tracking, IMU gestures, touch, LEDs, servos, avatar rendering, power save. Cloud/server pieces: STT, LLM, TTS, MCP tool-calling decisions.
- Extra: a LAN HTTP "notify" server on port 8788 (`main/notify_http_server.cc`) so a desktop Claude Code hook can POST /notify, /dismiss; it converts into MCP `self.notify.attention` (head shakes x3, alert text) / `self.notify.dismiss` (nod).

## 3. Wake word
- ESP-SR. Config in `sdkconfig.defaults`: `CONFIG_USE_CUSTOM_WAKE_WORD=y`, phrase "ni hao xiao zhi", `CONFIG_SR_MN_CN_MULTINET6_QUANT=y`, sensitivity HIGH. `main/audio/wake_words/custom_wake_word.cc` uses esp_mn (MultiNet6) as the wake word detector (a command-recognition model abused as wake phrase, pinyin-configurable at build time, optional runtime JSON model config with `threshold`), plus WakeNet init. Alternatives in tree: `afe_wake_word.cc` (WakeNet), `esp_wake_word.cc`.
- On device, 100% local; triggered inside the AFE feed task, then opens audio channel and starts listening. README README_en: sensitivity Low/Medium/High, "use High for uncommon words". Known-issue notes mention tuning needed. Interrupting is by wake word again (barge-in) [unverified for this fork].
- Good for us: MultiNet lets you change the wake phrase without training a model, only the pinyin string (Chinese-only; English MultiNet is weaker) .

## 4. Speech stack
- STT/LLM/TTS all server side (xiaozhi-esp32-server: selectable providers, local or cloud). Not in repo. Device streams Opus 16 kHz up, Opus down. Latency tricks are upstream's: AFE with AEC + VAD (`main/audio/processors/afe_audio_processor.cc`), Opus frame streaming, no local TTS.
- Text injection: `SendUserText`/touch messages inject text into the live session ("Text Interruption", README_en) with a 24-byte guard on long text.

## 5. Features (README_en.md, m5stack_core_s3.cc)
- Face: custom LVGL canvas avatar `LvglAvatar` (line 437+), 21 expressions (Neutral..Delicious, line 413), 13 overlays (tear, heart eyes, blush, glasses, zzz, think bubble...), breathing sine, randomised blink, saccades, speaking mouth.
- 12x WS2812 emotion LED ring via PY32 IO expander, 21 emotion colours (`UpdateLedsFromEmotion`, line 1583), MCP tools `self.led.set_color/turn_off/auto`.
- Head touch SI12T 3-zone (7 random responses); FT6336 screen touch 6 gestures, ~60 action texts (pools: `DoubleClickPool`, `UpSwipePool`, ...). These send canned user messages to the LLM (touch -> LLM reaction).
- BMI270 IMU: shake and lift detection, mute during speech, 5-minute global cooldown (MotionLoop, line 1419).
- Feetech SCS bus servos (SCS.cc, SCSCL.cc), idle scan, nod/shake/tilt, MCP `self.head.move/center/nod/shake`; `manual_lock_` stops tracker from fighting an LLM-commanded pose.
- Camera GC0308 (320x240 YUV): crude frame-difference "face" tracker (downsample to 40x30, threshold 20, centroid) not a real face detector (line 206+). Also `self.camera.take_photo` upload tool.
- Sleep: 30 s idle -> backlight 0, LEDs off, servos off (`InitializePowerSaveTimer`).
- Wi-Fi provisioning AP page 192.168.4.1 with dark mode, 45 languages, long-press 5 s to re-enter.
- No timers, games, memory, kid mode, parental controls, or persona; the LLM persona is server side.

## 6. Security
Good:
- OTA: dual-slot (`partitions/v1/16m_stackchan.csv`, ota_0/ota_1 3 MB each) with `CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE=y`; remote OTA deliberately disabled ("Disabled remote OTA upgrade", changelog 2026-06-10) and `upgrade_firmware` MCP tool removed; README warns to use `auth.enabled=true`, MAC whitelist, not to expose ports.
- Notify handler caps body at 512 B, project name at 40 chars, 413 on oversize (`notify_http_server.cc`).
- WebSocket sends `Authorization: Bearer <token>` from NVS, `Device-Id` MAC header (`main/protocols/websocket_protocol.cc:86-106`).
Weaknesses:
- Notify server on :8788 has NO authentication, no TLS, no token, no source-IP check; anyone on the LAN can POST /notify and make the robot shake its head and show text, a spoofing/annoyance vector (and a prompt-injection-adjacent "approve now" lure). It also blocks the httpd task ~2.7 s per call (vTaskDelay loop).
- No secure boot, no flash encryption in any sdkconfig (grep returned nothing); `CONFIG_BOOTLOADER_SKIP_VALIDATE_ALWAYS=y` weakens boot validation (`sdkconfig.defaults`).
- Default OTA/activation host is a third-party Chinese cloud; device MAC is the identity (spoofable).
- TLS posture for the websocket is whatever the URL says; `ws://` is allowed. Token in NVS plaintext (no NVS encryption).
- `build.log` committed (leaks builder paths /home/ubuntu), `managed_components/` committed with hand-patched HTML (CI has a hack to stash/re-copy it) = supply-chain hygiene smell; `m5stack_core_s3.cc.servo-backup` junk file.
- Camera + mic always-on hardware with no hardware indicator or privacy statement; no AI/data-flow disclosure in the README.
- No kid/privacy safeguards anywhere in firmware.

## 7. Performance and memory
- `sdkconfig.defaults`: size optimisation (`COMPILER_OPTIMIZATION_SIZE`), QUAD PSRAM (they switched back from OCT: "SPIRAM changed back to QUAD" changelog), `ESP_TASK_WDT_TIMEOUT_S=10`, `MBEDTLS_DYNAMIC_BUFFER=y`, `MBEDTLS_SSL_KEEP_PEER_CERTIFICATE=n`, `NEWLIB_NANO_FORMAT`, reduced Wi-Fi RX buffers (copied from ESP-HI), run-time stats enabled, LVGL: no extra widgets, LODEPNG, C-lib malloc.
- Partition: 16 MB: nvs 16K, `model` spiffs 4 MB (SR models), ota_0/ota_1 3 MB, `assets` 6 MB (fonts/emoji).
- Avatar: single RGB565 canvas buffer in PSRAM (`heap_caps_malloc MALLOC_CAP_SPIRAM`, line 446), 50 ms LVGL timer redraw using only primitive fills (rect/circle/triangle/arc/line), no bitmaps => tiny memory, quick, but full-canvas redraw each tick.
- Tasks: face_track, motion, si12t each pinned to core 1 at priority 1 with 3-4 KB stacks; tracker works on 40x30 downsample (cheap), peeks frames without copy (`PeekFrame`).
- Idle power: pause tracker/servo scan during conversation; mute IMU during speech (servo noise would false-trigger).

## 8. UI / screens
- No screenshot of the Stack-chan face in the repo. Only upstream device photos in docs/v0, docs/v1 (e.g. `docs/v1/m5cores3.jpg`, which I viewed: a CoreS3 showing the stock xiaozhi chat screen with a thinking emoji and Chinese text, i.e. NOT the custom avatar) and `docs/mcp-based-graph.jpg`.
- Face code approach: procedural vector drawing on `lv_canvas` (LVGL 9 layer API: `lv_canvas_init_layer`, fill primitives), mouth/eye/overlay functions parameterised by expression enum + `eye_open_ratio_`, gaze, breath, `mouth_open_`; behaviour gates per expression (BlinkAllowed, SaccadeEnabled, GetGazeOverride, SlowBlink). Monochrome white-on-black. Clean state-gated idea set, but white-on-black simple look.
- Screenshot rating: 1/5 (nothing to look at for the product; stock photo only).

## 9. README / docs
- README.md (Chinese) + README_en.md: shields badges (platform, IDF, license, release), feature table with emoji, quick start with one-line esptool command with explicit offsets, "flash succeeded but device does not boot" FAQ, config table, known issues in a details block, dated changelog. Good practical tone for hobbyists. Upstream docs (websocket.md, mcp-protocol.md, custom-board.md) are good protocol references.
- No AI transparency, no privacy or data-flow page, no tests (no unit tests for the custom board), CI is one build workflow (`.github/workflows/build-cores3.yaml`) that packs bootloader/partition/app bins for release (nice: separate flash artefacts) but contains workarounds.
- CONTRIBUTING absent in root; docs/code_style.md inherited.

## 10. Top 8 ideas to adopt
1. Expression-gated idle behaviours: per-expression blink allowed / slow blink / saccade allowed / gaze override table (`LvglAvatar::BlinkAllowed/SaccadeEnabled/GetGazeOverride`). Cheap, makes faces feel alive.
2. Overlay layer (tears, hearts, blush, zzz, exclamation, think bubble) separate from base expression enum, composable.
3. `manual_lock_` on tracker/scan so LLM-commanded head poses are not overridden by autonomous behaviour (and ResumeScan after).
4. Mute IMU while speaking (servo/speaker vibration) plus global cooldown + re-arm-after-stillness for shake/lift triggers.
5. Touch and gesture mapped to canned user-intent texts picked at random (pools), sent into the conversation instead of scripted replies, so persona stays in the LLM.
6. Cheap motion tracker: 40x30 grayscale downsample + frame diff + centroid, with no-motion hysteresis counters; usable as a low-power "someone is near" cue.
7. Local desktop-notify webhook -> robot "needs attention" gesture (our adaptation: authenticated, for household reminders/approvals).
8. Release hygiene: CI packing bootloader/partition/otadata/app bins separately with a documented esptool offset command; Wi-Fi portal preview script `scripts/wifi-preview.js` to iterate the portal without flashing.

## 10b. Avoid
1. Unauthenticated LAN control endpoint and blocking sleeps inside a httpd handler.
2. Committing build logs / patched `managed_components` and CI hacks to restore them; ship patches as proper component overrides.
3. A 2500-line single-file board class mixing servo, touch, face, LED and network code; and leaving SKIP_VALIDATE_ALWAYS with no secure boot while also exposing a LAN port.

## Digest
- Wake: ESP-SR MultiNet6 custom phrase "ni hao xiao zhi" (+WakeNet init), on device, sensitivity L/M/H.
- License MIT; ESP-IDF 5.5; xiaozhi-esp32 fork, CoreS3 board only; last commit 2026-09-06; stars unknown.
- Stack: WebSocket JSON+Opus, MCP tools; STT/LLM/TTS on server (default Tenclass cloud, or self-hosted xiaozhi-esp32-server).
- Features: 21-expression canvas face, LED ring, 3-zone head touch, 6 gestures, IMU shake/lift, SCS servos, camera frame-diff tracking, sleep, Wi-Fi portal.
- Best ideas: expression-gated blink/saccade, overlays, tracker manual lock, IMU mute while speaking, touch pools, motion tracker, notify webhook, CI flash bins.
- Weaknesses: unauthenticated :8788 notify, no secure boot/flash enc, cloud default, committed build.log/managed_components, no AI/privacy disclosure, no tests, no kid mode.
- Screenshot rating: 1/5 (no product screenshots).
