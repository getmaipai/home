# One content filter by rating, one feature access check: is it a good idea, and the plan (2026-11-16)

Research and plan. Read only: no code changed, nothing committed. Code facts are from `origin/main` of `home`, read on 2026-11-16 by a full sweep of `backend/src` and `frontend/src`; counts are approximate where they come from pattern matching. Facts about other products come from a web search the same day; where the source was a forum or a news report it says so.

## 1. Bottom line

**The idea is good. Do it.** It is how every large media product protects children, it is simpler than what we have, and done right it costs an adult nothing.

Three honest limits:

1. **A rating replaces the content rules, not every age rule.** Four things stay beside it: the check that applies to everyone (nothing sexual involving a minor, and the crisis paths), privacy (what a parent can see), limits (daily counts and minutes), and feature access. So "remove every mention of children" is not reachable. "No age check anywhere outside four small modules" is.
2. **It is the most sensitive refactor we could do.** A mistake here shows a child something they should not see. It must move one surface at a time behind a test set that proves each move is the same or stricter.
3. **Three rules and the org safety page have to be reworded,** which is yours alone to approve.

What we have today, measured:

- About **553 files** mention child, teen or minor (420 backend, 133 frontend).
- About **227 calls** to the age function across 112 files, plus **102 lines** in 60 files that skip it and compare the role directly.
- **Seven or more** separate "which band is this person" helpers. Two disagree: one treats a guest as a teen (`lib/ageBand.ts:17`), another as a child (`lib/media/band.ts:45`).
- A central content policy function was already written (`lib/contentPolicy.ts`, `contentPolicyFor`) and **nothing calls it**. Only its own test does. The 2026-10-18 ruling "one set of content protections per person, for everything Home makes" was never built as one thing.
- **Five different vocabularies** for "who may see this" are stored today (section 4), and no film or TV rating field exists anywhere.

## 2. How other products do it, and what went wrong for them

| Product | How | Lesson for us |
|---|---|---|
| Netflix | Each profile has a maturity level; it sees titles at or below it. Rating scales differ by country. Single titles can be blocked per profile | A ceiling per person, not a fixed "kid" and "teen" |
| Plex | Preset profiles (younger kid, older kid, teen) map to allowed ratings. Forum reports: unrated files are hidden from restricted users, and at times the restriction did not reach Plex's own online content | Unrated needs a stated policy; every surface must pass the same check |
| Jellyfin | A maximum rating per user plus a switch, "block items with no or unrecognized rating". Forum reports of unrated titles leaking when the switch was off, and of blocked titles appearing in "up next" rows | The classic failure is a list built somewhere that skips the filter |
| ChatGPT for teens (August 2026) | Under-18 users get added protections on self-harm, violence, eating disorders, dangerous acts and sexual content; when unsure of age it defaults to the under-18 experience. A watchdog test of 4,000 prompts reported most safeguards failed | Chat needs more than a rating (no romantic roleplay, no encouraging dependence); unknown defaults to the strict side; claims must be tested |
| Safety classifier models | Llama Guard 4 is a 12-billion-parameter model with its own category list; smaller ones exist | Too heavy to add for this. We use no such model today and do not need one |

The pattern everyone shares is exactly yours: content has a rating, a person has a ceiling, unrated has a policy. The failures are all the same kind: a path that did not go through the check.

## 3. The design

### 3a. Two systems and a floor, never mixed

| | Question it answers | Applies to | Where it is checked |
|---|---|---|---|
| **Feature access** | May this person use this feature at all? | Anyone, by person. Nothing to do with age | One place: where a feature starts |
| **Content filter** | May this viewer see this content? | Only a viewer with a ceiling (children, teens, guests, unknown speakers, shared screens) | Three places: request, result, list |
| **The floor** | Is this something nobody gets? | Everyone, adults included | Where it is today; never bypassed, never called a rating |

The floor is the existing line that nothing sexual involving a minor is made or shown, plus the non-content protections (crisis handling, prompt injection, credential and private-data catches). "Adults do not go through the filter" must never switch these off, so they are a separate thing with a separate name.

### 3b. Ratings

One scale, in the words you used:

| Level | Shown as | Maps from |
|---|---|---|
| 0 | G | TV-Y, TV-G, G, game rating E |
| 1 | PG | TV-PG, PG, E10+ |
| 2 | PG-13 | TV-14, PG-13, T |
| 3 | R | TV-MA, R, M, a song or podcast marked explicit |
| 4 | X | NC-17, adults-only marks, anything sexual |
| none | Unrated | no rating and none could be worked out |

