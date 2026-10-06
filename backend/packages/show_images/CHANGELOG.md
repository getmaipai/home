# Changelog

All notable changes to the Show Pictures package, in [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

## [Unreleased]

### Changed

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
