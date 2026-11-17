# One content filter by rating, with a top level nobody gets, and one feature access check (2026-11-16)

Status: proposed, needs an architect verdict. Owner decisions (Jesse, 2026-11-16, in chat; spelling tidied):

- "we need to address this once and for all - we need to remove all these rules for children and teens and instead have a central filter for content - all content can go through it and have a type and a rating. sometimes that rating is given externally (ex. rating of a movie, show, explicit lyrics on a song), and sometimes we need to determine (ex. news article, image, video). sometimes we wont be able to determine and it will be unknown just like movies have not rated. then we can assign ratings to user types - ex. kids get g, teens get g, pg, pg-13, and adults simply do not go through a filter."
- "so it never affects adults in terms of performance, resource utilization, errors, etc - and only applies to the groups it should and in a fast efficient way"; "the goal is to simply protect kids without hindering others".
- "we also need some sort of access control to features but perhaps that has nothing to do with kids - ex. wife and kids cant use image gen, entire family cant use coding except dad".
- "ideally we are funneling things through a chokepoint that we can just apply these things centrally and not scattered".
- "nice thing about ratings is we can leverage external and build our own ratings systems. we can have modules ... for these things."
- On the line that nothing sexual involving a minor is ever made or shown: "that's also a rating which we need mechanisms to examine content and rate. it's just a rating that applies to everyone".
- "things like this need to be fast - we can't slow down ... the entire news app from loading front page articles to rate every individual article just in time. we have to rate things as early as possible and cache those ratings. we need a system to pull in external ratings. we need systems to perform ratings ourselves".
- Answered in the question box the same day: go ahead with both systems; a ceiling by kind of person that an admin can adjust per person; the child picture protections are kept as what G means for pictures; unrated is hidden for a teen unless an admin allows it.

Evidence, the comparison with other products, the audit with file and line, and the full plan: [reports/content-ratings-and-access-review-2026-11-16.md](../reports/content-ratings-and-access-review-2026-11-16.md).

## Supersedes

Nothing in this note loosens a protection for a child or a teen (rule 0), and nothing in it changes the adult path of [adult-content-model-decides-2026-10-26.md](adult-content-model-decides-2026-10-26.md), which stands as written. It changes where the protections live and how they are named. Each move happens only in the build row named, and each row proves the same or stricter result first.

- [content-policy-2026-10-18.md](content-policy-2026-10-18.md) ("Owner goal: set protections once for chat, search, pictures, videos and songs"): this note carries that design forward and does not replace it. Its slice 01 is built (`lib/contentPolicy.ts`); its check function has no caller yet, and the child picture lane already reads its term lists and floor data (`pictures/lane.ts`, `pictures/minorLine.ts`), which stay in place; its open slices CONTENT-POLICY-02 to 05 are the surface rows of this note (section 8). What this note adds to it: the rating words and the stamp, ratings given by outside sources, raters, the list choke point, rating early and storing, and feature access.
- [modes-and-child-protections-2026-10-17.md](modes-and-child-protections-2026-10-17.md) ("admins will set child, teen or adult mode on each account; that has nothing to do with age, it has to do with controls"): the mode stands. A person's mode sets their rating ceiling (section 3); more than a mode's default is given by changing the mode, as today.
- The org safety page's ruling of 2026-10-18, "One set of content protections per person, by age, for everything Home makes": unchanged; its definition (swearing, drugs, gambling, gore and the rest) becomes the reasons a rating carries.
- [models-censor-app-protects-kids-2026-10-25.md](models-censor-app-protects-kids-2026-10-25.md), its table row "Every child and teen protection: the lanes, the finished-item check, the output gate, the locked adult-site host list, the news and page floors, the child rewrite | Kid protection. Unchanged.": every one is kept; each is reached through the one filter.
- [stack-home-catalog-separation-2026-11-16.md](stack-home-catalog-separation-2026-11-16.md) section 8, rule E6 and `adult_only`, and the rows VIDEO-WAN-HIDE-01 and VIDEO-WAN-REMOVE-01: unchanged, and kept as a second check, until AGE-ROUTING-REMOVE-01.
- Chat rule 2 ("A minor's request sets thinking off"), chat rule 8 ("a minor never gets model choice or thinking"), the tier ceilings by band and the org safety page's reasoning bullet ("no admin switch, flag or mode may send a child a reasoning stream"): **not changed by this note.** AGE-ROUTING-REMOVE-01 proposes changes and is not dispatched until the owner has changed those texts.
- MODE-GUEST-01 decides a guest's controls (the admin chooses, Teen preselected); AUDIENCE-01 uses that answer in every helper.

