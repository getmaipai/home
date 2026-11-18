# StackChan master plan: finish the vision, beat the field, build it in parallel (2026-11-18)

Status: draft for the owner. Nothing in this plan is built. It replaces [stackchan-tester-and-ecosystem-adoption-2026-11-18.md](stackchan-tester-and-ecosystem-adoption-2026-11-18.md) as the plan of record; the tester work is Lane F here.

Rule changes proposed here (sections 5 and 6) are proposals only. Only the owner changes a rule (`docs/design/RULES.md`).

## 0. Inputs and what is still unknown

Read for this plan:

| Input | Where |
|---|---|
| Our robot code and docs: `getmaipai/bot` at firmware 0.2.213 (2026-11-17) | [round2/bot-state.md](../reports/stackchan-ecosystem-audit-attachments/round2/bot-state.md) |
| Home's robot code, rules, admin page, open backlog rows | [round2/home-robot.md](../reports/stackchan-ecosystem-audit-attachments/round2/home-robot.md) |
| Visual audit of 15 projects: on-robot faces and screens, dashboards rendered to 90 screenshots | [round2/ui-audit.md](../reports/stackchan-ecosystem-audit-attachments/round2/ui-audit.md), [round2/shots/](../reports/stackchan-ecosystem-audit-attachments/round2/shots/) |
| Which features 15 projects ship on, off, or built then disabled | [round2/defaults-audit.md](../reports/stackchan-ecosystem-audit-attachments/round2/defaults-audit.md) |
| First-round audits (security, wake word, memory tricks, licenses) | [stackchan-ecosystem-audit-2026-11-18.md](../reports/stackchan-ecosystem-audit-2026-11-18.md) |
| Org standards: products table, eight principles | `getmaipai/.github` `AGENTS.md`, `docs/PLATFORM.md` |
| Robot API draft and HAL seam | `bot/docs/dev/design-robot-api-2026-10-14.md`, `bot/docs/dev/hal-seam.md` |

Not available, and what it blocks:

1. **The work session's handover.** The "STACKCHAN - WORK" session on the Mac Studio received the pause request at about 01:50 UTC. At last read it was still running the movement limiter and music dance v2 memory test and had not written the handover. Everything after firmware 0.2.213 (the limiter ML01, dance v2, anything in the local `getmaipai/stackchan` checkout, the "wave 0" own-repo work, `docs/design/unit-protocol.md`, ESP-IDF 6.1.1) is known to me only from that session's messages. Wave 0 below starts by reading that handover and correcting this plan.
2. **`getmaipai/stackchan` on GitHub holds only an issue form.** The bot repo pins ESP-IDF 5.5.4 and says 6.x does not build the M5 tree; the brief for this work said ESP-IDF 6.1 and about 250 patches. The bot repo shows 128 applied patches. One of these is stale. Wave 0 settles which tree is the truth.
3. Nothing was run. Competitor behavior is read from code and stills. Our own unit numbers come from our docs.
4. A "repo boundaries" design (commit df13ef9) named in a session title was not found in the clones.

## 1. Where we stand

### 1.1 Built and working on the unit (keep, polish, document)

Voice turns through Home with age gates; "Hi, StackChan" wake word and tap; 17 drawn faces in 7 palettes plus a night face; head commands and gates; ring standard (green live, pink camera, cyan pairing, amber attention, blue listening, never red); camera photo and stream; anonymous person and face following; touch, pet, shake and tilt reactions; battery; sleep routines; dance, dance to music, song naming; announcements; repeat and "what did I miss"; mute, vision off and full quiet by tapping the mouth, an eye or the forehead; offline phrases; self-healing; signed releases and wireless update; quick settings (volume, brightness, saved Wi-Fi).

### 1.2 Promised and not delivered

| # | Feature from the original vision | State | Why | Plan item |
|---|---|---|---|---|
| 1 | Speaker identity by voice | Not built (seam only) | Home's STT stream returns no speaker evidence | C7 |
| 2 | Face recognition that greets by name | Partly | Match and false-accept rates never measured | C8 |
| 3 | Look at the speaker | Code exists, not wired in `app.py` | Sound direction rejected: mics are stacked vertically | C3 |
| 4 | Silent ambient vision | Code exists, not wired; a different path (`vision_post`) shipped | Superseded | D-decision 4 |
| 5 | Whisper night | Not built | Never started | C6 |
| 6 | Display router: hub pictures, weather card, camera snapshot, alerts | Not built | JPEG decoder was stripped from firmware (patch 099) to save RAM and flash | B9, D-decision 2 |
| 7 | Games (Simon, rock paper scissors), bedtime stories | Not built | Later candidates | E1, E2 |
| 8 | Home Assistant from the robot, sentry mode, mmWave presence | Not built | Later candidates | E4, E5 (sentry deferred) |
| 9 | Medicine reminders (MEDS-01) | Not built | Open row | E3 |
| 10 | QR setup screen, touchscreen Wi-Fi entry, strict Wi-Fi priority, setup window | Not built (patches 134 to 139 never written) | Open rows ANYWHERE-02, -03, -06 | B7 |
| 11 | Pick-up detection, sleep-Z animation, heart symbol tool | Not built; host calls 5 tools that no patch defines | Drift between host and firmware | A2, B3 |
| 12 | Pairing as a family step | Partly: still a developer step | | B7, G2 |
| 13 | `wss://` to the unit | Build flag only; link is plain `ws://` today | RAM cost unmeasured | S2 |
| 14 | Egress proof by packet capture, idle-camera watch | Tooling only, never recorded | | S6 |
| 15 | Away from home on the tailnet | Partly; internal RAM gate "plausible but thin" | 42 to 52 KB of stacks | D-decision 3 |
| 16 | Bot management in Home (ANYWHERE-07), self test (BOT-SELF-TEST-01) | Partly | | G1, G3 |
| 17 | Self-charge, "onboard AI" (README tagline) | Not true for this body | Tagline is for the MaiPai build | H1 |

### 1.3 Cut or reverted, with the reason

- Strip patches 095 to 099 removed the CJK font and emoji, vendor apps (including servo calibration), Bluetooth, 4G boards and the JPEG decoder: 635,504 bytes of app and 43,292 bytes of static internal RAM saved.
- Parked: drop-down control panel (045), sound direction (082).
- Reverted for stability: PSRAM stacks on flash-writing tasks, Wi-Fi buffers in PSRAM, Opus complexity 3.
- Dropped on the owner's word: own firmware and protocol (kept as a long-term option), NVS encryption, most ring rows, three-tap dance, routine chimes.

### 1.4 The budget every design below must fit

| Resource | Total | Free today | Verdict |
|---|---|---|---|
| Internal RAM | about 320 KB usable | about 76 KB free, low-water 53 KB, largest block 55 KB | **The constraint.** Every item states its internal RAM cost and is measured before it lands. |
| PSRAM | 8 MB | about 7.1 MB | Plenty. Put art, caches, buffers and LVGL pools here. |
| App slot | 5,177,344 bytes | about 34 percent with the tailnet client | Room for code. |
| Assets partition | 6,225,920 bytes | about 3.6 MB | Room for face packs and sounds. |

Rule for this plan (proposed gate, see A4): internal low-water at least 25 KB for 10 minutes with voice, camera and link running, and face frame period within budget, or the feature does not ship.

### 1.5 Drift to fix first

- Bot pins spec v0.1.208; Home pins v0.1.422. Home pins Bot release 0.2.104; firmware is 0.2.213 (BOT-PIN-01).
- `CHANGELOG.md` stops at 0.2.106; about 107 firmware versions are undocumented.
- No schema for the unit wire: 51 tool names are string literals in Python and in C++ patches; five have no firmware definition.
- Home lacks the keys the bot asked for: `robot.muted`, `robot.vision_off`, `robot.quiet`, `mute.local_unmute`.
- A robot card with mute, live view and motor reboot exists in Home but is mounted nowhere.
- Docs: README says "not yet verified on real hardware"; setup guide describes removed screens; no screenshots anywhere.

