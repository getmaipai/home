# NEWS-07 background full text

Reuse verdict: reuse `loadContent`, `pageHtml`, `fetchCache`, `extractFullArticle`, the shared limiter, the shelf release path, Today ranking and the scheduler. No new fetcher, model call or UI component.

The household setting defaults on (owner, 2026-10-25; the default lives in `spec/settings/keys.json`, spec 0.1.226). The per-minute core job skips active turns, guests, disabled or deleted profiles, memorialized profiles and people whose app or owning pages are not accessible. Candidate selection uses released cards, explicit follows and Today's hero plus featured set. It writes no read, affinity or interest record. Stored articles of any band are skipped. Prefetched child content uses the child variant and is sentence-gated into blocks and speech again by the existing release path.

`prefetchBudget.ts` owns receipt and quiet tables created by the shelf store in `knowledge.db`. A transaction reserves a canonical URL once and checks that site's own 30 second floor and its rolling 24 hour count of 150. The worker also uses the shared limiter. Receipts outlive shelf pruning; deleting the cache database clears them. No person id is stored in the budget tables. A background request never follows redirects or invokes Wayback. A false `robots_ok` cache entry is not used.

The first failure or unusable page quiets that site's background full text for one hour (other sites carry on). Further failed probes on it double the wait to a maximum of one day. A pass runs once a minute and asks each site at most once. The next probe is a different eligible item, never a retry. Foreground opens keep their existing behavior.

## Verification

`newsPrefetchBudget.test.ts` simulates 86,400 seconds and two competing sites. Each site receives exactly 150 reservations. Every accepted pair is at least 30 seconds apart, including midnight. Reopening the database retains lifetime receipts. A second test checks quiet-window growth, persistence across handles and recovery.

The budget tests passed: 3 tests, 0 failures. A third test checks that two database handles share receipts, pacing and quiet state. They ran with an empty test-preload config because they import only Bun SQLite and the budget module, with no app or network dependencies.

`newsPrefetch.test.ts` covers default-off, explicit open, idle checks, child, teen, adult and guest selection, a child's prefetched release, no inferred records, robots refusal, first-block quiet mode, no Archive expansion and privacy visibility. Two attempts to run this file stopped in the shared preload, before the tests: `reserveFreePort` found no usable port in 200 tries. These integration checks remain unverified in this environment. No live publisher was contacted. The preflight and full gate were not run under this task's narrow-test restriction.
