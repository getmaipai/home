# Live web video for everyone: access, age gates, budgets and rollout (2026-10-17)

Status: design proposal, no code, nothing contacted. Jesse, 2026-10-17, in chat: everyone in the household can browse live web
video the way YouTube works, not only saved copies. He also authored a hard rule the same day (RULES.md, "Live video services",
V1): no code, test, script, bench, agent or session sends a request to YouTube or any other live video service until the Loki
Doki history is reviewed, the research is done, a design is proposed to him and he approves it in the moment. This note is that
research and that proposal. The history is in [live-video-lessons-2026-10-17.md](live-video-lessons-2026-10-17.md) (lessons
L1 to L24, cited below by number). No request to any video service was made to write either note; every fact about a service
below comes from Loki Doki's code and commit history or from the service's published documentation as known on 2026-10-17, and
section 11 lists the facts to recheck on the approval day.

Companion records this note builds on and does not redesign: [media-apps-blend-2026-10-17.md](media-apps-blend-2026-10-17.md)
(the Videos app, saved copies, the Stack `media` service, kid hooks in section 11), the wall, budget and probe layer
SERVICE-WALL-01 ([packages-apps-and-integrations-2026-10-17.md](packages-apps-and-integrations-2026-10-17.md), section 4.3),
[kid-mode-app-voice-2026-10-17.md](kid-mode-app-voice-2026-10-17.md) (every child-facing word), and the org rules
`THIRD-PARTY-SERVICES.md` ("we are the user") and `PRIVACY.md`.

## 1. The decision in one paragraph

