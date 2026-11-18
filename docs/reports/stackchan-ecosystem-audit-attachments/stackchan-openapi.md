# Audit: zziying/stackchan-openapi (local clone, read-only)

## 1. What it is
- "StackChan HTTP API": Arduino (M5Unified/M5StackChan) firmware that exposes the whole robot as a plain GET-only HTTP server on the LAN, plus standalone Python host scripts. Single commit (2026-08-28, zziying), MIT, 12 files, ~350 KB. Stars not available offline [unverified]. Languages: C++ (firmware/firmware.ino, 37 KB), Python (host/*.py, ~50 KB). Bilingual zh/en README.
- NOTE: despite the name there is NO OpenAPI/Swagger document anywhere (no yaml/json spec). The "openapi" is only the README endpoint table. Do not expect a machine-readable schema.

## 2. Architecture / protocol
- Target: M5Stack CoreS3 StackChan (ESP32-S3), Arduino core `m5stack:esp32`, libs M5StackChan, M5Avatar (README, firmware/firmware.ino L1-30). Fully local: no cloud, no relay. Host does all ML (MediaPipe, InsightFace, Whisper, edge-tts/ElevenLabs).
- Transport: HTTP/1.1 GET on port 80 via Arduino WebServer (firmware.ino L976-987). Endpoints: `/face?expr=` (neutral happy sad angry sleepy doubt love eyeroll), `/servo?yaw&pitch&speed` (yaw -1280..1280, pitch 0..900, speed 0..1000, in 0.1 deg; clamped with constrain L541-543), `/camera` (JPEG 320x240), `/status`, `/home`, `/touch`, `/record?seconds=&vad=&led=` (WAV, clamped 1..15 s), `/stream?port=` (mic PCM pushed to a host TCP port, 16 kHz mono int16), `/play?url=` (device pulls a WAV from a host URL, max 2 MB ~62 s, lip sync), `/speech?text=&dur=` (subtitle with auto paging), `/volume`.
- Touch/shake events are pushed device -> host: firmware POSTs `{"event":"touch","type":tap|pet|pet_reverse|shake|screen_tap}` to CALLBACK_HOST:7070 (firmware.ino L405-415, host/touch_listener.py).
- Config: firmware/config.h (gitignored) with WiFi, static IP, CALLBACK_HOST, mDNS `stackchan.local`.

## 3. Wake word / speech
- No wake word. Listening is host-side: host/listen.py = kick `/stream`, WebRTC VAD mode 3 + RMS energy gate (VAD_RMS_MIN 3500, calibrated noise 2000-2800 vs speech 6700-17500), 3 voiced frames start / 45 silent frames end, 300 ms preroll, skip first 25 frames (mic start pop), Whisper.cpp ggml transcription, Whisper-hallucination junk list ("thank you", "subscribe", Chinese outro phrases). TTS: edge-tts (free) or ElevenLabs, MP3->WAV 16 kHz mono, host serves via python http.server, device fetches via /play (host/speak.py L154-215).

## 4. Features / tool catalog / wording
- Face (8 expressions + custom-drawn faces), servo, camera, mic, speaker with lip sync, subtitles with CJK-aware line breaking, touch (3-zone), shake via IMU, battery/RSSI status, face find/track (12 preset scan angles, double-confirm, lazy 3-10 s vs active 0.3 s tracker; InsightFace identity check).
- Error messages are self-documenting: `{"error":"url parameter required. Usage: /play?url=http://host/file.wav"}` (L700) - agent-friendly usage hints in errors. The HTML root page doubles as control panel. No MCP tool descriptions exist; README says "wrap the scripts as MCP tools".

## 5. Security
- NONE: no auth, no token, no TLS, no CORS handling, no rate limit. Any LAN host can move servos, read the camera and microphone (`/camera`, `/record`, `/stream?port=` streams live mic audio to ANY host:port the caller names), and make the device HTTP-fetch arbitrary URLs (`/play?url=` = SSRF primitive from the device, L699-713). `/stream` lets an attacker eavesdrop remotely.
- GET with side effects (CSRF/prefetch/browser-link risk). Callback host hardcoded; touch_listener.py binds 0.0.0.0 and `--command` does `shell=True` with `{type}` substituted from untrusted JSON (touch_listener.py L56-58) = command injection if `--command` is used and the port is reachable.
- Good: secrets in gitignored config.h/.env, input clamping on servo/seconds/WAV size, debounce on touch events, WiFi sleep off.
- Prompt-injection: not applicable (no LLM layer), but transcripts from listen.py feed whatever AI the user wires up with no sanitizing.

## 6. Performance / reliability
- WiFi static IP, `WiFi.setSleep(false)`, 30 s reconnect check (L1020), mDNS. macOS Errno 65 workaround via curl subprocess (host/curl_session.py). Pull-model audio (/play URL) with 10 s HTTP timeout and size cap; half-duplex I2S (mic and speaker cannot run together) documented. Single-threaded WebServer.handleClient in loop(): a slow /play or /record blocks all other requests [unverified under load]. No queue, no retries, no state cache.

## 7. UI / images
- No images or screenshots in the repo (firmware draws its own custom face and subtitle UI in code; not viewable). Rating n/a (README has only ASCII diagrams) - 1/5 for visual promotion.

## 8. README / docs
- Strong bilingual README: architecture diagram, endpoint table, quick start, caveats section. No tests, no CI, no examples dir beyond scripts, no AI-transparency statement, no CHANGELOG, no SECURITY.md. 3/5 docs, 0/5 testing.

## 9. Top 8 ideas to adopt
1. Pull-model audio: device fetches a WAV URL and the host serves it; gives lip-sync duration (`dur`) so subtitles page in step with speech.
2. Usage-hint error strings returned by every endpoint (agents self-correct).
3. Push touch/shake events to the host as small JSON (type + debounce) - map to our WebSocket events.
4. Host VAD recipe: WebRTC VAD + RMS energy gate + preroll + startup-pop skip + Whisper junk-phrase filter.
5. Mic startup pop skip (first ~0.5 s) and I2S half-duplex documentation.
6. Servo ranges in 0.1 deg with explicit clamps and speed param; publish ranges in our spec.
7. Face scan pattern (12 preset angles, double confirmation, lazy vs active tracking modes) as a host-side "find person" tool.
8. Ship a real OpenAPI 3.1 document for our host (this repo's name promises one but does not have one) so it is the first to deliver.

## 9b. Avoid
1. Unauthenticated GET endpoints that expose camera, mic and arbitrary-URL fetch.
2. `shell=True` callback commands with untrusted substitutions.
3. Single-threaded blocking handlers for long audio operations.
