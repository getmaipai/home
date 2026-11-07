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
  // I18N-B2b: texts the routes took from lib functions. The lib names the code (lib/result.ts `refusal`), this table holds the words.
  alarm_invalid: { error: /*i18n*/ { id: "api.error.alarm_invalid", message: "That alarm is not valid. Check the time and the days, then try again." } },
  alarm_missing: { error: /*i18n*/ { id: "api.error.alarm_missing", message: "That alarm is not there any more. Refresh the list and try again." } },
  alarm_no_next: { error: /*i18n*/ { id: "api.error.alarm_no_next", message: "This alarm has no next ring to skip. Turn it on and pick its days, then try again." } },
  quick_timer_invalid: { error: /*i18n*/ { id: "api.error.quick_timer_invalid", message: "That timer is not valid. Enter a name and a number of minutes, then try again." } },
  quick_timer_missing: { error: /*i18n*/ { id: "api.error.quick_timer_missing", message: "That timer is not there any more. Refresh the list and try again." } },
  world_place_invalid: { error: /*i18n*/ { id: "api.error.world_place_invalid", message: "That place is not valid. Enter a name and a time zone, then try again." } },
  world_place_missing: { error: /*i18n*/ { id: "api.error.world_place_missing", message: "That place is not there any more. Refresh the list and try again." } },
  world_place_limit: { error: /*i18n*/ { id: "api.error.world_place_limit", message: "You can save up to 12 places." } },
  world_place_zone_invalid: { error: /*i18n*/ { id: "api.error.world_place_zone_invalid", message: "Choose a valid time zone." } },
  coming_up_timer_invalid: { error: /*i18n*/ { id: "api.error.coming_up_timer_invalid", message: "Enter a label and a duration from 1 to 1440 minutes." } },
  coming_up_timer_missing: { error: /*i18n*/ { id: "api.error.coming_up_timer_missing", message: "That timer was not found. Refresh Coming up and try again." } },
  coming_up_timer_not_pending: { error: /*i18n*/ { id: "api.error.coming_up_timer_not_pending", message: "That timer has already finished. Refresh Coming up to see what is next." } },
  coming_up_item_missing: { error: /*i18n*/ { id: "api.error.coming_up_item_missing", message: "That item was not found. Refresh Coming up and try again." } },
  coming_up_item_not_pending: { error: /*i18n*/ { id: "api.error.coming_up_item_not_pending", message: "That item has already finished. Refresh Coming up to see what is next." } },
  display_name_length: { error: /*i18n*/ { id: "api.error.display_name_length", message: "Enter a name from 1 to 80 characters." } },
  secret_length: { error: /*i18n*/ { id: "api.error.secret_length", message: "Use 4 to 128 characters for your PIN or password." } },
  passkey_registration_expired: { error: /*i18n*/ { id: "api.error.passkey_registration_expired", message: "This registration attempt has expired. Try again." } },
  passkey_signin_expired: { error: /*i18n*/ { id: "api.error.passkey_signin_expired", message: "This sign-in attempt has expired. Try again." } },
  passkey_not_registered_here: { error: /*i18n*/ { id: "api.error.passkey_not_registered_here", message: "This passkey isn't registered to this profile. Sign in another way, or add the passkey again in Settings." } },
  passkey_verify_failed: { error: /*i18n*/ { id: "api.error.passkey_verify_failed", message: "Could not verify this passkey. Try again, or sign in with your PIN or password." } },
  grant_person_missing: { error: /*i18n*/ { id: "api.error.grant_person_missing", message: "That person is not a profile in this household. Choose someone from the list." } },
  grant_backup_self: { error: /*i18n*/ { id: "api.error.grant_backup_self", message: "Admins cannot grant themselves backup restore access. Ask the owner to grant it." } },
  grant_child_max: { minor: true, error: /*i18n*/ { id: "api.minor.grant_child_max", message: "A child can't be given Max. Children keep the Standard level." } },
  grant_teen_max_pictures: { minor: true, error: /*i18n*/ { id: "api.minor.grant_teen_max_pictures", message: "A teen can be given Max only for pictures. Chat, video and music stay Standard for them." } },
  grant_not_held: { error: /*i18n*/ { id: "api.error.grant_not_held", message: "You can't give someone a permission you don't have. Ask the owner to grant it." } },
  grant_missing: { error: /*i18n*/ { id: "api.error.grant_missing", message: "That grant is not there any more. Refresh the list and try again." } },
  grants_view_forbidden: { error: /*i18n*/ { id: "api.error.grants_view_forbidden", message: "You can only see your own grants. Ask an owner or admin to see someone else's." } },
  list_missing: { error: /*i18n*/ { id: "api.error.list_missing", message: "That list is not there any more. Refresh your lists and try again." } },
  list_needs_title: { error: /*i18n*/ { id: "api.error.list_needs_title", message: "Give this list a title, then try again." } },
  list_person_missing: { error: /*i18n*/ { id: "api.error.list_person_missing", message: "That person is not in this household. Choose someone from the list." } },
  list_child_delete_household: { minor: true, error: /*i18n*/ { id: "api.minor.list_child_delete_household", message: "Ask a grown-up to delete a household list. Children can't delete them." } },
  list_item_missing: { error: /*i18n*/ { id: "api.error.list_item_missing", message: "That item is not on this list any more. Refresh the list and try again." } },
  list_move_same: { error: /*i18n*/ { id: "api.error.list_move_same", message: "Choose a different list to move these items to." } },
  list_move_none: { error: /*i18n*/ { id: "api.error.list_move_none", message: "None of those items are on the list any more. Refresh the list and try again." } },
  list_restore_none: { error: /*i18n*/ { id: "api.error.list_restore_none", message: "There is nothing left to restore. Refresh the list and try again." } },
  project_missing: { error: /*i18n*/ { id: "api.error.project_missing", message: "That project was not found. Refresh Projects and try again." } },
  project_finished: { error: /*i18n*/ { id: "api.error.project_finished", message: "This project already finished, so there is no live run to cancel." } },
  file_not_in_library: { error: /*i18n*/ { id: "api.error.file_not_in_library", message: "That file is not in your Library. Refresh the page and try again." } },
  file_delete_owner_only: { error: /*i18n*/ { id: "api.error.file_delete_owner_only", message: "Only the person who added this file can delete it. You can stop seeing it by asking them to unshare." } },
  file_change_owner_only: { error: /*i18n*/ { id: "api.error.file_change_owner_only", message: "Only the person who added this file can change it." } },
  file_edit_in_app: { error: /*i18n*/ { id: "api.error.file_edit_in_app", message: "Saved media belongs to its app. Change it there." } },
  file_remove_in_app: { error: /*i18n*/ { id: "api.error.file_remove_in_app", message: "Saved media belongs to its app. Remove it there." } },
  file_name_required: { error: /*i18n*/ { id: "api.error.file_name_required", message: "Type a name for this file." } },
  file_name_too_long: { error: /*i18n*/ { id: "api.error.file_name_too_long", message: "That name is too long. Use a shorter name for this file." } },
  file_stays_until_deleted: { error: /*i18n*/ { id: "api.error.file_stays_until_deleted", message: "Files you added stay until you delete them." } },
  file_edit_nothing: { error: /*i18n*/ { id: "api.error.file_edit_nothing", message: "Send a new name or a keep setting, then save again." } },
  file_belongs_to_item: { error: /*i18n*/ { id: "api.error.file_belongs_to_item", message: "This file belongs to another item. Delete that item instead." } },
  file_unavailable_to_share: { error: /*i18n*/ { id: "api.error.file_unavailable_to_share", message: "File unavailable. Ask the owner to share a suitable file." } },
  share_no_access: { error: /*i18n*/ { id: "api.error.share_no_access", message: "You do not have access to this file. Ask the owner to share it with you." } },
  share_person_missing: { error: /*i18n*/ { id: "api.error.share_person_missing", message: "The household does not have that person. Choose someone from the list." } },
  share_children_off: { minor: true, error: /*i18n*/ { id: "api.minor.share_children_off", message: "Sharing is turned off for children. Ask a grown-up to share this for you." } },
  share_media_in_app: { error: /*i18n*/ { id: "api.error.share_media_in_app", message: "Saved media files cannot be shared through Files. Change the show's audience in Podcasts instead." } },
  share_adult_only: { error: /*i18n*/ { id: "api.error.share_adult_only", message: "That file is adult only, so it cannot be shared with the whole home or with a child or teen. Share it with an adult instead." } },
  share_missing: { error: /*i18n*/ { id: "api.error.share_missing", message: "That share is not there any more. Refresh the list and try again." } },
  share_remove_forbidden: { error: /*i18n*/ { id: "api.error.share_remove_forbidden", message: "You may not remove this share. Ask the person who shared it." } },
  recheck_not_available: { error: /*i18n*/ { id: "api.error.recheck_not_available", message: "That picture is not available for rechecking. Open one of your own adult-only pictures." } },
  recheck_too_many: { error: /*i18n*/ { id: "api.error.recheck_too_many", message: "You have checked too many pictures. Wait an hour and try again." } },
  recheck_unconfirmed: { error: /*i18n*/ { id: "api.error.recheck_unconfirmed", message: "That picture could not be confirmed as safe for everyone. It stays adult-only. Try again later or choose another picture to share." } },
  library_cursor_invalid: { error: /*i18n*/ { id: "api.error.library_cursor_invalid", message: "The page address is invalid. Open the Library again." } },
  upload_profile_gone: { error: /*i18n*/ { id: "api.error.upload_profile_gone", message: "Your profile is no longer available. Sign in again." } },
  upload_not_allowed_minor: { minor: true, error: /*i18n*/ { id: "api.minor.upload_not_allowed_minor", message: "Ask a grown-up to add this file. Adding files to the Library is turned off for your profile." } },
  upload_too_many: { error: /*i18n*/ { id: "api.error.upload_too_many", message: "You already have three uploads running. Finish or cancel one, then try again." } },
  upload_gone: { error: /*i18n*/ { id: "api.error.upload_gone", message: "That upload is no longer available. Add the file again." } },
  upload_busy: { error: /*i18n*/ { id: "api.error.upload_busy", message: "That upload is still working. Wait for it to finish, then try again." } },
  upload_chunk_order: { error: /*i18n*/ { id: "api.error.upload_chunk_order", message: "That chunk is out of order. Send the next chunk at the returned offset." } },
  upload_chunk_empty: { error: /*i18n*/ { id: "api.error.upload_chunk_empty", message: "That chunk is empty. Add the file again." } },
  upload_too_big: { error: /*i18n*/ { id: "api.error.upload_too_big", message: "That file is bigger than 500 MB. Choose a smaller file." } },
  upload_chunk_too_big: { error: /*i18n*/ { id: "api.error.upload_chunk_too_big", message: "That chunk is bigger than 8 MB. Add the file again using smaller chunks." } },
  upload_interrupted: { error: /*i18n*/ { id: "api.error.upload_interrupted", message: "The upload stopped before it finished. Add the file again." } },
  upload_unsupported: { error: /*i18n*/ { id: "api.error.upload_unsupported", message: "That file type is not supported. Use a picture, video, song or document." } },
  upload_file_empty: { error: /*i18n*/ { id: "api.error.upload_file_empty", message: "That file is empty. Choose a file with something in it." } },
  upload_unreadable: { error: /*i18n*/ { id: "api.error.upload_unreadable", message: "That file could not be read. Save it in a supported format and add it again." } },
  upload_choose_file: { error: /*i18n*/ { id: "api.error.upload_choose_file", message: "Choose a file to add." } },
  upload_request_unreadable: { error: /*i18n*/ { id: "api.error.upload_request_unreadable", message: "That upload could not be read. Choose one file and add it again." } },
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
