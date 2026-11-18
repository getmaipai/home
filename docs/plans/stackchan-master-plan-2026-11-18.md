# StackChan master plan: finish the vision, beat the field, build it in parallel (2026-11-18)

Status: owner agreed to the recommendations on 2026-11-18 (section 15 records each decision and what is still open). Nothing in this plan is built. It replaces [stackchan-tester-and-ecosystem-adoption-2026-11-18.md](stackchan-tester-and-ecosystem-adoption-2026-11-18.md) as the plan of record; the tester work is Lane F here.

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
11. **Memory governor** (section 13.1): declared peaks, one admission point, a mode table, `robot.resources.status`.
12. **Brain interface** (section 12.3): turn in, cues and speech out, so Home, Home Assistant, a standalone model or an agent can drive any body.

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

## 13. Lane P: memory and performance (added 2026-11-18)

Gains in this section are estimates. Nothing here has been measured on our unit. The order is fixed: measure, take the safe wins, then the structural moves.

Where internal RAM goes today (from our own notes): task stacks (the Opus codec holds 24 KB; the tailnet client wants 42 to 52 KB), 168 KB of static data, and many small allocations that fragment the heap. About 7 MB of PSRAM is unused.

### 13.1 Memory governor (shared concept, twin of the movement governor)

Added to section 6 as item 11 of the shared robot interface, so every body gets it.

- Each subsystem (wake word, stop word, camera, codec, setup portal, tailnet, picture channel, a game) declares a measured internal RAM peak and CPU class, as data.
- One admission point decides what may run together. A request that does not fit is refused with a typed reason, or a lower-priority subsystem is paused first. Priority order: safety and indicators, the live voice turn, link, setup, looks.
- A mode table states the allowed sets, for example: setup portal open means voice stack released; speaking means stop word loaded and camera paused; idle means wake word and optional tracking.
- Status is one read (`robot.resources.status`): free, low-water, largest block, who holds what, refusals. Shown in Home's health tab.
- Same design as the Stack's parts with measured peaks and one budget, applied to a robot.

| ID | Item | Where | Size | Bench | Acceptance |
|---|---|---|---|---|---|
| P1 | Baseline map: internal RAM by task stack, static segment and heap owner; CPU by task; frame period; with heap task tracking on | FW | S | yes | One table in the measurements file; repeats A5 in more depth |
| P2 | Memory governor in the spec and fake body; StackChan mode table | SPEC, BOT, FW | M | yes | Portal, voice, camera and tailnet never exceed the budget together; refusals counted |
| P3 | Per-release memory and performance report from the bench agent | BOT | S | yes | A regression fails the release gate (A4) |

### 13.2 Reflex terminal: move work to the host

| ID | Item | Where | Size | Bench | Acceptance |
|---|---|---|---|---|---|
| P4 | Host-computed mouth cues sent with speech audio; unit does no audio analysis (replaces the on-unit half of B4) | BOT, FW, SPEC | S | yes | Lip sync matches; no new unit task |
| P5 | Plain audio on home Wi-Fi instead of Opus, Opus kept for away links; trial only | FW, BOT | M | yes | Frees the codec stack and CPU without the frame-burst stalls recorded in our notes; otherwise dropped |
| P6 | Compact binary tool frames generated from the wire schema (A2) instead of JSON text on the unit | SPEC, FW, BOT | M | yes | Parser memory and tool latency lower than today (tool latency is 13 to 834 ms now) |
| P7 | Host draws cards, QR codes and resized pictures; unit only blits | BOT, FW | S | yes | With B9 |

### 13.3 Fixed pools and fewer tasks

| ID | Item | Where | Size | Bench | Acceptance |
|---|---|---|---|---|---|
| P8 | Stack right-sizing from measured high-water marks; report per task | FW | S | yes | Table before and after |
| P9 | Fixed pools for message buffers, audio frames and screen objects; no allocation in steady state | FW | L | yes | Largest free block stable over a 24-hour soak |
| P10 | Merge small tasks into shared workers | FW | L | yes | Fewer stacks; no missed deadlines |

P9 and P10 are hard on a patch series over someone else's firmware. They are decided together with decision 9 (own firmware) and are not scheduled before it.

### 13.4 Safe wins

| ID | Item | Where | Size | Bench | Acceptance |
|---|---|---|---|---|---|
| P11 | Static data and read-only data placed in PSRAM, code fetched from PSRAM, where ESP-IDF allows it for this chip [verify the options against our IDF version] | FW | S | yes | Internal static size down; no speed loss on the face or audio |
| P12 | Screen objects built on open and freed on close, everywhere | FW | S | yes | With B8 and K1 |
| P13 | Dynamic frequency scaling when idle | FW | S | yes | Lower temperature; wake word still works |

Target, to be confirmed by P1: roughly double the free internal RAM, so the encrypted link, the tailnet client and the new screens fit together.

## 14. Lane Q: Espressif components to adopt (added 2026-11-18)

From knowledge of the Espressif ecosystem. Versions and memory costs were not checked against our build, so each starts as a spike with a measured result.

### Take first

| ID | Component | Gives | Replaces or closes |
|---|---|---|---|
| Q1 | Signed app verification without secure boot | Unit verifies a signature on every update; no fuse changes | S3 |
| Q2 | NVS encryption, HMAC scheme | Wi-Fi passwords and device token encrypted at rest | The dropped NVS encryption |
| Q3 | `esp_mmap_assets` | Face packs, sounds, icons read from flash with no RAM copy | Enables B14, B16 cheaply |
| Q4 | ESP-IDF Linux host target | Real firmware components run on a computer | Base for the software unit (F3) |
| Q5 | Heap task tracking, core dump summary sent to our host | Per-task memory, crash reports | Feeds P1, G3 |
| Q6 | Power management with frequency scaling | Less heat | P13 |
| Q7 | `pytest-embedded` | Standard runner for unit, QEMU and Wokwi tests | Bench scripts |

### Spike

| ID | Component | Question to answer |
|---|---|---|
| Q8 | ESP-DL face and person detection on the unit | Can tracking run with no frames leaving the robot, within CPU and PSRAM? |
| Q9 | Audio front end with a correct speaker reference | Can echo cancel work on this board, making voice barge-in possible? |
| Q10 | `esp_new_jpeg` | Does a light JPEG decoder fit, simplifying B9? |
| Q11 | Wi-Fi Easy Connect (DPP) | Does QR provisioning from Android's Wi-Fi settings work beside the portal? |
| Q12 | Built-in roaming | Can it replace patch 154? |
| Q13 | Delta updates | How much smaller and faster are wireless updates? |
| Q14 | USB device classes | Can the robot be a USB microphone, speaker or webcam, and take Wi-Fi over the cable, without breaking flashing? |
| Q15 | `led_indicator`, `esp_codec_dev` | Do they remove patches? |
| Q16 | Digital Signature peripheral | Hardware-held identity key for mutual TLS after S2 |

### Leave out, with the reason recorded

- ESP RainMaker and ESP Insights: data goes to Espressif's cloud.
- Matter on the unit: too heavy and needs Bluetooth; a Matter bridge, if wanted, belongs in the Bot service.
- ESP-Brookesia: a launcher framework; the face is the product.
- ESP WebRTC: large memory cost; revisit only with our own firmware.
- Secure boot and flash encryption: irreversible; Q1 and Q2 first, then S10's decision.

### Schedule effect of sections 13 and 14

- Wave 1 gains P1, P3, Q1, Q2, Q5, Q7 and the memory governor's spec (P2 spec half).
- Wave 2 gains P2 on the unit, P4, P8, P11, P12, P13, Q3, Q4, Q10 spike, Q9 spike.
- Wave 3 gains P5 trial, P6, P7, Q8, Q11 to Q15.
- P9, P10, Q16 wait for decision 9 and S2.
- One more firmware agent (performance) on the Mac; bench slots rise to about 40. Calendar estimate unchanged if the Q spikes stay time-boxed to a day each.

## 15. Owner decisions recorded, 2026-11-18

The owner's words in chat: "i agree with all your suggestions - add to the plan". Each recommendation below is recorded as decided on that basis. Where a question had no recommendation, or the recommendation was to decide later, it stays open and is listed as such. Rule text is not edited by this plan: each rule change lands in `docs/design/RULES.md` as its own commit marked `Owner-approved`, in Wave 0.

### Decided

| # | Decision | Outcome |
|---|---|---|
| 1 | Start Wave 0 and Wave 1 | Yes |
| 2 | Faces | Drawn faces stay the default and get the motion work; an optional illustrated pack format comes later (B14b), with a per-pack cap and fallback |
| 3 | Image path on the unit | No JPEG decoder restored by default; raw tiles from the host over the existing channel, shipped only if the memory gate holds. Q10 still tests the light decoder as a spike |
| 4 | Tailnet client | Stays a separate build until its memory gate is measured; no UI feature may spend its margin |
| 5 | Ambient vision | Remove the unwired path after confirming nothing is lost |
| 6 | Custom wake phrase | Not now; add sensitivity levels; run the microWakeWord spike (A6) |
| 7 | Agent "see" tool | Describes the scene in words; never returns a picture. No change to vision rules R1 to R4 |
| 8 | Activity on admin pages | States, counts and ages only (rule 6a unchanged) |
| 9 | Licenses | Copy logic with notices from MIT, Apache, BSD and AGPL sources; never the non-commercial art or voice; verify the M5Stack firmware license before copying |
| 10 | Boundary rule | The eight "Robot boundary" lines of section 5, with R-B5 and R-B6 as revised in section 12, approved as text to land in `RULES.md` |
| 11 | Shared robot interface | Movement governor, memory governor, brain interface and the other additions of section 6 approved as shared concepts for every body |
| 12 | Screen style standard | Section 9b approved; a gate for every robot screen |
| 13 | Captive portal | Rebuilt as its own item (K1) |
| 14 | QR setup and pairing | Yes (K2); camera-reads-QR as a spike (K4) |
| 15 | Bluetooth | Not built (K5) |
| 16 | Management | In Home when Home is present; a small Bot service page without Home (R-B5) |
| 17 | Home Assistant without Home | Yes: voice satellite mode, camera snapshots, robot as a device (M1 to M3) |
| 18 | Standalone AI brain without Home | Yes, labeled for adults; a child or teen robot requires Home; on-unit limits and a basic filter stay on. Needs a sentence in rule 0's robot paragraph: land with `Owner-approved` before M4 starts |
| 19 | Cloud brains | Allowed only as an explicit opt-in with an indicator; local is the default. Needs matching wording in the privacy page and README before M4 ships |
| 20 | Coding-agent companion | Yes (N1 to N5), with the lines held in section 12.4 |
| 21 | Four users | Every item checked against kid, teen, non-technical adult, technical adult (section 12.1) |
| 22 | Memory and performance lane | Yes (section 13), measurement first |
| 23 | Espressif components | Take-first list adopted; spikes time-boxed to a day each; leave-out list recorded (section 14) |
| 24 | Second StackChan for the bench | Recommended yes; the owner buys it or says no |