## Reuse check

Kept and called, not rebuilt: `lib/contentPolicy.ts` (the central policy module of CONTENT-POLICY-01), `lib/contentCeiling.ts` and the spec's content-ceiling record, `lib/topicStances.ts` and `lib/topicPrompt.ts` (the topic block stays as it is), the shared safety check (`@maipai/spec` `checkSafety`), `evaluateSafety` and `evaluateReply` (`lib/safety.ts`), the stream gate (`turnMachine/nodes/outputGate.ts`), the finished-item checks (`pictures/finishedCheck.ts`, `pictures/laneGate.ts`, `pictures/ageCheck.ts`), the search and news floors (`retrieval/minorFloor.ts`, `retrieval/minorRowFloor.ts`, `news/childGate.ts`), the query check (`retrieval/minorQueryCheck.ts`), the media band check (`media/band.ts`), the site lists (`blocklists/policy.ts`), the age functions (`lib/ageBand.ts`, `turnContext.ts` `effectiveBand`), grants (`lib/grants.ts`, `grant-actions.json`, GRANTS-01). New: the rating words and stamp, the rater shape, one audience function, three entry points in front of the policy module, the stored rating on items.

## 1. Two systems

| | Question | Applies to | Checked |
|---|---|---|---|
| Feature access | May this person use this feature at all? | Anyone, by person; age is not part of it | Once, where a feature starts |
| Content filter | May this viewer see this content? | Everyone for the top level, Prohibited; otherwise only a viewer with a ceiling | At the request, at the result, and where a list is built |

