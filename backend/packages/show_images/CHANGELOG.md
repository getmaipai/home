# Changelog

All notable changes to the Show Pictures package, in [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

## [Unreleased]

### Fixed

- IMG-QUALITY-01a: the result line no longer tells the model to describe the
  subject itself (it invented how a person looked in photos it had not seen).
  It now says the photos are on screen, unseen by the model, and to answer
  other questions from what it knows.
- ANSWER-IMG-06: `kind` is marked `grounded: false`. It is the model's own
  label ("person", "building", "animal"), not the person's words, and the
  grounding check refused every call whose kind the person had not said, so
  "show me a picture of Michael Jackson" got "I don't actually have that" and
  no pictures. The `subject` is still checked against what the person said.

### Changed

- IMGSEARCH-01: a required `kind` argument says what kind of thing to show
  ("animal", "TV series", "car"), so a name with several meanings shows the
  one the conversation is about, or nothing. Pictures from the open web are
  ranked by how often each engine was right in a measured study (Bing first),
  must name the thing, and must not carry words of another thing with the
  same name.
- ANSWER-IMG-05b: the description names games, and the `subject` argument
  names artwork, says to show photos in short, casual replies too and carries
  a film remark example ("I just watched Jaws again"). The tool's answer to the
  model is about half as long and lets it describe the thing from what it
  knows, never the photos. Pictures must now be of the thing: a picture needs
  two signs that it shows the subject, and Commons' own labels for costumes,
  fan art, crowds, screenshots and personality rights keep strangers and
  screen captures out of a thing's row.
- ANSWER-IMG-05: the description asks for photos whenever someone asks about
  or mentions a famous person, place, film, show, animal, car or product, and
  the `subject` argument carries two short examples; measured on the real
  model, recall went from 65.5 to 80 percent with no call on a non-visual row.
  Still not offered to the model: recall and the time to first text when it is
  called alone miss their bars.

## [0.1.0] - 2026-10-06

### Added

- ANSWER-IMG-02: the `show_images` tool. The chat model names the thing to
  show; Home answers it at once and fetches a few checked pictures beside the
  answer through its own picture proxy. A person subject gets pictures only
  from Wikimedia sources tied to their Wikipedia article, never from image
  search; a living person under 18, a private person and a name with no
  Wikipedia article get none. Children get pictures only after a parent turns
  them on. Not offered to the model until ANSWER-IMG-05's bench passes.
