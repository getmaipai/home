<!-- Store card. Dad test: grade 6, one action per step, no jargon. -->
# Weather

Ask MaiPai what the weather is like anywhere: the temperature right now,
what the sky is doing, today's high and low, and the chance of rain. The
answer is one weather card: right now, the next 24 hours and the next
8 days.

## The Weather app

Open Weather from the app list to see the same card for any place you
choose. The picker starts with Current location (your device asks you
first, only when you pick it), then your home, then the places you saved.
To add or remove a place, tap the gear. Nobody sees another person's
saved places.

## Try it

- "what's the weather in Seattle"
- "how's the weather in Chicago"
- "weather in Denver"
- "is it going to rain in Portland today"

## What it needs

Nothing to set up. Works as soon as it's installed.

## What it uses

Weather looks up a place only when someone names one. Otherwise, only rounded
coordinates go to Open-Meteo, a free weather service. The forecast covers now,
the next 24 hours and the next 7 days. A recent answer for the same place is
remembered for a little while, so asking again right away doesn't need a new
lookup. See
the household's Privacy page for the full "what leaves the house" row.

For the hourly background refresh, Home substitutes the household's home place for the
`__HOME_PLACE__` manifest placeholder. The placeholder is never sent to Open-Meteo.

## Offline

Weather needs the internet - it can't answer without it.

## License

AGPL-3.0. See the repository's LICENSE.
