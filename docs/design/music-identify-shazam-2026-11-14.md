# Music identification adds Shazam (2026-11-14)

Status: owner decision; implementation in progress in MUSIC-ID-05.

## Supersedes

This note supersedes the “no Shazam or other closed service” clause in [music-identify-2026-11-13.md](music-identify-2026-11-13.md),
by Jesse's decision of 2026-11-14 in the question box.

## Owner decisions

- Shazam is added as a snippet service because it can identify a few seconds from the middle of a song. Jesse chose "Add a snippet service (Recommended)" in the question box on 2026-11-14 after being told it is an unofficial service, a new outside connection that sends only a small audio signature, needs no key and may stop working one day; the `music.identify.shazam` default of On is his choice.
- Licensing, Jesse's decision of 2026-11-14: Home carries no code derived from SongRec (GPL-3.0). The signature is made by a separately downloaded MIT-licensed helper (`shazam-signature`, PyPI shazamio-core 2.0.0 in a Stack-managed uv environment, installed from the install wizard and Settings, AI and models like fpcalc). Home never vendors it.
- Shazam and AcoustID run in parallel after the local library check. The first match is returned promptly and every answer is retained
  as a candidate for discussion.
- `music.identify.shazam` independently switches Shazam on or off. The key is shared spec 0.1.397. With it off, the library and AcoustID remain available according to
  `music.identify.online`; if the online setting itself is off, only the library is used.
- Song naming is a discussion, not a verdict. A person may reject, suggest or confirm a title through `song_name`.

## Privacy

The clip is decoded in Home memory and dropped. Shazam receives a locally generated spectral peak signature and clip length, never audio.
AcoustID receives a Chromaprint fingerprint and clip length, never audio. Neither provider receives the household, person or device
identity. The privacy manifest lists each destination only when its setting allows requests. Recent guesses and candidate details live
per robot in memory for 15 minutes; no audio, signature or fingerprint is kept there.

## Built parts

- `shazamHelper.ts` runs the downloaded `shazam-signature` helper to make the signature (replaces the hand-written port of SongRec that was removed).
- `shazamLookup.ts` sends the signature to `amp.shazam.com`, parses the title, artist, album and year, and quiets requests after a 429.
- `identify.ts` races enabled providers, returns the first match, and delivers later answers to the candidate callback.
- `heardSong.ts`, `songNameTool.ts` and the robot's `song_title` command support rejection, alternative suggestions and confirmation.
- Privacy rows and user/developer documentation name both services and their payloads.

## Risks and fallback

Shazam's discovery endpoint is unofficial and can change without notice. A failed or unavailable Shazam request does not fail an answer;
the parallel AcoustID provider can still match when configured. With no AcoustID key or with Shazam disabled, Home falls back to the
household library. With online naming Off, the library is the only source.

## Reuse check (signature maker)

Searched: ShazamKit (Apple's official framework; needs an Apple developer account and signing entitlement tied to an app identity, Swift only, macOS only, so no Linux hub and it would put a developer account in the household's path), SongRec (GPL-3.0; only Windows installers and a Flatpak source tarball are published, no macOS or Linux CLI archives, so it cannot be a downloaded part on the platforms Home runs on), shazamio-core 2.0.0 (MIT, Rust with prebuilt wheels for macOS arm64 and x86_64 and Linux arm64 and x86_64, no Python dependencies, about 0.2 s per 10 s clip). Chosen: shazamio-core as a Stack-managed uv environment, listed in the wizard and AI and models, because it is the only candidate that is permissively licensed, available on every platform Home runs on, and installable without a developer account.
