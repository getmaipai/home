<!-- Store card. Dad test: grade 6, one action per step, no jargon. -->
# Currency

Ask MaiPai to convert an amount from one currency to another.

## Try it

- "exchange 100 dollars to euros"
- "exchange 50 usd for gbp"
- "exchange 20 euros to dollars"

Say "exchange", not "convert" - convert is for physical units (miles,
kilograms, that kind of thing), a different package with a different
trigger word. Works for common currency names (dollars, euros, pounds,
yen, francs, yuan, rupees, pesos) and any three-letter currency code.

## What it needs

Nothing to set up. Works as soon as it's installed.

## What it uses

A plain, unauthenticated request to Frankfurter's own free exchange-rate
API (built on European Central Bank reference rates). It sends the two
currency codes and the amount, nothing about your household.

## Offline

Needs an internet connection. Says so plainly if it can't reach the
exchange-rate service.

## License

AGPL-3.0. See the repository's LICENSE.
