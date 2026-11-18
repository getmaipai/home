# StackChan ecosystem audit: 15 projects compared with ours (2026-11-18)

Companion: [virtual-stackchan-tester-2026-11-18.md](virtual-stackchan-tester-2026-11-18.md). Per-project audits with file evidence: [stackchan-ecosystem-audit-attachments/](stackchan-ecosystem-audit-attachments/).

## How this was done, and limits

- Fifteen public repos were cloned (shallow, one commit each) and read. Nothing was run, built or installed. Repo text was treated as data.
- Star counts and real history were not available (shallow clones, no GitHub API). Mark all popularity claims [unverified].
- Screens: I opened four images myself (stackchan_alive face gallery, Nous-Girl starter faces, stackchan-local console, Dotty dashboard). The agents opened the rest and rated them. Most repos have no photos or screenshots of the real robot screen. A rating below is a rating of what exists to look at.
- Dotty's firmware is an empty submodule, so its firmware claims come from docs only.
- Our side is judged from the README, `docs/user/`, `docs/BACKLOG-HISTORY.md`, `AGENTS.md` and the brief. I do not have the firmware repo. Where I say "verify", check the firmware before acting.

## 1. Summary

1. Nobody in this set matches us on privacy and child safety enforced in code. The best of them (Dotty, Nous-Girl) still do most of it in prompts or optional filters. Keep that lead and say so loudly in our README.
2. Nearly every project has an unauthenticated robot or LAN endpoint (camera, mic, Wi-Fi write, config). That is the common failure. Our robot-side security should be audited against the list in section 4.
3. The most useful things to copy are small and concrete: a capability handshake, a frame-time gate, a single servo writer, smart end-of-turn, a reflex layer on reconnect, an MCP server with good tool descriptions, a safety-scan CI job, an AI transparency page, and a face and emote spec with preview sheets.
4. The only project with a simulator is `stackchan-simulator`, and it simulates a different thing (head physics, old HTTP API). Our real-code renderer is ahead. See the tester report.
5. Licenses: copy ideas freely, copy code only from MIT or Apache projects. `stackchan-ai-server` is AGPL (after a commit), tribute faces in Nous-Girl are non-commercial, and its Phonon voice is CC-BY-NC.

## 2. Scorecard

