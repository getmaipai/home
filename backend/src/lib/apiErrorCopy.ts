// I18N-B2 (design note i18n-2026-11-07, section 9 step 3): the one table of API error wording a screen prints, with no imports so any
// module may read it. A route sends `apiError("code")`: the English `error` (and `next` when the line has one) plus the stable snake_case
// `code`, additive next to the shapes the route already sent. The web client maps the code back to the descriptor here and translates it
// (frontend/src/lib/apiErrorLines.ts); a code it does not know, or text that differs from this table, shows the server's own English.
// Every other `error` string in the routes is developer text (docs/dev/api-error-audit.md lists them). A minor-facing line has its own
// `minor` flag and an id containing "minor", so the translate script never fills it. An i18n magic comment marks each literal so
// `lingui extract` (frontend/lingui.config.ts includes this file) puts it in the catalogs.
export interface ApiErrorDescriptor { id: string; message: string }
export interface ApiErrorLine { error?: ApiErrorDescriptor; next?: ApiErrorDescriptor; minor?: true }

export const API_ERROR_LINES = {
  profile_not_found: { error: /*i18n*/ { id: "api.error.profile_not_found", message: "Profile not found" } },
  profile_needs_secret: { error: /*i18n*/ { id: "api.error.profile_needs_secret", message: "This profile needs its PIN, password, or passkey" } },
  no_secret_set: { error: /*i18n*/ { id: "api.error.no_secret_set", message: "No PIN or password set for this profile" } },
  attempts_locked: { error: /*i18n*/ { id: "api.error.attempts_locked", message: "Too many attempts" } },
  totp_restart_sign_in: { error: /*i18n*/ { id: "api.error.totp_restart_sign_in", message: "Start signing in again with your PIN or passkey." } },
  totp_code_mismatch: { error: /*i18n*/ { id: "api.error.totp_code_mismatch", message: "That code didn't match." } },
  totp_enroll_mismatch: { error: /*i18n*/ { id: "api.error.totp_enroll_mismatch", message: "That code didn't match. Check your authenticator app's time and try again." } },
  totp_already_on: {
    error: /*i18n*/ { id: "api.error.totp_already_on", message: "Two-step sign-in is already on." },
    next: /*i18n*/ { id: "api.next.totp_already_on", message: "Turn it off with a code first, then set it up again." },
  },
  passkey_rate_limited: { error: /*i18n*/ { id: "api.error.passkey_rate_limited", message: "Too many requests. Wait a moment and try again." } },
  no_such_profile: { error: /*i18n*/ { id: "api.error.no_such_profile", message: "No such profile" } },
  no_such_passkey: { error: /*i18n*/ { id: "api.error.no_such_passkey", message: "No such passkey" } },
  sessions_own_only: { error: /*i18n*/ { id: "api.error.sessions_own_only", message: "You can only view your own sessions." } },
  no_such_session: { error: /*i18n*/ { id: "api.error.no_such_session", message: "No such session" } },
  trash_restore_missing: { error: /*i18n*/ { id: "api.error.trash_restore_missing", message: "This item cannot be restored from your trash. Refresh Trash and try again." } },
  trash_item_missing: { error: /*i18n*/ { id: "api.error.trash_item_missing", message: "This item is not available in your trash. Refresh Trash and try again." } },
  robot_offline: { error: /*i18n*/ { id: "api.error.robot_offline", message: "This robot is offline. Check that it is on and on your Wi-Fi, then try again." } },
  robot_no_answer: { error: /*i18n*/ { id: "api.error.robot_no_answer", message: "The robot did not answer the test. Restart it, then try again." } },
  robot_part_unreported: { error: /*i18n*/ { id: "api.error.robot_part_unreported", message: "This robot did not report that part." } },
  voice_not_on_hub: { error: /*i18n*/ { id: "api.error.voice_not_on_hub", message: "That voice is not on this hub. Choose one from the list." } },
  coding_mode_is_max: { error: /*i18n*/ { id: "api.error.coding_mode_is_max", message: "Coding mode is now Max chat. Pick Max in a chat, or connect a coding app, and Home loads the big model for you." } },
  companion_choose: { error: /*i18n*/ { id: "api.error.companion_choose", message: "Choose a companion from the list." } },
  companion_robot_unavailable: { error: /*i18n*/ { id: "api.error.companion_robot_unavailable", message: "That robot is not available for this side chat." } },
  companion_unavailable: { error: /*i18n*/ { id: "api.error.companion_unavailable", message: "That companion is not available to you. Choose another from the list." } },
  setting_key_gone: { error: /*i18n*/ { id: "api.error.setting_key_gone", message: "No such key. Reload the list and try again." } },
  setting_person_gone: { error: /*i18n*/ { id: "api.error.setting_person_gone", message: "No such person. Reload the people list and try again." } },
  coding_key_gone: { error: /*i18n*/ { id: "api.error.coding_key_gone", message: "No such coding key. Reload the list and try again." } },
  backup_unreadable: { error: /*i18n*/ { id: "api.error.backup_unreadable", message: "that backup could not be read. Try another one." } },
  cannot_disable_self: { error: /*i18n*/ { id: "api.error.cannot_disable_self", message: "you cannot disable your own profile" } },
  guest_stay_ask_adult: { minor: true, error: /*i18n*/ { id: "api.minor.guest_stay_ask_adult", message: "Ask an adult in the household to change how long you stay." } },
  house_rooms_unavailable: { error: /*i18n*/ { id: "api.error.house_rooms_unavailable", message: "Rooms are unavailable for this speaker. Sign in as a household member." } },
  house_controls_unavailable: { error: /*i18n*/ { id: "api.error.house_controls_unavailable", message: "Home controls are unavailable for this speaker. Sign in as a household member." } },
  house_controls_off: { error: /*i18n*/ { id: "api.error.house_controls_off", message: "Home controls are turned off for this household. Change the House control setting to continue." } },
  // The two cross-route hooks: the 500 from app.onError and the 400 from the validation hook. The validation `error` is built from the
  // fields that failed, so only its `next` line is a table entry.
  internal: {
    error: /*i18n*/ { id: "api.error.internal", message: "Home hit a problem it did not expect." },
    next: /*i18n*/ { id: "api.next.internal", message: "Try again. If it keeps happening, open Repairs." },
  },
  invalid_input: { next: /*i18n*/ { id: "api.next.invalid_input", message: "Check the fields named and send it again." } },
} satisfies Record<string, ApiErrorLine>;

export type ApiErrorCode = keyof typeof API_ERROR_LINES;
/** The codes that carry an `error` line (every code except the validation hook's `invalid_input`, which only has a `next`). */
export type ApiErrorBodyCode = { [K in ApiErrorCode]: (typeof API_ERROR_LINES)[K] extends { error: ApiErrorDescriptor } ? K : never }[ApiErrorCode];

/** The response body for a coded error: the English `error` (and `next`), the stable `code`, then any extra fields the route already sends
 * (`retryAfter`, `attemptsLeft`, `lastSeenAt`). */
export function apiError<C extends ApiErrorBodyCode, E extends Record<string, unknown> = Record<string, never>>(code: C, extra?: E): { error: string; code: C; next?: string } & E {
  const line = API_ERROR_LINES[code] as ApiErrorLine & { error: ApiErrorDescriptor };
  return { error: line.error.message, code, ...(line.next ? { next: line.next.message } : {}), ...(extra ?? {}) } as { error: string; code: C; next?: string } & E;
}
