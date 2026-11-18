# Audit: dotty-stackchan (BrettKinny/dotty-stackchan)

Clone: /tmp/claude-0/-home-user-home/7524bf19-2972-532d-bd20-b8fb4e44bb56/scratchpad/repos/dotty-stackchan (read-only; nothing executed). Shallow clone: 1 commit visible.

## 1. What it is
- Self-hosted voice/behaviour server stack for the M5Stack StackChan robot, "kid-minded by default" (README.md). MIT, (c) 2026 Brett Kinny (LICENSE).
- Last commit 2026-11-13: "project is on ice over a StackChan power issue" (README banner). One maintainer, heavy AI authorship (AI_TRANSPARENCY.md). Stars: not in files [unverified].
- Size 6.2 MB: 180 .py (~1.6 MB), 71 .md, 27 .ts (dotty-pi-ext), 24 .html, 43 test files in tests/ plus dotty-behaviour/tests and dotty-pi-ext/tests.
- IMPORTANT: firmware/ is an EMPTY git submodule (.gitmodules -> BrettKinny/StackChan branch `dotty`, a fork of m5stack/StackChan, built on xiaozhi-esp32 v2.2.4 + patch). No firmware source to read here; firmware facts below come from docs only [unverified against code].

## 2. Architecture
- Robot (ESP32-S3 CoreS3) speaks the Xiaozhi WebSocket protocol (docs/protocols.md; plain ws:// on LAN, URL handed out by OTA response at :8003/xiaozhi/ota/). Server side is five Docker containers on one host (docs/architecture.md): xiaozhi-esp32-server (VAD/ASR/TTS, :8000 WS, :8003 HTTP), dotty-pi (pi coding agent as brain), dotty-behaviour (FastAPI :8090, perception bus, 11 consumers, vision, greeter, calendar), bridge.py (FastAPI dashboard :8081), llama-swap/Ollama for models.
- Seam = custom xiaozhi LLM provider `custom-providers/pi_voice/pi_voice.py` which runs `docker exec -i dotty-pi pi --mode rpc` (JSONL over stdio). Custom TTS/ASR providers are file-mounted over the upstream image (docker-compose.yml.template) = fragile on upstream bumps (docs/voice-pipeline.md says so).
- Local-first: ASR/TTS/LLM local by default; cloud only for smart_mode (OpenRouter claude-sonnet-4-6), VLM (gemini flash-lite), audio caption, optional EdgeTTS. `DOTTY_LOCAL_ONLY=1` makes behaviour service fail closed on non-LAN URLs.
- Device->server perception events (`face_detected`, `sound_event`) are JSON frames POSTed to /api/perception/event.

## 3. Wake word
- ESP-SR WakeNet9 on-device (AFE: AEC+NS+VAD -> WakeNet9, PSRAM model). Shipped `SR_WN_WN9_HIESP` ("Hi, ESP"); earlier "Hi, Stack Chan" (docs/wake-word.md). No "Hey Dotty"; plan B is microWakeWord TFLite (50-100 positives, ~1000 negatives, INT8) in a model partition; plan C custom WakeNet9. Lists 21 prebuilt WN9 phrases (Alexa, Jarvis, Computer, Hey Kira...). Wake event -> opens WS and starts listening. Server side `WakeWordTurner` just turns head toward speaker.

## 4. Speech stack
- VAD: SileroVAD (server). ASR: FunASR SenseVoiceSmall (default, patched `custom-providers/asr/fun_local.py` to pin language=en because auto mis-detects kids' short English), WhisperLocal on GPU, SenseVoiceOnnx int8 (sherpa-onnx) for low RAM. TTS: Piper local (default) or EdgeTTS streaming (cloud). LLM: pi agent + qwen3.5:4b on llama-swap for outer loop; `think_hard` tool escalates to qwen3.6:27b-think (200-token cap, thinking off); OpenAICompat alt provider.
- Latency tricks: sentence-by-sentence streaming into TTS (NDJSON stream, CHANGELOG); small fast model + big model only on demand; persistent pi process (killed/respawned only on kid-mode flip or barge-in); ASR pre-roll patch 0.6 s -> 1.2 s so soft first words are not clipped (`scripts/patch-asr-preroll.py`); barge-in storm guard (4 interruptions/60 s ends session).

## 5. Features
Faces via emoji-leading reply (server guarantees exactly one supported emoji, `enforce_face_stream()` in custom-providers/textUtils.py; 9 emotions); 6 states (idle/talk/story_time/security/sleep/dance) + 2 toggles (kid_mode, smart_mode) owned by firmware StateManager; 12-pixel LED ring contract (docs/modes.md); privacy sleep (camera, face, voice, wake word off; wake by head touch only); servo head turn to sound/speaker; face greeter w/ cooldown; face-lost aborts TTS; idle camera + scene synthesis narrative; songs/dance (Macarena); household registry YAML (people, ages, do_not rules, self_id_phrases, calendar_prefix, hot reload; voice_print reserved); Google calendar context; 7 pi tools: memory_lookup, recall_person, remember, remember_person, think_hard, take_photo, play_song (brain.db); firmware MCP tools over WS; Prometheus metrics + Grafana dashboard (monitoring/); proactive greetings (docs/proactive-greetings.md); overnight AV test harness (scripts/dotty_overnight.py, skills/dotty-av-test).

## 6. Security
Good:
- Kid Mode on by default; policy lives in system prompt (moved out of user turn because it stopped 4B tool calling); deterministic output backstops: `filter_tts_stream()` buffers whole kid reply, checks blocked-words + "imitable danger" tiers, fails CLOSED on error; guarded for direct tool output too (docs/kid-mode.md).
- Voice camera policy (docs/dotty-voice-camera-policy.md): kid-mode state file re-read on every access, unreadable/malformed = deny (fail closed), both the spoken shortcut and cached-description tool guarded. Pending human review, honestly labelled.
- Dashboard CSRF: signed double-submit cookie, HMAC, `hmac.compare_digest` for admin token (bridge/csrf.py, bridge.py:908). /admin/* bound to 127.0.0.1. Optional X-Admin-Token on /xiaozhi/admin/*. Honest threat model in SECURITY.md and architecture.md; private vuln reporting, 72 h ack, 90 d disclosure.
- Docs openly say the word filter is bypassable and not supervision.
Weak:
- Admin token OPTIONAL; when unset everything is open on LAN ("matching the stack's unset-token posture", bridge.py:902). OTA and WS unauthenticated, plain ws:// (docs/ota-verification.md, protocols.md). SECURITY.md concedes bridge /api/message and xiaozhi endpoints unauthenticated.
- docker.sock bind-mounted into xiaozhi container (= host root) because pi is run with `docker exec` (docker-compose.yml.template:64-71). Biggest design smell.
- CSRF secret falls back to ephemeral with warning; kill switch DOTTY_CSRF_ENFORCE=0.
- Greeter and admin `say` bypass the kid filter (README). Default vision goes to cloud (OpenRouter) frames. Dashboard has no login visible [unverified].
- No firmware signing; release workflow is manual, sha256 only; no binaries published since server address is compiled in.

## 7. Performance / memory
Little firmware code present, so mostly server-side. Piper/ONNX int8 low-RAM options, llama-swap co-loading two models, peer container for slow perception LLM calls so the voice event loop is not blocked (architecture.md). Firmware: WakeNet model from SPIFFS `model` partition, PSRAM requirement [docs only]. Reproducible-build doc: pinned espressif/idf:v5.5.4, dependencies.lock, `make verify-firmware` sha256 compare (docs/reproducible-builds.md). docs/sbom.md exists. No watchdog/OTA code to review.

## 8. UI / screenshots
Only two images: docs/assets/dashboard-light.png, dashboard-dark.png (viewed dark). Mobile-width web dashboard: header with 3 health dots (bridge/server/robot), git sha chips, Kid Mode and Smart Mode toggle cards, perception card, six coloured state pills (Idle/Talk/Story/Security/Dance/Sleep) matching LED colours, 9 emoji preset buttons, filterable live log (All/Turns/Events/Errors) with mono JSON. Clean, dense, dark-first with system theme follow (HTMX + Tailwind). Weakness: log is noisy (idle_motion spam), no robot face preview. No on-robot screen captures at all. Copy: state pill row colour-coded to LED, health dots, error-count tab, emoji test row. Rating 3/5.

## 9. README / docs quality
Strong. Honest status banner ("on ice", "nobody verified on other hardware"), "Why I built this" privacy stance, dedicated AI_TRANSPARENCY.md (Co-Authored-By trailers, human accountable, policy binding on agents), SECURITY.md with threat model, CODE_OF_CONDUCT, CONTRIBUTING with red-team-note requirement for safety PRs, 40+ docs with TL;DR + front matter + "Last verified" dates, cookbook, UAT runbook, FAQ, troubleshooting, COMPATIBILITY, CHANGELOG (225 lines, issue-numbered, explains why). No badges, no demo GIF/video. CI (.github/workflows/ci.yml): yamllint, compose validate, ruff, pytest+cov; pre-commit; docs onboarding test (tests/test_docs_onboarding.py).

## 10. Adopt (top 8) / avoid (3)
Adopt:
1. AI_TRANSPARENCY.md pattern and a "Safety-related changes need red-team note" contributor rule.
2. Fail-closed read of a mode state file at every access (kid mode, camera) rather than a startup flag.
3. Buffer-whole-reply output filter for kid mode with fail-closed on error, applied to ALL speech paths including tool output and greetings (close the gap they admit).
4. Put policy in system prompt, not appended to user turn, when small models stop calling tools; respawn on mode change.
5. ASR pre-roll >= 1.2 s and pin ASR language to English to stop mis-detection on short kid utterances.
6. Barge-in storm guard (N interruptions/60 s ends session; injected turns do not count).
7. Server guarantees exactly one leading face emoji from the supported set (near-miss mapping) independent of model compliance.
8. Status-pill dashboard whose colours mirror the LED contract; health dots; household YAML with do_not, self_id_phrases, hot reload; `DOTTY_LOCAL_ONLY` fail-closed switch for cloud URLs.
Avoid:
1. docker.sock mount + `docker exec` as the brain seam (root-equivalent).
2. Optional/unset admin token and plain ws:// OTA with no device auth.
3. File-mount patching of an upstream image (breaks on upgrades); README promoting features before verified on other hardware.
