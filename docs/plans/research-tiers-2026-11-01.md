# Research depth by answer style (RESEARCH-TIER-01, 2026-11-01)

Status: core built and landed on `main`, not shipped. Reports behind it: `data-scratch/reports/max-research-loop-design-2026-11-01.md` and `research-triggers-and-implementations-2026-11-01.md`.

## What was wrong

Every chat model record had `turn_budget.rounds: 1`, and the spec allowed only 0, 1 or 2. One message could run one batch of searches and then had to answer, whatever the person picked. A Max question got the same single lookup as Instant.

## What was built

| Answer style | Tool rounds | Extra behavior |
|---|---|---|
| Instant | 1 (the record's `rounds`) | none |
| Thinking | up to 4 (`rounds_thinking`) | first-round note: search again if something is missing |
| Max | up to 12 (`rounds_max`) | first-round note: split the question and look each part up with its own query; later rounds are told what was searched and which sites were read; Max also thinks |

- Spec `spec-v0.1.290` adds the optional `rounds_thinking` and `rounds_max` (0 to 12) to `turn_budget`; `spec-v0.1.291` adds the household setting `research.max_web` (default on).
- `turnMachine/research.ts` holds the style rules, the notes and the stop rule. The model still decides every search (rule 1, `tool_choice: "auto"`). Only an adult's written turn is ever raised; a teen, a child, a spoken turn and bare mode stay at the record's figure (rule 0).
- The page sends `max: true` for the message Max was armed for; the hub raises the turn only while that person holds the Max lease (`chatLeaseHeldBy`).
- Source numbers run across every search of the turn, so a `[n]` names one source of the reply's Sources card. The evidence a research turn re-reads is shared between its searches (`researchEvidenceChars`).
- Stop rule: a round whose searches found no source address the earlier rounds had not shown ends the searching, and the next model call is the answering round. When the round budget runs out the same happens.
- The answer keeps only citation numbers that name a source of the reply (`dropUnknownCitations`).
- The step rows are the existing tool timeline: each search row says what it searched (the model's query) and lists the sites it read; the summary line counts steps and sites. The steps persist with the message (`research_steps` on the turn row, adults only) and draw again after a reload. The reasoning disclosure is the existing Reasoning group.
- `stats.answer_style` records Thinking or Max and shows in Details as "Answered with".

## Owner ruling (Jesse, 2026-11-01): Max may research the open web

Everyone who holds the Max grant may have a Max question searched on the open web in depth. Teens and children have no Max, so the existing age and surface gates exclude them. Budget for one question: 12 searches, 40 pages read, at most 4 pages from one site, a site's pages 3 seconds apart, and a site that refuses a page (403, 429 or its robots.txt) is skipped for the rest of the run while the other sites are still read (the owner's second answer, 2026-11-01; the first answer ended all page reading at the first refusal, and the live runs read 2 pages of 29 sites because one video site refused). It is on by default; an admin can turn it off with `research.max_web`, which keeps Max's first search ordinary and its later rounds on the offline library. The run budget lives in `lib/researchBudget.ts` and is enforced in the page reader. Home's own search pace (a burst of three, then one about every six seconds) still applies; a research run waits up to 8 seconds for its next search instead of failing the round.

**The org copy needs the same line.** `getmaipai/.github/docs/PRIVACY.md` and `THIRD-PARTY-SERVICES.md` (the authority) must record this ruling and the budget table row in the same change; they live outside this repo and have not been edited here.

## Not built yet (listed so nothing reads as done)

- The scripted loop of the design report: brief and plan calls, the 4B extractor, the evidence ledger with source tiers and claim status, and the mechanical quote check. Here the 27B decides each round in the model call itself (its search, or its answer); citation numbers are checked, quotes are not.
- Query-writer step (2 to 4 varied queries per sub-question, rewrites from what was found) and the V-question eval with real web search on the real Stack.
- One-tap cancel that keeps the findings and still writes an answer; adding a note mid-run; a background run that posts its report and notifies.
- The plan card (Start and Edit), the "Think it through" offer, and the Instant self-check with its "Checking a bit more" extra look-ups. Jesse approved these; they are separate commits after the core.
- A visible per-reply label of the tier that answered (today it is the Details row).
- The judge model in parallel (per-page notes, near-duplicate query rejection, claim support check, Instant confidence check). The judge is not a separate wire role: it is a chat-role call with a different prompt, answered by the Stack's small model. Whether it runs beside a streaming main call without evicting chat was not measured.


## Senior review fixes (2026-11-01, after eleven live runs)

The report is `data-scratch/reports/research-v-diagnosis-senior-2026-11-01.md`. The facts that answer a question were available after the first good search and were lost inside Home. What was built, one commit each:

| Commit | Change |
|---|---|
| RESEARCH-PIN-01 | Stage 1 pins the subject to one article (the offline library's title match, else the live Wikimedia search for an adult) before any search; every search is plain keywords of at most eight words that carry the article's name and years. A name or year from the model's own memory is still held back, but the anchor's title and lead are words a search may carry. |
| RESEARCH-BACKBONE-01 | The pinned article's lead and the sections that bear on the plan's parts reach the writing round uncut (up to 12,000 characters), chosen by one short chat-model call over the article's real headings (word overlap when the model is down), and are cited as one more source of the reply. |
| RESEARCH-PAGES-01 | Per-host refusal; social and video hosts are never page candidates; a research search reads up to four pages at once, 8,000 characters each, from its own page pace; checked quotes lead a source's passages; a regression test pins that no tool round follows an empty gap check. |
| RESEARCH-NOTES-02 | A page gets one short light-model call over the passages that share the most words with the question, four at a time and only for 25 seconds after the first note. |
| RESEARCH-QUERY-04 | Planned searches are plain keywords, cut to eight words in code. |
| RESEARCH-ENGINE-01 | An engine that returns five rows or more and none relevant twice in a row is benched for 30 minutes; every benching is logged. (The per-engine bench and rotation shared across turns already existed.) |
| RESEARCH-FABRICATION-01 | A sentence naming someone or something no source, note or article gives is marked "(not in the sources)"; an uncited sentence that states a figure or a name is claim-checked. |
| RESEARCH-NEUTRAL-01 | Owner ruling: nothing in the research path is written for one kind of subject. `researchNoTopicWords.test.ts` scans the source for topic words (allowlist with reasons); one code path is proven on seven subjects. |
| RESEARCH-EVAL-02 | The eval checks identification, fabrication and family-name-only mentions, narrows the credit judge, and records pages read and light-model seconds. |

**Measured window.** The Stack reports 131,072 tokens for the chat model, so a live turn's evidence cap is 16,000 characters. The 2,867-character figure in the review came from a bench path where the window was not read (the 2,048-token fallback). Each research writing round now leaves a mark of the window and the sizes it used.

**Not built.** Parallel searches inside one round (the tool node runs a round's searches one after another; page reads are parallel), the progressive first answer, and a larger writer model for Max (measure first). A homelab proposal for the household search (drop or pin the engine that returns unrelated rows, add engines with no quota) is in the report of this change, not applied.
