# Changelog

All notable changes to the Translate package, in [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

## [0.1.0] - 2026-09-06

### Added

- Translates text (session-d-packages-and-store.md step 7), via
  `host.llm.complete` and the household's own local chat model - the
  plan's own "a local model first" call. Nothing leaves the house, no
  network call, `offline: full`. The whole captured phrase (text plus
  target language, in whatever order a person says it) goes to the
  model in one prompt asking it to identify both itself, rather than
  this package parsing them apart first - unlike `currency`'s own small
  parser, splitting "the language name" out of free text is exactly the
  kind of fuzzy natural-language task a model is suited for and
  deterministic string parsing is not.

### New platform capability

- This is the first package to use the new `llm_complete` recipe step
  (`spec/schemas/recipe.schema.json`), wired through both interpreters
  (`spec/interpreters/{ts,py}/recipe-interpreter.ts`) and the real host
  (`backend/src/lib/packageHost.ts`'s `llm.complete`, previously a
  `capability_missing` stub since the `chat` role landed with no recipe
  step to call it). Binds the same raw `{"text": string}` shape `fetch`'s
  own `as` binds - a `pick` step reads `.text` out before `format`
  interpolates it, no new binding convention invented for this one step.
  A network translation service is a separate, explicitly opt-in
  package per the plan, not built yet.