## 2. What the field has that we lack

Ratings and evidence are in the round 2 files. "Adopt" means build our own version; code is copied only where the license allows (section 4, decision 8).

### 2.1 On the robot screen

| Idea | Best example | We have | Decision |
|---|---|---|---|
| Staged, eased transitions (eyes, then brows, then mouth), blink overshoot, saccade settle | stackchan_alive | Blink, idle drift; changes cut between faces | **Adopt** (B1). Biggest quality jump for the least memory. |
| Emote vocabulary with timing sheet and fallback table for unknown emotions | Nous-Girl (12 emotes, 28-name fallback) | 19 logical names, 2 fall back | **Adopt** (B2): one vocabulary in the spec, fold table per body. |
| Overlays separate from the base face: tears, hearts, blush, sweat, zzz, "!", "?", think bubble, sparkle | xiaozhi fork (13 overlays) | Hearts and dizzy decorators upstream; music notes | **Adopt** (B3). Also closes the missing `show_symbol` and `sleep_z` tools. |
| Lip sync by mouth shapes from audio level and vowels, each held at least 70 ms | Nous-Girl (8 shapes), pet-fw (4 levels) | Upstream mouth animation | **Adopt** level-driven first (B4); vowels only if it fits. |
| Faces for system states: muted, offline, error, low battery, updating, thermal | Nobody does all of them | Muted, vision off, quiet, offline, connecting, approval, updating | **Lead**: add low battery, hot, error with plain words (B5). |
| Reflex faces for pick-up, shake, put down, tilt | alive, pet-fw (dizzy, 16-direction lean) | Shake, tilt, upside down; no pick-up | **Adopt** pick-up and put-down (B6), tied to the movement limiter's "carried" state. |
| First-run flow on the robot: welcome, safety note, QR, pairing | StackChan-GPT | Link screens with text | **Adopt** (B7): welcome, "put me on a flat surface", QR to the setup page, approval. |
| Wi-Fi: QR on the robot, several saved networks in priority order | pet-fw, xiaozhi portal | Saved list, captive page | **Adopt** (B7). Audio provisioning: reject for now. |
| On-robot settings app | Nous-Girl (14 tiles) | Quick settings: volume, brightness, Wi-Fi | **Adapt** (B8): a second quick-settings page (mute, vision, quiet, night, idle motion, info). No child-reachable setting that weakens controls. |
| Subtitles in step with speech, 2-line box with paging | pet-fw, openapi | Song title bar only | **Adopt** as an accessibility setting, default off (B10). |
| Attention card: "Home needs you" with dismiss | xiaozhi fork | Timer card; amber ring | **Adopt** (B11) for approvals, reminders, medicine. |
| Camera frame shown on the robot when it looks | stackchan-mcp | Pink ring only | **Adapt** (B12): shutter mark and pink ring always; the frame itself needs the JPEG decision. |
| Action-confirmation and scene sprites (mail sent, meds, meal, bath) | Nous-Girl, cloud-mcp | None | **Adopt** a small icon set as overlays (B3). |
| Auto-hiding status bar: clock, Wi-Fi, battery on wake | xiaozhi fork, GPT | Status bar kept from upstream | **Adopt** (B13). |
| Persona or face packs as data with a validator and preview | alive (YAML), Nous-Girl (GIF packs) | 7 palettes | **Adopt** drawn packs (B14); illustrated packs are decision 1. |
| LED ring as a protected instrument panel: state on one half, fixed pixels for listening, camera, child controls | Dotty | Ring standard, whole-ring states | **Adapt** (B15): keep our standard, add reserved pixels that no tool can paint. |
| Music visualizer, equalizer face, beat lights with flash limits | Nous-Girl | Music notes, beat sway | **Adopt** the flash-rate cap (max 3 pulses per second, no red); visualizer later. |
| Launcher carousel with apps | StackChan-GPT | None | **Reject**: the face is the product. Games open by voice or from quick settings. |
| Illustrated anime character faces | pet-fw, mcp, Nous-Girl | None | Decision 1. |

### 2.2 Pages people use to manage the robot

| Idea | Best example | We have (Home, Settings, Devices) | Decision |
|---|---|---|---|
| One phone-width robot page: state buttons in the ring's colors, controls that change with state | Dotty (4.5 of 5) | Three tabs: overview, behaviour, access | **Adopt** as a "Now" card at the top of the robot page (G1). |
| "Sees / hears / said" with ages | Dotty | Not shown | **Adapt** (G4): status words and ages only. Rule 6a forbids person text on admin pages; show it only to the person themselves or behind the existing transcript access rules. |
| Memory review with Approve and Redact; a child's statements held | Dotty | Home has memory controls, not per robot | **Adopt** on the existing memory page with a robot filter (G5). |
| Live face mirror on the page | alive | None | **Adopt** (G6) using our real-code renderer. Nobody else shows true pixels. |
| Motion: Stop, tick "upright and clear", Resume; unknown shown as unknown | alive | Dance and test buttons | **Adopt** (G7), reading the movement limiter's status. |
| Health in plain words: per part, last error, what to do | stackchan-local (bench), nobody for families | Check-in collects heap, PSRAM, boot reason, crash resets; page shows none | **Adopt** (G3): family view plus an advanced bench view. |
| Setup wizard with numbered steps and "applied live / restart needed" | ai-server, Nous-Girl | Add a StackChan flow; open rows STACKCHAN-ADD-FLOW-01 and others | **Finish** our flow (G2). |
| Microphone check: 3 s of room noise, test phrase, shows what was heard | StackChan_Minimal | None | **Adopt** (G8) plus a wake-word "say it now" meter, which nobody has. |
| LED table a person can edit | Nous-Girl | Fixed standard | **Reject** for safety colors; allow palette and mood colors only. |
| Persona, voice and skin cards | Nous-Girl, alive | Companion and voice pickers | Have it. Add face pack picker (G9). |
| Per-device profiles | ai-server | Per-robot settings | Have it. |
| Phone app: face mirroring, dance recorder | StackChan-GPT | None | Later; dance teach exists in the Bot for Reachy (`moves/teach.py`). |
| Content-filter hits, event feed | Dotty | Turn logs elsewhere | **Adopt** counts only (rule 6a) on the robot page (G4). |
| Multi-robot view, phone sign-in | Nobody | Home has both | **Lead**; say so in the README. |

### 2.3 Features

| Feature | Field | Ours | Decision |
|---|---|---|---|
| Kid controls enforced in code | Dotty only | Yes, by band | Lead. Add quiet hours, bedtime, per-band volume cap (C9): nobody has them. |
| Smart-home control by voice | ai-server | Home has Home Assistant | Wire the robot surface to Home's existing tools (E4). |
| Games and stories | Nous-Girl fun pack | None | Build as catalog packages (E1, E2). |
| MCP control of the robot | stackchan-mcp | Planned | Build on Home's CREATOR-32 (E6), not a separate server. |
| Internet radio, DJ mode, meme maker, email | Nous-Girl | Home has music and radio | Play Home's library on the robot (E7); skip memes and email. |
| Background tasks announced when idle | ai-server, claude-bridge | Announcements | Use the attention card (B11). |
| Smart end of turn | Nous-Girl | Home has it behind a setting | Measure on the robot (C1). |
| Custom wake phrase | Nous-Girl | No | Decision 5. |
| Hardware console per chip | stackchan-local | Bench tools | Advanced health view (G3). |
| Simulator | stackchan-simulator (physics only) | Real-code renderer | Lane F. |

## 3. Defaults: what the field leaves on and off, and our changes

Full matrix: round2/defaults-audit.md.

