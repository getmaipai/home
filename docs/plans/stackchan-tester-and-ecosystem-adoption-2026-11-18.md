# StackChan: virtual tester and ecosystem adoption, implementation plan (2026-11-18)

Status: draft for the owner's go or no-go. Nothing is built.
Sources: [virtual-stackchan-tester-2026-11-18.md](../reports/virtual-stackchan-tester-2026-11-18.md) (why and what), [stackchan-ecosystem-audit-2026-11-18.md](../reports/stackchan-ecosystem-audit-2026-11-18.md) (what the 15 projects teach), and the per-project audits in its attachments folder.

## Read before starting any item

- [docs/design/RULES.md](../design/RULES.md) overrides this plan. Items that touch the turn, safety filter, speech or the robot launch (W5, W9 to W11) need it read first. If an item needs a rule changed, stop and report it.
- Rule 9: no `className` that changes look on a kit Element; restyle by tokens and props. Applies to the Robot health tab (W7) and state pills (W8).
- Which repo each item lands in is my best reading of `AGENTS.md` (hub in `getmaipai/home`, shared shapes in `getmaipai/commons`, the Bot repository holds the firmware and its guide, packages in `getmaipai/catalog`). Confirm the repo before the first commit [verify].
- Backlog rows are not added here. The IDs below are proposals; add them through the usual route. Land with `bash scripts/land.sh --done ITEM-01`.
- Anything touching a safety, auth or credential file gets the sharded backend and frontend tests before landing.

## Goals, in order

1. Close the robot-side security gaps that the audit found in most projects, or prove we have none.
2. Make screen and flow regressions fail in CI instead of costing a USB window.
3. Let a contributor without a robot run the robot's screens, tools and games.
4. Adopt the proven small ideas: frame-time gate, single servo writer, reflex layer, smart end-of-turn, MCP server, health tab, face spec, AI transparency page, safety scan.

Non-goals: chip emulation (QEMU, Wokwi, Renode), MuJoCo physics, copying AGPL or non-commercial material, a second brain or cloud relay.

## Work items

Effort is one experienced developer with AI agents, in days, ranges. "Real unit" means a bench window on the one robot.

### Track 1: Trust and security (start now, no dependencies)

**W1. Robot exposure audit and lint** (S, 1 to 2 days, Bot repo)
- Read the firmware once against the audit's list: unauthenticated camera, mic, Wi-Fi write or config; `CORS *`; missing Origin check on WebSocket upgrade; fixed AP passwords; plain `http` or `ws`; TLS verify off (`ESP_TLS_SKIP_SERVER_CERT_VERIFY`); keys in plaintext NVS or on SD; endpoints that fetch a caller-supplied URL.
- Add a lint script that fails on those patterns, modeled on stackchan-local's `check-firmware-local-only`.
- Acceptance: written findings file (pass or fail per line), lint in `check.sh`, every real finding filed as its own item. Real unit needed only to confirm any finding.

**W2. Repo safety scan in CI** (S, 1 day, Home and Bot)
- Port the idea of Nous-Girl's `safety_scan.py`: secrets, emails, private domains (from a repo secret), LAN IPs, files over a size limit, broken relative links, path-and-line allow-list. Add SHA-pinned actions and a security audit script (stackchan-mcp pattern).
- Acceptance: runs on every pull request, a planted secret fails it, a clean run is quiet.

**W3. SECURITY.md, AI transparency page, PR template** (S, 1 day, Home and Bot)
- `SECURITY.md` with private reporting and an honest threat model; an AI transparency page (what AI helped build it, what data goes where, who is accountable); PR template boxes for hardware impact, safety note and a red-team note on safety changes (Dotty, stackchan-mcp, Nous-Girl).
- Acceptance: pages linked from the README; template shows on a new pull request. Owner must approve the AI statement wording.

**W4. Camera indicator and persistence check** (S, 1 day, Bot and Home)
- Verify that any capture shows on the robot screen while it is taken and that no frame is written to disk by default. Add the indicator if missing (stackchan-mcp shows the frame for 6 seconds).
- Acceptance: test on the software unit (W13) or the real unit; privacy page wording matches behavior.

