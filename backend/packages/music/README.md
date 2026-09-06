<!-- Store card. Dad test: grade 6, one action per step, no jargon. -->
# Music Lookup

Ask MaiPai about a music artist or band.

## Try it

- "look up the artist Radiohead"
- "look up the artist Adele"
- "who is the singer Prince"

Artists only for now - not songs, albums, or playback. Movie and TV
lookup is a separate feature, not built yet.

## What it needs

Nothing to set up. Works as soon as it's installed.

## What it uses

A plain, unauthenticated request to MusicBrainz's own public search API.
It sends the artist's name as typed, nothing about your household.

## Offline

Needs an internet connection. Says so plainly if it can't reach
MusicBrainz.

## License

AGPL-3.0. See the repository's LICENSE.
