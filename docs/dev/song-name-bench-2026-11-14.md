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

Reading: the tool names songs well (it calls on a "what song is this" question every time, and chooses reject, suggest and confirm correctly with the prior assistant turn). It also fires on music commands the model reads as being about the playing song ("Make it louder", "Skip to the next track", "Pause the music", "Play that again", "Turn it down a little"). Round 3 looked clean only on the rows it was tuned on; the unseen rows show it does not generalise. Wording alone did not reach the 2 percent bar, so the tool stays off and the final manifest keeps the round 3 wording.

Follow-ups that could pass the bar (each needs its own architect pass): a deterministic offer gate that offers `song_name` only on turns whose text asks a question about what or who is playing (RULES.md rule 1 allows a manifest gate), or a larger repeat count with a held-out split once such a gate exists. Flipping the offer back to `conditional` with gate `songNameAllowed` and `bench_row: "song-name"` needs a passed run recorded here.
