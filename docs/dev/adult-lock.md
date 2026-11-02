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

- Passkey unlock (`passkey_assertion`) is not built; `/unlock` takes the secret only.
- A clip that turns adult-only only at the finished-clip check (prompt word list, nude verdict) is locked from then on, but a tool part stored before that
  keeps its words. ADULT-LOCK-06 sets the lock at job start from every source and closes this.
- LoRA listings (VIDEO-LORA slices), pictures and songs (ADULT-LOCK-07), playback guards (ADULT-LOCK-05) and the frontend `AdultLockProvider` (ADULT-LOCK-03b) are their own rows.
- Pin: `lock` and `made_audience` become spec fields with VIDEO-LORA-02; bump the `@maipai/spec` pin with `scripts/pin.sh` then and read them from the record.

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