Prohibited is the top of the one rating scale: sexual content involving a minor. It is a rating like the others, found by raters like the others, and everyone's ceiling is below it. Three things make it different, and all three are today's behavior kept:
1. It is the only rating question asked about an adult's content. Nothing else in the filter runs for an adult.
2. An unrun check on an adult-only media job withholds the item (chat rule 0), and the Prohibited check that chat rules 0 and 10 require always runs, whatever another rater or a declared rating returned. For an adult the Prohibited question is asked only where those rules ask it today (request-aware screening of an adult's message, direct detection on generated media); it is not added to an adult's search, news, lists or outside titles, and an adult's discussion of the subject is not filtered.
3. Nothing lowers it: no ceiling, no admin's own rating, no grant, no setting, no rater of lower priority.

Not ratings, and unchanged: crisis handling and the crisis overlay, prompt injection, jailbreak, the credential and private-data catches, age and surface access, feature switches, quotas, technical validation, the output gate's grain (a child's and every spoken turn per sentence; a teen's admin-chosen mode), no reasoning to a minor, the band topic block and its hard lines, family stories, the adult-site host list, SafeSearch and the cleaning of fetched page text.

## 2. Ratings

One scale: G (0), PG (1), PG-13 (2), R (3), X (4), Prohibited (5), and Unrated. Outside labels map onto it (TV-Y and TV-G to G; TV-PG to PG; TV-14 to PG-13; TV-MA, a song or podcast marked explicit to R; adults-only marks to X). Every stored item and every result carries one stamp: the level, whether it was given by an outside source, declared by the feature that made it, or worked out by us, and when. The stamp may carry reasons (violence, language, scary, sexual, drugs, self-harm) so a refusal can say why. A rating is worked out once and stored. A declared rating never replaces a finished-item check: what Home makes for a child or a teen is always checked when finished.

A rating comes from a **rater**, a small unit: given one kind of content it returns a level or "unrated". Raters for one content type are tried in priority order. Outside raters read a label; our own work one out (the rules check for text, the model's look at a picture, later listening to a clip). An admin's own rating applies to one outside title, never to content Home makes; it never lowers below R an item rated R or above or carrying the sexual reason when the viewer is a child or a teen; and nothing overrides a Prohibited result. A new rater that reaches the internet needs a privacy row like any outside connection.

## 3. Who gets what

- A person's mode sets their ceiling: child G, teen PG-13, adult X (the level under Prohibited).
- An admin may lower a child's or a teen's ceiling. More than the mode's default is given by changing the person's mode, as today, or through an override that exists today (rule 0's search defaults, the topic levels), never to R or above and never past the hard lines. A child's pictures, clips and songs stay at G. A child or teen never sets their own.
- An adult's ceiling moves only by that adult's own opt-in filter for themselves; the app imposes none.
- A guest's controls are what MODE-GUEST-01 decides. An unknown speaker and a shared surface get what rule 0 says today (the child result, or the robot's set controls).
- Unrated is over the ceiling for a child, always. An admin may allow one teen Unrated outside content (a title or feed item with no outside label), which still passes that teen's other floors. Content Home makes, and any item whose check could not run, is never released to a child or a teen.
- For an adult the filter asks only the Prohibited question, where rule 10 asks it today, and nothing else. A household with no child or teen runs only that.
- For a viewer with a ceiling the topic block (`topicPrompt.ts`) stays, and carries the conduct line (no romantic roleplay, no encouraging dependence), which a rating cannot express.
- For pictures, G also means what the child lane means today: the cartoon look, no photos, no reference pictures, no real people, edits only of their own pictures, the child rewrite, and the finished-item check that fails closed. For a teen: no real person outside the household and no public figure (synths under `synths.real_people`). Kept in full.

## 4. The choke points

1. **Feature start** (the package and tool host and the API route guard): feature access.
2. **Request** (where a generating job or a search is submitted): a request that cannot come out under the ceiling is stopped or, for a child, rewritten to a kid-friendly version, before work starts.
3. **Result** (where a reply sentence, a picture, a clip or a song is released): the finished thing is rated and compared with the ceiling; a check that cannot run withholds it.
4. **List** (where a library, a feed or search results are built): rows over the ceiling are dropped on the server.

A build check fails on a new age comparison outside the audience module, the filter, the access module and the privacy module. Today's sites are on a list that may only shrink; none is removed except by its own row. Rule E6's minor list in the Stack stays as a second check until AGE-ROUTING-REMOVE-01 is ruled on.

## 5. Rate early, store, never rate while someone waits

Nothing is rated while a person waits for a list. Stored content is rated when it arrives (a library item when added, a feed article in the background fetch, a page when fetched, a stored picture in the background queue) and the stamp is kept with the content's fingerprint and the rater's version. A list is built from stored stamps only. An item not yet rated is Unrated: a viewer with a ceiling does not see it until it is rated; an adult sees it at once. A rater that needs a model runs through the Stack's queue at low priority. A reply, a new picture, a clip or a song cannot be rated ahead and is checked as it is released, as today. An item not yet rated is Unrated and is shown to no viewer with a ceiling until it is rated; the teen allowance for unrated outside content covers only an item every rater ran on and could not rate. Results that cannot be stored first (web search rows, fetched page text) are checked as they are built, by today's floors.

## 6. What stays that is not a rating

Privacy (what an admin can see of a child, a teen's private settings, which memories a turn may use, memory disclosure marks); limits (daily counts and minutes, as allowances any person can have); the conduct line of section 3; the non-content protections of section 1.

## 7. Feature access

A grant is already an allow or a deny of one action for one person (`use:<package>` in the closed list). One check at feature start reads it. An admin screen sets it per person per feature. A grant may deny any feature to anyone, and allows one only within rule 0's age and surface gates. `min_role` becoming a grant check is GRANTS-01, already on the backlog. Nothing here weakens a safety protection: the grant list has no action that does, and gains none.

## 8. Build rows

In `docs/BACKLOG.md` under "Content filter by rating and feature access", plus the existing CONTENT-POLICY-02 to 05, GRANTS-01, MODE-GUEST-01 and MEDIA-KID-01, each amended to point here. Every row that moves a child or teen protection is risky surface: full check, independent minor-safety review, architect verdict, real runs, and the one test set (FILTER-SUITE-01) as its gate.

1. RATING-SPEC-01 (commons). 2. MODE-GUEST-01, then AUDIENCE-01. 3. FILTER-SUITE-01. 4. FILTER-DOOR-01 (no behavior change). 5. RATE-INGEST-01. 6. The surfaces: CONTENT-POLICY-02 (chat, news, search), FILTER-MEDIA-01 (library lists), CONTENT-POLICY-03 (pictures, video), CONTENT-POLICY-04 (songs). 7. GRANTS-01, ACCESS-UI-01. 8. CONTENT-POLICY-05 (settings). 9. AGE-ROUTING-REMOVE-01, only after the owner's rule changes.
