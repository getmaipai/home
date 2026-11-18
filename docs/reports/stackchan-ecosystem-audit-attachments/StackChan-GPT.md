# Audit: StackChan-GPT (j15marti/StackChan-GPT)

Clone: `.../scratchpad/repos/StackChan-GPT`. Read-only; nothing run or built.

## 1. What it is
- A fork of `m5stack/StackChan` (official firmware + Go server + Flutter app + ESPNow remote) patched so the "Agent.ai" launcher app talks **directly to the OpenAI API** instead of the Xiaozhi/M5Stack cloud (README.md, firmware/README.md).
- License: MIT (LICENSE; upstream M5Stack MIT preserved in firmware/LICENSE, NOTICE lists xiaozhi-esp32 MIT, etc.). Server/LICENSE separate.
- Activity: git history is **a single squashed commit** (2026-11-12, "Update README with flashing instructions", author Jeremy Martinez), so no real history/blame. Stars: [unverified] (no GitHub API access from this session). Versions in docs: v1.8.6 to v1.8.11 (README "Highlights"), so active and fast-moving, but opaque history.
- Languages by file count: Go 166 (upstream server), C/C++ ~230 (firmware + vendored BMI270), Dart 99 (Flutter app), SVG 91, PNG 52.
- Size 76MB. What is large: `StackChan-GPT-v1.8.11.bin` 12.9MB (merged 16MB-flash image committed to the repo root); the **Flutter app is 35MB** (`app/ios/Runner/3DModel/StackChanModel.scn` 8.3MB, `stack_chan_model.glb` 3.3MB duplicated 3x in app/assets, app/assets/assets, android res/raw; `image1.png`/`lateral_image.png` 2.8MB each, duplicated twice); server 4.5MB incl. `server/file/music/stackchan_music.mp3` 3.1MB; `remote/code/*.bin` 1.2MB. Firmware source itself is only 4.3MB; docs 524KB. About 55MB of the 76MB is binaries and duplicated assets.

## 2. Architecture and protocol
- Device-direct-to-cloud. ESP32-S3 CoreS3 firmware (ESP-IDF **6.1**, same as ours; sdkconfig.defaults) runs `OpenaiProtocol` (firmware/main/hal/openai_protocol.cpp, 2588 lines) which replaces the xiaozhi `Protocol` class via `firmware/patches/xiaozhi-esp32.patch` applied by `fetch_repos.py` on top of xiaozhi-esp32 v2.5.2 (repos.json pins mooncake, smooth_ui_toolkit, ArduinoJson, esp-now by tag/sha).
- Two paths: (a) HTTP pipeline: PCM to WAV to `POST /v1/audio/transcriptions`, then `/v1/chat/completions` with tool calling, then `/v1/audio/speech` returning raw 24kHz PCM streamed to the AW88298 speaker (no Ogg/Opus decode, a real latency win); (b) "GPT-Live": WebSocket to `/realtime?model=...` or `/live/sessions` for direct speech-to-speech PCM (openai_protocol.cpp ~L223-1500, live_ws_url()).
- Tools: MCP-style device tools are renamed `self.robot.x` to `self__robot__x` for OpenAI function calling (mcp_name_to_openai ~L107) and sent with every chat; web search via `/v1/responses` hosted `web_search` (hal/openai_web_search.cpp).
- Local side channels kept from upstream: NimBLE GATT for the iOS app (hal_ble.cpp), LAN WebSocket "Avatar" to the app (hal_ws_avatar.cpp), ESPNow remote (hal_espnow.cpp, remote/).
- Local vs cloud: **all intelligence is cloud (OpenAI)**; nothing local except wake word and motion. `base_url` is configurable, so any OpenAI-compatible endpoint (a local host) can be substituted; hosted web_search requires a base that supports Responses.

## 3. Wake word and speech stack
- Wake: on-device ESP-SR WakeNet9 "Hi StackChan" (`CONFIG_SR_WN_WN9L_HISTACKCHAN_TTS3`), plus a **custom text wake word via Whisper in Standby**: audio is captured on VAD, transcribed by OpenAI, then `match_wake_word()` fuzzy-matches the transcript (openai_protocol.cpp ~L450). That means standby speech is uploaded to OpenAI, a privacy cost (constants kStandbySilenceTimeoutMs=1140, soft gain 1.5x at L48-51).
- STT: whisper-1 / gpt-4o-mini-transcribe. LLM: gpt-4o-mini/gpt-4o, or gpt-realtime / "GPT-Live". TTS: tts-1 with 9 voices. Vision: camera JPEG sent to OpenAI Vision via `self.camera.take_photo`.
- Emotion tags `[happy]`, `[sad]` prefixed in replies are parsed (parse_emotion_prefix L136) to drive face + servo; realtime prompt tells the model not to speak the brackets (L212).

