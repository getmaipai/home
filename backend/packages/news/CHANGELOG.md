# Changelog

All notable changes to the News package, in [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

## [Unreleased]

### Changed

- The column's Manage row is gone: News settings now has a Following row that opens the same page.
- Pictures inside a story load (their address lacked the width the picture route requires).

### Added

- A Search page (not in the tab strip) with a search box on every page that shows stories, topic chips on Today and My Mix, a date line, day headings and a line above each headline.
- Recent searches, kept per person on this hub, never for a child.

## [0.3.0] - 2026-10-17

### Added

- Six schema pages: Today, My Mix, Following, Saved, Channel and Story.
- News settings for reading choices, the shelf lists and extra feeds.
- Package data declarations and privacy rows for pictures, full stories and archived pages.

### Changed

- The app can show cached shelf stories without internet.
- My Mix requires teen controls; the other pages inherit child controls. Guests cannot open News.

## [0.2.0] - 2026-10-12

### Changed

- While the News shelf is on (Settings, News shelf), the answer comes from the headlines the shelf already saved for the asker's kind of person, and the live NPR request is not made. With the shelf off, the live NPR path below is used as before. The minor safety floor runs over both.
- The handler also returns up to eight candidate headlines as data, so the host can check each one against the minor safety floor before a child or teen sees any.

## [0.1.0] - 2026-09-06

### Added

- Top news headlines (session-d-packages-and-store.md step 7), from
  NPR's own public RSS feed (`feeds.npr.org`) - no API key, no per-topic
  personalization. Reads the top three headlines from the feed's `<item>`
  titles, cached 15 minutes via `host.fetch`'s own cache.

### Known gap

- The plan calls for "RSS from a household-chosen list" - this ships
  one fixed feed instead. A real per-household feed choice needs a
  settings key a Tier 1 package's sandboxed process can actually read
  (no such host method exists yet on any package), which is more
  platform work than this lookup's own bronze scope justifies inventing
  un-exercised. Deferred honestly rather than built speculatively.
