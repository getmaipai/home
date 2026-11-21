// Bundled packages that are read-only factual lookups: for them an EMPTY successful result means the lookup produced no
// information, so it is treated as a miss (machine-written "could not look that up" path) and never left bare as "succeeded".
// Lists, schedules, reminders, timers, calendars, recall, feeds, conversions, calculations and every action keep an empty
// successful result as a valid answer (an empty list is true; a silent action succeeded).
export const EMPTY_LOOKUP_MISS_PACKAGES: ReadonlySet<string> = new Set(["weather", "place-lookup", "currency", "book-lookup", "media-lookup"]);
