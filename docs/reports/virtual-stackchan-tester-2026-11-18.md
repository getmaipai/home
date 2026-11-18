# Virtual StackChan tester: research and recommendation (2026-11-18)

Status: research only. Nothing was built. Companion document: [stackchan-ecosystem-audit-2026-11-18.md](stackchan-ecosystem-audit-2026-11-18.md).
Items marked [unverified] could not be confirmed from a primary source. Effort numbers are estimates, not sourced.

## Question

Should we build a virtual StackChan tester, like the Reachy Mini simulator? What would it take, how long, is it necessary, is it worth it?

## Summary

- Build it in phases and skip chip emulation.
- We already own about 70 percent of a software StackChan: the renderer that compiles the real LVGL drawing code, the protocol fake unit, and the C core tests. The gap is joining them into one scriptable "software unit" and running it in CI.
- Phase 1 (6 to 9 days): scripted fake unit plus golden-frame screenshot checks in CI.
- Phase 2 (10 to 15 more days): desktop software unit with a window, mouse as touch, keyboard for shake and pickup, a virtual head and LED ring, audio from files, camera from a video.
- Phase 3 (6 to 12 days, optional): WebAssembly build for a no-install demo.
- Skip ESP32-S3 emulation (QEMU, Wokwi, Renode). It would not boot our image with useful fidelity and would still miss what needs real hardware.
- A simulator does not replace the real unit. It removes routine visual, flow and protocol checks from the USB queue.

## A. How others do it

**Reachy Mini (Pollen Robotics, Hugging Face).**
- The simulation runs the same daemon with a `--sim` flag and a MuJoCo physics backend (`pip install "reachy-mini[mujoco]"`, `mjpython` on macOS). https://huggingface.co/docs/reachy_mini/platforms/simulation/get_started
- A third-party guide says SDK scripts run "without modification" against it. https://wiki.seeedstudio.com/reachymini_platforms_simulation_get_started/
- Older docs describe a no-physics mockup mode. https://huggingface.co/docs/reachy_mini/v1.4.0/API/daemon.md
- In simulation the USB audio card is absent, so hardware echo cancellation is not available. Whether the simulated camera and microphone return real data is [unverified].
- Code is Apache 2.0, hardware files CC BY-SA-NC. https://github.com/pollen-robotics/reachy_mini
- Lesson: it works because the robot is a daemon behind a clean SDK, so the sim swaps the backend under that line. For a 2-axis head we do not need a physics model.

**Chip and board emulators.**
- Espressif QEMU fork: emulates CPU, memory and some peripherals of the ESP32-S3, with a QEMU-only virtual framebuffer (`esp_lcd_qemu_rgb`). https://docs.espressif.com/projects/esp-idf/en/v6.1/esp32s3/api-guides/tools/qemu.html The per-peripheral list is in https://github.com/espressif/esp-toolchain-docs/blob/main/qemu/README.md and was not read. PSRAM, touch, camera, I2S and Wi-Fi support are [unverified].
- Wokwi: lists ESP32-S3 with PSRAM, Wi-Fi simulation and ILI9341 touch parts, and has GitHub Actions integration. https://docs.wokwi.com/guides/esp32 Engine licensing, CI cost, and whether a CoreS3-class custom board can be described are [unverified].
- Renode: only a community ESP32-S3 port that calls itself work in progress. https://git.xobs.io/xobs/renode-esp32s3

**LVGL in a browser.** https://github.com/lvgl/lv_web_emscripten is MIT, uses SDL2, last commit seen Nov 2025. It is a demo build, not a recipe for a large C++ codebase.

**StackChan simulators found.**
- M5Stack's own repo has no simulator; its firmware is ESP-IDF 6.1 with host-side unit tests only. https://github.com/m5stack/StackChan
- https://github.com/qua121/stackchan-simulator (Apache-2.0, Python, 2 commits, May 2026): MuJoCo model of the 2-axis head with rate-limited, torque-clamped servo (PD gains), a three.js dashboard, and an emulator of the old AI_StackChan2 HTTP API. The face is a redrawn approximation, not real firmware code. Touch, camera and LED behavior are not simulated. Useful only as a reference for the virtual head and servo model.
- Earlier search results mentioned a Rust port "stackchan-kai"; it could not be found or confirmed. Disregard it.

## B. Options

| # | Option | Gives | Fidelity limits | Effort (first / good) | Verdict |
|---|---|---|---|---|---|
| 1 | Desktop software unit (real LVGL code, protocol, mouse and keyboard, virtual head and ring, audio files) | Whole flows end to end with no robot; contributor friendly | No real timing, RAM, radio, audio DSP, camera optics, servo dynamics | 10 to 15 / 25 to 35 days | Build (phase 2) |
| 2 | Same code as WebAssembly in the browser | No-install demo for docs and contributors | Option 1 limits plus browser limits; new build target | 6 to 12 extra days | Later, optional |
| 3 | ESP32-S3 emulation (QEMU, Wokwi, Renode) | Boots the real binary | Our touch, camera, codec, octal PSRAM and about 250 patches unlikely modeled; no timing accuracy | 20 to 40+ days, uncertain | Skip |
| 4 | Protocol-level fake unit as scripted CI harness | Fast tool-call, game and lock-logic tests | No screen; already half built | 3 to 5 days | Build first (phase 1) |
| 5 | Hardware in the loop (extra units, camera on screen) | Highest fidelity, covers audio and servos | Hardware cost and upkeep; contributors cannot use it | 8 to 15 days plus hardware | Later, small version only |

