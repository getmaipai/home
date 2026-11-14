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

## Tests

`backend/tests/identifyCore.test.ts` (pure), `identifyService.test.ts` (fake `fpcalc`, injected decoder, fake AcoustID server),
`identifyRoute.test.ts` and `identifyFingerprints.test.ts`. All offline.
