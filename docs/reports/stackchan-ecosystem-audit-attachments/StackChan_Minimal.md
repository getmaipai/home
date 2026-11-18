# Audit: StackChan_Minimal (A-Uta Works)

Root: /tmp/claude-0/-home-user-home/7524bf19-2972-532d-bd20-b8fb4e44bb56/scratchpad/repos/StackChan_Minimal (paths relative). Read-only; nothing run.

## 1. What it is
- A tiny AI companion robot on M5Stack AtomS3R (128x128 display) + Atomic Voice Base + optional 2 servos + MAX30100 pulse sensor, with 3D-printable case STLs (`hardware/cases/*.stl`, own TERMS_OF_USE.md). "For demonstration, learning and Maker activities" (README.md). Talks to LAN AI servers: whisper.cpp (STT), llama.cpp/LM Studio/Ollama (LLM), piper-plus or VOICEVOX adapter (TTS).
- License Apache-2.0 (LICENSE, NOTICE "Copyright 2026 A-Uta Works"); vendored M5Stack-Avatar is MIT (`lib/M5Stack-Avatar/LICENSE.txt`, c) 2018 Shinya Ishikawa); third_party_licenses/ includes LGPL-2.1 text + Arduino core notice; VOICEVOX/voice-library terms carefully disclaimed.
- Last commit 2026-06-15 "Add third-party license notices"; shallow clone (1 commit); stars unknown [unverified]. Size 7.5 MB (incl. a 4 MB-ish `docs/firmware/merged-firmware.bin`). Languages: C++ (src 8.3k lines: `src/main.cpp` 6167, `PiperStreamPlayer.h` 1023, `AudioWhisper.cpp` 530, `Whisper_d_cpp.cpp` 398), Python (`tools/tts_server.py`), HTML (`incbin/html/*.html`), bash. PlatformIO, Arduino-ESP32 core 2 (`espressif32@6.7.0`, deliberately pinned back because core 3 made servos twitch on `ledcAttach`, platformio.ini comment). Not ESP-IDF.

## 2. Architecture
- Firmware (client) -> LAN servers over plain HTTP: device records audio itself, POSTs WAV multipart to a whisper.cpp server (`src/Whisper_d_cpp.cpp:149`), sends the text to an OpenAI-compatible (`/v1/chat/completions`) or Ollama (`/api/chat`) endpoint (`src/main.cpp:4368-4374`), then streams WAV from a TTS server (`/tts_live.wav`, `/tts_stream.wav`, `/tts.wav`) and plays it as it arrives (`src/PiperStreamPlayer.h`). All local; no cloud required (a HTTPS/`WiFiClientSecure` path exists for OpenAI-style hosts, `src/main.cpp:3824`).
- No WebSocket, no Opus, no custom protocol; device pulls over HTTP request/response. `tools/tts_server.py` is a FastAPI unified TTS front for Piper-plus (つくよみちゃん) and VOICEVOX (ずんだもん, 四国めたん) with a SHA-256 keyed WAV cache; `tools/termux/*.sh` start/stop/status scripts run llama/whisper/piper on an Android phone via Termux+proot (!).
- Also exposes a small device REST API `/api/v1/{health,state,capabilities,publish,service,action,action/result,blob,estop,estop/clear}` (`src/main.cpp:5736-5745`) so external agents/controllers can set faces, motion, record audio, fetch blobs, and hit an emergency stop.
- Delivered with a browser flasher: `docs/index.html` using ESP Web Tools + `docs/manifest.json` + merged firmware (served via GitHub Pages) and Improv Wi-Fi.

## 3. Wake word
- None. Conversation starts on button: `M5.BtnA.wasPressed()` single click = start talking, multi-click patterns for other modes, hold = cancel TTS (`src/main.cpp:5999-6020`, `:4275`). After start it records with an energy VAD. The "WAKE" strings in code are servo MOTION_WAKE_CENTER (a servo warm-up pose), not speech wake. No ESP-SR, no microWakeWord. Push-to-talk only.

## 4. Speech stack
- STT: whisper.cpp HTTP server on LAN; on-device energy VAD with RMS threshold (default 180 after field tuning, min speech, max silence 40 frames ~0.375 s, post-speech tail ~0.6 s total), warm-up frames ignored, circular pre-speech buffer so first syllable is not clipped (`src/AudioWhisper.cpp:16-90`). Web calibration page `/vad_calibration` measures room noise and sets the threshold (`incbin/html/vad_calibration.html`).
- LLM: local OpenAI-compatible or Ollama; model pickable via `/model_ver`, `/llm_models_get`. Prompts/lang switch (ja/en etc).
- TTS: Piper-plus streaming (raw PCM wrapped as WAV chunked) for low first-audio latency; VOICEVOX returns a complete WAV (no streaming). Client parses WAV + chunked HTTP itself, plays via M5.Speaker; up to 16 chunks (`MAX_CHUNKS`). Sentence-batch TTS queue with `g_ttsQueue` (8 jobs) and a dedicated `ttsTask` on core 0; batch wait timeout 70 s; cancel by button hold. Server cache by sha256(text,length_scale,lang,character) makes repeat phrases instant.
- All fully local if you run the servers yourself.

