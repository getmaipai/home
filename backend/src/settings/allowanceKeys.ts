// Step 7: "time allowances... per category as household settings
// enforced in the package host's ctx (D reads ctx.allowance; you write
// it)" (session-f-platform-and-trust.md, step 7). This file is the "you
// write it" half: the household's configured daily limits, one key per
// manifest category (spec/schemas/manifest.schema.json's own closed
// list) - a limit is inherently about one child, never the whole house
// at once, so every key is person-scoped, the same shape
// notifications.telegram.chat_id already uses for "my own settings, not
// the house's".
//
// Deliberately daily-minutes only, not the full "and schedules" half of
// that plan sentence: a time-of-day window ("no Fun after 8pm") needs
// either the `time` selector (no existing key uses it yet, and nothing
// in the frontend renders one today - a code review would rightly ask
// "does this control even work") or a JSON blob (which the settings
// standard's one-atomic-value-per-key shape does not support). Landing
// an untested selector shape to satisfy the letter of the plan text
// would be exactly the kind of half-finished feature this org's
// standards warn against; docs/dev/session-f.md records this as the
// deferred half, to pick up once `time` has a real renderer.
//
// `daily_minutes: 0` means "no limit configured" - adding this feature
// to an existing house changes nothing until a parent actually sets a
// number, the same "nothing a family can do today stops working"
// posture this whole step's grant work already follows.
//
// Reading a limit: lib/allowance.ts's dailyMinutesAllowed(). This file
// only declares the keys; it holds no runtime logic itself, the same
// split every other *Keys.ts file in this directory already follows.
import { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";

export const ALLOWANCE_CATEGORIES = ["Home", "Family", "Info", "Fun", "Media", "Robot body", "Health", "Learning", "Utilities"] as const;
export type AllowanceCategory = (typeof ALLOWANCE_CATEGORIES)[number];

export function allowanceKeyFor(category: AllowanceCategory): string {
  return `allowance.${category.toLowerCase().replace(/\s+/g, "_")}.daily_minutes`;
}

export const ALLOWANCE_SETTINGS_KEYS: SettingsKey[] = ALLOWANCE_CATEGORIES.map((category) =>
  SettingsKey.parse({
    key: allowanceKeyFor(category),
    scope: "person",
    selector: "number",
    default: 0,
    label: `Daily ${category} minutes`,
    help: `How many minutes of ${category} packages this person may use per day. 0 means no limit.`,
    level: "basic",
    lives_in: "person.allowance",
    honoured_by: ["home"],
  }),
);