## 4. Features
- Faces and decorators (angry, dizzy, heart, shy, sweat) under firmware/main/stackchan/avatar; modifiers: blink, breath, speaking, idle_motion, idle_expression, head_pet, imu, dance, timed (stackchan/modifiers).
- Touch: tap face to talk; head touch (hal_head_touch.cpp); swipe launcher carousel.
- Servos: Feetech SCS yaw/pitch (yaw +-128 deg tool range, pitch 0-90), spring-based motion (smooth_ui_toolkit `moveWithSpringParams(stiffness=170, damping=26)`, servo.h), speed mapping 0-1000.
- LEDs: 12 RGB neon, left/right sets; state colours listening emerald (0,75,25), thinking purple (50,15,85), speaking cyan (0,45,95); LLM can set custom colour which persists (README).
- Camera: GC0308; **deterministic idle motion tracking** (hal/idle_camera_motion.cpp, doc IDLE_CAMERA_TRACKING_v1.8.7.md): two luma frames 250ms apart, median brightness compensation, 4 quadrants, >10% changed pixels triggers, centroid to servo correction with 12% deadband, max step 32/22 deg, 30s session, no network use.
- Dance: mic onset-energy BPM estimate (70-160 BPM clamp, default 120), 16-beat up/down then left/right, LED red/blue/green/purple sequence, 45s default (robot_dance*.h, DANCE_v1.8.9.md).
- BLE (Wi-Fi provisioning, setOpenAI command), ESPNow remote, IMU (BMI270), RTC, reminders, rest-movement setting (None/Little/Medium/High).

## 5. Security
Weaknesses (concrete):
1. **Unauthenticated HTTP config portal on port 80** (hal_openai.cpp `start_web_config_server`, L676+). `POST /api/config` accepts `apiKey`, `baseUrl`, `systemPrompt` with no auth, no CSRF token, no Origin check; any LAN host (or a web page in a LAN browser) can replace `baseUrl` with an attacker host, after which the **API key is sent as a Bearer header to that host** (openai_protocol.cpp L591) and audio goes there. `GET /api/config` returns systemPrompt and a masked key (fine). `/api/test_hardware` moves servos unauthenticated. Mitigation: server only runs while the setup screen/Agent app asks for it (start at openai_protocol.cpp L743 and app_setup/workers/ai_agent.cpp L41), but it is started at Agent boot too [unverified whether it is stopped after].
2. **TLS verification likely off**: sdkconfig.defaults sets `CONFIG_ESP_TLS_INSECURE=y` and `CONFIG_ESP_TLS_SKIP_SERVER_CERT_VERIFY=y`, and `perform_http_json_post` (openai_protocol.cpp ~L572) builds `esp_http_client_config_t` with **no `crt_bundle_attach`** (only `ota.c:146` attaches the bundle; openai_protocol.cpp includes esp_crt_bundle.h but grep finds no use). Whether the connection is then unverified depends on esp-tls internals [unverified], but the pairing is a red flag: a LAN MITM could capture the OpenAI key. Our rule: never copy this.
3. baseUrl accepts `http://` and maps to `ws://` (live_ws_url L223-231): key over cleartext if misconfigured. No validation.
4. API key stored plaintext in NVS (no NVS encryption set in sdkconfig.defaults) **and mirrored to microSD** as `/sdcard/stackchan_config.json`, `openai_key.txt` (hal_sd_backup.cpp L189-246). Convenient restore after merged-flash wipe, but anyone with the card gets the key and Wi-Fi passwords.
5. Static device-to-server tokens: `secret_logic.cpp` weak defaults return `"hi-stack-chan"` for both auth and handshake tokens (upstream design; should be overridden by a private build). Go server `web_socket.go:67` `CheckOrigin: return true`.
6. BLE `setOpenAI` writes the key over GATT; pairing/bonding requirements not evident [unverified] (hal_ble.cpp ~L497).
7. Binary supply chain: a 12.9MB prebuilt image + `.sha256` for **v1.8.8 while the binary is v1.8.11** (stale hash file, StackChan-GPT-v1.8.8.sha256). The only workflow is a leftover M5Stack WeCom forwarder using `pull_request_target` (.github/workflows/wecom-digest-forward.yml), irrelevant and a risky trigger pattern to copy.
Good practices:
- Config POST body capped at 4096 bytes and JSON-validated (hal_openai.cpp L589-610); key masked in GET; `scan_secrets.py` secret/IP grep tool in firmware/; README says "binary contains no API key or Wi-Fi credentials" and example config uses placeholders; web search tool returns explicit errors on missing sources and sets `store:false` (tests check it); camera frames never leave RAM for the idle tracker; `CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE=y`; `CONFIG_SEND_WAKE_WORD_DATA=n`.

