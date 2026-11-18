# Reconcile: docs draft (A) against the master plan (B)

- (A) = "MaiPai StackChan Docs Draft" HTML (README + 35 user pages), written from the current local firmware and host on the Mac. Read in full (all 3,155 lines; the long lines are embedded screenshots).
- (B) = `docs/plans/stackchan-master-plan-2026-11-18.md`, written from the public `getmaipai/bot` tree at firmware 0.2.213. Read in full.
- Nothing was run. Every status below is what (A) says, not something checked on the unit.

Caveats that (A) states about itself, and that apply to every row here:
- "This is a draft for review. Source: the firmware session's report. Nothing here is on GitHub and there is no release tag."
- "These docs are written as if v1.0.0 is finished"; pictures named `unit-` are real screenshots, the rest are placeholders.
- BUILT + FLASHED does not mean checked: (A) lists as [unverified] a real wake by voice, how swipes feel, face turning with a real face, subtitles in a real conversation, pickup, sounds, a real private-network join, a signed update with a real key (no release key exists), the egress proof, and eye animation "28 to 33 frames a second with some gaps over 50 ms". Games: "no one has played the games by touch". Dances and offline phrases: not seen or heard ("the test robot was muted").
- OPEN PROBLEM: "After the wake word, one owner heard no reply: the audio reaches the host loud but the speech engine returns no words."
- (A) contradicts itself in places (listed in 1.24). Where it does, the status table at the top of (A) is treated as the stronger source.

---

## 1. Inventory of what (A) says exists

Status labels are (A)'s own: BUILT + FLASHED, BUILT NOT FLASHED, PLANNED, NOT BUILT, [unverified], OPEN PROBLEM, "Needs MaiPai Home". "(no label)" means (A) describes it as existing with no status tag; "(in status table)" means it is named in the top status table.

### 1.1 Voice
| Item | (A) status | Numbers and wording |
|---|---|---|
| Wake word "Hi, Stack Chan" (Espressif speech library, downloaded by the build) | BUILT + FLASHED (in status table); real wake by voice [unverified] | "Wake cue in under 150 ms" |
| Replies by sentence | BUILT + FLASHED | "Replies start on the first finished sentence" |
| Follow-up without wake word | (no label) | "keeps listening for a few seconds" |
| Interrupting by speaking | (no label; listed as a feature and in the 1.0.0 notes) | "Speak while it talks and it stops and listens" |
| Stop word while it talks, no model | (no label) | "'Stop' and touch commands in under 300 ms"; English stop word |
| Voice commands with no model: stop, mute, quiet, don't move, volume up / volume 40, brightness down, sleep, what time is it, night mode; "normal" ends quiet | (no label) | "work in any sentence that starts with the wake word" |
| Brightness by voice: "set brightness to 50 percent", "brighter", "dimmer", "it's too bright" | (no label) | |
| Actions through the model (timer, volume, face) | (no label) | Voice commands still work if the model cannot call actions |
| Offline phrases | (no label); "Not yet heard on a robot" | "Sixteen lines"; default synthetic voice; packs can be built from your own voice in English and Spanish |
| Subtitles / captions | BUILT + FLASHED; subtitles in a real conversation [unverified] | Off by default; bottom strip, top banner, or nowhere |
| Fillers while thinking: none, tone or phrase | BUILT + FLASHED; "Not yet heard by a person" | |
| Persona text, `speech_speed`, `speech_pitch`, `voice` | (no label) | speed 0.75 to 1.5 (default 1); pitch -12 to 12 semitones (default 0); per robot; "a cooking persona" in the 1.0.0 notes |
| Built-in speech engines on the host; own `stt_url`, `tts_url` | (no label) | Blank uses built-in |
| More wake words, a made-up phrase | PLANNED | Default stays "Hi, Stack Chan" |
| Per-person wake phrase | PLANNED | "stored today but not matched" |
| Offline voice commands (no host) | PLANNED | |
| A voice that shows emotion | NOT BUILT | "the face carries emotion" |
| Fewer false wake-ups from fan noise | claim in README (no label) | |
| Wake but no reply | OPEN PROBLEM | STT returns no words |

### 1.2 Faces, overlays, effects
| Item | (A) status | Numbers |
|---|---|---|
| Five face styles: big eyes (default), eyes only, stock, classic, minimal | BUILT + FLASHED | Older styles removed: round, cat, robot, sleepy, retro pixel, heart eyes ("a robot that had one now shows big eyes") |
| Your own picture faces: picture only; picture with drawn eyes and mouth; short run of frames | BUILT + FLASHED; "Not yet seen on a robot screen" | 7 looks (neutral, happy, sad, angry, doubtful, sleepy, speaking); up to 6 frames per look at 1 to 12 fps; up to 14 pictures, 1,000,000 bytes; at most 3 kept ready; held in memory, host resends after restart; upload has no size limit yet |
| Sleepy and sleeping looks | BUILT + FLASHED; "Not yet seen by a person" | |
| Fixed screen zones (top row, face area, subtitle area) | BUILT + FLASHED | |
| Violet remote banner | BUILT + FLASHED | "Remote: Settings", "Remote: Phone", "Remote: Home hub", "Remote" |
| Weather and mood overlays | BUILT + FLASHED; "Not yet seen by a person" | "26 overlays, single and combined" (stormy, rainy, snowy, sunny, windy, night, party, celebrate, love, sleeping); slows itself when busy; pause while a page is up |
| CRT and color effects | BUILT + FLASHED; not yet seen | |
| Smoother eyes and mouth (ease, smooth blink, drift, mouth follows loudness, fade between looks) | (no label); "Not yet seen on a robot screen" | "22 to 45 frames a second while the eyes move (best 49), and 4 to 11 while it speaks (best 21)"; fade about 20; status table: 28 to 33 with gaps over 50 ms |
| Face extras: dizzy, heart, anger, tears, sparkles, stars, zzz (features table also says sweat) | (no label; "seven face extras" in 1.0.0 notes); not yet seen | One at a time; none while muted, camera off, quiet, or a timer rings |
| Word reactions | (no label); not yet seen | 33 built in, six languages, editable up to 40 rows, at most once every 20 seconds per phrase |
| Eye color, background color, feeling tints | (no label) | Any eye color; seven named dark backgrounds or a custom dark color, per person; tint switch on by default |
| Expressions: listening, thinking, happy, joyful, content, wink, surprised; offline look; link screen | (no label) | |
| Thinking cue: three dots at the mouth plus quiet tone | (no label) | `thinking_cue` |
| Low-battery tired look | (no label) | 20, 10, 5 percent |
| Clock face (digits or ring), time-of-day face, night mode | (no label) | |
| Time zone picker | (no label); not seen on screen | 31 zones with summer time |
| Per-person settings (name, face color, caption size, "Use on this unit") | (no label) | Up to 12 people |
| Live preview on the settings page using the same drawing code | (no label) | |
| Status icons switch on the sheet (mic, camera, battery, Wi-Fi problems) | (no label) | Off by default |
| Face-seen icon | PLANNED (status table); features row has no tag, "Not yet seen with a real face" | |
| Turn toward faces | PLANNED | Setting defaults to "always"; "It did not move for a face in the last check"; on-robot detector is an experiment, off, not flashed |
| Scenes (10: rainy day, snowy day, sunny day, bedtime, party, birthday, cozy, spooky, focus, celebrate), `[scene rainy_day]` tag, `[scene off]` | PLANNED ("built on the host but not flashed"; elsewhere "Design only") | Never moves the robot, takes a picture or changes privacy |
| Scenes and display lists; data cards (weather from Home) | PLANNED | |
| Focus countdown screen | PLANNED | |
| Brighter dim level | PLANNED | |
| Guessing a mood from words | NOT BUILT (removed on purpose) | "the robot shows only what it is told" |

### 1.3 Screens
Swipe pages: BUILT + FLASHED; "Not yet checked by a person on the glass: how the swipes feel." Runs on the robot with no host.