## 5. Features
- Face: M5Stack-Avatar (Neutral/Happy/Sad/Doubt/Sleepy/Angry), speech text bubble, lip-sync, motion-linked.
- Servo (optional, `-DENABLE_SERVO`): nod/shake/idle/init, conversation-linked motion; dedicated `servoTask` on core 0 priority 2 so main loop blocking does not stall servos; boot INIT = center then detach (no holding torque); `servoEstopHalt()` and emergency stop; wake-warm-up then nod to hide servo startup jump.
- Web UI pages (embedded via incbin): Wi-Fi config portal (captive DNS + `http://m5stack/` + mDNS), character voice, piper-plus voice, model/LLM selection, text chat, VAD calibration, head (servo) settings.
- MAX30100 heart-rate/SpO2 demo with strong "not a medical device" statement in EN+JA. BME688 mentioned in capabilities but "not included in this public release".
- No camera, no touch-driven behaviours, no timers/games, no kid mode, no long-term memory, no MCP.

## 6. Security
Good:
- Entire AI path is local-first; the README states the repository ships no models/engines/voices and requires user to install VOICEVOX separately and credit voices; explicit non-medical disclaimer.
- Servo emergency stop concept + 503 `estop_active` guard on all actuating endpoints; HTTP 202 async action pattern with polling to avoid handler timeouts; 405 on wrong method, JSON-size-bounded `DynamicJsonDocument(512/256)`; TTS server clamps `length_scale` 0.5-2.0 and passes subprocess args as a list (no shell), 60 s timeout, text via stdin (no command injection).
- Cache key is a hash, not user-supplied filename (no path traversal).
Weaknesses (confirmed in code):
- Setup AP is OPEN (no password): `WiFi.softAP(apSsid.c_str())` (`src/main.cpp:2722`), SSID "STACKCHAN-<chipid>", captive-portal DNS answers everything; Wi-Fi credentials entered over open plain HTTP.
- Device REST API and all config pages have no authentication whatsoever (grep for auth/token finds only outbound Bearer headers); anyone on the LAN can POST `/api/v1/action` (record audio from mic -> `/api/v1/blob` GET to fetch it = remote eavesdropping), `/api/v1/publish`, `/api/v1/estop/clear`, `/wifi_save`, `/model_ver_set`.
- `GET /model_ver_get` returns the stored OpenAI/LLM API key in plaintext JSON (`src/main.cpp:2899`); keys saved in NVS plaintext (`preferences.putString("openai_key")`). For local LLM it is "dummy", but users with a real cloud key leak it to any LAN client.
- `tts_server.py` (FastAPI) has no auth/rate limit/size limit on `text`, and CACHE_DIR grows unbounded (DoS/disk fill); runs on LAN HTTP only.
- Plain HTTP between device and all servers; `WiFiClientSecure` use not shown to pin certs [unverified whether `setInsecure()` is used: grep for it returned nothing, but no CA pinning either].
- No OTA at all (single `factory` app partition 0x7E0000, otadata exists but unused; `max_app_8MB.csv`); updates via web flasher with `new_install_prompt_erase: true`. No signing, secure boot, flash encryption.
- No kid/privacy safeguards, no AI disclosure beyond tool list; mic is user-triggered by button (good privacy default) though the remote API can trigger recording.

## 7. Performance and memory
- AtomS3R: `board_build.arduino.memory_type = qio_opi`, `-DBOARD_HAS_PSRAM`; large buffers via `ps_malloc` / `heap_caps_malloc(MALLOC_CAP_SPIRAM)` for blobs and base64 (`main.cpp:1701, 2511`), record buffer + pre-speech buffer in 8-bit internal heap with error logs.
- Partition (`max_app_8MB.csv`): nvs 20K, otadata, one 8,064 KB factory app, 64 KB `coredump` partition (post-mortem). Flash tradeoff: no OTA, max app space.
- Tasks: servoTask core 0 prio 2 stack 2048; ttsTask core 0 prio 1 stack 8192 (comment: "speak_piper_http needs large stack"); loop on core 1; mutex `g_avatar_text_mutex` for UI text shared across tasks; atomic cancel/pending-job counters.
- Streaming playback: parse WAV header, chunked decoding, start playback after first chunk; server-side cache; VAD pre-roll; `CORE_DEBUG_LEVEL=2`.
- Core 2 pin chosen because core 3 `ledcAttach` glitched servo: a real-world finding worth noting for our servo init.

