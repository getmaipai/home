# Audit: stackchan-bluetooth-simple (mongonta0716/stackchan-bluetooth-simple)

Clone: `.../scratchpad/repos/stackchan-bluetooth-simple`. Read-only; nothing run or built. `scripts/copy_firmware.py` is a PlatformIO post-build hook (reads git, copies firmware to a remote-dev path); it was read, not executed.

## 1. What it is
- A small Arduino/PlatformIO sample that turns a Stack-chan (M5Stack Basic/Gray/Fire/Core2) into a **Bluetooth Classic speaker (A2DP sink)** whose avatar lip-syncs, pulses LEDs and swings servos to the music. Derived from M5Unified's `Bluetooth_with_ESP32A2DP` example (src/main.cpp header; README_en.md "Overview").
- License MIT (LICENSE, (c) 2022 Takao Akaki). Author Takao Akaki (mongonta0716), a well-known Stack-chan community maintainer; the README links the Stack-chan_Takao_Base hardware.
- Activity: one commit in the clone, 2026-07-31 "add for only takao function" (history squashed or shallow). Stars: [unverified]. The README mentions config changes 2022-10-18 (JSON to YAML) and 2025-03-24 (switch to the `stackchan-arduino` library), so it has lived for years and is slowly maintained.
- Languages: C++ (Arduino) only, plus YAML config and one Python PlatformIO script. Size 304KB total; everything is tiny: `src/main.cpp` 19KB, `BluetoothA2DPSink_M5Speaker.hpp` 7.6KB, `formatString.hpp` 1KB, README 6KB. Nothing large.
- Unlike the other two repos this is **not an AI assistant**: no network, no LLM.

## 2. Architecture and protocol
- Single-binary Arduino sketch: `setup()` initialises M5Unified, speaker, SD, YAML config, servo, avatar, LEDs; `loop()` handles 3 buttons and battery icon. Avatar (M5Stack-Avatar 0.10.0) spawns two FreeRTOS tasks via `avatar.addTask`: `lipSync` (30ms loop) and `servoLoop` (4096B stack) (main.cpp L150-235).
- Protocol: **Bluetooth Classic A2DP sink + AVRCP metadata** (pschatzmann/ESP32-A2DP v1.7.3). No WebSocket, no JSON, no BLE GATT. Local-only; no cloud.
- Modes: "Normal" (idle random gaze/servo + random speech-bubble "lyrics") and "Bluetooth" (BtnA single click starts, double click stops). `avrc_metadata_callback` toggles Happy/Neutral expression on each track metadata event (L238).
- Servo interface through the `stackchan-arduino` lib: `StackchanSERVO` supports PWM SG90, Feetech SCS0009, Dynamixel XL330, RT-version XL330, M5 SCS (platformio/yaml comments).
- Config: YAML on SD (`/yaml/SC_BasicConfig.yaml` per README, but code loads `/yaml/SC_Config.yaml` at main.cpp L104, a doc/code mismatch), with sane defaults if SD absent.

## 3. Wake word, speech stack
- None. No wake word, STT, TTS or LLM. Speech bubble text comes from a YAML "lyrics" list (max 10) in several languages (SC_BasicConfig.yaml). Optional `extend_config`/`secret_config` YAML hooks exist for downstream apps (secret_info_show flag controls logging of personal info; default true, which is a poor default).
- The audio "speech stack" equivalent is the speaker: M5.Speaker at 64kHz (Basic) or 96kHz (PSRAM boards) with DMA buffers 10x192 / 20x256 (main.cpp L283-302).

## 4. Features
- Avatar faces: M5Stack-Avatar expressions Neutral/Happy/Sad etc (only these used); speech bubble with JA/CN font option.
- Lip sync from **FFT of the decoded PCM**: 320-sample stereo buffer, FFT bins 5..60 summed, `mouth_ratio = level>>16 / lipsync_level_max`, clamped to 1.2, and `lipsync_level_max` auto-raises by 10 when exceeded by 1.5x (adaptive gain, L170-215). Cheap and effective.
- Servo: `moveXY(x,y,time)` where target = start + gaze*30deg + mouth_ratio*15 (X), y = start - mouth_ratio*10 - |25*gaze_y|; "sing mode" nods +10 on y in 400ms; idle/sing interval and move-time are random ranges from YAML (3-6s / 0.5-1.5s idle; 0.5-1s sing).
- LED: 10 SK6812 via FastLED on M5GoBottom (brightness 32), VU meter with 5-colour HSV gradient, left/right/stereo selectable (`led_lr`), optional 55-LED outer ring (`USE_LED_OUT`).
- Buttons A/B/C (mode, volume -/+ with confirmation tones). Battery icon, Core2 auto power-off timer after USB unplug (AXP192/INA3221 reads, L330-360).
- No touch, camera, IMU, wake or BLE GATT.

