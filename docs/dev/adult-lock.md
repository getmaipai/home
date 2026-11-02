# The Adult lock (backend)

Built 2026-11-02 for ADULT-LOCK-02. The design is [video-loras-2026-11-02.md](../design/video-loras-2026-11-02.md) section 3. This is not the
parent's "adult unlock" in the org SAFETY.md (a parent opening a child's feature); it keeps an adult's own adult-only items from a casual glance.

## The pieces

| Piece | File | What it does |
|---|---|---|
| Shared secret check | `backend/src/lib/secretCheck.ts` | `verifyAgainstRecord`: lockout check, `verifySecret`, failure bookkeeping, IP throttle. Sign-in (`/verify-secret`), `/change-secret` and the unlock routes all call it. |
| Lockout purpose | `backend/src/lib/credentialLockout.ts` | `purpose` is `"signin"` or `"adult_unlock"`. Each has its own count and lockout on the one schedule (5 wrong codes, then 30 s, 2 min, 10 min, 1 h), stored in `person_credentials.adult_failed_attempts` and `adult_locked_until` (migration 0159). The IP throttle is shared. |
| Proof, state, redaction | `backend/src/lib/adultLock.ts` | `issueProof`, `lockState(item, actor, proof)`, `lockedView(making)`, `lockedFilterSql`, `adultLockContext`. |
| Video jobs | `backend/src/lib/videos/lock.ts` | Which item a job is, the tile for it, the stored-tool-part redaction, the Create lists' one tile. |
| Routes | `backend/src/routes/adultLock.ts` | `POST /api/adult-lock/unlock`, `/lock`, `/confirm`. |

## The proof

An opaque random token in the hub's memory (a map, never the database, gone on restart), bound to the person and the browser session (a hash of the
session cookie). Sliding 2 minutes idle, absolute 15 minutes (`PROOF_IDLE_MS`, `PROOF_ABSOLUTE_MS`). The page sends it as `X-Adult-Unlock`.
`adultLockContext` (mounted on `/api/*` in `app.ts`) reads the header and the cookie into an `AsyncLocalStorage`, so a producer deep in a query asks
`requestProof()` or `unlockedFor(actor)` and no function grows a parameter. With no request (a background job, a test without the middleware) there is
no proof, which is the locked answer. Tests use `__unlockedForTests` or `__unlockRestOfTest`.

It ends on: Lock now (`POST /api/adult-lock/lock`), sign-out and any session ending (`invalidateSessionCache`), a changed secret, role change or disabled
profile (`invalidateSessionCacheForPerson`), idle and absolute expiry. A paired device's session, a bearer token or an API key has no session key and can
never hold a proof; a minor, a guest-less shared screen and a spoken turn get 403 "Unlock on your own screen". `/unlock` takes no item id.

## The decision

`lockState(item, actor, proof)` returns `open`, `locked` or `hidden`:

- not adult-only (or a writer the lock does not cover yet): `open`
- viewer is a minor: `hidden` (the minor ceiling, never unlockable)
- the creator cleared the lock (`lock: "off"` in the provenance note): `open`
- otherwise `open` with a valid proof for this person and session, else `locked`

Until the spec carries the fields (VIDEO-LORA-02, ADULT-LOCK-06) both are read from the provenance note: `made_audience` falls back to `audience`, and
`lock` defaults to on for an adult-only item. `LOCKED_WRITERS` lists the covered writers (`video-gen`, `video-edit`, `video-poster`); pictures and songs
join it in ADULT-LOCK-07.

## Where it is applied