| Project | License | Stack | Local or cloud | Wake word | Security | Tests / CI | Docs | Screens (1-5) | Use to us |
|---|---|---|---|---|---|---|---|---|---|
| dotty-stackchan | MIT | Docker server, xiaozhi firmware fork (not included) | Local default, cloud opt-in | ESP-SR WakeNet9 "Hi, ESP" on device | Strong kid filter and CSRF; weak: docker.sock mount, optional admin token, plain ws | 43 tests, CI | Excellent, AI_TRANSPARENCY.md | 3 | High (kid mode, docs) |
| stackchan_alive | Apache-2.0 | PlatformIO firmware, Python bridge, Kotlin apps | Fully local | microWakeWord on device; ESP-SR rejected for frame cost | Strong OTA and privacy; had unauthenticated mic export once | Native logic tests, simulator, soak | Huge, evidence-first | 4 | High (performance rules) |
| stackchan-local | MIT | ESP-IDF firmware, TS daemon, React console | Local | ESP-SR "Hi StackChan" WakeNet9 | Pairing token, but default token and plain ws | 11 tests, no CI | Good, diagrams | 4 (console) | High (protocol, status page) |
| nous-girl-stackchan | MIT (faces and Phonon not) | ESP-IDF 6.1, patched xiaozhi server, Hermes agent | Local default | WakeNet9 Jarvis plus MultiNet7 custom phrase | Code-level guards, safety_scan CI; kid safety mostly prompt | Add-on tests, safety scan | Best README honesty | 4 faces / 2 UI | High (README, faces, smart-turn) |
| stackchan-mcp (migratorywhale) | MIT | Python MCP server, PlatformIO firmware, relay | Local, opt-in relay | Host-side text match | Best MCP security; device LAN API unauthenticated | Strong CI, firmware native tests | 5/5 | 4 (faces) | High (MCP design) |
| stackchan-ai-server | AGPL-3.0 | Go server for stock firmware | Cloud by default | Stock firmware on device | Good settings auth; device WS Device-Id only | Go tests, container CI | Strong, no screenshots | 2 | Medium (ideas only) |
| StackChan-GPT | MIT | ESP-IDF 6.1, direct OpenAI | All cloud | WakeNet9 plus Whisper text match (uploads standby audio) | Bad: open config portal, TLS verify likely off | 4 host ctests, no CI | Good per-feature docs | 3 | Medium (ctest seam, RAM tricks) |
| stackchan-xiaozhi-firmware | MIT | ESP-IDF 5.5 xiaozhi fork | Server or cloud | MultiNet6 phrase | Unauthenticated :8788, no secure boot | None | Good README | 1 | Medium (behavior ideas) |
| stackchan-pet-fw | MIT | Arduino, 3 devices | Local, device is the server | None | None: unauthenticated camera, mic, Wi-Fi write, CORS * | Validators only, CI build | Bilingual, CI enforced | 3 | Medium (protocol, assets) |
| StackChan_Minimal | Apache-2.0 | Arduino, AtomS3R, local whisper/llama/piper | Local | None (push to talk) | Open AP, no auth, key returned in GET | None | Good licensing hygiene | 3 | Low to medium (web flasher, TTS cache) |
| stackchan-cloud-mcp | MIT | VPS plus OAuth proxy | Cloud relay | None | Weak OAuth (no redirect validation) | None | Great symptom/cause/fix notes | 2 | Medium (reflex layer) |
| stackchan-claude-bridge | MIT | Python bridge | Cloud relay | xiaozhi cloud | Weak: voice to shell, bypassPermissions | None | Practical | 1 | Low (two patterns) |
| stackchan-openapi | MIT | Arduino HTTP firmware | Local | None | None; SSRF-like `/play?url=`, shell=True | None | Good, but no OpenAPI file | 1 | Low (error hints) |
| stackchan-bluetooth-simple | MIT | Arduino, A2DP speaker | Local, no network | None | Open pairing | None | Bilingual | 2 | Low (lip-sync and VU math) |
| stackchan-simulator | Apache-2.0 | Python, MuJoCo, three.js | Local | n/a | No auth on state-changing routes | 35 tests, CI | Japanese only | 3 | Reference only |

## 3. Wake word comparison

