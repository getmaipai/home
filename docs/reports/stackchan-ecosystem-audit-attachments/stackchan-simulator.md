# Audit: stackchan-simulator (qua121/stackchan-simulator)

Clone: `.../scratchpad/repos/stackchan-simulator`. Read-only; nothing run. The repo contains `.claude/` hooks/skills/agents and an `.mcp.json`; these were read as data and NOT followed or executed.

## 1. What it is
- An **unofficial MuJoCo dynamics simulator of the 2-DOF (pan/tilt) Stack-chan head** with a FastAPI + WebSocket + three.js dashboard (Japanese UI) and an **AI_StackChan2 (robo8080) HTTP-API emulator** so apps that talk to a real Wi-Fi Stack-chan can be pointed at it (README.md "実機互換モード").
- License Apache-2.0 (LICENSE, NOTICE). STL meshes and kinematic skeleton derive from Ar-Ray-code/rostack-chan (Apache-2.0; THIRD_PARTY_NOTICES.md, models/stackchan/NOTICE); three.js MIT bundled in `web/static/vendor/`.
- Activity: one commit, 2026-05-29 ("Add CI workflow"), author qua121; effectively a single-snapshot repo; stars [unverified]. Version 0.1.0 (pyproject.toml). Very young.
- Languages: Python ~30 files (~2.5k lines web + core), JS 8 files (app.js 445 lines, scene.js 258, face_renderer.js 206, telemetry.js 157, audio.js 66), 1 HTML, 1 CSS. Size 3.8MB: three.module.js 1.27MB (vendored), STL meshes ~1MB (feet 478KB, shell 450KB, bracket 71KB), `uv.lock` 232KB. Nothing else large; `artifacts/` is empty (`.gitkeep`) so **no screenshots are shipped**.