| Surface | Choke point | Locked answer |
|---|---|---|
| Library list, summary, search, made-at-home shelves, header search, media home | `lib/library.ts` `base()` via `lockedFilterSql` | item and its poster omitted, counts exclude it |
| Trash list, count, bytes, trash thumbnail | `lib/libraryTrash.ts`, `lib/fileThumbnails.ts` | omitted |
| `/api/files` list, record, content, thumb, shares; chat attachments | `getAttachment`, `readAttachmentForConversation`, `listFilesVisibleToActor`, `fileThumbnail` | 404 (same as missing) |
| Share create and delete, share notice | `lib/shares.ts` | 404; the notice names no kind |
| Video job card, cancel, another, make, animate | `routes/videos.ts` `videoCardOrLocked` | `{ locked: true, making }`; another and Max answer 423 |
| Preview, clip, poster, messages copy | `routes/videos.ts` | 404 with `cache-control: private, no-store`; copy and file name generic after an unlock |
| Create feed, `job`, `clips` scopes | `lib/videos/feed.ts`, `lib/media/videoCreateApp.ts` | one leading tile for any number of locked items |
| Media-app actions (another, max, cancel, favorite) | `routes/mediaApps.ts` | 423 or 404 |
| Companion activity and counts | `routes/companions.ts` | locked jobs left out |
| Chat tool part | `lib/turnMachine/nodes/tool.ts`, `redactLockedVideoOutcome` | placeholder, no prompt, styles or ids; an adult-only style without a proof starts nothing |

A clip made with an adult-only style is marked `request.adultOnly` at job start (`startVideoJob`), so a running clip is already a tile.

## Known gaps (follow-ups)

- (Closed 2026-11-02, see "Verification") the history list's `video.id`, trash, the `/api/videos` cancel, the artwork picker, an unresolvable style at job start, parallel unlock guesses and `/confirm` counting.
- Still open, found in review and judged out of this slice: (a) a failed or cancelled job made before this change from an adult-only source carries no `request.adultOnly` and no clip, so its prompt shows; no adult-only style could be chosen before VIDEO-LORA ships, so only the continue-from-adult-clip path is affected; (b) background callers (retention, export, a worker outside a request) have no proof and so see a locked file as missing, by design; (c) `videoRowIsLocked` re-reads per job in the companion loops (an N+1, small lists); (d) the SQL filter (`lockedFilterSql`) and the JS decision (`lockItemOfProvenance`) state the rule twice; (e) the unlock failures and sign-in failures share the per-IP throttle on purpose (a stranger guessing at an open page can slow that address's sign-in, never the person's own profile counter).
- Passkey unlock (`passkey_assertion`) is not built; `/unlock` takes the secret only.
- A clip that turns adult-only only at the finished-clip check (prompt word list, nude verdict) is locked from then on, but a tool part stored before that
  keeps its words. ADULT-LOCK-06 sets the lock at job start from every source and closes this.
- The Stack's job list and progress (ADULT-LOCK-04), LoRA listings (VIDEO-LORA slices) and pictures and songs (ADULT-LOCK-07) are their own rows.
- The kit's unlock dialog takes a digit passcode. A person whose sign-in secret is a password (no digit count) sees "Set a passcode in Account to open these" until they set a digit passcode.
- A flag that flips on while an item plays is caught only when the page reads the item again as an `adult_only` row it had seen open (the poll the page already makes); a person who never unlocked gets the tile, which has no id to match.
- `lock` and `made_audience` are spec fields since spec-v0.1.309 (pinned with ADULT-LOCK-03b); the backend still reads them from the provenance note until ADULT-LOCK-06 moves it to the record.

## The Stack's full view (ADULT-LOCK-03)

Built 2026-11-02. Since Stack `cbd93b3` (ADULT-LOCK-04) the Stack reports a job made with `audience: "adult"` as state and progress only, and answers 404 for
its preview, clip, poster, messages copy, picture and thumbnail, to every caller that does not ask for the full view. Home asks for it, and only Home can.

**What Home sends.** `x-maipai-view: full` and `x-maipai-home-token: <key>` on a read of an adult job, nothing else and nowhere else. A full-view ask with a
wrong or missing key gets 403 `full_view_forbidden` on every route of the Stack, adult job or not, so Home never sends the headers it does not need.