| Engine | Used by | Notes |
|---|---|---|
| ESP-SR WakeNet9 (prebuilt phrases) | dotty ("Hi, ESP"), stackchan-local ("Hi StackChan"), StackChan-GPT, nous-girl (Jarvis), stock xiaozhi | Ships in firmware, on device, offline. Fixed phrases; 21 prebuilt phrases listed by Dotty. |
| ESP-SR MultiNet (phrase by spelling) | nous-girl (MultiNet7), xiaozhi fork (MultiNet6, Chinese) | Custom phrase with no training; English phonetic spelling trick. Costs one core while idle, can make audio choppy. |
| microWakeWord (TFLite) | stackchan_alive | Runs at low priority on core 0. They rejected ESP-SR because the face fell to 85 to 102 ms per frame (about 11.7 fps). Training needs roughly 50 to 100 positives and about 1000 negatives (Dotty's estimate). |
| Cloud transcript match | StackChan-GPT (custom word), stackchan-mcp (host side) | Uploads standby audio or runs on the host. Avoid on a private product. |
| None | pet-fw, Minimal, openapi, bluetooth-simple | Push to talk or host decides. |

What to take:
- Measure wake-word cost on the face frame time on our unit before choosing an engine. Alive's finding is the best evidence in the set.
- If we want a custom phrase, WakeNet plus MultiNet with Low/Normal/High sensitivity and per-word switches (Nous-Girl) is the lowest-effort path. Run it only while idle.
- Nobody solved barge-in by voice without echo cancellation. Nous-Girl built it and disabled it. Tap to stop is the working interrupt.
- Our own invariants (backlog HANDSFREE-01: off by default, adult opt-in per device, always-visible indicator, nothing before the wake word kept) are stricter than every project here. Keep them; none of the others have an indicator or a pre-wake rule.
- Which engine our robot uses was not visible to me. Verify.

## 4. Security: patterns found

**Failures seen repeatedly (check ours against each):**
1. Unauthenticated HTTP or WebSocket on the robot exposing camera, mic, Wi-Fi write or config (pet-fw, openapi, Minimal, StackChan-GPT, xiaozhi fork on :8788, mcp device API, dotty OTA and WS).
2. `CORS *` or no Origin check, so any web page on the LAN browser can drive the robot (pet-fw, stackchan-simulator, StackChan-GPT portal).
3. Default or hardcoded secrets: AP passwords in source (pet-fw), `dev-local-token` (stackchan-local), static device tokens (StackChan-GPT).
4. Plain `ws://` and `http://`; TLS verification skipped (`ESP_TLS_SKIP_SERVER_CERT_VERIFY` in StackChan-GPT).
5. API keys in plaintext NVS or returned by a GET (Minimal), mirrored to SD (StackChan-GPT).
6. Open setup AP and Wi-Fi password over plain HTTP (Minimal, pet-fw).
7. Voice to powerful action with no gating: a heard sentence becomes a shell task (claude-bridge), model-driven smart-home calls with no allow-list (ai-server), one 30-day token for all tools including camera (cloud-mcp).
8. Weak OAuth (no redirect validation), shared key with no rate limit, non-constant-time compare.
9. A device-fetches-any-URL endpoint (`/play?url=`), and `shell=True` with request values (openapi).
10. Docker socket mounted into a container (dotty).
11. Camera frames written to disk with no retention (stackchan-mcp `see`).

**Good practices worth copying:**
- Fail closed: a missing token blocks startup (stackchan-mcp); a mode file unreadable means deny (Dotty).
- Constant-time compares, HttpOnly SameSite cookies, write-only secret fields (ai-server, Dotty CSRF).
- Pairing token in the first handshake, schema-validated, binary first frame rejected (stackchan-local).
- Separate device and controller tokens, expiring command envelopes, single in-flight slot, no replay, CA-verified TLS only (stackchan-mcp relay).
- Release image refuses embedded secrets; OTA token stored only as a hash; inactive-slot write with health confirm and rollback (alive).
- Booth or privacy mode persisted on the device with verified-state reporting (stackchan-mcp).
- On-screen indicator when the camera is used: `see` shows the captured frame on the robot for 6 seconds (stackchan-mcp).
- Code-enforced action guards: read-back confirm token within 5 minutes and single use, hourly rate limit, recipient allow-list, angle and brightness clamps, size checks before download (Nous-Girl).
- Safety scan in CI for secrets, emails, private domains, LAN IPs, big files, broken links (Nous-Girl); security audit script, SHA-pinned actions, SBOM (stackchan-mcp).
- Honest threat model and private vulnerability reporting (Dotty, Nous-Girl, alive, mcp).
- Log redaction of tokens, keys and image payloads; WebUI bound to loopback by default (stackchan-local).

## 5. Performance and memory tricks

- **Frame-time gate (alive):** the face must hold a 50 ms frame period. Any feature that pushes frames to 85 ms or more is rejected, measured on the robot. This is the strongest idea for a patch-heavy firmware like ours.
- **Single servo writer (alive):** only the motion task writes actuators; everything else posts events. Add a manual-lock flag so an explicit LLM command is not overridden by the autonomous tracker (xiaozhi fork, claude-bridge).
- **Internal RAM for network worker stacks:** allocate with `heap_caps_malloc(MALLOC_CAP_INTERNAL)` and a static task buffer; set `SPIRAM_MALLOC_ALWAYSINTERNAL` and `RESERVE_INTERNAL` (StackChan-GPT, stackchan-local).
- **TLS memory:** `MBEDTLS_EXTERNAL_MEM_ALLOC`, `MBEDTLS_DYNAMIC_BUFFER`, `SSL_KEEP_PEER_CERTIFICATE=n`, smaller Wi-Fi RX buffers (StackChan-GPT, xiaozhi fork).
- **LVGL pool in PSRAM** and a single 64 KB shared wake-word ring replacing many internal allocations (Nous-Girl).
- **Cache with fallback:** frame caches released under memory pressure, decode straight from flash when allocation fails (pet-fw). Asset profile chosen at boot from a validated manifest with an image-free emergency profile.
- **Reject early:** check Content-Length before downloading images; cap sizes (Nous-Girl fixed a reboot this way).
- **Media flow control:** binary frame envelope with magic and kind byte, credit-based flow control for camera frames, adaptive quality (stackchan-local).
- **Audio:** raw 24 kHz PCM TTS skips decode (StackChan-GPT); 120 ms prebuffer and a fallback ladder that never replays after audio began (stackchan-mcp); 1.2 s ASR pre-roll so soft first words are not clipped (Dotty); 300 ms prebuffer tunable (ai-server).
- **Latency:** per-stage log (capture, STT, brain, text ready, first audio) with gates and an early "thinking" frame under 300 ms (alive, ai-server `[LAT]`); smart end-of-turn model cuts about 0.35 s and stops mid-thought cutoffs (Nous-Girl, Pipecat smart-turn v3.2, BSD-2).
- **Power and heat:** thermal monitor with baseline and hot timer; auto torque release after moves; PMIC interrupt forensics for unexplained resets (alive, cloud-mcp, pet-fw).
- **Mute the IMU while speaking** so speaker vibration does not trigger shake, with cooldown and re-arm after stillness (xiaozhi fork).
- **Release hygiene:** separate flash artifacts (full, app that keeps Wi-Fi, assets) with SHA256SUMS and known-bad version flags (Nous-Girl, pet-fw); coredump partition; reproducible build script; soak test as release evidence (alive ran 28,807 s).
- **Pin the SDK or tool line** when a version breaks hardware behavior and write the reason next to the pin (Minimal: core 3 made servos twitch).

## 6. UI and screens

Ranked by what is actually worth copying:

1. **stackchan_alive face gallery** (viewed): four personas by five states (idle, listen, think, speak, sleep) in one grid. Flat vector faces, one accent color per persona on a dark ground, readable at a glance. It proves the face system is swappable and shows state changes without a robot. Minimal and slightly generic. Copy the grid image and the host preview renderer that reuses firmware drawing code (we already have the renderer, so we can produce this sheet for free).
2. **Nous-Girl starter faces and emote sheet** (viewed): 12 named states per character (neutral, happy, sad, thinking, sleeping, pet, shake, speaking, listening, look left, look right, email) with overlay icons (hearts, sweat drop, ZZZ, spirals, sound arcs, flying envelope). Preview sheet labels each frame with its millisecond timing. Grayscale and generic, but the vocabulary and the labeled sheet are the best documentation of states anywhere. Copy the vocabulary, the overlay-icon language and the timing-labeled sheet. Face and starter art is CC0; the tribute faces are not.
3. **stackchan-local console** (viewed): dark sidebar listing each chip with name and part number and a green status dot, a KPI strip across the top (device, SSE, FPS, faces, battery, Wi-Fi, drops), key-value cards and a raw JSON block. A model diagnostics page. Copy: per-module "available" with a reason, KPI strip, I2C scan, raw JSON toggle. It would suit an admin "Robot health" tab.
4. **Dotty dashboard** (viewed): header with three health dots (bridge, server, robot), Kid Mode and Smart Mode toggle cards, state pills whose colors mirror the LED ring (Idle, Talk, Story, Security, Dance, Sleep), nine emoji test buttons, a filterable log (All, Turns, Events, Errors with count). Clean, dark-first. The log is noisy (idle motion spam) and there is no robot face preview. Copy: state pills that match LED colors, health dots, error count tab. Add a live face preview (we can render one).
5. **stackchan-mcp faces** (agent viewed): seven polished cel-shaded portraits, 320x240, with an A/B frame generator and a `--check` mode. Good asset pipeline.
6. **pet-fw sprite sheets**: 4x4 mouth-by-eye grid driven by audio amplitude and a sprite sheet to assets toolchain with a schema and validator. Most emotive art, heaviest on flash.
7. **StackChan-GPT launcher photos**: phone photos of the stock launcher carousel. Weak as documentation.

Observation: almost no project shows an actual robot screen in its README. A README with real captures from our renderer (every screen, light and dark, child and adult) would stand out.

## 7. README, promotion and AI transparency

**Patterns that work:**
- Nous-Girl README: status banner (hobby, one maintainer, AI-assisted, untested by others), current/safe/avoid versions, "Pick a brain" comparison table, "What runs where" table, models table with sizes and licenses, "Coming soon" fenced off from shipped, "Where to get help" table, an explicit AI transparency section.
- Dotty: `AI_TRANSPARENCY.md` (Co-Authored-By trailers, human accountable), "Why I built this" privacy stance, SECURITY.md with threat model, contributor rule that safety PRs need a red-team note, docs with TL;DR and "Last verified" dates, honest "on ice" banner.
- Per-feature doc template (Nous-Girl `docs/FEATURES.md`): what it does, turn it on, use it, set it up yourself, turn it off, plus a runs-on / needs-server / public-now map.
- stackchan-mcp: PR template with hardware-impact and safety-note boxes; dated troubleshooting notes; strong CI badges.
- stackchan-local: mermaid diagrams, capability matrix, endpoint table, hardware acceptance checklist, "Privacy and safety" and "Project status" sections.
- alive: privacy-boundary diagram, latency budgets in a diagram, persona gallery image.
- cloud-mcp: every field bug as symptom, root cause, change, verification.
- GPT and Nous-Girl: a "validated vs not hardware-tested" section.
- pet-fw: bilingual docs with CI that fails on unpaired files.

**Weaknesses to avoid:** READMEs with no images (most), huge status prose that buries the quick start (alive), Windows-only tooling, promoting features before they are verified on other hardware.

**Our README** already leads with privacy and has a quick start, a "Preview" and "Planned" legend, and a privacy page listing every connection. Gaps against this set: no AI transparency statement (not found in the README), no screenshots in the README text I read, no comparison or "what runs where" table, and no robot section near the top.

## 8. Protocol and agent control

- **Capability handshake** (pet-fw `device.info` with `capabilities[]` and limits; stackchan-local `daemon.hello` with featureFlags): host and firmware version independently. Add if we lack it.
- **Command lifecycle** (stackchan-local): `commandAck` (accepted or rejected) then `commandStatus` (completed or failed) with a command id.
- **Event vocabulary:** push touch, shake and wake as small JSON events with debounce (openapi, mcp, local).
- **MCP server for our host** (stackchan-mcp is the model): short namespaced verbs (`robot_say`, `robot_see`, `robot_face`, `robot_move`, `robot_status`, `robot_health`, `robot_playback_status`), a no-secrets `config_summary`, concise strings with "unconfirmed" wording, valid enum values in errors, stdio first then loopback HTTP, fail closed without a token. Give every tool a docstring with "use when / do not use for" and what to say after the call (claude-bridge, mcp `booth_mode`). Our README lists MCP servers as *Planned*; this is the reference design.
- **Async receipt then poll** for slow agent work, with a speakable receipt string supplied by the model (claude-bridge).
- **Approval alert:** `notify_attention(project)` and `notify_dismiss` (head shake plus a pinned card) for "waiting for a grown-up" moments (xiaozhi fork, claude-bridge). Must be authenticated in our version.
- **Publish a real OpenAPI 3.1 file** for the host. The repo named for it (`stackchan-openapi`) has none.
- **Reflex layer** (cloud-mcp): on every device reconnect, re-push face set, volume, brightness, torque release and LED state; speech watchdog resets to the right face after say(); touch cooldown (15 s); idle micro-motions with quiet hours and daily caps for servo wear.
- **Provenance prefix** on transcripts handed to an agent, distinct for touch input (mcp). This is the hook where age and surface gates apply.
- **Per-device profiles** keyed by device id overriding persona, model, voice (ai-server). Ours should key by robot and room.
- **Conversation window:** close the audio channel after N seconds of silence; silent packets do not renew it (ai-server, 15 s default).
- **Pull-model audio** (openapi, mcp): device fetches audio the host serves; gives duration for subtitle paging. **Speech-bubble cues** interleaved with PCM segments (pet-fw) for subtitles in sync.
- **Face and emotion control:** server guarantees exactly one leading face marker from the supported set (Dotty); emotion tags like `[happy]` parsed and never spoken (StackChan-GPT); touch and gesture mapped to canned user-intent texts sent to the model so the persona stays in the model (xiaozhi fork).
- **Behavior gating table** per expression: blink allowed, slow blink, saccade allowed, gaze override; overlays kept separate from the base expression (xiaozhi fork).
- **Music-reactive mode:** adaptive FFT lip-sync gain and an LED VU gradient (bluetooth-simple); onset-energy BPM estimate for dance (StackChan-GPT). Note CoreS3 has no Bluetooth Classic, so no A2DP speaker.
- **Idle camera motion tracker:** median-compensated luma diff on four quadrants, centroid with deadband, 30 s cap, no network (StackChan-GPT); 40x30 downsample frame diff (xiaozhi fork). Cheap "someone is near" cue.
- **Memory contract:** bounded records, expiry, atomic replace with backup, explicit remember and forget, deterministic local answers for time, date and name (alive). History store with hashed filenames, 0600 permissions, retention sweep, Markdown export and one-click clear, off by default (ai-server). Ours is already richer; compare retention and clear controls.
- **Typed-fields-only room vision** that rejects identity and free text (alive). Ours already forgets after 90 seconds and keeps no pictures; keep that wording prominent.

## 9. Licenses

| Project | License | Copy code? |
|---|---|---|
| dotty, alive, local, mcp, cloud-mcp, claude-bridge, openapi, pet-fw, bluetooth-simple, xiaozhi fork, GPT, Nous-Girl code | MIT or Apache-2.0 | Yes, with notices. Keep upstream M5Stack and xiaozhi notices where derived. |
| stackchan-ai-server | AGPL-3.0-only (code up to commit deddd647 stays MIT) | Ideas only unless our hub is AGPL compatible. |
| Nous-Girl tribute faces; Phonon 40M voice | Non-commercial | Do not use. Starter faces are CC0. |
| pet-fw release binaries with Tsukuyomi-chan images | Not MIT | Do not reuse. |
| M5Stack StackChan repo | No root license file found; app is MIT; firmware license not read | Check before publishing derived code [unverified]. |
| Pipecat smart-turn v3.2 | BSD-2 | Yes. |
| stackchan-simulator | Apache-2.0, meshes from rostack-chan (Apache-2.0) | Yes. |

Licensing hygiene worth copying: Minimal's careful third-party notices and "not endorsed, not a medical device" disclaimers, and pet-fw's note that some historical binaries are not MIT.

## 10. What to change, add or fix (priority order)

Compare each against the firmware repo before acting. Items I could not verify are marked "verify".

**P0: security and trust (small, high value)**
1. Verify that the robot exposes no unauthenticated camera, mic, Wi-Fi or config endpoints, sets no `CORS *`, checks the Origin on WebSocket upgrade, has no default AP password in source, and does not skip TLS verification. Add a firmware lint for these (stackchan-local's `check-firmware-local-only` is the pattern). Verify.
2. Add a safety-scan CI job: secrets, emails, private domains, LAN IPs, big files, broken links, with a path-and-line allow-list (Nous-Girl). Add SHA-pinned actions and a security audit script (stackchan-mcp).
3. Any camera capture shows an on-screen indicator, and nothing is persisted by default (stackchan-mcp `see`). Verify our camera path.
4. Make sure every speech path, including greetings, admin say and tool output, goes through the same child-safety filter (Dotty admits its greeter and admin say bypass it). Verify ours.
5. Add a SECURITY.md with private reporting and a threat model if the public repo lacks one. Verify.

**P1: product and docs**
6. AI transparency page (Dotty and Nous-Girl wording): what AI helped build it, what data goes where, who is accountable. Add a PR rule that safety changes need a red-team note.
7. README: add real renderer captures of every screen (child and adult, light and dark), a "what runs where" table and a robot section near the top.
8. Face and emote spec: named states, overlay icons, per-frame timing, labeled preview sheet generated by our renderer, community face guide with a validator, starter faces under CC0.
9. Admin "Robot health" tab: per-sensor available-with-reason, KPI strip (online, FPS, battery, Wi-Fi, drops, free RAM), I2C scan, raw JSON toggle, per-stage latency (stackchan-local, ai-server).
10. State pills that mirror LED ring colors, with a live face preview, in the robot settings page (Dotty).
11. Ship the MCP server and a real OpenAPI document for the host; use the tool-description wording rules in section 8.

**P2: engine and firmware**
12. Frame-time gate: record the face frame period on the real unit as a release gate; reject features that break it (alive). Add per-stage voice latency and show it in settings.
13. Single servo writer with manual-lock arbitration. Mute the IMU while speaking. Add a reflex layer on reconnect.
14. Smart end-of-turn model on the host (smart-turn v3.2) with fallback to plain VAD; ASR pre-roll at least 1.2 s; pin ASR language per profile for kids' short utterances (Dotty).
15. Release hygiene: split flash artifacts, SHA256SUMS, known-bad versions, coredump partition, soak test report.
16. Ask whether a barge-in storm guard exists (4 interruptions in 60 s ends the session, Dotty).

**Do not copy:** docker.sock mounts, voice to shell, optional admin tokens, 30-day all-tools tokens, vendoring whole upstream trees (Nous-Girl's 46 MB esp-dl), committed binaries with stale checksums, prompt-only kid safety, cloud STT for wake word, MuJoCo for two axes.

## 11. Minimal local stack to test or start

Goal: try the whole thing on one computer without buying hardware first, then add a real unit.

### A. Our own stack (recommended)

What you need: a Mac. Chat and basic voice run on 16 GB or more; picture reading needs 32 GB, songs 64 GB, video 128 GB (README). An optional StackChan, Chrome or Edge, and a USB-C data cable.

1. **Install Home.** In Terminal on the Mac that will run it:

```bash
curl -fsSL https://raw.githubusercontent.com/getmaipai/home/main/scripts/install.sh | sudo bash
```

2. **Open the address it prints.** The setup wizard installs the AI engine. Choose small models first (chat and voice); add the rest later.
3. **Create a profile for each person** and set a child profile to child controls. Check **Settings, Privacy and safety, What connects to the internet** to see the (short) list of connections.
4. **Try voice** with **Settings, Voice and robot**. The wake word stays off until an adult turns it on for one device.
5. **Add a robot** (optional): **Settings, Apps and devices, Devices, Add a robot, Add a StackChan**. Use Chrome or Edge on a computer over the secure address, plug the unit in with a data cable, pick the port, wait for the flash, then join the robot's Wi-Fi from a phone to give it your home network. Home never asks you for the Wi-Fi password. Set the robot's controls (child, teen, adult) and companion.
6. **Roll back or remove** with the steps in `docs/user/install-upgrade-uninstall.md`.

For contributors who only want to look around, no robot and no install on the family Mac: in a checkout, `bun run dev` starts a seeded demo Home (Sage the owner, Marlow a teen, Nova a child). `bash scripts/dev.sh url` prints the address and `bun run dev:stop` stops it. Use the demo only; never preview on the live hub. For robot screens without hardware, use the desktop renderer, and the software unit once phase 1 and 2 of the tester exist.

### B. If someone wants to compare with a community stack (not recommended for the household)

Pick the one that fits the starting point. Read its README for exact commands; I did not run any of them.

- **Stock StackChan, no firmware changes, self-hosted brain:** `stackchan-ai-server` (Docker or Home Assistant add-on). Point STT, LLM and TTS at local OpenAI-compatible servers (for example Ollama and a local Whisper and Piper). AGPL. Cloud by default, so set it up local on purpose.
- **Fully local voice server with a kid mode:** `dotty-stackchan` (Docker, local ASR, TTS and a small local model). Project is paused, firmware is a separate fork.
- **Tiny, cheapest test with no servos:** `StackChan_Minimal` on an AtomS3R with local whisper.cpp, an Ollama or LM Studio model and Piper, plus its browser flasher.
- **Control from an AI agent:** `stackchan-mcp` (loopback only, set a bearer token).

For any of them: keep the robot on its own Wi-Fi network or VLAN, do not forward ports, and do not expose any port on the public internet.

### C. Sizing for local testing

- 16 GB Mac: chat plus voice with small models (README guidance).
- Server for community stacks: any recent laptop for local Whisper (small), a 3B to 4B chat model and Piper. Larger models need more memory.
- The robot needs only your Wi-Fi and the host on the same network.

## 12. Next steps

1. Read the ten P0 and P1 items and tell me which to start. All are small except the MCP server and the Robot health tab.
2. Build tester phase 1 (see the tester report).
3. Re-check our firmware against section 4 (an hour of reading and one lint).

Files: attachments hold the full per-project audits (architecture, wake word, speech, security, memory, UI, docs, adopt and avoid lists).