| Setting | Field consensus | Ours today | Change |
|---|---|---|---|
| Wake word | One prebuilt word on | On, no sensitivity setting | Add Low, Normal, High (C2) |
| Voice barge-in | Off or removed: no echo cancel on this board | Unproven | Off. Tap or swipe always stops. Document it. |
| Follow-up listening window | About 15 s; silence does not renew | Per-robot setting exists | Check the default and that noise does not renew it (C1) |
| Face tracking | Off by default in 5 of 7 | `look_faces` was on on the live unit | Default to "turn once to the speaker at wake"; continuous following opt-in (C3) |
| Sound-direction turn | Off or removed | Parked | Stay parked |
| Idle head motion | On but bounded, with levels | `idle_movement` off on the live unit | Offer None, Little, Medium; default Little; torque release after moves (C4) |
| Auto dance to music | Rare | Off | Keep off. The owner's unit danced to ambient music with it unset; the limiter fixes the rest |
| Proactive speech | Off, or daytime, known people, daily cap | Announcements on | Add quiet hours and a daily cap (C9) |
| Face recognition | On by default nowhere | Partly built | Opt-in only (C8) |
| Camera | On request, indicator | Scene posting by `robot.vision` level | Keep; default watch level stays the lowest that works |
| History and memory | Off until opt-in in most | Home's memory rules | Keep Home's rules |
| LED brightness | Capped near 40 percent, idle dark | Idle dark, channel max 168 | Keep; no LED traffic during speech (A5 measures) |
| Dim and sleep | Dim on battery only; never sleep the wake word on USB | Rest stages | Verify the wake word survives every rest stage (C5) |
| Model-callable reboot, update, server switch | Removed after incidents | Auto-update on | Verify no model-reachable tool can update, reboot or re-point the unit (S5) |
| Kid mode | Dotty on by default | Robot with no companion answers with child controls | Keep |

What breaks most in the field (of 15 repos): servo noise and wear 10, choppy audio 8, false wake 7, no echo cancel 6, internal RAM resets 6. This is why Lane A (limiter, single writer, gates) goes first.

## 4. Design decisions and conflicts

Each needs the owner's yes or no. My recommendation is first.

1. **Illustrated character faces, or drawn faces only?** Recommend: drawn faces stay the default and get the motion work (B1 to B4). Add an optional illustrated pack format later (B14b) using a mouth-patch over a still (Nous-Girl method), stored in PSRAM and the assets partition, with a hard cap per pack and the emergency fallback to the drawn face (pet-fw pattern). Reason: the art is what draws people to pet-fw and Nous-Girl, but it costs flash, needs an image decoder, and licensed art is a legal risk.
2. **JPEG decoder back in firmware?** The hub-pictures display (vision item 27), the camera frame preview (B12) and illustrated packs all need an image path. Recommend: do not restore JPEG. Send small raw RGB565 or run-length tiles from the host over the existing avatar channel into a PSRAM buffer (the host has the CPU), capped at 320x240. Measure internal RAM before and after; ship only if the 25 KB gate holds.
3. **Tailnet client on the unit.** It is the one feature known not to fit comfortably. Recommend: keep it a separate build until the gate is measured on the unit; do not let any Lane B feature spend the margin it needs. If both cannot fit, the trip relay stays the away answer.
4. **Ambient vision.** Two paths exist (unwired `ambient_vision.py`, shipped `vision_post.py`). Recommend: delete the unwired one after confirming nothing is lost (principle 1, one implementation).
5. **Custom wake phrase.** WakeNet plus MultiNet costs a core while idle and made audio choppy for Nous-Girl; our stop word already uses MultiNet. Recommend: no custom phrase now. Add sensitivity levels, and evaluate microWakeWord in a bench spike (A6) because alive measured WakeNet at 85 to 102 ms per frame on similar hardware and we have never measured ours.
6. **`robot_see` over MCP conflicts with vision rules R1 to R4** (a picture is dropped; no route returns it). Recommend: MCP exposes "describe what you see" (the scene words Home already keeps for 90 s), never the picture. No rule change.
7. **"Sees / hears / said" on an admin page conflicts with rule 6a** (no person text on admin pages). Recommend: admin page shows states, counts and ages; the words appear only where transcript access already allows.
8. **Licenses.** Home and Bot are AGPL-3.0, so MIT, Apache-2.0, BSD and AGPL code can be used with notices. Still not usable: Nous-Girl tribute faces and Phonon voice (non-commercial), pet-fw's Tsukuyomi-chan binaries, and anything without a license (M5Stack repo root: verify `firmware/LICENSE` before copying). Org principle 8 still says rebuild, never carry: copy logic, not files, and record a one-line verdict.
9. **Own firmware versus patches.** The patch series is 128 files and about 1 MB of patch text against two moving upstreams. The own-firmware note calls a rewrite "the better design on merit"; the owner chose patches. The work session started an own repo ("wave 0", `unit-protocol.md`). Recommend: decide after the handover. Nothing in Lanes A to H depends on the answer except where each firmware item lands; Lane A2 (one wire schema) makes a later move cheap.
10. **Reachy Mini arrives soon.** Every new concept in this plan is defined in the shared robot interface first (section 6) and implemented per body. No item may add a StackChan-only name above the seam.

## 5. Proposed boundary rule (replaces the scattered notes)

Today the line between robot and Home lives in design notes; the only hard boundary rule (E1 to E8) covers Catalog, Stack and Home. The field shows three things our notes do not cover: people expect the robot to be useful with no hub (Minimal, pet-fw, GPT standalone modes; our own issue form already offers "works on the bot alone, like a game"); every project grows a management page next to the robot; and unit firmware needs its own release rhythm.

Proposed text for `RULES.md` (owner approval needed), as rule group "Robot boundary" R-B1 to R-B8:

- **R-B1. Five owners.** `commons/spec` owns every shape and vocabulary a robot and Home share (robot parts, verbs, capability ids, emotions, motion limits, wire frames, settings keys). The **body** (unit firmware plus its profile in `bot`) owns sensing, acting, its screens, sounds and safety limits that must hold with no network. The **Bot service** owns the vendor-neutral robot object, the expression engine, behaviors and the offline ladder. **Home** owns people, age and surface gates, memory, the turn, settings, wording and the one place the family manages a robot. The **Catalog** owns everything installable: face packs, sound packs, games, stories, wake words, voices.
- **R-B2. Safety lives lowest.** Anything that protects a person or the hardware (movement limits, servo stall and thermal cutoff, e-stop, volume cap, camera and microphone indicators, hard mute) is enforced on the unit, works with no host, and cannot be turned off by a tool, a model or a setting. Policy that depends on who is present (age band, quiet hours) is Home's and is pushed down as numbers the unit enforces.
- **R-B3. The model never reaches hardware directly.** A turn produces cues and tool calls from the shared vocabulary; the Bot service turns them into body calls; the movement governor (section 6) and the indicators have the last word.
- **R-B4. Home never learns a vendor name; a body never learns a person.** Unchanged from today, stated as a rule. The unit receives a band and limits, never a name, birthday or memory.
- **R-B5. One management place per mode.** With Home, the family manages a robot in Home and nowhere else. Without Home, the Bot service serves a small local settings page (connections, voice, robot basics) built from the same spec keys. The unit keeps only what must work when nothing else does: Wi-Fi setup, volume, brightness, mute, vision off, quiet, info, and installed games or clips. No second definition of any setting: every setting is a spec key whichever page writes it.
- **R-B6. Four ways to run, one robot (revised 2026-11-18, section 12).** (a) Unit alone: faces, reactions, time, held timers, installed clips and games; it says plainly that it cannot talk. (b) Bot service with Home Assistant: voice commands and camera snapshots through Home Assistant's own pipeline, no AI model. (c) Bot service with a brain the person chooses (a local model by default; a cloud model only by explicit opt-in with an indicator) and with agent tools for Claude, Codex and others. (d) Bot service with Home: Home runs the turn, memory and age gates and proxies the agent tools. The unit firmware, movement governor and indicators are identical in all four. Modes (b) and (c) have no age gates: they are labeled for adults, and a robot set up for a child or teen requires Home.
- **R-B7. Features are packages.** A new robot feature that is not sensing, acting or safety ships as a catalog package with its assets, runs through the same gates on robot and hub, and declares the capabilities it needs. Firmware changes only when a package needs a new capability.
- **R-B8. Spec first, every body.** A new capability is added to the spec, then to the fake body, then to each real body or declared `NotSupported`. No capability is named after a robot.

