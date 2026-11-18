# Audit: stackchan-pet-fw ("Stack-chan Multi-Device Controller")

Root: /tmp/claude-0/-home-user-home/7524bf19-2972-532d-bd20-b8fb4e44bb56/scratchpad/repos/stackchan-pet-fw (paths relative). Read-only; nothing run.

## 1. What it is
- Arduino/PlatformIO firmware shared by three devices: M5 CoreS3 + Stack-chan (servos, camera, back touch), M5Stack StopWatch (round 386x386 display, haptics, step counter), AtomS3R + Atomic Echo Base (128x128). A "pet"/companion body: face, petting, affection, BLE StreetPass. NOT an assistant brain: README.en.md says "External client implementations are out of scope".
- License MIT (c) 2026 "あいろぐ" (AILog); THIRD_PARTY_NOTICES.md; note: historical release binaries containing Tsukuyomi-chan images are not MIT (README.en.md License section), a good licensing disclosure.
- Last commit 2026-08-01 (merge PR #18 "stopwatch-phone-camera-remote"), v0.4.1. Clone shallow, stars unknown [unverified]. Size 38 MB (mostly face JPGs: data/, data_stopwatch/, data_atoms3r/). ~25k LOC C++: src/main.cpp 10,050 lines, FaceController.cpp 5,758, AudioController.cpp 2,054. Arduino-ESP32 (espressif32 @ 6.12.0 = Arduino core 2.x line), M5Unified 0.2.18, M5GFX, ArduinoJson 7.4.3, NimBLE-Arduino 2.5.0, m5stack/StackChan-BSP pinned by git SHA (`platformio.ini`). Not ESP-IDF 6.1.

## 2. Architecture
- Device = server. The firmware hosts: HTTP on :80 (`HTTP_PORT`, `src/config.h:721`) and a WebSocket server on :8080 (`WS_PORT`, `src/WebSocketServerController.cpp` on esp_http_server), plus USB CDC serial with a custom framed protocol "SCU1" (docs/usb_serial_protocol.md) for direct Android tethering. A companion app/host (Android app, PC) connects TO the robot, sends JSON control + 16 kHz mono s16le TTS PCM, receives mic PCM. Fully local-first transport; any cloud is in the external client.
- Single active WS client (`activeClientFd_`). Protocol docs are in English+Japanese: docs/speech_bubble_protocol.md, device_affection_api.md, streetpass_protocol.md, step_counter_protocol.md, phone_camera_remote_protocol.md, usb_serial_protocol.md. Capability discovery via `device.info` -> `capabilities` array (e.g. `display.speech_bubble.v1`), explicit version fields, limits advertised (maxQueuedCues, maxPcmBytes 8 MB, stallTimeoutMs). Very good protocol design hygiene.
- This maps closely onto our model (host-driven robot over WS, JSON + audio), except the roles are inverted (we assume robot is client).

## 3. Wake word
- None. grep for wake/wakenet/porcupine finds only incidental matches. The device streams mic PCM to the client while connected and not muted (mic mute = tap overlay). Wake word, VAD, STT are entirely the client's job. Not applicable; push-to-stream plus mute overlay model.

## 4. Speech stack
- No STT/LLM/TTS in repo. Audio: PCM 16 kHz mono s16le both directions (no Opus), 4096-byte TTS chunks, 8192 max payload (docs/usb_serial_protocol.md). Ring buffers in PSRAM with fallback to internal RAM: `rxRing_` and `micTxRing_` (`src/AudioController.cpp:246-262`), mic capture and speaker playback tasks pinned to cores (`xTaskCreatePinnedToCore`, lines 282, 294). Lip-sync from PCM mean amplitude (8-step mouth at ~6 fps in classic, 4 mouth levels in image mode `base_m{0..3}_e{0..3}`).
- Latency/UX trick: "speech bubble cues" aligned with PCM segments: send cue JSON then the PCM for the same segment, so subtitles show in sync with audio (docs/speech_bubble_protocol.md), with pre-speaking hold and stall timeout. Nice for kids/hearing.

## 5. Features
- Image-based face (LittleFS JPG): lip-sync, blink, petting animation (16 frames), 16-direction "guruguru" gaze/tilt following (IMU or touch, 16 directions + center), dizzy animation (15 frames); classic procedural white-eyes face as a separate build env (`m5stack-cores3-classic`).
- Petting via back touch (SI12T) on CoreS3, screen touch on StopWatch, button-hold on AtomS3R. Shake. Servo reactions (CoreS3), camera `POST /capture`. Affection model (persisted on device, canonical state in firmware, `affection.get/sync`). StreetPass: BLE encounters between robots, stores last 30, custom GATT service. StopWatch: step counter with 30-day history, clock, haptics, phone camera remote shutter (protocol v1). Thermal protection (ThermalLevel Normal/Warm/Hot, low-power mode, `src/main.cpp:79`), brightness/volume settings, NTP + RTC time sync (Asia/Tokyo).
- No timers/alarms, no games, no kid mode, no persona, no MCP/tools, no memory on-device beyond affection/StreetPass.

## 6. Security
Good:
- Personal config in git-ignored `src/config_private.h` (`config_private.example.h`); release build excludes personal settings, rejects local absolute paths (`scripts/check_no_local_paths.py`, `sanitize_build_paths.py`).
- Input bounds are documented in protocols (max sequence id bytes, text bytes, queued cues); request IDs/transport/op validated for phone camera remote (README.en.md).
- CI permission `contents: read`; actions pinned to major versions; StackChan-BSP pinned to a commit SHA.
- Mic mute overlay on screen; explicit mic-mute control is a privacy plus.
Weaknesses (confirmed in code):
- NO authentication on any endpoint: HTTP `/status`, `/capture` (camera frame!), `/mic-test`, `/speaker-test`, `/wifi/save`, `/wifi/delete`, `/wifi/restart` (`src/main.cpp:4305-4337`) and the WS audio channel (:8080) require no token. Anyone on the LAN can pull a camera image, stream the mic, or overwrite saved Wi-Fi credentials.
- CORS `Access-Control-Allow-Origin: *` on responses (`src/main.cpp:3561`) so any web page the user visits can drive/read the robot from the browser (DNS-rebinding-free CSRF to a LAN IP); no Origin check on WebSocket (grep empty).
- Default SoftAP password is a hardcoded constant per device class: "stackchan123", "stopwatch123", "atoms3r123" (`src/config.h:196-203`), printed on screen and in QR. README says "setup Wi-Fi password is device-specific" [unverified; the default macro is static unless overridden]. Wi-Fi setup form served over plain HTTP; saved Wi-Fi passwords in LittleFS/NVS plaintext.
- No TLS anywhere, no OTA over the network found (no Update.h/OTA code; updates by esptool/PlatformIO only, so no signed-OTA, and no secure boot/flash encryption configured [unverified, no sdkconfig since Arduino]). Partition table has ota_0/ota_1 but unused for network updates.
- No privacy/AI statement, no kid safeguards (it is a toy-like pet product).
- StreetPass broadcasts a stable peer ID + name + message over BLE to anyone: trackable identifier, privacy risk for kids (FNV hash of profile id as advertised token, `src/main.cpp:996`).

## 7. Performance and memory
- 16 MB flash CoreS3 partitions: nvs 20K, otadata, app0/app1 4 MB each, LittleFS ~7.9 MB (`partitions_16mb_ota_4m_littlefs_7m.csv`) + 8 MB variants incl. coredump partition (useful: `coredump` 64K in the 8 MB table, no-OTA table also provided).
- Face: full-screen sprite `canvas_.createSprite(w,h)` then `pushImage`; JPG frame decoding with explicit caches (voice-sprite cache, pet animation cache, talk cache) that are released when memory is low and fall back to decoding straight from LittleFS ("Caches are performance optimizations. When allocation fails, the same v2 frame is decoded directly", docs/face_renderer_v2.md). Boot-time renderer-profile selection (animated / transition / legacy / emergency image-free) from a validated `face_assets.json` manifest = graceful degradation.
- Audio rings in PSRAM with fallback, tasks pinned, VoicePerfStats counters (max loop gap, frame counts) for diagnosing audio underrun while rendering. `DMA largest free block` logged. Thermal sampler with baseline temperature, hot timer, auto low-power suggestion.
- Release build env `-release` with sanitised build paths; separate `factory` vs `firmware` images so firmware-only updates preserve LittleFS face data (docs/install_binary.md).

## 8. UI / screens
- Images found: public face sample sprite sheets (`tools/face_image_builder/build_faces_from_sprite_sheet/samples/*/sprite_sheet_sample_01.png`), AI-generated reference faces (`.../generate_sprite_sheet/references/face_reference_0{1..4}.png`), runtime frames `data/*.jpg`. No photos/GIFs of the real hardware in README (README is text only; no screenshots). I viewed: `data/base_m2_e1.jpg` (240x240 anime girl, silver bob hair, aqua eyes, star/flower hair clips, open mouth, black background), `dizzy_4x4/sprite_sheet_sample_01.png` (4x4 grid: spiral eyes + orbiting chick/stars, closed-eye wobble frames with motion lines, then recovery frame), and `face_reference_01.png` (clean high-res reference portrait).
- Visual design: pre-rendered illustrated character, four mouth x four eye levels, full-body-less bust with transparent/black background; very polished and emotive vs. vector faces, but memory/flash heavy (65 JPGs/target) and fixed to one character. The pipeline (sprite sheet -> split -> resize per target -> manifest + validator + schema) is the real asset. Classic procedural face as fallback.
- Face code approach: FaceController picks frame path from (mouth level from PCM amplitude, eye level, direction index, pet/dizzy sequence), draws into one canvas sprite then pushes; state priority modes (photo, master, pet, shake, thermal, auth) with explicit rule that thermal/low power/affection do not swap the base face, they use overlays.
- Rating: 3/5 for the art and animation set; 1/5 for README screenshots (none). Overall visual 3.5 -> report 3/5 because nothing shows the actual hardware.

## 9. README / docs
- Excellent docs discipline: every public doc is a Japanese/English pair and CI enforces it (`scripts/check_bilingual_docs.py`); release notes per version (docs/release_notes_0.4.x); separate install guide with flash addresses and downgrade warnings; Device Guide table of per-target feature differences and controls; versioned protocol specs with capability discovery. CONTRIBUTING (JA+EN) lists exact verify commands for all 6 envs.
- CI (`.github/workflows/build.yml`): face-asset validation job (local-path reject, bilingual docs check, Pillow-based validator unit tests) then matrix build of 6 PlatformIO envs. Python tests in `scripts/tests/` (validators only; no firmware unit tests).
- Weak: no badges, no demo GIF/video, no SECURITY.md, no AI-use disclosure, no privacy statement, README is dense release-notes-first rather than hook-first.

## 10. Top 8 ideas to adopt
1. Capability-discovery handshake: `device.info` with `capabilities[]` strings + numeric limits so host and firmware version independently (add to our WS JSON).
2. Boot-time asset profile selection with schema-validated manifest and an image-free `emergency` fallback; never mix frames from different sets.
3. Speech-bubble cues interleaved with PCM segments (sequenceId, segmentIndex, hold ms, stall timeout) for subtitle sync.
4. Cache-with-fallback pattern: PSRAM caches for frames, released under pressure, direct-from-FS decode when allocation fails.
5. Separate `factory` vs `firmware` binaries so updates keep user assets; coredump partition; documented flash offsets and downgrade cautions.
6. CI that rejects embedded local paths (`check_no_local_paths.py`) and enforces bilingual/paired docs; sanitised release builds.
7. Thermal monitor with baseline + hot-timer -> low-power suggestion; VoicePerfStats counters for audio/face contention.
8. Sprite-sheet-to-assets toolchain with JSON schema, per-target resize and validator tests (`tools/face_image_builder`); mouth x eye grid (4x4) as a minimal expressive set driven by PCM amplitude.

## 10b. Avoid
1. Unauthenticated camera/mic/Wi-Fi-write endpoints with `CORS *` and no Origin check; fixed default AP passwords in source.
2. 10k-line `main.cpp` / 5.7k-line FaceController monoliths.
3. Broadcasting a stable BLE identity (StreetPass) with no rotation or consent flow, especially around children.

## Digest
- Wake: none (no wake word; client streams mic; mute overlay).
- License MIT; Arduino/PlatformIO, ESP32-S3, 3 devices; last commit 2026-08-01, v0.4.1; stars unknown.
- Stack: device hosts HTTP:80 + WS:8080 + USB SCU1; PCM16k s16le, JSON; no STT/LLM/TTS in repo (client side).
- Features: JPG lip-sync/blink/pet/dizzy/16-direction faces, affection, BLE StreetPass, servos, camera, thermal, step counter.
- Best ideas: capability handshake, manifest-validated asset profiles + emergency fallback, speech-bubble cues, cache fallback, factory/firmware bins, path/bilingual CI, thermal, sprite pipeline.
- Weaknesses: zero auth (camera, mic, wifi save), CORS *, default AP passwords hardcoded, no TLS, no OTA signing, BLE ID broadcast, no privacy/AI disclosure.
- Screenshot rating: 3/5 (great character art, no hardware shots).
