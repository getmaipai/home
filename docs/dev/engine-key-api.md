# Chat engine key (SPLASH-KEY-01)

An assistant session can switch the chat engine between llama-server and Splash without a person at the Settings page. It holds an
`engine` API key. The key can do that one thing and nothing else. Credentials rules: [CREDENTIALS.md](../CREDENTIALS.md) in the org docs.

## What the key can do

| Call | Effect |
|---|---|
| `GET /api/operator/engine` | The engine in effect, any pending value, the allowed choices and how many changes are left today |
| `PUT /api/operator/engine` with `{"engine": "auto" \| "llama-server" \| "splash"}` | Sets `stack.engines.chat.engine` and applies it (the chat engine restarts) |

Send the key as `Authorization: Bearer <key>`. A cookie session never works on these routes.

## Limits

- Only an owner or admin can make one (the same holders as a settings key). It stands alone: never combined with another scope.
- It lasts at most 30 days (7 or 30).
- It cannot read or write any other setting, read diagnostics, ship, install, update or reach any other API. Each other operator
  door admits only its own scope, and a test proves an engine key gets 401 on them.
- 20 calls a minute per key (every operator key), and at most 6 engine changes a day per key.
- A change waits (409) while a chat turn is running, because applying restarts the chat engine.
- Only the three values above are accepted; anything else is 400 and nothing reaches the Stack.
- Setting the engine already in effect is a no-op: nothing is sent and no change is counted.

## Audit

Every change writes a log line with the key id, the setting, the old and the new value (never the key), and raises the
`engines.chat_engine_changed` notification to admins in the in-app center. Revoking the key in Settings stops it at once.

## Why this is safe

The setting is already opt-in and falls back by itself: `splash` is refused on hardware it cannot run on, and after two failed
starts the Stack returns to llama-server and raises `chat.engine-fallback`. A leaked key can therefore do no more harm than flip
between two working engines, six times a day, with every flip visible to the admins. It cannot ship a build.

## Supersedes

Nothing. It adds a scope next to `settings` and `diagnose` ([OPS-KEY-01], [diagnose-api.md](diagnose-api.md)) and reuses their
door, limiter and key store. The spec enum `api-key.scopes` gains `engine` in `@maipai/spec` 0.1.268.

## Reuse

| Need | Reused |
|---|---|
| Key storage, hashing, expiry, revoke, list | `lib/apiKeys.ts` (scopes column is JSON, no migration) |
| Door and one refusal text for every bad key | `middleware/auth.ts` `requireApiKey` |
| Per-key rate limit | `routes/operator.ts` `slow`, `lib/rateLimiter.ts` |
| Apply path | `getStackClient().applySettings`, the same call Settings uses |
| Audit | `lib/notifications.ts` `trigger`, type declared in `lib/notificationTypes.ts` |