## C. Recommended architecture (options 4 then 1, option 2 later)

A "software unit" process that pretends to be the robot to the host.

- Reused as is: the desktop LVGL renderer with its fake input device, the C core tests, the host's fake unit script and protocol tests.
- New: a thin unit shell that opens the same WebSocket and speaks the same JSON and Opus frames, dispatches tool calls (face, sound, head angles, timers, games, camera) into the real UI and core code, and draws into an SDL window or a headless PNG.
- Touch, swipe, shake, pickup: mouse and keyboard in the window, scripted events in CI, sharing the bench firmware's injected-event format.
- Head: angle plus speed limit with a drawn head and neck. No physics.
- LED ring: dots drawn beside the screen from the same color commands.
- Audio: microphone from a WAV file or the computer; speaker to the computer or a file; Opus through the same library as the host. Wake word and echo are out of scope.
- Camera: video file, still, or webcam in the same frame format.
- CI: scenario scripts (events in, expected state out), golden-frame PNG comparison with a small tolerance in a pinned Linux container, a fake clock for animation, scripted game and lock flows, a frame-diff report on the pull request.
- One source of truth: a single schema file for messages and tools, checked by a CI test against the firmware tool table, the host and the fake unit.
- Licenses: our code plus LVGL (MIT), SDL2 (zlib), Opus (BSD). Check the stock StackChan base license before publishing derived drawing code (no root license file found in M5Stack's repo; firmware license not read) [unverified].
- Still needs the real unit: frame rate and timing, internal RAM and PSRAM pressure, Wi-Fi and radio, wake word and echo, speaker, camera quality, servos, motion sensor, anything on ESP32-S3 peripherals.

## D. Estimates

One experienced developer working with AI agents. Assumes the renderer builds cleanly with pinned fonts and the protocol is already schema-like.

| Phase | Scope | Days |
|---|---|---|
| 1 | Scenario runner on the fake unit, fake clock, golden frames in CI, game and lock scripts | 6 to 9 |
| 2 | Unit shell, SDL window, input, virtual head and ring, file audio, video camera | 10 to 15 |
| 2+ | Computer mic and speaker, schema sync check, docs, contributor guide, diff reports | 8 to 12 |
| 3 | WebAssembly build and hosted demo | 6 to 12 |

First useful version: about 16 to 24 days. Good version: about 25 to 35. With the browser build: 31 to 47.

Order: scenario runner, golden frames, unit shell, input and virtual hardware, audio and camera, browser.

Biggest risks: flaky golden frames (fonts, anti-aliasing, animation timing); the shell drifting from firmware tool handling; contributors over-trusting the sim; WebAssembly surprises with the C++ runtime, threads and audio.

## E. Value

- Solves: visual regression for screens and games, contributors without a robot, faster iteration, safe mass testing of lock and security flows, docs and demos (phase 3).
- Does not solve: timing, memory, radio, audio paths, camera, servos, motion sensor.
- USB time saved: no bench-window log was available. If a third to a half of windows are visual, flow or game checks, a mature sim could move that work off the queue. Measure a month of windows before committing to phase 2.
- Versus improving the renderer and bench tools: phase 1 is exactly that and is worth doing regardless. Phase 2 adds the protocol loop so whole flows run without a robot.

## F. Recommendation and plan

Build phase 1 now. Decide on phase 2 after a month of bench-window data. Defer phase 3. Skip emulation.

- Phase 1 go criterion: golden frames stable across 20 CI runs.
- Phase 2 go criterion: phase 1 visibly saves reviewer time and at least a third of recent bench windows were sim-checkable.
- Phase 3 go criterion: the docs site or onboarding clearly needs it and a one-day spike proves the C++ build works.
- HIL: revisit a second unit with a screen camera only if bench windows still queue after phase 2.
- No-go signals: golden frames flake more than about 2 percent after fixes; the shell needs reimplementing firmware logic; bench windows turn out to be mostly audio, radio and soak.

## Addendum: what the ecosystem audit changes

See the audit document. In short: nobody in the audited set has a firmware-faithful simulator. The closest ideas are host-side ctest suites (StackChan-GPT, stackchan-mcp), a host preview renderer that reuses firmware drawing code (stackchan_alive), a hardware status page with `available:false` reasons (stackchan-local), and a head and servo model (stackchan-simulator). Our existing real-code renderer is ahead of all of them; the gap is CI gating and the unit shell.
