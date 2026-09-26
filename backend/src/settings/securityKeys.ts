// INCOGNITO-07: session lock with PIN re-entry, a standalone capability
// (not Incognito-specific plumbing) - any account can be configured, by
// an owner or admin, to lock behind its PIN after inactivity. Content
// stays mounted underneath; unlocking is the same PIN/password check a
// real sign-in already uses. The write rule (owner/admin only, for any
// target - wider reach than the generic person-scope gate, which lets
// everyone edit their own with no ladder check) lives in settings.ts's
// assertCanSetSessionLock(), not in this declaration, the same "no field
// here carries a writer rule" convention every settings key in this repo
// already follows (searchKeys.ts's own safe_search comment).
import { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";

export const SECURITY_SETTINGS_KEYS: SettingsKey[] = [
  SettingsKey.parse({
    key: "security.session_lock_required",
    scope: "person",
    selector: "boolean",
    default: false,
    label: "Require PIN to unlock after inactivity",
    help: "When on, this account locks behind its PIN or password after sitting idle. Content stays put; unlocking just re-enters the PIN. Set by an owner or admin, for any account.",
    level: "expert",
    lives_in: "person.security",
    honoured_by: ["home"],
  }),
  SettingsKey.parse({
    key: "security.session_lock_timeout_minutes",
    scope: "person",
    selector: "number",
    default: 5,
    range: { min: 1, max: 120 },
    label: "Session lock timeout (minutes)",
    help: "How many minutes of inactivity before this account locks, when session lock is required.",
    level: "expert",
    lives_in: "person.security",
    honoured_by: ["home"],
  }),
];
