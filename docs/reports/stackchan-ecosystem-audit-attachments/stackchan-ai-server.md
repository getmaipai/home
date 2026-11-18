# Audit: stackchan-ai-server

Read-only audit of a downloaded clone (nothing run or built). [unverified] marks inference.

## 1. What it is
- "StackChan AI Server" by rudyll (`repository.yaml`, `AGENTS.md`): a self-hosted replacement for the Xiaozhi cloud for UNMODIFIED stock StackChan firmware (xiaozhi-esp32 protocol v3). Ships as Home Assistant add-on, standalone Docker, and a macOS DMG preview (0.1.2).
- License AGPL-3.0-only (LICENSE, `stackchan-server/NOTICE.md`). Code derived from M5Stack StackChan server (MIT, preserved in `licenses/MIT-M5Stack.txt`); versions up to commit deddd647 / v2.8.0-beta.3 stay MIT. Relicensed to AGPL mid-life: note for anyone copying code (check which side of that commit).
- Last commit 2026-09-22 ("Prepare macOS 0.1.2 preview"); history squashed to 1 commit in the clone. Stars not in files [unverified]. PayPal sponsor badge + `SPONSORING.md`.
- Go (195 files, ~7.7k lines in the `ai` service, ~2.4k lines of tests), a few Python scripts (`flash_nvs.py`, smoke tests), shell. 12 MB; large items are `stackchan_music.mp3` (3 MB), PNG icons, and `value_constant.go` (334 KB, generated constants from upstream).
- Much of `server/api/*` (pano, friend, dance, appstore, post...) is the upstream official StackChan cloud API surface [unverified whether all enabled].

## 2. Architecture
- Server only. Device (stock firmware) -> `/xiaozhi/ota/` returns local WS URL -> `/xiaozhi/ws` Opus 16 kHz + JSON ("llm", "listen", "abort" messages). Core: `stackchan-server/server/internal/service/ai/` (`ws_simulator.go` emulates the Xiaozhi server; `provider.go`, `realtime_client.go`, `gemini_client.go`, `openai_client.go`, `compatible_session.go`).
- Providers: OpenAI Realtime (`gpt-realtime`), Gemini Live (`gemini-2.5-flash-native-audio-latest`), or turn-based STT -> chat -> TTS over any OpenAI-compatible endpoint (TokenHub, OpenRouter, generic). Each stage separately configurable (`stt_*`, `llm_*`, `tts_*`), so fully local Whisper/Piper/Ollama is possible via compatible endpoints [unverified, depends on endpoint].
- Cloud by default (audio goes to the chosen provider); HA control stays on LAN via direct HA WebSocket API with a long-lived token (`ha_ws_client.go`, `ha_tools.go`).
- Device bootstrap: NVS `ota_url` injection (`flash_nvs.py`, GUI "Device setup" page) or optional port-443 OTA interception with an in-memory self-signed cert (`ota_https.go`, HA add-on only).
- Background-task queue (`background_tasks.go`, JSON persisted, per Device-Id FIFO, claim/release semantics) for long agentic work while the voice session stays free.

## 3. Wake word
- None in this repo. Explicit statement (README "Wake word, standby, and power", `docs/conversation-memory-and-wake.md`): stock firmware does on-device wake-word and emits `listen:detect/start/stop`; server cannot change it. Server accepts `listen:start` without `detect` because some builds omit it.
- Server adds a conversation window: 15 s silent follow-up (standalone default) after the last response frame, then closes the audio channel so firmware returns to wake-word standby; silent packets do not renew it (`conversation_activity.go`).

## 4. Speech stack
- Realtime path: Opus -> PCM 16 kHz -> OpenAI/Gemini server VAD -> 24 kHz PCM -> Opus encode (`opus_codec.go`, cgo libopus statically linked in macOS app). Claimed 0.5-1.5 s.
- Turn-based path: local energy VAD with trailing-silence end-of-turn (`server_vad.go`, `compatible_vad_silence_ms` default 800, range 200-5000) because stock firmware in auto mode never sends `listen:stop`.
- Latency tricks: `[LAT]` log lines from end-of-turn to STT, LLM, TTS start, first audio; audio prebuffer (`audio_prebuffer_ms` 300, max wait 900) to hide upstream chunk jitter; streaming throughout.
- Barge-in: device `abort` handled (`ws_simulator.go` ~421), realtime `response.cancel` (`realtime_client.go` 196). Interrupted Gemini replies are not archived.
- Personas: global `system_prompt` plus per-device `device_profiles` JSON keyed by Device-Id (provider, prompt, model, voice).

## 5. Features
- Home Assistant control (lights, climate, covers, media, scripts, scenes, automations, area-wide; entity search; clarifying questions), multi-turn context, optional Gemini Google Search grounding (mutually exclusive with tools), background tasks, opt-in text history (per device, export Markdown, clear), settings web UI (Basic / Voice pipeline / Background / Device profiles; provider check fetches model + voice catalog), guided NVS injector. No faces/servos/LED/camera/games/timers/kid mode here (all stock firmware or absent). Memory is recent-transcript only, not semantic.

