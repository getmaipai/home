# StackChan ecosystem: visual and UI audit (15 repos)

Read-only audit, 2026-11-18. Nothing from the repos was built, installed or executed. Images were viewed directly; GIFs and
sprite sets were turned into contact sheets with my own Pillow scripts; HTML was rendered with Playwright (JavaScript off,
offline, `page.setContent`), 1280 and 390 wide. All shots are in
`/tmp/claude-0/-home-user-home/7524bf19-2972-532d-bd20-b8fb4e44bb56/scratchpad/ours/ui-shots/` (file names given per section).

How to read the evidence labels:

- **viewed**: an image from the repo, or a render of the repo's HTML, that I looked at.
- **re-render**: I redrew a procedural face from its source code in my own script. Shapes and positions come from the code,
  anti-aliasing and arc ends are approximate. Two of these: xiaozhi-firmware face and cloud-mcp crab.
- **code only**: read in source, never seen running. No repo was run, so every timing below is from code, not measured.
- Pages rendered with JavaScript off show their empty or loading state. Tabbed pages were opened by overriding CSS only.

Paths below are relative to `/tmp/claude-0/-home-user-home/7524bf19-2972-532d-bd20-b8fb4e44bb56/scratchpad/repos/`.

---

## PART A. On-robot UI

### A1. stackchan_alive (procedural face, 4 personas) - rating 5/5 for motion design, 3/5 for information on screen

Shots: repo `docs/media/face_gallery.png`, `stackchan_alive_expression_sheet.png` (viewed); my `alive-gifs.png` (24 frames
from three GIFs).

- **Geometry** (`personas/spark/expressions.yaml`, `src/face/ProceduralFace.cpp`, `src/io/DisplayAdapter.cpp`): 320x240.
  Eyes are filled rounded rectangles (spark: 70x56, corner radius 18, centres 108 apart, y 104) with a dark elliptical pupil,
  four independently cut corners (triangles in background colour), upper and lower lids as tilted wedges with a one-pixel
  accent line on the lid edge, a thin two-pixel brow line above each eye. Mouth is a thin curved strip built from triangles
  (width 64, y 172) with smile, open amount and separate left and right corner lift.
- **Palette per persona** (viewed gallery): spark = white eyes, pink mouth `#FF6B8A`, teal accent `#61E4D7` on `#071013`;
  bolt = amber slab eyes, red mouth on pure black; glow = cream round-ish eyes, pink mouth on deep indigo; pip = big cyan
  circles, small yellow mouth on dark teal. One accent colour per character, everything else background.
- **Expressions**: modes `Boot, Idle, Attend, Listen, Think, Speak, React, Sleep, Error` (`src/persona/StateMatrix.hpp`),
  sheet shows Idle, Listen, Think, Happy, Concern, Sleep. Reflex poses in YAML: `drowsy, yawn, surprise, picked_up, shaken,
  put_down, tilted, sound_direction, loud_noise`, each with a written "perceptual_purpose".
- **Overlays**: only one, rising and fading "Z" glyphs drawn from three lines each, born beside the right eye
  (`src/face/SleepCue.hpp`). A static "Stackchan: Alive" caption in accent colour under the mouth. No status bar, no
  subtitles, no battery, no clock, no QR.
- **Idle life** (`src/face/FaceAnimator.cpp`): blink is a four-phase state machine (closing 60 to 80 ms, hold 30 to 60 ms,
  opening 140 to 200 ms with overshoot; sleep blinks are slower), 12 percent chance of a double blink, 40 percent chance of
  a blink on a large gaze jump. Saccades have overshoot then settle. Random fidgets every persona-defined interval, 700 to
  1200 ms long. Breathing is one shared rhythm owned by the persona layer. Circadian drowsiness by hour of day.
- **Lip sync**: speech envelope with rolling peak, plus four visemes `Neutral, Ah, Oh, Ee`.
- **Transitions**: five easings (`Linear, InOutCubic, OutQuad, InQuad, OutBack`). Mode changes are staged gestures: eyes
  first (220 ms), brows 120 ms later, mouth 220 ms later; idle to sleep is a 3.4 s droop, fight, close sequence. The repo
  ships filmstrips of these at 50 ms steps (`artifacts/face/phase_d_*`).
- **Reduced motion** flag scales all autonomic motion (`setReducedMotion`).
- **Sounds**: eight procedural earcons per persona in YAML (`wake, confirm, think, happy, concern, sleep, error, safety`),
  each base frequency, chirp count, duration.
- **Servo**: spring dynamics, `Affirm` and `Deny` response gestures, think pose has an 18 degree yaw bias, listen a small
  pitch bias. No LED use found in the face path [unverified for LEDs overall].
- **Best in class**: the motion. Staged transitions, blink with overshoot, saccade settle, reflex vocabulary tied to IMU and
  sound. Also the tooling: a host preview renderer that uses the same YAML, so the sheet is what the robot shows.
- **Copy**: persona pack = palette + geometry + earcons + behaviour in YAML; staged eyes-brows-mouth transitions; the
  filmstrip and state-matrix image as a review artefact; reduced-motion switch; written purpose per expression.
- **Weak**: the screen tells you nothing but mood. No listening or muted mark, no text, no error explanation.

### A2. stackchan-xiaozhi-firmware (procedural LVGL canvas face) - rating 4/5

Shot: `xiaozhi-fw-face-rerender.png` (re-render of all 21 expressions plus blink and two speaking frames).
Source: `stackchan-xiaozhi-firmware/main/boards/m5stack-core-s3/m5stack_core_s3.cc` lines 413 to 1040.

- **Geometry**: classic white-on-black dot face. Eyes radius 8 at (90,93) and (230,96), deliberately 3 px out of level.
  Mouth is a rounded rectangle at (163,148): closed 90x4, opening to 50x60 as it speaks.
- **Expressions (21)**: `Neutral, Happy, Angry, Sad, Sleepy, Loving, Crying, Kissy, Cool, Confident, Shocked, Thinking,
  Surprised, Confused, Embarrassed, Silly, Winking, Laughing, Funny, Relaxed, Delicious`. These are exactly the xiaozhi
  emotion names, so no mapping loss.
