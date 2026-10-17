# Media offline (MEDIA-OFFLINE-01)

A paired device keeps a media item for use when the hub is out of reach. Everything is default-deny.

## Scope and admission

- `devices.offline_scope` is a JSON array, `[]` by default. Known values: `media.offline`, `offline.records`. Unknown or corrupt
  data grants nothing (`parseOfflineScope` in `lib/devices.ts`).
- `requireDeviceScope(scope)` in `middleware/auth.ts` is the only place a device bearer token is accepted, and only on the routes
  that name it. A browser session is accepted too; a session redeemed from a device is held to that device's scope.
- `resolveDeviceToken` (`lib/deviceTokens.ts`) re-checks on every call: token row, expiry, 180 days unused, device still owned
  by the token's person, person enabled and not deleted. A removed device or person gives 403.
- Changing a password deletes the person's device tokens and device sessions.
- `PATCH /api/devices/:id/offline-scope` sets the scope. It needs a browser sign-in (a paired device cannot grant itself),
  and is for the device's owner or an admin.
- Backups: `snapshotWorker.ts` empties `device_tokens` in the snapshot copy and vacuums it, so tokens are not in a backup. After
  a restore a device pairs again.

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

`frontend/src/sw.ts` has no fetch handler on Firefox or WebKit. On Chromium one cache-first route serves
`/api/media/offline/file/*` from the `maipai-media-v1` bucket (Range is sliced from the full copy; `?download=1` bypasses it).
`frontend/src/lib/offlineMedia.ts` has `keepOnDevice`, `removeFromDevice`, `listKept`. WebKit gets `useGo`. A sign-in, sign-out
or any 401 removes every copy in the browser (a shared browser must not keep the last person's files).

## Open

Transcode-on-save (needs the Stack's `media.transcode`), generic manifests (KEEP-OFFLINE-01), `offline.records` routes.