Every stored item and every result carries one stamp: the level, where it came from (given by an outside source, worked out by us, or declared by the feature that made it), and when. Internally the stamp may also carry reasons (violence, language, scary, sexual, drugs, self-harm) so a refusal can say why and so a parent can later allow or tighten one kind. People see only the rating.

How a rating is found, cheapest first:
1. **Given:** the outside label (explicit flag, film or TV rating, a site list). Free.
2. **Declared:** a feature that can only make one kind of thing says so (a weather card is G). Free.
3. **Worked out by rules:** the word and pattern check we already run. Microseconds.
4. **Worked out by a model:** the household's own chat model, already loaded, asked once. Used for pictures today. Seconds, and only for a viewer with a ceiling.
5. **Unrated:** when none of the above can answer.

A rating is worked out once and stored on the item, not on every view.

### 3c. Who gets what

- Each person has a **ceiling**. Defaults by kind of person: a child G, a teen PG-13, an adult none. An admin can set one person's ceiling (a 12-year-old to PG, say). A minor can never change their own.
- A guest, an unknown speaker and a shared screen get the strictest ceiling in the house, as today.
- **Unrated:** hidden for a child, always. For a teen, hidden unless an admin turns on "allow unrated" for that teen.
- **An adult has no ceiling, so the filter is not called.** One comparison, no model loaded, no check that can fail, no error path. A household with no minors never loads or runs any of it.

### 3d. The choke points

1. **Feature start** (the package and tool host, and the API route guard): feature access. One call.
2. **Request** (where a generating job or a search is submitted): stops or rewrites a request that cannot come out under the viewer's ceiling, before time is spent. For a child, "rewrite to a kid-friendly version, do not refuse" stays, as the way a request reaches G.
3. **Result** (where a reply sentence, a picture, a clip or a song is released): the finished thing is rated and compared with the ceiling. Unrated counts as over the ceiling.
4. **List** (where a library, a feed or search results are built): rows over the ceiling are dropped before the list leaves the server. This is the one other products get wrong.

A build check fails on any age comparison outside the audience module, the filter, the access module and the privacy module.

### 3e. What this removes

- **Model routing by age.** A child's clip is forced onto one model today, thinking is off for a minor, Max is adult only. Under ratings none of these is a rule. A model whose output we cannot rate (a clip with speech nobody checks) simply produces **Unrated** content, which a child and a teen do not get. When we can rate it (VIDEO-LTX-06, listening to the clip), it opens to them by itself. This replaces the `adult_only` flag I added to the part record today, and it takes the model name out of Home.
- **The seven band helpers** become one audience function.
- **The five stored vocabularies** (`band_ok`, explicit flags, all-ages or adult-only, child_ok or teen_ok or adult_only, companion audience) become one stamp.
- **`min_role` on packages** splits into what it really was: a content rating for the package, and an access default.

### 3f. What stays that is not a rating

- **The floor** (3a).
- **Privacy:** what an admin can see of a child, a teen's private settings, which memories a child's turn can use. These are about people. They stay in one privacy module.
- **Limits:** daily picture counts, media minutes. They become allowances any person can have, set by an admin, with defaults for children. Not age rules.
- **Conduct in chat for a minor:** no romantic roleplay, no encouraging dependence. A rating cannot say this; it is a short instruction the filter adds to the model's prompt for a viewer with a ceiling.
- **The child picture lane** (cartoon look forced, no photos, no real people, edits only of their own pictures). These are protections beyond a rating. See decision 3.

### 3g. Feature access

It exists and is barely used. A grant is an allow or a deny of one action for one person, from a closed list that already includes `use:<package>` (`backend/src/lib/grants.ts`, `commons/spec/vocab/grant-actions.json`). Only 4 backend files consult it. The work: one check at feature start; a People by Features screen for admins ("Image maker: off for these people", "Coding: only this person"); groups are a convenience on that screen, not a new record. No age is involved.

### 3h. Raters: where a rating comes from is a pluggable unit

A rater is a small unit with one job: given one kind of content, return a rating or "I cannot say".

```ts
interface Rater {
  id: string;
  rates: string[];        // content types: "film", "show", "song", "podcast", "article", "web_page", "picture", "clip", "reply"
  priority: number;       // 1 first
  rate(item): { level: 0 | 1 | 2 | 3 | 4; reasons?: string[] } | "unrated";
}
```

- **Outside raters** read a label someone else gave: a film or TV rating from a metadata source, the explicit flag on a song or a podcast, a site list.
- **Our own raters** work one out: the rules check for text, the chat model's look at a picture, later listening to a clip.
- **A parent's own rating** of one title beats every rater, in either direction, up to the floor.
- For each content type the raters are tried in priority order and the first real answer wins. Swapping or adding one changes no feature code, and each can be tested and improved alone against the same test set.

