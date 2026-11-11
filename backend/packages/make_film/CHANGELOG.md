# Changelog

## [Unreleased]

### Added

- The finished film now lands within a second or two of the length you ask: the title card and the credits count toward it, shot lengths are worked out in code, and a film that still comes out off says so.
- Attach several pictures and the film works out what each is for: a person plays a part, a product is shown off, a room is the set, a building is the closing wide shot. Each picture is saved as a character, prop or place, and every shot starts from the picture of what it is about.
- A synth of yours can play a part in a long production: name it in the cast and its saved picture and look are used, like a saved character.
- A long production no longer adds a title card and credits to every scene: only the first part has the title and only the last has the credits, so the length matches the ask.
- Pictures attached to a long production become its named characters (one name per picture, in order); saved characters can be named too. Their pictures start the stills so the face carries through.

## [0.4.0] - 2026-11-10

### Added

- A request longer than two minutes (or naming a production) writes a long production in steps: treatment, then cast and places, then scenes, each approved before the next. The length is never fixed to particular values.

## [0.3.0] - 2026-11-06

### Added

- Optional requested film length, used to size shots and faceless narration.

## [0.2.0] - 2026-11-06

### Added

- Optional faceless films with household voice narration and Ken Burns motion on stills.

## [0.1.0] - 2026-11-06

### Added

- Start a background film plan from chat and return its run id at once.
