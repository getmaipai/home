# Live video: what Loki Doki learned the hard way (2026-10-17)

Status: history and research, no code. The lessons inventory behind [live-video-2026-10-17.md](live-video-2026-10-17.md) and
RULES.md V1. Jesse asked, 2026-10-17, for every issue Loki Doki had with YouTube and live video (the family account, throttling,
rate limits, the special way videos were reached, cookies, IP blocks, yt-dlp breakage, thumbnails and proxies, caching, kid
filtering), with evidence, the root cause, and the rule each one implies.

**How this was gathered.** Read only: a clone of `JesseWebDotCom/loki-doki` (979 commits, 2026-06-22 to the 2026-08-25 cutover
commit `e14c0c8`), its tree at that commit, and Home's own docs. No request was made to YouTube, Invidious, Piped or any other
video service. Two limits: the local archived mirror (`~/Developer/github.com/loki-doki`) and the `legacy-backups/*-legacy.git`
mirrors are not on this machine, so the 2026-08-28 wall itself, which happened on the pre-rebuild Home after the cutover, is known
only from the records Home and the org standards wrote at the time (cited as such). The repo's issues were not read (no `gh` on
this machine). Commit ids are Loki Doki's; paths are relative to its `backend/src/` unless they say otherwise. "Inference" marks
what the code shows but no commit states.

## The inventory

### Getting walled

**L1. The house was walled by the server's own background traffic, not by people.**
Evidence: `.github/docs/THIRD-PARTY-SERVICES.md` (added `ca4bd32`, 2026-08-29, the day after); `docs/BACKLOG.md` SERVICE-WALL-01;
`media-apps-blend-2026-10-17-sources.md` section 1.7. What happened: on 2026-08-28 YouTube walled the hub's home IP; every
family member's player was dark for a day. Root cause, as recorded: "discovery expansion, suggestion pools, warm-aheads,
transcripts far exceeded what a person could ever generate". Loki Doki's code shows how that volume was built (L15, L16).
Rule: live video traffic is foreground, at a person's pace; background work is bounded, counted separately, exhausts first and
stops entirely on the first push-back.

**L2. The recovery probe kept the wall up.**
Evidence: `docs/BACKLOG.md` SERVICE-WALL-01: "the old probe ran five clients every 30 min and kept the wall up five days"; the
legacy `quiet.ts`, `accessMonitor.ts`, `sessionKeeper.ts` trio; "one writer per cookie jar". Root cause: probing a wall is
traffic, and five client identities probing on a short timer look like the bot the wall was built for. Rule: one probe per
6 hours, carried by a person's own request, the result persisted across restarts; never a separate probe client.

### The special ways videos were reached, and how each broke

**L3. A self-managed yt-dlp binary was a standing source of outages.**
Evidence: `21b3645` (06-24, a managed binary hung on every spawn, so every stream resolve hung); `1ae147f` (07-06, the onefile
build unpacked 30 MB per call, 8.5 s each); `d674ca3` (07-06, a hot reload lost the binary path, 20 saves failed at once);
`lib/ytdlp.ts:1-16` ("a stale yt-dlp is the single most common cause" of silent breakage) with a daily self-update. Root cause:
yt-dlp must change as fast as YouTube changes, so the hub carried a moving dependency on its hot path. Rule: no yt-dlp on any
browsing or playback path; where it remains (an explicit Save), it is a pinned Stack binary updated on the Stack's cadence, off the
person's critical path.

**L4. YouTube's anti-bot checks broke yt-dlp and pushed the code into client spoofing.**
Evidence: `740df23` (07-07: downloads and exports returned 403 because the default `web` client needs a JS runtime for its
signature and proof-of-origin token challenge; fixed by forcing `player_client=android_vr,web_safari,web`, `lib/ytdlp.ts:314-325`);
`8ee2aa3` (06-24) and `youtube/innertube.ts:1083-1135`: WEB and ANDROID "no longer return usable streams without an attestation
token", so the code impersonated a VR headset client whose version must track yt-dlp's or YouTube answers LOGIN_REQUIRED. Root
cause: unofficial access is an arms race the hub cannot win; each fix is a new disguise. Rule: no impersonated clients; if the
official door says no, ask less or drop the feature (THIRD-PARTY-SERVICES.md, "look like the user's client, honestly").