This is the same "unit" idea as the rest of today's design: one contract, a registry, priority, replaceable. Lean start: the raters we already have (explicit flags, the rules check, the picture check) move behind this one interface in phase 3. Outside rating sources are added one at a time later, each as its own small row, and a new one that reaches the internet needs a privacy row like any other outside connection.

## 4. How far off we are

| Need | Today | Evidence |
|---|---|---|
| One "who is this viewer" function | One main function, seven or more side copies, 102 direct role comparisons, a disagreement about guests | `lib/ageBand.ts:17`, `turnContext.ts:47`, `media/band.ts:45`, `codeSafety.ts:35`, `contentPolicy.ts:51`, `house/tool.ts:176`, `codeGate.ts:73`, frontend `chatActivity.ts:30` |
| One filter | Checks in about 65 files for results and 39 for requests, no shared entry point; the central helper is uncalled | `turnMachine/nodes/outputGate.ts:214`, `pictures/laneGate.ts:43`, `pictures/finishedCheck.ts:61`, `news/childGate.ts:31`, `retrieval/minorRowFloor.ts:14`, `retrieval/minorFloor.ts:58`, `media/band.ts:57`, `blocklists/policy.ts:26`, `turnMachine/nodes/safety.ts:27`, `retrieval/minorQueryCheck.ts:63`, `turnMachine/nodes/policy.ts:379`, `lib/contentPolicy.ts` |
| One rating stamp | Five vocabularies; no film or TV rating | `db/schema.ts:2302-2304` (`advisory_explicit`, `band_ok`), `shelf/shelfStore.ts:31`, `access.ts:150` (all-ages or adult-only), `memory.ts:231` (`child_disclosure`), `householdCompanions.ts:188` (audience), `loras/adultCheck.ts:7` |
| No model routing by age | About 54 files | `tiers.ts:55-64`, `pictures/lane.ts:26,101-108`, `turnMachine/nodes/context.ts:197`, `codeWire.ts:3`, `media/videoCreateApp.ts:45` |
| Feature access by person | Grants exist; 21 of 72 packages gate by `min_role` instead | `turnMachine/nodes/policy.ts:428`, `lib/grants.ts` |
| Adults untouched | Adult text is checked by rules for the floor only; every finished picture and clip, adults included, gets an apparent-age check by the chat model | `turnMachine/nodes/safety.ts:60`, `outputGate.ts:216`, `pictures/ageCheck.ts:1-7` |

Two things the sweep raised:
- It reported that an adult's reply text gets no word check for the floor. Checked: that is the approved design, not a gap (CSAM-TEXT-01, owner-approved 2026-10-19: `commons/spec/safety/ts/classifier.ts:41`, mode `adult_reply`; discussion is not filtered, depiction is stopped at generation). Only a comment in `safety.ts` is out of date.
- The adult picture and clip check uses the chat model on every finished item. That is the floor, and it stays, but it is a real cost on adults. It deserves a measurement, separate from this plan.

## 5. Will it slow anything or get complicated

- **Adults:** faster or the same. The filter is not called. Nothing new loads. The floor is unchanged.
- **Children and teens:** the same cost as today for text (rules). Pictures keep the one model question they have now. Stored items are rated once.
- **A household with no minors:** zero.
- **Development:** slower for the weeks of the move, faster after. Today a new feature has to remember to add its own child check in the right places; after, it calls nothing and gets the filter because it goes through the choke points.
- **Complexity:** fewer ideas, not more. Rating, ceiling, unrated, access. The risk is not complexity, it is the move itself.

## 6. The plan

Each step is small, lands alone and has an exit check that can fail. Nothing loosens a child or teen protection at any step; each move is proven the same or stricter on a fixed test set first.

**Phase 0. Decide and record.**
- F-01: design note; rewording of RULES 0, 8 and 10 and the org safety page, each with your approval; architect verdict.

**Phase 1. Vocabulary (commons).**
- F-02: `rating` (levels, the mapping table, reasons), `audience` (ceiling, allow unrated), the stamp. Exit: fixtures; every outside label we ingest today maps to a level.

**Phase 2. One audience function (Home).**
- F-03: one function from a person or a surface to an audience; the side copies and direct role comparisons call it; guests are decided once. Exit: a build check fails on an age comparison outside the allowed modules; the existing tests pass unchanged.