### Recorded as agreed, flagged because it changes a published promise

- **Wi-Fi details over USB at flash time (K3).** I suggested it as an option beside the QR flow. The user guide says Home never asks for the Wi-Fi password. Recorded as: offered as an option only, never required, and the guide is reworded in the same change. If the owner did not mean to include this one, K3 is dropped with no effect on the rest.

### Still open

- **Patches or our own firmware (section 4, decision 9).** The recommendation was to decide after the work session's handover. It gates P9, P10 and where every firmware item lands.
- **Hold a child's statements for review before they become memories (G5).** No recommendation was made; it needs a design note and the owner's view.
- **The handover itself.** Not received at the time of writing. Wave 0 item Z1 cannot finish without it.

### First actions (Wave 0, in order)

1. Get the handover from the work session; correct sections 0 and 1 (Z1).
2. Park or land the in-flight movement limiter and dance v2 on a pushed branch (Z2).
3. Land the approved rule text in `RULES.md` with `Owner-approved` (decisions 10, 18).
4. Open backlog rows for every item in sections 7, 12, 13 and 14 through the usual route; lease patch numbers and memory budgets in the ledger.
5. Pin sync and changelog catch-up (Z3, Z4).
6. Start Wave 1 agents: spec (A1, A2, M0, P2 spec half), bench baseline (A5, P1), security quick wins (S1, S5, S8, Q1, Q2), tester (F1, F2), screen standard (B17), docs (H4, H8).

## 16. Lane T: build and test at speed (added 2026-11-18)

Owner requirement: building firmware, pushing it and testing it takes too long; speed is part of the plan. I do not know today's real times (clean build, incremental build, flash, bench window); T0 measures them. Targets below are goals, not measurements.

### 16.1 Principle: four loops, each as fast as it can be, and most work never reaches the slow one

| Loop | What is proven | Target time | Needs the unit |
|---|---|---|---|
| 1. Pixels and logic | Screens, faces, layout rules, gestures, games, governors, wire schema | Under 10 seconds from save to result | No |
| 2. Whole flow | Tools, turns, modes, Home and Home Assistant paths against the software unit | Under 1 minute | No |
| 3. On the unit, quick | Boot, link, memory, frame time, one snapshot, one tool round trip | Under 3 minutes from push to result | Yes, no person |
| 4. On the unit, full | 10-minute gate, hands-on checks, overnight soak | Daily | Yes, sometimes a person |

Rule: an item is not allowed a loop 3 or 4 slot until loops 1 and 2 pass. Every bug found on the unit gets a loop 1 or 2 test so it is never found there twice.

### 16.2 Items

| ID | Item | Where | Size | Acceptance |
|---|---|---|---|---|
| T0 | Measure today: clean build, incremental build, patch apply, flash by USB, update by Wi-Fi, a typical bench window, time waiting in the queue | FW, BOT | S | A table; every later item reports against it |
| T1 | **Patched tree as a real branch.** Keep the firmware as commits on top of the pinned upstream, not as patches applied to a fresh tree each build; generate the numbered patch files from the commits for release and review | FW | M | An edit rebuilds only what changed; patch files still reproduce the same image |
| T2 | Warm incremental builds: one persistent build directory per worktree, shared compiler cache across worktrees and agents, pinned component cache | FW | S | Incremental build time recorded; goal under 1 minute |
| T3 | Cloud compile check: container build with the pinned ESP-IDF on every push, with a cached layer, so cloud agents learn in minutes that it compiles, links and fits the slot, and what the static memory size is | FW, CI | M | Every firmware branch gets size and static RAM numbers without the Mac |
| T4 | **Update over Wi-Fi as the normal bench path.** Our notes record 26 seconds for a direct wireless update. The bench agent pushes candidate images by Wi-Fi to the second slot; a failed boot rolls back by itself; USB is only for recovery and first flash | FW, BOT | M | No USB step in a normal test; a deliberately broken image recovers unattended |
| T5 | App-only and assets-only images: flash or push only the part that changed | FW | S | Asset changes do not rebuild or reflash the app |
| T6 | **Live data, no rebuild.** Faces, timings, palettes, overlay positions, ring tables, mode tables, strings and screen layouts load as data; a development build accepts them over the link into PSRAM and redraws at once | FW, BOT | M | Tuning a face or a screen on the real unit takes seconds, with no build and no flash; release builds refuse live data |
| T7 | Quick smoke on the unit, fully automatic: boot, link, memory numbers, frame period, a screen snapshot compared with the golden frame, three tool round trips, movement governor status | BOT | M | Under 3 minutes from push; result posted to the branch |
| T8 | Firmware landing queue like Home's lander: branch, cloud compile and host tests, golden frames, combined image, wireless push to the bench unit, smoke, then land | FW, BOT | M | One command; no hand-run steps; a failing branch never blocks others |
| T9 | Bench that needs no person: powered USB hub with per-port power switching for hard resets, the unit on a stand that is safe for motion, a camera on the screen and ring for a recorded frame per test | bench | S | The bench agent recovers a hung unit by itself |
| T10 | Withdrawn 2026-11-18: there is one unit and no more are planned. See section 18 | owner | n/a | n/a |
| T11 | Test selection: a change runs only the tests its files touch in loops 1 and 2, full suites nightly | BOT, FW | S | Loop 1 stays under 10 seconds as the suite grows |
| T12 | Record and replay: capture real sessions from the unit (events, audio levels, sensor streams) and replay them into the software unit and host tests | BOT | M | A field bug becomes a replayable test the same day |
| T13 | Spike: screens described as data loaded at run time by the UI library, if our LVGL version supports it [unverified] | FW | S | Written finding |

Considered and not chosen: a scripting language on the unit for behavior (costs internal RAM we do not have; behavior already lives on the host, where a change is instant); chip emulation for timing (still not faithful).

### 16.3 What this does to the schedule

- T0, T1, T2, T4, T7 go into Wave 1, ahead of the UI lane, because every firmware item after them is faster.
- T3, T5, T6, T8, T9, T11 in Wave 2. T12, T13 in Wave 3.
- With T4 and T7 the daily "one combined image" becomes many small pushes a day; the 10-minute gate and soak stay daily and nightly.
- With T10 the calendar estimate could shorten by one to two weeks. Without it, T4 to T8 still remove most waiting but not the single-unit queue.
- Risk: T1 changes how the patch series is kept. It must reproduce the exact released image before anything else builds on it, and it depends on the own-firmware decision only in where the branch lives.

## 17. Operating model: little owner time, no pausing, many sessions (added 2026-11-18)

Owner requirements: his involved time is minimal; work does not pause waiting for him; work runs in many parallel sessions, cloud included.

### 17.1 What only the owner does

Everything else is done by agents (org rule: "you run the commands, never Jesse").

| Owner-only | How it is kept small |
|---|---|
| Change a rule in `RULES.md` | Rule text is drafted, with the evidence, and queued; he answers yes or no |
| Ship to the live hub or to the family's own robot | One batched release a week, one yes |
| Hands-on checks (pick it up, pet it, speak across the room, judge a face or a sound) | Batched into one 15-minute session, twice a week, with a checklist of at most 10 steps |
| Buy hardware, third-party sign-ins, physical moves of a unit | Asked once, with the exact item |
| Product taste calls that are not reversible | Queued with a recommendation and a default |

### 17.2 Decisions never block work

1. **Decision queue, not questions in chat.** One file, `docs/plans/stackchan-decisions.md`: each entry has the question, the recommendation, what happens by default, the date the default takes effect, and what is blocked meanwhile. The owner reads it when he wants; a push notice goes out only for an entry that blocks more than one lane.
2. **Defaults on a timer.** A reversible decision takes its recommended option after 24 hours with no answer and is marked "defaulted" so it can be reversed. Rule changes, shipping, spending and anything touching children's protections never default; work routes around them.
3. **Agents decide what is theirs.** Naming, layout within the screen standard, test design, refactors, patch numbering, memory trade-offs inside a leased budget, which of two equal libraries: decided by the agent, recorded in one line, never asked.
4. **A blocked item is swapped, not waited on.** Each lane keeps three ready items. An agent that hits a blocker files it in the queue and takes the next item in the same turn.
5. **Standing approvals** (proposed; each needs the owner's one-time yes, recorded in memory): land to `main` through the lander in `bot`, `stackchan`, `commons` and `home` when the gate is green; tag `commons` spec versions; flash and wirelessly update the bench units (not the family's robot); start and archive cloud sessions for this plan; open backlog rows.

### 17.3 Sessions

| Session | Where | Lives | Job |
|---|---|---|---|
| Coordinator | Mac Studio, long-lived | Whole project | Holds the plan, ledgers and decision queue; starts and feeds lane sessions; merges; writes the daily digest; the only one that talks to the owner |
| Bench | Mac Studio, long-lived | Whole project | Owns the test units; runs the quick check and gate on every candidate; reports numbers |
| Firmware lanes (3 to 4) | Mac worktrees | Per item | Build and renderer work that needs the toolchain |
| Cloud lanes (8 to 10) | Cloud sessions, one per item | Hours, then archived | Spec, Bot service, Home, tester, docs, catalog, cloud compile checks |
| Reviewer | Cloud | Per change | Independent review of safety, auth and governor changes |

