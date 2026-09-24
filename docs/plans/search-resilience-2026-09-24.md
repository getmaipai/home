# Search resilience: knowing when search is down, and a second front door (2026-09-24)

## Why

On 2026-09-24 the household's SearXNG answered every query with zero
results for hours. All three of its upstream engines had suspended it (two
for too many requests, one with a CAPTCHA), because live benches had sent
it far more queries than a person would. Home never noticed: an empty
result was a "succeeded" outcome, nothing reported the suspension, and the
chat model answered from its own memory instead, confidently wrong, and
contradicted the person three times on a question a single encyclopedia
page answers. Three things were missing: Home did not know search was down,
nobody was told, and there was no second source.

## What this adds

**1. Search knows its own health (SEARCH-HEALTH-01).** SearXNG already
reports the problem on every response: its JSON carries
`unresponsive_engines`, each with a reason ("Suspended: too many requests",
"Suspended: CAPTCHA"). The one choke point (`packageHost.ts`
`searxngSearch`) records that on each call, so search's state is always
current: ok, degraded (some engines suspended), or down (no engine
answering, or the instance unreachable), with the reason and the time it
started. That state is one more row in the health list (`SERVICES.md`), and
the admin gets a notification when search goes down and again when it
recovers (`NOTIFICATIONS.md`, one of each, never one per failed query).
While search is down, the rule in `THIRD-PARTY-SERVICES.md` applies: only a
person's own searches go out, nothing in the background, and one probe
query every 15 minutes until an engine answers again.

**2. An honest reply when search fails (SEARCH-EMPTY-01, already ordered).**
When search is down, the reply says so. When it worked but found nothing,
the reply says so. It never falls back to the model's own knowledge and
never contradicts the person.

**3. A second front door: Wikipedia (SEARCH-FALLBACK-01).** When SearXNG is
down or returns nothing, the websearch tool asks Wikipedia through its
official, documented API (search, then the page summary), with the
descriptive User-Agent Wikimedia's API policy requires and through the same
per-host rate limiter. The results come back in the same row shape, with
the page as the cited source. This covers people, shows, places, products
and history, the kind of question that failed on 2026-09-24. It is a new
outbound connection, so it gets its row in the user-tier privacy page ("what
leaves the house": the search words, sent to Wikipedia, only when web search
is on and the main search failed) and a setting under web search, on
whenever web search is on.

**4. Optional, later: a keyed search API (SEARCH-KEYED-01).** A household
that wants a third source can paste its own key for an official search API
that offers a free tier. It is off by default, gets a settings entry and a
privacy row, and goes through the same limiter. It is built only if the
owner asks for it.

## What this does not do

It does not scrape search engines. Loading a search engine's result pages
and parsing the HTML is the anonymous scraping `THIRD-PARTY-SERVICES.md`
rules out ("never behaves like a scraper"; "prefer the front door"). It is
also what gets a home's address blocked, which is exactly the failure this
note responds to. Every source here is an official API.

## Never flooding search (SEARCH-PACE-01, built with SEARCH-HEALTH-01)

The way to avoid being blocked is to never look like a flood. Every query
to SearXNG, and later to Wikipedia, goes through one token bucket per host
at the choke point. Its budget is a person's pace: a burst of three, then
about one query every six seconds on average. The budget states its
numbers in the item. A query that would exceed the budget waits for a
person's turn; a background one is dropped. The first suspension signal
(an `unresponsive_engines` entry, a 429, a CAPTCHA) puts that host in quiet
mode at once, as above. Home never retries through a block, never rotates
engines to get around one, and never widens a failing query into several.
A turn makes at most one search call per tool round, and the tool budget
already caps rounds.

## Benches

A bench never sends queries to a household's real SearXNG unless the
coordinator has cleared that run. A cleared run goes through the same
per-host limiter at a person's pace, and its record names the query count.
The limiter is per process today, so a bench process has its own budget.
SEARCH-HEALTH-01 therefore also makes the bench runner refuse a real
SearXNG URL unless the clearance flag is set.

## Order

SEARCH-EMPTY-01, then SEARCH-HEALTH-01 with SEARCH-PACE-01, then
SEARCH-FALLBACK-01. Each gets
its BACKLOG row in the item template when it is built.
