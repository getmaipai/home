# Changelog

All notable changes to the Lock the Front Door package, in [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

## [0.1.0] - 2026-09-06

### Added

- Locks the front door through the household's own Home Assistant
  instance (session-d-packages-and-store.md step 9), via
  `home.call_service` (`lock.lock`) - the plan's own `consequential:
  true` example, proving the confirm path from the package side. A
  fixed `entity_id` for now (`lock.front_door`); a household picking
  its own lock entity is settings/UI work this step's own "prove the
  mechanism" scope didn't need.

### Fixed

- A real, previously-unenforced safety gap found building this package:
  `turnEngine.ts`'s `route()` only checked a package's own
  `consequential` flag on the fuzzy/Tier 2 path - a consequential
  package that ALSO declared a literal `routing.patterns` entry would
  have fired immediately on that pattern match, bypassing confirmation
  entirely. `route()` now refuses to treat a consequential manifest's
  own patterns as live at all (this package declares none, by design);
  a new bronze-completeness check
  (`spec/tests/ts/package-bronze.test.ts`) also catches a future
  package declaring both at authoring time.
- A second gap a review pass found: `min_role` was set to `child`,
  but `consequential`'s confirm step re-runs the plugin as the same
  actor who confirmed - it is not a second, higher-privileged check.
  Left at `child`, a child could ask to lock the door, confirm their
  own "yes", and `runPlugin`'s `meetsMinRole` gate would trivially
  pass. Raised to `teen`, since `min_role` is the only real gate on
  who can trigger a security-domain action here, not the confirm
  prompt itself.