**W5. Every speech path uses the same child-safety floor** (M, 2 to 3 days, Home, risky surface)
- List every way the robot can speak (greetings, reminders, timers, admin say, tool output, game text, canned touch replies). Prove each goes through the same output gate for the person's band.
- Acceptance: a test that enumerates the paths and fails for any that skip the gate. Needs RULES.md and the safety sharded tests.

### Track 2: The tester (decision gates inside)

**W10. Scenario runner on the fake unit** (M, 3 to 5 days, Home)
- Extend the existing fake unit script into a scenario runner: scripted events in (touch, swipe, shake, pickup, wake, tool calls), expected state out, fake clock.
- Acceptance: five scenarios (a game, a timer, lock and unlock, a face change, a settings page) pass in under a minute, headless.

**W11. Golden-frame checks in CI** (M, 3 to 4 days, Home and Bot)
- Run the real-code renderer from the scenarios, compare PNGs to goldens with a small tolerance, in a pinned Linux container with pinned fonts. Pull request gets a frame-diff report.
- Acceptance: stable across 20 consecutive CI runs; an intentional one-pixel UI change fails with a readable diff.
- Gate G1 after W10 and W11 (see below).

**W12. One schema for messages and tools** (S to M, 2 to 3 days, commons)
- Single schema file for messages, tool names, argument ranges and a `device.info` capability list with limits. CI test compares the firmware tool table, the host and the fake unit against it. Add capability handshake and `commandAck`/`commandStatus` if missing.
- Acceptance: changing a tool in one place without the others fails CI.

**W13. Software unit, desktop (tester phase 2)** (L, 10 to 15 days, Home and Bot)
- Thin shell: same WebSocket and Opus as the real unit, tool calls into the real UI and core code, SDL window or headless PNG, mouse as touch, keyboard for shake and pickup, virtual head (angle plus speed limit, drawn head and neck) and LED ring (dots from color commands), audio from files (computer mic and speaker later), camera from a video or still.
- Acceptance: a contributor with no robot runs the shell and the host, plays a game by mouse, sees the head and ring react; the same scenarios from W10 run against it.
- Gate G2 before starting (see below).

**W14. Contributor guide and polish** (M, 8 to 12 days, Home)
- Computer mic and speaker, docs, "sim-verified vs needs hardware" labels on checks, frame-diff report polish.

**W15. Browser build (tester phase 3, optional)** (M, 6 to 12 days)
- Only after a one-day spike proves the C++ build under Emscripten works. Hosted demo on the docs site.
- Gate G3.

### Track 3: Product and docs

**W6. README and docs refresh** (S to M, 2 to 3 days)
- Real renderer captures of every screen (child and adult, light and dark) in the README and robot guide; a "what runs where" table; a robot section near the top; a face gallery grid of states generated by our own renderer.
- Depends on the renderer only; no new feature.

**W7. Robot health tab** (M, 3 to 4 days, Home admin)
- Per sensor: available, with a reason; top KPI strip (online, FPS, battery, Wi-Fi, drops, free RAM); I2C scan; raw JSON toggle; per-stage voice latency. Reference: stackchan-local console, ai-server `[LAT]`.
- Rule 9 applies. Needs the robot to report these fields (small firmware change).

**W8. Face and emote spec** (M, 3 to 5 days, commons and Bot)
- Named states, overlay icons, per-frame timing, labeled preview sheet generated by the renderer, community face guide with a validator, CC0 starter faces. Reference: Nous-Girl `EMOTES.md`, stackchan_alive persona packs.
- State pills in robot settings that match LED ring colors, with a live face preview (Dotty).

**W9. MCP server and OpenAPI for the host** (M to L, 5 to 8 days, Home)
- FastMCP-style server, stdio then loopback HTTP, fail closed without a token, constant-time compare. Short namespaced tools (`robot_say`, `robot_see`, `robot_face`, `robot_move`, `robot_status`, `robot_health`, `robot_playback_status`, `robot_privacy_mode`), docstrings with "use when / do not use for" and what to say after, valid choices in errors, "unconfirmed" wording, results capped for speech. No tool bypasses the age and surface gates. Publish an OpenAPI 3.1 file.
- README lists MCP as Planned; this delivers it. Needs RULES.md and security review.

### Track 4: Engine and firmware (bench windows needed)

