# Home third-party request budgets

The org's [third-party service rules](https://github.com/getmaipai/.github/blob/main/docs/THIRD-PARTY-SERVICES.md) apply to every connection. This file records Home's named exception and its budget.

## Owner's written exception of 2026-09-24: NEWS-07

The [News design, section 8](design/news-app-2026-10-17.md) records the owner's exception for background full text. `news.full_text_prefetch` is a household switch, off by default. It permits the existing reader to fetch items on a person's explicitly followed channels or in their Today top set. It permits no background pictures, related-page expansion, redirect follow-ups or Archive requests.

| Backlog row | Request | Lifetime limit | Pace | Site limit | Stop rule |
|---|---|---|---|---|---|
| NEWS-07 | A story page, through the shared reader and fetch cache | One background attempt per canonical item URL ever, including failure | At most one every 30 seconds across the household | 150 per site in any rolling 24 hours | Respect robots; the first refusal, error or unusable page pauses this class of traffic |

The scheduler offers one idle attempt each minute, below the allowed pace. It uses the shelf poller's idle window and the shared limiter. Receipts and quiet state live beside shelf content in `knowledge.db`, survive item pruning and process restarts, and contain no person id. Clearing that database also clears these receipts. Cache hits spend a reservation, so the limits are conservative. Robots requests accompany a page attempt and do not count as article pages. A redirected robots file or page is left for a person's explicit open.

Quiet mode starts at one hour and doubles after each failed scheduled probe, up to 24 hours, matching the shelf poller's backoff shape. A probe is a different, never-attempted eligible item; the blocked item is never retried in the background. Only a successful article clears the failure count. Foreground reading stays available through its existing guards. A child's sources and sentence gates are checked again at release. No follow list, reading history, name, cookie or question is sent to a publisher.

The privacy table lists this traffic as `platform:news-full-text-prefetch` only while the setting and shelf are on. The setting help states the lifetime, pace and site limits.

## MEDIA-DETAIL-03: song lyrics lookup

The owner's exception of 2026-10-25 permits the Music app to look a single song up on lrclib.net. `music.lyrics_online` is a household switch, on by default. It permits no lookups for a child or for a song made at home, and only when a person opens Lyrics on a song that has no words yet.

| Backlog row | Request | Lifetime limit | Pace | Site limit | Stop rule |
|---|---|---|---|---|---|
| MEDIA-DETAIL-03 | A song lookup on lrclib.net | One per song ever, hit or miss | One a second across the household | None beyond the pace | A refusal pauses lookups one hour, doubling to 24 hours; an answer clears it |

The privacy table lists this traffic as `platform:music-lyrics-lookup` only while the setting is on.
