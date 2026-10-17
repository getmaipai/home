# Changelog

All notable changes to the Make a Video package, in [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

## [0.1.1] - 2026-10-17

### Changed

- LIKENESS-01: a video can start from a photo the person attaches (`from_picture` "attached" with `photo_subject`) or use a saved style of an adult in the household, but only for an adult who has agreed in their own Settings, Pictures and videos, with the photo checked to show only that one adult. The gates run at the policy node, at the tool and again while the clip waits; the person it looks like is told each time.

## [0.1.0] - 2026-10-17

### Added

- VIDEO-GEN-05: the `generate_video` tool. Offered only to an adult on their own written screen when the household has video on and the Stack has a video model. Home checks the two absolute lines before any job starts, runs the job on the Stack's video engine, shows progress with a Stop button and stores the clip and its poster as the person's own files.
