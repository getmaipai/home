# Audit: stackchan_alive (RobVanProd/stackchan_alive, "Stackchan: Alive")

Clone: /tmp/claude-0/-home-user-home/7524bf19-2972-532d-bd20-b8fb4e44bb56/scratchpad/repos/stackchan_alive (read-only; nothing executed). Shallow, 1 commit.

## 1. What it is
- A from-scratch "character OS" firmware for a Stackchan on M5Stack CoreS3 (ESP32-S3) plus a Python host "brain bridge" and Kotlin/KMP companion apps (README.md). Procedural face, no sprite assets. Apache-2.0 (LICENSE). Public "for development visibility", prerelease.
- Last commit 2026-08-13 (author RobVanProd). Stars not in files [unverified]. 22 MB: 256 .ps1 (4 MB, Windows-first tooling), 137 .py, 91 .md, 65 .hpp + 61 .cpp (firmware), 55 .kt (companion), 22 png, 9 wav (voice assets, RVC model via Git LFS).
- Very heavy process/evidence culture: PROJECT_STATE.md (669 lines), docs/FIRST_DEPLOY_STATUS.md (1300+ lines), RESEARCH_LEDGER, BRANCH_LEDGER, risk register, AGENTS.md. Likely AI-agent driven development [inferred from AGENTS.md/BRIDGE_AI_HANDOFF.md; no explicit disclosure statement found].

## 2. Architecture
- Firmware (PlatformIO, Arduino framework, M5Unified/M5GFX, NOT ESP-IDF/LVGL; platformio.ini) with FreeRTOS tasks: FaceTask (50 ms period gate), MotionTask (only writer of servos, spring dynamics), persona engine producing `RobotFrame` snapshots (src/persona, src/face, src/motion, src/io, src/power, src/wake). ~24 PlatformIO envs (display-only default, servo calibration, wifi, mww uplink, release_full, camera probe...).
- Host bridge (bridge/, Python): WebSocket server speaking `stackchan.bridge.v1` (docs/BRIDGE_PROTOCOL.md), STT -> local LLM -> "Character Lock" JSON {spoken_text, mode, emotion} -> TTS -> PCM downlink. Companion PC/Android apps as alternate brain owners with endpoint handoff and trusted-endpoint forgetting.
- Strongly local/private: no cloud STT/LLM by default; Gemma 4 E2B (GGUF/LiteRT-LM) host-side; vision via loopback Ollama. Wi-Fi/ OTA secrets never baked into public release image (docs/LAN_OTA.md).

## 3. Wake word
- Production path is microWakeWord (TFLite streaming model) on device: envs `stackchan_wake_mww_uplink*` with esphome-libs/esp-micro-speech-features, task pinned to core 0 priority 1, 5120-word stack, 16 kHz, ES7210 gain reg, probability cutoff, stereo mic (platformio.ini:300-). Wake opens a gated upload turn (src/io/BridgeWakeGate.*: 6 s open window, 15 s max turn). Model variants "M5"/"Hi Stack Chan"/custom [which one ships: unverified].
- ESP-SR WakeNet ("Hi Stack Chan") was probed and REJECTED: detection worked but display fell to 85-102 ms/frame (~11.7 fps) (docs/BOT_LOCAL_WAKE_ARCHITECTURE.md, BOT_LOCAL_WAKE_SR_PROBE.md). Fallback candidate: M5 Unit ASR (CI-03T) over UART (`AA 55 ID 55 AA`). Partition table with 8 MB `model` partition exists (partitions_esp_sr_16.csv).
- Notable: TFLite arenas zeroed with heap_caps_calloc to fix wake bugs; `/wake-reset` debug path (FIRST_DEPLOY_STATUS.md:953).

## 4. Speech stack
- STT: Whisper (whisper-server adapter, bridge/stt_adapter.py, stt_supervisor.py). LLM: Gemma 4 E2B QAT GGUF (llama.cpp/Ollama/LM Studio) or LiteRT-LM on Android (docs/BRAIN_MODEL.md). TTS: custom "Spark" voice via RVC on DirectML (GPU, Windows) with chunked speaker transport; Piper-ish adapter `tts_adapter.py` [unverified]. Local, no cloud.
- Latency: conversation_latency.py records stage timing (capture, STT, brain, text-ready, first audio, RTF) with gates; host sends early `thinking` frame, required <300 ms; face "thinking" shown immediately; VAD endpointing (min 150 ms speech, 2.0 s trailing pause, 12 s cap); deterministic local answers (time/date/name) bypass the LLM (README). Reflex budgets in diagram: face 150 ms, wake ack 500 ms, orient 400 ms.

## 5. Features
Procedural faces (spark, glow, pip, bolt persona packs in YAML: palette, geometry, breathing), blink/saccade/breathing/gaze, speech-synced visemes; touch, IMU (pickup/shake/putdown/tilt), LTR553 proximity/ambient, camera + YuNet face detection and bounded face following, active-speaker/sound direction; servo motion with power coordinator, nod/shake gestures; earcons and wake cues; bounded privacy-filtered host memory v4 with explicit remember/forget (MEMORY_CONTRACT.md); initiative policy (unprompted speech), affect state, room context; local research broker; LAN OTA with rollback and stable/beta hash-bound manifests; hardware simulator; web dashboard (loopback). Not present: kid mode, timers, games, MCP tools, LED ring (not mentioned) [unverified].