What this changes from today's notes: it makes alone mode and the on-unit quick settings legitimate (the notes said the hub is "the one place"); it makes the movement governor and indicators unit-enforced by rule; it moves face packs, games and sounds to the Catalog instead of firmware patches; and it gives a `stackchan` firmware repo a clear charter if the owner approves one (principle 5: a repo only for a different release cadence, committer audience or visibility; unit firmware has all three).

## 6. Shared robot interface: additions (spec first, Reachy Mini ready)

The robot API draft already has parts, leases, e-stop, clamped motion, capabilities, battery, health. It lacks the things this plan and the field need. Add to `commons/spec` and `bot/body/maipai_body/hal`, with the fake body and both profiles:

1. **Movement governor** (the owner's idea, 2026-11-18). One chokepoint every motion request passes, on every body.
   - Inputs, all optional per body: `carried` (picked up or moving), `orientation` (upright, tilted, side, inverted, unknown, with tilt degrees), `power` (battery, external), `battery_band` (ok, low, critical), `thermal_band`, `stall`, `quiet_hours`, `speaking`, `person_close` (proximity), `estop`.
   - Output: `motion.scale` (0.0 to 1.0), `motion.max_speed`, `motion.allowed_classes` (for example gaze, gesture, dance, locomotion), and `motion.reasons[]`. The most restrictive input wins. Hysteresis and stale-data rules are part of the spec.
   - Every motion call returns the applied value and, when reduced or refused, a typed reason (`MotionLimited`, not a silent clamp). Refusals are counted.
   - Status is one read (`robot.motion.status`) shown in Home and on the unit's info page.
   - Body mapping: StackChan uses IMU gravity, pick-up, USB and battery (ML01, in flight). Reachy Mini maps carried and tilt from its IMU, power from its base, and adds antennas as a motion class. A wheeled body adds `locomotion` and `person_close`.
   - Policy numbers are data in the profile (one place), with Home able to lower, never raise, them.
2. **Motion classes and single writer.** Each request names its class and source (turn, expression, behavior, teaching, person). One writer per actuator group; the lease decides who.
3. **Privacy states** as shared verbs: `mic.mute`, `camera.off`, `quiet` with verified read-back, and indicator guarantees (which light or mark proves each).
4. **Indicator contract.** Named indicator roles (live, camera, pairing, attention, listening, child-controls) that a body maps to a ring pixel, a face mark or an antenna pose, and that no tool can overwrite.
5. **Expression vocabulary.** One emotion list, one overlay and icon list, one system-state list (muted, offline, connecting, waiting for approval, updating, low battery, hot, error), with a per-body fold table. A body with no screen folds to light or pose.
6. **Reflex events.** `picked_up`, `put_down`, `shaken`, `tilted`, `petted`, `tapped(zone)`, `loud_noise`, with debounce rules.
7. **Attention.** `attention.raise(kind, label)` and `attention.dismiss`, rendered per body.
8. **Health and diagnostics.** Per-part status with code and plain sentence (already drafted in 4b), plus frame period, internal memory low-water, link quality, last restart reason.
9. **Unit wire schema.** For bodies with a remote unit: every tool name, argument, range and event in one generated file used by firmware, host and fake.
10. **Media.** `display.show(kind, payload)` with declared limits; `subtitle.cue`.

Acceptance for the group: the fake body and the Reachy Mini profile pass the same contract tests as StackChan for 1 to 8; an absent capability raises `NotSupported`; no test above the seam names a body.

## 7. Work items

Sizes: S 1 to 2 days, M 3 to 5, L 6 to 10 (one developer with agents). "Where": FW firmware, BOT bot service, SPEC commons, HOME, CAT catalog. "Bench" marks items that need the real unit. Each item states its internal RAM budget before it starts and measures it after.

### Wave 0: truth and unblock (2 to 3 days, one coordinator)

| ID | Item | Where | Size | Acceptance |
|---|---|---|---|---|
| Z1 | Read the handover; correct sections 0 and 1; decide decision 9 with the owner | all | S | This plan updated; one firmware tree named as truth |
| Z2 | Land or park the in-flight limiter and dance v2 on a pushed branch | FW, BOT | S | Branch pushed; unit left on a known image |
| Z3 | Pin sync: Bot to current spec; Home to current Bot release (BOT-PIN-01) | BOT, HOME | M | Both gates green on the new pins |
| Z4 | Changelog and backlog catch-up: 0.2.107 to 0.2.213, one line each; open rows for section 1.2 | BOT | S | Changelog current; rows exist with IDs |
| Z5 | Owner decisions 1 to 10 and the boundary rule | owner | S | Recorded in the design note |

### Lane A: safety, schema and gates (starts first; everything else builds on it)

| ID | Item | Where | Size | Bench | Acceptance |
|---|---|---|---|---|---|
| A1 | Movement governor in the spec, fake body and HAL (section 6.1, 6.2) | SPEC, BOT | M | no | Contract tests pass on fake, StackChan and Reachy Mini profiles |
| A1b | ML01 on the unit conforms to A1: carried, orientation bands, USB, battery ladder, refusal counter, status | FW, BOT | M | yes | Table of 20, 40, 60, 90, 180 degree poses and power states matches the spec; no motion while carried |
| A2 | Unit wire schema: generate tool tables for firmware and host from one file; close the 5 undefined tools | SPEC, FW, BOT | M | no | Changing a tool in one place fails the build elsewhere |
| A3 | Single servo writer; manual lock for explicit commands; IMU and mic gating around servo moves | FW, BOT | M | yes | Only the motion task writes; shake does not fire during speech or motion |
| A4 | Release gates: face frame period, internal low-water 25 KB for 10 minutes, largest block 16 KB, audio underruns, measured by a bench script | FW, BOT | M | yes | Script prints pass or fail; numbers recorded per release |
| A5 | Measure today's unit against A4 with wake word, stop word, camera, ring traffic during speech | FW | S | yes | Baseline table in `stackchan-unit-measurements.md` |
| A6 | Wake word spike: sensitivity levels; microWakeWord trial against WakeNet on frame time and false wakes | FW | M | yes | Written comparison; a decision |

### Lane S: security (parallel with A)

| ID | Item | Where | Size | Bench | Acceptance |
|---|---|---|---|---|---|
| S1 | Firmware exposure lint: no unauthenticated endpoints, no `CORS *`, no token in a query string (fix the photo route), no fixed AP password | FW, BOT | S | no | Lint in the gate; photo route takes a header |
| S2 | `wss://` to the unit with the private CA: measure RAM, ship if the gate holds | FW, BOT | M | yes | Link encrypted by default or a written measurement saying why not |
| S3 | Update signature verified on the unit (today SHA-256 only) | FW | M | yes | A tampered image is refused on the unit |
| S4 | Setup hotspot: WPA2 or WPA3 with a per-unit code shown on the screen and QR | FW | M | yes | No open hotspot |
| S5 | Tool audit: nothing the model can call can update, reboot, re-point or unmute the unit | BOT, FW | S | no | Test enumerates tools by class |
| S6 | Egress proof recorded: packet capture on the unit, idle-camera watch | BOT | S | yes | Capture and result in the repo |
| S7 | On-unit child lock for quick settings that weaken controls; band pushed to the unit as numbers (volume cap, quiet hours) | SPEC, FW, HOME | M | yes | A child band cannot raise volume past the cap or leave quiet from the unit |
| S8 | Safety scan CI, SHA-pinned actions, SECURITY.md pointer, PR template | BOT, HOME | S | no | A planted secret fails CI |
| S9 | Every robot speech path uses Home's output gate (announcements, timers, canned lines, games) | HOME, BOT | M | no | Test enumerates paths |
| S10 | Secure boot and flash encryption: written decision with a recovery story | FW | S | no | Decision note; no build change without the owner |

### Lane B: on-robot UI (the largest lane; split across 3 to 4 agents)

All drawing work is done in the desktop renderer first, reviewed as images, then measured on the unit.

| ID | Item | Where | Size | Bench | RAM plan | Acceptance |
|---|---|---|---|---|---|---|
| B1 | Motion pass: eased, staged transitions between any two faces; blink overshoot; saccade settle; breathing; reduced-motion setting | FW | M | yes | No new buffers; math only | Filmstrip sheets from the renderer; frame gate holds |
| B2 | Emotion vocabulary and fold table in the spec; host maps any model emotion to a face | SPEC, BOT | S | no | none | Unknown emotion never falls to neutral silently |
| B3 | Overlay and icon layer: tear, heart, blush, sweat, zzz, "!", "?", think dots, sparkle, check, mail, pill, moon; `show_symbol`, `sleep_z` tools real | FW, SPEC | M | yes | Draw primitives; PSRAM for any bitmap | Each overlay on each face in a sheet |
| B4 | Lip sync from audio level: 5 mouth shapes, 70 ms hold | FW | S | yes | none | Speech looks spoken, not flapping |
| B5 | System-state faces: low battery, hot, error with a short plain line; do-not-unplug on update | FW | S | yes | none | Sheet plus unit photos |
| B6 | Pick-up, put-down and carried faces tied to the governor | FW, BOT | S | yes | none | Lift shows the face and motion is zero |
| B7 | First-run and Wi-Fi: welcome, flat-surface note, QR, secured hotspot, priority list, waiting for approval; touchscreen Wi-Fi entry only if it fits | FW, BOT, HOME | L | yes | Setup window estimated 20 to 30 KB while open: measure | A new person sets up with a phone and no computer after first flash |
| B8 | Quick settings page 2: mute, vision, quiet, night, idle motion level, info (version, IP, battery, motion status, last restart) | FW | M | yes | LVGL objects created on open, freed on close | Opens and closes 100 times with no low-water drop |
| B9 | Picture channel without JPEG (decision 2), raised to wave 2 because the front-door camera (M2) and camera preview (B12) depend on it: weather card, timer card art, camera snapshot | FW, BOT, HOME | L | yes | PSRAM frame; measure internal | Gate holds; else stop and report |
| B10 | Subtitles: 2-line box with paging, default off | FW, BOT | M | yes | One label | Text in step with speech |
| B11 | Attention card with dismiss; used by approvals, reminders, medicine | FW, SPEC, BOT | S | yes | reuse timer card | Raise, show, dismiss by touch or voice |
| B12 | Camera moment: shutter mark on the face with the pink ring; frame preview if B9 lands | FW | S | yes | none | Visible on every capture |
| B13 | Auto-hiding status bar: clock, Wi-Fi, battery on wake and tap | FW | S | yes | none | Face clean at rest |
| B14 | Face packs as data: palette, geometry, timing; validator; preview sheet; catalog format | SPEC, FW, CAT | M | yes | Pack in assets partition | Two packs swap on the unit |
| B14b | Illustrated pack format with mouth patch (decision 1) | FW, CAT | L | yes | PSRAM; cap per pack; fallback | Later; only on a yes |
| B15 | Ring: reserved indicator pixels, flash-rate cap, no ring traffic during speech | FW, SPEC | S | yes | none | Tools cannot paint reserved pixels |
| B16 | Earcon set: listening start and stop pair matched to the ring, mute, unmute, error; night rules | FW, CAT | S | yes | assets | Sound sheet and unit check |
| B17 | Screen style standard (section 9b): big text, big targets, one component set, layout checks in golden frames; wave 1 | FW, docs | M | yes | none | Every screen passes the layout check |

### Lane C: voice and behavior

| ID | Item | Where | Size | Bench | Acceptance |
|---|---|---|---|---|---|
| C1 | Turn quality on the robot: smart end of turn on, pre-roll test with soft child speech, follow-up window, per-stage latency log | HOME, BOT | M | yes | First spoken word and clipped-word counts before and after |
| C2 | Wake sensitivity setting; "say it now" test | FW, SPEC, HOME | S | yes | Three levels work; test shows a hit |
| C3 | Speaker turn at wake wired; continuous following opt-in; `robot.look_at_speaker` registered | BOT, SPEC, HOME | S | yes | One turn toward the person, then still |
| C4 | Idle motion levels with torque release; default Little | BOT, SPEC, HOME | S | yes | Governor honors it |
| C5 | Wake word survives every rest stage on USB and battery | FW | S | yes | Soak result |
| C6 | Whisper night: quiet in, quiet out | BOT, HOME | M | yes | Night reply volume follows input level |
| C7 | Speaker identity by voice from Home's stream | HOME, BOT | L | yes | Measured accept and false-accept rates; opt-in |
| C8 | Face recognition measured and gated; shows who it thinks it is talking to (initial or color, never a name to a stranger) | BOT, HOME | M | yes | Rates recorded; opt-in |
| C9 | Quiet hours, bedtime, daily cap on proactive speech, per-band volume cap | SPEC, HOME, BOT, FW | M | yes | A child robot is silent in quiet hours |
| C10 | Barge-in decision record: tap and swipe stop; stop word reliability measured | FW, BOT | S | yes | Numbers in the measurements file |

### Lane E: features as catalog packages

| ID | Item | Where | Size | Acceptance |
|---|---|---|---|---|
| E0 | Robot package host: a package declares capabilities, assets, tools; runs under Home's gates | SPEC, BOT, HOME, CAT | L | A sample package installs and runs on the fake body |
| E1 | Games: Simon (ring and touch), rock paper scissors (camera optional), 20 questions, trivia; alone-mode versions of Simon | CAT, FW | L | Playable by a child with the hub off for Simon |
| E2 | Bedtime story mode: slow voice, dim face, ends in sleep routine | CAT, HOME | M | Runs under child band |
| E3 | Medicine reminders (MEDS-01) with the attention card and confirm | HOME, BOT | M | Private to the person |
| E4 | Smart home by voice on the robot through Home's tools, with confirm on locks | HOME | S | Rule on confirmations holds |
| E5 | Ambient status on idle face and ring (door open, laundry done) | HOME, BOT | M | Opt-in; quiet hours |
| E6 | MCP: robot tools served by the Bot service (works without Home); Home's MCP server (CREATOR-32) proxies them with its gates: say, face, move, status, health, attention, describe; never a picture; adults only | BOT, HOME | M | Tool descriptions with "use when / do not use for"; same tools with and without Home |
| E7 | Play Home's music and radio on the robot with the music face | HOME, BOT | M | Volume cap by band |
| E8 | Dance teach and record for StackChan (reuse `moves/teach.py`) | BOT | M | A taught dance replays under the governor |

### Lane F: tester (from the tester report)

| ID | Item | Size | Acceptance |
|---|---|---|---|
| F1 | Scenario runner on the fake unit with a fake clock | M | Five flows pass headless |
| F2 | Golden-frame CI from the real-code renderer; sheets for every face, overlay, card and screen | M | Stable over 20 runs; diffs on pull requests |
| F3 | Software unit: window, mouse touch, keyboard handling events, drawn head and ring, governor status | L | A contributor plays a game with no robot |
| F4 | Contract tests shared by fake, StackChan and Reachy Mini profiles | M | Same suite, three bodies |
| F5 | Browser build | M | Optional |

F2 lands before most of Lane B so every UI change arrives with pictures.

### Lane G: Home management

| ID | Item | Size | Acceptance |
|---|---|---|---|
| G1 | Robot page "Now" card: state in ring colors, mute, vision, quiet, motion status with reasons, stop and resume interlock; mount the existing RobotCards | M | Phone and desktop captures |
| G2 | Finish add, update and online-truth flows (STACKCHAN-ADD-FLOW-01, -UPDATE-01, -ONLINE-TRUTH-01, -WIFI-SETUP-01); pairing as a family step | L | A parent adds a robot with no terminal |
| G3 | Health tab: plain words per part with what to do; advanced view with memory, restarts, frame period, link, I2C | M | Uses check-in fields already collected |
| G4 | Activity: counts, ages and states only (rule 6a) | S | No person text |
| G5 | Robot filter on the memory page; hold a child's statements for review if the owner wants it | M | Needs a design note first |
| G6 | Live face mirror from the renderer | M | Matches the unit pixel for pixel in golden tests |
| G7 | Settings keys the bot asked for; new keys from Lanes B and C; one registry | S | Spec first |
| G8 | Microphone check and wake test | M | Shows level and what was heard to the person testing |
| G9 | Face pack, sound pack and game install from the Catalog | M | Install, switch, remove |
| G10 | Multi-robot list and bulk update | S | Two robots managed |

### Lane H: README and documentation

| ID | Item | Where | Size |
|---|---|---|---|
| H1 | Bot README rewrite: true tagline per body, status table, "what runs where", hardware photo, face gallery, quick start | BOT | S |
| H2 | StackChan user guide: every gesture, face, ring color and sound with renderer captures; setup guide corrected | BOT | M |
| H3 | Home README: robot section with captures; comparison with other StackChan options, stated fairly | HOME | S |
| H4 | AI transparency page, SECURITY.md pointer, CONTRIBUTING, code of conduct links in each repo | all | S |
| H5 | Privacy page for the robot: what the unit keeps, sends and shows; indicator guarantees | BOT, HOME | S |
| H6 | Feature docs in one template: what it does, turn it on, use it, turn it off; "runs alone / needs host / needs Home" map | BOT | M |
| H7 | Developer docs: wire schema reference (generated), governor, HAL, how to add a body, how to make a face pack and a game | BOT, SPEC | M |
| H8 | Measurements and known limits page: what was tested on the unit and what was not | BOT | S |
| H9 | Troubleshooting notes as symptom, cause, fix | BOT | S |
| H10 | Reachy Mini guide stubs sharing the same templates | BOT | S |

## 8. How to build it fast with many agents

### 8.1 Constraints that set the shape

- One real unit. Bench items queue. Everything else must be provable in the renderer, the fake unit or tests.
- One firmware tree. Parallel firmware agents collide on patch numbers and on memory.
- Spec changes gate two repos.

### 8.2 Team

| Role | Runs on | Count | Does |
|---|---|---|---|
| Coordinator (Fable) | Mac Studio session | 1 | Owns this plan, the patch-number and RAM ledgers, the bench queue, merges, owner questions |
| Spec agent | cloud | 1 | All `commons/spec` changes, tagged in small versions; nobody else edits spec |
| Firmware agents | Mac worktrees (they need the ESP-IDF build and renderer) | 3 | One per sub-lane: B-motion (B1, B4, B6, B13), B-screens (B5, B7, B8, B10, B11, B17), A/S firmware (A1b, A3, S2 to S4) |
| Bench agent | Mac, holds the unit | 1 | Only this agent flashes; runs A4's gate script on each candidate image and reports numbers |
| Bot service agents | cloud | 2 | A1, A2 host side, C lane, E0 |
| Home agents | cloud | 3 | G lane, S9, E4, E6 |
| Tester agent | cloud | 1 | F lane |
| Docs agent | cloud | 1 | H lane, fed by renderer sheets |
| Catalog agent | cloud | 1 | B14, B16 packs, E1, E2 once E0 exists |
| Reviewer (Fable) | cloud | 1 | Reviews every safety, auth and governor change; red-team note required |

About 14 agents at peak; 6 to 8 in the first week.

### 8.3 Rules that keep them from colliding

1. **Patch numbers and tool names are leased** from a ledger file before work starts.
2. **RAM is budgeted per item** in the same ledger: requested internal bytes, measured bytes. The bench agent rejects an image that breaks A4.
3. **Firmware lands through one integration branch** built nightly as a combined image; the bench agent tests the combined image, not each branch.
4. **Renderer first.** A firmware UI change is reviewed as a sheet of images before it gets a bench slot.
5. **Spec first, small tags.** A lane needing a shape files a request to the spec agent; the tag lands the same day.
6. **Cloud agents never need the unit.** If an item cannot be proven without it, it is split into a testable part and a bench check.
7. **Every item ends with**: tests, a sheet or capture if it has UI, RAM numbers if firmware, docs touched, backlog row closed through `land.sh --done`.
8. **Nothing ships to the live hub or the family's unit without the owner's word.**

### 8.4 Waves

| Wave | Days | Parallel work | Exit |
|---|---|---|---|
| 0 | 1 to 3 | Z1 to Z5 | Truth settled; decisions made |
| 1 | 3 to 8 | A1, A2, A4, A5; S1, S5, S8; F1, F2; H4, H8; G7 | Governor in the spec; wire schema; gates; golden frames; baseline numbers |
| 2 | 8 to 18 | A1b, A3, A6; S2 to S4, S6, S7, S9; B1 to B6, B13, B15, B17; C1 to C5; G1, G3; E0; H1, H2 | Safer, livelier unit; health and Now cards; first bench-proven combined image |
| 3 | 18 to 30 | B7, B8, B10, B11, B12, B14, B16; C6, C9, C10; G2, G4, G6, G8, G9; E3, E4, E6; F3, F4; H3, H5 to H7 | Setup a parent can do; packs; MCP; software unit |
| 4 | 30 to 45 | B9 (if decision 2 is yes); C7, C8; E1, E2, E5, E7, E8; G5, G10; F5; H9, H10; Reachy Mini contract pass | Games and stories; recognition measured; second body passes the shared tests |

Calendar: about 6 to 7 weeks to the end of wave 3 with this team, 9 with wave 4. With one firmware agent instead of three, add 3 to 4 weeks. These are estimates; the bench queue is the real limit.

### 8.5 Bench schedule

One combined image per day in waves 2 to 4. Each slot: flash, 10-minute gate (A4), the day's checklist, a 2-hour soak overnight. About 30 to 35 slots in total. The owner is needed only for hands-on checks (pick up, pet, speak from across the room); the plan batches those into two short sessions a week.

## 9. Why someone would pick ours after this

| They want | Others | Ours after the plan |
|---|---|---|
| Private and local | Several, with open LAN endpoints | Local, authenticated, encrypted link, signed updates, recorded egress proof |
| Safe for children | Dotty's switch; prompts elsewhere | Bands enforced in code on every speech path; quiet hours, bedtime, volume caps; child lock on the unit |
| A robot that feels alive | alive's motion; Nous-Girl's emotes | Staged motion, overlays, reflexes, lip sync, earcons, bounded idle motion |
| Will not hurt itself | Ad hoc cooldowns | One movement governor with reasons, on every body |
| Easy setup | GPT's on-robot flow; ai-server's wizard | QR setup, secured hotspot, add-a-robot in Home with no terminal |
| A place to manage it | Dotty's page; local's console | Now card, health in plain words, live face mirror, mic and wake test, multi-robot |
| More than chat | Nous-Girl's add-ons | Games, stories, timers, medicine, music, smart home, MCP as packages |
| More than one robot | Nobody | Same interface for StackChan and Reachy Mini |
| To contribute without a robot | Nobody | Software unit and golden frames |
| Honest docs | Nous-Girl, Dotty | Tested-versus-untested page, AI transparency, real screenshots |

## 9a. Grades: today, and after this plan

Letter grades are my judgment from the evidence in the round 1 and round 2 files, not measurements. "Stock" is M5Stack's own firmware and app, judged through the StackChan-GPT fork that keeps its launcher, setup flow and phone app, and through M5Stack's public repo; I did not run stock firmware, so that column is [unverified]. "Best other" names the strongest of the 15 in that row.

| Area | Ours today | Stock M5Stack | Best other | Ours after wave 3 | Ours after wave 4 |
|---|---|---|---|---|---|
| Privacy (local, no vendor cloud) | A- (local; unit link unencrypted; egress proof not recorded) | D (vendor cloud by default) | A- alive | A | A |
| Child safety | A- (bands in code; no quiet hours, no unit child lock) | F | B Dotty | A | A |
| Security of the unit and link | C+ (tokens good; plain `ws://`, open hotspot, hash-only updates) | D | B stackchan-mcp (server side) | A- | A- |
| Face motion and expressiveness | C+ (17 faces, cuts between them, basic mouth) | B (stock avatar with decorators) | A alive, Nous-Girl | B+ | A- |
| On-robot screens and styling consistency | C (good link screens and quick settings; no shared standard, no setup flow, no settings beyond three controls) | B+ (big text, big buttons, consistent) | B+ StackChan-GPT, Nous-Girl | B+ | A- |
| Setup and onboarding | C- (USB flash from Home is good; pairing and Wi-Fi are rough; docs stale) | B+ (QR, app, guided) | B+ ai-server wizard, GPT | B+ | A- |
| Management page | C+ (three tabs; health data collected but hidden; no live view mounted) | B (phone app) | A- Dotty | A- | A |
| Voice quality and turn-taking | B (Home's engine; robot latency and clipping never measured) | B (cloud realtime) | B+ Nous-Girl smart turn, ai-server | B+ | A- |
| Wake word | B- (works; no sensitivity; cost unmeasured) | B | B+ Nous-Girl | B+ | B+ |
| Movement safety and servo care | B (gates exist; limiter in flight) | C | B+ alive | A | A |
| Features beyond chat (timers, music, games, smart home) | B- (timers, dance, song naming, announcements; no games or stories) | B (apps, dance, remote, video call) | B+ Nous-Girl | B+ | A |
| Memory and personalization | A- (Home's memory, companions, voices) | D | B Dotty, alive | A- | A |
| Agent and tool control (MCP, API) | D (planned) | D | A- stackchan-mcp | B+ | B+ |
| Works alone, no hub | D (faces, reactions, offline phrases; cannot do anything else) | C (apps without the cloud) | B pet-fw, Minimal | C+ | B (alone-mode games and clips) |
| More than one robot body | B (Reachy Mini profile exists; seam is a draft) | F | F | A- | A |
| Testing without hardware | B+ (real-code renderer, 2,947 tests, fakes; no CI gate on screens) | D | B stackchan-mcp, alive | A | A |
| Reliability evidence (soak, memory gates) | B- (measurements exist; no release gate) | unknown | A alive (8-hour soak) | B+ | A- |
| README and docs | D+ (stale, no screenshots, wrong tagline) | B | A- Nous-Girl, Dotty | B+ | A- |
| Overall | **C+ to B-**: strongest brain and safety, weakest finish | **C+**: polished shell, cloud-bound, no safety | **B** (each is strong in one area, none across the board) | **B+ to A-** | **A-** |

Where we stay behind even after the plan: illustrated character art (unless decision 1 is yes), a phone app, and stock's video call and remote-control extras. Where nobody else is close: child safety, memory, multi-body support, hardware-free testing.

## 9b. Screen style standard (owner note, 2026-11-18)

The owner likes the stock screens: large wording, large touch targets, one style applied everywhere (see `round2/shots/gpt-app-setup-gifs.png`: "Welcome! Let's get started.", two big buttons, one idea per screen). We do not have this as a written standard. Today our link screens are small white text on black, quick settings is sliders and buttons from a different patch, cards come from upstream, and nothing checks them against each other.

B17 is therefore promoted from a one-page sheet to a standard, moved to wave 1, and made a gate for every Lane B screen:

- **One idea per screen.** A title or one sentence, at most two actions.
- **Type:** one family, three sizes only (title about 28 px, body about 22 px, caption about 16 px on the 320x240 screen); no text under 16 px; sentence case; at most 4 lines.
- **Touch targets:** at least 96 x 56 px, at least 12 px apart, primary on the right, secondary (Skip, Back) on the left in a quieter color.
- **Safe areas:** 28 px top, 20 px sides and bottom (matches the existing touch margins).
- **Color:** the active palette for the face; one light card color for pages; ring colors keep their meaning on screen (green live, pink camera, cyan pairing, amber attention, blue listening).
- **Components, built once and reused:** page, title, body text, primary and secondary button, slider row, toggle row, list row, card, progress, QR block, toast, status bar.
- **States:** every screen has a version for night, for reduced motion and for the child band.
- **Enforcement:** components live in one firmware module; the renderer's golden frames include a layout check (target size, text size, safe area); a screen that fails does not land.
- **Reuse:** the stock components are MIT (confirm `firmware/LICENSE`) and are already in our tree; restyle them rather than writing new ones.

Screens to bring under the standard first: link and setup screens, quick settings pages 1 and 2, timer and attention cards, update screen, info page.

## 10. Risks

1. **Internal RAM.** Several Lane B items plus `wss://` plus the tailnet client will not all fit. The ledger and A4 decide; the order of preference is safety, encryption, setup, then looks.
2. **Unknown state after 0.2.213.** Wave 0 may change item sizes.
3. **One unit.** A dead unit stops waves 2 to 4. A second unit is cheap insurance.
4. **Patch-series fragility** with three firmware agents. The integration branch and nightly build limit it; decision 9 may remove it.
5. **Rule conflicts** (vision R1, admin 6a, spoken-turn rules). Items are shaped to respect them; anything else stops and goes to the owner.
6. **Scope.** Wave 4 is optional per item. The plan is useful if it stops after wave 3.
7. **Measurement gaps.** Wake-word cost, stop-word reliability, duplex and latency were never measured on our unit; A5 comes first so later claims are true.

## 11. Decisions needed from the owner

1. Approve Wave 0 and Wave 1 to start.
2. Decisions 1 to 10 in section 4 (at least 2, 5, 6, 7 and 9 before wave 2).
3. The boundary rule text in section 5.
4. The movement governor shape in section 6.1 as the shared concept for every body.
5. Whether to buy a second StackChan for the bench.
6. Whether the hold-for-review of a child's statements (G5) is wanted.

## 12. Additions agreed with the owner, 2026-11-18

These came from the owner's follow-up questions. Where they conflict with earlier sections, this section wins. Sizes are estimates.

### 12.1 Four users, one product

Every item is checked against four people. A feature that serves none of them is cut; a screen is judged by the least technical person who will touch it.

| | Kid (child band) | Teen | Non-technical adult | Technical adult |
|---|---|---|---|---|
| Wants | A friend that reacts, plays, tells stories | A companion with personality, music, homework help, privacy from siblings | It just works; safe for the kids; easy to fix | Home Assistant, Claude, Codex, MCP, scripts, their own models |
| Touches | The robot itself: voice, petting, games | Robot, their own Home profile | Phone: QR setup, Home's robot page | Bot service, config, API, MCP, Home Assistant |
| Must never | Reach settings that weaken controls; hear unfiltered output; be recorded silently | See another person's memories; lose controls set by a parent | Need a terminal, a cable after first flash, or a manual | Be forced to run Home; be blocked from the wire schema |
| Runs in | Mode (d), Home required | Mode (d), Home required | Mode (d) | Any mode |
| Today | B: safe, reactive; no games or stories, no quiet hours | B-: companions and voices; nothing teen-specific | C-: setup rough, page hides health, docs stale | D: no way in without Home |
| Plan items | B1 to B6 reflexes and faces; E1 games; E2 stories; C9 quiet hours and bedtime; S7 child lock; S9 gates | Companion and face packs (B14, G9); E7 music; C8 "who am I talking to"; teen band rules as today | K1 to K4 setup; G1 to G3, G8; B7, B8, B17 big-text screens; H2 guide | M1 to M4 modes; E6 MCP; N1 agent companion; H7 developer docs; F3 software unit |
| After wave 3 | A- | B+ | B+ | B+ |
| After wave 4 | A | A- | A- | A- |

Design rules that follow:

1. **The robot screen is designed for the kid and the non-technical adult** (section 9b): big words, big buttons, one idea per screen, no jargon, no version numbers outside the info page.
2. **Home's robot page has two depths**: a plain family view first, an Advanced disclosure for the technical adult. Nothing a parent needs is under Advanced.
3. **The Bot service is the technical adult's front door**: one command to install, a small local page, a documented wire schema and MCP tools. It must be useful with no Home.
4. **A child or teen robot requires Home.** Modes without age gates say so at setup and cannot be given child or teen controls.
5. **A teen is not a small adult or a big child**: teen band keeps its own rules from `RULES.md`; this plan adds no teen exception.
6. **README and docs have four entrances**: "For families", "For kids and teens (what it can do)", "For Home Assistant users", "For developers and agents".

### 12.2 Lane K: getting connected

| ID | Item | Where | Size | Bench | Acceptance |
|---|---|---|---|---|---|
| K1 | Captive portal page rebuilt to the screen standard: our branding, big text and buttons, network scan with signal bars, saved networks with priority and forget, clear "what happens next", ends on the Home approval step, small diagnostics block (version, signal, last error), light and dark, phone first | FW | M | yes | A non-technical adult finishes it unaided; internal RAM while open measured against the 25 KB gate (estimate 20 to 30 KB, unmeasured) |
| K2 | QR on the robot: Wi-Fi join code for the secured hotspot (with S4), then a pairing code that opens Home's approval page for this robot | FW, BOT, HOME | M | yes | Phone camera joins and opens the page with no typing; pairing needs no developer step |
| K3 | Wi-Fi details handed over the USB cable at flash time, offered beside the QR flow | HOME, FW | S | yes | Needs the owner's yes: the user guide says Home never asks for the Wi-Fi password. If yes, the guide is reworded |
| K4 | Spike: robot camera reads a QR shown on a phone (backlog patch 135) | FW | S | yes | Decoder memory cost and read rate measured; build only if the gate holds |
| K5 | Bluetooth: not built. Record the decision: the chip has Bluetooth Low Energy only, it was stripped for memory, it shares the radio with Wi-Fi, and it needs a phone app we do not have | docs | S | no | Decision note; revisit only with a phone app |
| K6 | One-command install of the Bot service on macOS, Linux and a Raspberry Pi, with the browser flasher for people without Home | BOT | M | yes | A technical adult goes from nothing to a talking robot from the README alone |

### 12.3 Lane M: works with and without Home

One Bot service, a swappable brain. The spec gains a `Brain` interface (turn in, cues and speech out) so the unit and behaviors cannot tell which is running.

| ID | Item | Where | Size | Acceptance |
|---|---|---|---|---|
| M0 | Brain interface in the Bot service; Home becomes one implementation; mode shown on the info page and local settings page | SPEC, BOT | M | Contract tests run every brain against the fake body |
| M1 | Home Assistant voice satellite mode: robot audio to Home Assistant's Assist pipeline and back; address and token in local settings; no AI model | BOT | M | "Turn on the light" works with Home absent; confirmation on locks, garage doors and alarms |
| M2 | "Show me the front door camera": snapshot from Home Assistant, resized on the host, sent over the picture channel (B9); refresh about once a second (estimate, unmeasured); auto-dismiss | BOT, FW | M | Works in modes (b) and (d); pink ring is not used for a remote camera, a distinct mark is |
| M3 | Robot as a Home Assistant device: battery, online, mute, vision off, quiet, announce, say, attention | BOT | M | Appears through discovery; automations can announce |
| M4 | Standalone brain: any OpenAI-compatible endpoint, local by default; local speech; basic content filter on by default; cloud endpoints only by explicit opt-in with an indicator | BOT | L | A technical adult talks to the robot with a local model and no Home; labeled adult mode |
| M5 | Local settings page for modes (b) and (c): connections, voice, wake sensitivity, robot basics; loopback by default; token to open from another device | BOT | M | Same spec keys as Home; no second store |
| M6 | Handover: when Home pairs, it takes the brain and settings; when Home is removed, the robot returns to its local mode without a reflash | BOT, HOME | S | Round trip tested on the fake body |

Owner rulings needed before M4: an adult-only mode with no Home age gates (rule 0 says the gates outrank everything, so this needs explicit approval), and cloud brains as an opt-in against the promise that nothing leaves the home. M1 to M3 need neither: Home Assistant replies are fixed sentences and stay on the home network.

How much of the Bot's earlier local speech stack is reusable for M4 was not checked.

### 12.4 Lane N: desk companion for coding agents

What the field does (round 1 audits of stackchan-mcp, stackchan-cloud-mcp, stackchan-local, stackchan-claude-bridge, the xiaozhi fork): agents drive the robot through MCP; hooks mirror the agent's thinking and speaking state on the face and ring; a "needs you" alert shakes the head and pins a label until dismissed; a spoken sentence becomes an agent task. Nobody shows usage. Their failures: voice straight to a shell with permissions bypassed, an unauthenticated alert endpoint, one long-lived token for everything.

| ID | Item | Where | Size | Acceptance |
|---|---|---|---|---|
| N1 | Agent status mirror: Claude Code and Codex hooks post to an authenticated loopback endpoint on the Bot service; faces for working, waiting, done, error; quiet chime on done | BOT, CAT | M | Hooks installed by one command; works without Home |
| N2 | "Needs you" card: project name, pinned until tapped or dismissed by the agent; uses the attention card (B11) | BOT, FW | S | Raised within 2 s of the agent asking |
| N3 | Usage meter spike: what Claude Code and Codex expose to hooks about session usage and limits; if available, a ring segment or small card | BOT | S | Written finding; build only if the data exists |
| N4 | Spoken one-line summary when a task ends, optional | BOT | S | Off by default |
| N5 | Agent tools over MCP (E6) with setup docs for Claude Code, Claude Desktop, Codex, Cursor | BOT, docs | S | Each client configured from the docs |

Lines held: the robot never approves a permission request by voice; voice never starts a shell task; only state, project name and counts reach the robot, never code or prompt text; the movement governor and quiet hours apply; the endpoint needs a token and listens on loopback unless the person opens it.

### 12.5 Effect on the schedule and team

- Wave 1 gains: M0, K5, B17 (already moved), N3 spike.
- Wave 2 gains: K1, K2, M1, M3, B9 (moved up), N1, N2.
- Wave 3 gains: K3 (if yes), K4, K6, M2, M5, M6, N4, N5, H entrances for four audiences.
- Wave 4 gains: M4 (if approved).
- One more Bot service agent (cloud) for Lane M; the firmware "screens" agent takes K1 and K2. Peak is about 15 agents.
- Calendar estimate: about 7 to 8 weeks to the end of wave 3, about 10 with wave 4. The single unit remains the limit.

### 12.6 More decisions for the owner

7. Standalone AI brain without Home's age gates, adults only (M4): yes or no.
8. Cloud brains as an explicit opt-in (M4): yes or no.
9. Wi-Fi details over USB at flash time (K3): yes or no.
10. Management without Home lives in a small Bot service page (R-B5 as revised): yes or no.
