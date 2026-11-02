# Changelog

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