| Piece | File | What it does |
|---|---|---|
| The grant | `backend/src/lib/stack/fullView.ts` | `fullViewForJob(audience, owner, basis)` returns a `FullView` or `undefined`. `undefined` unless the job's audience is `adult` and the owner is an adult. `basis` is `"background"` (Home reading its own job: progress, the finished-clip check, settle; Home is the Stack's trusted caller) or `{ proof, surface }` (a person present: needs their own live proof, a human browser session and `surface: "own"`, never `"shared"` or `"spoken"`; `lockState` must say open). |
| The call | same file, `sendWithView` | Adds the two headers only when it is handed a grant. On a 403 `full_view_forbidden` it forgets the cached key, reads it again and asks once more; a second refusal, or no key at all, throws `StackViewError`, which the video and picture modules turn into a `StackVideoError` or `StackPicturesError` with one plain line and no key in it. |
| The key | `backend/src/lib/stack/homeViewToken.ts` | Where the key comes from, the one cached copy, the Repairs row. Never logged, never in an error, never returned from a route, never sent to a browser. |
| Video and picture client | `lib/videos/stack.ts`, `lib/pictures/stack.ts` | `getVideoJob`, `fetchVideoPreview`, `fetchClip`, `fetchPoster`, `getGenerationJob`, `fetchPicturePreview`, `fetchPicture` take an optional `view`. |
| Callers | `lib/videos/jobs.ts` (`watch`, `finish`), `lib/pictures/jobs.ts` (`watch`, `finish`) | Each builds the grant from the job's own `request.audience` and the owner. |

**Which calls carry the headers.** Only the reads of an adult job: status, preview, clip, poster, picture. Not the submit (the maker's own call, answered as before), not
the DELETE of the Stack's copy (its reply is unused), not the stateless `POST /v1/videos/messages` (Home sends its own bytes; no job), not `media.edit` (Home's edit jobs
carry no `audience`, the Stack does not redact them, and Home reads the result by path), not the companion takes and looks (`all-ages`). A picture **edit** is not sent as
adult to the Stack today (its form has no `audience`), so Home reads it the plain way; ADULT-LOCK-07 decides that with the picture lock. Home's routes serve Home's own stored copy of a
clip, so no person-facing route reads the Stack at request time; what a background read fetches reaches a response only through the lock above (the tile, the 404, the proof).

**The key.** First match wins:

1. `STACK_HOME_VIEW_TOKEN` in Home's environment (at least 16 characters): the value the Stack's unit was given.
2. The Stack is on another computer (`engines.stack.where` = another computer): the key an admin stored with `PUT /api/engine-link/view-token` (owner or admin; `DELETE` forgets it).
   It is encrypted at rest in `data/keys/stack-link/home-view-token.enc` with the same key store as the pairing passphrase and is never shown again. **The pairing has no channel for a
   secret the engine computer made** (it carries Home's SSH key and the engine's public host key), so this is the one thing an admin copies across, from `keys/home-view-token` in the
   engine computer's data folder. There is no screen for it yet (a follow-up); until it is stored, Repairs shows "Adult items cannot be opened until Home has the engine's key" and a clip being made keeps waiting.
3. The Stack is on this computer: `<Stack data folder>/keys/home-view-token` (`stackDataDir()` in `lib/localStackService.ts`: `MAIPAI_STACK_DATA_DIR`, else `<install root>/stack/data`).
   The Stack makes the file at first use, and only when a full-view ask presents some token, so a Home that finds no file asks once (at most every 30 s) with a placeholder on
   `GET /stack/v1/health` (403, and the Stack writes its key) and reads the file again. `/healthz` is not used: it answers before the Stack's check. The file is mode 600 and
   owned by the user that runs the Stack; a Home that cannot read it (a Stack run as another user) reads it as missing, so use rule 1 or 2 there.

**When the key is missing, wrong or rotated.** A refused key is forgotten and read again once per call, so a rotated key in the file heals itself. A key Home still cannot use raises one Repairs row
(`stack` / `adult.view_key`, fixed words, no host, path or key) and the clip or picture keeps asking every poll until the key works or the watch deadline passes; the row closes at the next
successful full-view read. A failure at the very end (the clip is done, the key goes bad before Home fetches it) fails the clip with the plain line and the Stack's copy goes; the window is a few milliseconds.