- **Overlays (13)**: tear (blue), heart eyes (pink-red `#FF4070`), kiss heart, cheek blush (three pink slashes each side),
  cool glasses (two white slabs and a bar), exclamation mark, think bubble with three dots and two trailing circles, star
  burst, wave squiggle, drool, laugh lines, question mark, three growing Z. Only three colours beyond white.
- **Idle life**: 50 ms tick. Breath is a sine moving eyes and mouth 3 px, 5 s period (relaxed: slower and deeper; shocked:
  breath stops). Blink every 2.5 to 4.5 s, closed 150 to 350 ms, doubled interval for thinking and relaxed, disabled for
  cool, confident, shocked, winking, kissy. Saccade every 1.5 s, off for six expressions; thinking looks up, embarrassed
  looks down.
- **Lip sync**: fake. Random mouth height each tick for `characters x 120 ms` (800 ms to 15 s). No audio level.
- **State to face**: top bar and status bar hide after 8 s idle and reappear on listening, speaking, thinking, connecting
  (matched on status text). Sleepy pauses face tracking and scanning. Petting gives heart eyes plus blush plus head tilt.
- **Servo tied to face**: nod on happy, loving, laughing, confident, winking, delicious; shake on sad, confused, angry,
  shocked.
- **LED ring**: one colour per emotion over all 12 pixels (`UpdateLedsFromEmotion`, line 1583): happy amber, loving pink,
  sad blue, angry red, surprised violet, thinking azure, cool cyan, relaxed lime, sleepy very dim violet, neutral warm
  orange (60,35,10).
- **Notification**: MCP tools `self.notify.attention` (shake head three times, waiting face, project name pinned on screen)
  and `self.notify.dismiss` (nod once, clear). A desk-robot "your agent needs you" card.
- **Best**: the widest expression vocabulary of any vector face, with cheap overlays that read at arm's length.
- **Copy**: the 21-name table and its overlay table; auto-hiding status bar; attention and dismiss pair.
- **Weak**: eyes are tiny (8 px radius on a 320 px screen), lip sync is random, no transitions at all (hard cuts).

### A3. M5Stack official avatar: StackChan-GPT firmware and stackchan-local firmware - rating 4/5 (GPT), 3/5 (local)

Shots: `gpt-docs-photos.png`, `gpt-app-setup-gifs.png`, `gpt-app-pngs.png` (viewed).
Source: `stackchan-local/firmware/main/services/expression_motion/` (same M5 code as `StackChan-GPT/firmware/main/stackchan/`).

- **Face**: LVGL objects, not a canvas. Eye = 16 px circle with a rectangular eyelid in background colour sliding over it;
  each feature has `position, rotation, weight, size`. Mouth = rounded bar that morphs from 90x6 to 60x50. Base emotions
  `Neutral, Happy, Angry, Sad, Doubt, Sleepy` are just eyelid weight and eye rotation (happy = 72 percent open rotated 155
  degrees, which makes the arch).
- **Decorators**: bitmap `heart` (red `#E13232`, top right, two-frame wiggle), `angry` mark (amber `#FDB034`), `sweat`
  (top left, drips), `shy` (two blush marks on the cheeks), `dizzy` (two spirals).
- **Modifiers** (timings from code): blink open 5.2 s plus up to 0.5 s jitter, closed 200 ms; breath 6.6 s cycle; speaking
  mouth toggles every 180 ms with random weight 40 to 80 plus slow head sway every 1.5 to 2.5 s; idle expression every 2 to
  6 s (70 percent small eye shift, 10 percent mouth tilt); idle motion every 4 to 8 s; head pet adds a heart for 1.5 to
  2.5 s and a nuzzle move; IMU shake adds dizzy spirals and a wobbling mouth for 4 s; three dance keyframe sets.
- **Speech bubble**: pill with an arrow, primary colour fill, used for "Zzz…" and "...".
- **stackchan-local presets** (`modifiers/expression_preset.h`): 11 named presets `neutral, happy, laughing, love, angry,
  sad, crying, sleepy, thinking, surprised, doubtful`, each = base emotion + per-feature tweak + decorators + an LED colour
  (happy `#FFD34D`, love `#FF6FB3`, sad `#4D8DFF`, angry `#FF3838`, thinking `#5D8CFF`, surprised `#4DE6FF`, sleepy
  `#7A5CFF`) + optional head motion, with a duration and guaranteed restore of face, pose and LEDs.
- **StackChan-GPT on-robot shell** (the only real launcher in the set):
  - Launcher carousel: full-colour page per app with a big icon, bold title, white chevrons, page dots. Apps: `AI.AGENT`
    (green), `AVATAR` (pink), `DANCE` (purple), `ESPNOW.REMOTE`, `EZDATA`, `APP.CENTER`, `SETUP` (grey).
  - Status bar: Wi-Fi strength icon left, clock centre ("5:50 PM"), battery percent and icon with a lightning mark right.
  - First-run flow (viewed GIF frames): "Welcome! Let's get started." Skip / Start; "SERVO TEST: Put me on a flat stable
    surface and remove your hands. Power me via the bottom USB-C if needed."; "APP SETUP" with two QR codes (App Store, Play
    Store); then "ID: 123456789ABC - Look for me in the app to start setup." with a heart.
  - Setup pages (strings from `apps/app_setup/`): Wi-Fi (keyboard entry, "Connect failed! Check SSID/Password (2.4G)."),
    Brightness, Volume, Microphone record and playback test, Servo home position, RGB strip colour, Time zone list, Power
    saving ("Automatically power off after being idle for:", "Allow auto power off while charging:"), Start Agent.ai on
    boot, Movement during rest (None, Little, Medium, High), App visibility, Check for Updates with "Downloading...",
    Factory reset, "Unbind & Reset", About. Agent.ai page: OpenAI API, model (tap to cycle), voice (tap), wake word name.
  - Reminder card: cream panel `#FFDF9A`, "Reminder:" title, message, blue OK button, with a notification sound
    (`assets/sfx/new_notification.ogg`); also `camera_shutter.ogg`.
  - Toasts, a loading page, a home-indicator bar, a video-call window (`app_avatar/view/ws_call.cpp`).
  - Screensaver: the face as a bouncing logo that changes colour through eight colours on each wall hit.
  - LED states per prior audit: listening emerald, thinking purple, speaking cyan; dance cycles red, blue, green, purple
    on alternating halves.
