// APP-SET-02: what a child or a teen could see in Settings before the
// per-app settings areas (the old Me tab, 2026-10-06). A settings area never
// shows a minor more than this, however a key is later placed in a card
// (architect condition C-G3: "a child or teen sees no more than before").
// An adult, admin or owner is not limited by it.
//
// Relative imports only: the frontend reads this file through wire.ts, the
// same way it reads the role helpers, so the page and the server's global
// search share one definition (principle 4).

const TELEGRAM_EVENTS = [
  "approvals.requested", "backups.target_failing", "engines.problem", "engines.update_applied", "engines.update_available",
  "engines.update_failed", "file.shared_with_household", "file.shared_with_you", "memory.judge_failed", "memory.updated",
  "model.download_failed", "model.download_ready", "person.band_changed", "repairs.new", "updates.available",
];

/** The person-scope keys a child saw: personality, safe search, voice, the
 * alert switch and muted senders, quiet hours, Telegram, appearance and the
 * enrollment-sounds switch. */
export const CHILD_VISIBLE_SETTING_KEYS: readonly string[] = [
  "persona.active_id",
  "search.safe_search",
  "tts.voice_id",
  "notifications.browser.enabled",
  "notifications.file_shared.muted_senders",
  "person.quiet_hours.from",
  "person.quiet_hours.to",
  "notifications.telegram.chat_id",
  ...TELEGRAM_EVENTS.map((event) => `notifications.${event}.telegram`),
  "ui.appearance",
  "ui.look",
  "ui.show_turn_stats",
  "ui.enrollment_sounds",
];

/** A teen saw everything a child did, plus the chat photo switch (a child's
 * is a parent's to set). */
export const TEEN_VISIBLE_SETTING_KEYS: readonly string[] = [...CHILD_VISIBLE_SETTING_KEYS, "chat.photo_uploads"];

/** The keys a viewer of this band may be shown, or `undefined` for an adult
 * band, which has no such limit. */
export function minorVisibleSettingKeys(band: "child" | "teen" | "adult"): ReadonlySet<string> | undefined {
  if (band === "child") return new Set(CHILD_VISIBLE_SETTING_KEYS);
  if (band === "teen") return new Set(TEEN_VISIBLE_SETTING_KEYS);
  return undefined;
}
