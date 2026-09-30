# Status page: internet reliability and the outside services Home needs

Design note, 2026-09-30, on Jesse's request ("backlog adding internet reliability and required services (ex. YouTube) as items"). Extends [`status-page-2026-09-30.md`](status-page-2026-09-30.md): same recorded history, same daily bars, same banner and incident card. Two new kinds of "part" on the status page, next to Brain, Memory, Voice and Home.

## Relationship to the existing status-page plan

This note extends the existing design without changing it. Its app-first view, app menu dots, and internet/service parts are additions to the original component-first status page; the original plan remains the source for the header indicator, status notes, maintenance windows, and history foundations. The app menu dot is an app health indicator, not the sidebar-wide status dot that the existing plan explicitly leaves out. Work on this extension follows the original spec-first rule: shared shapes and fixtures land in `commons/spec` before Home pins a tag and consumes them.

## Decisions

0. **The page leads with what people use, not with what runs.** Everyone sees "Chat", "Videos", "Music", "Podcasts" (one row per installed app that matters to the household), not Brain, Memory or Voice. Each app's manifest declares what it needs (`needs`: engine roles such as chat model, voice; outside services such as YouTube; the internet), each marked required or optional. An app's state is derived from the recorded state of its needs, never stored or probed separately: any required need down means the app is down, an optional one down means degraded, the internet down means "waiting for the internet". Its 90-day bar and uptime percentage come from the same history rows (the union of the intervals where a required need was down), so no new recording exists for apps. The raw parts (Brain, Memory, Voice, Home, Internet, each service) move into an admin-only "Behind the scenes" section under the apps, which is also where the Stop, Start and Restart controls live. Non-admins get a plain sentence on a broken app ("Videos aren't working: YouTube isn't reachable.") and no engine names. The top banner is computed from apps first, then from household-wide parts (Home, Internet).

1. **Internet is a part.** "Internet" answers one question for a family: is the house online, or is it the outside world that is broken. It is recorded like any part (operational, degraded, down) into `status_events`, shown with a 90-day bar and uptime percentage, and when it is down the banner reads "Your internet is down" and the parts that need it say "waiting for the internet" instead of "down" (so an outage is not blamed on MaiPai).
2. **Required services are parts too, one per outside service an installed package needs** (YouTube, a weather service, Telegram, the Catalog). A package's manifest declares the outside services it depends on (id, display name, what it is for, required or optional); the status page lists only services that at least one installed package declares. A service nobody installed is not shown and is never contacted.
3. **Health comes from real use first, not from probes.** The third-party-services rules (`THIRD-PARTY-SERVICES.md`, "we are the user") exist because extra background traffic got the house walled by YouTube on 2026-08-28. So a service's state is derived from the outcomes of the requests the app already makes at each service's single rate-limited choke point: a run of successes is operational, timeouts or 5xx are degraded or down, a 429, a captcha or a sign-in wall is "limited" (shown as degraded with the plain reason "YouTube is limiting this house for a while", and the existing back-off applies). No new request is ever sent to a service only to check on it. When there has been no traffic for a while the bar shows "no recent use", not green.
4. **The one active probe is for the internet itself**, because with no traffic there is nothing to learn from. Once a minute, a DNS lookup of a neutral name and a TCP connect with no payload to a large public address; both endpoints are a household setting (default on, can be switched off, can be pointed at the household's own choice), and the probe is listed in the privacy page table ("when: every minute; what: a name lookup and an empty connection; who: the public resolver; setting: Household, General"). Internet state also takes hints from service failures (three different services timing out together means "internet", not three services).
5. **Admins can see the cause, others see the plain words.** Non-admins read "YouTube isn't reachable right now." Admins additionally see last success time, last error class and the counts behind the bar.
6. **Notifications reuse the existing path**: an internet outage is a `repairs.new` level `passive` (the family already knows their internet is out; it is a status and a history, not a page), a required service outage that blocks an installed package is `time_sensitive` for admins with the same debounce and reminder rules as the chat engine.

## Shared shapes (spec first)

The status component vocabulary (`StatusComponent`, currently spec-v0.1.62) gains `internet` and a `service:<id>` form; the package manifest gains an optional `needs` list (`kind`: engine | service | internet, `id`, `name`, `purpose`, `required`). Both go through `commons/spec` with fixtures, then the hub, then the robot.

## Slices

| Slice | What | Size |
|---|---|---|
| SVC-01 | Spec: manifest `needs` list, `internet` and `service:<id>` status components, fixtures, tag. | S |
| SVC-02 | Hub: the internet probe (setting, privacy row), recorded into `status_events`, shown as a part with bar and banner wording; "waiting for the internet" on dependent parts. | M |
| SVC-03 | Hub: outcome recorder at each service's rate-limited choke point (the YouTube one first), derive state, limited/back-off reasons, "no recent use", listed on the status page from installed packages' declarations. Inventory every service choke point in the report. | M |
| SVC-05 | Status page by app: derive each installed app's state, bar and percentage from its `needs`; the apps section first, the raw parts and controls under an admin-only "Behind the scenes"; plain-sentence cause for non-admins. Needs SVC-01 and a manifest `needs` entry on the bundled chat, videos, music and podcasts apps. | M |
| SVC-06 | A status dot on each app's menu item: nothing when the app is fine, an amber dot when degraded or "waiting for the internet", a red dot when down, using the sidebar's shipped menu badge slot (`SidebarMenuBadge`) so the vendored layout is not edited; the dot has a screen-reader label ("Chat: not working") and a tooltip with the same plain sentence as the status page; it reads the derived app state from SVC-05, and the chat item can ship first from the existing chat availability rule. Clicking still opens the app, whose own page carries the banner. | S |
| SVC-04 | Notifications for blocked packages and the admin detail view; privacy page rows. | S |

## Out of scope

Speed tests, per-device internet, off-LAN monitoring, anything that contacts a service no installed package uses.