## 8. UI / screens
- Image: `docs/images/StackChan_Minimal_git.jpg` (viewed): two photo-real 3D-printed AtomS3R robots (orange fox/cat-ear shell, lilac cat-ear shell) held in hands, tiny black screen with minimal white-dot eyes and flat mouth (the classic Stack-chan look), servo legs/feet, with bilingual title overlay "Stack-Chan Minimal / スタックチャン ミニマル 会話". Charming, shows scale and personality (colored printed shells, cat ears), but low resolution and a video thumbnail, not a UI screenshot.
- No UI screenshots of the web pages or screen states (HTML pages in `incbin/html/`). Face drawing is the M5Stack-Avatar library (vector eyes/mouth/eyebrow via M5GFX sprites, `lib/M5Stack-Avatar/src/{Eye,Mouth,Eyeblow,Face}.cpp`, expression enum, speech balloon, battery icon, gaze, open ratio); main code only sets expression + text + mouth open from audio level.
- Rating: 3/5 (one good human-scale marketing photo; no UI screenshots).

## 9. README / docs
- Short README: feature bullets, hardware list, "AI server tools" required separately, VOICEVOX credit examples, HR/SpO2 disclaimers in EN and JA, license, link to paid BOOTH PDF guide. Honest scoping ("not affiliated/endorsed", "not a medical device"). Web Installer for non-developers is a strong adoption feature. No badges, no CI (no `.github`), no tests, no CONTRIBUTING, no SECURITY.md, no architecture doc, no screenshots of settings pages. Third-party notices handled well.

## 10. Top 8 ideas to adopt
1. Browser flasher: ESP Web Tools page + manifest + merged-firmware.bin + Improv Wi-Fi (`docs/index.html`, `docs/manifest.json`), hosted on GitHub Pages: one-click install for family members.
2. VAD with pre-speech circular buffer, warm-up frame skip, calibration web page that measures room noise and sets threshold.
3. Streaming TTS: start playing first PCM chunk while the rest synthesises; sentence-batched TTS queue with cancel flag and watchdog-style batch timeout; sha256 phrase cache on the TTS server for canned phrases.
4. Servo hygiene: servo task on its own core/priority independent of UI loop, boot = center then detach (no stall torque/heat), wake warm-up motion that hides the startup glitch, global e-stop endpoint that also blocks actuating APIs (503) until cleared; async 202 + result-poll pattern for long actions.
5. Local-first licensing/credit hygiene: clearly state models/voices are not shipped, credit lines, third_party_licenses/, case-STL terms of use.
6. Medical/"not a device" style disclaimers in two languages whenever a sensor value is shown; we can do the same for any health-adjacent or child-safety claim.
7. Coredump partition (64 KB) for post-mortem on a consumer device.
8. Unified TTS front (character/language aliases normalised, length_scale clamp, stream vs complete mode, X-TTS-* diagnostic headers) so the robot is TTS-engine agnostic; capabilities endpoint advertising what the device supports.

## 10b. Avoid
1. Open setup AP with credentials over HTTP, unauthenticated mic-record + blob-fetch API, and returning stored API keys from a GET endpoint.
2. One 6,000-line `main.cpp` with embedded HTML via incbin and global flags for state; no tests/CI.
3. Single-slot factory app with no OTA (and no signing) on a device that lives in a house; also plain-HTTP between robot and servers without any token.

## Digest
- Wake: none (button push-to-talk; energy VAD end-pointing).
- License Apache-2.0 (+MIT M5Stack-Avatar); Arduino/PlatformIO core 2.x, AtomS3R; last commit 2026-06-15; stars unknown.
- Stack: HTTP to LAN whisper.cpp, llama.cpp/LM Studio/Ollama, piper-plus/VOICEVOX (FastAPI `tools/tts_server.py`), all local.
- Features: Avatar faces, speech bubble, optional servos with e-stop, web config pages, MAX30100 demo, REST `/api/v1`.
- Best ideas: Web Installer, VAD pre-roll + calibration page, streaming TTS + cache, servo task isolation/detach/e-stop, local-first license hygiene, coredump partition.
- Weaknesses: open AP, no auth anywhere (remote record + blob fetch), API key returned in GET, plain HTTP, no OTA/signing, no tests/CI.
- Screenshot rating: 3/5 (one nice hardware photo, no UI shots).
