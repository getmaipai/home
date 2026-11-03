# Video LoRAs and the Adult lock (2026-11-02)

Status: proposed, design only. Item VIDEO-LORA-01 (this note). Nothing here is built. Owner request (chat, 2026-11-02), three parts:

1. "loki doki had a lora browser and a way to install them on the home and mark them as nsfw. we need that ported over, only admins can add loras through
   household settings, loras are only available to admins until an admin marks them individually usable by others, then our video create/edit needs to
   support integrating them in a smart way. that means loading them and using positive and negative prompts/changing the prompt appropriately, etc."
2. "nsfw loras do not show in the admin panel or in the create/edit video unless they are unlocked with the user's passcode. this is shown with a lock that
   the user needs to click. if they leave that page and come back, they have to unlock again. same goes for nsfw generated content. those appear as locked
   items which you have to enter your passcode to unlock and view/edit. this is to prevent accidental viewing by a minor. not even the titles, descriptions,
   thumbnails, etc are visible when locked."
3. "images created with nsfw loras are auto marked nsfw. the image creator can override and choose to unmark as nsfw after a confirmation and their passcode."
   Applied here to clips, pictures and songs alike, video first.

Two designs in one note because the second is the first's gate: no slice that shows a LoRA or an adult item ships before the Adult lock (section 3).

> **Revision 2 (2026-11-02, owner rulings): section 15** replaces the browse, adult-handling, duplicate and install-robustness parts of sections 2.1, 4.1 (`audience`), 5.2 and 5.3 where they differ. Where section 15 and an earlier section disagree, section 15 wins.

> **Amended 2026-11-02 by [settings-media-2026-11-02.md](settings-media-2026-11-02.md):** the Settings parts (D2 and sections 4.4, 5.1, 5.2, 5.3 item 3, and the `adult_adapters` switch) now live in that note's Styles tab; its section 1 names each change. The lock, the record and the Create picker stand as written here.

## 0. Decisions in one list

