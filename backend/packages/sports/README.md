<!-- Store card. Dad test: grade 6, one action per step, no jargon. -->
# Sports Scores

Ask MaiPai for today's MLB scores.

## Try it

- "what's the score"
- "any scores today"
- "how are the games going"

MLB only for now - no way to pick a favorite team or league yet. Reports
games that have started; a game that hasn't started yet is left out
rather than shown as a false 0-0.

## What it needs

Nothing to set up. Works as soon as it's installed.

## What it uses

A plain, unauthenticated request to MLB Advanced Media's own public
stats API - the same one mlb.com's own site calls. Nothing about your
household is sent - just "what's today's schedule."

## Offline

Needs an internet connection. Says so plainly if it can't reach MLB.

## License

AGPL-3.0. See the repository's LICENSE.