**What to pin, in order.** Home must not pin a Stack at or after `cbd93b3` before this change is on `main`: without the headers every adult job there reads as `done` with no clip. Land this change first,
prove it against the real Stack, then `bash scripts/pin.sh stack <sha>` as its own commit. A Stack older than `cbd93b3` ignores the headers (no redaction, no check of the key), so this change is safe on it.

**Tests.** `backend/tests/adultFullView.test.ts` runs Home's real job code against a Stack that enforces the Stack's rules (`tests/fixtures/adultStack.ts`: redacted by default, 404 on files, 403 on a bad key
on every route): an adult clip and picture finish, Home's own lock answers the tile and 404 before an unlock, a job that is not adult, a minor and a shared or spoken surface never send the headers, a
missing, wrong, rotated, environment and remote-stored key. `tests/preload.ts` gives every other test a default key so an adult job in an unrelated test never waits on one.

## Frontend (ADULT-LOCK-03b and -05)

The kit draws every lock tile, the dialog and the live region (`AdultLockProvider`, `LockTile`, `AdultLockDialog`, ui-v0.5.477). Home writes no lock UI
(RULES 9b); it supplies the check and the clocks.

| Piece | File | What it does |
|---|---|---|
| Host | `frontend/src/shell/AdultLockHost.tsx` | Mounted in `RoutesInner` inside `MediaHostProvider`. `unlock(passcode)` calls `POST /api/adult-lock/unlock` and maps 200, 401 (with `attemptsLeft`) and 429 (`retryAfter`) to the kit's ok, failed and locked_out. `onRelock` sends `POST /api/adult-lock/lock` with the proof being dropped. Credential word is "passcode", digits from `pinDigits`. |
| Controller | same file, `LockController` | While unlocked: relock on route change, `visibilitychange` to hidden, `pagehide`, 2 minutes without activity (pointer, key, wheel, touch, a playing clip's `timeupdate`), the 15 minute cap, and Lock now (a button, bottom left). Also stops the host's element when a flag flips on. |
| Proof and blobs | `frontend/src/lib/adultLock.ts` | The proof is one module variable: never storage, a cookie, a URL or the query cache. `installAdultFetch` wraps `fetch` (the kit's schema interpreter has its own request function, so `fetch` is the one place both reach the network): every same-origin `/api/` call carries `X-Adult-Unlock`, and a page-data answer's `adult_only` rows get their picture and clip fetched with the header into Blob URLs. `revokeAdultBlobs` and `unloadAdultElements` run on relock. |
| Refetch | `AdultLockHost` | `queryClient.resetQueries()` on unlock and on relock, so every list asks again and nothing unlocked stays cached. |
| Sign-out | `request("/api/auth/logout")` in `lib/api.ts`, and the host unmounting | Drops the proof, tells the hub, revokes the blobs. |
| Media host rule | `frontend/src/shell/mediaHost.tsx` | `createMediaStore().elementFor` throws `ADULT_ONLY_PAGE_ONLY` for an item with `adultOnly` (`refuseAdultOnly` from the kit); `mediaFor` returns null for one; `MediaPlayerRegistration` takes `adultOnly` and registers nothing. So no mini bar, no dock, no audio session. |
| Playback guard | `frontend/src/shell/adultPlaybackGuard.ts` | While unlocked, an element whose source is one of our blob URLs gets `disablePictureInPicture`, `disableRemotePlayback`, `controlsList="nodownload noremoteplayback"`, `x-webkit-airplay="deny"` and no `loop`; while it plays, `navigator.mediaSession.metadata` reads null and ignores a set. |
| Rows | `lib/videos/feed.ts`, `lib/media/videoCreateApp.ts`, `lib/media/appHost.ts` | An open adult-only clip's row carries `adult_only: true` (feed, My clips, the watch item). The kit keeps such a row out of the host (`mediaFor`, the `play` action) and turns its Media Session off (ui-v0.5.480). The My clips All tab leads with the one tile. |
| No resume or history | `saveProgress` (`lib/media/appHost.ts`), `PUT /api/media/progress/:id` | Nothing is written for an adult-only file; the media route answers 404 as for a title that is not there. An unlocked item always restarts at 0. |
| Pages | `backend/packages/videos/pages/clips.json`, `create.json` | `locked_field` and `making_field` on the My clips All shelf; `fields.locked` and `fields.making` on the Create feed. Only these scopes emit the tile today; the Style picker and the settings Styles page get theirs with the VIDEO-LORA slices. |

Tests: `frontend/src/lib/adultLock.test.ts`, `frontend/src/shell/AdultLockHost.test.tsx` (note tests 2 to 4: one tile and no title while locked, the proof in no storage,
each relock cause), `adultPlaybackGuard.test.ts`, `mediaHostAdult.test.tsx`, `backend/tests/adultLockPlayback.test.ts`. Kit side: `commons/ui/src/schema/adultLockNodes.test.tsx`.

- The Stack's job list and progress (ADULT-LOCK-04), LoRA listings (VIDEO-LORA slices), pictures and songs (ADULT-LOCK-07), playback guards (ADULT-LOCK-05) and the frontend `AdultLockProvider` (ADULT-LOCK-03b) are their own rows.
- Pin: `lock` and `made_audience` become spec fields with VIDEO-LORA-02; bump the `@maipai/spec` pin with `scripts/pin.sh` then and read them from the record.

## Verification (2026-11-02, ADULT-LOCK-02 verify pass)

Review of commit 3dffe62c3 at medium, each finding checked against the code. Confirmed and fixed, each with a test in `backend/tests/adultLockHardening.test.ts` that fails without the fix:

| Finding | Fix |
|---|---|
| The chat history list (`GET /api/conversations/:id/turns`) returned a locked clip's job id in `video.id` | `videoJobIdsByTurnRedacted` (lib/videos/lock.ts): a locked clip's turn carries `video: { locked: true }`, the id comes back after an unlock. The live `done` event never carried it (the stored outcome is already a placeholder). |
| Parallel guesses all passed the lockout check before any failure was counted | one adult-unlock guess per person at a time in `verifyAgainstRecord`; a second answers 429 for a second. Sign-in is unchanged. |
| `POST /api/videos/jobs/:id/cancel` acted on a locked job and returned its state | 404 like the media-app cancel |
| `trashFile` moved a locked item to Trash by id | refuses with the missing-file 404 (the `DELETE /api/files/:id` route was already guarded by `getAttachment`) |
| A locked clip's poster could be set as a media item's artwork | `editMediaItem` refuses it |
| A style id the adapter list cannot resolve left the job unlocked at start | an unknown style counts as adult-only (fails closed) |
| `/confirm` wrong codes were not counted | counted like `/unlock` |

Surfaces audited with no gap (repo-wide grep of readers of `video_jobs` and `attachments`): notifications, push, search, media home, companion activity, Library, shares, Trash. Notifications have no video producer; the others are covered by `tests/adultLock.test.ts` and the new leak test for notifications, the companion list and media home.

Real HTTP proof on a dev hub (`bun run dev` in a worktree, port 8844, no Stack; a seeded adult-only clip "Zebraquill velvet cabaret dancer under violet lamps" and an all-ages clip owned by the demo owner Sage). As Sage with no proof: the job card is `{"locked":true,"making":false}`; clip, poster and `/api/files/:id/content` answer 404 with `cache-control: private, no-store` (the file record 404); Library search and header search for the title return no items and no groups; cancel and delete answer 404; the all-ages clip's card is normal. A wrong code gives 401 with `attemptsLeft: 4`. After `POST /api/adult-lock/unlock` with the demo secret: the card, clip bytes (200, no-store), file content, Library search and header search all return the clip, title included. After `POST /api/adult-lock/lock` with the same proof: the card is the tile again and clip and search are gone. As the demo teen and the demo child: every one of those routes answers 404 or empty, and `/unlock` answers 403 "Unlock on your own screen" (these two own no clips, so this shows the minor ceiling on routes, not a minor's own adult-only item; that case is the unit tests with a teen and child viewer).
