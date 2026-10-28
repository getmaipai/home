# Diagnose API (DIAG-KEY-01)

An owner or admin makes a **diagnostics key** in Settings, Home, Engines and AI, Assistant access (the same dialog that makes a
settings key; it asks which kind). An assistant session holding it can look at why chat is slow on this hub without anyone running
commands on the machine. It reads timings, counts and component state, and nothing else (design rule 6a: no message text, people,
ids or clock times next to activity).

## Reuse check

| Existing piece | Used? | Why |
|---|---|---|
| Stack `GET /stack/v1/roles`, `/engines`, `/health` | Yes | The engine route is these three typed reads cut to named fields. It sees an engine on a paired computer too, which a local `ps` never could. |
| llama-server `/slots` and `/metrics` | No | Behind the Stack; Home does not call them. `roles` already carries `slots` for the coding role. |
| ADMIN-PERF-01 (`lib/performance.ts`) | Yes | `median` and the new `recentTurnStats` (selects `id, createdAt, source, stats` only) feed `turns` and `summary`. |
| `lib/diagnostics.ts` structural redaction | No | It redacts a support bundle by structure; these routes never carry free text, so there is nothing to redact. |
| `lib/llm.ts` chat request builder | Yes | `probeChatEngine` sends the probe through `chatRequestBody` and `completeViaStackRequest`, so it exercises the real chat path (rule 2). |
| OPS-KEY-01 key plumbing | Yes | Same hashing, `requireApiKey`, per-key 20 a minute bucket and holder recheck. |

## Key rules

- Scope `diagnose` in `lib/apiKeys.ts` and in the `@maipai/spec` api-key schema (spec first). The only scope on its key.
- Made and used only by an owner or admin who is still enabled; checked again on every call.
- Lasts 7 or 30 days. Stored hashed, shown once, revocable, never logged.
- Bearer only. A cookie never opens these routes. A `settings` key cannot call them and a `diagnose` key cannot call the settings
  route. One refusal text for every bad key.
- 20 calls a minute per key.

## Routes (`/api/operator/diagnose/`)

| Route | What it returns |
|---|---|
| `GET turns?limit=N` | Newest first (default 10, at most 50): `time_to_first_token_ms`, `total_time_ms`, `tokens_per_second` and each generation (`reason`, `prompt_n`, `cache_n`, `prompt_ms`, `predicted_n`, `request_sent_ms`, `first_delta_ms`, and `prefix`: `request_chars`, `shared_chars` with the conversation's previous request, `first_diff` naming the part where they first differ such as "message 0 (system)", `had_previous`). A cache miss with `first_diff` set means that part changes between calls. No id, time or message. |
| `GET summary?turns=N` | Medians of first-token and total time, the share of turns whose first model call re-read a big prompt (`cache_n` 0, `prompt_n` over 2000), median prompt sizes and total milliseconds per pipeline node. |
| `GET engines` | Stack roles (state, residency, model id, measured context, identity check, coding slots), engines (installed, running, current and newest tag, restart needed) and health codes with severity. 503 with a next step when the Stack does not answer. |
| `POST cache-probe` | A fixed synthetic prompt (about 4.5k tokens, tools on), sent, repeated, then extended, with 8 answer tokens. Returns `prompt_n`, `cache_n`, `prompt_ms` per call. 409 while a turn runs, 429 after one run in the same minute for the whole hub. |

Every error says what went wrong and what to do. The log and process-list routes of the first design were dropped: free log text
cannot be proven free of people, and the Stack already reports engine state.

## Cache probe notes

The probe holds a turn lease, so background work waits and a second probe is refused. It evicts the engine's cached prompt once, so the
next real chat turn re-reads its prompt. That cost is bounded by the once-a-minute limit and the refusal during a turn, and it keeps rule 4 (the
cache prefix) intact because the probe never edits what a real turn sends. Follow-up: yield if a turn starts mid-probe.

## Use

```
curl https://hub.example.com/api/operator/diagnose/summary -H "Authorization: Bearer <key>"
```

## Supersedes

Nothing.
