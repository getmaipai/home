# Music identification (MUSIC-ID-01 and MUSIC-ID-05)

Design: [the 2026-11-14 Shazam decision](../design/music-identify-shazam-2026-11-14.md). The service is `identifySong` in
`backend/src/lib/music/identify.ts`; the pure AcoustID parts are in `identifyCore.ts`.

## Providers and flow

Home decodes clips to 16 kHz mono PCM through ffmpeg pipes. It first compares Chromaprint fingerprints against the household library.
When `music.identify.online` is On, or Ask each time was confirmed, a local miss starts the enabled online providers together:

- Shazam receives a small peak signature made locally from the middle of the clip, plus its length. It does not receive audio.
- AcoustID receives a Chromaprint fingerprint and length and names whole recordings from their start. It needs the optional household key.

The first real match returns immediately. Other providers keep running through the shared deadline and every answer is kept as a
candidate. A candidate agreeing on normalized title and artist is marked as agreeing; a different answer remains available for the
person to discuss. A failed provider does not block another provider. With the online setting Off, only a local library match runs.
Shazam has its own `music.identify.shazam` switch (shared spec 0.1.397, on by default), shown on the Name songs online card.

Home runs the downloaded MIT-licensed `shazamio-core` helper (installed by the Stack as the "Song signature tool", see
`backend/src/lib/music/shazamHelper.ts`) as a separate process; Home contains no SongRec code.

## Measurement

On a synthetic 10 second 8 kHz mu-law clip, decoded to 16 kHz and given added noise, the local fingerprint matched all 6 of 6 source
songs. The matching local score ranged from 0.88 to 1.00; unrelated songs scored about 0.58. This is simulated degradation, not a real
room measurement, and should not be read as a real-world recognition rate.

## Robot discussion

`heardSong.ts` keeps one current guess and provider candidates per robot in memory for 15 minutes. `song_name` supports `listen` (the
default), `reject`, `suggest` with a title, and `confirm` with an optional title. Reject promotes the best remaining candidate;
confirm settles the selected guess. A title update is sent through the `song_title` device command. The log line records provider names,
outcomes and candidate counts, never titles, artists, signatures, fingerprints or keys.

## Now playing

The signed-in Home player reports track changes, pause and stop to `POST /api/music/now-playing`; while playing it refreshes every
minute. Home resolves a supplied song id against that person's song job, and rejects locked songs. Other track titles are cleaned on
the hub. No audio is involved and the state exists only in memory. An entry expires 150 seconds after its last refresh, so closing a
tab without a stop eventually clears the robot title.

Home sends `song_title` only when the displayed text changes. It targets only the person's connected, reachable, unmuted paired robots.
Each robot uses the stricter of the player's band and its own controls band for the output floor; an adult-only song never reaches a
robot face or heard-song context, including when its lock is off. The player's title is also a `home` heard-song entry for 15 minutes
only on robots allowed to show it; it outranks listening guesses and becomes “was playing” when playback stops.

## Reading logs

`[music-identify]` is the route outcome: status, reason code, clip duration, elapsed time and (for a match) provider source. `[music]`
identify lines show only status/source or provider outcome counts and timings. Provider labels are `library`, `shazam`, `acoustid`, or
`cache`. No song text or identifying payload belongs in these lines.

## Tests

Signature and lookup tests use fixed local samples and fake fetch. `backend/tests/identifyProviders.test.ts` injects every provider;
`identifyFingerprints.test.ts` exercises the library pass and progress. The request tests are offline.
