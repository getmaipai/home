# Round 4: the same checks on an iPhone (Safari), about 2 minutes

THE ROOM IS REAL here (a real phone speaker and microphone), which the scripted rigs cannot test. Run it only when no other GPU job is running and no scripted run is in progress. The lab must be restarted once first (so the page and the log route are the new code); do that only when `/api/live` is 0.

## Steps (the tester holds the phone; the log is read on the Mac)
1. On the iPhone, open the lab's https Tailscale link (`https://<studio>.<tailnet>.ts.net:9931`). Plain http will not allow the microphone.
2. Turn the ringer on (Silent switch off) and the volume up one third. Use the phone speaker, no Bluetooth, for the first run.
3. Type the secret. Tap **Run device check**. Say "hello, hello" while it says Checking. Read the line under the button.
   It must say **PASS**. If it says FIX, do that one thing and tap again; a FIX is a failed run.
4. Open Settings on the page and tick **Echo-reference mode** (round 1) and set **Browser echo cancelling** to true. Reload.
5. Tap **Start talking**. Ask: "Tell me a long story about a dragon who bakes bread." (15 seconds of listening, no talking.)
6. While she is talking say, in this order, one per 10 seconds: "mm-hm", "yeah", then "wait, stop".
7. Ask one more short question ("What is the capital of Australia?"). Lock the screen for 10 seconds, unlock, and ask "Are you still there?" (checks lock and reconnect).
8. Tap Stop. Done.

## What the log must show to pass (on the Mac: `grep device-report labs/voice-lab/../../data-scratch/lab-logs/lab.log`; turn numbers in `results/turns.jsonl`)
- `event:"start"` line: `ios:true`, `secure:true`, `worklet:true`, `ctxState:"running"`, `echoCancellation:true`, `noiseSuppression:true`, `autoGainControl:true`. `ctxRate` and `micRate` are noted (44100, 48000 or 24000 are all fine; the page converts).
- `event:"device_check"` line: `pass:true`, `micLevelPeak` above 0.01, `toneHeard:true`, `roundTripMs` below 450.
- Step 5: no stop, no pause, and no `event:"visible"` or `route` heal lines (nothing should have disturbed her). She finishes or is still talking at step 6.
- Step 6: "mm-hm" and "yeah": she keeps talking (no stop in the turn record). "wait, stop": she stops within 700 ms of the first word (finish-the-word limit; measured from the person's first word, read from `t_local_stop` / `cutins.jsonl` `duration_ms`).
- Step 7: after the lock, a `event:"visible"` line with `did` containing `reconnecting` (and `audio resumed` if the context was interrupted), and the next answer arrives. First sound of every turn at or below the scripted baseline (median 1.35 s limit, worst 3.5 s) plus the phone's output latency.
- No `ctxState` other than `running` at any `start` or `visible` line after healing.

## If it fails
Copy the log lines above into the status report with the step number. The device check already names the one thing to fix; a fix that needs a code change goes into `public/device.js` with a test in `tests/device.test.ts` first.