**Phase 3. The filter as a front door, no behavior change (Home).**
- F-04: the test set: every existing child and teen safety test, plus recorded cases per surface, as one suite that runs against the filter.
- F-05: `checkRequest`, `release` and `filterList`, at first calling today's checks inside. Exit: the suite passes; an adult call returns at the first line (a test that fails if anything else runs).

**Phase 4. Move one surface at a time, each its own row with the suite as the gate.**
- F-06 chat replies. F-07 search and news. F-08 library, podcasts and music (the explicit flags become stamps; film and TV ratings are read when those sources arrive). F-09 pictures. F-10 video. F-11 songs.
- Each row deletes the old check it replaces.

**Phase 5. Remove routing by age.**
- F-12: thinking, tiers and model choice stop reading age; a part with unrateable output yields Unrated. Exit: no model id and no age check in the video, picture and tier code; a child still cannot get an unchecked clip (test).

**Phase 6. Feature access.**
- F-13: one access check at feature start; `min_role` split into a package rating and an access default. F-14: the People by Features screen. Exit: turning the image maker off for one adult removes it for that adult everywhere, and for nobody else.

**Phase 7. Settings.**
- F-15: a person's ceiling and the unrated switch in People; the old per-feature child switches removed.

**Order against today's other work:** phases 0 to 3 touch different files from the Stack and Home parts work and can run beside it. Phase 5 replaces the children's video rows in that plan (hide Wan, then the audio check, then remove Wan) with one simpler rule, so those rows wait for this decision.

## 6a. Amended the same day: the floor is the top rating

Your point: "nothing sexual involving a minor" is also a rating, one that applies to everyone. Adopted. Where this report says "the floor", read **Prohibited**, the level above X that nobody's ceiling reaches. An adult's ceiling is X, so the only rating question ever asked about an adult's content is Prohibited, with the same checks as today. Three properties are kept: it is the only check on adults; where today's rules require it (nude or sexual generated media) a check that cannot run withholds the item; and nothing can lower it, including an admin's own rating. Crisis handling and the prompt-injection and credential catches are not ratings and stay as they are.

## 6b. Added the same day: rate early, store, never rate while someone waits

Your point: the news front page cannot wait while every article is rated. Agreed, and it becomes a rule of the design.

**The rule.** Nothing is rated while a person waits for a page. A rating is made when content arrives, stored on the item, and a page only reads stored stamps. Building a list is then a comparison of numbers.

| Kind of content | When it is rated | Cost on the page |
|---|---|---|
| Library media, podcasts, songs, films, shows | When added or synced, from the label that comes with it | None |
| News, feeds, shelves | When the feed is fetched in the background; the rules check takes microseconds per article, so it runs in the same step | None |
| Search results | The search engine's safe mode, site lists and the page's own adult label, as results arrive | Microseconds |
| Web pages read for an answer | When fetched, by the rules check | Microseconds |
| Stored pictures and clips | Once, when made or imported, in the background queue | None |
| A reply, a new picture, clip or song | Cannot be rated ahead; rated as it is released, as today | Same as today |

- **Waiting for a rating:** an item not yet rated is Unrated. A viewer with a ceiling does not see it until it is rated, usually moments later. An adult sees it at once.
- **Stored with a key:** the stamp is kept with the content's fingerprint and the rater's version. When a rater improves, items are re-rated in the background and the old stamp holds until then.
- **Heavy raters never block:** anything that needs a model goes through the Stack's queue at low priority and never ahead of chat.

**Outside sources worth using, and ones to avoid.**

| Source | Gives | Verdict |
|---|---|---|
| The label that arrives with the item: the explicit flag on songs and podcasts, a video service's age-restricted and made-for-kids marks | A rating at no extra request | Use first. We already ingest the explicit flags |
| A film and TV database's certifications (TMDB lists them per country for films; its TV ratings endpoint was not confirmed today) | G to R style ratings | Use when a film or TV source is added. It is an outside request, so it needs a privacy row and should ride on the metadata request we already make |
| Game age ratings (ESRB, PEGI) through a games database | Age ratings | Later, if games arrive |
| Adult-site domain lists that can be downloaded and kept on the hub (several maintained open lists exist) | Site is adult or not | Use, offline. We already keep a locked adult-site list; this feeds it |
| A page's own adult label (the RTA tag, which Google also recognizes) | Page says it is adult | Use: free, read from a page we already fetched |
| A search engine's safe mode | Pre-filtered results | Keep, as today |
| Common Sense Media | Detailed age guidance | Not now: access is by business partnership only. Scraping it is not acceptable |
| Cloud moderation services | Ratings by sending content out | No. Nothing leaves the home |

