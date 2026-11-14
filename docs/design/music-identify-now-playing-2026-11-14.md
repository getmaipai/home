# Now playing reaches the robot and chat (MUSIC-ID-06, 2026-11-14)

Status: built; privacy rework landed 2026-11-14 after the architect's REJECTED verdict on the first version.

## Supersedes

This note supersedes one line of [music-identify-2026-11-13.md](music-identify-2026-11-13.md): "No 'Now playing' chip: the hub knows what it plays itself." It supersedes it only for two things: the title text on a paired robot's bottom row and the bounded heard-song context in that robot's chat. Home's own screens still show no new chip.

## What it does

The Home Music player tells the hub when a song starts, changes, pauses or ends (`POST /api/music/now-playing`, a small authenticated report from the player store, with a heartbeat while playing). The hub then:

1. looks the song up **on the server** from the signed-in person's own song record by `song_id`; a title, artist or album sent by the browser is never shown, and an unknown id shows nothing (fail closed);
2. applies the adult lock to the song and checks face text and context per robot against the stricter of the player's band and the band that robot gives an unknown speaker (its controls level when a companion is assigned, else child); an adult-only song never reaches any robot face or heard-song context, even when its lock is off;
3. sends the text (`Title` or `Title - Artist`, 60 characters) with the `song_title` device command **only to robots paired to the person who is playing**, never to the household's other robots;
4. keeps the same fact in that robot's heard-song chat context for 15 minutes, cleared on pause or end and expiring if the tab just closes.

## Rules checked

- The org privacy rule, "a person's activity stays theirs": no fallback to other robots. A person with no paired robot reaches no robot.
- RULES.md rule 0, robot paragraph: a child or teen robot never shows or says text the floor refuses; the floor is the stricter of the player's band and the band that robot gives an unknown speaker (a robot with no companion gives child).
- Adult-only songs never reach a robot face or heard-song context, regardless of lock state.
- Rule 6a: no status or admin page carries a title; the context lives per robot in memory only.
- Nothing is stored in the database; the context holds title, artist, album and year for up to 15 minutes.

## Not in scope

Library songs and sounds that carry no `song_id` do not push a title (the hub cannot verify a client-supplied title). Songs a robot hears by listening are named by MUSIC-ID-05.

## Reuse check

Searched `nowPlaying`, the web player store (frontend player state), radioApp now playing (`backend/src/routes/radioApp.ts`, `lib/media/radio.ts`, `radioStream.ts`), device commands (`issueDeviceCommand`, `sendSongTitle`), the `song_title` tool in the body, and heardSong context. Reused `sendSongTitle` and the `song_title` device command, the `heardSong` context block, `getMusicJobFor` and `musicJobLockItem`, `evaluateSafety` and `forOutput`, and `listRobotsPairedUnderPerson`. Radio now-playing state was not reused because it is a different surface: stations have no `song_id` owned by a person.
