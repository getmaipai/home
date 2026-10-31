# Changelog

All notable changes to the Household news feeds package, in [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

## [0.5.1] - 2026-10-31

### Removed

- Hacker News and Slashdot feeds because their story content, images, icons, or feed access are unreliable.

## [0.5.0] - 2026-10-18

### Added

- Grist and The Guardian's wildlife feed for Environment.

### Changed

- Every feed now names one topic (BBC Science and Environment and Popular Science are Science), so a story starts under one topic, and the hub's topic step moves a story only when its words clearly point elsewhere.

## [0.4.0] - 2026-10-18

### Removed

- Fast Company and Inc.: both refuse Home's page requests (HTTP 403), so their stories could only show the feed's short summary.

## [0.3.0] - 2026-10-18

### Added

- Topic feeds: NPR (World, Business, Technology, Science, Health, Sports, Culture), BBC (World, Business, Technology, Science and Environment, Health, Entertainment and Arts, Sport) The Guardian (World, Business, Technology, Science, Health, Sport, Culture, Climate crisis) and CBC News (World, Business, Technology, Health, Sports, Arts). Sports Illustrated, Popular Science, Fast Company, Inc. and Variety. Each feed carries `topics_hint`, so its stories fill the matching News topic.

## [0.2.0] - 2026-10-14

### Added

- NASA news releases.

## [0.1.0] - 2026-10-12

### Added

- The feed list for the "Household news" choice on the News shelf: NPR News, BBC News, PBS NewsHour headlines.
