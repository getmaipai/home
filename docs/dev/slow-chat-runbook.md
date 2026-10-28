# Slow chat runbook

Use this when chat feels slow, shows "Chat is starting up" for no reason, or answers from the wrong model. Everything here is
read from the live hub with numbers only. The commands run on the MacBook (`hub-diag`) or on the Studio (the handoff scripts).

## Symptoms and what they usually mean

| What you see | Usual cause | Next step |
|---|---|---|
| Every first reply of a turn takes 5 to 8 s, later calls in the turn are fast | The first model call re-reads the whole prompt (no reuse between turns) | Read `cache_n` (below), then Splash chat |
| "Chat is starting up" for about 10 s mid-use | The chat engine was restarted | Look for `engine.retired` with reason `Restarted.` in the Stack log (see "Unprompted restarts") |
| "Chat is starting up" that never ends | The engine fails to start | `splash-chat-logs.sh` on the Studio, then revert |
| Chat answers like a small, bland model | The 1.7B starter model is serving, not the household chat model | `hub-diag engines`: the chat role must show the Huihui model id, not `qwen3-1.7b-q8-0` |
| Replies are slow to stream | Decode speed is low | `hub-diag turns`: `tokens_per_second`. Splash decodes at about 59 to 68 tok/s, llama-server at about 25 to 27 on the Studio |

## Read the numbers (`hub-diag`)

On the MacBook: `hub-diag summary`, `hub-diag turns`, `hub-diag engines`, `hub-diag cache-probe`. The key is in the Keychain (service
`maipai-hub-diag`); a 401 means it expired and Jesse runs `hub-diag set`. See [diagnose-api.md](diagnose-api.md) for every field.

- `summary` shows the share of turns whose first model call re-read a big prompt (`cache_n` 0 and `prompt_n` over 2000). A healthy
  hub is near 0 percent. On 2026-10-28 llama-server showed 18 of 20 turns, median `prompt_n` 4727, 7.1 s of prefill.
- `engines` shows the chat role's state, engine, model id and identity check. Splash chat appears as engine `splash`.
- `cache-probe` sends one fixed prompt, repeats it, then extends it. It evicts the engine's cached prompt once, so the next real
  turn is slow once. Do not run it during a conversation.

## How to read `cache_n`

Each model call reports `prompt_n` (tokens the engine had to read this call) and `cache_n` (tokens it reused from an earlier call).
The prompt size is roughly `prompt_n + cache_n`.

- `cache_n` near the prompt size and `prompt_n` small: reuse works. First token in well under a second.
- `cache_n` 0 and `prompt_n` in the thousands on the first call of a turn: the whole prompt was read again. About 1.5 s per 1000
  tokens on the Studio with the 27B chat model.
- Later calls in the same turn usually show a large `cache_n` even when the first call does not. Judge the first call only.
- A recurrent model (the Huihui Qwen3.8-27B chat model is one) can restart a prompt only from a saved snapshot, and llama-server
  keeps snapshots at the end of the prompt, not at the boundary where the next turn diverges. That is why reuse fails on real
  turns even though the same prompt sent twice is fast. Splash reuses a diverging prefix: measured 5248 of 5316 tokens reused in
  328 ms against 5124 ms for the first read.

## The non-append-only prompt cause

Home drops the previous turn's volatile block (the live context for that turn) from the next request, so the next request is not
the previous one plus new text: it shares only the system prompt and tools with it. An engine that reuses only an exact prefix of
the last prompt (llama-server on a recurrent model) re-reads everything after that shared part. Changing the prompt is not the fix
(the owner chose a better engine instead, SPLASH-CHAT-01). Do not "fix" slow chat by editing the prompt builder without the
prefix-cache rule in `docs/design/RULES.md`.

## The vocab-in-compiled-binary lesson (2026-10-28)

The Stack ships as a compiled binary (`bun build --compile`). A file read at import time from beside the source (the spec
interpreter read `vocab/setting-reasons.json`) works in tests and fails in the binary: the Stack died at startup and chat showed
"Chat is starting up" until it was reverted. The Stack's full gate now builds the binary and requires `/healthz` to answer, and a
test fails if a source file imports a spec interpreter. If chat is down right after a ship, check that the Stack process is
running and that `/healthz` answers before looking at engines.

## Splash chat: enable and revert

llama-server is the default and the fallback. Splash chat is opt-in through the Stack setting `stack.engines.chat.engine`
(`auto`, `llama-server`, `splash`). It runs the same Huihui model, so chat stays uncensored.

Run these on the Mac Studio. Each is one self-deleting script; copies are in the iCloud `maipai-handoff` folder.

| Goal | Script |
|---|---|
| Install Splash chat 1.4.1 and switch chat to it | `bash /tmp/maipai-handoff/splash-chat-enable.sh` |
| Switch back to llama-server | `bash /tmp/maipai-handoff/splash-chat-revert.sh` |
| Print the Stack log tail, engine exits and the Splash process | `bash /tmp/maipai-handoff/splash-chat-logs.sh` |

After enabling, send two chat messages, then run `hub-diag turns`: the second turn's first call should show a large `cache_n`.
After two failed starts the Stack falls back to llama-server by itself and raises the health item `chat.engine-fallback`.

## Unprompted restarts

An `engine.retired` event with reason `Restarted.` means something called a restart of the chat role. Deliberate causes: a settings
apply that changes the engine, "Restart engine" in Repairs, a projector install finishing. Automatic causes:

- The memory runaway watch: chat's process memory stayed above 1.3 times its post-load reading plus 0.5 GB for three polls.
  The Stack log has a `pressure` event with reason `process memory exceeded its measured peak` just before. Splash maps its model
  file, so its post-load reading is small and grows as it serves; the Stack no longer uses that reading as a baseline for Splash
  (fixed 2026-10-28).
- A video job waiting for memory: chat restarts once at a smaller window and again when the job ends.
- The memory watchdog under low-memory pressure, and a self-heal restart after a failed health canary.

## Related

[diagnose-api.md](diagnose-api.md), [../design/splash-chat-01-2026-10-28.md](../design/splash-chat-01-2026-10-28.md), [studio-runbook.md](studio-runbook.md).