- **Best**: the GPT fork is the only repo with a complete on-device product shell: launcher, status bar, first-run, hardware
  self-tests, settings, reminders, toasts, screensaver.
- **Copy**: first-run sequence with a servo safety screen; mic record-and-playback test; "Movement during rest" as a
  four-step setting; reminder card with OK; presets that bundle face + LED + motion + guaranteed restore.
- **Weak**: base face has six emotions only; launcher pages are static posters.

### A4. nous-girl-stackchan (GIF character faces + overlays + on-robot settings) - rating 5/5 for breadth

Shots: repo `faces/starter/starter-faces-combined.png`, `faces/starter/robot/preview.png`,
`faces/tribute/nous-girl/mouth_preview_sheet.png` (viewed); my `nous-fairy-gifs.png`, `nous-tribute-gifs.png`,
`nous-starter-robot-gifs.png`.

- **Art**: monochrome ink illustration on white, 320x240. Tribute face is a three-quarter anime portrait; three CC0 starter
  sets (robot, boy, girl) are generated by a script (`faces/starter/make_starter_faces.py`) in a consistent line style.
- **Emote set (12 GIFs)** with per-frame timing printed on the preview sheet: `neutral` (2400, 120, 600 ms = built-in
  blink), `happy` (sparkles), `sad` (tear), `thinking` (finger on chin, dots rising), `sleeping` (Z and a snore bubble),
  `pet` (closed happy eyes, blush, hearts), `shake` (spiral eyes, stars, 90 ms frames), `speaking`, `listening` (hand to
  headphone, or sound arcs for the robot), `look_left`, `look_right`, `email` (an envelope flies off and a tick appears).
- **Lip sync is separate from the GIF** (`stackchan_geometry_display.cc` `LipTick`, `hg_lip.cc`): an 8-shape mouth patch
  (`closed, half, open, wide_e, round_o, small_u, wide_i, smile`) in four mood sets is drawn over the GIF mouth. Driven by
  speaker RMS with fast attack, slow release and adaptive peak, plus zero-crossing and a vowel estimate; each shape is held
  at least 70 ms so it reads as speech, not flicker. Smile is the rest shape for happy moods.
