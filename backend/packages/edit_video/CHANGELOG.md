# Changelog

## [Unreleased]

### Changed

- `film` joins a Production's finished shots in script order, with its title, cast credits and a fade by default; the finished cut is saved on the Production.
- VIDEO-LORA-10: `styles` and `strength` for another_take, remix and continue. Left out, the new video keeps the first one's styles; an empty list takes the style off. Names only, never ids; a name the person never said is not matched.
- Add reframe, grade, speed and timed captions to finished video edits.

## [0.6.0] - 2026-11-05

### Added

- Join clips with a transition, title card, and rolling credits in one finished film.

## [0.5.0] - 2026-11-05

### Added

- Reframe, grade, change speed, and add timed captions to finished videos.

## [0.3.0] - 2026-11-02

### Added

- VIDEO-INPUTS-01: `continue` starts a new video from the last picture of one of your videos, with new words if you give them (else the old ones), at the same level and look unless you change them. It needs a computer whose video model can start from a picture; if not, it says so in plain words. The first video is kept.
- `join` takes `transition` (`cut` or `crossfade`) and `transition_s` (0.3 to 1 second, half a second by default). Crossfades are not available yet: asking for one says so and offers a straight cut.

## [0.2.0] - 2026-11-02

### Added

- VIDEO-CHAT-01 (C3, C4): `trim` cuts a video, `join` puts two to six of your own videos in order into one, and `mix` lays a spoken line (in your voice or a named home voice) or one of your songs over a video at a balance from quiet to very loud. Each makes a new video and keeps the old one. They run on the video editor on this computer; no video model is needed.
- `retake` is not offered yet.

## [0.1.0] - 2026-11-02

### Added

- VIDEO-CHAT-01: change a video made in chat with `another_take`, `remix` and `make_it_max`, on the same function the Create page's buttons use. Offered only once the chat holds a finished video.

## [0.4.0] - 2026-11-05

### Added

- VIDEO-INPUTS-06: extend a finished Max clip by a chosen number of seconds, or retake it from a chosen time with optional new words. The first clip stays saved.
