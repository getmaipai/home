# Changelog

All notable changes to the Reminders package, in [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

## [0.1.0] - 2026-09-06

### Added

- Sets a reminder for a later time (session-d-packages-and-store.md
  step 8), via the new `remind` recipe step and `host.reminders.set`
  (`lib/reminderParsing.ts`'s real chrono-node time/task extraction,
  `lib/scheduler.ts`'s new `scheduleCoreJob`). Schedules a "core" job,
  never a replay of this recipe: firing later raises the declared
  `remind.due` notification directly (`lib/scheduler.ts`'s
  `CORE_JOBS["reminders.fire"]`). No network, no model - `offline: full`.

### Fixed

- Real gaps found by testing beyond the initial handful of phrasings
  (code review, 2026-09-06): a dangling leading preposition when
  chrono-node's own match doesn't cover a whole prepositional phrase
  ("at noon and..." -> "at and..." once only "noon" is matched, now
  stripped in a loop rather than a single pass); a stray possessive
  fragment when chrono's match cuts a word in half ("tomorrow's show"
  -> "'s show" left over); and a recurring reminder ("every morning at
  8") that used to silently resolve as a one-time reminder for the next
  occurrence only, dropping the recurrence entirely - now rejected with
  a clear message instead. A compound relative duration ("in an hour
  and a half") can still resolve short, since chrono-node's own match
  doesn't always cover the whole phrase - documented as a known
  limitation (this package's own README) rather than chased further:
  say a single unit ("in 90 minutes") for reliable results.
