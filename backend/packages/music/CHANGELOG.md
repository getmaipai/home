# Changelog

All notable changes to the Music Lookup package, in [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

## [0.1.0] - 2026-09-06

### Added

- Looks up a music artist (session-d-packages-and-store.md step 7), via
  MusicBrainz's own public search API - no API key. Reports what kind of
  act it is (band, solo artist, orchestra, choir), where they're from,
  and when they formed or were born (and disbanded or passed away, when
  known). Sends a real identifying User-Agent per MusicBrainz's own
  etiquette (`host.fetch`'s `opts.headers`), the first bundled package to
  override the default.

### Fixed

- A real, documented collision, the same class the math package hit
  (step 7): `routing.patterns` originally included "tell me about the
  band *", but `knowledge` (step 7's own general lookup) already owns
  the literal "tell me about *" pattern, and `knowledge` sorts before
  `music` by id - so that pattern could never actually fire, dead behind
  knowledge's own match. Dropped from both `routing.patterns` and
  `routing.examples`.

### Known gap

- The plan's fuller "music and media lookup" also names movie/TV
  metadata via a TMDB-style API "with the user's own key where
  required." That needs a household-supplied secret a Tier 1 package's
  sandboxed process can actually read, which no package has a way to do
  yet - deferred to docs/BACKLOG.md rather than built on settings
  infrastructure that doesn't exist. Songs and albums (not just artists)
  are the same "not yet, scoped down honestly" call.