Live browsing uses the two front doors YouTube itself publishes, and nothing else. **Lists and facts** (search, a channel's
uploads, a video's title, length, rating and made-for-kids flag, the popular chart) come from the official **YouTube Data API
v3** with the household's own API key, called only by the Stack `media` service through the one SERVICE-WALL limiter and a daily
quota ledger. **Playback** is the official **IFrame player** in privacy-enhanced mode (`youtube-nocookie.com`), loaded only when a
person taps play, on that person's own device; bytes never pass through the hub. Thumbnails load on the person's device, lazily,
like any web page. No yt-dlp, no InnerTube scraping, no Invidious or Piped, no cookies, no stream proxy, no background fan-out:
those are what broke Loki Doki and walled the house (L1 to L9). A child sees only what an adult approved; a teen searches with
strict filtering and the teen floor on every title; an adult searches at moderate. An optional dedicated **family Google
account**, linked read-only by OAuth, brings the household's subscriptions and playlists in. When the quota runs out or the
service pushes back, the Videos app shows saved copies and the last cached shelves with one plain sentence; it never falls back
to another access method. Nothing is built or contacted until Jesse approves this note, and the first real request is its own
approval (section 10).

## 2. What the history says (the short form)

Full inventory with evidence in the lessons note. The five that decide this design:

1. **The house was walled by its own background traffic, not by people (L1, L2).** Discovery expansion, suggestion pools,
   warm-aheads, transcript fetches and a probe that ran five clients every 30 minutes far exceeded a person's pace; every player in
   the house went dark, and the probe itself kept the wall up for days. Design answer: foreground only, no warm-ahead, one probe
   per 6 hours carried by a person's own request (section 6).
2. **Every unofficial access path broke on its own schedule (L3 to L7).** yt-dlp needed version chasing and client switches
   after 403s, InnerTube changed its page shapes under the code, public Invidious and Piped instances returned half rows or went
   away, and each fix added a fallback chain that multiplied requests during an outage. Design answer: official API and official
   player only, and no fallback chain (section 3).
3. **The hub relaying video bytes is the expensive, risky part (L8, L9).** The privacy stream proxy, remux and HLS transcode cost
   CPU and power, stampeded on respawn, and made the hub the single loud client. Design answer: playback on the viewer's device by
   the official player (section 3.2); saved copies stay the blend note's separate, explicit path.
4. **Kid protection worked when it was an allowlist and leaked when it was a filter (L19 to L23).** Design answer: a child sees
   approved items only; filters are a teen and adult tool (section 4).
5. **A linked account is powerful and risky (L10 to L12).** Design answer: one dedicated family account, official OAuth,
   read-only by default, never cookies (section 5).

## 3. The access method

### 3.1 The options, weighed

What each one leaks is what leaves the house on top of the person's own public IP address, which every option exposes to someone.

| Option | How it works | Blocking risk | Terms of service | What leaves the house | Verdict |
|---|---|---|---|---|---|
| **A. Official Data API v3, household key** | REST calls to `www.googleapis.com/youtube/v3` with the owner's own Google Cloud API key | Low: overuse returns `quotaExceeded` on the key and resets daily; the API is built for this traffic and is not the bot-check path that walls an address | Allowed under the YouTube API Services Terms and Developer Policies, which the owner accepts for his own project; conditions in 3.3 | Search text, video and channel ids, the key (which names the owner's Google project), the hub's public IP, to Google | **Use, for lists and facts** |
| **B. Official IFrame player, privacy-enhanced** | `youtube-nocookie.com/embed/<id>` in the person's browser, loaded on tap | Low: it is exactly what any web page with a video does; the traffic comes from real browsers at a person's pace | The required way to play under the API terms | From the viewer's device to Google: the video id, the device's browser identity and IP; privacy-enhanced mode sets no tracking cookie before play, but ads and Google's player telemetry still run during play | **Use, for playback** |
| C. Thumbnails through a hub image proxy | The hub fetches `i.ytimg.com` and serves copies | Medium: one server client fetching every thumbnail on every shelf is the per-item fan-out L15 and L17 name | Not addressed by the terms; the API returns the URLs for display | The ids, from the hub | Reject; the device loads them (3.2) |
| D. yt-dlp for live browsing or streaming | Server-side page and player scraping, stream URL resolution | High: this is the traffic YouTube's bot checks target; L3, L4 and the 2026-08-28 wall | Against YouTube's terms (no downloading or accessing by automated means except as YouTube allows) | Everything, from the hub, as a bot-shaped client | Reject for browsing. The blend note's explicit Save keeps it behind V1 and its own approval (section 9) |
| E. InnerTube directly (the web or TV client's private API) | Imitating YouTube's own app calls | High, and breaks without notice (L5) | Against the terms | Everything, from the hub | Reject |
| F. Public Invidious or Piped instances | A third party's front end fetches YouTube for you | Instances are blocked and rotated constantly (L6) | Against YouTube's terms; the operator's terms vary | Search text and ids to an unknown operator, who also sees the hub's IP: a stranger in the data path, against PRIVACY.md | Reject |
| G. Self-hosted Invidious or Piped | The same front end, run at home | High: it is scraping from the home address, and needs token helpers that chase YouTube's changes | Against the terms | Everything, from the hub | Reject |
| H. Cookies from a family account in yt-dlp or InnerTube | Signed-in scraping | High, and the account itself can be suspended; cookies rotate and expire (L10, L11) | Against the terms | The account's identity on every request | Reject |
| I. Official OAuth for a dedicated family account (Data API scopes) | Device-code sign-in, then API calls with the account's token | Low; the same quota | Allowed | The account's identity, to Google, on the calls that use it | **Use, optional, read-only by default (section 5)** |
| J. SearXNG's YouTube engine | The household's SearXNG scrapes YouTube's results page for a videos-category query | Medium: an anonymous scraper on the home address | Against the terms | Search text, from the hub | Keep off (section 9); the chat video card's YouTube rows come from A |

**Recommended: A plus B, with I as the optional family layer.** It is the only combination that is allowed, does not depend on
staying ahead of YouTube's bot checks, and keeps the hub out of the byte path. It is the "front door" `THIRD-PARTY-SERVICES.md`
asks for.

### 3.2 What runs where

- **Stack `media` service (one choke point).** Every Data API call goes through `media.yt.*` functions in the Stack, behind the
  SERVICE-WALL limiter for the host `www.googleapis.com` (section 6), with the quota ledger and the response cache (section 7).
  Home asks the Stack; nothing else in Home, a package or a client calls the API. The key lives in Home's credentials center as a
  write-only secret and is handed to the Stack the way other provider keys are (CREDENTIALS.md).
- **The person's device.** The Videos app draws thumbnails from the URLs the API returned (`loading="lazy"`, only for cards on
  screen, at the size the API names for the card, never the original), and on tap loads the IFrame player for that one video.
  No hover previews (L13: each Loki Doki hover preview resolved a stream from YouTube); a hover shows the thumbnail only. The
  hub never fetches thumbnails in bulk (L17: a server fetching every thumbnail and avatar drew 429s from Google's image CDN).
  The player is a kit primitive (a `VideoEmbed` part added to `commons` first, rule 9b), not a Home wrapper.
- **Go (Apple TV, iPhone).** No embed exists for tvOS; Go hands off to the YouTube app with a deep link for an adult and a teen,
  and shows saved copies only for a child. Built last (principle 7).
- **The hub never** fetches a thumbnail, a player page, a caption or a stream for live browsing.

### 3.3 Conditions the API terms set (recheck on approval day, section 11)

- Playback through the YouTube player only, not obscured or modified while it plays; no ad blocking inside it. SponsorBlock
  skipping is therefore saved-copy only (the blend note already keeps it there).
- API data kept in a cache is refreshed or deleted within 30 days (section 7 caps every TTL far below that).
- A child-directed surface: Google's policies treat an app directed at children differently (made-for-kids content, no
  personalized ads). The child path here plays only adult-approved items, signed out, in privacy-enhanced mode; whether that is
  enough is a fact for the owner to confirm when he accepts the terms (decision D4).
