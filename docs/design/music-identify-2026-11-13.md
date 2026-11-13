# Music identification: one Home service, used everywhere (design draft 2, 2026-11-13)

Status (2026-11-13): proposed; revised after the architect's first ruling (REJECTED for fixable note gaps). Items: MUSIC-ID-01 (service,
route, spec), MUSIC-ID-02 (assistant tool, Home app button and result card), MUSIC-ID-03 (robot capture and face title), MUSIC-ID-04
(genre for costumes, later, own note).
Owner request (Jesse, 2026-11-13): when the StackChan robot hears music it should identify the song and show the name at the bottom
center of its face; "the music identification service must be a feature of Home that can be used throughout the home app, not something
hard coded to bots". Owner decision (Jesse, 2026-11-13, question box, held by the Phosphene session): "always online with settings to
change": the hub listens to a few seconds, matches the household's own music first offline, and with no local match looks up online
automatically, sending ONLY the audio fingerprint (never the recording) to the open AcoustID/MusicBrainz service (no Shazam or other closed
service); a household setting (on by default; owner or admin can turn it off or set "ask each time") controls the online lookup and lists
exactly what leaves the home. Later: faces or costumes by genre.

## Supersedes

Nothing. It is the "separate item" that `music-like-this-2026-11-01.md` (line 54) leaves open: "AcoustID fingerprinting is allowed by the
2026-10-06 decision but is a separate item". It does not replace MUSIC-MB-01 (matching library files by their tags).

## The rule

One definition, one place (platform principles 1 and 4): Home owns `identifySong`. A caller gives it a short clip of audio; it returns the
song. Every surface calls the same thing: a robot body, the Home app on a phone or the web, Go, and the assistant ("what song is this?").
A robot only captures the clip and shows the answer; nothing about fingerprinting or AcoustID lives in the bot repo.

## Privacy (hard rules)