## 6. Performance and memory
- Raw 24kHz PCM TTS instead of Ogg/Opus (README highlight).
- Worker task stack explicitly allocated in **internal RAM** with `heap_caps_malloc(MALLOC_CAP_INTERNAL|MALLOC_CAP_8BIT)` and a static task buffer, because `SPIRAM_ALLOW_STACK_EXTERNAL_MEMORY` would otherwise put it in PSRAM (openai_protocol.cpp L691-718). Logs free internal heap at L2150/2219.
- sdkconfig: `SPIRAM_MALLOC_ALWAYSINTERNAL=128`, `RESERVE_INTERNAL=65536`, `MBEDTLS_EXTERNAL_MEM_ALLOC`, `MBEDTLS_DYNAMIC_BUFFER`, `DYNAMIC_FREE_CONFIG_DATA`, `SSL_KEEP_PEER_CERTIFICATE=n`, NimBLE host in PSRAM, Wi-Fi RX buffers cut (static 3, dynamic 6, BA window 3), `-Os`, 16MB QIO. Good TLS-RAM reductions we can crib.
- Adaptive VAD floor, standby capture hangover 1140ms; frame pair motion detection only when idle for 30s and not speaking.

## 7. UI and images
- Images (viewed): `docs/agent_ai.png` and `settings_page.png` are phone photos of the 320x240 launcher carousel: flat icon on teal/grey background, white chevrons, page dots, a bold title ("Agent.ai", "SETUP", gear). Clean and legible but upstream design, low resolution, photos not screenshots. Rating **3/5**. `StackChan-GPT_image.jpeg` is an AI-generated cartoon hero (StackChan with floating brain/gear/speech bubbles; cute, on-brand, 4/5 as promo art but not a real screenshot). The web config portal is an inline HTML string (kWebPortalHtml, hal_openai.cpp L378+), an on-device QR code leads to it.
- 12 SVG/PNG face-ish assets live in the Flutter app; 3D model (glb/scn) is used by the app to render the robot. Rating of the app UI: [unverified] (not run).

## 8. README and docs
- README is a changelog-style highlight list with a one-line flash command plus the M5Burner path, a clear NVS/SD persistence table and a "do not commit real secrets" JSON example. Per-feature docs with behaviour numbers (thresholds, ranges) and release validation (SHA-256, image size, "24% partition free", "Physical servo direction ... still require post-flash hardware checks because no unit was connected": honest about what was not hardware tested, a good transparency habit). AI authorship not stated explicitly [unverified], though the doc voice and hero image suggest heavy AI assistance.
- Tests: 4 host-side C++ tests (firmware/tests: motion_math, idle_camera_motion, openai_web_search, robot_dance_beat) built with plain CMake+ctest against cJSON, no hardware needed. **No CI** (only the stray WeCom forwarder). Quickstart is clear but build instructions say `fetch_repos.py` then `idf.py build`.

## 9. Adopt / avoid
Adopt:
1. Host-side CMake/ctest unit tests for pure logic (motion math, beat detect, motion detect) compiled outside ESP-IDF, plus feeding them synthetic frames; ideal seam for a virtual tester.
2. Raw PCM streaming TTS (24kHz) to skip decode when using an OpenAI-compatible TTS.
3. Internal-RAM task stack via `heap_caps_malloc` + static task buffer for TLS/network workers; and the mbedTLS PSRAM/dynamic-buffer sdkconfig set.
4. Camera idle-motion tracker algorithm (median-compensated luma diff, quadrants, centroid, deadband, 30s cap) as a local-only "notice someone" behaviour.
5. Onset-energy BPM estimator for dance/LED sync.
6. NVS to microSD config mirror with the "empty NVS never overwrites good backup" rule, but encrypt/omit secrets.
7. Emotion tag prefix `[happy]` parsed to drive face/servo, with a prompt rule to never speak brackets.
8. Per-feature docs with exact thresholds and a "validated vs not hardware-tested" section; `scan_secrets.py` pre-release grep.
Avoid:
1. Unauthenticated port-80 config portal that can rewrite baseUrl/API key; no TLS verify flags (`ESP_TLS_SKIP_SERVER_CERT_VERIFY`) or http/ws fallback.
2. Committing merged firmware binaries and duplicated 3MB assets to git, with a stale checksum file; squashing history.
3. Uploading standby audio to a cloud STT just to detect a custom wake word.