- The default quota is 10,000 units a day per project; a search costs 100 units, most list and detail calls cost 1. The budget in
  section 6 is built on those numbers.

## 4. Age gates

Rule 0's precedence holds: user overrides over global defaults over user defaults; an admin may change a default in either
direction for one person or for everyone; the child or teen never can. Words for a child come from the kid-mode copy catalog.

| | Child | Teen | Adult | Guest or shared screen |
|---|---|---|---|---|
| What appears | Approved items only: videos and channels an adult approved for that child (the blend note's allowlist mode); no open catalog | Open catalog, filtered | Open catalog | Child rules unless an adult is signed in on that screen |
| Search | Within the approved list only, by default; an admin may allow open search for one child, which then runs at `safeSearch=strict` with the child floor on every title | `safeSearch=strict` (user default; an admin may set moderate) | `safeSearch=moderate`; the adult may choose | As child |
| Filters on every item shown | Approved, `status.embeddable`, not `ytAgeRestricted`; title and description through the child floor | Not `ytAgeRestricted` (fixed, no setting reaches it); title and description through the teen floor; an admin channel blocklist | Embeddable only | As child |
| Discovery rows (popular, from your channels, more from this channel) | None | From followed channels and the popular chart, filtered | Same | None |
| Comments, live chat, Shorts shelf | Never | Off by default | On | Never |
| Autoplay and end screens | Off; at the end the player is replaced by our own end card (the official player's end-screen suggestions are YouTube's, not ours) | Off by default | Person's choice | Off |
| Time budget and allowed hours | `media.daily_minutes`, `media.allowed_hours` (the blend note's keys, admin-set, child-locked), metered from player events | Admin may set | None | n/a |
| Ask a grown-up | "Ask to watch" on any unapproved item reached by a link; the request goes to the child's adults (notifications note) | n/a | n/a | n/a |

**Where the gate runs (L21, L23).** Because the player runs on the device, the hub cannot gate bytes; it gates the one place a
video id becomes a player: Home's watch route, which every surface (the Videos app, the chat video card, Family picks, watching
together, a pasted link, a notification) goes through to get an embed URL. It checks the viewer's gate server-side on every call,
from Home's own records first, and fails closed for a child and a teen: no metadata, no approval, or a filter error means no
player. List routes apply the same filter before an item leaves the hub, so a title a child may not see never reaches the
child's device (L22: Loki Doki's per-user limits worked because the server returned nothing). Social features show an item to
each viewer only if that viewer's own gate passes, and an invite never carries the title to a person who may not see it.

