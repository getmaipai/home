# Audit: stackchan-local

Read-only audit of a downloaded clone. Nothing was run or built. [unverified] marks inference.

## 1. What it is
- "StackChan Local": local-first desktop daemon (TypeScript) + React WebUI + ESP-IDF firmware for M5Stack StackChan (ESP32-S3). Primary purpose is hardware validation of every sensor/module plus small apps: Codex status mirror, face tracking, expression control (README.md).
- License MIT (LICENSE). Single squashed commit (history was reset: `git rev-list --count` = 1), last commit 2026-06-02 by "Rui Xu". Stars: not in files [unverified]. No .github dir, so no CI.
- Languages: C/C++ firmware (~138 h, 72 cpp, 26 cc), TypeScript (44 ts, 34 tsx), a Python vision sidecar. 13 MB; biggest items are third_party BMI270 driver sources, `assets/stackchan-product.png` (341 KB), YuNet ONNX model (232 KB). 598 .ogg files in firmware assets (sounds).
- Firmware is derived from the xiaozhi-esp32 codebase (leftovers: `esp_wake_word.cc`, audio_service, `78/esp-wifi-connect`, legacy-source regex in `scripts/check-firmware-local-only`), but stripped of cloud protocols.

## 2. Architecture
- Firmware dials OUT to desktop daemon: `ws://<mac-ip>:8787/stackchan/local` (JSON envelopes + binary `SCL1` camera frames). Discovery by mDNS `_stackchan-local._tcp` with saved fallback URL. Desktop also serves HTTP/SSE/MJPEG on 8788 (WebUI, /status, /debug/*, /frame.jpg, /stream.mjpg).
- Three firmware layers: `hardware/` (drivers, no LVGL or Board singleton), `services/` (display, sensors, motion, power, audio, network, local_companion), `system/` (boot, SystemContext, settings, lifecycle). Rule enforced by `scripts/check-firmware-local-only` (greps compile_commands.json and includes for legacy cloud paths). Good boundary discipline.
- Shared protocol package `protocol/` with TS types + JSON Schema (`protocol/src/schemas.ts`), used by the daemon to validate handshake and messages. Docs: `docs/robot-command-protocol.md`, `docs/camera-video-pipeline.md`, `docs/robot-events.md`.
- Fully local: no cloud LLM. Only optional cloud piece is Volcengine TTS (`desktop/src/tts/volcengine.ts`), off by default. MCP server (`desktop/src/mcp/server.ts`) lets Codex drive the robot.
- Telemetry: AXP2101, INA226, FT6336 touch, SI12T head touch, BMI270+BMM150, GC0308 camera, SCS servos, AW9523/PY32 IO expander, RGB, PCF8563 RTC, LTR553, NFC, IR, ES7210/AW88298 audio, Wi-Fi/BLE.

## 3. Wake word
- On device, esp-sr WakeNet (`espressif/esp-sr ~2.3.0`), model `CONFIG_SR_WN_WN9_HISTACKCHAN_TTS3=y` ("Hi StackChan", TTS-trained WN9) in `firmware/sdkconfig.defaults`. Code: `firmware/main/services/audio/runtime/wake_words/{esp,afe,custom}_wake_word.cc`; detection mode `DET_MODE_95`. Detected word is sent to the daemon as `robot.event` kind `wakeWord` (`desktop/src/ws/server.ts` ~283).
- AFE variant (`afe_wake_word.cc`, `afe_audio_processor.cc`) gives AEC/NS/VAD on device. Wake word then "microphones are used for wake word and voice audio only" (SECURITY.md); direction finding was removed.
- Useful for us: the `HISTACKCHAN` WakeNet model name suggests an existing prebuilt "Hi StackChan" esp-sr model is available [unverified: model data comes via managed component, not stored in repo].

## 4. Speech stack
- No STT or LLM in this repo. Speech comes from Codex via MCP `stackchan_say` -> desktop -> Volcengine Seed-TTS 2.0 SSE (optional) -> OGG/Opus audio sent to firmware as chunked "reliableChunked" `audioPlayback` (docs/robot-command-protocol.md ~520-600: start/chunk/end with per-chunk ack, motion gate released on failure).
- Audio from mic: only wake word and Opus stream capability in handshake `audioParams` [unverified how much of it is wired]. No barge-in.
- Latency: not a voice agent, so n/a. Camera path has latency tricks (below).

## 5. Features
- Faces: avatar rendering, blink, idle on device; expression presets and optional avatar JSON from desktop. Touch (screen + head), IMU, servos head move/animation, RGB alerts, camera streaming, face-position tracking (YuNet ONNX + PID, `desktop/src/vision/`, `docs/face-tracking-pipeline.md`), Codex session watcher -> idle/thinking/speaking states (`desktop/src/codex/`). MCP tools: status, say, react, move_head, play_animation, capture_image, set_mode, face_tracking. No games/timers/kid mode/memory/personas.

## 6. Security
Good:
- Pairing token in first handshake, rejected with 1008 close (`desktop/src/ws/server.ts` 143). Handshake must be first, JSON, schema-valid. Binary first frame rejected.
- WebUI binds 127.0.0.1 by default; logs redact tokens, keys, auth headers, image payloads (SECURITY.md). Structured safe commands only; "no raw JSON command console". Firmware secret scanner `firmware/scan_secrets.py`. Camera = position only, no identity recognition; cloud TTS opt-in.
- Backpressure: MJPEG drops when writableLength > 512 KB (`preview/server.ts` 22, 726).
Weak:
- Default token `dev-local-token` in `.env.example` and README; token compare is plain `!==` (not timing-safe); no rate limiting on failed pairing.
- Plain `ws://` on 0.0.0.0, no TLS; token sent in clear on LAN. No `maxPayload` found in `desktop/src` [unverified, grep found none].
- Preview HTTP API has no auth or visible CORS/Origin check; any local webpage could POST /api/* via DNS rebinding or simple requests [unverified, did not trace every route]. SECURITY.md says "trusted local network" only.
- No CI, single commit, no kid/privacy safeguards beyond camera statement.

## 7. Performance and memory
- Binary `SCL1` camera frames instead of base64 JSON; credit-based flow control (`mediaCredit`, max 12 in flight, firmware clamps) and `adaptiveCameraStream` QoS profiles (docs/camera-video-pipeline.md 76-90). Fixed 320x240 input for the detector, "fast" preset.
- sdkconfig: SPIRAM octal 80 MHz, `SPIRAM_MALLOC_ALWAYSINTERNAL=512`, `RESERVE_INTERNAL=65536`, mbedTLS external memory + dynamic buffers + no keep-peer-cert.
- Per-frame metrics (FPS, interval, latency, JPEG size, drops) shown live in WebUI; face-tracking NDJSON trace log.

## 8. UI / screens
- Images: `assets/webui-console.jpg` (viewed), `assets/stackchan-product.png` (hardware photo, not viewed in detail). No screenshots of the on-device face.
- webui-console.jpg: dark sidebar console, three groups (Modules / Applications / Debug), one row per chip with name + part number (AXP2101, INA226, ILI9342, FT6336, BMI270...), green status dot per module, top KPI strip (Device, SSE, FPS, Faces, Battery, Wi-Fi, Drops, Updated), key/value cards, raw JSON block, "Refresh telemetry" and "I2C scan" buttons. Mixed Chinese/English labels. Clean, dense, readable; a good diagnostics page. Rating 4/5 for a hardware console (not a family UI). Copy: per-module "available + reason" rows, top KPI strip, raw-JSON toggle.

## 9. README and docs
- Strong: badges row, bilingual (README_zh.md), visual overview table, three mermaid diagrams (topology, firmware ownership, command loop), capability matrix, endpoint table, quick start, hardware acceptance checklist, explicit Privacy And Safety and Project Status ("experimental"). Protocol docs in Chinese with source-file pointers. CONTRIBUTING.md, SECURITY.md. Tests: 11 desktop vitest-style files + protocol validation test. No CI, no AI-use disclosure, no data-flow doc beyond 4 bullets. `docs/superpowers/plans/` shows AI-assisted planning, undisclosed.

## 10. Top ideas to adopt
1. Firmware layering rule + a CI lint (`check-firmware-local-only`) that fails on forbidden includes/legacy sources; do the same for our patch set.
2. "available:false with reason" for every sensor/module in a public snapshot; a Hardware Status page with I2C scan.
3. Credit-based media flow control + QoS profiles over the WebSocket for camera/audio.
4. Binary envelope (`SCL1`) with a magic + kind byte for media, JSON only for control.
5. Chunked audio playback with per-chunk ack and a "motion gate" that silences servo noise during audio.
6. Command lifecycle events: `commandAck` (accepted/rejected) then `commandStatus` (completed/failed) with commandId.
7. Handshake-first protocol with schema validation and featureFlags negotiation in `daemon.hello`.
8. Log redaction for tokens, keys and image payloads before the debug UI; NDJSON trace log for control loops.

Avoid: shipping a default pairing token and plain `!==` compare; unauthenticated LAN HTTP control API; squashed single-commit history with no CI.
