# Home's token for the Stack (ISOLATION-04)

The Stack listens on loopback only, and since ISOLATION-04 it also refuses what a web page could send: a `Host` that is not
`127.0.0.1`, `localhost` or `[::1]` (421), an `Origin` other than its own (403), a write with a `text/plain` or form body (415), and
any `POST`, `PUT`, `PATCH` or `DELETE` without Home's token (401 `home_token_required`, or `home_token_refused` for a wrong one). Reads
(`GET`, health) stay open on loopback. The full text is in the Stack's `docs/integrations.md`, "Authentication".

## One token, one place

The token is the key the adult full view already used: `x-maipai-home-token`, the file `keys/home-view-token` in the Stack's data
folder (made when the Stack starts, mode 600, so an install from before this change gets one on its first start with no data touched),
or `STACK_HOME_VIEW_TOKEN`. [homeViewToken.ts](../../backend/src/lib/stack/homeViewToken.ts) finds it (own environment, then the copy an
admin stored for an engine computer, then the local file) and caches it. Nothing else reads it.

## Where Home adds it

`stackFetch` ([stackFetch.ts](../../backend/src/lib/stack/stackFetch.ts)) is the default fetch of both Stack callers: the spec client
(`createStackClient`, used through `getStackClient`) and `createStackHttp` (pictures, videos, music, engine components and recorded speech). It adds the header to every write and to nothing else. A new Stack caller uses one of those two and
inherits it; a raw `fetch` to the Stack's URL would not, so do not write one.

## When Home and the Stack disagree

A refused write was not run. Home forgets its cached key, reads it again and sends the write once more (not for a one-shot stream
body). If the Stack still refuses, the caller gets the Stack's own sentence (it says to restart Home) and Repairs shows one row,
"Home cannot start or change anything on the engine until their keys match", with the fix: restart the engine from Repairs, then Home.
For an engine computer the row says an admin stores the engine's key in Home with `PUT /api/engine-link/view-token` (the same stored key the adult view uses; there is no settings field for it yet). The row
closes by itself on the next accepted write. The key is never in a log, a row or an error.

## Model servers

The Stack starts each llama-server with a key of its own (`LLAMA_API_KEY`, per launch), so a page that finds one of those loopback ports
gets 401. Home does not talk to them. Splash, the worker engines and the search sidecar do not take a key yet (ISOLATION-04b).

## Upgrade order

Ship Home and the Stack together (the pin ties them). A new Home against an old Stack works (the old Stack ignores the header). An old
Home against a new Stack cannot start jobs until Home is updated, and Home's Repairs row says so.