- **Layered extras drawn in code**: scowl (two black lids over the neutral GIF's eyes plus a held red anger mark), anger
  mark, floating music notes in party mode, full-screen meme image tool (`self.screen.show_image`, tap or next voice turn
  dismisses), DJ screen = face plus a 13-band equalizer along the bottom with peak-hold caps, fed by a 1024-point FFT of
  the speaker PCM at 25 fps; rave tint capped at 3 pulses per second with no red strobe.
- **Emotion fallback table**: 28 incoming emotion names resolve to the nearest available GIF with up to three candidates
  (`kGifAlias`), so a face pack with fewer GIFs still works. `speaking:<mood>` selects the mouth set.
- **Idle**: neutral arms an idle-sleep timer that switches to sleepy; idle look-around; follow faces.
- **Touch**: tap = talk or stop, hold 1.5 s = Settings, swipe left or right = next or previous song, swipe up or down =
  rave on or off on the DJ screen; three head pads = giggle, pet, peek; shake = dizzy.
- **On-robot Settings (14 tiles)** (`hg_settings.cc`): Wi-Fi (network, signal dBm, channel, IP, Reconnect, Wi-Fi setup
  mode, saved networks n of 10), Wake words, Sound (volume slider, "Volume 80" shortcut), Screen (brightness, lip sync
  on/off, vowel mouth shapes, talking lights), Head (Go home, Reset to level, look around when idle, follow faces, follow
  debug, swap swipe direction), Lights (Off, Auto, eight colours, six moods `happy, calm, party, spooky, sleepy, focus`,
  rainbow), Dance (learn a dance, my dances on SD), Music (dance to music, DJ mode, now playing, SD song list), Server
  (OTA address with "Home server" and "xiaozhi.me" presets, Save + restart), Voice & AI, Camera & SD, Language, About
  (started because, last crash), Restart and factory reset with a plain warning sentence.
- **LED** (`cores3_py32_led.cc`): colour and mode (steady or breathing) per device state, user-configurable and stored on
  the device: idle, connecting, listening, speaking, notifying, upgrading, error. Emotion cues over the top with a hold
  time: thinking amber pulse (until state changes), happy warm yellow 2 s, loving pink pulse 3 s, sad dim blue pulse,
  dizzy white pulse 1.5 s, email green 3 s, sleepy very dim violet, scowl red pulse. "Talking lights" follow the voice
  level.
- **Best in class**: the emote vocabulary with timings; mouth-patch lip sync over illustrated art; the settings app; the
  fallback table; user-editable LED state table; three free starter face sets with a generator.
- **Copy**: all of the above, plus `email` style "task done" emotes (action confirmation as a face), and "started because /
  last crash" on the About page.
- **Weak**: white background is harsh in a dark room; the tribute art is not freely licensed; some overlay positions are
  marked in code as "not yet checked on the robot".

### A5. stackchan-pet-fw (pre-rendered illustrated character) - rating 4/5

Shots: `pet-base-mouth-eye.png`, `pet-dir-blink-dizzy-pet.png`, `pet-refs.png` (my sheets of repo JPGs).

- **Art**: full-colour soft anime bust on black, 240x240 on CoreS3 (also 386 round and 128 square sets).
- **Frame matrix**: `base_m{0..3}_e{0..3}` = 4 mouth openings x 4 eyelid levels (16 frames) gives lip sync and blink at the
  same time without layering. `dir0..dir16` = 16 head directions plus centre ("guruguru": the character leans and looks
  toward the tilt or touch). `dizzy_01..15` = spiral eyes with a chick and stars orbiting the head, ending in a head shake
  with motion lines. `pet_anim_0..15` = eyes close, blush, hearts accumulate, open smile, then a small pout when you stop.
- **Modes** (`src/FaceController.h`): `AuthFaceMode Master / NotMaster` (different face for the owner), `ThermalFaceMode
  Normal / Warm / Hot / LowPower` (the face shows heat).
- **Subtitles** (`docs/speech_bubble_protocol.md`): cue JSON is sent just before the PCM for the same segment so text and
  voice stay in step; hold after audio drains (800 ms default, max 5 s); 15 s stall timeout; fixed boxes: CoreS3 288x56 at
  the bottom, 2 lines of 16 px; round watch 315x86, 3 lines; AtomS3R 124x40 at the top.
- **On-robot settings (7 pages)** (`src/main.cpp` 5018 on): Network (SSID, IP, "Wi-Fi QR" and "Setup QR" codes), Display
  (brightness, screen off), Audio (volume), Servo ("Adjust face by hand, then save." / Save Direction), Power (low power
  on/off, turn off), StreetPass (my profile name and message, encounters, history), Steps (history pages). Clock overlay,
  mic status overlay, StreetPass notification overlay, "Ready in N.Ns" countdown.
- **Best**: the most appealing face in the set, and the mouth x eye matrix is a clean way to get both from flat art.
- **Copy**: mouth x eye frame matrix; 16-direction lean; petting arc with an ending beat; subtitle cue protocol; Wi-Fi QR on
  the robot; thermal face.
- **Weak**: about 65 JPGs per target, one character, emotion range limited to the sets that were drawn.

### A6. stackchan-mcp (GIF faces) - rating 3/5

Shots: `mcp-faces-png.png` (repo `faces/*.png`), `mcp-faces-fw.png` (repo `firmware/data/*.png`).

- Seven faces `calm, thinking, happy, sleepy, shy, smug, pouty`. Two different art sets exist: `faces/` has four polished
  cel-shaded chibi heads with glasses (thinking = concentric-ring eyes; happy = sparkle and a water spout; sleepy = Z
  bubbles); `firmware/data/` has seven low-resolution pixel sprites with a white outline (smug has horns and wings). The
  README set and the flashed set do not match.
- AnimatedGIF player at 192x192 (`firmware/src/face_service.cpp`). No blink, lip sync or gaze.
- **Camera preview as an indicator**: `showCameraPreview(jpeg, durationMs)` puts the captured frame on the robot screen for
  about 6 s whenever the agent looks. This is the clearest "I just took a picture" signal in the set.
- Booth (privacy) mode persisted on device; Wi-Fi connect screen is green text on black.

### A7. stackchan-openapi (M5Stack-Avatar with custom drawables) - rating 3/5, code only

Source: `stackchan-openapi/firmware/firmware.ino` lines 60 to 300.

- Eyes are 28-wide bars (10 px tall, 7 when angry, 3 when sleepy); happy = three-line chevrons; `love` = heart eyes plus
  blush slashes and a small smile arc; `eyeroll` = outlined socket with the pupil at the top. Brows tilt per emotion.
  Decorations: manga anger mark, "Z z z" in three sizes, "?" for doubt.
- **Subtitle bar**: rounded box 308x66 at the bottom with a double outline, 16 px CJK font, 2 lines per page, CJK-aware
  wrapping by pixel width, pages advance in proportion to speech duration, page dots bottom right.
- Mouth opens as a 24 px rectangle from the mouth-open ratio.

### A8. stackchan-cloud-mcp (pixel crab) - rating 3/5 for the idea

Shot: `cloudmcp-crab-sprites-rerender.png` (re-render from `stackchan-cloud-mcp/sprites/sprites.js` rect data).

- Not a face on a robot but a whole pixel creature: orange crab, a warm yellow lamp on a pole above its head as the
  permanent identity mark (dimmed, never off, when asleep). 26x22 logical grid scaled x10.
- 14 first-batch expressions (`idle, happy, love, shy, wink, sleepy, sad, angry, surprised, thinking, speechless, dizzy,
  cheer, celebrate`), a second batch of 9 with A/B frames, and **12 scenes**: `meds, breakfast, work, coffee, game, workout,
  tv, bath, walk, bored, away, meal`. Scenes show the creature doing what the person is doing.
- Two-frame animation recipes are documented (shift an element, hop the body, rotate a highlight, swap a tear for a splash).

### A9. Stock M5Stack-Avatar users: StackChan_Minimal, stackchan-bluetooth-simple, stackchan-simulator - rating 2/5

Shots: `minimal-avatar-gif.png`, `minimal-docs-photo.png`.

- Classic face: two white dots, a line mouth that becomes a box when open, on black (blue in the library demo GIF).
- **Minimal** (`StackChan_Minimal/src/main.cpp`): the speech bubble is the whole status system: "認識中…", "テスト録音中…",
  the "thinking" message with `Doubt`, the reply text with `Happy`, "Error1" with `Sad`, "わかりません" on a miss, "音声が検出
  されませんでした". Mouth toggles 0.6 / 0.15 while speaking. Screen rotation is a setting.
- **bluetooth-simple**: lip sync from A2DP level with a self-raising ceiling; head sways with mouth and gaze; LED VU meter
  five-step blue, green, yellow, magenta, red, left and right; Happy / Neutral flips on each track; random "lyrics" bubble.
- **simulator** (`web/static/js/face_renderer.js`): browser twin of the stock face, six expressions, gaze modes `follow`,
  `saccade`, `both` (gaze follows where the head points, with saccade added at 35 percent).

### A10. dotty-stackchan (firmware not in this repo; contract only) - rating 4/5 for the LED contract

Source: `dotty-stackchan/docs/modes.md`, `docs/emoji-mapping.md`.

- Nine faces chosen by a leading emoji: 😊 😆 😢 😮 🤔 😠 😐 😍 😴. The server guarantees exactly one.
- **12-pixel LED contract, split by ring**: left six = current state arc (idle grey, talk green, story amber, security
  white with 1 Hz flash, sleep very dim blue, dance rainbow). Right six are named single pixels: 6 = face seen (yellow) or
  recognised (green), 8 = kid mode (salmon pink), 9 = smart mode (orange), 11 = listening (red, mic open), 7 and 10
  reserved. Repainted at 5 Hz. Agent LED tools can write the left ring only; indicator pixels are protected.
- Thinking and speaking have no LED on purpose; they live on the face. Sleep = neutral pose, servo torque off, "Zzz…",
  mic, wake word and face detection off (a real privacy state).
- Purr sound asset for petting (`bridge/assets/purr.opus`).
- **Best**: the only repo that treats LEDs as a readable instrument panel instead of mood lighting, and mirrors it in the
  dashboard with the same colours.

### A11. No on-robot drawing in the repo

stackchan-ai-server (server only), stackchan-claude-bridge (bridge; uses the xiaozhi notify tools above).

---

## PART B. Dashboards and management pages

### B1. dotty-stackchan bridge dashboard - rating 4.5/5 (best parent-facing page)

Shots: `dotty-dashboard-dark-1280.png`, `dotty-dashboard-dark-390.png`, light variants (my renders of the Jinja templates
with sample data in a sandboxed environment; all state sections forced visible), repo `docs/assets/dashboard-light.png`.
Source: `dotty-stackchan/bridge/templates/*.html`.

- **Stack**: one page, HTMX partials, DaisyUI/Tailwind, SSE for the live feed, PWA manifest, light and dark, CSRF token.
- **Header**: logo, three health dots `bridge / server / robot` (each opens a detail modal), version chip linking to the
  commit, theme toggle. A yellow "Reconnecting to bridge…" banner appears when SSE or a request fails.
- **Kid Mode card**: big toggle with a confirm dialog; the subtitle states what it does ("content sandwich, camera denied,
  kid persona") and warns "default, not saved" when no policy file exists. **Smart Mode card**: toggle with an honest
  "model-swap pending (v2)".
- **State card**: six buttons with the robot's LED colour as a dot (`Idle, Talk, Story, Security, Dance, Sleep`); the lower
  half changes with the state: emoji row (nine moods) for idle, "Say something…" for talk, "Start a new story about…" for
  story, "Dance & sing" plus a song list for dance, a note for security.
- **Perception card**: Sight (face dot, `unrecognised` or the person's name, last photo thumbnail that opens full size with
  download, "Sees:" description with source and age, capture-failure count for the last hour) and Sound (listening dot
  mirroring the red LED, "Hears:" audio caption, "Said:" last recognised line), plus an "Environment" summary sentence.
  Replaced by "Sleeping - Dotty isn't listening" in sleep.
- **Person memory card**: review queue "Awaiting review - declared about a child / unidentified person" with Approve and
  Redact; stored memories with Redact; person tag and importance.
- **Voice tools** list, **Content filter recent hits** (time, tier alert/log, rule, first words), **Activity feed** with
  filters `All / Turns / Events / Errors`, per-turn latency, error toast, "View full report" modal.
- **Bridge modal**: version facts plus temperature, memory, disk, uptime with warning colour.
- **Best**: state-conditional controls; LED colours reused as UI language; memory approval queue; "what it sees and hears
  right now" with ages; everything on one phone-width page.
- **Weak**: no login (relies on loopback binding), no settings for voice, wake word, persona or Wi-Fi, no OTA, raw JSON in
  event rows, feed is lost on reload.

### B2. stackchan-ai-server config console - rating 4/5 (best setup wizard)

Shots: `aiserver-config-1280.png`, `aiserver-config-390.png`, `aiserver-config-all-1280_p1..p4.png` (all panels opened by
CSS). Source: `stackchan-ai-server/stackchan-server/server/internal/service/ai/config_ui_html.go`.

- Dark navy, indigo accent. Left rail of five numbered steps; three status tiles on top (current provider, run mode,
  config status); a "First time connecting StackChan?" banner; sticky save bar with a status sentence.
- **01 Provider**: OpenAI Realtime, Gemini Live, Tencent TokenHub, OpenRouter, OpenAI-compatible; system prompt; save text
  history on/off, retention days (1 to 3650), messages carried over on reconnect (0 to 100), end conversation after N
  seconds of silence; per-device history export to Markdown and clear; **"Detect provider, models and voices"** button that
  fills the model and voice lists from the provider.
- **02 Voice pipeline**: STT, LLM, TTS base URL / key / model each, TTS voice, server VAD on/off and silence ms, initial
  audio buffer and maximum wait ms.
- **03 Background tasks**: Home Assistant URL and token, background agent on/off, agent URL / key / model, timeout, prompt.
- **04 Device profile**: JSON keyed by device id to override prompt, model or voice per robot.
- **05 Device onboarding**: shows the exact host, port and OTA URL with a copy button, a prominent warning that the flash
  script rewrites the whole NVS partition (Wi-Fi is lost), four numbered steps, a "two services side by side" section.
- **Best**: step numbering with "core / optional" badges, detect button, honest destructive-action warning, explanatory
  help under each field, retention controls. Mobile layout turns the rail into a 2-column grid.
- **Weak**: no live robot state, no test-speak button, device profiles as raw JSON, keys typed into a LAN page.

### B3. nous-girl-stackchan "Fairy" admin (desktop and mobile) - rating 3.5/5

Shots: `nous-admin-1280.png`, `nous-admin-alltabs-1280_p1..p3.png`, `nous-admin-mobile-390.png`,
`nous-admin-mobile-alltabs-390_p1..p2.png`. Source: `server/addons/patched-server/files/core/api/admin_page.html`,
`admin_mobile.html`. Chinese UI.

- Sidebar tabs: Chat, LLM, Persona, Voice, Skin, Lights, Servos, Voiceprint, System. Health dot and Save / Save + restart
  pinned at the bottom of the sidebar.
- **Chat**: transcript with text input, pause polling, clear web context, clear all records. **LLM and vision model**:
  model with a "probe" button, base URL, key (blank = unchanged), temperature, max tokens. **Persona**: one big prompt.
  **Voice**: reference audio path, language, reference transcript, list available audio.
- **Skin**: two cards with preview art, "Fairy" (own character, own voice, own server) or "official face" (stock face,
  official server); switching also switches server.
- **Lights**: seven rows, one per device state (idle, connecting, listening, speaking, notifying, error, upgrading), each a
  colour picker, hex field and steady / breathing select; "Apply to device" and "Restore defaults".
- **Servos**: joystick pad, yaw and pitch sliders, "Go to angle", "Set as default angle", idle auto-turn switch.
- **Voiceprint**: speakers list, add speaker (id, name, description passed to the model), 6-second in-browser recording to
  enrol, delete voiceprint. **System**: config, backup list (auto backup on each save), notes.
- **Best**: every panel carries a coloured banner saying whether a restart is needed ("needs server restart" in amber,
  "no restart needed, applied live and stored on the device" in green). State-colour table. Skin cards. Voiceprint enrol.
- **Weak**: needs restart for most things, no kid controls, no memory view, localhost-only so the phone page is of limited
  use, mic recording blocked on LAN http (the page says so).

### B4. stackchan_alive bridge dashboard and companion app - rating 4/5 dashboard, 3/5 app [app is code only]

Shots: `alive-dashboard-1280.png`, `alive-dashboard-390.png` (blank without JS: the mobile tab view needs script),
`alive-voice-audition-1280.png`. Source: `stackchan_alive/bridge/dashboard/`, `companion/ui/.../CompanionConsole.kt`.

- **Dashboard**: near-black with teal, monospace labels. Centre stage is a **live CSS face** mirroring the robot's mode,
  with heartbeat age and motion state under it. Left: Bridge panel (state, robot host, brain model, research tools,
  speech, pipeline, voice, uptime). **Motion panel**: status badge `UNVERIFIED / ENABLED / STOPPED`, red "Stop motion",
  and "Resume motion" that stays disabled until you tick **"Robot is upright and clear"**. Telemetry: power, temperature
  with "motion thermally suppressed", touch, camera, servo rail and torque, each with a freshness stamp ("Not sampled").
  Awareness: Initiative switch, Room observation switch, observation interval (2 to 30 min). Activity: latest 8 events.
  Phone layout = five bottom tabs (Live, Motion, Aware, Telemetry, Activity).
- **Voice audition page**: one card per sample line with an audio player, the sentence, a design note and MP3 / WAV links.
- **Companion app (Compose, Android + desktop)**: sections Live, Talk, Brain, Nodes, Telem. Robot setup card with numbered
  pairing steps and a pairing QR ticket; text-to-robot chat bubbles; PC brain supervisor (start, stop, PID); on-phone model
  download (Gemma) with size and terms; persona library with import and export of persona packs as zip ("without logs or
  private memory"); trusted companion nodes with fingerprints, claim and forget; settings for volume, brightness, display
  motion `Normal / Reduced`, servo motion, privacy audio; diagnostics export. Many controls are deliberately locked until
  proof exists ("Read-only until robot settings round-trip is verified", "Manual servos and triggers (locked)").
- **Best**: unknown is a first-class state everywhere; the stop / confirm / resume motion interlock; mirrored face.
- **Weak**: no persona or voice editing in the web page, the companion still shows placeholder data in places.

### B5. stackchan-local desktop console (React) - rating 4/5 as a hardware bench, 2/5 for families

Shot: repo `assets/webui-console.jpg` (viewed). Source: `stackchan-local/desktop/preview-ui/src/`.

- Dark sidebar with three groups: Modules (one row per chip with part number and a status dot: Power AXP2101, INA226,
  Display, Screen Touch, Head Touch, IMU, Magnetometer, Camera, Servo, IO Expander, RGB LED, RTC, ALS/Proximity, NFC, IR,
  Audio, Wi-Fi/BLE), Applications (Codex announcer, face tracking, expression control), Debug (System, Raw Snapshot, Logs).
- KPI strip on top: Device, SSE, FPS, Faces, Battery, Wi-Fi, Drops, Updated.
- Every module page has the same anatomy: header with availability, "current data" metric grid, command buttons with a
  command status chip, raw JSON panel.
- **Expression control app**: 11 preset buttons each with a one-line effect description, duration, LED flash colour, and a
  custom editor with sliders for X, Y, Rotation, Weight, Size per left eye, right eye, mouth; 450 ms command cooldown.
- **Face tracking app**: live metrics and PID tuning (speed, deadband, P/I/D per axis, direction, integral and output
  limits). IMU page has a 3D attitude view. Logs page: search, type filter (system, device, vision, command), level filter.
- **Best**: uniform module pages; live expression editor; command acknowledgement shown to the user.
- **Weak**: mixed Chinese and English labels; nothing for conversation, persona, memory or safety.

### B6. StackChan-GPT web portal and "StackChan World" phone app - portal 2.5/5, app 4/5 [app is code only]

Shots: `gpt-web-portal-1280.png`, `gpt-web-portal-390.png`, `small-pages-390-sheet.png` (search page).
Source: `StackChan-GPT/firmware/main/hal/hal_openai.cpp` (`kWebPortalHtml`), `StackChan-GPT/app/lib/view/`.

- **Portal (on the robot, port 80)**: one dark card. Status pill, device name / wake word, OpenAI API key, base URL, chat
  model, TTS voice, STT model, TTS model, persona prompt, "Save OpenAI Configuration", **"Test Servos & RGB LEDs"**, link
  to "Latest web search and source links" (a page showing what the robot last searched). Clean, but unauthenticated.
- **Phone app (Flutter, Cupertino style)**, pages from source: device scan and bind over Bluetooth with a verification
  code, Wi-Fi provisioning, device rename, "Unbind & Reset"; AI agent templates and editor (character description up to
  2000 characters, LLM model, language, voice tone, TTS speed and pitch, ASR speed, memory type and short-term memory
  content); chat history; MCP tools page with access point status; **Avatar** tab with a 3D robot model, a grid joystick,
  per-feature sliders (left eye, right eye, mouth, yaw, pitch), left and right light-strip colours, and **Mirror / Mask**
  modes where the phone camera's face landmarks drive the robot face; video **Call** to the robot screen; **Dance** list,
  dance recorder with music (file, URL, prefabricated); remote camera monitor; **Panorama** (robot turns, phone stitches
  at least 5 photos); debug log copy.
- **Best**: the puppeteering and dance recorder are unique; onboarding is QR on the robot to the app to bind by code.
- **Weak**: account and cloud dependency in the app; the portal exposes keys on the LAN.

### B7. StackChan_Minimal device pages - rating 3/5

Shots: `minimal-pages-390-sheet.png` (six pages), `misc-pages-sheet.png` (web installer).
Source: `StackChan_Minimal/incbin/html/`, `docs/index.html`. Japanese UI, plain white with green buttons.

- Wi-Fi setup (two written steps, scanned list, SSID, password, save and restart). Text + image chat (send a photo to a
  vision model, shrunk to 512 px in the browser). Language / character voice picker with voice credits. Model page (LLM
  runtime choice, server IP and port with a "reset to default port" tick listing Ollama, LM Studio, llama.cpp ports, API
  key, "fetch model list", Whisper server, Piper server).
- **VAD page**: current settings, detection threshold slider with a plain explanation ("lower picks up quieter voices,
  higher rejects noise, 180 is normal"), **environment calibration** (3 seconds of room noise sets the threshold), **test
  recording** that shows the recognised text, reset to standard.
- External TTS page: screen rotation, language / character, volume, speaking speed, licence credits for the voices.
- Browser flasher page (ESP Web Tools): supported browsers, six install steps, troubleshooting, a medical disclaimer.
- **Best**: the VAD calibration and test loop; credits placed where the voice is chosen; one-click web install.
- **Weak**: no navigation hub in the files, no styling system, open setup access point.

### B8. Wi-Fi and auth pages

Shots: `xiaozhi-wifi-config-390.png`, `xiaozhi-wifi-config-all-390.png`, `xiaozhi-sonic-wifi-1280.png`,
`small-pages-390-sheet.png`.

| Page | What it has | Rating |
| --- | --- | --- |
| xiaozhi `78__esp-wifi-connect` portal (in xiaozhi-firmware and nous-girl) | Two tabs. Wi-Fi: saved networks list, SSID, password, Connect with a blurred "Connecting..." overlay, language picker. Advanced: custom OTA URL, Wi-Fi max TX power, remember BSSID, sleep mode. Polished light-blue card. | 4 |
| xiaozhi sonic provisioning (`scripts/sonic_wifi_config.html`) | Type SSID and password, the phone plays an audio signal the robot decodes; loop option. No AP join needed. | 3.5 (idea 5) |
| stackchan-pet-fw (`src/main.cpp` 3594) | Japanese / English switch, found networks with rescan, save form with **priority**, saved Wi-Fi list with edit, up, down, delete, "restart with saved Wi-Fi". Multi-network with ordering. | 4 |
| stackchan-mcp (`firmware/src/wifi_portal.cpp`) | Network select, password, Save & Restart. | 2.5 |
| stackchan-mcp voice upload (`scripts/stackchan_voice_upload_server.py`) | Unstyled: record in browser or upload a file as the robot's ear; explains the http microphone limit. | 2 |
| stackchan-cloud-mcp OAuth gate (`cloud/oauth_proxy.py`) | Crab emoji, "Enter the access key to authorize this device", one field. | 2 |
| stackchan-openapi root (`firmware/firmware.ino` 478) | Unstyled link list: faces, servo presets, capture, record, status. A device that documents itself. | 2 |

### B9. stackchan-simulator web UI - rating 3.5/5 (engineering tool)

Shot: `simulator-1280.png`. Japanese. Robot build and servo selectors with total mass and head mass ratio; mode `manual /
gaze`; pupil mode `follow / saccade / both`; pan and tilt sliders; gaze target in world coordinates; voice chat; PD gains;
3D assembly view; torque load bars that turn red near stall; telemetry; tilt torque history; record / replay with CSV
export. Worth copying: torque-load bars and record-replay for motion tuning.

### B10. No management UI

stackchan-claude-bridge, stackchan-bluetooth-simple (three buttons and a YAML file).

---

## PART C. Synthesis

### C1. The 25 most valuable UI ideas, ranked

| # | Idea | Source and evidence | Why |
| --- | --- | --- | --- |
| 1 | LED ring as an instrument panel: one half shows state, the other half is named single pixels (listening, face seen/known, kid mode), protected from agent writes | dotty `docs/modes.md` | A parent can read mic and kid-mode status from across the room; mood lighting cannot do that. |
| 2 | Dashboard reuses the robot's LED colours as its own status language | dotty `bridge/templates/state.html`, `perception.html` | One vocabulary to learn for robot and page. |
| 3 | Per-person memory review queue with Approve / Redact, child statements held until approved | dotty `memory_list.html` | The only memory UI in 15 repos, and it is safety-first. |
| 4 | Mouth-patch lip sync over illustrated art, 8 shapes, held at least 70 ms, vowel-aware | nous-girl `stackchan_geometry_display.cc` `LipTick`, `mouth_preview_sheet.png` | Makes character art speak without redrawing every frame. |
| 5 | Staged transitions: eyes, then brows, then mouth, with easing; blink with overshoot; saccade settle | alive `src/face/FaceAnimator.cpp`, `artifacts/face/*filmstrip*` | The difference between a face and a slideshow. |
| 6 | Emote vocabulary with per-frame timing sheet and a fallback table for missing emotes | nous-girl `faces/starter/robot/preview.png`, `kGifAlias` | Face packs become swappable; any model emotion lands somewhere sensible. |
| 7 | Motion safety interlock: Stop, tick "Robot is upright and clear", then Resume; UNVERIFIED as a state | alive `bridge/dashboard/index.html` | Honest and safe remote motion control. |
| 8 | "What it sees / hears / said" card with ages, source and failure count | dotty `perception.html` | Makes perception inspectable, which builds trust. |
| 9 | Camera frame shown on the robot for a few seconds whenever it looks | stackchan-mcp `face_service.cpp` `showCameraPreview` | Visible proof of capture at the device. |
| 10 | State-conditional control panel: the lower half of the state card changes with the state | dotty `dashboard.html` | Fewer controls on screen, always the right ones. |
| 11 | On-robot first-run: welcome, servo safety test, app QR, pairing id | StackChan-GPT `app/assets/assets/setup1.gif`, `setup2.gif` | A finished out-of-box flow, on the device itself. |
| 12 | On-robot settings app reached by a long press or by voice, 14 tiles | nous-girl `hg_settings.cc` | Fix volume, Wi-Fi, lights without a phone. |
| 13 | User-editable LED table per device state with steady / breathing | nous-girl admin Lights tab, `cores3_py32_led.cc` | Personalisation without firmware changes. |
| 14 | Subtitle cues interleaved with audio segments; fixed 2-line box with paging dots | pet-fw `docs/speech_bubble_protocol.md`; openapi `drawSubtitle` | Text stays in step with the voice; helps noisy rooms and deaf users. |
| 15 | Mouth x eyelid frame matrix (4x4) for flat art | pet-fw `data/base_m*_e*.jpg` | Lip sync and blink combined with 16 images. |
| 16 | Persona pack: palette, face geometry, earcons, behaviour in one validated folder, with a preview renderer | alive `personas/*/`, `docs/media/face_gallery.png` | New characters are a data edit; previews match the device. |
| 17 | Numbered setup wizard with "detect provider, models and voices" and "restart needed / applied live" banners | ai-server `config_ui_html.go`; nous-girl admin | Removes the two worst setup pains: wrong model names and "did it apply?". |
| 18 | VAD calibration from 3 s of room noise plus a test recording that shows recognised text | Minimal `incbin/html/vad_calibration.html` | A parent can fix "it doesn't hear me" alone. |
| 19 | Expression presets that bundle face, decorators, LED colour, head motion, duration and guaranteed restore | stackchan-local `modifiers/expression_preset.h` | One call per feeling, never leaves the robot stuck. |
| 20 | Attention card: agent asks for the human (shake, waiting face, pinned label) and a dismiss | xiaozhi-firmware `self.notify.attention` | A clear pattern for "Home needs you". |
| 21 | Action-confirmation emotes (`email` envelope flies, tick appears) and scene sprites (meds, meal, bath) | nous-girl `email.gif`; cloud-mcp `sprites.js` SCENES | Shows what was done, not only how it feels. |
| 22 | Reflex faces for being picked up, shaken, put down, tilted, loud noise, sound direction | alive `personas/spark/expressions.yaml`; pet-fw dizzy and 16-direction lean | Physical handling is the main way children interact. |
| 23 | Auto-hiding status bar: clock, Wi-Fi, battery only while active or on wake | xiaozhi-firmware `SetActiveLocked`; GPT `status_bar.cpp` | Face stays clean, information is there when needed. |
| 24 | Wi-Fi: multiple saved networks with priority order; QR on the robot; audio (sonic) provisioning | pet-fw `sendWifiPage`, "Wi-Fi QR"; xiaozhi `sonic_wifi_config.html` | Fewer setup failures; no typing on a 2 inch screen. |
| 25 | Kid Mode toggle that says exactly what it changes and warns when the policy is not saved | dotty `kid_mode.html` | Plain-language safety state instead of a bare switch. |

Close runners-up: phone-camera face mirroring and dance recorder (StackChan-GPT app); voice audition page (alive);
equalizer face with flicker limits (nous-girl); thermal and owner-aware faces (pet-fw); uniform hardware module pages
(stackchan-local); "started because / last crash" on About (nous-girl).

### C2. Gaps nobody fills

1. **Muted, offline, error, low battery and updating have no agreed face.** Only dotty's sleep state is a real privacy
   state. Nobody shows a clear mic-off mark on the face, a "no network" explanation, or an OTA progress screen with a
   do-not-unplug message (GPT has "Downloading..." only).
2. **No who-is-talking or who-am-I-talking-to display.** Face recognition exists in two repos but the robot screen never
   shows the recognised person or the active profile.
3. **Kid controls are a single switch at best.** No per-child profile, time limits, quiet hours, bedtime mode, volume cap
   or content level picker in any UI.
4. **No conversation history a parent can browse per person** with search, and no export except ai-server's per-device
   Markdown. Dotty's feed is lost on reload.
5. **Accessibility is almost absent.** Only alive has reduced motion; nobody offers high-contrast faces, large subtitles,
   colour-blind-safe LED pairs, or a flash-rate rule (nous-girl's rave limit is the lone example).
6. **Wake word and voice are not tryable.** No page has "say it now" wake-word testing with a hit meter, and only alive has
   voice audition (static files, not the live voice).
7. **No unified health view.** Latency per stage, last error in plain words, and "what to do" are missing; pages show dots
   or raw JSON.
8. **No multi-robot management.** ai-server's per-device JSON is the closest thing.
9. **No authentication UX.** Pages are either loopback-only or open on the LAN; no pairing-code login for a phone.
10. **Dashboards do not preview the face they control** (alive mirrors mode only; local edits blind). No page shows the
    exact pixels the robot will draw, and no face editor exists for non-programmers.
11. **No design system for the 320x240 screen**: fonts, text sizes, safe areas and card styles differ per repo; only the
    GPT launcher has consistent components.
12. **Sound design is thin.** Only alive defines earcons per state; others have one or two effects. No "listening started /
    stopped" tone pair that matches the LED.

### C3. Ratings at a glance

| Repo | On-robot UI | Management UI |
| --- | --- | --- |
| stackchan_alive | 5 motion / 3 information | 4 dashboard, 3 app (code only) |
| nous-girl-stackchan | 5 | 3.5 |
| dotty-stackchan | 4 (LED contract; firmware not in repo) | 4.5 |
| StackChan-GPT | 4 | 2.5 portal, 4 app (code only) |
| stackchan-xiaozhi-firmware | 4 | 4 (Wi-Fi portal only) |
| stackchan-pet-fw | 4 | 4 (Wi-Fi page only) |
| stackchan-local | 3 | 4 bench / 2 family |
| stackchan-ai-server | none | 4 |
| StackChan_Minimal | 2 | 3 |
| stackchan-mcp | 3 | 2.5 |
| stackchan-openapi | 3 (code only) | 2 |
| stackchan-cloud-mcp | 3 (sprite idea) | 2 |
| stackchan-simulator | 2 | 3.5 |
| stackchan-bluetooth-simple | 2 | none |
| stackchan-claude-bridge | none | none |

### C4. Limits of this audit

- Nothing was run, so animation feel, real colours on the panel and LED brightness are inferred from code and stills.
- Flutter, Compose and React apps were read, not rendered. The alive mobile dashboard and several tabbed pages need
  JavaScript; I opened hidden panels by CSS, so dynamic content (lists, live values) is empty in the shots.
- Two faces are my re-renders from source and are approximate. The dotty dashboard shots use sample data I invented to
  fill the templates.
- Dotty's robot firmware, and the xiaozhi-based robot tools used by claude-bridge, are not in these repos.