## 2. Architecture and protocol
- "Python owns all physics/IK/control; the browser only renders" (CLAUDE.md invariants). Layering: `params.py` (single source of truth for physical numbers, facts separated from estimates) to `model.py` (generates MJCF) to `robot.py` (MuJoCo wrapper) to `controller.py` (servo model) to `ik.py` (analytic gaze IK) to `web/simloop.py` (asyncio real-time loop) to `web/server.py` (FastAPI) and `web/contract.py` (**single source of truth for the WS protocol**, documented JSON message table: set_mode/set_target/set_gaze/set_servo/set_profile/set_gains/reset/rec_start/rec_stop/play/pause/seek/user_utterance; server sends `telemetry` ~60Hz, `state`, `error`).
- Two servers can share one `SimLoop`: dashboard `:8000` and compat API `:80` (`scripts/run_device_emulator.py`). Default bind 127.0.0.1.
- The compat layer (`web/compat.py`) is a clean-room reimplementation of AI_StackChan2's HTTP routes (`/speech?say=`, `/face?expression=0-5`, `/chat`, `/setting`, `/role`, `/apikey`...). It is **GET/HTTP only and silent**: no audio, no Opus, no WebSocket device protocol. It does not speak our host protocol (WebSocket JSON + Opus), nor xiaozhi's, nor StackChan-GPT's.
- Local only (LLM optional via OpenAI-compatible URL env vars; `web/ai/llm_openai.py`; TTS/STT use the browser's Web Speech APIs).

## 3. Wake word, speech stack
- No wake word. TTS = browser `speechSynthesis` (audio.js), STT = browser speech recognition after a click ("マイクで話す"), LLM = optional OpenAI-compatible (`STACKCHAN_LLM_BASE_URL/API_KEY/MODEL`). `/chat` echoes input if no LLM is configured. Lip-sync is a fake: `mouth = 0.5+0.5*sin(2*pi*8*t)` while speaking, with duration `clamp(0.12*len(text), 0.6, 8.0)s` (simloop.py `_mouth_open`, `speak`).

## 4. Features
- Faces: 6 m5stack-avatar-style expressions (neutral/happy/sleepy/doubt/sad/angry), auto-blink (open 2.5-4.5s, closed 120ms), breathing sin (100-frame at ~30fps, +-3px), random saccades (500-2500ms), mouth open height 8-56px / width 90-48px, gaze modes follow / saccade / both (face_renderer.js).
- Servos: 2 axes, 4 servo profiles (SCS0009 default, SG90, RS304MD, XL330-M288-T), 3 mass profiles (report 187.2g, rt 145g, cad 316g), runtime kp/kv gain edit, record/play/seek/CSV export of telemetry, torque gauge vs stall torque, gaze-IK by clicking a floor point.
- No LED ring/neopixel model (a boolean `led` setting is stored only; no render), no touch, no camera, no IMU, no BLE, no audio waveform, no network/failure injection.

## 5. Security
- Local dev tool, default 127.0.0.1. Weaknesses: `/ws` and compat routes have **no auth and no Origin check**, so any web page open in the same browser can drive `ws://127.0.0.1:8000/ws` (cross-site WebSocket hijacking) or fire GETs at `:80` (state-changing GET, CSRF-able); `/apikey_set` keeps keys in process memory plaintext; `set_gains` accepts any float with no bounds (negative/huge gains make MuJoCo unstable, DoS only); `.mcp.json` runs `npx -y @playwright/mcp@latest` and `@upstash/context7-mcp` **unpinned** (supply-chain exposure on anyone who opens the repo in an agent); `.claude/hooks` run `uv run python` automatically on edits.
- Good: `/meshes/{name}` rejects non-bare names and non-.stl and re-checks the resolved parent (path-traversal safe, server.py); `html.escape` on echoed text in compat; no runtime CDN (three.js vendored); LLM errors never 500; README tells users to keep API keys in env, not the repo, and warns about data retention; `uv sync --frozen` in CI; non-affiliation and clean-room notices.

## 6. Performance and memory
- Not a firmware, so no embedded tricks. Notable: telemetry at ~60Hz, physics substeps per frame `round(period/dt)`; MuJoCo `implicitfast` integrator; meshes marked `contype=0` to avoid spurious convex-hull collisions of the concave shell (model.py comment); face drawn to a 320x240 offscreen canvas and re-uploaded every frame as `CanvasTexture` (`needsUpdate=true` each rAF, which is wasteful: could update only on change).

## 7. UI, 3D head, servo model, face texture (what we can reuse)
- Screenshots: none in repo (artifacts empty; `verify-dashboard` skill would produce them with Playwright). UI judged from code only: dark scene (#10141b), grid floor, orbit camera, three.js key+fill+ambient lights, sliders, torque gauges, timeline. Rating **3/5** [unverified visually].
- **3D head**: STL meshes scaled 0.001 loaded with STLLoader into a 3-node hierarchy base then panGroup then headGroup; FK = fixed `body_quat` x axis-angle(joint axis, angle) (scene.js `_applyAngles`), data delivered by `/api/model` from `params.py` so the JS has no physics constants. Gaze arrow helper along head local +z; gaze target marker; floor ray-picking. **Caveat**: the meshes are the rostack-chan *classic Stack-chan* shell (stackchan_shell.stl), probably NOT the M5 official CoreS3 cube-head StackChan [unverified], so our virtual head would need new meshes (or a simple box with a screen quad).
- **Face texture**: a plane (72% of head width, 4:3) placed 1.5mm in front of the head mesh's max-z, `MeshBasicMaterial` (unlit) with `CanvasTexture` (sRGB) of the 320x240 face canvas, so the screen is exactly the device's pixel buffer and follows pan/tilt. This is a very reusable pattern: if our firmware's LVGL frame can be streamed (or rendered by a JS port of our face spec), the virtual head shows real face output. Their face is a JS re-draw of m5stack-avatar, not ours.
- **Servo model (PD gains, rate limits)**: MuJoCo position actuator = PD, defaults **kp=3.0, kv=0.05** (N*m/rad, N*m*s/rad; model.py, robot.py), joint damping 0.02, armature 0.001, `forcerange = +-stall torque` (SCS0009 2.3 kgf*cm = 0.2256 N*m), and a **command rate limiter** at the no-load speed (SCS0009 0.1 s/60deg = 10.47 rad/s) applied by `ServoController.command` (controller.py): `cmd += clip(goal-cmd, +-max_speed*dt)`. Limits: pan +-150 deg, tilt 5..85 deg. Masses scaled from CAD to the 187.2g official total. Values trace to an internal report not shipped, so **no hardware-measured validation** [unverified]; kp=3 vs 0.225 N*m means a >4 deg error already saturates torque, so behaviour is dominated by the torque clamp, not the PD. The real SCS0009 closes its own position loop inside the servo, so this PD is a plant model, not the firmware's controller; our firmware uses a spring (stiffness/damping, see StackChan-GPT servo.h 170/26) that would need its own port.
- **MuJoCo verdict for 2 axes**: evidence in this repo does NOT justify MuJoCo: the plant is two hinges with a rate limiter and a torque clamp; `ik.py` is closed-form (pan=-atan2(dy,dx), tilt=atan2(dz, horiz)); contacts are disabled. A 30-line second-order model per axis (rate limit + torque-limited PD + damping, optional backlash/latency) in JS/Python gives the same behaviour with no 20MB MuJoCo wheel. Only value of MuJoCo: automatic inertia from the mesh (could be precomputed once).
- **Virtual LED ring**: nothing to reuse (no LED model). Build it as N three.js emissive point meshes or a canvas texture ring around the head base with per-LED RGB from our host's LED command stream.

## 8. README and docs
- README is thorough and well organised (setup via `uv sync`, run commands, API table, directory map, license/credits, explicit clean-room and "unofficial" notices, LLM data-retention warning), Japanese only. Docs of physics provenance: `params.py` keeps section-level citations to an internal report that is gitignored, which hurts reproducibility.
- **AI transparency**: CLAUDE.md, `.claude/skills/*`, `.claude/agents/{params-auditor,contract-checker}`, hooks (block hand-edit of generated `stackchan.xml`, auto-run pytest after src edits) show it is built with Claude Code and is open about it implicitly (no explicit statement in README). Worth copying: generated-file guard hook, contract checker agent, oss-release-audit skill.
- Tests: 35 pytest functions (test_ik 6, test_params 5, test_compat 11, test_web 8, test_ai 5), FastAPI TestClient, **GitHub Actions CI** (`uv sync --frozen`, `uv run pytest -q`, ubuntu). No JS tests, no visual regression.

## 9. Adopt / avoid
Adopt (for a virtual StackChan tester):
1. **contract.py as single protocol source of truth** + message table in the docstring; we would do the same for the host WebSocket JSON schema shared by the real host, the simulator and tests.
2. Face-as-CanvasTexture on a plane at the head front, fed by the same pixel buffer or a JS port of our face spec.
3. Python-side authority, browser as dumb renderer, with `/api/model` serving kinematics derived from one params file.
4. Servo model skeleton: rate-limited command + torque clamp + PD + damping with per-servo profile table (SCS0009 numbers: 0.2256 N*m, 10.47 rad/s, 150 deg pan, 5-85 deg tilt) as the baseline for latency/overshoot tests.
5. Telemetry record/replay/seek + CSV export for regression of motion scripts (record a real run, replay against the sim, diff).
6. Analytic 2-DOF gaze IK and click-to-look floor picking for testing look-at tools.
7. Compat HTTP emulator concept: pretend to be the device so *unmodified* clients (our host, the iOS app) connect; for us this means emulating our WS+Opus device role, plus fault injection (drops, latency, bad frames).
8. Agent guardrails: generated-file block hook, post-edit pytest hook, release audit skill, CI with frozen lockfile.
Avoid:
1. MuJoCo/physics fidelity for a 2-axis head; also assuming PD gains from the report match the real servo without hardware identification.
2. Unauthenticated state-changing GETs/WebSocket with no Origin check, `npx @latest` unpinned MCP servers in repo config, un-bounded gain inputs.
3. Re-uploading the face texture every frame regardless of change, and fake sinusoidal lip-sync; drive mouth from real audio RMS/Opus frames instead.
