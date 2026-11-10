# P4 run recipe: the first real-person companion pack

Nothing here has been run. Every step is exact; stop at the first step that does not match what it says you will see.
The starting picture is `data-scratch/cast-previews/people-round2/P4.png` (approved by the owner). Use a worktree dev hub for a dry run, the live hub only when the owner says so.

## Prerequisites (check each, do not assume)
1. The Stack on the target hub includes MAKER-A to MAKER-H, MAKER-B2 and MAKER-F (the talk-frames route, `media.companion_track`, `_shapes`, `_emotion`, `_pack`). Check the Stack version on the target.
2. The Talking pictures engine is installed: Settings, AI & models. The pack job refuses with a plain line when it is missing.
3. The picture role and the video role are ready (Settings, Pictures and videos). The person running it may make pictures and videos.
4. `bash scripts/ship.sh status` says no release is deploying, if the target is the live hub.
5. Set the sign-in once in the shell, never on the command line: `MAIPAI_MAKER_SECRET` (and `MAIPAI_MAKER_PERSON`, default Sage), or `MAIPAI_MAKER_COOKIE`.

## Steps
1. Create the household companion for P4 with the name the owner chose (Companions, new, name only). Write down its id (`hc-<name>`).
2. Upload `P4.png` as the look (Companions, the companion, Look). Choose it as the rest picture and approve the character sheet (approval A). Write down the look version id.
3. Dry run the plan: `bun run scripts/pack/make_character.ts --companion <id> --still <version id> --shapes photo --dev-url <url>`. Exit 2 means it is waiting at B. Exit 1 prints the reason.
4. At B, open the printed clips address and play the idle loops, listen, think and speak clips. Reject (use `--restart`) on any of: a green edge, a wink or blink that jumps, a lighting step between loops, a changed face or clothes.
5. Approve B: `... --approve B`. The track, shapes, emotion, assemble and validate stages run. Exit 2 means it waits at C.
6. Validate by hand: `bun run scripts/pack/validate_pack.ts data/companions/<id>/pack-job/work/pack-out/pack` (path under the target's data dir). It must print no problems.
7. At C, open the pack address and the companion's talking pane. Check the rest frame matches the loops, the mouth shapes follow the sound, no green.
8. Approve C: `... --approve C`. This installs the pack to `companions/<id>/pack/`. Exit 0 means installed.
9. Open the companion in the player, then in WebKit (Safari) speak one test line and watch the mouth and the idle. Check phone width too.
10. Report what you saw: the stage lines, the Stack job ids, and a screenshot of the player.

## Stop, retry, rollback
- Stop: `... --cancel` (the clips and later steps are made again on the next start).
- Retry a failed step: run the step 3 command again; it continues at the step that failed. Start from scratch with `--restart`.
- Rollback after install: delete `companions/<id>/pack/` (the old pack, if any, is kept as `.pack-old` until the next install succeeds). The companion works without a pack.