Gestures, exactly as (A) documents them:
| You do | The robot does |
|---|---|
| Swipe up from the bottom of the screen | Opens the control sheet over the lower part of the screen |
| Swipe left or right on the face | Moves to the next page. First page on the left shows when you swipe right; first page on the right when you swipe left |
| Swipe down | Stops talking or ends a game. On a page or the sheet it closes it |
| Swipe from the very side edge | Changes the volume, "as it always did". Never changes a page |
| Tap above the open sheet | Closes the sheet |
| Tap the mouth | Mute or unmute (silent; eyes blink once; flat closed mouth) |
| Tap either eye | Camera off or on (calm half-closed eyes looking down) |
| Tap above and between the eyes | Full quiet on or off (sleeping face with a small pause mark) |
| Slow stroke / pet the head strip | Happy, small rare heart, may purr; with `strip_mode = "control"` the strip opens quick sliders (volume, brightness) |
| Touch the head | Returns to the face |
| Touch during a ringing timer or Find beep | Ends it, and "does nothing else"; same for a touch that only wakes a dim screen |
| Touch while in privacy sleep | Wakes it |
| Pick up / shake / tilt | Surprised then settles / dizzy plus a spoken line / tilts head to match |
| Orientation | Upright normal; on its side curious; face down or on its back sleepy; upside down the screen turns 180 degrees; no movement when turned over |
| Hold the reset button 3 seconds (after Settings, Reset and a confirm) | Erases Wi-Fi, pairing and settings |
| Power key | Off, with the Goodbye tone |
| "Privacy button" | Privacy sleep (not explained further) |
| In a game | Swipe down on the top bar to leave; side-edge volume and the stop swipe still work; page swipes and the sheet wait |
| Tap the version ten times | Details (in Troubleshooting; the Info tab is said elsewhere to need "no hidden taps") |
Swipe definition: "a quick, clear move of at least a thumb's width"; a slow drag is not a swipe. Return to the face: wake word or speech starts, head touched, a timer rings, or no touch for 20 seconds on a page or 6 seconds on the sheet (settable: page 5 to 300 s, sheet 5 to 15 s).

Screen zones: fixed top banner row (remote cue, "Here I am!", game scores, lost connection, captions, battery); face area; subtitle strip at the bottom; the control sheet covers the lower part.

| Screen | (A) status | Detail |
|---|---|---|
| Pages: Clock, Timers, Games, Quick actions, Pictures, Dashboard | BUILT + FLASHED | Up to three pages each side; default clock left, games right; Timers page has 1, 5, 10 minute buttons; Quick actions four to six buttons (find me, beep, dance, games, say hi); Pictures change every 8 seconds; Dashboard up to six tiles sent by Home or the host, tiles older than an hour dim |
| Control sheet | BUILT + FLASHED (real screenshot) | Volume and brightness sliders; Wi-Fi, time, battery line; one row of six: Mute, Quiet, Lock, Apps, Games, Settings (another passage says Mute, Quiet, Light, Apps, Games, Settings); configurable to up to 2 sliders, 7 buttons, 4 status lines |
| Lock tile on the sheet | PLANNED (status table) | |
| Passcode lock | BUILT + FLASHED "(keypad drawing still being confirmed)" | Code set on the settings page, auto-lock time, Lock now button, big keypad |
| Apps list / Apps wall | BUILT + FLASHED (real screenshot) | Timers, Alarms, Clock, Quick actions, Pictures, Dashboard, Dance, Lock; big colored tiles, page dots; pressing a tile not yet checked by a person |
| Timers app, Alarms app | BUILT + FLASHED (real screenshot) | Presets 1, 5, 10, 15, 30, 45, 60 minutes and Custom; rows with progress bar and Cancel |
| Tabbed settings: General, Network, Faces, Info | BUILT + FLASHED (real screenshot) | General has the listening light switch; Network has saved Wi-Fi and the network test; Info shows firmware version, image, slot; "Quick settings shows 3 saved Wi-Fi networks" (known gap) |
| Games wall | BUILT + FLASHED (real screenshot) | Tiles with picture and best score |
| Network test and version screen | (no label); not seen on a robot screen | Lines start OK or FIX |
| Reset screen | built, not yet checked on a robot | |
| Swipe pages editor on the host settings page (Behavior, Swipe pages) | (no label) | "Show on the robot", "Send sample tiles"; says "Coming with the next unit update" if the unit is older |
| Developer tools | (no label) | `self.pages.status`, `self.pages.get`, `self.pages.set`, `self.page.show`, `self.page.tiles`; flash keys `pages_cfg`, `page_tiles` (saved at most once in ten minutes) |

Games (BUILT + FLASHED, "seven full-height games"; "No finger, screen or sound has been checked on a robot yet"): Color Memory; Whack-a-Mole (9 holes, 15 moles); Tic-Tac-Toe (Easy, Medium, Hard; win 10/20/30, draw 3/6/9); Do It (tap, swipe left, swipe right, gentle shake, pet my head, tilt); Rock Paper Scissors (best of three); Magic 8-Ball; Dice and Coin. Reaction Time removed. Best five scores per game. Voice start in English and Spanish. Games never move the head; no start in full quiet; sounds follow system volume. One built-in engine plays games as small data files.
Talk games (BUILT, NOT FLASHED; "Not tested with a live model"): 20 Questions, riddles, trivia, word chain, would-you-rather, bedtime stories; English and Spanish; end on "stop the game", round limit, or five quiet minutes; "follow the same child and content rules as ordinary chat".
PLANNED: funnier whack-a-mole (in one list; described as done in another), outside games (signed packs only; "not switched on yet").

Timers and alarms: voice timers and alarms with no model, BUILT + FLASHED ("Not yet tried by a person"). Named and several timers; ring that empties; rings now and every 8 seconds; cancel removes the only alarm or the one set within 5 minutes; snooze; louder in steps; a tone per kind; saved on the host; hourly chime (`hourly_chime`, off); quiet hours (`quiet_from`, `quiet_to`). Announcements: Needs MaiPai Home.

### 1.4 Reactions, moods, pet
| Item | (A) status | Numbers |
|---|---|---|
| Shake, tilt, petting reactions | (no label); head petting "built but not yet checked" | |
| Pickup | PLANNED ("Pickup detection: still being built"); pickup [unverified]; also listed as a working reaction | |
| Movement limits | BUILT + FLASHED, "not yet checked on a real robot" | Gentle on USB; free on battery; steps at 50, 30, 15 and 8 percent; none when carried or turned over; less when tilted; none on its side; strictest wins; "A Settings card that shows the current limit is not built yet" |
| Idle life (breathe, blink, look around, head wobble with speech) | (no label) | `idle_motion` default on |
| Mood from care / pet mood | (no label) | Up to 12 care a day; `pet_mood` |
| Quiet mode, privacy sleep, "don't move" | (no label) | |
| Wake cue per state (`cues`) | (no label) | Camera-on cue cannot be turned off |
| Low-battery ladder | (no label) | Chirp at 20, spoken ask at 10, sleep at 5; amber pulse every 10 s below 15 percent |
| Look around on wake | PLANNED tag; host side on (status table); not verified with a real wake | |

### 1.5 Music and dance
- Dance on request, six named dances (sway, nod yes, shake no, wiggle, bow, groove), each 8 seconds or less: (no label); not yet seen.
- Dance to music: toggle BUILT + FLASHED, host side on, off by default, "not yet checked with a real song". Steps: eyes only, head nod, side to side, every direction with disco ball and confetti, then back down. Face changes every 8 or 16 beats among happy, serene, laughing, love, surprised, wink, silly, excited. Levels and tempo only; no audio kept or sent.
- Song naming: Needs MaiPai Home.
- Streaming radio: NOT BUILT ("tried and dropped: the speaker is small, music sounded thin and the robot answered the music through its own microphone. A future version needs music decoding in the firmware and an echo test first").
- No dance editor ("Choreograph your own dance": none).

### 1.6 Camera, remote, find
| Item | (A) status |
|---|---|
| Remote controls from the host settings page: beep, flash, find my robot (works when muted), say something, pan and tilt / head pad, nod, shake, dance, start a game, take a photo | BUILT + FLASHED, work without Home; off until remote access is on; "Not yet checked on a robot" |
| Photo from the settings page | BUILT + FLASHED, without Home |
| Turning toward you | Listed as built and flashed in local-vs-home; status table says face turning does not move yet (PLANNED) |
| Voice snapshots ("take my picture" with countdown), live view, "what do you see" | PLANNED for your own host |
| Face follow, wave, mirror, "what is this", name list, face and voice recognition | Needs MaiPai Home |
| Find: last seen, Wi-Fi place names, phone-hotspot location, optional map lookup (outside service, off by default), Bluetooth warmer/colder ("may not ship") | (no label; described) |
| Remote pan and tilt | Tilt "about 5 to 85 degrees"; saved spots; refused when carried or blocked; rate limited; logged |
| Remote lights, talk (typed or push-to-talk, one way) | (described) |
Remote control only from the home network or private network, never through an outside relay; needs a token; the token is reset only on the robot.