**W16. Frame-time gate** (M, 3 to 4 days plus 2 windows) record face frame period on the real unit as a release gate; reject features that break it. Add a test mode that measures it. Reference: stackchan_alive's 50 ms rule.

**W17. Single servo writer and manual lock** (M, 2 to 4 days plus 1 window) only the motion task writes actuators; explicit commands lock out autonomous tracking; mute IMU while speaking with a cooldown. Reference: alive, xiaozhi fork, claude-bridge.

**W18. Reflex layer** (S, 2 days, Home) on every robot reconnect, re-push face set, volume, brightness, torque release and LED state; speech watchdog; touch cooldown; idle micro-motion limits for servo wear. Reference: cloud-mcp `reflex.py`.

**W19. Smart end-of-turn and ASR pre-roll** (M, 3 to 5 days, Home) Pipecat smart-turn v3.2 after short VAD silence with fallback on error; at least 1.2 s pre-roll; per-profile ASR language. Measure first spoken word before and after. Needs RULES.md.

**W20. Release hygiene** (M, 3 to 5 days) split flash artifacts (full, app keeps Wi-Fi, assets), SHA256SUMS, known-bad versions, coredump partition, a soak test report as release evidence.

**W21. Wake-word cost check** (S, 1 window plus 1 day) measure face frame time with our wake word running; decide whether to keep, tune or switch (microWakeWord, WakeNet plus MultiNet). Wake-word invariants in HANDSFREE-01 do not change.

## Gates

- **G0 (now):** owner says go on Track 1 and the scenario runner. Cost: about 8 to 12 days total.
- **G1 (after W10 and W11):** go to W13 only if golden frames pass 20 CI runs and at least a third of the last month's bench windows were visual, flow or game checks (log the next two weeks of windows to get this number).
- **G2 (before W13):** confirm the unit shell calls real firmware code, not a reimplementation.
- **G3 (before W15):** one-day Emscripten spike passes; the docs site wants it.
- **No-go signals:** frame flake above about 2 percent after fixes; the shell needs duplicate logic; bench windows are mostly audio, radio and soak.

## Order and calendar (one developer, working days)

| Week | Work | Result |
|---|---|---|
| 1 | W1, W2, W3, W4; start W10 | Security findings, scan in CI, policy pages |
| 2 | W10, W11, W5 | Scenarios and golden frames in CI |
| 3 | W12, W6, start W18 | One schema; README with real screens; reflex layer |
| 4 | G1 decision, W7, W8 | Health tab, face spec; go or stop on the software unit |
| 5 to 7 | W13 (if go) | Desktop software unit |
| 8 to 9 | W14, W9 | Contributor guide, MCP server |
| 10 to 12 | W16 to W21 as bench windows open | Firmware gates, hygiene, turn latency |

Total: about 12 weeks with the software unit and Track 4, or about 4 weeks for Tracks 1 to 3 without the unit. W15 adds 1 to 2 weeks if wanted.

## Bench windows (shared real unit)

Needed: W1 (confirm findings), W4, W16, W17, W20, W21, and a final check of W13's visual match, about 8 to 10 windows over the 12 weeks. Everything else runs without the robot. Log window time before and after W11 and W13 to measure savings.

## Risks

- Golden frames flake on fonts or timing. Mitigation: pinned container and fake clock; tolerance in the config.
- Shell drifts from firmware. Mitigation: W12 schema test, real code only.
- Contributors trust the sim over the unit. Mitigation: visible "needs hardware" labels.
- Security work finds an urgent hole. Mitigation: fix before any feature work; do not ship until closed.
- Scope creep into MCP exposure of camera and mic. Mitigation: privacy mode tool, per-tool audit log, confirmation on camera and say from remote agents; owner approves before release.
- Licensing slip. Mitigation: copy ideas, not code, from AGPL and non-commercial sources; keep upstream notices on MIT and Apache code.

## Open questions for the owner

1. Go on Track 1 and W10 now?
2. Where should the new backlog rows live and what IDs do you want?
3. Is the AI transparency wording yours to approve, and should the public repo carry it?
4. Do you want the MCP server before or after the software unit?
5. Is a second real unit worth a small hardware-in-the-loop rig if bench windows still queue after W13?
