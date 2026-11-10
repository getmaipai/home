# LoRA sources and install (backend)

Built 2026-11-03 for VIDEO-LORA-07. Design: [video-loras-2026-11-02.md](../design/video-loras-2026-11-02.md) sections 5 and 15. The Styles tab (VIDEO-LORA-08, below) uses these routes. Records and access are in [loras.md](loras.md); the lock is in [adult-lock.md](adult-lock.md).

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
Civitai is on by default (`generation.styles.civitai`); an explicit off setting makes browse and install of a Civitai style answer 403 and sends nothing, and `source: "both"` searches only Hugging Face and says so. The setting remains separate from the write-only key. This computer contacts civitai.com only when an admin searches or installs a style.

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
- Installable bases depend on the selected media and installed engines. A Hugging Face repo whose base cannot be read needs `base_model` in the body.
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

`backend/tests/loras07.test.ts`: the classifier table, trigger words, dedupe, who may call, Civitai explicit opt-out, redaction while locked (route sweep of strings, proof alone, switch alone, another person's proof,
cache after a reveal), the limiter, the credentials, and the install flow against a fake Stack (job list, record, lowering rules, duplicates, Repairs and Try again).

## The Styles tab (VIDEO-LORA-08)

Settings, Pictures, videos and music, tab Styles (`frontend/src/apps/settings/styles/`, registered as `home.media_styles` in `shell/pages/settings/MediaCardViews.tsx`). Words come from the spec card's `copy`; the fallbacks in `stylesShared.tsx` are the same sentences.

| Piece | File | What it does |
|---|---|---|
| Tab | `StylesTab.tsx` | The list (one-click Only admins / All adults / Chosen people, the plain Adults only label and the three-state age check after the unlock), ONE kit `LockedSettingRow`, the running download as the kit `JobProgress` (never a name), where styles come from, Recently removed. Which dialog is open is kept in the router state (never the URL), because the unlock resets every query and reloads the page behind the tab. |
| Sources | same file | Hugging Face token and Civitai key are write only (saved, Replace, Remove; no value is ever drawn). Civitai is on by default; an admin can turn it off, and turning it on from off shows the notice first. |
| Browser | `StyleBrowser.tsx` | Search (300 ms pause), Pictures or Videos, Made for (All by default), Installed, Source, Sort, Previous / numbered / Next paging with each page's cursor kept, a licence badge and one reason line per tile, ONE lock tile for adult and unknown hits, Show adult results only while unlocked (off at each visit). A pasted Hugging Face link opens the confirm panel. An installed hit opens its style instead of starting a download. |
| Confirm | `StyleConfirm.tsx` | Name, source link, made for, the licence line (a checkbox unless the licence is open), and Is this style for adults only?, pre-set from the source's check (safe: No; unknown or adult: Yes). All ages from an adult hit asks for a fresh passcode (`/api/adult-lock/confirm`, item = the hit's `confirm_item`) and sends the ticket. A changed file offers Install as a separate style. |
| Editor | `StyleEditor.tsx` | About, Try this style (router state, no id in the URL), Remove, Who can use it, Adults only, Added to the prompt, Avoid with Say instead, Strength, Details. Every change saves at once. Adults only off asks, and asks for the passcode again when the check is `adult` (`POST /api/loras/{id}/all-ages` takes the ticket, item = the style id). |
| Add from a file | `StyleAddFile.tsx` | The existing multipart add (`POST /api/videos/adapters`), the same licence and adults-only questions; choosing All ages needs the unlock. |
| Fresh passcode | `FreshConfirm.tsx` | `useFreshConfirm`, the kit `AdultLockDialog` with the confirm's words. |

