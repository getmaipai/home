> **Retired 2026-10-17.** Why: built as IMGQ-13a and reverted on 2026-10-13 after the sealed-set pass (IMGQ-15) showed the resolver lost. Replaced by [IMGQ-16, the final picture setup](../../plans/imgq-16-final-picture-setup-2026-10-13.md).

# IMGQ-13: picking the right Wikidata entity for an answer picture (design note, 2026-10-12)

A written design, no code changed. Follows IMGQ-11, where 2 of the 8 questions that still showed a wrong tile (Statue of Liberty and tacos) were not a tile problem: the resolver had picked the wrong thing before any picture was
fetched. Evidence: the saved capture `data-scratch/chat-ab/imgq-11-2026-10-12/cap/capture.json` (every Wikipedia and
Wikidata answer the resolver saw), replayed through the unchanged `resolveWikimediaSubject`
(`backend/src/lib/answerImages/wikimedia.ts`) with the capture serving each request. The replay reproduces the saved
`resolved_via` for all 67 subjects. Counterfactual kinds and the sitelink counts below were fetched live, once, politely
(about 25 Wikidata and 2 Wikipedia calls, one every 1.2 to 2 seconds, Home-style user agent).

## 1. What the resolver chose, subject by subject

Of 67 subjects, 51 resolved through the subject's own Wikipedia page, 9 through `kind`, 1 was skipped as ambiguous,
1 had nothing by that name (Dyson vacuum cleaner), the rest stayed on the page. Every one of the 51 page picks is the
obvious entity. The 9 `kind` picks and the skip:

| id | subject / kind | page the title query returned | chosen | verdict |
|---|---|---|---|---|
| f-20 | Statue of Liberty / statue | Statue of Liberty (Q9202, "monument in New York", 158 sitelinks) | Statua della Libertà, San Marino (Q3064968, "statue located in San Marino (City)", 11 sitelinks) | WRONG, all 5 tiles wrong |
| f-51 | tacos / food | Taco (Q191655, "Mexican dish ...", 73) | French tacos (Q30737843, "fast food recipe", 13) | WRONG, all 5 tiles wrong |
| f-61 | The Lord of the Rings / film series | the novel (Q15228, 148) | Return of the King, the film (Q131074, 93) | WRONG entity; the intended one is the film series (Q190214, 73). Tiles mostly fine, one game page |
| f-33 | blue whale / whale | Blue whale (Q42196, "species of marine mammal ...", 111) | Hope (whale), a skeleton (Q139885129, "skeleton of a blue whale", 3) | WRONG entity, tiles happened to look right (the skeleton's category holds whale pictures) |
| f-48 | Mini Cooper / car | Mini Cooper (Q26261760, "Wikimedia list article", 2) | Mini (Q36024, 44) | acceptable (the page is a list article) |
| f-64 | Hamilton / musical | disambiguation page | Hamilton (2020 film) (Q84323848, 24) | weaker than intended: the musical (Hamilton (musical)) was not among the search's 10 hits, so the film of it won |
| f-13 | Python / snake | disambiguation page | Pythonidae, the family (Q184018) | acceptable (genus Python (Q271218) was a better fit) |
| f-11, f-17 | Mercury / planet, Washington / state | disambiguation page | Mercury (planet), Washington (state) | right; kind did its job |
| f-14 | Amazon / river | disambiguation page | skipped as ambiguous | wrong outcome: "Amazon River" is on the dab page but not in the top 10 search hits, so no sense fitted "river" |

So four clear wrong entities (f-20, f-51, f-33, f-61), two soft ones (f-64, f-13) and one wrong skip (f-14).

## 2. Why each one went wrong

The code path is one rule in `resolveWikimediaSubject`. `kindScore` counts how many of the model's kind words appear in a
candidate's Wikidata description. The page's own item stays only if `pageFits` (its description has at least one kind word)
or no other sense fits. Any other sense whose description has a kind word and has an English article wins, and `kind` is a
veto, not a hint.

- **Statue of Liberty / statue.** Wikidata's description of the real statue is "monument in New York": no word "statue".
  The San Marino item's description starts "statue located in ...": one hit. So `pageFits` is false, `fit` exists, and
  the small sibling wins. With kind "monument", "landmark", "tourist attraction" or no kind the replay returns the right
  item. Only the exact word "statue" breaks it.
- **tacos / food.** The page `Taco` description never says "food"; "French tacos" ("fast food recipe") does. Kind "food"
  breaks it; "dish", "Mexican food", "taco" and no kind do not.
- **blue whale / whale.** The description of the species is "species of marine mammal, largest living animal"; the word
  "whale" is only in the skeleton item's description. Kind "whale" breaks it; "animal", "mammal", "marine animal" and no
  kind do not.
- **Mini Cooper / car.** The page item is a Wikimedia list article (no "car" word), so the Mini (car model) item wins.
  Fine here, and the same mechanism that wrongly overrode the three above.
- **The Lord of the Rings / film series.** Here the page really is the wrong sense for the kind (it is the novel), and
  kind did the right thing in moving off it. The failure is the tie-break: the intended item's description is "2001-2003
  three films directed by Peter Jackson" (kind words "film" yes, "series" no) so it scores 1, the same as Return of the
  King ("2003 film by Peter Jackson"). `fitting` is sorted by score only, so the tie is broken by Wikidata search order,
  and the search ranks Return of the King above the series. Kinds "film series", "movie", "film franchise" all give
  Return of the King. Kind "trilogy" keeps the novel.
- **Hamilton / musical and Amazon / river.** The search leg asks for 10 hits for the bare name; the intended item is not
  among them. On a disambiguation page the dab page itself lists it: `Hamilton` links `Hamilton (musical)`, `Amazon`
  links `Amazon River` (one Wikipedia `prop=links` call each, 126 and 80 links, no continuation). The resolver never
  looks.

Common cause: description wording decides. Two weak signals combine badly. A description is one short phrase written
for a person scanning search results, so the presence of a kind word in it says almost nothing about what the item is, and
the veto makes a one-word difference (statue vs monument) outweigh a 14-fold difference in notability (158 vs 11
sitelinks).

## 3. Are the hand-written inputs different from what the model passes?

The IMGQ-11 subjects were written as a subject plus one kind noun each, by hand. The tool contract
(`backend/packages/show_images/manifest.json`) tells the model to give `subject` by its full proper name and `kind` as
"what kind of thing it is, in one to three words, from the conversation", examples "animal", "TV series", "car",
"planet", "snake", "programming language". Real calls the 9B made in the IMGQ-09 dev logs
(`data-scratch/chat-ab/imgq-09-2026-10-12/a1-dev.log`, `a2-dev.log`; 38 distinct pairs, none for an IMGQ-11 subject):

- The subject is the plain name, close to what we wrote ("Eiffel Tower", "koala", "Jurassic Park", "Nintendo Switch").
  Quirks: "Python code", "The Exorcist (2026)", "Prince George of Wales".
- The kind is free-form and unstable for the same subject: Michael Jackson was "singer", "pop icon" and "person";
  the Eiffel Tower "landmark", "building" and "tower"; Jurassic Park "film" vs "Jurassic Park T. rex"/"animal"; the
  Exorcist "movie" and "movie poster"; Nintendo Switch "console" and "video game console"; Koala "animal".
  It is sometimes the type of the picture (movie poster) or of the user's worry (loan, financial instrument), not of the
  thing.

So the hand-written kinds are in the same family as real ones: one specific noun the description may or may not
contain. Real kinds are, if anything, vaguer and vary run to run, which makes a veto driven by their exact words worse,
not better. The failures above fire on one word each (statue, food, whale), a word a 9B model would plausibly produce
for those questions, while the model's more generic words ("landmark", "animal", "dish") do not fire. Conclusion: the
model's own kind wording is part of the cause (kind is a free-text, run-to-run-varying input), but it is the resolver's
decision to let that wording override the subject's own page that turns it into a wrong picture. The cleanest proof is that
the same subject with kind left blank resolved correctly for f-20, f-51, f-33, and f-48 (the blank-kind run on f-61
returns the novel, which is the one case where kind is needed).

Gap: none of the 38 real pairs is for an IMGQ-11 subject, so I cannot say what kind the 9B would give "Statue of
Liberty". The new set (section 5) must be measured with real model kinds, not only hand-written ones.

## 4. General rule proposed

Principle: the asked name picks the entity, notability breaks ties, and `kind` is a hint that can only choose among
things that already pass for the name. No subject list, no word list.

1. Candidate pool. Build it from items whose English Wikipedia title (without a "(...)" qualifier) or English label
   equals the asked subject after case, accent and plural folding (so "tacos" equals "taco"): the page's own item
   (unless it is a list, name or dab page), and the search hits that match. Items that only share a word with the subject
   (San Marino's "Statua della Libertà", "French tacos", "Return of the King") are not in the pool. A hit whose English
   title is a different language's name never joins by its non-English label.
2. Notability. Read each pool item's sitelink count (`wbgetentities` with `props=sitelinks`, no `sitefilter`, up to 5
   ids; the counts above came from this call). Drop pool items under 40% of the pool maximum. Measured against the
   cases: skeleton 3 of 111 (3%) and Bakshi film 40 of 148 (27%) drop; the film series 73 of 148 (49%) and the novel stay.
3. Kind as a hint. Among the surviving pool items, if exactly one or some fit the kind (same `kindScore`), the best-fitting
   wins, ties broken by sitelinks, then by search order. If none fit, the page's item wins; the kind never removes the
   page's item from the pool and never adds an item that fails step 1. On a disambiguation page the pool is empty by
   step 1, so step 4 runs.
4. Disambiguation page. One extra Wikipedia call, `prop=links&plnamespace=0&pllimit=max`, on the dab page; take links
   whose title starts with the subject, resolve them to items in the same `wbgetentities` call (use `titles=` with
   `sites=enwiki`, up to 25), then apply steps 2 and 3. If kind fits none of them, skip as ambiguous, as today (owner,
   2026-10-06).
5. Keep what works: a loose kind ("animal", "thing", "place") still never moves off the page; a person never needs a
   kind; the existing R2 `queryTitle`, R4 `otherSenseWords` and the `nothingByName` skip are untouched.

Expected effect on the 67 (decided by replay, not yet built): f-20 Q9202 (pool of one after the 40% cut), f-51 Taco,
f-33 Blue whale, f-61 the film series (kind "film series" fits Q190214 and not the novel; kind "trilogy" keeps the
novel), f-64 Hamilton (musical) via the links call, f-14 Amazon River via the links call, the 51 page picks unchanged,
Mercury, Washington and Python still resolved by kind among dab-page links.

Why not "always take the page unless kind contradicts it": f-61 needs kind to move off the novel; a veto is the wrong
shape, a hint that selects within a notable name-matching pool is the right one.

Request budget (per subject, resolver only; the rest of the pipeline is untouched):

| case | today | proposed |
|---|---|---|
| the subject's page is a normal article (about 90% of the 67) | 3: page, search, entities | 3: same calls; the entities call asks for sitelinks (a larger answer, a few tens of KB for 5 items; counts only for ids already being fetched) |
| disambiguation page (6 of 67, 9%) | 3 | 4: plus one links call |
| nothing by that name | 2 | 2 |
| Commons category and depicts (adult answer) | 2 | 2 |

Average about 3.1 resolver calls against 3. The header comment in `wikimedia.ts` ("Never more than 3 Wikimedia calls
here") becomes "4, the fourth only on a disambiguation page". Everything stays on the existing paced
`wikimediaFetchJson` and the 6-hour cache pattern (add a per-subject resolution cache keyed by subject and kind; it
removes repeat lookups in a conversation, a net request saving). Privacy: these are the same fixed hosts,
same query content (the name), no new outbound destination.

Known weak points to measure, not assume: the 40% cut has three data points and no tuning set; a rare but real
sense (a film named like a more famous book) can fall under the cut and then kind cannot reach it; the links call on a
dab page caps at the first 126 titles in `plnamespace=0` (Hamilton, Amazon fit; a dab page with more would need
continuation).

## Supersedes

Section 4 holds the rule; this section names what it replaces.

- **IMGSEARCH-01's kind-veto sense choice** (accuracy study rules R1 and R2, 2026-10-06): "another sense wins when it fits the
  kind, the page's item does not, and it has an English article". Replaced by section 4: the asked name picks the pool, sitelinks
  break ties, and kind is only a hint among name-matching items. The R2 `queryTitle`, R4 `otherSenseWords` and the
  disambiguation-page-with-no-fit skip (owner, 2026-10-06) stay.
- **IMGQ-RESOLVE-01's loose-kind handling, where it overlaps** (2026-10-08): the special case that a loose kind never moves off the
  page is now one instance of the general rule (a kind can never add an item that fails the name match in step 1, nor remove the
  page's item from the pool), so the loose-kind list stays only as the guard for "kind fits nothing", not as the reason a
  sibling is excluded.
- **The comment and limit "Never more than 3 Wikimedia calls here"** in `backend/src/lib/answerImages/wikimedia.ts`
  (`resolveWikimediaSubject`): becomes "never more than 4, the fourth only on a disambiguation page" (the links call, section 4
  step 4 and the request budget table).

## 5. Measuring it on a new sealed set (the 67 are now seen)

The 67 are now development data: they supplied every finding above, including the 40% number, so no result on them can be
the final test. Also do not reuse the older 43, 27 and 70-question sets for the final number, for the same reason.

1. New sealed file, at least 120 subjects, written and sha256-recorded before any capture, by an author who has not
   read this note's table, and none from IMGQ-08/10/11 lists or this note. Composition: 40% bare ambiguous names with a
   popular sense and at least one lesser sense (statues and monuments with namesakes, foods that have regional variants,
   animals with named individuals, films vs books vs games), 20% subjects with a qualified official title, 20% plain
   unambiguous, 10% people, 10% names whose best sense is on a disambiguation page. Each row carries the intended
   Wikipedia title (and accepted alternates) written down in advance. The unit of judgement is the entity chosen against
   that title, which is checkable without looking at a picture; tile judging stays the secondary measure.
2. Two kind arms on every subject: (a) a hand-written specific kind plus a generic one, and (b) real model kinds: drive the
   9B through the tool-calling bench with `MAIPAI_BENCH_OFFER=show_images` on a natural question for each subject, 3
   repeats, and record the exact `subject` and `kind` it passes (the engine run is the coder's, not the coordinator's).
   A blank-kind arm (c) shows what the kind adds. Capture once, with the new resolver's URLs as well (entities with sitelinks, dab
   links), at one request at a time with the existing pace; the old resolver replays on a capture made for the new URLs
   because the old one reads the same data.
3. Replay old and new resolver offline on the one capture (no engine, no model) and report: wrong-entity rate per arm,
   paired bootstrap 95% interval on the per-subject difference (4000 resamples), the dab-page outcomes (right entity /
   wrong / skipped), and calls per subject. Bars: wrong entity at most 1 in 40 on the new set (3 of 120 passes the point
   estimate; report the interval and do not claim the bar when its upper end is above it), no subject the old resolver
   got right turned wrong (a list of regressions with ids, expected zero or each named), and no more than 4 calls.
4. Run the 67 as a regression check only: all 51 page picks unchanged, f-20, f-51, f-33, f-61, f-64, f-14 fixed, Mercury,
   Washington, Python unchanged. Anything else changing is read by hand.
5. Rule 13 applies to the engine arm: 3 or more repeats, paired intervals, and a held-out split inside the new set
   (60 tune the 40% cut if it needs moving, 60 never touched until the one final replay). If a number is tuned on the
   first 60, the held-out 60 is the result.
6. Review level medium when built (the resolver decides what pictures are shown), architect verdict first (kind
   handling is in `docs/design/RULES.md` terms "the model decides"; this makes kind a hint, not a rule).

Unchanged by this note: the tile filters in `relevance.ts` and the picture judge of IMGQ-12. This note removes the
case where every tile is wrong because the entity is wrong; IMGQ-12's judge would catch some of those, but a judge
looking at pictures of the San Marino statue for "Statue of Liberty" has no way to know the entity was wrong unless it
reads the question, so fixing the entity is cheaper and earlier.