### 1.7 Privacy and no-stealth
- Mute (tap mouth): powers the microphone chip down; wake word and stop word off; unmute by mouth tap, host settings page (with confirm) or Home; `local_unmute` (default on). Camera off (tap eye): stops at the source and the host drops late frames. Full quiet: mute plus no talking and no moving. Switches survive a restart. Mute is read back; unconfirmed mute warns after a minute; a leak raises an error and the face shows it for 30 seconds.
- No-stealth table: listening = green bars + mic icon; picture = pink, two flashes then steady + camera icon; live view = pink steady + LIVE dot; watching = camera icon + "Watching"; monitor = label + icons + "Listening in"; remote = Remote icon/violet row + tone before speech. "No setting turns the cues off." "The cue comes from the same part of the robot that turns on the microphone or camera."
- No remote listening in remote control. The one exception is the baby/pet monitor, which only starts on the robot.
- No telemetry, no crash upload, no vendor account, host sets the time (no public time servers). Egress proof: [unverified], "we will publish the capture before release".
- "With your own LLM we add no content filter. The model you connect decides what the robot says." (README, Getting started, Privacy, FAQ.)
- A cloud model is allowed by pointing `llm_url` at it; "the privacy promise no longer holds".

### 1.8 Lights and sounds
Two light bars, six lights each. Off most of the time; one meaning per color.
| Color and pattern | Meaning |
|---|---|
| Green steady | Voice is being sent to host or hub |
| Pink, two flashes then steady | Camera picture; steady for live view |
| Cyan, slow pulse every 2 seconds | Needs you: Wi-Fi setup, pairing, timer ringing |
| Amber, one pulse every 10 seconds | Offline, fault, low battery |
| Blue steady | Your turn to talk |
| White, fast pulse every second | Updating |
| Dim amber steady, day only | Watch or monitor mode |
| Red and blue swapping twice a second | Security alert (PLANNED feature) |
| Red at the back | Charging (separate light) |
Green and pink never dim. Tones (12): Needs you, Plug in, Charged, Unplug, Offline, Goodbye, Shutter, Back online, Listening, Low battery, Siren, Error. Night: silent except first-setup, shutter and goodbye. Sounds: [unverified]. Coding companion build light uses green/red bars (Needs Home).

### 1.9 Languages
English, Spanish, French, German, Portuguese, Italian; run-time switch; language packs BUILT + FLASHED ("a few hundred bytes each"); screen font is plain ASCII (accents dropped); not native-reviewed (PLANNED: reviewed translations); CJK is an optional font pack; wake word English only; setup page in English and Spanish.

### 1.10 Setup, pairing, Wi-Fi, flasher
- Web flasher over USB; Wi-Fi can be entered in the flasher dialog; "Bluetooth is off and the factory cloud links are removed". (no label; placeholder picture)
- Pairing: `stackchan pair`, two-minute window, 6 digit code shown on the robot and typed on the host; five wrong codes close it; token stored hashed; `stackchan forget` revokes. Optional screen after pairing: "Do you run MaiPai Home?"
- Wi-Fi setup page: hotspot `stackchan-` plus four characters; six-digit setup code on the robot screen; code changes every few minutes; five wrong tries lock the window; fields: Wi-Fi, password, host address, code, optional one-time private-network key. Status: setup page "built but not yet checked on a robot"; "The new hotspot name, the page that stays open for several networks and the Finish button are built but not flashed".
- "About 20 minutes the first time."
- Reset on the robot; switch back to factory with M5Burner.

### 1.11 Host install
`pipx install git+https://github.com/getmaipai/stackchan`; Mac, Linux, Raspberry Pi 5; no Docker; no Windows service. Commands: `stackchan --help`, `pair`, `check`, `forget`, `install-service` (`--remove`), `token`, `notify --status pass|fail`, `firmware build`, `firmware verify`, `camera delete`; `pipx upgrade stackchan`. Several robots on one host by ID. Phone as the host: PLANNED.

### 1.12 Brain modes and every documented key
| Key | Meaning | Default |
|---|---|---|
| `brain` | `llm` or `home` | `llm` |
| `llm_url` | OpenAI-compatible address | blank |
| `stt_url`, `tts_url` | Speech tools; blank uses built-in | blank |
| `home_url` | Hub address | blank |
| `language` | six languages | English |
| `voice` | | built-in voice |
| `speech_speed` | 0.75 to 1.5 | 1 |
| `speech_pitch` | -12 to 12 semitones | 0 |
| `persona` | prompt text | none |
| `face_style` | settings page says "Big eyes or minimal"; face page says five | big eyes |
| `face_color` | none, named, custom | none |
| `captions` | | off |
| `night_mode`, `quiet_from`, `quiet_to` | | off |
| `thinking_cue` | | quiet tone |
| `strip_mode`, `quick_sliders` | `petting` or `control`; sliders default volume and brightness | petting |
| `hourly_chime` | | off |
| `idle_motion` | | on |
| `pet_mood` | | on (turn off with false) |
| `local_unmute` | | on |
| `cues` | light and tone per state | not given |
| `remote_control` | | off |
| `camera`, `camera_retention` | | off; not given |
| `update_channel` | stable, beta, pinned | stable |
| `update_source` | release manifest, own server or folder, off | release manifest ("official") |
| `update_check` | never, daily, weekly, manual | weekly |
| `update_install` | ask, auto, auto within a window | ask |
| `mcp`, `api`, `events`, `mqtt_url`, `ha_bridge`, `metrics` | Needs MaiPai Home | off |
| Unit flash keys | `pages_cfg`, `page_tiles` | |
Other settings with defaults: Dance to music off; Status icons off; remote access off; feeling tints on; page stay 20 s; sheet stay 6 s; face-turn setting "always"; alert pause 60 s; monitor song timer 30 minutes. Environment variables override secrets in the file. Switching brain needs no reflash, but (A) also says "Home puts the firmware build on the robot that has the extras".

### 1.13 Away from home
Tailscale join by itself after 3 failed tries to reach the host; one-time auth key typed on the setup page, never in an image; contacts only a public coordination service. Not yet checked: a real join, a spoken turn, camera and updates over it. Wi-Fi roaming and "the ported private-network join": PLANNED.

### 1.14 Security claims
Pairing in the room; revocable hashed token; tokens on API, events, metrics (all off by default); signed updates with rollback; remote off by default; camera cue cannot be switched off. Known gaps (A) lists: plain link on home Wi-Fi and no host check (Encrypted link at home: PLANNED); setup page is a short window; memory readable over USB; no network capture yet; security contact not yet added.

### 1.15 Updates
Signature check and self rollback built; "has not yet run with a real release key, because no release key exists yet". Health check 60 seconds. Over Wi-Fi, white pulse. Checking on, installing off.

### 1.16 Coding companion (Needs MaiPai Home)
Agent status on face and bars, spoken update or caption ("Running tests"), build light (`stackchan notify`), dictation (hold the button; Home turns speech into text for the agent), approvals by touch ("Voice alone never approves"), MCP endpoint offered by Home (`mcp = true`, `stackchan token`). No built/flashed label.

### 1.17 Home tools (Needs MaiPai Home)
Local API (REST and WebSocket), event stream, MQTT, home-automation bridge, metrics. All off, all tokened. No built label.

### 1.18 Hardware and models
CoreS3 StackChan. Host does not run a model; Ollama, LM Studio, llama.cpp server, vLLM named. "A 4B-class model answers in under 400 ms to the first token once it is warm" (target); 4B about 3 GB, 8B about 5 to 6 GB, 27B about 16 to 18 GB. "about 76 KB of free working memory". IR and NFC: PLANNED.