How they stay in step:

- **One item, one session, one branch, one handoff file.** A session is started from a prompt that names the item, its acceptance test, its files, its dependencies and its ledger leases. It ends by pushing its branch, writing a five-line result, and stopping. No session waits on another: dependencies are met by pinned tags or stubs.
- **Cloud work lands without the owner.** Today cloud sessions stop at "pushed; landing needs your Mac" (several recent sessions ended this way). Item O1 fixes that: the Mac's lander watches for branches from this plan, runs the gate, lands or reports, and tells the coordinator. Nobody types a land command.
- **Scheduled checks, not a person watching.** The coordinator wakes on a schedule (and on lane results) to assign the next items, so work continues overnight.
- **Daily digest.** One short page a day: landed, in flight, blocked, numbers from the bench, decisions that defaulted, what needs the owner (usually nothing). A push notice only for a stop-the-line event: a safety regression, a dead unit, or a decision that blocks more than one lane.

### 17.4 Items

| ID | Item | Size | Acceptance |
|---|---|---|---|
| O1 | Lander picks up plan branches from cloud sessions by itself in each repo; result posted back | M | A cloud session's work reaches `main` with no person and no hand-run command |
| O2 | Decision queue file, default timer, and the notice rule | S | First entries are the open decisions in section 15 |
| O3 | Ledger: patch numbers, tool names, memory budgets, bench slots, item owners | S | Two agents cannot take the same number |
| O4 | Item prompts generated from this plan (one per item, with acceptance and files) | S | Any session can be started from its prompt alone |
| O5 | Coordinator schedule and daily digest | S | A digest exists each day; work is assigned overnight |
| O6 | Standing approvals recorded once | S | Listed in memory with the date and scope |
| O7 | Owner test session kit: a checklist page the owner taps through, results recorded | S | 15 minutes, twice a week |

O1 to O6 are Wave 0. They come before any lane starts, because every later hour depends on them.

### 17.5 What the owner's week looks like

- Two 15-minute hands-on sessions.
- One weekly release yes.
- The decision queue when he chooses, usually five minutes.
- Nothing else unless a stop-the-line notice arrives.

## 18. One unit only: the virtual unit carries the load (added 2026-11-18)

Owner, 2026-11-18: "we only have the one unit", "which is why i asked about a virtual environment / tester". Every earlier line that assumes a second or third unit is withdrawn (T10, decision 24, the "second unit" risk answer). The plan is reshaped around that.

### 18.1 What changes

1. **The virtual unit is Wave 1's first deliverable, not a tester lane on the side.** F1 (scenario runner), F2 (golden frames) and F3 (software unit) move ahead of every UI and behavior item. Q4 (ESP-IDF's host target) is tried first as its base, with our existing real-code renderer as the fallback.
2. **Every session gets its own virtual unit.** It runs anywhere, including cloud sessions: the real drawing and logic code, the same link to the Bot service, mouse and keys for touch and handling, a drawn head and ring, files for microphone, speaker and camera, a fake clock. Ten agents means ten virtual units.
3. **The real unit is only for what the virtual one cannot show.** That list is short and fixed: memory and frame time, radio, real audio (wake word, echo, speaker), camera, servos, touch feel, heat, battery. Everything else is forbidden from asking for it.
4. **The real unit's time is rationed by the coordinator.** One queue, one bench agent, wireless pushes (T4), the 3-minute quick check (T7), and a nightly window for the 10-minute gate and soak when the family is not using it.
5. **The unit is also the family's robot.** It always ends a bench window on the last released image unless the owner said to leave a test image on it. A test image that fails rolls back by itself (T4).
6. **Predict, then confirm.** The cloud compile check (T3) reports static memory and image size for every branch, and the memory governor's declared peaks (P2) are summed before a bench slot is granted. A branch predicted to break the gate never reaches the unit.
7. **Record once, replay everywhere (T12 moves to Wave 2).** Each real session on the unit is recorded: events, sensor streams, audio levels, timings. Virtual units replay them, so one real run feeds many agents.
8. **A dead unit stops only the hardware checks.** Feature work continues on virtual units; the release waits.

### 18.2 What the virtual unit must pass before anyone trusts it

| Check | How |
|---|---|
| Same pixels | Golden frames from the virtual unit match snapshots taken from the real unit for every face, overlay and screen |
| Same wire | The same contract tests pass against the fake, the virtual unit and the real unit |
| Same behavior under the governors | Recorded carried, tilted, low-battery and plugged-in sessions replay to the same motion decisions |
| Honest gaps | A check that depends on timing, memory, radio, audio or motors is labeled "needs the unit" and cannot be marked passed virtually |

### 18.3 Revised first actions

1. Handover from the work session (Z1). At last read it had flashed and locally committed the movement limiter and dance v2 and was waiting for the owner to test (play a song, pick up or tilt the robot). It has not written the handover, and it has used about 830,000 of its 1,000,000-token context, so the handover should be written before it does more work.
2. O1 to O6 (lander pickup, decision queue, ledger, prompts, schedule, approvals).
3. Virtual unit: Q4 spike (one day), then F1, F2, F3 in parallel on three sessions.
4. T0, T1, T2, T4, T7 on the Mac.
5. Then the lanes, each on its own virtual unit.

### 18.4 A limit on parallel sessions

The work session's status showed a seven-day usage warning on the account. Running 10 to 15 sessions at once will reach account limits sooner. The coordinator sizes the number of sessions to the remaining allowance and prefers fewer, longer cloud sessions per lane over many short ones. I do not know the account's actual limits.

### 18.5 The virtual unit is a visual simulator (added 2026-11-18)

Owner: it should be like the Reachy Mini simulator: see the robot on screen, rotate it, interact with it. F3 as first written was a flat window with a drawn head. It is widened:

| ID | Item | Size | Acceptance |
|---|---|---|---|
| F3a | Core virtual unit, headless: real drawing and logic code, the real link, scripted events, PNG frames (what CI and agents use) | L | As F3 before |
| F3b | 3D view in the browser: a model of the robot you can orbit and zoom; the real screen frame shown live on its face; the 12 ring lights glowing in their real colors; the head turning and nodding through a simple servo model (speed and range limits, no physics engine) | M | Opens from one command on the Mac, and from a cloud session through its preview link |
| F3c | Interaction: click or drag on the screen for taps and swipes; click the head strip to pet; drag the body to pick up, tilt, turn upside down or shake (feeds the motion sensor, so the movement governor reacts); plug and unplug power; battery slider; day and night; microphone from the computer or a file, speaker to the computer; a webcam or video as its camera | M | A person with no robot can set it up, talk to it, pet it, pick it up and play a game |
| F3d | Side panel: governor status and reasons, memory governor status, current mode, last tool calls, event log, record and replay controls | S | The same numbers Home's health tab shows |
| F3e | Embed the same view in Home's robot page as the live mirror (G6) and in the docs site as a demo | S | One component, three places |
| F3f | Second body: Reachy Mini shown through the same shared interface (its own MuJoCo simulator already exists and the Bot's tests can run against it) | later | Same contract tests |

Notes:
- Prior art: `qua121/stackchan-simulator` (Apache-2.0) uses three.js with the screen as a texture on the head; we take the pattern, not MuJoCo.
- The 3D model: the official app ships a model of the robot (`stack_chan_model.glb` in the StackChan-GPT fork's app assets); its license must be checked before use. Fallback: simple shapes drawn in code.
- The 3D view never replaces the headless core: tests run without it.
- Estimate: 6 to 9 days for F3b to F3d on top of F3a.

### 18.6 3D view: start from an existing project, face first (added 2026-11-18)

Owner: wants 3D, wants an open source project we can easily use, and "we can start with the face and have motion later".

**Base: `qua121/stackchan-simulator` (Apache-2.0, compatible with our AGPL repos).** It is the only StackChan-specific 3D simulator found (a web search for others found none). It already has what the first step needs: a three.js scene with orbit controls, the robot's meshes in a base, pan and head hierarchy, the screen drawn as a live texture on the front of the head, a FastAPI server with a WebSocket, one contract file for its messages, 35 tests and CI. Its meshes come from rostack-chan (Apache-2.0) with notices. Read by an audit agent, not run.

What we change:

| Step | Work | Size |
|---|---|---|
| 1. Face first | Replace its redrawn JavaScript face with frames from our real-code renderer, streamed over the WebSocket to the head texture; keep orbit and zoom; head fixed | S to M |
| 2. Touch | Clicks and drags on the textured screen become taps and swipes sent to the virtual unit | S |
| 3. Ring | Twelve glowing lights driven by our ring commands (the project has none) | S |
| 4. Motion, later | Drive pan and tilt from our head commands with a plain speed and range model; its MuJoCo physics stays optional and off by default | M |
| 5. Handling, later | Drag the body to lift, tilt and shake; feed the movement governor | M |

Things to check before step 1 ships:
- **The body shape.** Its meshes are the classic community shell, not the M5Stack K151 body we own [unverified which it matches]. Candidates for the right shape: M5Stack's published K151 structure files (license not checked) and the 3D model in the official app (`stack_chan_model.glb`, 3.3 MB; license not checked). Until one is cleared, the classic shell or plain shapes are used; the face is correct either way.
- **Its open routes.** The audit found no authentication on its WebSocket and state-changing routes. Ours binds to loopback and takes a token.
- Notices: keep its NOTICE and the rostack-chan attribution.

General robot viewers were also found (NASA JPL's `urdf-loaders`, `mechaverse` under MIT). They are a fallback for Reachy Mini and later bodies, which have standard robot description files.

Order in Wave 1: F3a headless core and step 1 in parallel; steps 2 and 3 next; steps 4 and 5 after the movement governor is in the spec.

## 19. Faces, our own illustrated characters, people and personalities (added 2026-11-18)

Owner questions: the anime-style faces were ruled out or left out, and making our own is a good idea; should the robot support several users (what to call you, your face and color); are personalities included; are adding and updating our faces included, given other projects have many faces and more color.

### 19.1 What the plan already had, and what was missing

| Topic | Already in the plan | Missing until this section |
|---|---|---|
| Our drawn faces | Motion pass (B1), emotion vocabulary (B2), overlays (B3), lip sync (B4), system-state faces (B5), reflex faces (B6), face packs as data (B14) | A target for how many faces, and a color plan |
| Illustrated faces | B14b, deferred and "only on a yes" | Now a yes: our own original characters |
| Several users | Speaker identity by voice (C7), face recognition measured and opt-in (C8), Home's people roster already reaches the robot | Per-person preferences applied by the robot; a way to say who you are without recognition |
| Personalities | Home's companions (personality, voice, look) already drive how the robot talks; four are bundled | A companion did not carry a face, colors, motion style or sounds for the robot |

The work session has a "Face Design Board" artifact from 2026-11-16 that I have not read; lane B starts from it.

### 19.2 Drawn face set: more faces, more color (B18, M, bench)

Today: 17 faces, 7 palettes and a night face, two decorators. The field: the xiaozhi fork has 21 expressions and 13 overlays; Nous-Girl 12 emotes in three characters; alive 4 personas by 6 states.

- **Target: about 30 expressions** in one consistent style. Add to today's set: laughing, crying, embarrassed, proud, bored, confused, determined, mischievous, relieved, scared, grateful, focused, yawning; and real faces for dizzy and silly (today they fall back).
- **Overlays (B3) raise the count without new faces:** any face can carry a tear, hearts, blush, sweat, zzz, "!", "?", thought dots, sparkle, anger mark, music note, check, mail, pill, moon.
- **Color with meaning, not decoration:** blush pink, tear blue, heart red-pink (never the ring's red rule: the ring stays never red), anger mark orange, sparkle yellow, sleepy lavender. Mouth interior and tongue get color. Each palette defines these accents so every pack stays readable.
- **More palettes:** from 7 to about 12, plus two high-contrast palettes and a color-blind-safe set for accessibility.
- **Eye styles as a pack option:** dot (today), round with highlight, tall oval, soft square. Same expressions, different character.
- **Every face ships with:** a renderer sheet (still, blink, speaking frames, each overlay), a transition filmstrip, a fold entry in the vocabulary, and a golden frame.
- Memory: drawn faces are code and numbers; the cost is flash, not RAM. Measured with the gate as usual.

### 19.3 Our own illustrated characters (B14b promoted; L, bench)

Decision 2 in section 15 is revised: illustrated packs are a yes, built in Wave 3, with our own original art. Nobody else's art is used.

- **Method (from pet-fw and Nous-Girl, logic only):** per emotion one still of the character, plus small mouth patches (5 shapes) and eyelid patches (open, half, closed) drawn over it. Lip sync and blink come from patches, so 12 emotions need 12 stills, not hundreds of frames.
- **Budget estimate (unmeasured):** a full 320x240 still is 153,600 bytes uncompressed; 12 stills are about 1.8 MB, patches about 0.2 MB, against about 3.6 MB free in the assets partition. Read straight from flash with memory-mapped assets (Q3), so internal RAM cost should be near zero. Simple compression for flat-color art is a bonus, not required. A pack that fails to load falls back to the drawn face.
- **Where the art comes from:** Home already makes pictures and keeps characters consistent across shots. A pack builder in Home (G11, M) generates a character's emotion sheet from a description or a reference, a person reviews and fixes it, and a validator checks size, patch alignment and safe areas. Art we ship is original, reviewed by a person, and licensed with the repo; the starter set is offered CC0 like our drawn starter faces.
- **First characters:** two original characters at launch, chosen by the owner from generated candidates (a decision queue entry, with candidates shown as sheets). The companions' existing looks are the natural starting point, so a companion can appear on the robot as itself.
- **Limits:** illustrated packs follow the same emotion vocabulary, overlays and system-state marks (muted, vision off, offline) as drawn faces; privacy marks are never hidden by art. Child-band robots only load packs marked for everyone.
- **Community packs:** the pack format, validator and preview sheet are public; packs install from the Catalog (G9).

### 19.4 Several people, one robot (C11 to C14)

Rules that stay: the robot's controls set the band and identification never raises it; an unknown speaker reaches no memories; the unit never receives a name, birthday or memory (it receives a palette, a pack id and audio).

| ID | Item | Where | Size | Acceptance |
|---|---|---|---|---|
| C11 | Per-person robot preferences in each person's Home profile: what to call them, favorite palette or face pack accent, greeting style, volume preference within the band's cap | SPEC, HOME | M | Editable by the person (a child's by a parent); used by any robot body |
| C12 | Applying them: when voice or face identification is confident (C7, C8, both opt-in), the robot greets by the chosen name, shifts to that person's color accent, and shows a small colored mark for who it thinks it is talking to; when unsure it stays neutral and says nothing personal | BOT, FW | M | Wrong-person rate measured before default on; one tap or "that's not me" corrects it |
| C13 | No-recognition path: "who's here?" by voice ("it's Sam") checked against voice only if enrolled, or a picker on the robot screen with each person's color and initial; times out to nobody | FW, BOT, HOME | M | A family that never enrolls faces or voices still gets names and colors; a child cannot pick an adult to raise controls (band stays the robot's) |
| C14 | Several people at once: the robot addresses the current speaker, keeps one conversation, and keeps each person's private memories out of a shared moment (Home's existing sharing rules) | HOME, BOT | M | Test with two profiles |

Without Home (modes b and c): one local profile only at first; several local profiles are later work.

### 19.5 Personalities (E9, E10)

- **Yes, and they already exist as Home's companions.** What is added is the body: a companion pack gains optional robot parts (E9, M): face pack or eye style, palette, motion style (energy, idle level, how big the gestures are), earcon set, ring mood colors. One companion then looks, sounds and moves like itself on any body; a body without a screen folds face to light or pose.
- **One character per robot by default.** The robot stays the same character for everyone and adapts name, greeting and color accent per person (C12). A robot that changes its whole personality depending on who walks up is confusing for small children.
- **Optional (E10, S): "my companion on the shared robot".** A household may let an identified teen or adult bring their own companion to the robot for their turn, within the robot's controls. Off by default; queued as an owner decision.
- **Personality packs for standalone mode:** the same pack format works without Home with a prompt, voice and face; child and teen use still requires Home.
- Bundled companions (Rivet, Nova, Riff, Sprout) each get robot parts in Wave 3 so the difference is visible on day one.

### 19.6 Schedule and decisions

- Wave 2: B18 first half (new drawn faces and color accents), C11.
- Wave 3: B18 second half (palettes, eye styles), B14b format and validator, G11 pack builder, E9, C12, C13.
- Wave 4: first two illustrated characters, C14, E10 if approved.
- New owner decisions (queue): pick the two launch characters from candidates; E10 on or off; whether identification-based greeting by name is on by default once measured or stays opt-in (recommendation: opt-in).

## 20. Deferral register and the touch-gesture review (added 2026-11-18)

### 20.1 Everything this plan defers, rejects or leaves conditional

So nothing is deferred silently. "Owner can reverse" applies to every row.

| Item | Status in the plan | Why |
|---|---|---|
| Voice barge-in (interrupting by speaking) | Off | No working echo cancel on this board; spike Q9 could change it |
| Custom wake phrase | Not now | Second speech model costs a core and made audio choppy elsewhere |
| Sound-direction head turn | Parked | Microphones are stacked vertically |
| Continuous face following | Opt-in, not default | Off by default in 5 of 7 projects; servo wear and noise |
| Sentry mode, mmWave presence, self-charging | Not scheduled | Not in any wave; sentry needs a privacy design |
| Phone app (face mirroring, dance recorder, video call, remote control) | Not scheduled | Home in a phone browser is the app for now |
| Launcher carousel of apps | Rejected | The face is the product |
| Music visualizer and equalizer face | Later | Only the flash-rate cap is adopted now |
| Meme maker, email from the robot | Skipped | Low value for families |
| User-editable ring colors for safety states | Rejected | Safety colors keep one meaning; mood colors are editable |
| Wi-Fi setup by sound | Rejected | Novel but fragile |
| Bluetooth | Not built | Memory, radio sharing, needs a phone app |
| Matter on the unit, ESP WebRTC, ESP-Brookesia, Espressif cloud services | Left out | Section 14 |
| Secure boot and flash encryption | Decision note only | Irreversible on the one unit |
| JPEG decoder back in firmware | Spike only (Q10) | Host-sent tiles first |
| Tailnet client in the main image | Separate build | Memory gate unmeasured |
| Hub pictures and camera snapshots on the screen (B9, M2) | Conditional | Ship only if the memory gate holds |
| Touchscreen Wi-Fi keyboard | Only if it fits | QR and portal come first |
| Robot camera reads a QR code (K4), usage meter (N3), run-time screen layouts (T13) | Spikes | Unknown cost or data |
| Vowel-shaped lip sync | Only if it fits | Level-driven shapes first |
| Fixed memory pools, merged tasks (P9, P10) | Wait for the firmware decision | Hard on a patch series |
| Our own firmware instead of patches | Open | Decide after the handover |
| Standalone AI brain (M4) | Wave 4 | Needs rule wording first |
| Several local profiles without Home | Later | One profile first |
| Browser-only build of the virtual unit (F5), Reachy Mini in the 3D view (F3f) | Optional, later | |
| Scripting language on the unit | Rejected | Internal RAM |
| Chip emulation | Rejected | Not faithful for timing |
| Holding a child's statements for review (G5) | Open | Needs a design note |
| Second and third units | Withdrawn | One unit only |

### 20.2 Touch gestures on the robot: what exists

From the firmware patches and the user guide at 0.2.213. The owner also described a center gesture that changes to a clock or other view; no clock is in the repository I can read, so that is either newer work on the Mac or an idea. The handover should say which.

| Gesture | Does today | Source |
|---|---|---|
| Tap the face | Start listening; tap again to stop | patch 047 |
| Tap the mouth | Mute on or off | 105 (was a 0.5 s hold until 0.2.72) |
| Tap an eye | Vision off or on | 105 |
| Tap the forehead | Full quiet on or off | 105 |
| Swipe left / right | Volume down / up by 10, with a toast | 036 |
| Swipe down | Stop talking | 036 |
| Swipe up | Quick settings: volume, brightness, saved Wi-Fi, Done | 036 |
| Pet or tap the head strip | Smile or heart | several |
| Touch during a ringing timer | Ends the ring | 093 |
| Hold the power key | Shut down | 114 |

A swipe-down control panel was written (patch 045) and never flashed. The user guide lists only tap, pet, shake, swipe up and the power key: the volume swipes, the stop swipe and the three privacy taps are not documented for the family.

### 20.3 Review: what works and what should change

I have not used the unit. This is a design review from the code, the docs and what the 15 projects do, to be tested on the virtual unit and then by the four kinds of user.

Works and stays:
- Tap to talk, tap to stop. Every project does this.
- Swipe up for quick settings. Discoverable once shown, and it matches the request for big controls.
- Touching the screen ends a ringing timer.

Problems:

1. **Three privacy switches sit on single taps inside the tap-to-talk area.** A child poking an eye turns vision off; a tap meant to start listening that lands on the mouth mutes the robot instead. They are also invisible: nothing on the face says the mouth is a button. The earlier hold was changed to a tap in 0.2.72, I assume at the owner's request for speed, so this is raised as a question with a measurement, not a ruling.
2. **Left and right swipes change volume.** It is hidden, coarse (steps of 10) and easy to trigger while wiping or petting the screen. It also uses up the one gesture people expect to move between views, which blocks a clock, a "now" card or any second page.
3. **Swipe down means stop only while talking**, and nothing otherwise. A gesture should do one thing everywhere.
4. **No way to learn any of it.** No hint, no first-run tour, and the guide omits most gestures.
5. **Nothing is locked for a child.** Brightness, volume to the maximum, Wi-Fi switching and the privacy toggles are open to anyone who touches the screen.
6. **Gestures are spread over several patches** with their own thresholds; the gesture library gives direction only, so edge swipes ("from the sides") need the zone code from patch 105 extended.

### 20.4 Proposed gesture map (B19, M, bench; needs the owner's yes)

One rule: **tap talks, sideways moves between views, up is controls, down dismisses, hold is deliberate.**

| Gesture | Proposed | Change from today |
|---|---|---|
| Tap anywhere on the face | Listen; tap again stops | Same, but the mouth, eyes and forehead no longer steal taps |
| Swipe left / right | Move between views with page dots: Face, Clock, Now (timers, reminders, weather if installed), and installed packages such as a game. Returns to Face after a short idle | Replaces volume swipes |
| Swipe up | Quick settings, page 1: volume and brightness sliders, then big toggles for Mute, Vision, Quiet. Page 2: night, idle motion, Wi-Fi, info | Privacy switches become labeled buttons |
| Swipe down | Dismiss whatever is on top: speech, a ringing timer, a card, quick settings | One meaning everywhere |
| Hold the mouth, an eye, or the forehead for about 0.7 s | Shortcut for mute, vision off, full quiet, with a fill animation so it is visible and cancellable | Hold instead of tap; or keep taps if the accidental-toggle count on the unit is low (measured first) |
| Drag up or down along the right edge | Volume, fine steps, with a level bar | Replaces left and right for volume; optional |
| Hold the center for about 1.5 s | Settings and info (same as quick settings page 2) | New; matches Nous-Girl |
| Head strip | Pet reactions | Same |
| Any touch while a timer rings | Stops it | Same |

Supporting rules:
- **Child band:** volume capped, Wi-Fi and info pages locked, privacy switches can always be turned on (more private) but turning them off follows the parent's setting (S7).
- **Hints:** a first-run tour of four screens; faint chevrons for a second after wake; "what can I do?" answered by voice with the gestures.
- **Gestures as data:** one table in the shared spec maps gesture to action per view, so the map can be tuned live on the unit (T6), tested on the virtual unit, and reused by another body with a touch screen.
- **Ignored touches:** while the head is moving, and for a moment after a shake or lift, so handling does not trigger controls.
- **Clock view:** large time, date, next timer or alarm, in the active palette, dim at night; shown by swipe and optionally as the idle view (a setting).
- **Docs:** every gesture in the user guide with a renderer capture.

Decision queue entries: adopt the map; privacy shortcuts as holds or keep taps (after the accidental-toggle count); clock as an optional idle view.

## 21. Build what is best: the deferrals reopened (added 2026-11-18)

Owner: "dont be limited to what we did or didnt do. we should build what will be best." Section 20.1 leaned on our own history (a patch that failed, a feature that was parked). That is the wrong test. New rule for this plan:

**A "no" must rest on physics, safety, privacy or product judgment, never on what we tried before or what is easy on the current patch series.** Where the best design needs a different architecture, the plan builds the architecture.

Correction to section 20.2: the owner confirms the clock view is in the code (newer than the 0.2.213 tree I can read). The gesture proposal in 20.4 therefore integrates the existing clock rather than adding one, and the handover must list the current gestures as they really are before B19 changes anything.

### 21.1 Items reopened, with the best-design target

| Item | Was | Target now | How |
|---|---|---|---|
| Talking over the robot (voice barge-in, full duplex) | Off | **Yes. Natural interruption within about 300 ms (goal).** | Three routes, tried in this order and measured: (1) echo cancel on the unit with a correct reference: our failed attempt used the second microphone as the reference; the right reference is the audio being played, taken from the codec's loopback if the board routes one [verify on the schematic] or fed in software with delay alignment; (2) echo cancel on the host, which knows exactly what it sent to the speaker and has the CPU for a strong canceller; the unit only streams the microphone while speaking; (3) both, with the on-unit stop word as the fast path. Add ducking, a host check that the speech is addressed to the robot, and Home's talk-over rules. New item V1 (L, bench). |
| Wake word | One fixed phrase | **The robot answers to its own name, chosen by the family, with fewer false wakes than today.** | A wake-word maker: generate training speech locally with Home's voices, train a small model on the Mac, publish it as a catalog package, load it from the assets partition. On the unit a small detector; on the host a second check before the turn opens (two-stage), which removes most false wakes. Sensitivity setting and a "say it now" test. New item V2 (L, bench). Replaces "custom wake phrase: not now". |
| Turning to whoever speaks | Parked (microphones stacked vertically) | **Yes, by sight and sound together.** | The microphones cannot give left or right; that is physics. The camera can: when a voice starts, pick the face that is talking (mouth movement, nearest, most centered) and turn to it. New item V3 (M, bench), uses on-unit detection if Q8 fits, else the host. |
| Following a person | Opt-in | **Good enough to be on by default: slow, quiet, small, and never fighting a command.** | Deadband, smoothing, speed cap, torque release, the movement governor, single writer. Default decided by a noise and wear measurement, not by habit. C3 upgraded. |
| Pictures on the screen | Conditional | **Yes: weather, cameras, photos, cards.** | Whichever measures best: light decoder (Q10) or host tiles (B9). The memory work in section 13 exists to make room. |
| Away from home in the normal image | Separate build | **Yes, one image.** | Fits after the memory governor and stack work; the governor pauses lower-priority subsystems when the tunnel is up. |
| Phone experience | Not scheduled | **Yes: an installable web app from Home** with the robot page, live face mirror, talk-through, head control under the governor, dance teach, notifications. The native app remains MaiPai Go's job. New item G12 (L). |
| Music face and visualizer | Later | **Yes**, with the flash-rate cap. B20 (M). |
| Sentry and presence | Not scheduled | **Designed properly, then built**: a privacy design note first (who is told, what is kept, indicators, child rules), then motion-triggered alerts through Home. E11 (design S, build L). |
| Apple Home, Google Home | Left out on the unit | **Yes, as a bridge in the Bot service** (Matter), so the robot appears there without Home or Home Assistant. M7 (M), after M3. |
| Secure boot and flash encryption | Decision note only | **Yes for release builds**, as a documented build option with a recovery story, proven first in Espressif's emulator (which models the fuses) so the one unit is never bricked; development units stay open. S10 upgraded (M). |
| Fixed memory pools, few tasks, binary wire, no JSON on the unit | Waiting | **Yes**: this is the best design for a device with this little internal memory. It lands in our own firmware (below). |
| Several local profiles without Home; standalone brain | Later | Standalone brain moves to Wave 3; local profiles follow it. |

### 21.2 Our own firmware (decision 9 answered on merit)

Our own design note from 2026-10-14 already says a firmware of our own "is the better design on merit"; patches were chosen for speed. Everything this plan now asks for (governors, one wire schema, fixed pools, a host build for the virtual unit, live data, signed updates, full duplex audio, one image with the tunnel) is easier, smaller and faster in a thin firmware we own than in 128 or more patches over two moving upstreams. The work session already started this ("wave 0", its own repository, a unit protocol note).

Recommendation, recorded as the plan's direction unless the owner says otherwise:

- **Target:** our own thin firmware in `getmaipai/stackchan`: drivers reused from M5Stack and Espressif with notices; our protocol generated from the shared spec; our screens on the style standard; governors, indicators and safety limits on the unit; everything else on the host.
- **Bridge, not a big bang:** the patched firmware keeps the family's robot working. The new firmware is built against the virtual unit and the ESP-IDF host target first, then boots on the real unit in the nightly window, subsystem by subsystem (display and touch, ring, servos, audio, camera, link, update). It replaces the patched image only when it passes the same contract tests, golden frames and gates.
- **No double work:** from now on, new logic is written as portable modules (faces, gestures, governors, views, games) that build for the patched tree, the new firmware and the virtual unit. Only drivers and glue differ.
- **Lane X (new):** X1 repository and build on the current ESP-IDF with the host target (M); X2 wire protocol from the spec (M); X3 display, touch, ring (M); X4 servos with the governor (M); X5 audio in and out with the echo-cancel design of V1 (L); X6 camera (M); X7 link, pairing, signed update, rollback (L); X8 parity gate and switch (M). Two firmware agents, starting in Wave 2, in parallel with lane B on portable modules.
- **Risk stated plainly:** audio quality and the echo canceller are the hard part and may take longer than everything else; that is why V1's host-side route exists.

### 21.3 What still stays "no", and the real reason

| Item | Reason |
|---|---|
| Left or right from sound alone | Physics: both microphones are on one vertical line |
| Bluetooth for setup | Product: QR and the portal cover it; it would cost memory and airtime for a path only a phone app could use. Revisit with G12 if web Bluetooth proves worth it |
| A launcher of apps as the home screen | Product: the face is the home screen; views are reached by swipe |
| Espressif's cloud services | Privacy |
| A scripting language on the unit | Revisit after the new firmware's memory numbers; today it would starve audio |
| Chip emulation for timing | It does not reproduce timing; it is used only for fuse and boot checks |
| User-editable colors for safety states | Safety: one meaning everywhere |
| More test units | Owner: one unit |

### 21.4 Schedule effect

- Wave 1 adds: V1 route measurements (reference signal check on the board, host canceller trial on recorded audio), V2 data and training pipeline on the Mac.
- Wave 2 adds: lane X starts (X1 to X3), V3, B20, G12 design.
- Wave 3 adds: V1 and V2 on the unit, X4 to X6, G12, M7, E11 design, secure boot proof in the emulator.
- Wave 4 adds: X7, X8 and the switch to our firmware, E11 build.
- Estimate: this adds about three to four weeks to the full program (about 13 to 14 weeks to the end of wave 4), with two more firmware agents. The family-visible improvements in waves 1 to 3 are not delayed, because they are written as portable modules and ship on the patched image first.

## 22. Review of our own firmware and docs: what was covered, and fixes not yet in a lane (added 2026-11-18)

### 22.1 What the review was, stated plainly

- **Covered:** the public `getmaipai/bot` repository at firmware 0.2.213 (2026-11-17): its docs, backlog, changelog, the patch list and patch headers, the host code structure, the settings keys, and Home's robot code. An agent read these and wrote [round2/bot-state.md](../reports/stackchan-ecosystem-audit-attachments/round2/bot-state.md) with file and line evidence; I read its report and spot-checked the user guide, the control-panel note, the robot API and the HAL seam.
- **Not covered:** a line-by-line review of the 128 patches or of the host's Python for bugs; anything newer than 0.2.213 on the Mac (the clock view, the movement limiter, dance v2, the own-repository work); behavior on the unit. Nothing was run.
- **So:** the plan reflects every gap that review found in what was built, promised, documented and secured. It does not yet reflect a code-quality review, and it will change when the handover arrives. Item R1 below schedules the missing review.

### 22.2 Findings already placed in lanes

Promised-but-missing features (section 1.2), memory budget (1.4), version and pin drift, missing wire schema and the five undefined tools, Home's missing settings keys and unmounted robot card (1.5), plain-text link, hash-only update check, open setup hotspot, no encryption at rest, no child lock, no egress capture (lane S), stale README, setup guide and user guide (lane H), gestures (section 20).

### 22.3 Findings from the review that had no item until now

| ID | Finding | Fix | Size |
|---|---|---|---|
| R1 | No line-by-line review of the patches and host code has been done | A read-only review by two agents (firmware patches; host Python), each bug or risk filed as its own row; runs in Wave 1 alongside the handover | M |
| R2 | The photo upload route accepts the device token in the address (`?token=`) | Header only (already in S1; listed here so it is not lost) | S |
| R3 | The pairing token is visible in the process list on the host (`--pairing-token` on the command line) | Read it from a file or the keychain | S |
| R4 | The Bot's debug dashboard lets any local page call `POST /api/primitive/*` and `/api/muted` with only a same-origin check | Require the admin token on state-changing routes | S |
| R5 | The camera ring does not light during silent local watching (`stream(silent=True)`), by design | Revisit against the indicator rule in section 6: decide whether "the camera is on" always shows, even when frames stay on the host; owner decision with a recommendation of always showing a low, steady mark | S |
| R6 | The update file is downloaded over plain HTTP and checked only by a hash sent on the same plain link | Closed by Q1 (signature checked on the unit) and S2; until then, say so in the docs | n/a |
| R7 | The setup page sends the Wi-Fi password from phone to robot over an open hotspot | Closed by S4; until then, say so in the setup guide | n/a |
| R8 | An "independent security review" is cited but its text is not in the repository | Commit it or remove the citation | S |
| R9 | `bump.sh` checks only six early patches against a new upstream commit | Check the whole series, or retire it when T1 lands | S |
| R10 | The user guide says "shake it or lift it"; lifting is not detected | B6 builds lift detection; fix the sentence now | S |
| R11 | Night volume is "40 percent" in the guide and "half" in the changelog; idle shutdown is 10 minutes in one note and 60 in the changelog; the faces note says the new faces are off while the code says on | One reference page generated from the code's own constants (H7), so numbers cannot drift | S |
| R12 | The changelog has two "Unreleased" headings, a misplaced version and a duplicate entry; the backlog says the StackChan body is "not built yet" | Clean up with Z4 | S |
| R13 | A referenced note is missing (`stackchan-self-healing-2026-11-13.md`); about 45 dated developer notes supersede each other with no index | An index page marking each note current, superseded or historical (as Home's `docs/design/INDEX.md` does) | S |
| R14 | The license of the patch series is not stated in one place (repo is AGPL-3.0; notices say parts are MIT) | One licensing page: what is ours under AGPL, what is derived MIT with notices | S |
| R15 | `measurements.md` has no StackChan rows; duplex, latency, stop-word reliability, face recognition rates and wake-word cost were never measured | A5, P1, C1, C8, C10 fill it; H8 publishes it | n/a |
| R16 | The firmware version identity is split (`pins.toml` says `1.5.1-maipai.1`; the unit reports a build-time value) | One version source | S |
| R17 | The profile lacks `mic` and `screen` capabilities that Home's self test expects (BOT-SELF-TEST-01) | Add with A1's capability work | S |
| R18 | Five built pieces are not wired or have no caller: `speaker_gaze.py`, `ambient_vision.py`, `robot/display.py`, the `goodbye` earcon, most of `meeting_faces.py` | Wire (C3, B9, C12) or delete (decision 5); none left half-in | S |
| R19 | The front-shell tap is built but switched off in code | Decide in B19 with the gesture map | S |
| R20 | The README's StackChan section and Home's README barely mention the robot; no screenshot exists anywhere | H1 to H3 | n/a |

R1 to R4, R8 to R14 and R16 go into Wave 1. R5 is a decision queue entry.

## 23. Three parallel tracks (added 2026-11-18)

Owner: run parallel tracks: the virtual playground, the app, and the firmware. The lanes above are regrouped into three tracks that run at the same time from Wave 1, plus a thin shared layer. Each track has its own lead session, its own agents and its own definition of done; they meet only at the shared spec.

### 23.0 Shared layer (small, first, never a bottleneck)

- **Owns:** `commons/spec` (robot interface, wire schema, vocabularies, settings keys), the ledger, the decision queue, the lander pickup, the daily digest.
- **Lanes:** O (operating model), the spec halves of A1, A2, M0, P2, B2, B19, plus Z (wave 0).
- **Agents:** coordinator, one spec agent, one reviewer.
- **Contract between tracks:** a track never waits for another track's code, only for a spec tag. Until the real thing exists, each track builds against the fake body and the recorded sessions.

### 23.1 Track 1: Virtual playground

Goal: anyone, and any agent, has a robot on their screen that runs our real screens and logic, in 3D, without the unit.

| Stage | Delivers | Items |
|---|---|---|
| P-1 | Headless virtual unit: real drawing and logic code, real link, scripted events, fake clock, PNG frames | F1, F3a, Q4 spike |
| P-2 | Golden frames and layout checks in CI; every face, overlay, screen and view as sheets | F2, B17 checks |
| P-3 | 3D view, face first: real frames on the head of the `stackchan-simulator` scene; orbit and zoom | F3b step 1 |
| P-4 | Touch on the 3D screen, ring lights, side panel | F3b steps 2 and 3, F3d |
| P-5 | Motion and handling: head from our commands; drag to lift, tilt, shake; governors visible | F3b steps 4 and 5, F3c |
| P-6 | Record on the real unit, replay everywhere; contract tests shared by fake, virtual, real and Reachy Mini | T12, F4 |
| P-7 | Embedded in Home's robot page and on the docs site; Reachy Mini view | F3e, F3f |

- **Agents:** 3 (cloud), 1 more for the 3D view.
- **Needs from others:** spec tags; snapshots from the real unit to prove "same pixels" (a few bench slots).
- **Gives to others:** every other track tests on it from P-1 onward.
- **Done when:** a person with no robot can set it up, talk to it, pet it, pick it up and play a game on screen, and its frames match the real unit.

### 23.2 Track 2: The app

Everything that runs on a computer or phone: the Bot service, Home's robot features, packages, docs.

| Stream | Delivers | Items |
|---|---|---|
| A-1 Bot service core | Movement and memory governors on the host side, brain interface, behaviors, turn quality, people and preferences | A1, A2 host, M0, C1 to C14, V3, P4 |
| A-2 Without Home | One-command install, local settings page, Home Assistant mode, camera snapshots, robot as a Home Assistant device, Apple and Google bridge, standalone brain, agent tools, coding-agent companion | K6, M1 to M7, E6, N1 to N5 |
| A-3 Home | Now card, add and update flows, health tab, live mirror, mic and wake test, memory filter, packs install, pack builder, phone web app, settings keys, speech-path gate test | G1 to G12, S9, E3, E4, E7 |
| A-4 Packages | Package host, games, stories, face packs, sound packs, companions with robot parts, wake-word maker | E0 to E2, E9, E10, B14 catalog side, B16, V2 training side |
| A-5 Docs | Four entrances, real captures, user guide, developer reference generated from the spec, measurements page, cleanup items | H1 to H10, R8, R11 to R14 |

- **Agents:** 6 to 8 (cloud).
- **Needs from others:** spec tags; the virtual unit for end-to-end checks.
- **Done when:** each of the four users can do their top tasks (section 12.1) against the virtual unit, with and without Home.

### 23.3 Track 3: Firmware

Everything that runs on the robot.

| Stream | Delivers | Items |
|---|---|---|
| F-1 Speed and truth | Measured build, flash and memory baselines; patched tree as a branch; wireless bench path; quick check; landing queue; code review of the patches | T0 to T9, A4, A5, P1, P3, R1 |
| F-2 Safety and security on the unit | Movement governor on the unit, single servo writer, memory governor, signed updates, encrypted storage, secured hotspot, encrypted link, child lock, indicators | A1b, A3, P2, S1 to S7, Q1, Q2, R2 to R5 |
| F-3 Screens and faces (portable modules) | Style standard and components, motion pass, overlays, lip sync, about 30 faces, palettes, system faces, views and gestures, quick settings, portal, QR, cards, subtitles, status bar, illustrated pack player | B1 to B20, K1, K2 |
| F-4 Audio and senses | Talking over the robot, own-name wake word on the unit, wake sensitivity, on-unit detection spike, pictures on screen | V1, V2 unit side, A6, C2, Q8 to Q10, B9 |
| F-5 Our own firmware | Repository, host build, protocol, drivers one by one, parity gate, switch | X1 to X8, P9, P10 |
| F-6 Performance and components | Safe memory wins, binary wire, plain-audio trial, Espressif spikes | P5 to P13, Q3 to Q16 |

- **Agents:** 4 to 5 on the Mac (they need the toolchain), 1 bench agent, plus cloud compile checks.
- **Rule:** F-3 is written as portable modules and proven on the virtual unit first, so it serves the patched image now and our own firmware later.
- **The real unit:** only F-1, F-2, F-4 and the final check of F-3 use it, through the one bench queue.
- **Done when:** the release gates pass on the unit and our own firmware reaches parity.

### 23.4 How the three run together

| Week (estimate) | Playground | App | Firmware |
|---|---|---|---|
| 1 | P-1, P-2 | Spec work, A-5 cleanup, A-3 settings keys | F-1 baselines and speed, R1 review |
| 2 to 3 | P-3, P-4 | A-1 governors and brain interface, A-2 Home Assistant mode, A-3 Now card and health | F-2 governors and quick security wins, F-3 standard, motion, overlays |
| 4 to 6 | P-5, P-6 | A-2 agents and companion, A-3 flows, mirror, tests, A-4 package host and packs | F-3 views, gestures, portal, faces; F-4 measurements; F-5 starts |
| 7 to 10 | P-7 | A-3 phone web app, A-4 games, stories, characters, wake-word maker | F-4 talking-over and wake word on the unit; F-5 drivers; F-6 |
| 11 to 14 | Reachy Mini view | Standalone brain, bridges, polish | F-5 parity and switch |

- From week 2 every app and firmware item is demonstrated on the playground before it asks for the unit.
- A weekly combined demo on the playground replaces most status reading: the owner opens one link and plays with it.
- The waves in section 8.4 still set the order inside each track; this section sets who works beside whom.

### 23.5 Session count

About 16 to 18 agents at peak across the three tracks and the shared layer, limited by the account's usage allowance (section 18.4). If the allowance forces a cut, the order of protection is: shared layer, playground, firmware F-1 and F-2, app A-1 and A-3, then the rest.

## 24. Who types what: Codex, the local coder, Claude (added 2026-11-18)

Owner: include the use of our local coder. The org rule already sets the order for parallel work (`getmaipai/.github` `AGENTS.md`, Jesse 2026-10-19), and `docs/local-coding-model.md` says what the local model is good for. This plan follows both.

| Lane | What | Gets | Never gets |
|---|---|---|---|
| 1. Codex (first) | Decided, verifiable work, through `scripts/wt.sh run codex` | Any item with a written brief, named files and a test that can fail; gate runs; mechanical sweeps | Design, diagnosis, rule-adjacent choices |
| 2. Local coder (second, and whenever Codex is limited) | OpenCode on the household's Qwen3.8-27B through `local-lane dispatch`, Studio only, no cost per token | Small and medium decided tasks: one to about six files with a failing test; schema, fixture and test work; mechanical refactors; follow-ups where a review named the exact fix | Anything spanning two subsystems; anything asking it to choose; files the safety floor refuses; safety, auth and governor logic |
| 3. Claude agents | Judgment and design | Design notes, briefs, reviews, firmware changes that touch timing or memory, anything ambiguous | Typing that lanes 1 and 2 could do |
| 4. Cloud Claude sessions | Parallel lanes that need a full environment and no local hardware | Spec, Home, Bot service, playground, docs | Unit bench work |

How it applies here:

- **Manager and typists.** A Claude session (the track lead) reads the design, cuts each item into pieces that fit the local model's window, writes each brief in the proven shape (one-sentence task; folder and branch; exact files; numbered rules naming function and line; the test file to add to and the test to mirror; the verify commands; the commit message), dispatches, then reads the diff, reruns the checks and compares the commit message. The typist's own report is never evidence.
- **Good fits in this plan for the local coder and Codex:** the wire schema tables and generated code (A2), spec shapes and fixtures (A1, M0, P2 spec halves), golden-frame fixtures and layout checks (F2, B17), settings keys (G7), contract tests (F4), each new face as data plus its sheet (B18), overlay definitions (B3), the docs cleanup items (R8 to R14, Z4), translations of fixed strings, per-item test backfill, portal and page markup once the design is fixed (K1), the 3D view's plain plumbing (F3b steps 2 and 3).
- **Not fits:** governors' logic (A1, P2), echo cancel (V1), security items (lane S), firmware memory work, anything on the bench, the gesture decision (B19), rule text.
- **Window limit.** The local model failed a medium task at a 32,000-token window and passed at 48,000 or more; briefs name files and lines so it does not spend its window reading.
- **Known slips to check for:** its own commit message instead of the given one, a skipped regeneration step, a widened type, a reach outside its folder, "all tests pass" with one failing. Its permissions allow no git command except commit.
- **Capacity.** One OpenCode session on the Studio and the Codex lanes are free of Claude usage, so they run continuously on a queue of ready briefs. This is the main answer to the account usage limit in section 18.4: Claude writes briefs and reviews; the free lanes type.
- **Brief queue.** Each track lead keeps at least five ready briefs for the free lanes so they never idle (O4 generates the first set from the item tables).

## 25. Kickoff belongs to the work session (added 2026-11-18)

Owner: the worker session ("STACKCHAN - WORK", on the Mac Studio) kicks this off, not the research session that wrote this plan. The kickoff brief is [stackchan-kickoff-2026-11-18.md](stackchan-kickoff-2026-11-18.md).

## 26. Reconciliation with the current work (first pass, from the docs draft only; added 2026-11-18)

**This section overrides sections 1, 9a, 12.1, 19 and 20 where they disagree.** Source: the "MaiPai StackChan Docs Draft" written by the documentation session from the current local `getmaipai/stackchan` tree, read in full by an agent and compared with every item in this plan: [round2/reconcile-with-docs-draft.md](../reports/stackchan-ecosystem-audit-attachments/round2/reconcile-with-docs-draft.md). The code itself has not been read: it is only on the Mac. The work session's own log adds: commit `cd61a75` (movement limiter, dance v2) flashed; 12-minute soak passed with about 86 KB internal free and a 33 KB low point; 4,999 host tests passing.

Caveat from the draft itself: it is "written as if v1.0.0 is finished"; most "built and flashed" items have not been checked by a person (no real voice wake, swipe feel, game by touch, sound or dance verified), and the draft contradicts itself in about ten places.

### 26.1 Where we really stand

- The product is "MaiPai for StackChan": a local `getmaipai/stackchan` tree (firmware patches with a build recipe, and a `pipx`-installed host). Unpublished, no tag, no release key.
- **It already runs without Home by default** (`brain = "llm"`, any OpenAI-compatible address); `brain = "home"` switches to Home with no reflash.
- Flashed, per the draft: five face styles, picture faces (still, still with drawn eyes and mouth, short frame loops), 26 overlays, CRT and color effects, word reactions; swipe pages (clock, timers, games, quick actions, pictures, dashboard tiles), a control sheet (volume, brightness, Mute, Quiet, Lock, Apps, Games, Settings), Apps and Games walls with themed tiles, tabbed settings, a passcode lock; seven games; voice timers and alarms with no model; wake word, replies by sentence, subtitles, fillers, six language packs; remote controls with a violet banner that cannot be hidden, find my robot, photo; movement limiter; dance to music.
- Built, not flashed: six talk games including bedtime stories; a newer Wi-Fi setup page; an on-robot face detector experiment.
- Not built: face turning, pick-up detection, scenes and data cards, live view, watching and monitor, the encrypted home link, roaming, more wake words, offline voice commands.
- Open problem: after the wake word one owner heard no reply; audio reaches the host loud and the speech engine returns no words.
- Measured: eyes 28 to 33 frames a second with gaps over 50 ms; the mouth while speaking 4 to 11 frames a second.

### 26.2 What happens to the plan's items (about 195)

| Outcome | Count | Examples |
|---|---|---|
| Drop the build | 2 | B8 (the control sheet and tabbed settings exist), E1 (seven games exist) |
| Shrink to verify, polish, flash or publish | about 48 | A1 and A1b (limiter exists: move it into the shared interface), B1, B3, B4, B10, B16, B20, E2, K1, K6, M0, M5, M6, S3 and Q1 (signature check built, never run: no release key), G6, most of lane H (a full docs set exists) |
| Change, because the built product chose differently | about 27 | B13, B14, B14b, B18, B19, S4, S7, S9, K2, K5, M3, M4, E6, E7, E11, N1, N2, N5, C10, V1, G2, G7 |
| Keep | about 117 | A2 to A6, S1, S2, S5, S6, S8, S10, all of F (virtual playground), O, P, T, X, most of G, C and Q |
| Withdrawn | 1 | T10 |

Priority changes: the "no reply after wake" problem goes first (C1, G8). The speaking-mouth frame rate makes host-computed mouth cues and the performance lane more urgent (P4, P1). Getting a release key and publishing the repository unblock signed updates and outside users (Z2, K6, Q1).

### 26.3 Conflicts between the built product and this plan, for the owner

| # | Topic | Built product | This plan | Recommendation |
|---|---|---|---|---|
| 1 | Content filter without Home | "We add no content filter", no adult label | Basic filter on, adult label, a child's robot requires Home | Plan's position; it is a safety matter |
| 2 | Cloud models | Any address, an FAQ warning | Explicit opt-in with an indicator | Plan's position |
| 3 | Privacy taps | Single silent taps on mouth, eye, forehead | Holds, or taps after an accidental-toggle count | Measure, then decide |
| 4 | Talking over the robot | Docs say it works; no test; radio was dropped because the robot answered its own speaker | Build it properly (V1) | Test the claim first; V1 stays |
| 5 | Coding companion and agent tools | Home only; shows request text; dictation to the agent; red build light | Works without Home; no prompt text on the robot; no voice to task; never red | Decide; the plan's limits are safety and privacy limits |
| 6 | Indicators | Violet remote banner, white updating, dim amber watching, red and blue alarm, two bars of six lights | Ring standard "never red", twelve lights | Adopt the banner into the shared indicator contract; settle red for alarms; correct the light layout in the spec |
| 7 | Lock | Owner passcode for the whole robot | Child lock by age band | Both: the passcode exists; add band limits pushed from Home |
| 8 | Setup | Typed six-digit setup and pairing codes; pairing needs a terminal; the flasher already takes Wi-Fi | QR, secured hotspot, no terminal | Keep the codes, add QR and remove the terminal step; K3 is already how it works |
| 9 | Faces | Five styles; six older faces deleted | Grow to about 30 expressions | Reconcile in B18 from the real face system and the Face Design Board |
| 10 | Apps wall | Exists | "Launcher rejected" | The plan was wrong: the wall exists as a page; keep the face as home |
| 11 | Bluetooth | "Saved almost no memory", under review | Cut for memory | Re-decide on product grounds only |
| 12 | Phone app, radio | Excluded | Web app (G12), music (E7) | Owner's call; radio needs echo control first, which V1 provides |
| 13 | Face turning default | Always | Once at wake | Measure noise and wear |
| 14 | Mood guessing | Removed on purpose | B2's fallback table | B2 maps named emotions only; no guessing |
| 15 | Settings in three places; names on the unit | As built | One definition (R-B5); the unit never gets a name (R-B4) | Review against the boundary rule when the code is read |
| 16 | Shared robot interface | The draft never mentions the Bot service, the spec or a second body | Everything goes through it | Largest structural gap; first job of the shared layer |

### 26.4 Still needed

A review of the code itself (firmware patches, host, tests, snapshots). It has been requested from the work session as a pushed branch `review/2026-11-18`. Until then every status above is the draft's claim.

## 27. Boundary rule: agreed replacement, and the friend without Home (added 2026-11-18)

Owner, 2026-11-18: "agreed", to the four tests below and to the public-copy trade-off; and "I want my buddy (who doesn't use MaiPai Home) to be able to use this and gain all its benefits."

This supersedes section 5 and the R-B lines of section 12 of this plan. It is a proposed replacement for the rule in the StackChan repository (`docs/dev/scope-core-vs-home.md`, including its App Store test) and it keeps `docs/design/repo-boundaries.md`'s decisions: no shared robot code repository; the shared part is a spec in `commons`; `bot` becomes the Reachy Mini repository. The plan's earlier "Bot service as a framework for every robot" is withdrawn: where the plan says "Bot service", read "the StackChan host program"; shared concepts (movement governor, memory governor, brain interface, indicators, vocabularies) are definitions in `commons/spec` that each robot's own host implements.

### 27.1 The four tests

1. **Body.** If it needs this robot's body, or must work with the host off, it lives in the robot repository. Safety limits and the camera and microphone cues are enforced on the unit.
2. **Standalone parity.** If the stock firmware or a leading community StackChan project delivers a feature with no hub, we deliver it locally too, as an optional package on the owner's own host, off by default, needing no household data.
3. **Household.** MaiPai Home is the only owner of anything about a household: several people, identity and recognition by name, shared memory, child and teen rules, outside services (weather, news, calendars, mail), other rooms, policy. A child's or teen's robot requires Home.
4. **Thin connector, one owner.** A local integration is a thin connector to someone else's system (Home Assistant's API, the agent tool protocol, a home-platform bridge). It never rebuilds a Home feature. When Home is paired, Home's version takes over; the two never run side by side.

Unchanged around them: features are packages, not firmware forks; spec first; local by default, cloud only by explicit opt-in with a cue; accepted trade-off: connectors and games are public code under AGPL.

The rule text lands in the StackChan repository by the work session, as the owner's decision dated 2026-11-18, with the tables in `scope-core-vs-home.md` and `repo-boundaries.md` updated (games, coding companion, home-automation tools and agent tools move from "Home" to "local package; Home takes over when paired").

### 27.2 The friend test (new acceptance gate for a first public release)

A person who owns a StackChan and a Mac, Linux machine or Raspberry Pi, has never heard of MaiPai Home, and has no help from us:

1. Finds the public repository, understands in one screen what it is and that Home is optional.
2. Flashes from the web flasher and installs the host with one command.
3. Joins Wi-Fi and pairs using the robot's screen and a phone, with no terminal step after the install.
4. Talks to it with a local model, with sensible defaults chosen for their hardware.
5. Uses, without Home: voice, faces and picture faces, overlays, swipe pages, timers and alarms, games, dance, privacy switches, the settings page, away-from-home, signed updates, Home Assistant voice and camera snapshots, agent tools and the coding companion.
6. Sees plainly, in one table, what Home would add and why.

The test is run on the virtual playground for steps 4 to 6 and by a real outside person (the owner's friend) for steps 1 to 3 before the first tag. Every failure is a release blocker.

### 27.3 What the friend does not get without Home, and one open question

By the household test: recognition by name, several people, child and teen rules, live outside information, other rooms.

Open for the owner: **a single adult's own memory** ("remember that I take my coffee black") is the benefit a solo user will miss most, and the household test as written keeps memory in Home. Recommendation: allow a small local memory package for one adult (explicit remember and forget, a plain file the owner can read and delete, no people, no recognition), with Home's memory taking over when paired. Queued as a decision.

### 27.4 Local memory for several people, optional, from a free component (owner, 2026-11-18)

Owner: "not just for one user, for multiple users. and ideally we use a free component to just handle this for us. but it's optional of course." This answers the open question in 27.3 and amends the household test:

- **Household test, amended:** Home remains the only owner of household policy, child and teen rules, recognition by name across the household, outside services and other rooms. Personal memory for several adults may also run locally, without Home, as an optional package. When Home is paired, Home's memory is the one owner (test 4); the local store can be imported into Home or left untouched, never both active.

Item M8, optional local memory package (M, host only):

| Part | Design |
|---|---|
| Off by default | One switch on the local settings page; with it off nothing is stored |
| The component | Use an existing free, self-hosted memory library instead of writing one. First candidate: **Mem0** (open source; keeps separate memories per user id; runs fully local with a local model, a local embedding model and an embedded vector store). Others to compare in a one-day spike: Letta (heavier, a whole agent server), Graphiti (needs a graph database), LangMem, Cognee, and the fallback of a plain SQLite file with a small vector extension. Licenses and local-only operation are to be verified in the spike before any is adopted [unverified] |
| Selection test | Runs with no network; works with the owner's own model through the same OpenAI-compatible address; per-person separation; explicit remember and forget; a person can list, edit, export and delete their memories; small install; license compatible with AGPL-3.0; acceptable speed on a Raspberry Pi 5 |
| Who is speaking | Without Home there is no recognition by name. Order of build: (1) the per-person profiles that already exist (name, eye color, caption size, wake phrase) gain "this is me" by voice ("it's Sam") or by a picker on the robot screen; (2) the per-person wake phrase, which is stored today but not matched; (3) optional voice matching with a free local speaker-embedding model, as a second optional package. Unknown speaker: nothing personal is read or written |
| Privacy | Stored on the owner's host only, one store per person, readable and deletable from the settings page; never sent anywhere except to the model the owner chose; a cue-free feature but listed on the privacy page; "forget everything about me" is one action |
| Limits | Adults only (a child's or teen's robot requires Home); no memories about other people unless they are also a profile; the model is told which person it is talking to, never the others' memories |
| With Home | Home's memory replaces it; an import tool maps each local person to a Home person with their consent |
| Packaging | An optional install extra and package, so the core stays small and the dependency is not forced on anyone |

The friend test (27.2) gains a line: with the memory package on, two people in one home each get their own memories, and each can see and delete theirs.

### 27.5 Local memory must be super simple and lightweight (owner, 2026-11-18)

Owner: "has to be super simple, lightweight". This replaces the component choice in 27.4. Mem0 and the other memory libraries need a second model for embeddings, a vector store and an extraction pass on every turn: too heavy for a Raspberry Pi host and not simple.

M8 becomes:

| Part | Design |
|---|---|
| Store | One small plain-text notes file per person on the host (for example `memory/sam.md`), capped at about 2,000 characters. No database server, no embedding model, no vector store, no new dependency |
| How it is used | The person's notes are added to the model's instructions for their turn. At this size nothing needs to be searched |
| How it changes | Two model tools, `remember(text)` and `forget(text)`, used only when the person asks ("remember that...", "forget that..."). Nothing is saved silently |
| When it is full | The oldest lines are dropped, or the person is told it is full; no background summarizing |
| Control | The settings page shows each person's notes as editable text with Delete all; the file can be opened in any editor |
| Several people | One file per profile; the active person comes from "it's Sam", the screen picker, or their wake phrase (27.4); unknown speaker means no file is read or written |
| Later, only if wanted | Search with SQLite's built-in full-text index (already part of Python, still no new dependency) if someone wants more than fits in the instructions |
| Size of the work | S (1 to 2 days), not M |

Everything else in 27.4 stands: optional, off by default, adults only, Home's memory takes over when paired.
