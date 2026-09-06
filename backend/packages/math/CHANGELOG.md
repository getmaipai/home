# Changelog

All notable changes to the Math package, in [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

## [0.1.0] - 2026-09-06

### Added

- Evaluates a math expression (session-d-packages-and-store.md step 7),
  via the `compute` step's restricted evaluator (step 4). Standard
  notation only (`+ - * / ^`, `sqrt()`, `%`) - no natural-language
  operator words ("times", "plus"). No network.

### Fixed

- A malformed expression used to propagate as an unhandled error all
  the way to the API route instead of a clean 400 - `lib/plugins.ts`'s
  `runPlugin()` and both recipe interpreters now preserve `ComputeError`'s
  own identity instead of erasing it, the first real package to exercise
  this path since `compute` shipped (step 4).
- A real gap found by code review: `routing.patterns` originally included
  `"solve *"` and `"evaluate *"`, both generic enough to also match
  non-math speech ("solve my marriage problems", "evaluate my
  performance") - and since a literal pattern match wins immediately over
  every other routing signal (`turnEngine.ts`'s own `route()`), a false
  match forecloses the model entirely for that turn instead of falling
  through to a real answer. Narrowed to `"calculate *"`, `"compute *"`,
  and `"what does * equal"`, which collide with everyday non-math phrases
  far less often. The underlying risk is architectural (a required-arg
  package can only ever route via a literal wildcard pattern, and a
  match can't yet decline and fall through), not something one package's
  pattern list can fully eliminate - narrower patterns lower the odds,
  they don't remove them.
