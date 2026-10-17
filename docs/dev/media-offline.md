# Media offline (MEDIA-OFFLINE-01)

A paired device keeps a media item for use when the hub is out of reach. Everything is default-deny.

## Scope and admission

- `devices.offline_scope` is a JSON array, `[]` by default. Known values: `media.offline`, `offline.records`. Unknown or corrupt
  data grants nothing (`parseOfflineScope` in `lib/devices.ts`).
- `requireDeviceScope(scope)` in `middleware/auth.ts` is the only place a device bearer token is accepted, and only on the routes
  that name it. A browser session is accepted too; a session redeemed from a device is held to that device's scope.
- `resolveDeviceToken` (`lib/deviceTokens.ts`) re-checks on every call: token row, expiry, 180 days unused, device still owned
  by the token's person, person enabled and not deleted. A removed device or person gives 403.
- A token not used for 180 days is revoked and its row deleted. The rule lives in `resolveDeviceToken` (`lib/deviceTokens.ts`), which `requireDeviceScope` and `redeemDeviceToken` both call, so it is checked on every request, using `last_seen_at` (or `created_at` before first use); `requireDeviceScope` refreshes `last_seen_at` on each admitted request. It is tested in `backend/tests/mediaOffline.test.ts` ("revocation, expiry, inactivity...", which sets `last_seen_at` 181 days back and expects 403 on all four routes).
- Changing a password deletes the person's device tokens and device sessions.
- `PATCH /api/devices/:id/offline-scope` sets the scope. It needs a browser sign-in (a paired device cannot grant itself),
  and is for the device's owner or an admin.
- Backups: `snapshotWorker.ts` empties `device_tokens` in the snapshot copy and vacuums it, so tokens are not in a backup. After
  a restore a device pairs again.

## Household device-token rule

Every device token, of any kind (a TV included), is revoked after 180 days unused and the device pairs again. Redeeming a token
now also refuses a disabled, deleted or memorialized person and a device that no longer belongs to the token's person. The
rule is in `resolveDeviceToken` and is not specific to media.

## Who may keep media

- A robot, TV or pod never holds `media.offline` (a shared surface would read one person's library for the room). The PATCH
  route answers 400, the middleware refuses even a forced row, and Settings, Devices shows no switch on them.
- A child's or teen's keep permission is guardian-only: an owner or admin sets it per device. A minor cannot PATCH their own
  device, and a minor's plain browser session (no device) cannot keep media at all (`guardian_grant_required`).
- `last_seen_at` is written at most once a minute per token. Subtitles are served only for caption types, always as `text/vtt`
  with `Content-Security-Policy: sandbox`. An `If-Range` date must equal `Last-Modified` to the second.

## Routes (`/api/media/offline`)

- `GET /manifest?id=` an `OfflineManifest` (spec) with hub paths only, fingerprint, ready, playable, reason, chapters,
  subtitles and my progress.
- `GET /file/:kind/:id` bytes with Range, `ETag` (the fingerprint), `Last-Modified`, `If-Range`, `Cache-Control: private, no-store`.
  `playable: none` is 409; `transcode` or `unknown` is 503 with `Retry-After: 60`. Artwork and subtitle use `kind` of `artwork`
  or `subtitle`. Bytes come from `serveItemBytes`, the one byte server.
- `POST /status` up to 500 `{kind, id, fingerprint}`; answers `ok`, `changed` or `gone` (unreadable and trashed look the same).
- `POST /progress` up to 200 events. Each `at` is corrected by (server now minus `sent_at`), clamped to now; a batch more than
  5 minutes ahead is `400 {error: "restamp"}` before anything is written. Each event goes through `writeProgress`; the device id
  comes from the token, never the body, so a minor's row protection holds.
- Every item read goes through `readableItem` (band, `visible_to`, trash).

## Browser

Copies are per person: the bucket is `maipai-media-v1:<personId>` and the page tells the worker which one is active by message
(`setMediaOwner`, called from `App.tsx`; stored in the `maipai-media-owner` cache so a restarted worker knows). Signed out or
expired, nothing is announced and the worker serves no copy; another person signing in gets only their own bucket. At app start
and when the browser is online again `reconcileKept()` posts `/status` and deletes copies the hub reports gone or changed.

`frontend/src/sw.ts` has no fetch handler on Firefox or WebKit. On Chromium one cache-first route serves
`/api/media/offline/file/*` from the `maipai-media-v1` bucket (Range is sliced from the full copy; `?download=1` bypasses it).
`frontend/src/lib/offlineMedia.ts` has `keepOnDevice`, `removeFromDevice`, `listKept`. WebKit gets `useGo`. An explicit sign-out (`/api/auth/logout`)
or a 403 with code `device_revoked` (the device was removed or its token is gone) removes every copy in the browser. An expired
session (401) and a missing scope (`offline_scope_missing`) never do: the person signs in again and the copies are still there.
Tested in `frontend/src/lib/offlineWipe.test.ts`.

## Open

"Remove all devices" (one revoke-everything action; today only a password change revokes all device tokens).
Transcode-on-save (needs the Stack's `media.transcode`), News, reference and conversation providers (see [Keep a record](media-library.md#keep-a-record-on-this-device-keep-offline-01)).


## Generic records

KEEP-OFFLINE-01 adds `/api/offline/manifest?kind=&id=` and `/api/offline/file/:kind/:entry` with the separate `offline.records`
scope, backed by the same media provider and browser bucket. The media URLs and `media.offline` scope still work for Go.
Settings, Devices grants both scopes with "Can keep copies on this device". The guardian and shared-device rules above apply
to both scopes. See [the provider contract and open kinds](media-library.md#keep-a-record-on-this-device-keep-offline-01).
