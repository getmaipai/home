# Changelog

All notable changes to the Make a Picture package, in [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

## [Unreleased]

### Changed

- RECENCY-02: the description says the tool is never used to show something real that already exists (a poster, photo, film, person); that is `show_images`.

## [0.2.0] - 2026-10-17

### Added

- IMGEDIT-05: `affects_people`. A change that is not about a person (sky, colour, background, an object, the light) works on a photo that shows people: they are kept exactly as they are.
- IMGEDIT-01: the same tool changes a picture the person already has. With `change` set (`attached`, `attached_2` or `latest`) the prompt is the instruction: remove a person (`kind: remove_people`, nothing is drawn, the place is filled from the surroundings), or any other change in words (sky, colour, background, light, add something, add a person from a second picture with `reference`). The original is kept; the result is the next version of the picture, with Undo in the editor. A photo of a person is changed or used only for an adult in this household who agreed (`photo_subject`), checked the way the editor's Comment checks it, and the finished picture goes through the finished-picture check.

## [0.1.2] - 2026-10-17

### Added

- IMGGEN-QUALITY-01: an optional `quality` argument, `quick` or `detailed`. Left out, Home uses the household's Picture quality setting (Quick by default). The model sets `detailed` only when the person asks for the best quality, fine detail, a photoreal picture or a custom look, and says so in one line. A style made for the detailed maker makes the picture Detailed on its own.

## [0.1.1] - 2026-10-17

### Changed

- LIKENESS-01: a picture can use a saved style of an adult in the household, only if that adult has agreed in their own Settings, Pictures and videos. The gates run at the policy node, at the tool and again while the picture waits; the person it looks like is told each time.

## [0.1.0] - 2026-10-17

### Added

- IMGGEN-HOME-01: the `generate_image` tool. Offered only to an adult on their own written screen when the household has pictures on. Home checks the two absolute lines before any job starts, runs the job on the Stack's picture engine, shows progress with a Stop button and stores each picture as the person's own file.