## 6. Security
Good:
- Release image refuses any token/Wi-Fi/pairing secrets in build env (stackchan_release_full), only SHA-256 of OTA token compiled in; 32-128 char token rule; OTA writes inactive slot, health-confirm, auto-rollback (docs/LAN_OTA.md).
- Camera frames only to paired private-LAN client, in-memory, not stored; room vision restricted to allowlisted typed fields, rejects identity/free-text descriptions, off-switch. Raw audio cleared at utterance_end/cancel; audio leaves device only after wake gate (docs/PRIVACY.md).
- Dashboard loopback-only (non-loopback host rejected), same-origin JSON + custom header, no CORS, browser Origin rejected on WS upgrade (BRIDGE_DASHBOARD.md, BRIDGE_PROTOCOL.md:139). Debug HTTP policy module (src/io/BridgeDebugHttpPolicy.*) 403s dangerous endpoints before work. SECURITY.md with private reporting, urgent-safety (motion-stop) section.
- Self-critical: PROJECT_STATE.md:505 admits an older baseline let `/wake.wav` and `/wake-pcm.wav` export recent mic PCM without pairing and that the installed image SHA is unknown.
Weak:
- OTA over plain HTTP bearer token (docs concede; LAN-only advice). No TLS/ cert pinning on bridge [unverified]. Robot exposes many debug HTTP endpoints (/recover, /motion-on, /wake-reset...), reliant on policy gating. No kid/child safeguards at all found; memory is "privacy-filtered" but adult-oriented. SECURITY.md promises no response deadline.

## 7. Performance / memory
Strongest section. Face period 50 ms gate treated as protected baseline; every feature (wake, camera, audio) rejected if it regresses frame time (measured on robot). Camera fb in PSRAM (CameraAdapter.cpp:75), display canvas setPsram(true); mic/wake task pinned core 0; servo single-writer; PowerCoordinator + PowerForensics (AXP2101 IRQ decode: watchdog, overcurrent, warning levels); 28,807 s all-feature soak (5643/5643 polls) as release evidence; reproducible build script (tools/platformio_reproducible_build.py); -O3 -ffast-math; CORE_DEBUG_LEVEL 0; serial telemetry compiled out in release; bounded protocol parsers; native_logic host tests for firmware logic (pio test -e native_logic); hardware simulator with power-cycle and bridge-kill recovery. OTA slots 2 x 3.2 MB + 8 MB model + 1.6 MB spiffs on 16 MB flash.

## 8. UI / screenshots (viewed face_gallery.png, expression_sheet.png, diagram 01, play feature graphic)
- docs/media/face_gallery.png: 4 personas x 5 states grid (idle/listen/think/speak/sleep). Flat vector faces: rounded-rect or round eyes with pupil, tiny brows above, thin curved mouth, one accent colour per persona on dark bg (spark white/teal+pink, bolt amber rectangular, glow cream, pip cyan large). Clear, consistent, state-readable, instantly shows persona-swappable idea; slightly minimal (no cheeks, no hearts, mouth tiny). Expression sheet (idle/listen/think/happy/concern/sleep) labelled. Diagram 01 is a clean dark system overview with a red "privacy boundary" line and latency budgets (150/500/400 ms). Play feature graphic is a placeholder-ish mockup. Also preview GIF/MP4 rendered from same firmware drawing code (tools/render_preview.py), diagram set 01-08.
- Copy: per-persona state matrix image, host-side preview renderer using firmware draw code, YAML persona packs with validator, privacy-boundary diagram. Rating 4/5 (faces and diagrams good; no photos of real robot, no dashboard screenshot).

## 9. README / docs quality
Huge, evidence-first, honest about what is unpromoted ("historical owner-accepted evidence... does not inherit"). Plus: diagrams, quick start, persona creation tutorials, safety section, privacy boundary, release/evidence flow, CONTRIBUTING with "do not weaken gates", CODE_OF_CONDUCT, SECURITY, landing site/ with privacy page, Play Store privacy policy drafts, AGENTS.md for coding agents. Minus: README is 416 lines, status prose is dense and jargon-heavy, commands are PowerShell/Windows only, no badges, no feature table, no demo video link beyond gif, no explicit AI-disclosure statement. CI (.github/workflows firmware.yml, release.yml, pages.yml, companion-signing-readiness.yml); test dirs: test_native_logic, test_embedded_logic, ~70 bridge test_*.py.

## 10. Adopt (top 8) / avoid (3)
Adopt:
1. A hard "frame-time gate" rule: any new feature (wake, camera, audio) that drops the face below 50 ms/frame is rejected; measure on device before accepting (matches our RULES-style gating).
2. Single-writer rule for servos: only the motion task writes actuators; everything else publishes events/RobotFrame snapshots.
3. microWakeWord TFLite on core 0 low priority with zeroed PSRAM arenas, as a cheaper wake than ESP-SR (their ESP-SR run cost 85-102 ms frames; test on our build).
4. Wake-gated bridge turn with finite open window (6 s) and max turn (15 s), raw audio cleared at utterance_end/cancel.
5. Per-stage conversation latency log (capture, STT, brain, text-ready, first audio, RTF) with explicit gates, plus early `thinking` frame <300 ms.
6. OTA hardening: inactive-slot write, token hash only in firmware, health-confirm + auto rollback, hash-bound stable/beta manifest that never auto-flashes; public release image refuses embedded secrets.
7. Persona packs as YAML (palette, geometry, breathing) with validator + host preview renderer that uses the firmware draw code; gallery image in README.
8. Memory contract: bounded records, expiry, atomic replace + backup, explicit remember/forget, deterministic local answers for time/date/name; typed-fields-only room vision that rejects identity descriptions; PMIC IRQ forensics for unexplained resets.
Avoid:
1. Unbounded process docs/ledgers (thousands of lines of status prose) that bury the quick start; evidence jargon in the README.
2. Debug HTTP endpoints on the robot that can export mic PCM or enable motion (they had to retrofit 403 gating).
3. Windows/PowerShell-only tooling and 24 near-duplicate PlatformIO envs; plain-HTTP bearer OTA; no child-safety layer.