### 1.19 Compare page
Star table against factory firmware (checked against M5Stack's README 2026-11-15). Ours: privacy two stars until the capture; link two stars; games two stars; no phone app, no app downloads ("about 548 KB of flash and 24 KB" saved), no ESP-NOW remote, no dance editor, Bluetooth off "and we are reviewing whether to bring it back". The compare page still marks find, remote and live view as "Runs with MaiPai Home" with zero stars, against the rest of (A).

### 1.20 Baby and pet monitor: PLANNED
On your own host, opt-in; starts only on the robot; loudness and motion alerts; listen in, look in, soothe; songs from the Home library; household sharing Needs Home. "Not a certified baby monitor."

### 1.21 Watch and alerts: PLANNED
Arm with a 30 second countdown; motion, loud sound, moved or lifted, person (Home); responses quiet alert, warning, alarm; red and blue twice a second, under three flashes a second, stops after one minute; 60 second pause between alerts.

### 1.22 "Not included" and why
Sound direction; Bluetooth; a phone app; a voice that shows emotion ("the face carries emotion"); guessing a mood from your words ("the robot shows only what it is told"); anything that calls an outside service by itself; streaming radio (tried and dropped: thin sound, the robot answered the music through its own microphone). Also removed: online app downloads, video call and cloud camera upload, ESP-NOW remote, CJK and emoji in the default image, Reaction Time, six older face styles.

### 1.23 (A)'s PLANNED list, complete
Face turning; on-robot face detector; Lock tile on the sheet; face-seen icon; focus countdown; offline voice commands; more wake words; per-person wake phrase; scenes, display lists, data cards; live view, watching, alarm and siren, monitor on own host; voice snapshots; Wi-Fi roaming and ported private-network join; pickup detection; brighter dim level; outside games; encrypted link at home; IR and NFC; phone as the host; reviewed translations; wake look-around (host on); new setup page (built, not flashed).

### 1.24 Contradictions inside (A)
1. Face styles: five (face page, README) against "Big eyes or minimal" (settings) and "two styles" (compare).
2. Sheet row: Lock (sheet page, features) against Light (Apps row); Lock tile is PLANNED in the status table.
3. Remote, find, photo: "work without MaiPai Home" (find page, local-vs-home) against "Needs MaiPai Home" (compare, settings, privacy, no-stealth "MaiPai Home firmware build").
4. Turning toward you: built and flashed (local-vs-home) against "does not move yet" (status table).
5. Pickup: a working reaction (reactions page) against PLANNED.
6. Bluetooth: "Not included" against "under review" (compare, find).
7. Version: Info tab "no hidden taps" against "More, then Version... Tap it ten times"; reset and time zone paths use the older "More" menus.
8. Scenes: "built on the host" against "Design only".
9. Leaving a game: "swipe down on the bar at the top" against "swipe down from the bottom edge".
10. Whack-a-mole: funny moles described as present; also PLANNED.

---

## 2. Reconciliation table: every work item in (B)

Status column uses: BUILT+FLASHED, BUILT NOT FLASHED, PLANNED IN (A), NOT MENTIONED, CONFLICTS; "part" means only part of the item. "Verify" always includes the hands-on checks (A) says are missing.

### Wave 0 (Z)
| ID | Plan title | Status per (A) | Should become |
|---|---|---|---|
| Z1 | Read the handover, correct sections 0 and 1 | NOT MENTIONED (process) | Keep; use (A) as the first half of the handover; sections 1, 9a, 12.1, 19, 20 rewritten from it |
| Z2 | Land or park limiter and dance v2 | BUILT+FLASHED (limits and dance-to-music toggle), not on GitHub | Shrink: push the local tree; (A) says nothing is on GitHub |
| Z3 | Pin sync Bot/spec/Home | NOT MENTIONED | Keep; first settle that the host is now the `stackchan` pipx program |
| Z4 | Changelog 0.2.107 to 0.2.213 | CONFLICTS: (A) release notes say one release, 1.0.0, "no earlier tags" | Change: decide versioning story before writing 107 lines |
| Z5 | Owner decisions and boundary rule | NOT MENTIONED | Keep; reopen the decisions section 4 below lists |

### Lane A
| ID | Plan title | Status per (A) | Should become |
|---|---|---|---|
| A1 | Movement governor in the spec | BUILT+FLASHED on the unit (part); spec NOT MENTIONED | Shrink: write the spec from the built limiter (USB, 50/30/15/8, carried, tilt, side, inverted) |
| A1b | ML01 conforms on the unit | BUILT+FLASHED, unverified | Shrink to verify on the pose table; add the missing status read/card |
| A2 | Unit wire schema | NOT MENTIONED ((A) only mentions a contract-version mismatch message) | Keep |
| A3 | Single servo writer, gating | NOT MENTIONED | Keep |
| A4 | Release gates | NOT MENTIONED | Keep |
| A5 | Measure today's unit | Part: (A) quotes 28 to 33 fps, 4 to 11 fps speaking, 76 KB free | Keep; start from those numbers; speaking frame rate is the first finding |
| A6 | Wake word spike, sensitivity | PLANNED IN (A) (more wake words); sensitivity NOT MENTIONED | Keep |

### Lane S
| ID | Plan title | Status per (A) | Should become |
|---|---|---|---|
| S1 | Firmware exposure lint | NOT MENTIONED (claims tokens everywhere) | Keep as a check of (A)'s claims |
| S2 | `wss://` to the unit | PLANNED IN (A) ("Encrypted link at home") | Keep |
| S3 | Update signature on the unit | BUILT (flashed not stated), unverified: no release key | Shrink: make a release key, run the tamper test |
| S4 | Secured setup hotspot (WPA, code, QR) | CONFLICTS: (A) has a rotating six-digit on-screen code with a five-try lock, no WPA or QR | Change: decide whether the code is enough; the password still crosses an open hotspot |
| S5 | Tool audit | NOT MENTIONED | Keep; add the remote-control and scene tools |
| S6 | Egress proof | PLANNED IN (A), [unverified] | Keep; (A) promises it before release |
| S7 | On-unit child lock, band as numbers | CONFLICTS (part BUILT+FLASHED): (A) has an adult passcode lock with auto-lock, no band caps | Change: build band caps on top of the passcode lock; finish the Lock tile |
| S8 | Safety scan CI | NOT MENTIONED | Keep |
| S9 | Every speech path through Home's gate | CONFLICTS (part): own-LLM mode has no filter by design | Change: scope to `brain = "home"`; add talk games, word reactions, remote "say", offline phrases to the path list |
| S10 | Secure boot decision | NOT MENTIONED ((A) admits memory is readable over USB) | Keep |

### Lane B
| ID | Plan title | Status per (A) | Should become |
|---|---|---|---|
| B1 | Motion pass | BUILT+FLASHED ("smoother eyes"), not seen on screen | Shrink: verify; add staged order and a reduced-motion setting if missing |
| B2 | Emotion vocabulary and fold table | NOT MENTIONED | Keep |
| B3 | Overlay and icon layer | BUILT+FLASHED (7 extras, 26 overlays) | Shrink: add only the missing icons (!, ?, check, mail, pill, moon, blush) and confirm the tools |
| B4 | Lip sync from level | BUILT+FLASHED (mouth follows loudness) | Shrink to a performance fix: 4 to 11 fps while speaking |
| B5 | System-state faces | Part BUILT+FLASHED (tired battery, offline, updating icon) | Shrink: hot and error only |
| B6 | Pick-up, put-down faces | PLANNED IN (A) (detection "still being built"; carried stops motion) | Keep |
| B7 | First-run and Wi-Fi | Part BUILT NOT FLASHED (multi-network page, Finish); QR NOT MENTIONED | Shrink: flash and verify; welcome and flat-surface screens remain |
| B8 | Quick settings page 2 | BUILT+FLASHED and superseded (control sheet + tabbed Settings) | Drop as written; keep the 100 open/close memory check |
| B9 | Picture channel without JPEG | Part BUILT+FLASHED (picture faces, Pictures page, dashboard tiles); cards PLANNED | Shrink: find out how pictures reach the screen today, then add weather card and snapshot |
| B10 | Subtitles | BUILT+FLASHED, unverified in conversation | Shrink to verify |
| B11 | Attention card | NOT MENTIONED | Keep |
| B12 | Camera moment | Part BUILT+FLASHED (pink flashes, double click, camera icon, photo) | Shrink to verify; preview stays optional |
| B13 | Auto-hiding status bar | CONFLICTS: (A) has a fixed top row plus a Status icons switch (off) | Change: drop auto-hide; adopt the built zones |
| B14 | Face packs as data | CONFLICTS (part): five fixed styles, six removed; no catalog format | Change: define the pack around the five styles and picture packs |
| B14b | Illustrated pack format | BUILT+FLASHED as "your own picture faces" (still, still + drawn eyes and mouth, frame loop) | Change: player exists; work left is our own art, flash storage (packs are RAM-held, 1 MB), validator |
| B15 | Ring reserved pixels, flash cap | NOT MENTIONED (two bars of six; meanings fixed) | Keep; restate for two bars |
| B16 | Earcon set | BUILT (12 tones), sounds unverified | Shrink to verify by ear |
| B17 | Screen style standard | NOT MENTIONED | Keep, as an audit of about ten built screens rather than a gate before building |
| B18 | About 30 faces, 12 palettes | CONFLICTS: (A) cut to five styles and removed six | Change: owner decides direction before any drawing |
| B19 | Gesture map | CONFLICTS (mostly BUILT+FLASHED): pages, sheet, swipe-down close exist; taps and side-edge volume differ | Change to verify plus the four open differences (section 4.1) |
| B20 | Music face and visualizer | Part BUILT+FLASHED (notes, disco ball, confetti, mood faces, side lights) | Shrink to verify with a real song; flash-rate cap check |

### Lane C
| ID | Plan title | Status per (A) | Should become |
|---|---|---|---|
| C1 | Turn quality | NOT MENTIONED; OPEN PROBLEM sits here | Keep; first task is the "wake but no words" bug |
| C2 | Wake sensitivity, "say it now" | NOT MENTIONED | Keep |
| C3 | Speaker turn at wake | PLANNED IN (A) (face turning does not move; look-around host side on) | Keep; default conflicts ((A) "always") |
| C4 | Idle motion levels | Part built (`idle_motion` on/off, default on) | Shrink: add levels and torque release |
| C5 | Wake word survives rest stages | NOT MENTIONED | Keep |
| C6 | Whisper night | NOT MENTIONED | Keep |
| C7 | Speaker identity by voice | Needs MaiPai Home in (A), no build label | Keep |
| C8 | Face recognition measured | Needs MaiPai Home in (A), no build label | Keep |
| C9 | Quiet hours, bedtime, caps | Part built (`quiet_from`, `quiet_to`, chime silence) | Shrink: bedtime, daily cap, band volume cap |
| C10 | Barge-in decision record | CONFLICTS: (A) says interrupting by speaking works | Change: measure which is true, then fix the doc or the plan |
| C11 | Per-person preferences | Built on the host page (12 people: name, color, caption size) | Shrink: connect to Home profiles; keep names off the unit |
| C12 | Apply by identification | NOT MENTIONED (manual "Use on this unit") | Keep |
| C13 | No-recognition picker | Part (host page only) | Keep the on-robot picker |
| C14 | Several people at once | NOT MENTIONED | Keep |

### Lane E
| ID | Plan title | Status per (A) | Should become |
|---|---|---|---|
| E0 | Robot package host | Part: one game engine plays data files; outside packs PLANNED | Change: build on that engine and its signing rule |
| E1 | Games | BUILT+FLASHED (7 touch games) + BUILT NOT FLASHED (20 Questions, trivia) | Drop the build; verify by touch, flash talk games |
| E2 | Bedtime story mode | BUILT NOT FLASHED (talk game) | Shrink: slow voice, dim face, sleep ending |
| E3 | Medicine reminders | NOT MENTIONED | Keep |
| E4 | Smart home by voice | NOT MENTIONED | Keep |
| E5 | Ambient status | Part BUILT+FLASHED (Dashboard tiles page) | Shrink: feed tiles from Home |
| E6 | MCP from the Bot service | CONFLICTS: (A) puts MCP in Home only | Change: decide where it lives |
| E7 | Home music and radio on the robot | CONFLICTS: (A) dropped radio after trying it | Change: gate on firmware decoding and the echo test |
| E8 | Dance teach | NOT MENTIONED ("no dance editor") | Keep, low priority |
| E9 | Companion robot parts | NOT MENTIONED | Keep |
| E10 | My companion on the shared robot | NOT MENTIONED | Keep |
| E11 | Sentry and presence | PLANNED IN (A) with a full user-level design | Change: (A)'s watch page is the draft design note; red and blue lights need a ruling |

### Lane F
| ID | Plan title | Status per (A) | Should become |
|---|---|---|---|
| F1 | Scenario runner | NOT MENTIONED | Keep |
| F2 | Golden frames | NOT MENTIONED ((A) has `unit-` screenshots and a real-code preview) | Keep; many more screens to cover |
| F3, F3a | Software unit, headless core | NOT MENTIONED | Keep |
| F3b | 3D view | NOT MENTIONED | Keep |
| F3c | Interaction | NOT MENTIONED | Keep; add the built gestures |
| F3d | Side panel | NOT MENTIONED | Keep |
| F3e | Embed in Home and docs | Part: host page already has a live preview | Keep |
| F3f | Reachy Mini view | NOT MENTIONED | Keep |
| F4 | Contract tests | NOT MENTIONED | Keep |
| F5 | Browser build | NOT MENTIONED | Keep, optional |

### Lane G
| ID | Plan title | Status per (A) | Should become |
|---|---|---|---|
| G1 | Now card | NOT MENTIONED for Home; the host page has status, mute, remote controls | Keep; reuse the host page's parts |
| G2 | Add, update flows | CONFLICTS (part): pairing is a typed code on the host; "Do you run MaiPai Home?" screen | Change to fit the built pairing |
| G3 | Health tab | NOT MENTIONED (`stackchan check`, on-robot network test exist) | Keep; reuse those checks |
| G4 | Activity counts | NOT MENTIONED (an activity log "anyone in the household can read") | Keep; check that log against rule 6a |
| G5 | Memory page filter | NOT MENTIONED | Keep |
| G6 | Live face mirror | Built on the host page (same drawing code) | Shrink: embed it in Home |
| G7 | Settings keys, one registry | CONFLICTS (part): `robot.toml` holds about 30 keys | Change: one registry across `robot.toml` and Home |
| G8 | Mic check and wake test | NOT MENTIONED | Keep; raise priority (OPEN PROBLEM) |
| G9 | Packs install from the Catalog | Part (host Packs page: language and phrase packs) | Keep |
| G10 | Multi-robot | Built in the host ("several robots, one host") | Shrink for Home |
| G11 | Pack builder | NOT MENTIONED (picture upload exists) | Shrink to art generation and validation |
| G12 | Phone web app | Part BUILT+FLASHED (host web page: remote controls, photo, head pad); live view PLANNED | Shrink |

### Lane H
| ID | Plan title | Status per (A) | Should become |
|---|---|---|---|
| H1 | README rewrite | Drafted in (A) | Shrink to review; fix contradictions (1.24) |
| H2 | User guide | Drafted in (A): 35 pages | Shrink to review and real captures |
| H3 | Home README and comparison | Compare page drafted | Shrink |
| H4 | Transparency, SECURITY, CONTRIBUTING | Part (disclaimer; security contact missing) | Keep |
| H5 | Privacy page | Drafted (privacy, no-stealth, mute pages) | Shrink to review |
| H6 | Feature docs with "runs on" map | Drafted (features table) | Shrink; fix the Home/own-host contradictions |
| H7 | Developer docs | Referenced only (`docs/dev/...`) | Keep |
| H8 | Measurements and limits page | Part (status table, "not yet checked" notes) | Keep |
| H9 | Troubleshooting | Drafted | Shrink |
| H10 | Reachy Mini stubs | NOT MENTIONED | Keep |

### Lane K
| ID | Plan title | Status per (A) | Should become |
|---|---|---|---|
| K1 | Captive portal rebuilt | Part: built; new version BUILT NOT FLASHED; English and Spanish | Shrink: flash, verify, restyle |
| K2 | QR on the robot | CONFLICTS: (A) uses typed six-digit codes | Change: owner picks QR, code, or both |
| K3 | Wi-Fi at flash time | Already in (A): the web flasher takes Wi-Fi | Shrink: the promise question is now about the flasher |
| K4 | Camera reads a QR | NOT MENTIONED | Keep as a spike |
| K5 | Bluetooth not built | CONFLICTS in reasons: (A) says it "saved almost no memory" and is under review | Change the decision note |
| K6 | One-command install, browser flasher | Documented as existing (`pipx`, web flasher); nothing on GitHub | Shrink to publish and test from the README |

### Lane M
| ID | Plan title | Status per (A) | Should become |
|---|---|---|---|
| M0 | Brain interface | Built in the host (`brain = "llm"` or `"home"`) | Shrink to spec and contract tests |
| M1 | Home Assistant voice satellite | NOT MENTIONED | Keep |
| M2 | Front door camera | NOT MENTIONED | Keep |
| M3 | Robot as a Home Assistant device | CONFLICTS: `ha_bridge` is Needs MaiPai Home | Change: decide where |
| M4 | Standalone brain | BUILT and the default mode; CONFLICTS on filter, cloud indicator, adult label | Change: not wave 4; settle the three rule questions now |
| M5 | Local settings page | Built (host settings page, six languages) | Shrink: loopback and token check |
| M6 | Handover between brains | Built per (A) (one key, no reflash); (A) also says Home changes the firmware build | Shrink to verify |
| M7 | Matter bridge | NOT MENTIONED | Keep |

### Lane N
| ID | Plan title | Status per (A) | Should become |
|---|---|---|---|
| N1 | Agent status mirror without Home | CONFLICTS: (A) says Needs MaiPai Home | Change: decide |
| N2 | "Needs you" card | Part: (A) has touch approvals showing the request | Change: (A) shows request text; (B) forbids prompt text on the robot |
| N3 | Usage meter spike | NOT MENTIONED | Keep |
| N4 | Spoken summary | Part ("can also speak a short update") | Keep |
| N5 | Agent tools over MCP | CONFLICTS: MCP is in Home (`mcp = true`) | Change with E6 |

### Lane O
| ID | Plan title | Status per (A) | Should become |
|---|---|---|---|
| O1 to O7 | Lander pickup, decision queue, ledger, prompts, digest, approvals, owner test kit | NOT MENTIONED | Keep all; O7's checklist should be (A)'s [unverified] list |

### Lane P
| ID | Plan title | Status per (A) | Should become |
|---|---|---|---|
| P1 | Baseline map | Part (fps and 76 KB quoted) | Keep |
| P2 | Memory governor | NOT MENTIONED (overlays slow themselves; 3 pictures ready) | Keep |
| P3 | Per-release report | NOT MENTIONED | Keep |
| P4 | Host-computed mouth cues | NOT MENTIONED; mouth is on-unit today | Keep; raise priority |
| P5 to P13 | Plain audio, binary frames, host-drawn cards, stacks, pools, tasks, PSRAM, build-on-open, frequency scaling | NOT MENTIONED | Keep all |

### Lane Q
| ID | Plan title | Status per (A) | Should become |
|---|---|---|---|
| Q1 | Signed app verification | Built per (A), no real key | Shrink with S3 |
| Q2 | NVS encryption | NOT MENTIONED (gap admitted) | Keep |
| Q3 | `esp_mmap_assets` | NOT MENTIONED | Keep; would fix RAM-held picture faces |
| Q4 to Q7 | Host target, heap tracking, power management, `pytest-embedded` | NOT MENTIONED | Keep |
| Q8 | On-unit face detection | PLANNED IN (A): experiment image built, not flashed, off | Shrink to flash and measure |
| Q9 | Echo cancel | CONFLICTS with (A)'s "interrupt by speaking" claim | Keep; (A)'s radio failure points at missing echo cancel |
| Q10 | Light JPEG decoder | NOT MENTIONED | Keep; check how picture faces decode first |
| Q11 | Easy Connect | NOT MENTIONED | Keep |
| Q12 | Built-in roaming | PLANNED IN (A) (Wi-Fi roaming) | Keep |
| Q13 to Q16 | Delta updates, USB classes, component swaps, DS peripheral | NOT MENTIONED | Keep |

### Section 22 (R)
| ID | Plan title | Status per (A) | Should become |
|---|---|---|---|
| R1 | Line-by-line review | NOT MENTIONED | Keep; target the local tree, not 0.2.213 |
| R2 | Token in photo address | NOT MENTIONED | Keep; recheck on the new host |
| R3 | Pairing token on the command line | NOT MENTIONED ((A): code typed into `stackchan pair`) | Recheck; may be gone |
| R4 | Debug dashboard routes | NOT MENTIONED | Keep; recheck on the host settings page |
| R5 | Camera ring during silent watching | CONFLICTS: (A) promises every mode shows, cue tied to the hardware switch | Change: decided by (A)'s promise; verify the code keeps it |
| R6 | Update over plain HTTP, hash only | CONFLICTS: (A) says signed | Recheck with S3 |
| R7 | Wi-Fi password over open hotspot | Part: code and lock added; hotspot still not stated as encrypted | Keep with S4 |
| R8 | Cited security review missing | NOT MENTIONED ("We audited the design") | Keep |
| R9 | `bump.sh` | NOT MENTIONED | Keep |
| R10 | "Shake it or lift it" | (A) repeats the pickup claim | Keep; fix in (A) too |
| R11 | Drifting numbers | (A) has its own (1.24) | Keep |
| R12 | Changelog cleanup | CONFLICTS with (A)'s single 1.0.0 | With Z4 |
| R13 | Notes index | NOT MENTIONED | Keep |
| R14 | Licensing page | Part (README: AGPL-3.0, NOTICE, THIRD-PARTY.md) | Shrink |
| R15 | Measurements | NOT MENTIONED | Keep |
| R16 | Version identity | Part (Info tab shows version, image, slot) | Keep |
| R17 | Profile capabilities | NOT MENTIONED | Keep |
| R18 | Unwired pieces | Part: Goodbye tone is now documented as used; face turning still planned | Recheck each |
| R19 | Front-shell tap | NOT MENTIONED | Keep in B19 |
| R20 | READMEs lack the robot | Drafted in (A) | Shrink |

### Lane T
| ID | Plan title | Status per (A) | Should become |
|---|---|---|---|
| T0 to T3, T5, T7 to T9, T11 to T13 | Build and test speed | NOT MENTIONED | Keep |
| T4 | Wireless update as the bench path | Part (Wi-Fi update with rollback built) | Keep |
| T6 | Live data, no rebuild | Part (pages, word reactions, language packs, pictures change with no reflash) | Shrink |
| T10 | More units | Withdrawn in (B) | Stays withdrawn |

### Section 21 (V, X)
| ID | Plan title | Status per (A) | Should become |
|---|---|---|---|
| V1 | Talking over the robot | CONFLICTS: (A) documents it as working | Shrink to measure; build only if the claim fails |
| V2 | Own-name wake word maker | PLANNED IN (A) | Keep |
| V3 | Turn to the speaker by sight | PLANNED IN (A) | Keep |
| X1 to X8 | Our own firmware | NOT MENTIONED; (A)'s README says the repo is "patches to the StackChan firmware and a build recipe" | Keep, pending Z1; much more built UI now has to be ported |

Counts (about 195 ids): drop or drop-the-build 2 (B8, E1); shrink to verify or polish about 48; change about 27; keep about 117; withdrawn 1.

---

## 3. Things (A) has or plans that (B) lacks entirely

Built or documented as existing:
1. Passcode lock with auto-lock and Lock now.
2. Apps list and tile walls; on-screen Timers and Alarms apps.
3. Alarms: snooze, louder in steps, a tone per kind; rule-based voice timers and alarms with no model.
4. No-model voice command set (stop, mute, quiet, don't move, volume, brightness, sleep, time, night mode).
5. 26 weather and mood overlays; CRT and color effects.
6. Word reactions (33, six languages, editable).
7. Pet mood / mood from care; hourly chime.
8. Six languages, language packs, offline-phrase packs from your own voice; 31 time zones.
9. Persona text, speech speed and pitch, filler choice.
10. Remote controls on the host page with the violet banner; Find my robot (last seen, place names, hotspot location, optional map lookup).
11. Quick actions, Pictures and Dashboard pages; the swipe-page editor on the host.
12. Head-strip quick sliders (`strip_mode`), privacy sleep, 180 degree screen flip.
13. Whack-a-Mole, Tic-Tac-Toe, Do It, Magic 8-Ball, Dice and Coin; riddles, word chain, would-you-rather.
14. Reset on the robot (double confirm, 3 second hold); on-robot network test; restart guard.
15. Update settings (`update_channel`, `update_source`, `update_check`, `update_install`); `stackchan firmware build/verify`.
16. The `stackchan` command set (`pair`, `check`, `forget`, `install-service`, `token`, `notify`, `camera delete`).
17. Mute read-back, unconfirmed-mute warning, leak detection with a 30 second face.
18. Switch back to factory firmware page; star comparison against factory; hardware and model sizing guide.
19. Core build and "Home build" of the firmware as two images.
20. Local API, event stream, MQTT, metrics (in Home).

Planned in (A), absent from (B):
21. Scenes with a `[scene ...]` tag and display lists.
22. Baby and pet monitor.
23. Security alarm with siren and red/blue lights.
24. Focus countdown; offline voice commands; brighter dim level.
25. Infrared and NFC; phone as the host; native-reviewed translations; outside signed game packs.
26. Dictation to a coding agent; build light.

---

## 4. Direct conflicts

1. **Gestures ((A) built vs (B) 20.2 to 20.4).** (B) 20.2 says left/right swipes change volume and no clock exists; (A) has pages on left/right and a control sheet. Remaining differences from (B)'s proposal: (A) keeps the three privacy switches as single silent taps ((B) proposes 0.7 s holds and labeled buttons; (A)'s sheet has Mute and Quiet buttons but no camera button); (A) keeps volume on the "very side edge", either side ((B): right-edge drag); (A) has no "hold the center 1.5 s"; (A)'s pages are user-chosen from six, up to three per side ((B): Face, Clock, Now); (A) has no first-run tour or chevrons.
2. **Barge-in.** (A): "Speak while it talks and it stops and listens." (B) sections 3, C10, 20.1: off, no echo cancel. (A) gives no test evidence, and its radio note says the robot "answered the music through its own microphone". One of the two documents is wrong.
3. **"Not included" vs (B) section 21.** Phone app: (A) excludes; (B) G12 builds an installable web app. Bluetooth: both say no, but (A) says it "saved almost no memory" and is under review, while (B) says it was stripped for memory. Sound direction: agree. Emotion voice and mood guessing: (A) rules them out on purpose; (B) is silent, but B2's "host maps any model emotion to a face" must not become guessing from words. Outside services: (A) forbids anything calling out by itself; (A)'s own optional map lookup and (B)'s cloud brains both need that sentence reworded. Radio: (A) dropped; (B) E7 plans it.
4. **Own-LLM mode vs lane M.** (A): `brain = "llm"` is the default and built. (B): standalone brain is M4, wave 3 or 4, needs a rule 0 change first. (B) R-B6 defines four modes; (A) has two and no Home Assistant mode.
5. **Content filter.** (A), four times: "we add no content filter." (B) M4 and decision 18: "basic content filter on by default", adult label, "a child or teen robot requires Home". (A) has no adult label and its FAQ answers "Is it safe for children?" with "pick a model and persona". (A)'s talk games claim to "follow the same child and content rules as ordinary chat", which means nothing in own-LLM mode.
6. **Cloud models.** (A): any address works, a FAQ warning only. (B) decision 19: explicit opt-in with an indicator.
7. **Coding companion and MCP.** (A): Needs MaiPai Home, MCP served by Home, approvals by touch show the request, dictation sends speech to the agent, build light turns red. (B) lane N: works without Home through the Bot service, "only state, project name and counts reach the robot", "voice never starts a shell task", ring never red.
8. **Faces.** (A): five styles, six older styles deleted, any eye color, user picture faces already playing stills, patched stills and frame loops, 26 overlays, 7 extras. (B) section 19: "17 faces, 7 palettes", target about 30 expressions and 12 palettes, illustrated packs as a wave 3 build. Direction (fewer, simpler) and state (picture player exists) both differ. Whether (A)'s "styles" and (B)'s "faces" count the same thing is not stated in either; (A) lists about ten expressions.
9. **Install and flasher.** (A): `pipx install git+https://github.com/getmaipai/stackchan`, web flasher, Pi 5, described as done. (B) K6: an M-size wave 3 item, and section 0 says that repo "holds only an issue form". (A) agrees nothing is pushed.
10. **Setup code vs K1, K2, S4.** (A): typed six-digit setup code, rotating, five-try lock, plus a typed six-digit pairing code on the host. (B): WPA hotspot with a per-unit code and QR, then a pairing QR that opens Home's approval page. (A)'s pairing needs a terminal, which (B) 12.1 says a non-technical adult must never need.
11. **Wi-Fi at flash time (K3).** (B) treats it as needing the owner's yes against a published promise. (A)'s flasher already takes Wi-Fi.
12. **Indicators.** (A): violet top-row banner for remote, never blinks; green = audio being sent; blue = your turn; pink = camera; cyan also means a ringing timer; white = updating; dim amber = watch; red and blue for alerts; red build light. (B): ring standard "never red", roles live/camera/pairing/attention/listening/child-controls, reserved pixels, "a distinct mark" for a remote camera, and no remote-control indicator at all. (B) says "12 ring lights"; (A) says two bars of six.
13. **Lock.** (A): a passcode lock for the whole robot, set by the owner. (B) S7: a band-driven child lock on settings only, with privacy switches that a child can turn on but not off. (A)'s `local_unmute` is the nearest piece. (B) 20.3 "Nothing is locked for a child" is no longer accurate, but (A)'s lock is not child-specific.
14. **Launcher.** (B) 2.1 and 21.3 reject "a launcher of apps". (A) has an Apps wall and a Games wall, reached from the sheet; the face stays home.
15. **Status bar.** (B) B13 auto-hiding bar; (A) fixed top row plus optional icons.
16. **Face following default.** (A): setting defaults to "always". (B) section 3: once at wake, continuous opt-in.
17. **Remote listening and monitoring.** (A) plans a baby monitor that streams the microphone to a phone and a siren alarm. (B) defers sentry to a privacy design note (E11) and R-B2 has no such mode.
18. **Where management lives.** (A): three places hold the same settings (`robot.toml`, host page, robot). (B) R-B5: "No second definition of any setting"; with Home, Home "and nowhere else".
19. **Names on the unit.** (A) per-person name and color with "Use on this unit". (B) R-B4: the unit never receives a name. Not stated in (A) whether the name is sent.
20. **Product shape.** (A) is a product called MaiPai for StackChan with its own host program; Home is optional. (B) is written as Home's robot with the Bot service in the middle and Reachy Mini beside it. (A) never mentions the Bot service, the spec, or a second body.

---

## 5. Corrected "where we stand" (40 lines)

1. The current work is a local tree for `getmaipai/stackchan`: firmware patches plus a build recipe, and a Python host installed with `pipx`. None of it is on GitHub and there is no release tag or release key.
2. It runs with no Home: `brain = "llm"` is the default, any OpenAI-compatible model, built-in speech. `brain = "home"` is one key away.
3. On the unit, built and flashed: five face styles, user picture faces, sleepy and sleeping looks, 26 overlays, CRT and color effects, seven face extras, eased eyes and a level-driven mouth.
4. Fixed screen zones: top banner, face, subtitle strip. Captions exist, off by default.
5. Swipe pages (clock, timers, games, quick actions, pictures, dashboard), a swipe-up control sheet, Apps and Games walls, Timers and Alarms apps, tabbed Settings (General, Network, Faces, Info).
6. A passcode lock is flashed; its keypad drawing is still being confirmed; the Lock tile is planned.
7. Seven touch games are flashed. Six talk games, including bedtime stories, are built and not flashed.
8. Voice timers and alarms work by rule with no model. A no-model voice command set exists.
9. Wake word, sentence-by-sentence replies, fillers, language packs for six languages are flashed.
10. The movement limiter is flashed: USB gentle, battery steps at 50/30/15/8 percent, nothing when carried or inverted.
11. Dance on request and dance to music (off by default) are flashed.
12. Remote controls with a violet banner, find, and photo from the host page are flashed, opt-in.
13. Mute, camera off and full quiet remain single taps, with read-back and leak detection.
14. Pairing is a six-digit code typed on the host. Wi-Fi setup uses a hotspot plus a rotating six-digit code; the newer multi-network page is built, not flashed.
15. A web flasher and Tailscale auto-join are described; neither is verified.
16. Signed update with rollback is built and has never run with a real key.
17. Almost none of the above has been checked by a person: no real voice wake, no swipe feel, no game by touch, no sound heard, no dance seen.
18. Open bug: wake cue plays, audio reaches the host loud, speech engine returns no words.
19. Measured: eyes 28 to 33 fps with gaps over 50 ms; 4 to 11 fps while speaking; about 76 KB free working memory.
20. Not built: face turning (does not move), pickup detection, on-robot face detection (experiment image only), scenes, live view, watch, monitor, encrypted home link, roaming, more wake words.
21. Dropped on purpose: streaming radio, emotion voice, mood guessing, Bluetooth, phone app, six older face styles, Reaction Time.
22. Known gaps: plain link at home, no egress capture, memory readable over USB, ASCII-only screen font, no content filter in own-LLM mode.
23. Still true from (B): no wire schema, no release gates, no virtual unit, no Home management page work, pin drift, one unit.
24. Unknown from (A): what Home-side features (recognition, memory, announcements, coding companion, API) actually work against this tree; (A) labels them only "Needs MaiPai Home".
25. Net effect on (B): lanes B, E1, K, M0/M4/M5 and H move from "build" to "verify, flash, publish"; lanes A2 to A6, S, P, T, F, O, G are unchanged; about 27 items need an owner ruling because the built product chose differently.

### Statements in (B) that are now wrong

Section 1:
| (B) says | Correction from (A) |
|---|---|
| 1.1 "17 drawn faces in 7 palettes plus a night face" | Five styles; six older ones removed; any eye color; seven named backgrounds |
| 1.1 "quick settings (volume, brightness, saved Wi-Fi)" | Control sheet, Apps and Games walls, tabbed Settings, lock |
| 1.1 ring "never red" | (A) documents red/blue alerts (planned) and a red build light |
| 1.1 "Voice turns through Home with age gates" as the base | Default brain is the owner's own LLM with no gate |
| 1.2 row 7 "Games (Simon, rock paper scissors), bedtime stories: Not built" | Seven games flashed; stories built, not flashed |
| 1.2 row 6 display router "Not built" | Dashboard tiles, Pictures page and picture faces are flashed; cards planned |
| 1.2 row 10 "setup window: Not built"; QR and touchscreen entry | Setup page with code exists; QR and on-screen keyboard still absent |
| 1.2 row 11 "sleep-Z animation, heart symbol tool: Not built" | Sleeping look with Z and heart, zzz extras are flashed; pickup still not built |
| 1.2 row 12 pairing "still a developer step" | Still a terminal step (`stackchan pair`), now with an on-screen code |
| 1.2 row 15 tailnet "Partly" | Auto-join after 3 failures documented; unverified |
| 1.3 "Parked: drop-down control panel (045)" | A swipe-up control sheet is flashed |
| 1.3 "Dropped: own firmware and protocol" | Own repo `getmaipai/stackchan` exists locally (still patches) |
| 1.5 "Docs: ... no screenshots anywhere" | (A) is a 35-page draft with real `unit-` screenshots |
| 2.1 "Launcher carousel: Reject"; "Subtitles: song title bar only"; "On-robot settings: quick settings" | Apps wall, subtitles and tabbed settings are built |

Section 9a grades ("Ours today"):
| Row | (B) | Correction |
|---|---|---|
| Face motion | C+ "17 faces, cuts between them, basic mouth" | Eased eyes, fades, overlays, picture faces built; unverified, slow while speaking |
| On-robot screens | C "no settings beyond three controls" | Pages, sheet, apps, tabbed settings, lock |
| Setup | C- | Web flasher, code-based setup and pairing described; unverified |
| Features beyond chat | B- "no games or stories" | Seven games, alarms, word reactions, remote, find |
| Agent and tool control | D (planned) | Still Home-only in (A); unchanged unless built there |
| Works alone, no hub | D "cannot do anything else" | Own-LLM mode is the default; pages, games, clock run with no host |
| Child safety | A- | Lower in own-LLM mode (no filter); unchanged with Home |
| Security | C+ "open hotspot, hash-only updates" | Setup code with lockout; signature check built (no key yet); link still plain |
| README and docs | D+ | Full draft exists, unpublished |
| Stock row "remote, video call" as stock-only extras | | (A) has remote controls and photo |
| "Where we stay behind: ... remote-control extras" | | Remote beep, say, head, dance, photo are flashed |

Section 12.1:
| (B) says | Correction |
|---|---|
| Technical adult today "D: no way in without Home" | The default mode needs no Home |
| Kid today "no games or stories" | Games flashed, stories built |
| Non-technical adult "Must never need a terminal" assumed solvable by K1 to K4 | (A)'s install and pairing are terminal steps (`pipx`, `stackchan pair`, `robot.toml`) |
| "Modes without age gates say so at setup and cannot be given child or teen controls" | (A) has no such label |
| "The Bot service is the technical adult's front door: one command to install" as future work | `pipx install` of the `stackchan` host is documented |
| Kid plan items "S7 child lock" as wholly new | A passcode lock exists to build on |

Section 19:
| (B) says | Correction |
|---|---|
| 19.1 "Illustrated faces: B14b, deferred" / 19.3 build the patch-over-still method in wave 3 | Picture faces with drawn eyes and mouth and frame loops are flashed; missing: our art, flash storage, validator |
| 19.2 "Today: 17 faces, 7 palettes and a night face, two decorators" | Five styles, seven extras, 26 overlays |
| 19.2 real faces for "dizzy and silly (today they fall back)" | Dizzy is an extra and a shake face; silly is a dance mood face |
| 19.1 "Several users ... missing: per-person preferences" | Up to 12 people with name, color, caption size on the host page |
| 19.4 "the unit never receives a name" as current fact | Unknown for (A)'s "Use on this unit" |
| 19.5 personalities exist only as Home companions | (A) adds a `persona` text key with no Home |
| 19.1 Face Design Board "not read; lane B starts from it" | (A) shows the outcome: the cut to five styles |

Section 20:
| (B) says | Correction |
|---|---|
| 20.1 "Voice barge-in: Off" | (A) documents it as working; needs a measurement |
| 20.1 "Launcher carousel of apps: Rejected" | Apps and Games walls are built |
| 20.1 "Standalone AI brain (M4): Wave 4" | Built, default |
| 20.1 "Bluetooth: Not built. Memory..." | Off; "saved almost no memory"; under review |
| 20.1 "Phone app ... remote control: Not scheduled" | Remote control from a phone browser is flashed |
| 20.1 "Music visualizer: Later" | Disco ball, confetti, notes, side lights built with dance to music |
| 20.1 "Hub pictures on the screen: Conditional" | Pictures and tiles already reach the screen |
| 20.2 "Swipe left / right: Volume down / up by 10" | Moves between pages; volume is a side-edge swipe |
| 20.2 "Swipe up: Quick settings: volume, brightness, saved Wi-Fi, Done" | Control sheet with sliders, status line and six buttons |
| 20.2 "Swipe down: Stop talking" only | Also ends a game and closes a page or the sheet |
| 20.2 "Tap the face: start listening; tap again to stop" | (A) does not document tap-to-talk at all (only "a tap opened your turn" in the tones table); confirm it still exists |
| 20.2 "no clock is in the repository"; 045 panel "never flashed" | Clock face and Clock page exist; a control sheet is flashed |
| 20.2 "the three privacy taps are not documented" | Documented on three pages of (A) |
| 20.3 problem 2 (sideways swipes blocked by volume) and 3 (swipe down has one meaning only while talking) | Both already changed |
| 20.3 problem 5 "Nothing is locked" | Passcode lock exists; not band-aware |
| 20.3 problem 1 (privacy on single taps) and 4 (no hints or tour) | Still true in (A) |
| 20.4 as a proposal to build | Mostly built; reduce to the open differences in 4.1 |
| 21 correction "the clock view is in the code" | Confirmed by (A) |
