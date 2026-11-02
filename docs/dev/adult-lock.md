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
- The Stack's job list and progress (ADULT-LOCK-04), LoRA listings (VIDEO-LORA slices), pictures and songs (ADULT-LOCK-07), playback guards (ADULT-LOCK-05) and the frontend `AdultLockProvider` (ADULT-LOCK-03b) are their own rows.
- Pin: `lock` and `made_audience` become spec fields with VIDEO-LORA-02; bump the `@maipai/spec` pin with `scripts/pin.sh` then and read them from the record.
