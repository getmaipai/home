# THIN-GROUND-01 part 2: measurement protocol (for a local session with a live engine)

Cloud lane G2 could not run a live engine. Run this on the owner's laptop (Qwen3-8B Q4_K_M, context 4096, thinking off) with the household SearXNG, one request at a time, no gate or bench running beside it.

1. Fresh Home process each run (`bun restart`, so the engine health scores and benches start empty). Scratch Home, same as THIN-GROUND-01's method; put the logging forwarder between Home and the Stack and one in front of SearXNG.
2. `bun run smoke:chat`, turns 1 and 2 only: turn 1 "when is the new avengers movie coming out", turn 2 "and is robert downey in it". 5 runs.
3. Read per run: the `[search] engines asked=... answered=... unresponsive=...` debug line, the number of `/search` requests the forwarder saw for the turn (expect 1, or 2 only when the first came back with fewer than 3 rows or every asked engine was unresponsive), the saved chat request's tool message.
4. Score: turn 1 correct = names Avengers: Doomsday and December 18, 2026. Turn 2 correct = Robert Downey Jr. as Doctor Doom in Doomsday, and it searched.
5. Pass: turn 1 correct at least 4 of 5; no turn showing "Something went wrong"; `asked` always lists three engines (plus wikipedia when configured) and google cse appears in `answered` on the runs that were correct.
6. Context check: force `chat.context_size_override` to 2048 for 3 runs. A search turn that overflows must log `retrying once with the evidence cut to half` and answer, or show the "too much text for me to read in one go" line, never the generic line.
7. Record the table in docs/dev.md under THIN-GROUND-01 in the same shape as the existing arms table.