**Our own raters, cheapest first.**
1. The rules check we have (text): microseconds, already used.
2. A small picture model that runs on the hub: one source measured about 20 milliseconds a picture against 4 to 14 seconds for a large vision model. Useful for bulk library pictures and thumbnails, with the chat model's look kept for the unsure cases and for anything a child makes. Two cautions from the research: the published accuracy figures are the makers' own, and one study found these models do worse on AI-made pictures, so any candidate must be measured on our own test set before it is trusted. One popular option also has a licence that does not fit.
3. The household's chat model looking at a picture or reading a passage: slow, already loaded, used only where it is today.
4. Listening to a clip (VIDEO-LTX-06): later.

**What I would not build:** a rating for every web page on the internet, per-category sliders for parents on day one, or our own film ratings. Outside labels for published media, rules and lists for the web, and our own checks only for what we generate.

## 6c. Found in review: this was started in October

The architect's review found the earlier design this builds on: `docs/design/content-policy-2026-10-18.md`, "one content-protection definition per person". Its first slice was built (`lib/contentPolicy.ts`) and never wired in; slices CONTENT-POLICY-02 to 05 are still open. The plan now carries those rows forward instead of duplicating them, and adds what they lacked: rating words and a stored stamp, outside ratings, raters, the list choke point, rating early, and feature access (GRANTS-01, also already on the backlog).

## 7. Your decisions (answered 2026-11-16)

1. **Go ahead with both systems and the floor:** yes.
2. **Ceilings:** a default by kind of person, and an admin can adjust one person's. As built into the rules: an admin can lower a child's or a teen's ceiling; giving more is done by changing that person's mode (child to teen, teen to adult), as today. Raising a ceiling inside child mode would weaken a protection the org safety page calls absolute, so it would need that page changed first.
3. **The child picture lane** (cartoon look forced, no photos, no real people): kept, as what G means for pictures.
4. **Unrated for teens:** hidden unless an admin allows it for that teen.

## Sources

- [Netflix: set profile maturity ratings or block titles](https://help.netflix.com/en/node/114276)
- [Netflix: maturity ratings for TV shows and movies](https://help.netflix.com/node/2064)
- [Plex: parental controls](https://support.plex.tv/articles/parental-controls/)
- [Plex forum: unrated files hidden from restricted managed users](https://forums.plex.tv/t/all-unrated-video-files-are-hidden-from-any-managed-user-with-a-restricted-profile/788207)
- [Plex forum: restrictions not applied to Plex online content](https://forums.plex.tv/t/movies-tv-on-plex-no-content-rating-filter-13yo-can-watch-rated-r-movies/526410)
- [Jellyfin forum: maximum rating does not filter unrated content](https://forum.jellyfin.org/t-solved-maximum-allowed-parental-rating-does-not-filter-rated-nr-content)
- [Jellyfin forum: blocked content appearing in "up next"](https://forum.jellyfin.org/t-parental-controls-not-stopping-innapropriate-content-in-up-next-and-other-sections)
- [Jellyfin parental controls guide](https://docs.elfhosted.com/guides/families/jellyfin-parental-controls/)
- [OpenAI: ChatGPT for teens](https://openai.com/blog/chatgpt-for-teens)
- [OpenAI: approach to age prediction](https://openai.com/index/our-approach-to-age-prediction/)
- [GPB and NPR: watchdog finds most ChatGPT teen safeguards did not work](https://www.gpb.org/news/2026/10/09/chatgpt-for-teens-has-special-safeguards-watchdog-group-finds-most-dont-work)
- [Llama Guard 4 model card](https://build.nvidia.com/meta/llama-guard-4-12b/modelcard)
- [TMDB: movie release dates and certifications](https://developer.themoviedb.org/reference/movie-release-dates)
- [Google: guidelines for sites with explicit content (rating meta tags, RTA)](https://developers.google.com/search/docs/specialty/explicit/guidelines?authuser=1)
- [RTA label background](https://wiki.riteme.site/wiki/Restricted_to_Adults)
- [Common Sense Media developer center](https://www.commonsensemedia.org/developers/api/v3/reviews)
- [YouTube Data API: videos resource](https://developers.google.com/youtube/v3/docs/videos?authuser=7)
- [HaGeZi DNS blocklists (includes NSFW lists)](https://github.com/hagezi/dns-blocklists)
- [UnsafeBench: benchmarking image safety classifiers](https://arxiv.org/html/2405.03486v1)
- [NSFW detection: small model against LLM vision, one tester's timings](https://aireiter.com/blog/nsfw-detection-api)