Backend added for it: `GET /api/loras` rows carry `adult_check` (evidence), and `POST /api/loras/{id}/all-ages` refuses a style whose check is `adult` without a valid ticket (`tests/loras08.test.ts`). Not built yet: Delete now in Recently removed, Check the file again, adding a file by its path, and the once-per-admin licence notice (the panel's licence step covers each install).


## Measured against the real Stack and Hugging Face (2026-11-04)

One real run on a dev hub: search "Clay Mation" on Hugging Face, install `vrgamedevgirl84/LTX_2.3_Clay_Mation_Style_LoRa` (336 MB, adults only, base picked as LTX 2.3), then a 2 second Detailed clip with it. The finished clip is clearly clay.

- The Stack answers a job as `{ "job": {...} }`. `getStackInstallJob` read the outer object, so every install stayed "running" and never wrote its record. Fixed; the `loras07` fake Stack now uses the real shape.
- Hugging Face hits are never `normal` (the check has no safe signal there), so a search shows one lock tile until the adult unlock is live. That is by design, not a failure.
- This repo says `Lightricks/LTX-Video` as its base, which reads as unknown, so the install needed `base_model: "ltx-2.3"` in the body (the Styles tab asks for it).
- The default base filter ("default") returned nothing until `setInstalledBasesProvider` was wired to real Stack readiness. Fixed in STYLES-03: known models contribute only bases they report can take styles, and an unknown Stack status falls back to every installable base instead of silently emptying the search.
- The Hugging Face base label repeats the base text (`Lightricks/LTX-Video Lightricks/LTX-Video ...`): cosmetic, not fixed.

## Pictures (STYLES-01a, 2026-11-05)

The browser searches picture styles through the same code as video styles. `lib/loras/baseFamilies.ts` is still the one table; each family now has
`media: "video" | "picture"`, and the browse body takes `media` (default `video`) with a `base` that has to belong to it (a mismatch is a 400 with
"That base is not available for picture.").

| Base id | Civitai label | Family words |
|---|---|---|
| `flux2-klein-4b` | `Flux.2 Klein 4B` | Flux |
| `z-image-turbo` | `ZImageTurbo` | Z-Image |
| `ernie-image-turbo` | `Ernie` | ERNIE |

The three labels were confirmed live against the public Civitai API on 2026-11-05. `Flux.2 Klein 9B`, `Flux.2 D` and `ZImageBase` are different
bases and are in no row, so their styles never show in a picture search. A hit's media is the media of its base (`mediaOfBase`); a hit with no
known base takes the media being browsed, so the "Made for ..." and not-supported sentences name pictures or videos correctly.

Picture install uses the shared `POST /api/loras/install` route with `media: "picture"` (omitting `media` still means video). Home refetches
the source hit, applies the same licence, duplicate, base and adult checks, then starts the Stack picture job at
`POST /stack/v1/image/loras/install`. Home maps `source` to Stack's `site` and `audience: "adult"` to
`classification: "adult-only"`; it sends the selected `base_model`, expected hash and saved token in that request body. The job is read from
the same wrapped `/stack/v1/jobs/{id}` response, and its picture record joins the shared LoRA store through `adoptPictureLoras` before Home
applies the install metadata and admin-only availability. A picture style's stored base remains `unknown`, because the Stack owns that fact
and reads it when the style is used.

## Measured against the real Stack (STYLES-05, 2026-11-05)

One real picture style went through the whole chain on a dev hub that used the live Stack: browse (`media: "picture"`, Hugging Face), install of
`tarn59/pixel_art_style_lora_z_image_turbo` (Apache-2.0, a Z-Image Turbo style, 1 click, about 20 seconds), the Stack job, the Home record, an admin
switching it on for adults, and a chat turn that made a picture with it. The picture was opened and judged: chunky stepped-pixel art, clearly unlike
the same request made without the style (which came out as smooth illustration with a pixel-art look from the words alone).

What was found, and what is open:

- **The one styles list hid picture styles.** `GET /api/loras` and `/api/loras/available` called `readLoras` without a media, which defaults to video, so
  the new record was in the database and invisible. Fixed (`ae2e524dc`): both take an optional `media` (`video` default, or `picture`).
- **A fresh picture style is off for chat.** It lands admins-only, and the picture tool's `enabled` rule (`availability.who !== "admins"`) leaves it out
  of `adaptersFor` for everyone, the owner included, until an admin sets availability to adults. That is the picture rule from before VIDEO-LORA-12;
  video lets an admin use an admins-only style in Create. Open: decide whether picture chat should follow `loraAccess` the way video does.
- **The style is applied only when the model names it.** `generate_image` takes `style` only when the person names the style. Of three chat turns,
  turn 1 ("in my Pixel art style") sent no style, turn 2 sent the name `Pixel` while the Stack was restarting for another session's release (cause not
  proven), turn 3 ("my saved style called Pixel art") sent it: the job carried `loras: [{ id, scale: 1 }]`, the style's own model (`z-image-turbo`) and
  Detailed. STYLES-04 (suggest a style chip from the prompt, the person confirms) is the fix for this, not a tighter tool description.
- A fresh install's trigger words are empty (Hugging Face gave none); the admin typed `pixel art` in the style's settings for this run.
- Hugging Face base tags for picture styles: the patterns found 3 picture hits for `flux2 klein` and 19 for `z-image-turbo` with the base read right on
  each; no wrong-base hit was seen in those 22. Not a full audit.
