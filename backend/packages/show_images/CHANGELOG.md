# Changelog

All notable changes to the Show Pictures package, in [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

## [0.1.0] - 2026-10-06

### Added

- ANSWER-IMG-02: the `show_images` tool. The chat model names the thing to
  show; Home answers it at once and fetches a few checked pictures beside the
  answer through its own picture proxy. A person subject gets pictures only
  from Wikimedia sources tied to their Wikipedia article, never from image
  search; a living person under 18, a private person and a name with no
  Wikipedia article get none. Children get pictures only after a parent turns
  them on. Not offered to the model until ANSWER-IMG-05's bench passes.
