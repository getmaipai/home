# song_name bench, 2026-11-14

The chat tool `song_name` (Name that tune) is OFF (`offer.mode: "off"` in `backend/packages/song_name/manifest.json`) until its bench row `song-name` passes (RULES.md rule 1). This note records the measured runs.

Runner: `MAIPAI_BENCH_PASS=song-name MAIPAI_BENCH_OFFER=song_name MAIPAI_BENCH_REPEATS=3 MAIPAI_BENCH_UPSTREAM=stack bun run scripts/bench/tool-calling.ts` from `backend/`, against the Stack on 127.0.0.1:8770 (the chat role), data in a temp dir. Dataset: `backend/scripts/bench/datasets/song-name.json`. Bar (`songNameScore.ts`): song_name on at least 90 percent of song rows and on at most 2 percent of other runs.

| Round | Tool wording | Rows | Song rows | False calls on other runs |
|---|---|---|---|---|
| 1 | description and action arguments with no guidance | 18 | 19/27 (70%) | 5/27 (18.5%) |
| 2 | action meanings added | 18 | 27/27 | 7/27 |
| 3 | "only when asked what it is, never to play, add or change music" | 18 | 27/27 | 0/27 |
| 4 | round 3 wording, plus 8 unseen rows (heldout-) | 26 | 36/36 | 6/42 (14%) |
| 5 | question-focused wording, plus 8 more unseen rows (heldout2-) | 34 | 40/42 | 16/60 (27%) |
| 6 | playback action, required question, answer from Home state (Fable design 1); 25 pre-registered held-out rows (heldout3-) added, 59 rows in all | 59 | 69/72 all rows; held-out 27/30 (90%) | all rows 6/105 listen-type calls, 61 redirected to playback; held-out 6/45 (13%), 33 redirected |

Reading: the tool names songs well (it calls on a "what song is this" question every time, and chooses reject, suggest and confirm correctly with the prior assistant turn). It also fires on music commands the model reads as being about the playing song ("Make it louder", "Skip to the next track", "Pause the music", "Play that again", "Turn it down a little"). Round 3 looked clean only on the rows it was tuned on; the unseen rows show it does not generalise. Wording alone did not reach the 2 percent bar, so the tool stays off and the final manifest keeps the round 3 wording.

Follow-ups that could pass the bar (each needs its own architect pass). RULES.md rule 1 lets a manifest gate check state only (surface, connection, readiness); no regex, word list or classifier may read what the person typed to decide whether the tool is offered, so a gate on the wording of a question is not allowed. Routes that stay open: an explicit control (a Name this song button in Home or a robot command, which needs no tool call from chat), a change to the tool's wording or arguments that passes on held-out rows, a state-only gate, or a recorded owner exception to rule 1 as for the weather rescue. A larger repeat count with a held-out split is needed for any of them.

## Round 6 (2026-11-14): playback action, required question, answer from state

Change (no wording or word list reads what the person says, rule 1): `song_name` gets a `playback` action for pause, skip, repeat, volume, like and save (the tool answers "I can name the song, but I cannot control the player from here. Use the player on your screen." and never listens), `listen` must carry a `question` string (code checks only that it is present), and when Home is playing the song `listen` answers from state without the microphone and the context line says so. The 25 `heldout3-` rows were committed before the change and were never used to tune it. The pass decision cites only them: 3 repeats, the chat model on the Stack.

Held-out result: song rows 27/30 (90%, bar 90%), false calls (listen, suggest, reject or confirm on an other row) 6/45 (13.3%, bar 2%). 33 of the 45 other runs were redirected to `playback` (reported, not counted as false). The bar is not met, so `song_name` stays `offer.mode: "off"`.

What failed, by row (held-out):
- `heldout3-home-name-tune` (Home is playing, "Name that tune."): `listen` on 3 of 3 runs although the context line says not to. The code answers from state without listening, so these calls cost nothing, but the bench counts them.
- `heldout3-home-who-sings`: `listen` on 1 of 3. `heldout3-home-what-song`: `confirm` on 1 of 3 with no song to confirm.
- `heldout3-negative-playlist-maker` ("Who made this playlist?"): `listen` on 1 of 3.
- `heldout3-name-movie` ("This is from a movie, which one?"): no call on 0 of 3 runs, the one recall miss (3 runs).

What worked: every pause, skip, repeat, louder, quieter, like, shuffle and dev-split command now lands on `playback` (61 of 105 other runs on all rows). On the 60 other runs that earlier rounds used (dev, heldout and heldout2), false calls fell from 16 of 60 to 0 of 60, though those rows were seen while tuning earlier wording and do not count toward the pass. All 6 remaining false calls are on the four held-out rows above.

Not claimed: this is one round on a 45-run negative set. At 3 repeats a 2 percent bar allows no false call at all, so a single stray call fails the round; a larger held-out set and more repeats would measure the real rate better, and that choice must be made before the next run, not after seeing it.

Candidate next steps (each rule 1 compliant, each needing its own architect pass): (a) pre-register that a `listen` while Home's own now-playing state names the song is answered from state and is reported separately (it costs nothing), then re-run; (b) add `who_made_this` style non-song questions about playlists and albums as negatives with a fitting target; (c) widen the held-out set and repeats. Nothing here reads the person's wording.