**L5. Scraping YouTube's private API (InnerTube) broke whenever YouTube changed a page shape.**
Evidence: `5cf8b93` (07-31: `compactVideoRenderer` became `lockupViewModel` in watch-next, so related returned nothing for every
video, which emptied Up next, related shelves and the bottomless feeds); `edea734` (channel header shape); comments moved
(`innertube.ts:946-1013`); `youtube/discovery.ts:3-12` (anonymous Trending returns HTTP 400 and the signed-out home feed is
empty); `youtube/tvClient.ts:7-11` ("We can't fixture these shapes without a live login"); `5e3d914` (the channel RSS feed
returns only 15 items, so a weekly deep InnerTube reconcile was added to recover lost uploads). Root cause: InnerTube is not an
interface; it is YouTube's app talking to itself. Rule: only documented, versioned interfaces (the Data API); tests run on
fixtures written from the published shapes.

**L6. Public Invidious and Piped instances were a fragile third party in the data path.**
Evidence: `youtube/discovery.ts:18-37, 104-106, 131-143` (five Invidious and three Piped instances tried in order, a spoofed
Safari user agent to pass Cloudflare challenges, Invidious's channel endpoint "bot-blocked", Piped trending "thinner and
flakier"); `adc9d4d` (07-31: half-scraped rows with null views and zero length). Root cause: these front ends scrape YouTube
themselves and are blocked in turn; each one also sees the household's queries and address. Rule: no third-party front end, ever;
a stranger in the data path breaks PRIVACY.md before it breaks the feature.

**L7. Retries and fallback chains multiplied traffic exactly when YouTube was pushing back.**
Evidence: `youtube/stream.ts:178-185, 385-386` (three attempts with back-off because "a cold burst of resolves from one IP can get
rate-limited"); `innertube.ts:1309-1321` (three more retries); search falling from InnerTube to a page scrape to DuckDuckGo
(`tools/youtube.ts:308-319`); `e68e801` (when both resolve paths failed, `/stream` started a full offline download); on a 403 the
proxy re-resolved (`docs/.../dev/subsystems/youtube.md:40-42`). Root cause: each layer treated a refusal as a transient fault, so
one "no" became several clients' worth of requests. Rule: a refusal is a stop (quiet or wall), never a retry; no automatic
fallback from one access method to another.

### The hub in the byte path

**L8. Relaying video through the hub made it the household's one loud client.**
Evidence: `f9ca8a2` then `ef3a99a` (both 07-10: the private stream became the default, then was reverted the same day because it
started slower and topped out at 720p); `3d37201`, `74e14cd` (1080p, then 4K by server-side remux); `/stream/:id/prewarm` on every
watch-page load (`routes/youtube.ts:2299`); stream URLs tied to the hub's IP and expiring (`youtube.md:40-42`). Root cause: the
privacy goal (the browser never talks to Google) was bought with every stream resolve, every segment and every prewarm coming from
one server address. Rule: live playback runs on the viewer's device through the official player; the hub relays only saved copies.

**L9. Transcoding on demand cost stability and power.**
Evidence: `5a02216` (07-28: parallel `init.mp4` requests killed and respawned the encoder eight times in 30 s, driver faults,
remote sessions starved); `62259fb` (07-08: six hard power-offs under sustained re-encodes, then clock locks and a 30-minute
compute hold after an unclean boot); `436555e` (07-11: yt-dlp calls without slots or timeouts, fork bombs and hangs); `d29c6f6`
(07-29: an orphaned yt-dlp held the server port, restarts failed); `b00668d` (an unhandled ffmpeg error crashed the server; the
clipper had an SSRF and an argument-injection hole). Root cause: heavy jobs on the request path with no single queue. Rule: no
live transcode; heavy media work runs in the Stack's one FIFO, with timeouts, on saved copies only.

### The family account

**L10. Browser cookies were the household's identity, by hand.**
Evidence: `605d840` (07-04) and `lib/ytdlp.ts:327-334`: an admin exports `cookies.txt` from a signed-in browser with an extension
(`AdminYoutubeLimitsSection.tsx:228`) and uploads it; no rotation, only an upload time; used for downloads, exports, transcripts
and, from `af4f38f` (08-07), age-gated films. The code itself keeps it off playback because "forcing a single personal YouTube
session onto shared traffic risks that account getting flagged". Inference: transcripts also ran from background jobs, so the
cookies did reach automated traffic. Root cause: cookies are a person's browser session, not an API credential; using them
from a server is the pattern Google flags. Rule: never cookies; a household identity is official OAuth on a dedicated account.

**L11. The linked account used a borrowed client and grew to the whole account.**
Evidence: `fb428d3` (07-06): OAuth device sign-in with YouTube TV's own client id and secret, scraped from the TV app bundle
(`youtube/account.ts:36-77`), scope including paid content; `yt_accounts.userId` unique, so one account per person
(`db/schema.ts:1767-1781`); tokens and the client secret in plain columns (inference: no encryption in `account.ts`). The stated
intent was "low-volume account sync and explicit user actions only" (`tvClient.ts:1-5`), but sync ran every 30 minutes and later
commits added the home feed (`bcb3fdf`), watch history as taste signals (`bf37554`), the subscriptions feed and personalized
watch-next on every opened video (`a020800`), and private playlists (`62361f3`). The dev doc still called the hub "keyless,
account-free". Root cause: once an account was linked, each feature reached for more of it. Rule: one dedicated household account
on the owner's own OAuth client, a read-only scope by default, a stated call budget, encrypted tokens, and the privacy page
updated in the same commit as any new use.

**L12. The hub wrote into the Google account.**
Evidence: `fb428d3` (subscribe, Watch later and like pushed back behind a per-user toggle); `85dff9a` (08-08: put and delete on
any playlist). Root cause: two-way sync made the hub an actor on the account. Rule: no automatic writes; a write is an adult
tapping one action, with the wider scope granted for that purpose.

### Request volume

**L13. Hover previews cost a YouTube request per card.**
Evidence: `stream.ts:66-70` (one InnerTube call per preview, a 10-minute negative cache); `72af94a` (the hover iframe flashed over
the thumbnail). Root cause: a pointer crossing a shelf is not a person asking for a video. Rule: no request on hover.

**L14. Search suggestions as a person typed.**
Evidence: `605d840` ("reusable SmartSearch"), `youtube/suggest.ts:13-14` (a 10-minute, 300-entry cache over remote suggest calls).
Root cause: autocomplete turns one search into a request per keystroke. Rule: search runs on Enter; no remote autocomplete.

**L15. "Bottomless" feeds fanned out per item.**
Evidence: `2a2c3fc`, `c175385` (07-31: caps raised from 120 and 50 to 600); `discovery.ts:180-209`: past the scraped list each
request fanned out to related lookups, 5 seeds by 20 results for up to 3 rounds, plus avatar enrichment with 8 workers
(`discovery.ts:112-129`); the extension was shared and thrown away at each 30-minute refresh, so (inference) the fan-out repeated.
Root cause: an endless page was filled by multiplying requests, not by paging what the person scrolled to. Rule: no
related-of-related and no fan-out per item; the next page is fetched when the person reaches it.

**L16. Warmers, prewarm and idle processors ran the clock, not the person.**
Evidence: `727ca70`, `4022da2` (07-18: an idle-time processor, a 15-minute poller warming trending and popular against 30-minute
caches, transcripts prefetched for unfinished videos); `8f0ce43`, `3adf1fb` (08-10: warm every lazy image app-wide, 40 avatars at
once); `youtube/automation.ts:31` (auto-transcribe); `ytdlp.ts:65-120` (the yt-dlp pool grew from 3 to 6 slots because warming a
dozen creators starved clicks; `MAX_WARM_CREATORS=30` per tick in `videos/feed.ts:178`); `702aa66`, `c63f2ca` (08-01:
transcripts failed silently when yt-dlp's caption file names drifted, then fell back across three InnerTube clients). Root cause:
the hub tried to make everything instant by fetching before anyone asked, which is exactly the traffic L1 names. Rule: no warm-ahead
against a live video service; instant comes from caching what a person already saw.

### Thumbnails, images and caching

**L17. A server fetching thumbnails and avatars drew 429s from Google's image CDN.**
Evidence: `edea734` (06-22: a read-through disk cache added "to stop avatar CDN 429s"); `youtube/imageCache.ts:32-50, 297`
(24-hour eviction "guaranteed rate-limited re-fetches"; raised to 30 days for thumbnails and channel art, a weekly conditional
refresh capped at 200); `8f0ce43` (900-pixel avatars fetched for a 20-pixel circle); `4ad5388` (08-13: phones on plain-http LAN
had no service worker, so an IndexedDB art store and ETags were added). Root cause: one server client fetching every image on
every shelf is fan-out by another name. Rule: the device loads the thumbnails on screen, at the size shown, lazily; the hub does
no bulk image fetch.

**L18. Caches stored failures, half files and another person's data.**
Evidence: `a79464c` (07-09: the related cache had kept a transient failure for 20 minutes); `d3f436d` (07-11: a truncated `.mp4`
from a restart counted as a valid cache hit forever); `sponsorblock.ts:96-100`; `084bf50` (08-13: persisted home data showed to
the next person on a shared device when a session expired without sign-out). Root cause: caching added without a failure and an
owner model. Rule: never cache a failure; write a cache entry whole or not at all; per-person cached data is keyed to the person
and wiped on sign-out.

### Kid and teen protection

**L19. The kid filter failed open.**
Evidence: `de6bee8` (07-13: source flags plus an LLM classifier over title, description and channel, three tiers);
`lib/videos/policy.ts:10, 89-90, 145-147` (the list filter and the single-item gate catch every error and return "allowed" for every
tier, kid included; the comment's reason, "never hide an adult's feed", applied to children too); `classify.ts:9` (fails open
"everywhere"). Root cause: one error policy for every age. Rule: for a child and a teen, every gate fails closed.

**L20. Classifiers and embeddings let the wrong things through.**
Evidence: `58cbb61` (07-14: ten-year-old shorts from one stray watch, keyword collisions); `21f74c7` (07-14: a murder headline
scored 0.48 for a viewer of political commentary and reached the rail; date-only topics brought astrology spam); `62f0c84` (a
mention of a coffee brand became a coffee rail). Root cause: similarity is not suitability, and uploader flags are set by
uploaders. Rule: a child sees approved items only; filters are a teen and adult tool, and made-for-kids flags are a hint to the
approving adult, never approval.

**L21. The gate ran on one route; everything else reached the video unchecked.**
Evidence: `routes/youtube.ts:1311-1320` (the watch gate is skipped when metadata fails, so a child's direct link was ungated exactly
when YouTube was degraded); inference from the same file: `/stream`, the HLS routes, `/transcript`, `/comments`, `/ask`,
`/formats`, `/export`, `/save` and the account home feed carry no policy, allowlist or time check, and `routes/videoStream.ts:77`
serves any source; `f8e4e17` and `lib/videos/watchTime.ts:75-103` (the time budget relied on the player's own heartbeats).
Root cause: the design trusted the client to ask the gated route first. Rule: one server-side gate at the single place a video
becomes playable, on every call, failing closed for minors.

**L22. The approved-only list held, and limits held when the server sent nothing.**
Evidence: `f3d3e28` (07-17: the allowlist is enforced outside the fail-open path, and blocks everything if its entries cannot be
read, `lib/videos/allowlist.ts:10, 32, 64-65`); `075d902` (07-17: no autoplay, no Shorts, no suggestions, with the suggestion
routes returning empty server-side, `lib/videos/viewFlags.ts:29`). Root cause of success: protection by construction, not by
detection. Rule: the child default is the approved list, and a hidden feature is one the server never returns.

**L23. Restricted Mode covered search only, and household features skipped the filter.**
Evidence: `innertube.ts:32-38` sets safety mode, but only search (`routes/youtube.ts:233`) and related searches (`:1840`) pass it
(inference: no other call sites); Family Picks (`routes/videos.ts:1011-1040`) unfiltered; a Watch Together invite pushes the
video title to every other person before any gate (`routes/watchTogether.ts:109-125`, inference); the weekly parent report showed
teens' titles to admins with no teen carve-out (`be6a950`). Root cause: each feature chose its own filter. Rule: one filter path
for every surface that shows a video to a person, social features included, applied for the viewer.

### Privacy and terms

**L24. Side services and stale docs leaked more than the promise said.**
Evidence: `youtube/sponsorblock.ts:12, 102` and `returndislike.ts:8, 17` send the full video id; `dearrow.ts:16` a 4-character
prefix (all proxied by the hub, so the hub's IP goes with them); the subsystem doc's "keyless, account-free" line outlived
`fb428d3`; `d1dbceb` (07-07) softened ad-circumvention claims and added a personal-use disclaimer, the only terms-of-service
discussion in the history. Root cause: each integration was added for a feature, and the privacy record was not updated with it.
Rule: every outbound host is a privacy-page row in the same commit; no cosmetic side service; terms are read before the code is
written, not after a claim is made.

## What these add up to

| Theme | Lessons | The rule in the design |
|---|---|---|
| Volume, not intent, gets a house walled | L1, L2, L13, L14, L15, L16, L17 | Foreground only, budgets at the Stack limiter, one probe on a person's request (design section 6) |
| Unofficial access is an arms race | L3 to L7, L10 | The official API and player only; no fallback chain (design section 3) |
| The hub in the byte path is costly and loud | L8, L9 | Device-side playback; saved copies only through the hub (design section 3.2) |
| Accounts creep | L10, L11, L12 | One dedicated family account, the owner's own OAuth client, read-only (design section 5) |
| Kid safety by construction | L19 to L23 | Approved items for a child, one fail-closed gate for every surface (design section 4) |
| Caches and privacy records rot | L18, L24 | Cache rules (design section 7), privacy rows per slice (design section 9) |

## Supersedes

Nothing. History and research only; the decisions are in [live-video-2026-10-17.md](live-video-2026-10-17.md).