- The clip goes only to Home (the household's own hub on the home network). Home never stores it: decoded in memory, fingerprinted, dropped.
- Local first (org PRIVACY.md local-alternative rule, 2026-11-01): the household's own library is fingerprinted with Chromaprint
  (`fpcalc`) once per file in the existing library scan, the fingerprints are kept next to the library records, and the clip is matched
  against them with no network at all. Only with no local match, and only if the setting allows, does Home send the clip's fingerprint and
  its length (never audio) to AcoustID, and the MusicBrainz ids that come back in AcoustID's own answer are kept as they are: there is no second request to MusicBrainz.
  The off switch therefore falls back to the local source, never to a broken feature.
- Setting `music.identify.online` (household scope, `on` default, `ask`, `off`; defined in spec `settings/keys.json` and mirrored in
  `backend/src/settings/musicKeys.ts`): `ask` shows one confirm on the surface that asked (on a robot the confirm is a spoken question
  to the person who is there; the clip is held on the unit until that confirming turn ends, then sent only if the answer is an exact
  consent word matched by rule (rule 1), never by a model's reading); `off` makes it local only. The privacy manifest lists the data source `acoustid` ("what is sent: an audio fingerprint and the clip length,
  never audio") and Settings > Privacy shows it; `docs/user/what-home-looks-up.md` gets the row in the same commit.
- Robots: the clip is a passive copy of the microphone audio the music detector already reads, so it never delays wake-word listening; a
  wake word or a turn cancels the capture in progress (a clip already waiting on a spoken confirm survives that confirming turn); nothing is uploaded during a turn. A robot sends at most one clip per music session (per stretch of
  music, not per song) unless the owner asks again, which keeps AcoustID traffic tiny.
- Logs carry counts and timings only, never a title, an artist or a fingerprint (rule 6a). The in-process fingerprint cache has a size
  limit, lives only in memory, and is never keyed to a person or device, so it cannot become a record of what the household listened to.
- No age gate: the feature makes no content; it names a song (owner rule, 2026-11-01). Child and teen rulings apply to the surfaces as
  they do today (a child's app shows what it shows).

## Reuse check (principle 6)

Prebuilt options, in order: Chromaprint's `fpcalc` for the fingerprint (a download, never vendored; listed in the install wizard and in AI
and models with size, licence LGPL-2.1+ and readiness); the existing library scan and `lib/media/songFacts.ts`, `lib/privacy.ts`
manifest, `lib/ffmpegPath.ts` (`findFfmpeg`), the credentials center (docs/CREDENTIALS.md); `backend/src/lib/media/musicbrainzMatch.ts`
(MUSIC-MB-01) is untouched and not called. The AcoustID client is one documented HTTPS request
(`/v2/lookup`: client key, duration, fingerprint, `meta=recordings+releasegroups`); no maintained library fits the Bun backend and the
request needs no dependency, so it is a thin function over the existing fetch layer with one rate limiter (THIRD-PARTY-SERVICES.md).
The result uses AcoustID's own title, artist and album from `meta=recordings+releasegroups`, with the MusicBrainz ids it returns; there is no
second MusicBrainz lookup (a new method on the shared client would also stretch `music.musicbrainz_match`, whose help text covers only the
background library match), so the MusicBrainz limiter is not involved and the key stays as it is.

## What is built where

1. Spec first (`commons/spec`): the settings key `music.identify.online` in `settings/keys.json`; the result shape reuses the existing
   media-item fields: `title`, `artist`, `album`, `musicbrainz_recording_id`, `musicbrainz_artist_id`,
   `musicbrainz_release_group_id`, plus `score` (0..1) and `source` (`library` or `acoustid`). One list, no `mbid`. Then Home, then robots.
2. `backend/src/lib/music/identify.ts`: input a clip (any container ffmpeg reads, or raw PCM with a rate); decode with `findFfmpeg`;
   fingerprint with `fpcalc`; local match first; AcoustID lookup second; return the record above or "no match". Failure behaviour
   (rule 6, a failed tool never fails the answer): no key, `fpcalc` missing, AcoustID down or no match each return a typed "did not
   happen" with the reason; the setting `off` is not a failure, it is local-only matching (the button stays enabled whenever library
   fingerprints exist); the assistant says plainly that the lookup did not happen, and a robot shows nothing, never
   error text. The AcoustID application key is a credential in the credentials center.
3. Route `POST /api/music/identify` (authenticated person or device; body: the clip; result: the record). One handler for every surface.
4. Assistant tool `identify_song`, offered conditionally (rule 1: `offer: {mode: "conditional"}`, only on a turn that carries a clip
   (on a robot: only when a clip or a recent result exists, because a robot uploads nothing during a turn; the robot's last result lives
   in memory only, per robot, for 90 seconds, never logged, following the pattern of robot rule R1, and is not the fingerprint cache), like `show_images` and `edit_album`; never in the base set; it gets its own CHAT-AB-01 bench
   row before it leaves `mode: off`). Its result card is a kit Element bound through `TOOL_BINDINGS`.
5. Home app (rules 9, 9b and 9c, no wrappers, no class overrides, a missing look is a kit variant first in `commons`): "What's this song?"
   is a kit `Button` (`@maipai/ui/src/ui/button`) in the player's `actionsSlot` (as MUSIC-LIKE-01 uses it) and on the song page. The
   clip is captured through Home's one shared microphone stream, `frontend/src/lib/media/micStream.ts`, with `micPermission.ts` and
   `micGate.tsx` for the permission and the gate, for up to 12 s, the way `frontend/src/lib/voice/mic-capture.ts` gets its stream
   through `acquireMicStream` and the way `frontend/src/shell/AmbientCompanionPane.tsx` and `ChatPage.tsx` use `useMicGate`;
   `VoiceEnrollmentBody.tsx` is NOT the pattern (it calls `getUserMedia` itself); the chat composer's
   `DictationControl` is not used (it only drives the thread's dictation adapter and is a chat Element). If the button needs a
   "listening" look, that is a kit variant added in `commons` first and tagged. The result card is the kit's `MusicTrack`, which today
   draws generation jobs (queued, generating, failed): it needs an identified-song layout (title, artist, album, cover, actions: play if
   in the Library, add to playlist, lyrics), added in `commons` first. No "Now playing" chip: the hub knows what it plays itself; the
   button appears for radio streams and outside sound only.
6. Readiness (rule S6, status in one place): one function, `identifyReadiness()` in `lib/music/identify.ts`, reports `ready`, `no_key`
   (and no local library fingerprints), `fpcalc_missing`, or `nothing_to_match` (the setting is `off` and the library has no
   fingerprints yet, so every lookup would return no match), each with the one line that tells the person where to act
   ("Add the AcoustID key in Credentials"). It is served through `healthSnapshot.ts` and `/api/health` the way `music/ready.ts` is, and
   every client reads that one result and never recomputes it: the Home app button (disabled with the line), the tool gate (the tool
   is not offered when it is not ready), and the robot, which asks before it captures a clip. A failure after a click shows in the kit
   Alert. No new status surface.
7. Robot (MUSIC-ID-03): the body asks the unit for a few seconds of compressed audio when a music session starts (command `music_clip`,
   over the unit's existing socket), forwards it to the Home route, and sets the face title (`self.face.song_title`, firmware patch 123)
   from the answer.
8. Later, MUSIC-ID-04: MusicBrainz genre tags drive faces and costumes (its own design note).

## Open (design-resolver, not the owner)

- Key per household or one key for MaiPai: AcoustID application keys name the app, not the user (Picard ships its own).
- AcoustID's non-commercial terms against `LICENSING.md`.
- `chromaprint` is not installed on the hub Mac; the installer lists it.