| # | Decision |
|---|---|
| D1 | One spec record `Lora` (commons `spec`, first). Home owns the household record (audience, availability, add-ins); the Stack owns the file and the facts read from it (hash, size, rank, base). Replaces `video_adapter_prefs` and the Stack's `classification` as the source of truth (the Stack keeps `classification` as its second lock, written by Home). |
| D2 | Adding is admin-only (owner or admin), from Settings, Home settings, Pictures and videos, **Styles**. Sources: Hugging Face (on) and Civitai (off until an admin turns it on), plus a file. Admin-initiated, one person's pace, nothing automatic, nothing updates itself. |
| D3 | A new LoRA is usable by admins only. An admin marks each one usable by `adults` or by chosen `people`. Minors never see or use any LoRA, whatever the flags say. |
| D4 | Adult-only is a flag an admin sets. The source can only raise it. Lowering it needs the admin's explicit choice. Uncertain is adult-only. |
| D5 | **Adult lock** (section 3): an adult-only LoRA, and any adult-only generated item, is a locked tile with no metadata until the owner of the screen enters their own passcode. The unlock lives in memory for one page visit. The redaction is done by the server. |
| D6 | Anything made with an adult-only LoRA is adult-only from the moment the job starts. Only the creator can unmark it, with a confirm dialog and a fresh passcode. Marking more is always free. |
| D7 | Create shows the person's allowed LoRAs as picker cards ("Styles" and "Characters"). Picking one adds its trigger words and add-ins to the prompt visibly (a collapsed "Added for this style" line, each add-in removable), never removes the person's words, and shows a plain explanation. |
| D8 | The chat tools `generate_video` and `edit_video` take `styles` (names, at most two). The model decides when. Home, not the model, writes the trigger words and add-ins into the prompt. |
| D9 | "Negative prompt": the LTX-2.5 distilled path has no CFG, so a negative prompt has no effect there (the runtime refuses one unless NAG is on). The record carries `negative_addins` and `avoid_as_positive`. Home sends the negative text only to an engine that reports `negative_prompt: "nag"` (measured first); otherwise it sends the admin-written positive counterpart. No automatic negation-to-positive rewriting by the model. |
| D10 | LTX-2.5 LoRA support is a Stack slice that starts with a bench. Fused LoRAs in the q8 pack lose most of a small LoRA's effect (runtime doc), so Standard and Boost are expected to use the runtime's unfused adapter mode. This is a hypothesis; the bench decides. |
| D11 | Stack limits: at most 2 LoRAs per clip at launch (the Stack's own cap is 4), at most 1 `character`, strength 0 to 2, files up to 4 GB, hash recorded on download, safetensors only. |
| D12 | A LoRA made for one base (LTX-2.3, LTX-2.5, Wan) is used only with that base. A base that is unknown blocks use until an admin sets it. A 2.3 file is used on 2.5 only after the bench marks it compatible. |

## 1. Supersedes and amends

| Document | What changes |
|---|---|
| [video-generation-2026-10-17.md](video-generation-2026-10-17.md) section 7, "Who can use what" | The 2026-10-17 ruling "adult-only LoRAs are available and usable by adults by default" is replaced by the owner's 2026-11-02 rule: every LoRA is admin-only until an admin marks it usable (D3), and every adult-only LoRA sits behind the Adult lock. Minors still never reach an adult-only LoRA; they now never see any LoRA. |
| same, section 7, "Classification" | "Set at import from its metadata and tags": the source may only raise the flag to adult-only; all-ages is only ever an admin's explicit choice (D4). "Only an adult can reclassify to all-ages" becomes "an owner or admin". |
| same, section 14.4 (LTX-2.3 merge at load) and the Stack's `LORA_BASE_MODELS` | A third base, `ltx-2.5`, is added (VIDEO-LORA-05). The 2.3 behaviour stays. |
| `generation.video.adult_adapters` (VIDEO-GEN-04, spec-v0.1.155) | Stays as the household kill switch, meaning changes: "restricted" hides every adult-only LoRA from everyone, admins included, until it is set back. The default stays "allowed". It no longer grants anything by itself: availability does. |
| [dev/videos-create.md](../dev/videos-create.md), "LTX-2.5 takes no LoRA: the Stack answers 422" | True until VIDEO-LORA-05 lands; that slice rewrites the line. Until then a style clip goes the old way (Wan Quick or the LTX-2.3 Detailed kind), as built. |
| [video-create-feel-2026-11-02.md](video-create-feel-2026-11-02.md) and [video-create-one-page-2026-11-02.md](video-create-one-page-2026-11-02.md) | The Style popover gains a third group, **Styles**, drawn from LoRAs the person may use, beside Look and Camera. The banner trigger names it ("Anime, Dolly in, Clay"). The group draws locked tiles per section 3. No new control. |
| [video-chat-2026-11-02.md](video-chat-2026-11-02.md) chat cards | A card for an adult-only clip is the locked card of section 3.6. |
| Backlog: VIDEO-GEN-04 (settings view `VideoLibrary` with audience badges), IMGGEN-LORA-01 Home half (`picture_adapter_prefs`) | The audience badge in the Settings list is replaced by the lock tile. Pictures move onto the same record in VIDEO-LORA-12 (later, own slice; the record has `media` so it does not fork). |
| [image-engine-2026-10-17.md](image-engine-2026-10-17.md) section 6, "adults get adult-only LoRAs by default", and the sentence of the same meaning in the BACKLOG "Image engine" header | Replaced by D3 and the Adult lock for pictures, taking effect at VIDEO-LORA-12 and ADULT-LOCK-07. Until those land, picture LoRAs keep the 2026-10-17 policy: a stated gap against the owner's 2026-11-02 rule, not a decision. VIDEO-LORA-01 edits the BACKLOG header sentence to point here. |
| Anything earlier that shows an "audience badge" on a LoRA or clip | Superseded by the lock: a badge is metadata, and a locked item shows none. |

No rule in `docs/design/RULES.md` is changed. Rule 0 and rule 10 are untouched: the lock hides an adult's own adult items from a bystander, it blocks nothing an adult may make or see after they enter their passcode (section 8).

## 2. What exists and what legacy had

### 2.1 Legacy review (platform principle 8: every feature reviewed and rebuilt, never carried)

The archived repo is `/Users/jessetorres/Developer/github.com/loki-doki`, a plain directory without git history. The `legacy-backups/*-legacy.git` mirrors named in the brief are not present in the home checkout, so no commit messages were readable; lessons below come from code comments and docs. Reference: [loki-doki-image-video-review-2026-10-31.md](../reports/loki-doki-image-video-review-2026-10-31.md), row "LoRA catalog and router" (verdict redesign, already queued as IMGGEN-LORA-01).

| Legacy piece (path under `loki-doki/`) | Verdict (one line) |
|---|---|
| Browse modal `frontend/src/components/admin/LoraManager.tsx` (search, sort by downloads, rating or newest, paging, licence acknowledgment, NSFW thumbnails blurred) | Rebuild from kit parts. Keep search, sort, paging and the licence step. Drop blur: a blurred thumbnail still leaks, so adult results are locked tiles (section 3). |
| Civitai search through its Meilisearch endpoint with a public key hard-coded in `backend/src/routes/adminImageLoras.ts` (460 to 588), plus a second source, civarchive | Drop. An undocumented key and a mirror are not "behave like a person using the site". Use the documented Civitai REST API and the Hugging Face Hub API only. |
| Metadata by `GET /api/v1/models/{id}`, `trainedWords` as trigger words | Keep (documented endpoint). |
| Install `POST /civitai-import` (802 to 1100): `.part` file, rename on completion, `Range` resume, SSE progress, auth header only for the Civitai host and stripped on a cross-origin redirect, 5-minute search cache | Keep resume, `.part` rename, host-scoped auth and the cache. Progress goes through the existing job list (RULES S6), not a private stream. |
| No hash check, no base-model check (`baseFamilies` hard-set to SDXL), no size cap; pickle files converted in a ComfyUI venv | Fix all three: hash recorded and shown, base read from the file and the source, 4 GB cap, safetensors only (a pickle is refused, no conversion runtime). |
| Lesson in the code: Civitai error pages saved as `.safetensors` (`validateSafetensorsFile`, 1029 to 1040) | Keep: read the safetensors header before a file is accepted (the Stack already does). |
| NSFW: Civitai `nsfw` flag plus a keyword list on name and description (`lib/adultDetection.ts`), enforced by `protections.blockAdultLoras` | Keep the flag from the source (raises only). Drop the keyword list: no word list decides content (rule 0 and RULES-AND-LEARNED-COMPONENTS). The admin decides; uncertain is adult-only. |
| Trigger hygiene `lib/loraTokens.ts`: strip `<lora:...>` syntax, split comma dumps, dedupe | Keep, at import. |
| Prompt build `lib/promptPipeline.ts`: triggers first, then the words, a default negative | Keep triggers-first as the default, per-LoRA position field. The default negative is dropped (see D9). |
| Strength: default 1.0, range 0 to 2, a character LoRA below 0.8 stops producing the character (`routes/image.ts` 1377) | Keep as `strength_min` on the record (admin sets, default 0 for styles, 0.8 for characters). |
| Router: a local model picks LoRAs from `when_to_use` text at temperature 0 (`lib/loraRouter.ts`) | Redesign: the chat model names styles in a tool argument (rule 1), Home resolves the name. `when_to_use` becomes the record's one-line `description`. |
| Stale paths silently dropped while the UI said the LoRA was sent (`lib/loraFiles.ts` 3 to 12) | Lesson kept: a LoRA that cannot be applied fails the job with a plain line; it is never dropped silently (section 5.5). |
| Two character LoRAs both saying "solo" make one body (`planLoraTokens`); regional LoRA hooks made LoRAs barely register | Keep: at most one `character` per clip, duplicate add-in words removed across LoRAs. Regional hooks: not ported. |
| Default-deny grants per user or category | Kept in spirit and simplified: availability `admins` by default, then `adults` or chosen `people` (D3). |

### 2.2 In Home today

- Backend: `lib/videos/adapters.ts` (`allVideoAdapters`, `videoAdaptersFor`, `matchVideoAdapter`, `withVideoTriggerWords`, a 10 s cache over the Stack's list), `lib/videos/policy.ts` (`videoAdapterAudiencesFor`, `stackAudienceFor`, the `generation.video.adult_adapters` switch), `lib/videos/tool.ts` (matches one named style, adds trigger words, passes `loras` with the record's default strength; a style decides the video kind), `lib/videos/rerun.ts` and `routes/videos.ts` (another take keeps LoRAs still usable), `routes/videos.ts` `/settings`, `/adapters` add (file upload), patch (on/off, class, name), delete. Table `video_adapter_prefs` (`adapterId`, `enabled`, `updatedBy`; `updatedBy = "pending"` means "added, not yet confirmed").
- Frontend: `apps/settings/VideoLibrary.tsx` (model state, tier limit, the library with audience badges, confirm before on).
- Audience of an item: `attachments.provenance` JSON carries `audience: "all-ages" | "adult-only"` (`lib/access.ts` `fileAudience`); `canReadFileAudience` lets a minor read only an explicit all-ages file (an owner always reads their own). `video_jobs.request.adultOnly` is set at the job end by `isAdultOnlyJob` (an adult-only LoRA, or the prompt word check that already exists for the CSAM strictness) and an edit is never lower than its sources (`editTool.ts`, "never lower than its sources"). `lib/videos/feed.ts` builds Create feed rows (prompt, tags, poster, clip address); `lib/genLive.ts` carries the live preview.
- Passcode: `people`' credentials (`personCredentials.secretHash`, `secretDigits`), `POST /api/auth/verify-secret` with `verifyAgainstRecord` (lockout via `lib/credentialLockout.ts`, IP throttle via `lib/secretThrottle.ts`), passkeys, kit `PasscodeInput`, `usePasscodeAttempt` (wrong code, shake, 429 countdown), `SessionLockGate` (idle screen cover; content stays mounted, so it is not a lock for this purpose).
- Shell media: `MediaHostProvider`, `MediaPlayerRegistration`, the audio session and Media Session, the docked mini bar (MEDIA-VIDEOS-01, MEDIA-POLISH-01).
- Status mechanisms (RULES S6): the progress strip over the Stack's job list, Repairs items, notifications, the job's own card.
- Likeness: spec `LikenessAdapter` and `LikenessConsent` (LIKENESS-01) already cover a LoRA of a consenting household adult.

### 2.3 In the Stack today (origin/main)

- `backend/src/video/loras.ts`: its own library at `data/video/loras` (`manifest.json`, `lora-<16 hex>.safetensors`). Record: id, name, sha256, bytes, rank, modules, `base_model` (only `wan2.2-ti2v-5b`, `ltx-2.3`), licence, `licence_class`, `source_url`, `classification`, `strength_default`, `trigger_words`, `added_by`, `added_at`. Base read from tensor names and widths, never from a name; a file naming another LTX version is refused. Add: multipart upload or a local path only (no URL add for video; pictures have a Hugging Face URL install job in `images/loras.ts`, host-pinned to huggingface.co, no auth header, hash computed on receipt). Refusals: `wrong_base_model`, `lora_refused` (minor words), `lora_not_allowed` (the audience second lock), `unknown_lora`, `duplicate_lora`, `too_many_loras` (4), `bad_strength` (0 to 2), `lora_changed`, `lora_missing`. Caps: 2 GB file, 64 MB header.
- LTX-2.5 (`video/ltx25.ts`, `ltx25_worker.py`): `DistilledPipeline`, `low_memory=True`; answers 422 `lora_unsupported` for any LoRA; ignores `negative_prompt` ("accepted, no effect"). Admission figures: Standard 512x256 at 5 s 25.3 GB and 10 s 39.4 GB; Boost 640x320 at 5 s 32.4 GB and 768x448 at 5 s 45.8 GB; Max 1024x576 at 10 s 48.6 GB footprint, admitted at 51.0 GB, cap 64 GB. Stack main (the fork at 5795228 for Standard and Boost, dgrauet 0.18.0 for Max).
- Not in the Stack: a Civitai fetch, a `kind: lora` install job on `/stack/v1/models`, a `ltx-2.5` LoRA base.

### 2.4 The runtime (ltx-2-mlx 0.18.0, read from source and `--help` only, nothing run)

- `--lora PATH STRENGTH`, repeatable (`cli.py` 794 to 800). Keys are matched as `<path>.lora_A.weight` and `.lora_B.weight`; a ComfyUI rename map strips `diffusion_model.` and maps diffusers names (`loader/sd_ops.py`). No DoRA, no LyCORIS. The Stack's reader also accepts kohya `lora_down` and `lora_up`, which the runtime does not match: whether it errors or skips such a file is **unverified**, so the Stack must refuse a file the runtime cannot map (VIDEO-LORA-05).
- Default is **fused** before quantization (`_base.py` 585 to 628): a q8 weight is dequantized, the delta added, re-quantized; the runtime's own note says re-quantizing "loses most of a small LoRA's update". `LTX2_LORA_MODE=unfused` attaches run-time adapters instead (an environment variable, not a flag). Low-RAM mode fuses per block.
- `--negative-prompt` is CFG only and `--distilled` refuses it unless `--nag` is set (`_base.py` `reject_negative_prompt`, 99 to 146). `--cfg-scale` is rejected on `--distilled`. The bf16 pack has no dev transformer, so a non-distilled path is not available.
- Speed and memory cost of a LoRA on LTX-2.5: **unverified**; no LoRA-on-2.5 clip exists in `~/video-bench`. Whether the Stack's fork has the same LoRA code as 0.18.0 is unverified.

### 2.5 The ecosystem (web, 2026-11-02; [V] verified on a page, [U] unverified)

- Civitai: base model enum values `LTXV`, `LTXV2`, `LTXV 2.3`, `LTXV 2.5` [V, `civitai.com/api/v1/enums`]; samples are `.safetensors`, 170 MB to 2.5 GB, mostly style and enhance LoRAs with empty `trainedWords` [V]. Hugging Face: official `Lightricks/LTX-2.5-22b-IC-LoRA-*` (gated "auto", rank 128 bf16, 1.3 GB, no trigger words, strength 1.0, CFG 1) and community `LTX-2.3` style LoRAs [V]; many community base tags are loose [V].
- LoRAs are version specific by name (LTX-2, 2.3, 2.5 files); no statement from Lightricks that a 2.3 LoRA works on 2.5 [unknown]. A Dev LoRA works on the Distilled and FP8 builds of the same family [V, Lightricks staff on Hugging Face]. Key naming of community files [unknown]: the first slice reads real headers.
- Civitai API: `GET /api/v1/models` (params `types=LORA`, `baseModels`, `query` with cursor paging, `sort`, `nsfw` default false, `limit` 1 to 100), model `nsfw` flag and `nsfwLevel`, version `trainedWords`, `baseModel`, `files[].hashes.SHA256`, `files[].sizeKB`, `downloadUrl`, `allowCommercialUse`; hash lookup `GET /model-versions/by-hash/{hash}` [V]. A personal API key (Bearer) comes from the account page [V]; whether a download works without one is [U], many need one. No published rate limits; Cloudflare edge limits and back-off on 429 [V]. `nsfw=true` is silently ignored in SFW-gated regions [V]. Real-person likeness content has been banned there since 2025-05-22 [V]; Civitai blocked UK visitors from about 2025-07 [U]. Its Terms of Service page returned 403 to the fetcher: **unread**.
- Hugging Face: `GET /api/models?filter=lora&search=ltx` [V], file sizes and LFS sha256 with `?blobs=true` [V], gated models need an accepted licence and a token [V], rate limits per 5 minutes: 500 API calls anonymous, 1,000 with a free token [V].

## 3. The Adult lock

A reusable pattern for adult-only things (unrelated to SAFETY.md's "adult unlock", a parent unlocking a child's feature). Video first; pictures and songs adopt it by calling the same functions (slices ADULT-LOCK-07 and later rows).

### 3.1 What is locked, and what "locked" shows

Locked: (a) every adult-only LoRA, everywhere it would be listed; (b) every adult-only generated item (clip, and the poster, preview, edit and thumbnail of it); (c) a job in progress that is adult-only.

A locked thing is drawn as **one lock tile per list**, identical every time: a lock icon and the words "Locked items". It carries no title, description, prompt, thumbnail, poster, tags, trigger words, strengths, durations, dates, ids, counts, owner names or file names. A job that is making an adult item adds one small spinner to the tile and nothing else (no percent per item, no phase text, no queue position). One tile for any number of locked items means the screen leaks neither a count nor an order; it leaks only that something is locked for this person, which is the intent of a lock. A person with no locked items sees no tile.

Aggregate numbers (Library counts, "My clips" totals, badges, the Making now line, notification counts) never include locked items.

### 3.2 Who sees what

- A minor never receives a locked tile or any adult-only item: the minor lane gets none of them, as today (`canReadFileAudience`, rule 0). The lock is for an adult's own adult items on an adult's screen.
- Items belong to their creator. No other adult, an admin included, sees them unless the item was shared to them (below) or a tile for them (RULES 6a). An admin sees adult-only LoRAs (the household library) behind the lock, not other people's clips.
- A non-admin adult sees a LoRA tile only for LoRAs an admin marked usable for them, and the unlock is the same.
- A surface that is shared or spoken never unlocks (glance screen, TV, a robot, a speaker not identified, a guest, a spoken turn): no tile is offered there, as the surface gate of rule 0 already forbids adult-only output on those surfaces, and the server also refuses the unlock with a plain line ("Unlock on your own screen") as defence in depth.
- An adult-only item shared to another adult is `locked` for that recipient (they unlock with their own credential), never `open` without it; it is `hidden` for every other person.
- An adult with no passcode or passkey set sees the tile with "Set a passcode in Account to open these". Nothing unlocks without a credential.

### 3.3 Unlocking

Reuse (platform principles 1 and 4, one definition, one store). The credential is the person's own sign-in secret (the "passcode" when it is digits, the "password" or "PIN" otherwise; copy follows `pinDigits`) or their passkey. No second credential, no second hash.

1. **Verify.** The shared part of `verifyAgainstRecord` (lockout check, `verifySecret`, failure bookkeeping, throttle) moves out of `routes/auth.ts` into `lib/secretCheck.ts` and is used by `/verify-secret`, `/change-secret` and the new route. `POST /api/adult-lock/unlock { secret | passkey_assertion, visit }` returns `{ proof, idle_seconds }` or the same 401 and 429 bodies sign-in returns (`attemptsLeft`, `retryAfter`), so `usePasscodeAttempt` and `PasscodeInput` are reused unchanged.
2. **Lockout.** `lib/credentialLockout.ts` gets a `purpose` argument, `"signin"` or `"adult_unlock"`, with a separate counter and lockout for each: five wrong codes lock unlocking on the existing schedule in `lockoutDurationMs` (30 seconds, 2 minutes, 10 minutes, 1 hour), one definition of a lockout; the IP throttle is shared. Separate so a child poking at an open adult session cannot lock the adult out of signing in. A locked-out unlock raises no notification and names no item.
3. **Proof.** An opaque random token held in the hub's memory (a map, never the database, gone on restart), bound to `{ person id, session id, visit id, surface: own written screen }`. `visit` is a random id the page makes when it mounts. Lifetime: sliding **2 minutes idle**, absolute **15 minutes**. Revoked on sign-out, profile switch, `SessionLockGate` locking, a role or age change, a household switch that restricts adult-only items, and by `POST /api/adult-lock/lock`.
4. **Holding it.** The browser keeps the proof in a JavaScript variable in an `AdultLockProvider`, never in `localStorage`, `sessionStorage`, a cookie, a URL or the query cache's persisted copy. Requests send it as `X-Adult-Unlock`. A cookie is not used because it would span tabs; the lock is per page visit.
5. **Idle.** Pointer, key and media activity extend it; a playing clip counts as activity.

### 3.4 Scope: when it relocks

One `AdultLockProvider` is mounted per page, by the route, not by the app root. It relocks (drops the variable, calls `/lock`, removes locked media from the tree) when:

- the page unmounts (a route change, or a settings area change);
- the tab becomes hidden (`visibilitychange`, `pagehide`), with no grace period;
- 2 minutes pass without activity;
- the person presses Lock now (a plain button shown while unlocked);
- the session locks, the person signs out or switches profile.

What "page" means: **Create** (the Style popover and the results feed share one unlock); **My clips** (its own); **Household settings, Styles** (the settings area is the page; moving to another settings area relocks); **a chat** (the open conversation: switching conversations or leaving chat relocks; one unlock covers every locked card in that conversation); **the media host** never holds one (section 3.9).

A relock while a draft is open removes the adult-only style from the composer's selection with a line, "A locked style was removed", naming nothing. The person's words stay.

### 3.5 Server-side redaction (the point of the design)

One function decides, in `lib/adultLock.ts`: `lockState(viewer, item, proof) -> "open" | "locked" | "hidden"`. `hidden` is for a viewer who may not know the item exists (a minor, or another person it was not shared with); `locked` for the owner, or an adult it was shared with, without a valid proof. Every route and every internal producer that turns an item or a LoRA into text, a URL or a count calls it first and uses `lockedView(item)`, which is `{}` plus the single flags the tile needs (`locked: true`, `making: boolean`). There is no per-route copy of the rule.

| Surface | Locked behaviour |
|---|---|
| Create feed (`lib/videos/feed.ts`), My clips, `GET /api/videos/jobs/*`, the poll route | One `locked` entry; no prompt, tags, poster, clip, preview, seed, size, seconds, model, level, favorite mark |
| Library routes, search (`/api/search`, in-app and command), "recent", favorites, "continue watching" | Item omitted from every list and search index read; one tile only where the list is the owner's own video list. Search never matches the prompt of a locked item |
| Media routes: `/api/files/:id/content`, `/thumb`, `/poster`, `/download`, `/api/videos/jobs/:id/preview` | 404 (the same body as a missing file, the same latency) without a valid proof; with one, `Cache-Control: no-store`, no `Content-Disposition` file name from the title |
| Share sheet, `lib/shares.ts` | Share of a locked item refused; after unlock the sheet shows no title in the preview text; sharing to a minor is refused as today |
| Notifications, push, browser alerts, the bell, the Making now line, page `<title>`, document title changes, the `Repairs` list | Text is the fixed line "A locked item is ready" or "Something locked is being made"; no name, no item link that resolves without a proof |
| Library counts, activity feeds, Status page, `/api/status`, `/api/health` | Locked items excluded from every count and list |
| Chat transcript, chat cards, the persisted tool-call part (`prompt`, `styles`, `result`) | The persisted and wired tool part holds a placeholder (`locked: true`, no prompt, no styles, no file ids); the clip card is the lock tile. The person's own typed message stays as typed (it is chat, not generated content); a thread title made from a first message that asked for an adult item falls back to "New chat" (the title writer is told the request was adult-only, never its words). The model never receives the item's prompt or file id back in later turns, only "an adult-only video exists, locked" |
| The Stack's job list and progress (`/stack/v1/jobs`, `job.progress` events, `/v1/videos/generations/{job}`), the install strip | Stack jobs with `audience: "adult"` report progress and state only: no prompt, no first-frame preview, no LoRA names, no file names (ADULT-LOCK-04, Stack). A LoRA download job is named "a style" for everyone |
| Logs | Typed events from the registry with counts and timings only (RULES 6a): no person id, item id, LoRA name or file name. An unlock attempt is counted (`adult_lock.unlock` ok, wrong, locked_out) and never tied to a person |
| Mini player, audio session, Media Session | Section 3.9 |

**Not leaked through timing or errors:** a locked item and a missing item answer the same; the unlock endpoint takes no item id, so it cannot be used to probe for one.

### 3.6 Chat parity (the chat rules)

- Chat and Create use the same functions (the same `lockState`, the same prompt plan, section 5). A clip made in chat with an adult-only LoRA is stored adult-only from the job start and its card is the lock tile.
- Using an adult-only LoRA from chat needs a valid proof on the turn request (the chat page sends `X-Adult-Unlock` while unlocked). Without it the tool returns `{ locked: true }` and starts no job; the card is the lock tile with the unlock prompt. The person unlocks and asks again.
- What the model is told for a locked result: "an adult-only video was made and is locked; say it is ready and locked; do not describe it". Rule 10 forbids a content classifier on an adult's text, so the model's own words are not scanned and code cannot guarantee it follows this; a bench row measures how often a reply describes a locked item (target: 0 in 40 turns). The card and the stored tool part carry no description whatever the model writes.
- The tool description lists only all-ages style names. An adult-only LoRA is never listed to the model; it is resolved only when the person named it in their own words and the model passes that name in `styles` (the existing `matchVideoAdapter` path), and only for a person who may use it.

### 3.7 Edit, remix, join

Edit, remix, another take, continue, trim, join and mix on a locked item need an unlock first: the routes and the `edit_video` tool read the source file's `lockState`; an owner without a proof gets the lock tile and nothing starts. The edit sheet, trim and mix live inside the page and end with it (section 3.9).

### 3.8 The kit pattern (commons first, RULES 9b)

`commons` additive, default unchanged, new kit tag, then a Home pin bump:

- A `locked` state on the kit's `media_shelf` tile, `result_feed` entry, `VideoPlayer` (renders the lock, loads nothing), picker card (the popover group), and settings row. The lock tile is one kit component with no props except `making` and `onUnlock`.
- A kit `AdultLockDialog` built from the kit's `Dialog` and `PasscodeInput`, with the person's credential word, the lockout countdown from `usePasscodeAttempt`, focus on the first box, and return focus to the tile on close.
- A ledger row in `docs/design/UI-DECISIONS.md` (slice ADULT-LOCK-01 writes it): "locked state is one kit variant; Home writes no lock UI".
- Accessibility: the tile is a button named "Locked items. Press to enter your passcode." for every instance; the dialog is modal with a focus trap; on unlock a polite live region says "Unlocked"; on relock "Locked items hidden". No announcement ever includes a number or a name.

### 3.9 The mini player, the audio session and playback

One rule point in the media host: the media store's request path (`createMediaStore` and `mediaFor` in `frontend/src/shell/mediaHost.tsx`) refuses an item whose `MediaItemRef` carries `adultOnly: true`; `HoistedMedia` gains the field. The rule is in the host, so Music and Podcasts get it when they adopt the flag.

1. An unlocked adult-only item never registers with `MediaPlayerRegistration` or the audio session. It plays only inside the page's own `VideoPlayer`. There is no minimize, no dock, no keep-playing. Leaving the page (route change, tab hidden, idle, Lock now) stops the element, removes `src`, calls `load()`, revokes the object URL and relocks.
2. Media loads through an authenticated `fetch` with the proof header into a `Blob` and an object URL (a header cannot ride on a `<video src>`); the URL is revoked on relock. A clip is a few megabytes; if songs later need streaming the Stack-side one-time ticket is a separate design.
3. No leak around playback: no `navigator.mediaSession` metadata (title, artwork) for these items (the registration code sets none, and the player calls `mediaSession.metadata = null` on mount); no OS Now Playing, lock-screen, Bluetooth or car text; `disablePictureInPicture`, `disableRemotePlayback`, `controlsList="nodownload noremoteplayback"`, no AirPlay or cast session; no looping or hover preview and no poster while locked; no "continue watching", history entry, progress mark or resume position saved (an unlocked item always restarts at 0); no share-sheet title; the download file name is generic until the person confirms it in the dialog.
4. A job in progress: the Videos Making now line and the strip show "Something locked is being made", never the words.
5. A flag that flips while the item plays: an admin marks the LoRA adult-only again, or any marking to adult: playback stops and the page relocks at once (the page polls the flag on the same fetch it already makes, plus an event on the flag change). The creator unmarks: it stays playing.
6. The minor lane never gets these items at all (section 3.2), so no mini player state exists for a minor.

### 3.10 Auto-mark and unmark (owner rule 3)

**Where the flag comes from.** Two fields per file, both stored with the file record (`attachments.provenance` keeps `audience` as written today, plus a new row set in `adult_marks`):

- `made_audience` (`all-ages` or `adult-only`): the machine fact, set by the Home and Stack pipeline, never lowered. It is the **minor ceiling**: a minor never reads an item whose `made_audience` is adult-only, whatever else happens.
- `lock` (`on` or `off`): whether the Adult lock applies. It starts equal to `made_audience`, and is what the creator can clear.

`lock` starts on from an adult-only LoRA (set at job start, before the Stack is called, so a generating clip is already a locked item), from an adult source of an edit (the table below), or from the finished-clip check's own nude-or-sexual verdict (it runs before anything is stored). The existing prompt word check in `isAdultOnlyJob` (`lib/pictures/ageCheck.ts`) raises `made_audience` only (the minor ceiling and the CSAM strictness, as built); it never sets `lock` and blocks nothing. The model's words never set either field. No new word list is added. `canReadFileAudience` reads `made_audience`.

**Unmark.** Only the creator (the person whose item it is) can set `lock` to `off`, on an adult surface (own written screen). Steps: (1) the item menu shows "Remove the adult lock" only to the creator while the item is unlocked; (2) a confirm dialog in plain words: "Unlocking this item for good changes who can see it. It will show with its title and thumbnail in your feeds and lists, to anyone looking at your screen. People under 18 still never see it. Enter your passcode to continue."; (3) a **fresh** passcode entry (`POST /api/adult-lock/confirm { secret, action: "unmark", item }` returns a single-use ticket valid 30 seconds and bound to that item; a still-valid unlock proof is not accepted for this); (4) `POST /api/videos/jobs/{id}/adult-mark` with the ticket sets `lock` off and writes the audit row.

- An **admin cannot unmark** another person's item (they cannot see it either). Marking more is always allowed: the creator or an admin can set `lock` on, with no passcode, no confirm, and the audit row; an admin does it for items through reclassifying a LoRA (below) or for a LoRA record directly.
- Audit: `adult_mark_log` (item id, action `clear` or `mark`, actor id, time, `via`: `creator_passcode`, `creator`, `admin`, `auto`). No content. The audit rows are a record, not a log: no admin page, Status page or log shows them; only the creator sees their own rows, in the item's menu.
- An item made with several LoRAs stays locked while any adult-only LoRA is in its record, unless the creator unmarked it.
- Reclassifying a LoRA to adult-only locks every non-cleared item made with it; an item the creator cleared stays cleared and keeps its audit row.
- Minors: nothing changes. The unmark touches `lock` only. `made_audience` stays adult-only, so the minor lane, the shared-screen surface gate and the spoken gate keep reading the machine fact; a cleared item is never visible to a minor, and on a shared screen it stays hidden by the surface gate.

**Edit audience table (the existing "never lower than its sources" floor, extended).**

| Edit of | Adds an adult-only LoRA? | New item `made_audience` | New item `lock` |
|---|---|---|---|
| a clip locked on | no | adult-only | on |
| a clip the creator cleared | no | adult-only (the content came from an adult LoRA) | off (follows the source's current flag) |
| a clip the creator cleared | yes | adult-only | on |
| an all-ages clip | yes | adult-only | on |
| an all-ages clip | no | all-ages | off |
| a join or mix of several | any source locked on | adult-only | on |
| a join or mix of several | all adult sources cleared, none locked | adult-only | off |
| another take or remix of a cleared clip using the same adult-only LoRA again | yes (a new job) | adult-only | on |

The same rows apply to pictures and songs; their slices call the same function.

## 4. Data model

### 4.1 The `Lora` record (commons `spec`, `records`, first; slice VIDEO-LORA-02)

One record kind, `media` says what it is for (`video` now, `picture` when VIDEO-LORA-12 moves pictures onto it). Every record carries the shared spec fields (id, provenance, clock stamp, per rule 3 of the platform principles).

| Field | Type | Notes |
|---|---|---|
| `id` | id | Home's id; `sha256` is the file identity |
| `name` | text | the person-facing name, admin editable |
| `kind` | `style` or `character` or `motion` or `other` | groups the picker ("Styles", "Characters"); at most one `character` per clip |
| `description` | text, 140 chars | one plain line, admin edited; shown on the card and to the model's tool description (all-ages only) |
| `media` | `video` or `picture` | |
| `source` | `{ site: huggingface or civitai or file, url, remote_id, version_id }` | recorded, never refreshed automatically |
| `file` | `{ sha256, bytes, rank, modules, format: "safetensors" }` | read from the downloaded bytes by the Stack |
| `base_model` | `ltx-2.3` or `ltx-2.5` or `wan2.2-ti2v-5b` or `unknown` | read from tensors and the source's own base field; `unknown` blocks use |
| `compatible_with` | list of base ids | defaults to `[base_model]`; widened only by a bench result (D12) |
| `trigger_words` | list of text | sanitised at import (legacy lesson) |
| `trigger_position` | `start` or `end` | default `start` for styles (unverified convention; the bench decides) |
| `positive_addins` | list of text | admin written; each at most 120 characters, 400 in total per LoRA |
| `negative_addins` | list of text | same limits |
| `avoid_as_positive` | list of text | the positive counterpart used when the engine has no negative prompt (D9) |
| `strength` | `{ default, min, max }` | 0 to 2; characters default `min` 0.8 |
| `audience` | `all-ages` or `adult-only` | D4; uncertain is `adult-only`; `audience_set_by`, `audience_set_at` |
| `availability` | `{ who: admins or adults or people, people: [person id] }` | default `admins`; never includes a minor (the writer refuses one) |
| `added_by`, `added_at` | person id, time | |
| `licence` | `{ id, text, commercial_use, acknowledged_by, acknowledged_at }` | non-open or unknown needs the adder's acknowledgment on the card |
| `preview` | `{ file_id }` or none | an image the admin picked; fetched once through the hub, stored locally, never hot-linked; adult-only previews follow the lock |
| `removed_at` | time or none | restorable trash (4.3) |
| `last_check` | `{ at, ok }` | the last time the file was re-hashed |

### 4.2 Where each part lives (one definition, one store)

- Stack: the file bytes (`data/video/loras/lora-<16 hex>.safetensors`), the facts read from them, a mirror of `classification` that Home writes (the second lock, `lora_not_allowed`).
- Home: the `Lora` records (new table `loras`, replacing `video_adapter_prefs`), availability, add-ins, previews, the unmark rows `adult_marks` and `adult_mark_log`, and the Civitai or Hugging Face token (4.4).
- Migration: every existing Stack video LoRA gets a Home record with `availability.who = admins` (the owner's new rule; a LoRA that was on for chat yesterday is admin-only today) and `audience` from the Stack's `classification`. `needs_confirmation` rows keep their pending state until an admin opens them.

### 4.3 Removal

Remove moves the file to the Stack's `data/video/loras/.trash/` for 30 days and sets `removed_at`; the Settings row "Recently removed" restores it (one tap, no passcode for an all-ages LoRA, behind the lock for an adult-only one). After 30 days the file is deleted and the record is dropped. A clip made with a removed LoRA keeps the LoRA's name and hash in its record; Another take says "That style was removed" and runs without it.

### 4.4 The source token

A Civitai personal API key (and a Hugging Face token for gated Lightricks files) is stored in Home through `lib/secrets` (AES-256-GCM, key in `data/keys`), per CREDENTIALS.md; admin only; never shown after saving (replaceable, removable); sent to the Stack in the body of one install job and never stored there, never logged, never put in a URL (the Bearer header only, and stripped on a cross-host redirect, as legacy did). It is used only for the host it belongs to.

## 5. Installing and browsing (admin only)

### 5.1 Where, and who

Settings, Home settings, Pictures and videos, **Styles** (a settings area declared as data and drawn by the kit `SettingsShell`, RULES S4; copy through `describeSetting`, S5). Owner and admin only; every route is `requireRole("owner", "admin")`, as `/adapters` is today. The list shows each LoRA as a card (name, kind, base in plain words, size, availability, "Adult" never as a badge: adult-only LoRAs are inside the lock tile). Actions: Install a style, Add from a file, mark usable, mark adult-only, edit add-ins, remove.

### 5.2 Browsing (outbound, admin-initiated)

All outbound traffic of the browser goes through one module, `lib/loras/source.ts`, with one limiter per host (THIRD-PARTY-SERVICES: a person's pace, only what the admin asked for, back off on the first signal, honest client headers, cache like a client):

- Hugging Face: `GET /api/models?filter=lora&search=...` and `?blobs=true` for size and LFS sha256. Always sends the token when one is saved.
- Civitai: off by default (`generation.video.lora_sources`, household select, default `["huggingface"]`, an owner or admin turns Civitai on and reads a plain notice first). When on: `GET /api/v1/models` with `types=LORA` and `baseModels=LTXV 2.3` or `LTXV 2.5` (the exact enum strings), cursor paging, never page numbers past 1,000 results. `nsfw=true` is sent only after an Adult-lock unlock and only on an explicit "Show adult results" switch; results with the `nsfw` flag or `nsfwLevel` above 1 come back as locked tiles with no name or image until unlocked. If the results look SFW-filtered (a region gate) the page says what happened and what to do, not an error.
- Budget: one request per 2 seconds per host, at most 60 browse requests per hour per household, a 5 minute response cache, previews cached for 24 hours, at most one download at a time. A 429 or 5xx stops that host for an exponential 1 to 30 minutes, user-initiated requests only. Nothing runs in the background, nothing refreshes, nothing checks for newer versions; "Check for a newer version" is a button.
- No Civitai Terms of Service text could be read (the page refused the fetcher). VIDEO-LORA-DOC-01 must record the terms, the key's scope and the request budget in `THIRD-PARTY-SERVICES.md` and `PRIVACY.md` before the Civitai source ships; the Hugging Face source needs the same entry. Both docs are in the org `.github` repo, so that is a docs slice of its own, first.
- Privacy: the hub (not a person's browser) makes these requests, so the family's browsers never contact a LoRA site and see no remote images (previews are fetched once by the hub and served from `/api/...`). The request carries a search string typed by an admin and a token the admin saved; nothing about the household, the people or the prompts.

### 5.3 Install: an admin-initiated download job through the Stack

1. The admin picks a result and sees one confirm panel: name, source link, size, base model (and what the source says), licence (the card text, the commercial-use list), and the audience question, **"Adults only?"**, pre-set to Yes when the source says adult (Civitai `nsfw`, Hugging Face `not-for-all-audiences`) and also Yes when unknown. Choosing All ages is an explicit click; the source can never set it.
2. Install calls `POST /stack/v1/video/loras/install { source, url, sha256_expected?, token?, audience, added_by }` (VIDEO-LORA-06). The Stack runs a `video.lora.install` job: only an allow-listed host (`huggingface.co` and its CDN, `civitai.com` and its download host), HTTPS, `Range` resume into a `.part` file, rename on completion, a 4 GB cap (the Max-sized community files reach 2.6 GB), safetensors header read before acceptance, the sha256 computed on receipt and compared with the source's published hash when it has one, base detection from tensors and the source's field (a conflict is refused with `wrong_base_model`), `lora_refused` and likeness checks as built, a duplicate by hash answers the existing record. A pickle or any non-safetensors file is refused; there is no converter.
3. Progress and failure use the existing mechanisms (RULES S6): the job shows in the progress strip over the Stack's job list as "Downloading a style" (never the name, so an adult-only LoRA is not named on the strip), a failure raises a Repairs item for owner and admin with **Try again**, and the Settings card shows the plain cause (no space, too large, the hash did not match, the source refused, a sign-in is needed) after the Adult-lock unlock when the LoRA is adult-only. No new banner, toast or poller.
4. After install the LoRA is `availability: admins`. The admin opens the card, tries it, and marks it usable.

### 5.4 Import from a file

The existing multipart add stays, with the same header read, hash, base detection and the same confirm panel. A file with an unknown base asks for the base; `unknown` stays unusable.

### 5.5 Never silently dropped

Every LoRA in a request is applied or the job fails with a plain line. A LoRA the person may no longer use (marked unavailable since, removed, hash changed) makes Another take say so and run without it, with the line shown on the card, as the rerun path does today (`lib/videos/rerun.ts`).

## 6. Using LoRAs in Create, Edit and chat

### 6.1 The prompt plan (one function, `lib/videos/promptPlan.ts`, used by Create, chat and edits)

Input: the person's words, the chosen LoRAs with strengths, the engine's capabilities. Output: `{ words, trigger_words, positive_addins, negative, notes }` and the final prompt.

1. **The person's words are kept verbatim**; nothing is removed, reordered inside, or reworded.
2. Trigger words not already present (case-insensitive) go at each LoRA's `trigger_position`, comma-joined (`start` default). Duplicate add-in words across stacked LoRAs are removed (legacy "solo" lesson).
3. `positive_addins` follow the person's words, comma-joined.
4. Negative text: `negative_addins` are sent as `negative_prompt` only when the engine reports `negative_prompt: "nag"`. Otherwise the engine call carries no negative text and `avoid_as_positive` is appended to the positive prompt. Home never turns a "no X" into a positive sentence by itself, and the model does not rewrite prompts (D9). On the distilled path today a negative prompt is accepted by the Stack and ignored, so sending one would be a false promise.
5. Total added text is at most 400 characters (the record writer enforces it per LoRA, the plan enforces it across two).
6. **What the person sees:** a collapsed line under the prompt box, "Added for Clay look (2 phrases)", opening to the exact phrases, each with a remove control (a trigger word shows "This style works best with it"). The chat card's Details shows the final prompt. Nothing is added invisibly. For an adult-only LoRA the line, like the card, is inside the unlock (it shows nothing while locked).
7. Strength: the person sees **Less, Normal, More** (0.75x, 1x, 1.25x of the record default, clamped to `strength.min` and `strength.max`); the exact number is under Details. The chat model may pass `strength: "less"|"normal"|"more"`.

### 6.2 The Create picker

- The Style popover's third group, **Styles**, lists `kind: style`, and a fourth, **Characters**, lists `kind: character` (the group is absent when empty). Each card: a loop or still from the record's `preview`, the name, the one-line description. Auto is "no style".
- Selecting a card adds its plan (6.1), shows the plain explanation under the banner ("Makes your clip look like clay stop motion. It adds two phrases to your words."), and keeps the level the LoRA supports (6.4). At most two selected, one `character`; the third card disables with "Two at a time".
- Which cards appear: only the LoRAs the signed-in person may use (section 7). An adult-only LoRA the person may use is **not** drawn until the lock is open; the group shows the lock tile instead.
- Edit sheet: "Another take" and "Change the style" use the same picker for a remix; trim, join and mix have no model and no LoRA. A `continue` carries the source's LoRAs forward by default, subject to usability and compatibility, with the plain line "Continuing in the same style".

### 6.3 Chat

`generate_video` and `edit_video` (remix, continue) take `styles` (names, at most two) and `strength`. The tool description lists the person's all-ages style names compactly (at most 12 names of at most 24 characters, about 100 tokens, chosen by recent use); an adult-only LoRA is resolved only from a name the person said (section 3.6). The model decides when to use a style (rule 1: no word list decides it); explicit asks are honored; a name that matches none or two LoRAs makes the video without a style and says so (the existing note). The tool budget stays at the 16-tool cap (no new tool). Bench rows (VIDEO-LORA-11): tool decision on a style fresh set (named when asked, not named when not asked, false use), prompt plan fidelity (the person's words survive), and the describe-leak row of 3.6.

### 6.4 Level and base-model rules

| Case | Behaviour |
|---|---|
| LoRA `compatible_with` includes `ltx-2.5` and the level is Standard, Boost or Max | Used on that level, once VIDEO-LORA-05 reports `qualities.<id>.loras.supported` |
| LoRA made only for LTX-2.3 | The clip goes the older Detailed way (as built: "an LTX style makes it Detailed"); the card says "Made the older way" |
| LoRA made for Wan | Quick (Wan), as built |
| Base `unknown` | The card is disabled, "Ask an admin to set what this style is for" |
| The chosen level cannot hold it (Max with two large LoRAs past the 64 GB cap) | The card is disabled at that level with "Not at Max", never an error after a click |
| Mismatch at submit (a race) | The Stack answers `wrong_base_model`; Home shows the plain failure (existing `lora_*` copy in `lib/videos/jobs.ts`) and starts nothing |

The LoRA names, bases and model names appear under Details only (no resource words for people).

### 6.5 Stacking, speed and memory

- Limits at launch: at most **2** LoRAs per clip at every level (the Stack's own hard cap is 4), at most 1 `character`. Raised only by a bench.
- Cost model (hypothesis, to be measured): fused LoRAs change the weights once per pipeline build; in the q8 pack the runtime says fusing loses most of a small LoRA, so Standard and Boost are expected to need unfused adapters, which keep `A` and `B` resident (about the file size, 0.2 to 2.6 GB each) and add per-step compute. Max (bf16) can fuse without requantization. A change of LoRA set may rebuild the pipeline (time cost per change). The Stack's admission adds `sum(file bytes) x 1.1` per clip; `GET /stack/v1/video` reports `loras: { supported, max, mode: "fused" | "unfused", negative_prompt: "none" | "nag" }` per level, and Home offers only what the Stack says.
- No figure here is measured. Section 9 states the proofs.

## 7. Permissions (one function, `lib/loras/access.ts`)

`loraAccess(person, lora, surface) -> "open" | "locked" | "hidden"`, used by every route, the tool, the picker and Settings:

| Person | all-ages LoRA | adult-only LoRA |
|---|---|---|
| Child, teen, guest, unidentified speaker, spoken turn, glance screen, TV | hidden | hidden |
| Admin (owner or admin) on own written screen | open (the household library) | locked, open after unlock |
| Non-admin adult marked in `availability` (`adults` or `people`) | open | locked, open after unlock |
| Non-admin adult not marked | hidden | hidden |
| Any adult when `generation.video.adult_adapters` is "restricted" | open (as above) | hidden |

Chat and Create run the same function (platform principle 1, one definition). The Stack's `lora_not_allowed` second lock stays; Home sends `audience: "adult"` only for an allowed adult whose proof is valid and who may use an adult-only LoRA, as `stackAudienceFor` does today. Content floors for minors, the household-name gate, the likeness consent and the CSAM check (rules 0 and 10) are unchanged and run first.

## 8. Rules check

| Rule | Check |
|---|---|
| 0 age and surface gates | Minors never see or use any LoRA, never receive a locked tile or an adult item; shared, spoken and guest surfaces never unlock. Unmark never lowers `made_audience`, so the minor lane is unchanged. |
| Adult content is the model's decision; CSAM is the only block | The lock hides, it does not block: an adult passes it with their own passcode and may make and see anything the model allows. No word list decides a lock (the one existing prompt word check is kept as built and raises only `made_audience`, the minor ceiling; it never sets `lock`). No consent prompt for adult likeness or voice. CSAM detection runs on every finished clip before anything is stored; an unrun check on an adult-only job fails closed (`settleClip`, unchanged). |
| 1 the model decides | Style choice is a tool argument the model decides; Home resolves the name and writes the prompt. No regex reads wording to pick a LoRA. |
| 2 native feature | The Stack's runtime `--lora` and the engine's own adapter mode are the implementation. Home does not re-implement LoRA application. |
| 6 and 6a | A failed LoRA fails the job with a plain line, not the chat answer; logs carry typed events with counts and timings only, no person or item id; admins do not see others' items. |
| 8 (every model gets every feature its template supports) | Nothing is gated on one catalog model id; style names go to any tool-capable model; a model with no measured record keeps the minor no-tools fail-safe. |
| 9 and 9b, kit as shipped | The lock tile, the dialog, the picker cards and settings rows are kit variants (section 3.8); no Home className on a kit Element; ledger row first. |
| 10 | Delivery gate unchanged; the lock adds no output check. |
| 11 | Only the Stack's own tested runtime runs LoRAs; a LoRA file is data, not a runner. |
| S1 to S4 and S5 | One Settings entry, one settings shell, copy through `describeSetting`. |
| S6 | Install progress on the progress strip, failure as a Repairs item, a job's progress on its own card (a locked tile for adult items), notifications through `lib/notifications.ts`; no new surface. |
| V1 | Applies to live video services; these are model hosts, but the same spirit is followed: admin-initiated, a person's pace, a budget, a back-off, documented first. |
| Platform principles | Chat and Create parity: one `lockState`, one `loraAccess`, one prompt plan. Simplify (one record, one function per concern); no data debt (shared spec shape, id, provenance, clock stamp from the first record); spec first; repos only for different cadence; prebuilt kit parts; hub first. |
| Privacy | Zero phone-home: no outbound call unless an admin clicks; the hub is the only caller; no household data in a request; no hot-linked images. Downloads are of public model files by an allow-listed host. |
| Third-party services | Own limiter module, honest client, cache, back-off, doc first (VIDEO-LORA-DOC-01). |
| Credentials | The source token in `lib/secrets`, admin only, never logged or put in a URL, never stored in the Stack. The unlock reuses the person's secret; no second hash. |
| Releases and dependencies | Download, do not vendor: no LoRA file is bundled or hosted by us; the files stay on the household's machine. |

## 9. Legal and policy

- No hosting: Home and the Stack download a file the admin chose, to the household's own disk, for the household's use. We never redistribute, mirror or bundle one. The catalog and the package host do not carry LoRAs.
- Per-LoRA licence: read at install from the source's card (Hugging Face `license`, Civitai `allowCommercialUse` and the model page). Open licences (Apache-2.0, MIT, CC0) import freely; non-commercial, a custom licence or an unknown one needs the adder's acknowledgment, shown on the record. A LoRA's licence never changes the base model's: the LTX-2.x Community License on the base and on Lightricks' own LoRAs (gated, a licence the admin accepts on the site once) stays with the file.
- Civitai: terms unread at the time of writing; the real-person likeness ban of 2025-05-22 and the UK block are reasons to keep the source optional and to keep Hugging Face and file import fully working without it. Likeness LoRAs follow the existing LIKENESS-01 consent records; the Stack's real-person word handling (adult-only) stays.
- Adult LoRAs follow rules 0 and 10: no content refusal by Home beyond CSAM, the lock and the admin's availability decide who may use one, and the owner's note (an adult makes what the model allows) holds. A file whose own text names a minor in a sexual context is refused by the Stack (`lora_refused`), as built.

## 10. Bench plan (one real clip per proof; none run in this task)

This task ran only reading. No clip was generated and no LoRA or model was downloaded. A `--help`-level check of the runtime is already in section 2.4.

Admin downloads one open-licence LTX-2.3 style LoRA and one LTX-2.5 LoRA (the Stack or the admin, in the bench slice). Each row is one real clip at the stated level, compared with the same seed and prompt without the LoRA:

| # | Proof | Measured |
|---|---|---|
| B1 | One LoRA at Standard (q8, 512x256, 5 s), fused, then unfused | Does the look change? Fused vs unfused effect, seconds, peak memory |
| B2 | Two stacked LoRAs at Standard | Both visible? Seconds, memory, strength interplay |
| B3 | Speech preserved: a line of dialogue with and without a LoRA | Understood, same words |
| B4 | One LoRA at Boost and at Max (bf16, fused) | Quality, seconds, memory against the 64 GB cap |
| B5 | A 2.3 LoRA on the 2.5 pack | Loads? Effect? Marks `compatible_with` only on a pass |
| B6 | A kohya-key file (`lora_down` and `lora_up`) | Runtime error or silent skip (decides what the Stack refuses) |
| B7 | Negative prompt with `--nag` on the distilled path, with a LoRA | Does it change the clip? Reported as `negative_prompt: "nag"` only on a pass |
| B8 | Trigger position start vs end for one style LoRA | Which default |
| B9 | LoRA-set change cost (rebuild time when the set changes between jobs) | Seconds |
| B10 | Tool decision, plan fidelity and describe-leak rows (CHAT-AB-01 style fresh set, at least 3 repeats) | Rates |

Results go in `docs/design/video-loras-bench-<date>.md`; admission numbers and the per-level caps come from there.

## 11. Tests that would catch a leak (written first in each slice)

Fixture (`fixtures/adult-lock`): a seeded household (owner Sage, adult Atlas, teen Marlow, child Nova), one adult-only LoRA with unusual strings (name, description, trigger words, add-ins, preview file), one clip made with it (prompt, poster, clip, preview frame), one all-ages LoRA and clip.

1. **Route sweep while locked:** walk every route in the OpenAPI document that can return an item or a LoRA, as the owner without a proof, and assert none of the fixture's strings, ids, file names or hashes appear in any response body, header, or error text; media routes answer 404 identical to a missing file. Fails when a new route is not on the allow list of "returns no item data".
2. **Rendered tree while locked:** render Create, My clips, the Settings Styles page, the Style popover, a chat with the clip card, the Library, search results, notifications, the Making now line, the document title: assert the strings are absent from the DOM, `aria-label`s, `title` attributes and the accessibility tree, and that exactly one lock tile exists per list and has the same name every time.
3. **After unlock:** the same fixture strings appear; the proof is not in `localStorage`, `sessionStorage`, cookies, the URL or the persisted query cache.
4. **Relock:** a route change, `visibilitychange` to hidden, 2 minutes idle and Lock now each drop the proof, remove `src` and revoke the object URL, and the next request with the old proof returns locked; the server proof expires after 2 minutes idle and 15 absolute; a restart drops all proofs.
5. **Unlock endpoint:** wrong code returns 401 with `attemptsLeft`; five wrong codes lock it for 30 s (429 with `retryAfter`), then 2 minutes; unlock failures do not touch the sign-in counter; a shared or spoken surface, a guest, a minor and a person with no credential are refused; a passkey assertion unlocks.
6. **Minor lane:** teen and child routes, tools, feeds, search and Library return none of the fixture, with or without an unmark, including a creator-cleared item.
7. **Stack job list:** a job with `audience: "adult"` carries no prompt, preview or LoRA name in the list, the events and the status route.
8. **Chat parity:** the persisted tool part and the wire part hold the placeholder; the model's next-turn history has no prompt or file id; a locked source stops `edit_video`; using an adult-only LoRA from chat with no proof starts no job.
9. **Mini player and media host:** registering a flagged item with the media host is refused; a route change stops playback and tears down the element; `navigator.mediaSession.metadata` is never set for a flagged item and is null while one plays; no poster, loop or hover preview renders while locked; no history or resume position is stored; a flag that flips on while playing stops and relocks, and a flip off keeps playing.
10. **Auto-mark and unmark:** a job with an adult-only LoRA is `adult-only` before the Stack is called and its feed entry is the lock tile from the first poll; unmark needs the creator, a fresh passcode (an unlock proof is refused) and the confirm; an admin cannot unmark; the audit row exists and has no content; re-mark needs no passcode; the edit table of 3.10 row by row; a minor never sees the item before or after unmark.
11. **Permissions:** the table of section 7 cell by cell for each person and surface; a LoRA marked usable by `people` is open for exactly those people; a minor id cannot be written into `availability`.
12. **Prompt plan:** the person's words survive byte for byte; triggers at the chosen position; duplicates removed; the 400 character cap; negative text sent only when the engine reports `nag`; `avoid_as_positive` used otherwise.
13. **Install job:** a hash mismatch, a pickle, a wrong host, an oversize file, a header that is not safetensors and an unknown base each fail with the plain line and a Repairs item; resume completes; the token is absent from logs and from the job list.

## 12. Build slices

Added to `docs/BACKLOG.md` under "Video generation", in this order. The Adult lock comes first; nothing that shows a LoRA or an adult item ships before ADULT-LOCK-03 and 03b.

| Id | Size, repo | Slice |
|---|---|---|
| ADULT-LOCK-01 | S, commons | `locked` state on `media_shelf` tile, `result_feed` entry, `VideoPlayer`, picker card and settings row; `AdultLockDialog`; accessibility; UI-DECISIONS.md ledger row; tag |
| ADULT-LOCK-02 | M, Home | `lib/secretCheck.ts` extracted from `routes/auth.ts`; `credentialLockout` purpose; `/api/adult-lock/unlock`, `/lock`, `/confirm`; the in-memory proof map; `lib/adultLock.ts` (`lockState`, `lockedView`); `AdultLockProvider` and its relock triggers; fixture and tests 3 to 5 |
| ADULT-LOCK-03 | M, Home, server | Apply to video: feed, My clips, job, file and preview routes (404 without proof, no-store), Library, search, recent, share, notification text, titles, the persisted tool part, edit and remix gates; tests 1, 6, 8 |
| ADULT-LOCK-03b | M, Home, frontend | Lock tiles on Create, My clips, the Style popover and chat cards, the Making now line, the document title; test 2; dev hub opened at 1440 and 390 |
| ADULT-LOCK-04 | S, Stack | Adult-audience jobs report progress and state only (no prompt, preview, names) in the job list, events and status route; test 7 |
| ADULT-LOCK-05 | M, Home | Media host rule point (`adultOnly` on `MediaItemRef`, refused in `createMediaStore`), blob playback, Media Session and PiP guards, no history or resume; the live flag flip; test 9 |
| ADULT-LOCK-06 | M, Home | `made_audience` and `lock` split, auto-mark at job start, `adult_marks` and `adult_mark_log`, creator unmark with confirm and fresh passcode, admin re-mark, the edit table; tests 10 |
| ADULT-LOCK-07 | S, Home; after 06 and VIDEO-LORA-12 | Pictures adopt `lockState`, auto-mark and unmark; songs follow in their own row. Exit: tests 1, 2, 6 and 10 on the picture fixture |
| VIDEO-LORA-DOC-01 | S, `.github` | THIRD-PARTY-SERVICES.md and PRIVACY.md entries for the LoRA sources (hosts, budget, key scope, terms read), before VIDEO-LORA-06 (the Stack's download is the first outbound request) |
| VIDEO-LORA-02 | S, commons | Spec `Lora` record and `availability`, tests, tag |
| VIDEO-LORA-03 | M, Home | `loras` table, migration from `video_adapter_prefs`, `lib/loras/access.ts`, the household library routes over the Stack's list, restorable trash fields, tests 11 |
| VIDEO-LORA-04 | M, Stack and runtime bench | B1 to B9 (needs the admin to place two LoRA files); results note; decides fused or unfused per level |
| VIDEO-LORA-05 | M, Stack | LoRA support in `ltx25_worker.py` and `ltx25.ts`, base `ltx-2.5`, key refusal for files the runtime cannot map, admission adds LoRA bytes, `qualities.*.loras` and `negative_prompt` fields, the 4 GB cap; rewrites `videos-create.md` line |
| VIDEO-LORA-06 | M, Stack | `video.lora.install` job: host allow list, resume, hash, safetensors header, base check, caps, token in body, trash and restore |
| VIDEO-LORA-07 | M, Home | `lib/loras/source.ts` (limiters, caches, Hugging Face and Civitai browse), the token in `lib/secrets`, `generation.video.lora_sources`, install routes, Repairs and strip wiring; test 13 |
| VIDEO-LORA-08 | M, Home | Settings, Pictures and videos, Styles: browser dialog, confirm panel, library cards, add-ins editor, availability, import, remove and restore, lock tiles |
| VIDEO-LORA-09 | M, Home | `promptPlan.ts`, the Create picker groups, the explanation and "Added for" line, strength control, level and base rules; test 12 |
| VIDEO-LORA-10 | M, Home | `generate_video` and `edit_video` `styles` and `strength`, tool description list, `continue` carries styles, chat parity, the resolve by a name the person typed path for adult-only |
| VIDEO-LORA-11 | S, bench | B10 rows and the final proof clips at Standard, two stacked, speech kept |
| VIDEO-LORA-12 | M, Home | Pictures move onto the `Lora` record (replaces `picture_adapter_prefs`) |

Order: ADULT-LOCK-01, 02, 04, 03, 03b, 05, 06; VIDEO-LORA-DOC-01 and 02 in parallel; VIDEO-LORA-03; the bench VIDEO-LORA-04; DOC-01 first, then 05 and 06; 07, 08; 09, 10; 11; then 12, then ADULT-LOCK-07.

## 13. Reuse check

| Need | Already exists | Decision |
|---|---|---|
| Passcode verify, lockout, throttle, passcode boxes, error and countdown | `verifyAgainstRecord`, `credentialLockout`, `secretThrottle`, `PasscodeInput`, `usePasscodeAttempt` | Extend (extract, add a purpose); no second credential or hash |
| Idle lock | `SessionLockGate` (cover only, content stays mounted) | Not reused as the lock (it hides nothing from the tree); it is a revoke trigger |
| Per-file audience | `provenance.audience`, `fileAudience`, `canReadFileAudience`, the edit floor | Extend: the machine fact stays as the minor ceiling; `lock` is added beside it |
| Adult-only job check | `isAdultOnlyJob`, `gateFinished`, `settleClip` | Extend: the LoRA flag is set at job start |
| LoRA library, base detection, second lock, refusals | Stack `video/loras.ts` | Extend; add base `ltx-2.5`, an install job, trash |
| URL install job | Stack `images/loras.ts` (Hugging Face only) | Reuse the pattern; one shared downloader if the picture slice allows, else the video one copies none of its code twice |
| Household switches | `video_adapter_prefs`, `adult_adapters` | Replaced by the `Lora` record; the key stays as the kill switch |
| Status surfaces | progress strip, Repairs, notifications, job card | Reuse all; no new one |
| Settings shell, kit dialog, tiles, popover groups | kit | Reuse; one additive `locked` variant |
| Prompt build helpers | `withVideoTriggerWords`, `withVideoLook`, `withVideoRecipe`, `withVideoVoices` | Extend into the one prompt plan |
| Likeness consent | LIKENESS-01 records | Reuse unchanged |
| Search and share, Library, notifications | existing routes | Call `lockedView`; no copy of the rule |
| Media host registration | `MediaHostProvider`, `MediaPlayerRegistration` | One flag, one rule point |
| Hugging Face and Civitai client | `@huggingface/hub` (official, maintained); Civitai has no official JS client | Use `@huggingface/hub` for the Hugging Face listing and file metadata, behind the one per-host limiter and cache of `lib/loras/source.ts` (VIDEO-LORA-07 checks the package can be limited and cached from outside, else a thin `fetch` with the reason recorded); Civitai is a thin `fetch` in the same module |
| Lockout schedule | `lockoutDurationMs` (30 s, 2 m, 10 m, 1 h) | Reused as is for the `adult_unlock` purpose |
| Legacy code | Loki Doki | Reference only (table 2.1); nothing copied |

Duplicates avoided: no second passcode store, no second audience flag for minors, no second status surface, no second LoRA record.

## 14. Open items that are measurements, not owner questions

- Every cost and quality figure of a LoRA on LTX-2.5 (section 10).
- Whether the Stack's fork runtime has the same LoRA code as 0.18.0, and whether NAG exists there.
- Civitai Terms of Service text and whether a download works without a key.
- Real LoRA key naming of community LTX files (read headers in VIDEO-LORA-04).

## 15. Revision 2 (2026-11-02): browse like Loki Doki, three-state adult check, duplicates, install robustness

Owner rulings (chat, 2026-11-02): the LoRA browser threw away what the Loki Doki one did well. (1) Browse with search, filters, sort, paging, a licence step and one-line reasons. (2) Adult handling has three states, `normal`, `unknown` and `adult`, decided from the source's own data only, in place of a keyword list. (3) Remove duplicates in results and refuse or flag a duplicate install. (4) Port the install robustness. Nothing here is built; the slices are in 15.8.

**Rules check, up front.** RULES rule 0 forbids word lists and classifiers that block an adult, and the lock here hides and never blocks (section 8). This revision adds no word list: a state comes only from fields the source publishes (a flag and per-image levels), never from reading a name, description or tag for words. The old `lib/adultDetection.ts` keyword list stays dropped (table 2.1). No rule in `docs/design/RULES.md` changes, so no Owner-approved note is needed; the owner chose three states instead of a keyword list, and this section records that choice. The lock, availability and minor floors of sections 3 and 7 are unchanged.

### 15.1 The three states (the `adult_check`)

`adult_check` records what the source said, once, at browse or install time. It is evidence, never an access decision. The access decision stays the existing `audience` (`all-ages` or `adult-only`, default `adult-only`, `audience_set_by` for an explicit choice).

| State | Meaning | Treated as |
|---|---|---|
| `normal` | The source's data says it is safe | Browse tile open; the confirm panel pre-sets "Adults only?" to No (an admin still presses Install; that click is the explicit choice, so `audience_set_by` is the admin) |
| `unknown` | Missing, partial or conflicting data, or an unreadable response | Exactly like `adult`: locked tile, no title or thumbnail without an unlock proof; `audience` stays `adult-only` |
| `adult` | The source says or shows adult | Locked tile; `audience` `adult-only`; lowering it needs the admin's explicit choice with a **fresh Adult unlock proof** |

**Civitai** (documented REST API `GET /api/v1/models`; per-image `nsfwLevel` of the version's `images[]`; level values 1 = PG, 2 = PG-13, 4 = R, 8 = X, 16 = XXX, to be re-checked against the live API in the VIDEO-LORA-07 fixtures; unverified here):

1. `adult` when the model's `nsfw` flag is true, **or** the model `nsfwLevel` is 4 or more, **or** any returned preview of the chosen version has `nsfwLevel` 4 or more. Any one of these wins even if the model's tags say safe.
2. `normal` only when the flag is false, **and** at least one preview was returned, **and** every returned preview has `nsfwLevel` 1, **and** the model `nsfwLevel` is absent or 1.
3. `unknown` in every other case: no previews, a preview with level 2 or a missing or non-numeric level, flag false against a model level of 2, a truncated or unparseable response, or a result set the source filtered for the viewer's region (the hub cannot know what was hidden).

The check runs on the version the install will fetch (the version's previews), not the model's newest version.

**Hugging Face** publishes no per-image level: `unknown`. One source field exists, the repo tag `not-for-all-audiences`; it raises to `adult` (a raise from the source's own data, never a lowering, and no word is read). Everything else on Hugging Face stays `unknown` until an admin decides. A file the admin adds is `unknown`.

**Admin decisions** (Styles tab, behind the lock, as 3.2):

- `unknown` to normal: an unlocked admin may choose All ages (no extra proof; they already unlocked to see it). Recorded in `audience`, `audience_set_by`, `audience_set_at`.
- `adult` to normal: needs a fresh Adult unlock confirmation (the `/api/adult-lock/confirm` ticket of 3.10, single use, 30 s, bound to the LoRA). The record keeps `adult_check.state = adult` as evidence; only `audience` changes.
- Any state to adult: always allowed, no proof (marking more is free, 3.10).
- A re-run of the check (the Check again button) can raise a record's evidence; it never lowers `audience`.

**In the browse results** (the one place hits are drawn before an install): an `adult` or `unknown` hit is a locked entry only, drawn by the kit as the one lock tile per list (3.8), with no title, creator, thumbnail, counts or reason line. Without an unlock proof the hub requests Civitai with `nsfw=false`, still classifies every returned model, and collapses the locked ones into the single tile (shown only when at least one exists, with no number; its place does not reveal a rank). With a proof and the **Show adult results** switch (off at each visit, the only thing that sends `nsfw=true`, 5.2) the full hit arrives. The hub fetches a hit's preview only for a hit it may show, and serves it from `/api/...` with the proof; without one the answer is 404 like a missing file. The 5-minute cache holds classified hits in hub memory only; redaction happens when a response is built, so a cache entry never leaks across a lock. Loki Doki blurred adult thumbnails (`LoraManager.tsx` 236 and 450, `blur-xl`); a blurred picture still leaks and is not kept.

### 15.2 Spec impact (spec first, then Home)

The `Lora` record in commons `spec` gets one additive optional field, **`adult_check`**: `{ state: "normal" | "unknown" | "adult", basis: "source_flag" | "source_levels" | "source_tag" | "none", flag: boolean | null, levels_seen: integer, adult_levels: integer, checked_at: date-time }`. Absent reads as `{ state: "unknown", basis: "none" }`, so every existing record validates unchanged. `audience` stays two-valued: `unknown` is a check state, not an audience, so Stack's `classification` mirror and every existing reader are untouched (one definition, one store). `validateLora` already requires `audience_set_by` for every `all-ages` record; 02b extends that one rule to require `audience_set_at` as well, and rewords the `audience` description (the admin's Install click is the explicit choice when the check says `normal`). The Stack is never sent a full `Lora` record carrying `adult_check` while pinned to an older spec. Whether an unlock proof backed a lowering is checked by the Home writer, since the record holds no proofs. The browse hit itself is a Home-internal shape in `lib/loras/source.ts`, not a spec record. Order: commons spec change and tag, then `bash scripts/pin.sh commons spec-vX.Y.Z` in Home.

### 15.3 Browse (Loki Doki's, rebuilt from kit parts)

Request `POST /api/loras/browse { source, q, media, kind, base, installed, sort, cursor, adult }` (settings-media 6, amended here).

| Control | Values | Notes |
|---|---|---|
| Search | text | 300 ms debounce on the first page (as `LoraManager.tsx` 84); a pasted Hugging Face link opens the confirm panel |
| Type | Any, Style, Character | Civitai: from the model's `tags` category data as a filter only (it decides nothing about content); Hugging Face has none, so such hits are Any and the admin sets the kind in the confirm panel |
| Made for | LTX-2.5, LTX-2.3, Wan, All (default LTX-2.5 and LTX-2.3) | Civitai `baseModels` with the exact enum strings; Hugging Face from the repo's `base_model` metadata |
| Installed | Any, Not installed, Installed | `installed` is by source version id, then sha256 where known, against live records; for a locked hit it is never shown |
| Source | Hugging Face, Civitai (when on), Both | |
| Sort | Most downloaded (default), Top rated, Newest | Civitai `Most Downloaded`, `Highest Rated`, `Newest`; Hugging Face `downloads`, `likes`, `createdAt`. Across sources the order is exact only within a source's page; the merged page is ordered by the chosen key, and the page says so under Details of the dialog rather than promising a global order |
| Paging | Previous, numbered, Next | Cursor paging as Loki Doki (`cursorsRef`, 99 to 112): the client keeps the cursor of each visited page; at most 1,000 results (5.2) |
| Licence | Once per admin: the plain licence notice before the first install, then a licence badge on each tile (open, non-commercial, custom, unknown) | Ported from the `Model licenses` dialog (`LoraManager.tsx` 327 to 336), recorded on the record as `licence.acknowledged_by` |

**One-line reasons.** Every tile carries one fixed-template line built from fields, never written by a model: "Made for LTX 2.5, 412 MB, open licence, 8,300 downloads". A tile that cannot be installed says why in the same slot: "Made for Wan. This household's videos use LTX", "Already installed as Clay look" (locked hits say nothing), "Asks you to accept terms on Hugging Face first", "File is over 4 GB". The Install button is disabled only with such a line, never silently.

### 15.4 Duplicates

1. **In results.** A hit's identity is `(site, remote_id, version_id)`; repeated entries collapse. Across sources the only identity is the file's **sha256** when both sources publish it (Hugging Face `?blobs=true` LFS hash, fetched lazily and cached per shown repo; Civitai `files[].hashes.SHA256`). Names are never used as identity. When two hits share a sha256 the preferred source is kept: **Hugging Face first** (no key, stable hash, and the official Lightricks files), then Civitai. The kept tile lists the other source as "Also on Civitai". This replaces Loki Doki's first-wins merge, whose order was Civitai before its mirror (`adminImageLoras.ts` 473 to 475, 705 to 712 `byVersion`).
2. **At install.** Home checks before calling the Stack: a live record with the same `source.site` and `version_id`, or the same `sha256_expected`, makes Install say, in plain words, "You already have this as <name>." with **Open it** (router state, never a URL id). For a locked record the line is "You already have this style." and **Open it** goes to the card behind the lock. A same version id with a **different** hash (the source replaced the file): "The source changed this file since you installed it." with **Install as a separate style** needing an explicit click. After the download the Stack's existing `duplicate_lora` (same sha256) is the second check and answers the existing record, so Home never stores two live records with one sha256 (the spec rule).

### 15.5 Install robustness, ported (to the Stack job, VIDEO-LORA-06)

From Loki Doki `adminImageLoras.ts` `POST /civitai-import` (802 to 1100), each item built or fixed in the Stack job:

| Piece | Loki Doki | In `video.lora.install` |
|---|---|---|
| `.part` file, rename on completion | yes | yes; `.part` names are `lora-install-<job>.part`, removed on failure and swept at startup |
| `Range` resume | yes | yes; a restart or a dropped link resumes from the `.part` length when the server answers 206 with a matching `Content-Range`; otherwise it restarts from zero |
| Auth only for its host, stripped on a cross-origin redirect | yes (Civitai host) | yes: the Bearer header goes only to the token's own host, and every redirect hop is re-checked against the allow list; a hop to another host drops the header |
| Safetensors header check (`validateSafetensorsFile`, 1029 to 1040) | yes | yes, before the file is accepted; an HTML error page or pickle is refused |
| Hash | none | sha256 on receipt, compared with the source's hash when it gave one, recorded |
| Size cap | none | 4 GB, checked from `Content-Length` before and from bytes received during |
| Host allow list, HTTPS only | no | yes (design 5.3) |
| Progress | private SSE stream | the Stack job list (RULES S6), named "Downloading a style" |
| 5-minute search cache | yes | stays in Home `lib/loras/source.ts`, not in the Stack |

### 15.6 Ported from Loki Doki, one table

| Loki Doki (read only, under `loki-doki/`) | Port |
|---|---|
| `frontend/src/components/admin/LoraManager.tsx`: search with debounce, sort, cursor paging, licence dialog, Adult on or off | Kept as 15.3, with the Adult switch only after an unlock and a lock tile in place of blur |
| `backend/src/routes/adminImageLoras.ts` search (460 to 588) | Civitai through the documented REST API only (the Meilisearch key is dropped, table 2.1); dedupe and source order as 15.4 |
| same, 641 to 742 search cache and merge | 5-minute cache kept, in memory; merge by sort key kept |
| same, `civitai-import` 802 to 1100 | 15.5 |
| `backend/src/lib/adultDetection.ts` | Not ported: it is a word list. Replaced by 15.1 |
| `backend/src/lib/loraTokens.ts` | Already kept at import (table 2.1) |

### 15.7 What this changes in the earlier sections

| Where | Change |
|---|---|
| Decision D4 and 5.3 step 1 | "Adults only?" is pre-set from `adult_check`: normal gives No, adult and unknown give Yes; the Hugging Face `not-for-all-audiences` tag raises to adult |
| 4.1 `audience` row | Unchanged; `adult_check` (15.2) sits beside it |
| 5.2 "results with `nsfwLevel` above 1 come back as locked" | Replaced by the exact rule of 15.1 (level 2 is `unknown`, level 4 or more is `adult`, both locked) |
| settings-media 6, `POST /api/loras/browse` body | Gains `kind`, `base` and `installed`; the `adult` flag is unchanged |
| settings-media 5.2, the paragraph on locked results and the sort list | Read with 15.1 and 15.3 |
| 11, test 13 | Adds: a duplicate by version id and by sha256, a changed-file same-version case, a cross-origin redirect that strips the token, a resume from a `.part` file |
| New test 14 | Adult check table: every row of 15.1 for Civitai (flag only, level only, tag safe but preview adult, all safe, no previews, level 2, malformed), Hugging Face with and without the tag, a locked hit carries no field in the response, no thumbnail request is made for it, a lowering from adult without a fresh ticket is refused |

### 15.8 Slices

| Id | Size, repo | Slice |
|---|---|---|
| VIDEO-LORA-02b | S, commons | Add the optional `adult_check` to the `Lora` spec, `validateLora` rule, fixtures, tag (done in this revision's work) |
| VIDEO-LORA-DOC-01 | S, `.github` | Unchanged; it also states the sent fields and that nothing about the household is sent; it lists the lazy Hugging Face `?blobs=true` hash calls in the request budget |
| VIDEO-LORA-06 | M, Stack | Unchanged scope plus 15.5; no `adult_check` in the Stack (it never decides access) |
| VIDEO-LORA-07 | M, Home | Adds the three-state classifier, the dedupe, the filters and the `adult_check` write (15.1, 15.3, 15.4); test 14 |
| VIDEO-LORA-08 | M, Home | Adds the filter row, reason lines, locked tiles, the duplicate "Open it" link and the lowering confirmation |
