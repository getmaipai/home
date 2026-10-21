# Voices made at home (2026-10-20)

Design note for the minimum of VOICES-02, VOICES-03 and VOICES-04. Owner ruling (Jesse, 2026-10-18): "Admin can create a voice
with whatever they want, no limitations." Rules in [RULES.md](RULES.md) govern; nothing here asks for a rule change (age and surface
gates outrank everything: a child or teen never lists, picks or hears a clip voice, and the text floors apply to everything any
voice says).

## What it is

An owner or admin makes a voice from one recording of 6 to 30 seconds, names it, optionally sets a sampling temperature
(0.1 to 2.0) and a pitch offset (-12 to 12 semitones, formants kept), and can hear it at once. Everyone can pick it for
themselves (Voices) and for a robot (Home settings, Devices, the robot, "This robot" card, `robot.voice.id`). The robot then speaks
in it. The engine is Chatterbox Turbo (`mlx-community/chatterbox-turbo-fp16` through mlx-audio 0.5.9); Pocket TTS cannot clone with
the installed model and ignores all of it.

## Decisions

1. **Home is the master of the voice; the Stack only renders.** The record is the `HouseholdVoice` spec record (commons
   `spec-v0.1.198`), kept in Home's existing `cloned_voices` table (two new nullable columns, `temperature` and
   `pitch_semitones`; old rows stay usable and read as engine default and no shift) with the clip file beside it. The Stack keeps
   no voice store: each speech request carries the clip's address on the household's own network, the temperature and the pitch.
   This deliberately replaces VOICES-02's `POST/DELETE /v1/voices` (a second copy of the record, which principle 1 forbids) and
   the "eleven starter voices" part of the row, which stays open.
2. **The voice id is a plain token** (`voice-<16 letters and digits>`), the same value `tts.voice_id` and `robot.voice.id` hold, so
   the existing select validation, the robot's voice list and the settings routes need no new shape. Home resolves the token to the
   clip address and the settings at the one speech seam (`lib/tts.ts`), before the engine-voice resolution.
3. **Making a voice proves it.** Right after the clip is stored Home renders the preview sentence once. The engine measures the
   clip and refuses one outside 6 to 30 seconds with a plain message; Home then removes the voice and shows that message. A Stack
   that is down does not undo the voice. The first render also fills the engine's per-clip conditioning cache.
4. **Pitch.** After generation, on the engine's output audio, by a formant-preserving shift written with numpy and scipy (both already
   in the engine's pinned environment, so no new dependency). A voice with no pitch (or 0) skips the step entirely. See
   "Pitch, same as the robot" below.
5. **The clip tokenizer** (S3TokenizerV2, 495 MB, `mlx-community/S3TokenizerV2` at one commit, sha256 pinned) is fetched on the first
   clip voice, not with the first-run plan, so a household that never makes a voice never pays the disk. The engine loads it
   lazily and says so in `/health` (`cloning`).
6. **Audit.** One line in the hub log per voice made or removed: who, their role, the settings; never the voice's name or the
   clip. The hub has no household audit event type yet (SETTINGS-AUDIT-01 is the open row that would add one).
7. **Role gate.** `POST /api/voice/cloned` answers 403 to anyone but an owner or admin. Selecting a voice (`/cloned/:id/select`),
   previewing one and the voice list are adult-only for clip voices.

## Pitch, same as the robot

The session building the robot's own TTS (STACKCHAN ENHANCEMENTS) has a numpy WSOLA shift in the bot repo (`maipai_body/speech/pitch.py`,
formants move with the pitch). The hub does not reuse it: the voice's pitch is applied once, in the Stack, on the PCM before it
leaves the engine, and the robot's replies already come through that same hub speech path, so the robot and Home sound the same
by construction. The bot's own pitch hook therefore stays at 0 for hub-rendered voices (a second shift would double the offset). The
hub's version keeps the formants (envelope correction), measured on the owner's 12 second clip: a request of -1 semitone moved the
median pitch by -0.92 and +2 by +1.98.

## Verified

A real render on the Studio's engine (`mlx-community/chatterbox-turbo-fp16`, mlx-audio 0.5.9, the pinned tokenizer): both owner clips
produced audio (1.3 to 3.9 s for a short sentence, the second request on a clip faster than the first), with temperature 1.05 and a pitch
of -1. That run found that the decoder needs a file extension and has no ffmpeg here, so a new voice must be WAV, MP3 or FLAC.

## The voice manager and Home's default voice (owner ruling, 2026-10-20)

Jesse: the screen for voices should list them with their source (for example Custom), gender and language, let an admin delete one and set
the default, and make "add voice" a modal; the first choice in a list must not read "Default voice" but the name of the voice, and a
default install should bring several voices to choose from.

- Home settings, Voices (owner and admin) is the manager: one row per voice (name, "Home's default" badge, who made it and with which
  liveliness and pitch, Source, Gender, Language), Test, Set as default, Delete (custom voices only, after a confirmation), and an Add voice
  dialog. The personal choosers (Account, Voice and the Voices page) stay as the one-dropdown choice for a person.
- Home's default voice is the household setting `tts.home_voice` (commons `spec-v0.1.200`, admin to write). A person or robot with no choice of
  their own speaks it; a child or teen never speaks a clip voice, so they get the engine's built-in voice when the default is one.
- The first choice of every personal list is that default voice shown by its own name with "(Home's default)". The engine's built-in voice has no
  name of its own yet and reads "Built-in voice"; naming it and installing the starter set stay open under VOICES-09 and VOICES-02.