## 5. Security
- Attack surface is just the A2DP sink: the device advertises as "M5StackBTSPK" (YAML) and calls `a2dp_sink.start(name, true)`; **no PIN, no SSP confirmation, no allow-list**, so any phone in range can pair and stream audio while in Bluetooth mode [unverified: library default is "Just Works"]. Acceptable for a speaker; relevant if we ever add an A2DP/HFP mode.
- No Wi-Fi at all (WiFi includes commented out in main.cpp L9-11), so no TLS, no web server, no secrets in flash. Good minimal-surface practice.
- `secret_info_show: true` default prints "personal information" to logs; `secret_config_filename` lets apps keep secrets on SD in plaintext YAML (SD readable by anyone).
- Input validation of the YAML: relies on stackchan-arduino parsing; lyric count limited to 10 and buffer-size settings exist (`extend_config_filesize` 2048); no range checks on servo limits shown in this repo (servo limits come from the YAML, so a bad YAML could drive a servo past its stops [unverified]).
- Supply chain: PlatformIO pins `espressif32 @ 6.12.0`, `M5Stack-Avatar @ 0.10.0`, `ESP8266Audio @1.9.7`, `ESP32-A2DP#v1.7.3`, FastLED 3.6.0 (platformio.ini); `stackchan-arduino@^0.0.7` is a caret range (not pinned). Good that it pins by tag.

## 6. Performance and memory
- Speaker task pinned to APP_CPU (`spk_cfg.task_pinned_core = APP_CPU_NUM`) with explicit DMA buffer tuning; comments tell users to raise `dma_buf_count/len` for crackle and lower if the face flickers (a rare, honest trade-off note).
- Separate configs for PSRAM (Fire/Core2: 96kHz, 20x256) vs non-PSRAM Basic (64kHz, 10x192); `CORE_DEBUG_LEVEL=0` on release envs; SD SPI lowered to 15MHz after finding 25MHz fails on Basic/Fire V2.6.
- `heap_caps_get_largest_free_block(MALLOC_CAP_DMA)` printed every 3s as a fragmentation probe (L312); large commented heap-API cheat sheet.
- Comment in code: logging inside the avatar tasks can crash (L218), a good gotcha to remember.
- ESP32-S3 (CoreS3) is explicitly unsupported because it lacks Bluetooth Classic (platformio.ini comment): relevant, our S3 firmware cannot be an A2DP sink; an S3 would need a different route (BLE audio/LE Audio or Wi-Fi streaming).

## 7. UI and images
- No screenshots in this repo; README has no images (the M5Stack-Avatar lib in the other repo carries the GIF). UI is the stock M5Stack-Avatar face with white-on-black palette set in code (L277), speech bubble, battery icon, and "Bluetooth Mode" / "Normal Mode" text. Rating **2/5** as promoted UI (nothing to look at), though the face itself is the well-loved Stack-chan look.

## 8. README and docs
- Bilingual (README.md JA, README_en.md EN) with the supported-hardware list, library versions, a compile-notes section of hardware gotchas (SD speed, which env to pick for 16MB Basic), and a full YAML key reference with defaults and per-servo-type comments (SC_BasicConfig.yaml has a hardware pin table for Core1/Core2/CoreS3 and Stack-chan PCB variants, very useful). Dated change notes inline.
- No quick start commands, no screenshots/GIF, no tests, no CI, no AI-transparency statement (code is hand-written, comments in Japanese). Honest scope: "simple implementation".

## 9. Adopt / avoid
Adopt:
1. **Adaptive lip-sync gain**: sum FFT bins 5-60, divide by a running max that grows when exceeded; cheap alternative to RMS for our mouth/ring animation when audio comes from non-TTS sources (music).
2. Music-reactive LED VU gradient (L/R 5-colour HSV table) as an "audio visualiser" mode for the LED ring; port the maths to the virtual LED ring.
3. Random-interval idle servo "gaze+mouth coupling" formula (x = start + 30*gaze + 15*mouth) so the head sways with speech loudness; note sing mode nod.
4. YAML hardware config with per-servo-type defaults and pin table (our firmware could ship `servo_type`/limits as data rather than patches).
5. Pin library versions by tag in platformio.ini and document known-bad versions (e.g. Fire + arduino-esp32 2.0.4).
6. DMA-largest-free-block heartbeat log to catch fragmentation early.
7. Core2 power-sense auto power-off timer (AXP/INA3221 USB unplug detect) idea for battery-powered desk bot.
8. Confirmation tone sequences (rising/falling pairs) for button actions as non-visual feedback; cheap UX.
Avoid:
1. Doc/code mismatch (README says SC_BasicConfig.yaml, code loads SC_Config.yaml) and default `secret_info_show: true`.
2. Unauthenticated Bluetooth pairing with no confirmation and unvalidated servo limits taken straight from SD YAML.
3. Single squashed commit and a caret-range dependency (`stackchan-arduino@^0.0.7`) in a project otherwise pinned.

Relevance verdict for the virtual-tester decision: low direct value (no protocol to test); the only reusable pieces are the lip-sync/LED-VU/servo-sway formulas.