Why approval for a child and not a filter: L19 to L23. Loki Doki's kid tier combined YouTube's restricted mode, platform flags and
an LLM topic classifier; the classifier missed things, cost a model call per item, and the platform flags are set by uploaders.
Its approved-only mode is the one that held. `status.madeForKids` is shown to the approving adult as a hint, never as approval by
itself.

## 5. The household family account

Three layers, each opt-in and each its own approval:

1. **The household key (required for live browsing).** The owner creates a Google Cloud project, enables the Data API, makes an API
   key restricted to that API (and, where Google allows it, to the household's public address), and pastes it into Settings,
   Videos. It identifies the project, not a person. Every family member's browsing uses it; per-person budgets (section 6) keep one
   person from using up the day.
2. **The family account (optional).** A dedicated Google account made for the household (never a family member's personal
   account), linked once by an admin with the device-code sign-in Google offers for TVs and limited-input devices, scope
   `youtube.readonly`. It brings the account's subscriptions and playlists in as `media-source` records (the blend note's shape),
   read on open and at most hourly. The OAuth client is the owner's own (made in his Google Cloud project), never one copied from
   another app (L11: Loki Doki reused YouTube TV's client id and secret, scraped from the TV app); its tokens are encrypted
   secrets in the credentials center, never plain columns. Writing back (subscribe, add to a playlist) needs the wider scope and an adult tapping the
   action; nothing writes automatically (L12: Loki Doki wrote into the linked account's playlists). Why a dedicated account: the
   whole household shares it, so whatever Google infers or flags lands on an account nobody uses for mail, photos or payments.
3. **Per-person history stays home.** Watch history, progress, likes and "watch later" are Home's own `media-progress` and
   `media-collection` records, per person, never written to Google. Playback is signed out in privacy-enhanced mode, so a
   person's viewing does not land in any Google watch history. A person who wants their own YouTube account's recommendations
   uses YouTube; Home does not pull a personal home feed (Loki Doki read the linked account's home feed and history into its
   suggestions, L11; the API does not offer the home feed, and scraping it is option H).

Never: browser cookies, the TV client's private sign-in Loki Doki used, a password typed into Home, one person's account standing
in for the household.

## 6. Throttling and request budgets at the Stack limiter

All numbers live in the SERVICE-WALL spec record (one place, principle 4); the ones below are this note's proposed values for the
`youtube-data-api` service, stated as the budget THIRD-PARTY-SERVICES.md requires.

- **Two ledgers, both enforced before a call.** Requests: the SERVICE-WALL caps (foreground 1,500 a day, background 400, a
  2-second minimum interval per host, background exhausts first). Quota units: 8,000 of the 10,000 a day (2,000 held back so a
  bug never ends the day at zero), resetting when Google resets the quota (midnight Pacific time).
- **Searches are the scarce thing.** 100 units each, so the household has about 50 searches a day after detail calls. Per person
  per day: adults 20, a teen 10, a child with open search 5 (user defaults, admin-changeable). A search runs on Enter or a chip
  tap, never per keystroke; no remote autocomplete (Loki Doki's suggest calls fired as a person typed, L14). A repeated search
  inside 6 hours is served from cache and costs nothing.
- **Browsing costs 1 unit a page.** A channel's uploads (`playlistItems.list`), a video's details (`videos.list`, up to 50 ids in
  one call), the popular chart (`videos.list chart=mostPopular`). The Videos home page is at most 4 calls on open, all cached.
- **Background work, bounded.** Only the family account's subscriptions refresh and the approved list's 30-day refresh run in the
  background, staggered, at most one call a minute, out of the background ledger. No warm-ahead, no related-of-related, no
  "bottomless" feeds, no transcripts, no prefetch of the next page before the person scrolls to it (L2, L15, L16).
- **Back off on the first signal.** `quotaExceeded`: live browsing is paused until the reset. `rateLimitExceeded`, a 429 or any
  bot-check answer: a 24-hour wall. Three failures in a row: a 1-hour quiet. While walled or quiet, background stops entirely;
  the first person-initiated request after 6 hours is the probe; there is no separate probe client (L2: the probe kept the old wall
  up). Walls persist across restarts.
- **Devices are bounded by people.** The player and thumbnails come from devices, at a person's own pace, one player at a time
  per screen; the app never loads a player it is not showing.

## 7. Caching

- The Stack keeps the API responses it fetched, keyed by call and parameters: search 6 hours, video details 24 hours, a channel's
  uploads 1 hour, the popular chart 3 hours, channel details 7 days. Every cached item is deleted or refreshed by 30 days (the
  terms, 3.3).
- A refresh is a person opening the screen after the TTL, or the bounded background job; never "on every render".
- A failure is never cached as a result, and a cache entry is written whole or not at all (L18).
- Any per-person data a device keeps (Continue rows, history) is keyed to the signed-in person and wiped on sign-out or person
  switch (L18: Loki Doki's persisted home data showed to the next person on a shared screen).
- Thumbnails live in the device's own browser cache; the hub keeps no copy. A saved copy (the blend note's explicit Save) keeps its
  own thumbnail as part of the `file` record, which is the household's, not the API's.
- The approved list for a child is stored as Home records (ids, title, channel, the adult who approved, when), refreshed by 30 days,
  and dropped from view when a refresh says the video is gone, private or age-restricted.

## 8. Outages and degradation

A failed source never fails the app (the blend note, section 9; rule 6's spirit). Every line below uses a surface that already
carries that kind of status (RULES.md S6); this section adds no banner, dot, panel, toast or polling loop.

| What happened | What the person sees, and where | What the system does |
|---|---|---|
| No internet | Videos opens on Library (saved copies), live rows hidden; the Videos package's own `offline: "partial"` sentence (MEDIA-VIDEOS-01) says live videos come back with the internet | Nothing sent |
| Quota used up | Library and cached shelves "from earlier today"; the failing search's own response, in the kit destructive Alert, says it is used up for today and when it returns, in local time | No API call until reset |
| Wall or quiet | The same, in the same Alert: "YouTube is not answering right now" | No background; the 6-hour probe rides a person's request |
| Key missing, revoked or wrong | The live rows are absent; an admin gets a Repairs item with Try again (`lib/issues.ts` `raiseIssue`); a child sees saved videos only | No retry loop |
| A video will not embed (the uploader turned embedding off) | Adult and teen: the watch page says "This video only plays on YouTube" with an Open on YouTube link; child: the item is never shown (filtered at list time) | Nothing extra |
| The player fails to load | The watch page offers Try again; never an automatic retry | Nothing from the hub |

System health reaches the status board through its existing `service:youtube` component, fed by the outcomes of real requests,
not probes (status-internet-services note). There is no fallback to another method: an outage is a pause, never a switch to
yt-dlp, Invidious or scraping (L7: Loki Doki's fallback chains turned one failure into several clients' worth of traffic).

## 9. What this changes elsewhere

- **The chat video card (MEDIA-SEARCH-01).** For an adult, its YouTube rows come from this path when the household key exists. A
  child's or a teen's chat card never uses the key (rule 7: a keyed provider is never used for a child's or teen's query); they keep
  SEARCH-SAFE-01's engines. The card's YouTube thumbnails load on the viewer's device, not through Home's image proxy (section
  3.2). The Videos app is not the chat turn, so section 4's teen search there is unaffected. SearXNG's YouTube engines stay disabled in the Stack's SearXNG settings (option J). Other video sites in SearXNG's videos category are not live
  video services under V1 only if Jesse says so (decision D5); until then the videos category is not queried.
- **The blend note's yt-dlp Save and channel subscriptions.** Unchanged in purpose, but under V1 they are requests to a live video
  service: the first Save and the first subscription poll each need Jesse's approval in the moment. For a YouTube channel with the
  household key present, the subscription poll reads the uploads playlist through the API (1 unit) instead of yt-dlp listing the
  channel; yt-dlp runs only for an explicit Save.
- **Privacy page rows** (added in the same commit as each slice): Live video lists and facts (Google, from the hub: search text,
  ids, the project key; Settings, Videos); Live video playback (Google, from the viewing device: the video id and the device's
  browser identity; on tap only); Family account (Google: the account's identity on the calls that use it; off by default).

## 10. Staged rollout, with the approval gates

No stage starts without Jesse's word in the moment for that stage; approval of this note is not approval of any request.

| Stage | What | Requests to a video service | Gate |
|---|---|---|---|
| 0 | This note, the lessons note, rule V1 | None | Landed |
| 1 | Build against fixtures: the SERVICE-WALL record for the service, the Stack `media.yt.*` client with the quota ledger and cache, the kit `VideoEmbed` part, the Videos app's live rows, the age filters, the outage screens. Fixtures are hand-written from the API's published response shapes, never captured from the live service. The proposed guard (section 12) is installed | None; tests prove none can be made (a test fails if the client is constructed without the stage flag) | Jesse approves this note (decision D1) |
| 2 | Jesse creates the Google Cloud project and key himself, accepts the terms, and pastes the key | None from us | Jesse's own action (D2) |
| 3 | First real request: one `videos.list` for one public video id (1 unit), run by hand from the Studio, logged, with the quota ledger read back | One | **Jesse approves this exact request in the moment** (D3) |
| 4 | Adults only, for 7 days: live browsing on, budgets on, a daily read of the ledger and the wall log | Foreground at a person's pace | Jesse approves in the moment; stage passes with zero walls and the ledger under 50 percent each day |
| 5 | Teens, then children's approved lists | Same | Jesse approves each |
| 6 | Optional family account link | OAuth sign-in plus read-only calls | Jesse approves, and makes the account himself |

## 11. Facts to recheck on approval day (from Google's documentation, not from the service)

The default daily quota and the unit cost of `search.list`, `videos.list` and `playlistItems.list`; the 30-day cache rule; the
privacy-enhanced embed's current behaviour; whether the device-code OAuth flow still allows the YouTube scopes; the child-directed
app provisions; whether `relatedToVideoId` is still gone (this design does not need it). This note treats reading Google's developer
documentation as not a request to a live video service; Jesse confirms that reading with D6, and the session that reads it says so.

## 12. The proposed guard (not installed)

Two mechanical checks, proposed for Jesse's approval, both following patterns that already exist (`guard-main-checkout.sh`, the
`check.sh` lints):

1. **A PreToolUse hook in the org plugin, `deny-live-video.sh`** (Bash and WebFetch matchers): denies a command or fetch that names
   `yt-dlp`, `youtube-dl`, or a host in the spec list (`youtube.com`, `youtu.be`, `youtube-nocookie.com`, `googlevideo.com`,
   `ytimg.com`, `youtubei.googleapis.com`, `www.googleapis.com/youtube`, known Invidious and Piped hosts, and the other live video
   services Jesse names), unless the command carries `MAIPAI_LIVE_VIDEO_APPROVED=<date>:<request>` naming the date and the exact request
   Jesse approved in chat that day (V1: an approval covers only the requests it names). Same soft-gate shape as the
   Owner-approved line.
2. **A `check.sh` lint, `live-video-hosts`**: fails when a file under `backend/`, `frontend/`, `scripts/` or a package names one of
   those hosts outside an allowlist of the Stack client file, the fixtures folder and the hosts list itself (shrink-only baseline;
   today's hits are the answer-image host blocklist in `answerImages/relevance.ts`, which only drops results, and status test
   fixtures).

The host list is one spec file (principle 4). Neither is installed by this note; Jesse decides (D6).

## 13. Decisions for Jesse

- **D1.** Approve this design (A plus B, I optional) as the way live video works. Recommended.
- **D2.** Create the Google Cloud project and key yourself, and accept YouTube's API terms in Google's console (only the owner can).
- **D3.** Approve the first single request (stage 3) when stage 1 is built and tested.
- **D4.** Confirm the child path (approved items only, signed out, privacy-enhanced) is acceptable under the child-directed app
  provisions, or keep children on saved copies only.
- **D5.** Which other sites count as live video services under V1 (Vimeo, Dailymotion, TikTok, Twitch, Rumble, PeerTube are the
  candidates; this note assumes all of them until you say otherwise).
- **D6.** Install the guard in section 12, and confirm that reading Google's developer documentation (section 11) is not a request under V1.

## 14. Reuse check (prebuilt over hand-built)

- **Limiter, walls, budgets**: SERVICE-WALL-01's one spec record and gate (planned), on `@maipai/core`'s `rateLimiter`; no new
  limiter.
- **API client**: plain `fetch` to the documented REST endpoints in the Stack, about a dozen calls. Google's `googleapis` Node
  package was considered and not taken: it is large, covers hundreds of APIs, and adds nothing the few typed calls need.
- **Player**: YouTube's own IFrame Player API, the only player the terms allow (section 3.3: not obscured or modified while it
  plays). The kit `Player` planned in MEDIA-PLAYER-01 (Media Chrome) was considered first and does not fit live YouTube: its
  controls would sit over and replace the official player's, which the terms forbid; it stays the player for saved copies. Media
  Chrome's YouTube media element was considered for the same reason and not taken (it drives the IFrame player under custom
  controls). `lite-youtube-embed` (thumbnail first, player on tap) is the pattern and a candidate dependency for a kit
  `VideoEmbed` part; `react-youtube` was considered and not taken (a thin wrapper over the same API). Before any `VideoEmbed` code
  is written, the slice adds its row to `docs/design/UI-DECISIONS.md` (rule 9b) saying why it is not a second copy of `Player`.
- **Saved copies, progress, collections, allowlist**: the blend note's records and services; nothing new.
- **Side services**: none added. DeArrow and Return YouTube Dislike stay dropped (the blend note), SponsorBlock stays saved-copy
  only; each sent video ids from the hub in Loki Doki (L24).

## Supersedes

- [media-apps-blend-2026-10-17.md](media-apps-blend-2026-10-17.md), section 4 Videos row "Browse and search YouTube live
  (InnerTube, Invidious, Piped), trending, related": "off by default; adults may turn on ... later, opt-in only; never for a
  child" is replaced by sections 3 and 4 here: everyone browses through the official API and player, a child within an approved
  list; InnerTube, Invidious and Piped are dropped. The row "Linked Google account by TV device code" is replaced by section 5.
  Section 15, question B, is answered: live browsing is wanted, for everyone.
- [media-apps-blend-2026-10-17.md](media-apps-blend-2026-10-17.md), section 8, subscription polling for a YouTube channel: reads the
  uploads playlist through the API when the household key exists (section 9 here).
- `docs/BACKLOG.md` MEDIA-SEARCH-01, "Results come from SearXNG's images/videos categories": an adult's YouTube rows come from this
  path, a child's and a teen's never do, and SearXNG's YouTube engines stay off (section 9). The card's "thumbnail through Home's
  own image proxy" no longer holds for YouTube thumbnails, which load on the viewer's device. The device-side playback and the
  child and teen rules stand.
- [knowledge-sources-2026-09-24.md](../plans/knowledge-sources-2026-09-24.md), "Video search", the `YOUTUBE-API-01` paragraph: this
  note is that item's design; the key is required for live browsing rather than an add-on to a SearXNG-only path.
- Nothing in RULES.md except the new area V1, which Jesse authored in chat on 2026-10-17 and which this note is the record for.