## 6. Security
Good:
- Settings UI: Bearer token, `subtle.ConstantTimeCompare` (`config_ui.go` 227), short-lived HttpOnly + SameSite=Strict cookie, `MaxBytesReader` 8 KB login / 128 KB settings bodies, token persisted `data/settings-token`, UI bound to 127.0.0.1:8099 by default, HA token never returned by settings API (blank field keeps saved), settings files 0600 in 0700 dir, atomic replace.
- History keyed by SHA-256 of Device-Id, 0600 files, retention sweep (startup + hourly), 2000 msg / 4096 char caps, off by default, explicit warning that enabling context reuse sends text to the provider; no raw audio saved. Honest statement that Device-Id is a logical key, not authentication.
- Third-party endpoint warnings in README; AGENTS.md forbids committing keys/tokens/device ids.
Weak:
- Device WebSocket: identity is just the `Device-Id` header; `CheckOrigin` returns true (`ws_simulator.go` 41-43); no device token, no TLS on `ws://`, port 12800 published on all interfaces. Anyone on the LAN can open a session and spend the user's provider credits or call HA tools. README says "keep on trusted LAN".
- HA control: model can call any domain/service via `ha_call_services` (no allow-list found beyond a read-only domain filter in search) [unverified]; a prompt-injected or misheard command can unlock/open covers.
- Self-signed OTA HTTPS interception on 443 is a MITM-style hack; fine locally but a risky pattern.
- `http.ListenAndServe` for settings (no TLS); LAN exposure if user changes bind.
- No SECURITY.md, no kid/child safeguards, no content filter, history plain text unencrypted (documented).

## 7. Performance and memory
- Server-side only. Prebuffer tunables, silence-ms tunable, static libopus, multi-arch container matrix (amd64, aarch64, armv7, armhf) built in CI. Hourly retention worker; atomic writes. Nothing for device memory.

## 8. UI / screens
- Images in repo: `stackchan-server/logo.png` (viewed: 3D-rendered StackChan with hand-drawn crown and angel wings on blue glow, rounded square; charming, strong brand mark), `icon.png`, `ai/assets/stackchan-icon.png`, `stackchan-mark.png`. NO screenshots of the settings UI or of anything else; the README is text only. The settings UI itself is embedded HTML (`config_ui_html.go`, 45 KB): "STEP 01..04" panels with kicker + badge ("可选" = optional), Chinese-first copy [from source, not seen rendered].
- Rating 2/5 for visuals (logo 4/5, but no UI shots). Copy: the guided STEP-numbered setup panels, "first connection banner", provider check button that populates model and voice catalog.

## 9. README and docs
- Strong prose README: positioning table vs HA Assist, ASCII architecture and audio-pipeline diagrams, provider table with every option, firmware setup Methods A/B with warnings (NVS replace wipes Wi-Fi), HA-update notes, mainland-China latency guidance, bilingual README.zh.md, CHANGELOG, CONTRIBUTING with clear licensing, `docs/licensing.md`, `SPONSORING.md`. Badges: license + sponsor only.
- Very long README (dense option tables); honest "Beta" labels and "container checks do not replace real-device testing".
- Tests: Go tests across the ai package plus Python tests (flash_nvs, HA launcher, licensing, macOS package); CI `containers.yml` builds 4 architectures and smoke-tests both launchers.
- AI transparency: no disclosure of AI-assisted development in README (AGENTS.md exists, written for agents: "do not commit unless user authorizes"); data flow disclosure is good in prose (what goes to provider, what stays on LAN, history behaviour) but no formal privacy page.

## 10. Top ideas to adopt
1. Conversation-window pattern: close the audio channel after N s of silence (silent packets do not renew), then return to wake-word standby; return stalled-response guard of 2 min.
2. Per-device profiles keyed by device id overriding persona, model, voice (we would key by robot/room).
3. `[LAT]` per-stage latency log (end-of-turn -> STT -> LLM -> TTS start -> first audio) and surface it in our settings page.
4. Audio prebuffer (300 ms, max wait 900 ms) tunables to hide uneven streaming chunks; expose "stable vs fast" presets.
5. History store design: hashed filename, 0600/0700, atomic replace, retention sweep, per-message cap, off by default, Markdown export and one-click clear, plus a context-cap separate from storage.
6. Settings page auth: Bearer token printed once at first start, persisted, constant-time compare, HttpOnly SameSite=Strict cookie, secret fields write-only (blank keeps saved).
7. Background task queue with claim/release so results are announced only when user, model and speaker queue are idle, and unrecoverable tasks become explicit failures after restart.
8. Guided onboarding page with copyable URLs, first-connection banner, provider check that fetches model and voice catalogs; AGPL notices and licensing doc done carefully.

Avoid: unauthenticated Device-Id-only WebSocket with `CheckOrigin: true` and a LAN-wide published port; unrestricted model-driven smart-home service calls with no allow-list or confirmation; a README with no screenshots and no AI-use disclosure.

Source-licence caution: AGPL-3.0 applies to post-deddd647 code; copy ideas, not code, unless our hub is AGPL-compatible.
