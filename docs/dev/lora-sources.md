# LoRA sources and install (backend)

Built 2026-11-03 for VIDEO-LORA-07. Design: [video-loras-2026-11-02.md](../design/video-loras-2026-11-02.md) sections 5 and 15. No screen uses these routes yet
(VIDEO-LORA-08). Records and access are in [loras.md](loras.md); the lock is in [adult-lock.md](adult-lock.md).

## Pieces

| Piece | File | What it does |
|---|---|---|
| Adult check | `backend/src/lib/loras/adultCheck.ts` | `classifyCivitai` and `classifyHuggingFace` return the spec's `adult_check` (`normal`, `unknown`, `adult`) from the source's own fields only. No word list. `cleanTriggerWords` strips `<lora:...>` syntax, splits comma dumps, dedupes. |
| Sources | `backend/src/lib/loras/source.ts` | All outbound traffic of the browser: one request per 2 s per host (queued), 60 browse requests an hour, a 5 minute cache, a 1 to 30 minute exponential stop after a 429 or 5xx, honest user agent, a token only in the header to its own host. Hugging Face Hub API and, when on, the documented Civitai REST API. Dedupe and the installed match. |
| Install | `backend/src/lib/loras/install.ts` | Re-fetches the hit itself (never trusts a client's file address), checks the licence step, duplicates, base, size, audience, then starts the Stack `video.lora.install` job. `reconcileLoraInstalls` mirrors it into the job list and writes the record. |
| Routes | `backend/src/routes/lorasSources.ts` | `/api/loras/browse`, `/browse/{source}/{id}`, `/browse/{source}/{id}/preview`, `/install`, `/sources` (status, switch, the two credentials). |
| Stack client | `backend/src/lib/videos/stack.ts` | `installVideoLora`, `getStackInstallJob`. |

## Who and what

Every route is owner or admin only (a minor, a guest or another adult gets 403). Install also needs the person's own screen (a browser session).
Civitai is off by default (`generation.styles.civitai`); with it off, browse and install of a Civitai style answer 403 and nothing goes out, and `source: "both"` quietly searches only Hugging Face and says so.

## The adult check (design 15.1)

| State | Civitai | Hugging Face |
|---|---|---|
| `adult` | model `nsfw` true, or model `nsfwLevel` 4 or more (a bit mask), or any preview of the chosen version at level 4 or more | repo tag `not-for-all-audiences` |
| `normal` | flag false, at least one preview, every preview level 1, model level absent or 1 | never |
| `unknown` | everything else | everything else |

Browse hides `adult` and `unknown` hits unless the caller has a live unlock proof AND sends `adult: true`; only then is `nsfw=true` sent upstream. Hidden hits are one
`locked: true` flag: no title, picture, id, hash or count. The cache holds full hits in memory; the redaction is applied when each response is built. Detail and preview of a hidden hit
answer 404 with the body of a missing one. The `installed` filter runs before the redaction and only decides whether the flag shows.

## Install

`POST /api/loras/install { source, remote_id | url, version_id?, audience, licence_confirmed, name?, kind?, base_model?, confirm_ticket?, as_separate? }`.

- The licence step must be `licence_confirmed: true` (422 otherwise).
- Duplicates: a live record with the same source version id, or the same sha256, answers 409 `duplicate` ("You already have this as <name>.", or "You already have this style." when that record is locked, with no id). The same version with a different hash is 409 `changed_file` until `as_separate: true`.
- Only LTX 2.3 and 2.5 styles install. A Hugging Face repo whose base cannot be read needs `base_model` in the body.
- `audience` is the admin's click. All ages from `unknown` needs a live unlock proof; from `adult` it needs a single-use ticket from `/api/adult-lock/confirm` whose `item` is the hit's `confirm_item`. Adult-only is always allowed. The Stack's own class can only raise it.
- The Home job row is named "Downloading a style" and has no file name. What finishing needs is encrypted in its provenance. A failure raises one Repairs item "A style did not download" (plain cause) with Try again.
- On completion the record is written: admin-only availability, `adult_check`, trigger words cleaned, source ids, the licence acknowledged by the installing admin.

## Credentials

The Civitai key is `generation.styles.civitai_key` and the Hugging Face token is `voice.hf_token`, both `secret: true` settings (AES-256-GCM through `lib/secrets`, redacted by the settings
layer). The routes under `/api/loras/sources` save and remove them and report only `key_saved` or `token_saved`. They are sent to the Stack in one install body, never stored there, never in
a URL, a log, a job or a record. Note: `/api/voice/hf-token` writes the token to the Stack's speech engine, not to this setting, so a token saved only there is not visible to Home; save it here for styles.

## Not confirmed

The Civitai image `nsfwLevel` values (1, 2, 4, 8, 16) and the `baseModels` strings `LTXV 2.5` and `LTXV 2.3` could not be read from the documented reference (it names `nsfwLevel` on a model, with
31 as an example, but does not define the levels or list the LTX base names; its `/enums` sample stops before any LTX entry). The Civitai download host is also unverified (Stack side).
A result set filtered for the viewer's region cannot be detected from the response, so it is not marked `unknown` by that fact.

## Tests

`backend/tests/loras07.test.ts`: the classifier table, trigger words, dedupe, who may call, Civitai off, redaction while locked (route sweep of strings, proof alone, switch alone, another person's proof,
cache after a reveal), the limiter, the credentials, and the install flow against a fake Stack (job list, record, lowering rules, duplicates, Repairs and Try again).
