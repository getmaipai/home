# Browser notifications: what works on a LAN, and what does not

Design note, 2026-09-30, for ENGINE-AVAIL-06. Decided by the coordinator on Jesse's standing
instruction to finish the open engine-availability items. The privacy fact in the next section changes
what the item can promise, so it is stated first.

## The finding

`.github/docs/NOTIFICATIONS.md` ("Channels, all inside the house") says browser push goes "through the
hub's own push endpoint on the LAN". That is not possible. The Web Push standard delivers a message from
the hub to a push service run by the browser's maker (Google for Chrome and Android, Apple for Safari,
Mozilla for Firefox), and that service wakes the browser. The hub cannot push to a closed browser directly.
The payload is encrypted end to end, but the fact that this household's device got a message at a given
moment leaves the house. The same page's last rule already covers it: a channel that needs a third-party
relay off the LAN is off by default and listed on the privacy page.

Web Push also needs a secure context: `https://` or `localhost`. The hub on a bare LAN address over
`http://` cannot register for push at all.

## Decisions

1. **Local notifications first (this item).** While the app is open in any tab or an installed PWA, even
   in the background, the shell turns an engine-problem notification into a system notification
   (`Notification` API through the existing service worker's `showNotification`). Nothing leaves the house,
   no keys, no relay. Per-person opt-in, asked for at a moment the person chooses (a switch in Me,
   Notifications), never on page load. It works on `localhost` and on any `https://` origin the household
   serves. It does not reach a closed browser, and the settings copy says so in plain words.
2. **Web Push through the browser maker's relay is a separate, off-by-default opt-in (ENGINE-AVAIL-06b).**
   It is built only if Jesse confirms, because it is the one place MaiPai would send a signal through a
   third party. If built: VAPID keys generated on first use and stored in the secrets store
   (`CREDENTIALS.md`), never in a repo; per-device subscriptions; the payload carries no text beyond a
   generic "MaiPai needs attention"; a row in the privacy page table ("when: an engine problem; what: an
   encrypted wake-up; who: the browser maker's push service; setting: Me, Notifications").
3. **NOTIFICATIONS.md is corrected** in the same commit as slice 06a: the browser-push sentence becomes
   "system notifications from the open app; browser-maker push only as an opt-in relay."

## Slices

| Slice | What | Size |
|---|---|---|
| 06a | Local system notifications for `time_sensitive` and above engine problems when the app is open: a Me > Notifications switch (declared once as a setting, rendered by the settings renderer), permission requested on switching it on, the shell subscribes to the existing notification event stream and calls the service worker's `showNotification` once per notification id (deduplicated, respects quiet hours by reading the same level rule the server applies), click opens `/status`. NOTIFICATIONS.md corrected. | M |
| 06b | Web Push relay opt-in (only on Jesse's word). | L |

## Out of scope

Go and TV overlays, email, SMS, ntfy.
