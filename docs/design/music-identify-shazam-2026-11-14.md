# Music identification adds Shazam (2026-11-14)

Status: owner decision; implementation in progress in MUSIC-ID-05.

## Supersedes

This note supersedes the “no Shazam or other closed service” clause in [music-identify-2026-11-13.md](music-identify-2026-11-13.md),
by Jesse's decision of 2026-11-14 in the question box.

## Owner decisions

- Shazam is added as a snippet service because it can identify a few seconds from the middle of a song.
- Shazam and AcoustID run in parallel after the local library check. The first match is returned promptly and every answer is retained
  as a candidate for discussion.
- `music.identify.shazam` independently switches Shazam on or off. Its user-facing setting awaits a shared spec pin because settings
  keys are spec-owned. With it off, the library and AcoustID remain available according to
  `music.identify.online`; if the online setting itself is off, only the library is used.
- Song naming is a discussion, not a verdict. A person may reject, suggest or confirm a title through `song_name`.

## Privacy

The clip is decoded in Home memory and dropped. Shazam receives a locally generated spectral peak signature and clip length, never audio.
AcoustID receives a Chromaprint fingerprint and clip length, never audio. Neither provider receives the household, person or device
identity. The privacy manifest lists each destination only when its setting allows requests. Recent guesses and candidate details live
per robot in memory for 15 minutes; no audio, signature or fingerprint is kept there.

## Built parts

- `shazamSignature.ts` builds the signature. Its layout follows SongRec (GPL-3.0, AGPL compatible); the TypeScript is independently
  implemented.
- `shazamLookup.ts` sends the signature to `amp.shazam.com`, parses the title, artist, album and year, and quiets requests after a 429.
- `identify.ts` races enabled providers, returns the first match, and delivers later answers to the candidate callback.
- `heardSong.ts`, `songNameTool.ts` and the robot's `song_title` command support rejection, alternative suggestions and confirmation.
- Privacy rows and user/developer documentation name both services and their payloads.

## Risks and fallback

Shazam's discovery endpoint is unofficial and can change without notice. A failed or unavailable Shazam request does not fail an answer;
the parallel AcoustID provider can still match when configured. With no AcoustID key or with Shazam disabled, Home falls back to the
household library. With online naming Off, the library is the only source.
