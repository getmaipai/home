# Music identification (MUSIC-ID-01)

Design: [docs/design/music-identify-2026-11-13.md](../design/music-identify-2026-11-13.md). One service, `identifySong` in
`backend/src/lib/music/identify.ts`, used by every surface; the pure parts are in `identifyCore.ts`.

## Flow

1. `POST /api/music/identify` takes the clip bytes (`?kind=pcm16&rate=16000` for raw 16-bit mono PCM, otherwise any container ffmpeg
   reads; `?confirmed=1` after an `ask` confirm). More than 2 MB or 20 s is refused with a plain 413. A device that sent a clip in the
   last 60 s gets a typed `rate_limited` result (200, not an error).
2. `identifyAudio.ts` decodes to 11025 Hz mono PCM through ffmpeg pipes (nothing written to disk) and fingerprints with Chromaprint
   `fpcalc` on stdin. `fpcalc` is a download listed in the installer, never vendored.
3. Local first: the clip's raw fingerprint is compared with the library's (`music_fingerprints`, filled by `fingerprintStore.ts` after a
   library scan, one file at a time, skipped without `fpcalc`). A clear match returns `source: "library"`.
4. Otherwise, with `music.identify.online` = `on` (or `ask` and `confirmed`), one AcoustID request (fingerprint and length only,
   3 per second, one in flight, 5 s timeout, one retry). `ask` returns `needs_confirm` and makes no request; `off` is local only.

Results are typed: `matched`, `no_match`, `needs_confirm`, `not_ready` (with `reason`), `failed` (with `reason`), `rate_limited`.
Nothing throws. Logs carry counts and timings only (rule 6a); the cache (200 entries, memory, keyed by a hash of the fingerprint) never
holds a person or a device.

## Key and readiness

The AcoustID key is the household secret `acoustid.client` (write-only, encrypted by the settings layer, like `search.brave_api_key`).
`identifyReadiness()` reads the key, `fpcalc`, the library fingerprint count and the setting; `healthSnapshot.ts` serves it as
`engines.identify` in `/api/health`. No client recomputes it.

## Robot chat tool (MUSIC-ID-02)

On a connected, unmuted robot turn the model may call `song_name` when it needs to identify music playing now. The tool is offered
under the same age and surface policy as the scene tool, but only on that robot. The model chooses when to call it. Home issues a
`listen_song` device command with a random request id and a short expiry. The robot records a short clip and posts it to
`POST /api/music/identify?request=<id>`; the route resolves only a waiter belonging to that robot. The tool waits up to 22 seconds,
then returns a plain result to the model. Failures stay tool results so the model can answer from what it knows.

On a successful match from a robot, Home keeps only title, artist, album, source and match time in process memory, one recent song
per robot for at most 15 minutes. Robot turns receive a short labelled context line during that window, so follow-up questions can
refer to the song without another recording. Home keeps no clip or fingerprint for this context. The robot can decline a listen when
muted, at night or already capturing; in that case the tool reports its ordinary failure result. The waiting request is memory only
and times out if the robot does not post its response.

## Tests

`backend/tests/identifyCore.test.ts` (pure), `identifyService.test.ts` (fake `fpcalc`, injected decoder, fake AcoustID server),
`identifyRoute.test.ts` and `identifyFingerprints.test.ts`. All offline.
