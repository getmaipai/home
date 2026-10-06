// The notification system's settings (2026-09-05, lib/notifications.ts).
// Two shapes, deliberately not one: the Telegram bot itself is a single
// household-wide credential (one bot, like `home.access_token` is one
// Home Assistant instance for the whole house - homeAssistantKeys.ts's
// own reasoning), while a person's own chat id and their per-type
// channel toggles are `scope: "person"` - each household member links
// their own Telegram chat and decides what reaches them, matching
// getmaipai/.github/docs/NOTIFICATIONS.md's "Per-channel and per-event
// switches live in Profile."
//
// Only NOTIFICATION_TYPES entries with `configurable: true` get a real
// toggle key here (lib/notifications.ts's own header explains why a
// non-configurable type has none at all: there is nothing for a person
// to turn off). A package that one day declares its own notification
// type gets its own toggle the same way any other package setting
// would - through its manifest's `config[]` (spec/settings/README.md:
// "a package's manifest config[] becomes a second source"), not by
// editing this file.
import { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";

export const NOTIFICATION_SETTINGS_KEYS: SettingsKey[] = [
  SettingsKey.parse({
    key: "notifications.browser.enabled",
    scope: "person",
    selector: "boolean",
    default: false,
    label: "Show alerts on this device",
    help: "You'll see a pop-up when MaiPai needs attention, while MaiPai is open. It won't reach you when MaiPai is closed.",
    level: "basic",
    lives_in: "person.notifications",
    honoured_by: ["home"],
  }),
  SettingsKey.parse({
    key: "notifications.telegram.bot_token",
    scope: "household",
    selector: "text",
    default: "",
    label: "Telegram bot token",
    help: "A bot token from @BotFather, used to send notifications to Telegram. One bot for the whole household; each person links their own chat below.",
    level: "advanced",
    secret: true,
    lives_in: "household.notifications",
    honoured_by: ["home"],
  }),
  SettingsKey.parse({
    key: "notifications.telegram.chat_id",
    scope: "person",
    selector: "text",
    default: "",
    label: "Your Telegram chat id",
    help: "Message the household bot once, then paste the chat id it replies with, to receive your notifications on Telegram.",
    level: "basic",
    lives_in: "person.telegram",
    honoured_by: ["home"],
  }),
  // Key literally embeds the NotificationType id (lib/notificationTypes.ts:
  // "model.download_ready") between "notifications." and ".telegram" -
  // lib/notifications.ts's resolveChannelsFor() builds this exact same
  // string at runtime (`notifications.${type.id}.telegram`), so the two
  // must stay byte-for-byte in sync. A prior version of this file used an
  // underscore-joined id ("model_download_ready") here instead of the
  // type's real dotted id, which silently never matched anything a real
  // trigger() call looked up - caught by a test that mocked fetch and
  // asserted it was actually called, not just that the setting round-
  // tripped through the settings API.
  SettingsKey.parse({
    key: "notifications.model.download_ready.telegram",
    scope: "person",
    selector: "boolean",
    default: false,
    label: "Telegram me when a model finishes downloading",
    level: "basic",
    lives_in: "person.telegram",
    honoured_by: ["home"],
  }),
  SettingsKey.parse({
    key: "notifications.model.download_failed.telegram",
    scope: "person",
    selector: "boolean",
    default: false,
    label: "Telegram me when a model download fails",
    level: "basic",
    lives_in: "person.telegram",
    honoured_by: ["home"],
  }),
  // Session F, step 1: lib/notificationTypes.ts's "repairs.new".
  SettingsKey.parse({
    key: "notifications.repairs.new.telegram",
    scope: "person",
    selector: "boolean",
    default: false,
    label: "Telegram me about new Repairs items",
    level: "basic",
    lives_in: "person.telegram",
    honoured_by: ["home"],
  }),
  // Session F, step 7: lib/notificationTypes.ts's "person.band_changed".
  SettingsKey.parse({
    key: "notifications.person.band_changed.telegram",
    scope: "person",
    selector: "boolean",
    default: false,
    label: "Telegram me when a child or teen's profile band updates on a birthday",
    level: "basic",
    lives_in: "person.telegram",
    honoured_by: ["home"],
  }),
  // Session F, step 7: lib/notificationTypes.ts's "approvals.requested".
  SettingsKey.parse({
    key: "notifications.approvals.requested.telegram",
    scope: "person",
    selector: "boolean",
    default: false,
    label: "Telegram me when someone is asking for approval",
    level: "basic",
    lives_in: "person.telegram",
    honoured_by: ["home"],
  }),
  // Session F, step 8: lib/notificationTypes.ts's "backups.target_failing".
  SettingsKey.parse({
    key: "notifications.backups.target_failing.telegram",
    scope: "person",
    selector: "boolean",
    default: false,
    label: "Telegram me when backups start failing",
    level: "basic",
    lives_in: "person.telegram",
    honoured_by: ["home"],
  }),
  // SPEC-ROBOT-01 (spec-v0.1.79): the robot channel's person preference,
  // declared in the spec by the robot lane; registered here so the pinned
  // registry matches. Home delivers no robot channel yet.
  SettingsKey.parse({
    key: "notifications.time_sensitive.robot",
    scope: "person",
    selector: "boolean",
    default: false,
    label: "Send time-sensitive notifications to a robot",
    help: "Deliver time-sensitive notifications through a robot channel when one is configured. Private notification content is never spoken.",
    level: "basic",
    lives_in: "person.notifications",
    honoured_by: ["home"],
  }),
  // Step 10: lib/notificationTypes.ts's "updates.available".
  SettingsKey.parse({
    key: "notifications.updates.available.telegram",
    scope: "person",
    selector: "boolean",
    default: false,
    label: "Telegram me when a MaiPai Home update is available",
    level: "basic",
    lives_in: "person.telegram",
    honoured_by: ["home"],
  }),
  // HOME-STACK-03: lib/notificationTypes.ts's four "engines.*" types, one
  // per person, matching the dotted-id rule above (the type id goes
  // between "notifications." and ".telegram" byte-for-byte).
  SettingsKey.parse({
    key: "notifications.engines.update_available.telegram",
    scope: "person",
    selector: "boolean",
    default: false,
    label: "Telegram me when a Stack engine has an update available",
    level: "basic",
    lives_in: "person.telegram",
    honoured_by: ["home"],
  }),
  SettingsKey.parse({
    key: "notifications.engines.update_applied.telegram",
    scope: "person",
    selector: "boolean",
    default: false,
    label: "Telegram me when a Stack engine updates",
    level: "basic",
    lives_in: "person.telegram",
    honoured_by: ["home"],
  }),
  SettingsKey.parse({
    key: "notifications.engines.update_failed.telegram",
    scope: "person",
    selector: "boolean",
    default: false,
    label: "Telegram me when a Stack engine fails to update",
    level: "basic",
    lives_in: "person.telegram",
    honoured_by: ["home"],
  }),
  SettingsKey.parse({
    key: "notifications.engines.problem.telegram",
    scope: "person",
    selector: "boolean",
    default: false,
    label: "Telegram me when a Stack engine reports an open warning or critical problem",
    level: "basic",
    lives_in: "person.telegram",
    honoured_by: ["home"],
  }),
  // Memory outcomes: `memory.updated` (lib/notificationTypes.ts) has
  // been `configurable: true` and triggered since getmaipai/home#64,
  // but never got a real toggle key here - the exact gap this pass
  // closes, alongside its sibling `memory.judge_failed` (the judge's
  // other terminal outcome), following the four `engines.*` keys'
  // own pattern above.
  SettingsKey.parse({
    key: "notifications.memory.updated.telegram",
    scope: "person",
    selector: "boolean",
    default: false,
    label: "Telegram me when I remember something from our conversation",
    level: "basic",
    lives_in: "person.telegram",
    honoured_by: ["home"],
  }),
  SettingsKey.parse({
    key: "notifications.memory.judge_failed.telegram",
    scope: "person",
    selector: "boolean",
    default: false,
    label: "Telegram me when I have trouble remembering something from our conversation",
    level: "basic",
    lives_in: "person.telegram",
    honoured_by: ["home"],
  }),
  // NOTIFY-SHARE-01's follow-up: `file.shared_with_you` and
  // `file.shared_with_household` (lib/notificationTypes.ts) have been
  // `configurable: true` since e6112f5c but had no real toggle key here,
  // the exact gap this pass closes - mirroring `memory.updated` above.
  SettingsKey.parse({
    key: "notifications.file.shared_with_you.telegram",
    scope: "person",
    selector: "boolean",
    default: false,
    label: "Telegram me when someone shares a file with me",
    level: "basic",
    lives_in: "person.telegram",
    honoured_by: ["home"],
  }),
  SettingsKey.parse({
    key: "notifications.file.shared_with_household.telegram",
    scope: "person",
    selector: "boolean",
    default: false,
    label: "Telegram me when someone shares a file with the household",
    level: "basic",
    lives_in: "person.telegram",
    honoured_by: ["home"],
  }),
  // NOTIFY-SHARE-02 (docs/plans/people-profile-2026-09-26.md, "Notified
  // on sharing, no subscribing at all"): the one real gap the per-type
  // toggles above can't express - muting shares from one specific
  // household member while still hearing about everyone else's. Not
  // suffixed `.telegram` like every key above: this isn't a channel
  // toggle, it's a filter lib/notifications.ts's trigger() applies to
  // BOTH file.shared_with_you and file.shared_with_household before
  // resolving recipients (shares.ts's notifyShareCreated() passes the
  // sharer as TriggerOptions.mutedSenderId either way), so the key names
  // the shared feature ("file_shared"), not either type id alone -
  // `notifications.<type.id>.telegram`'s own dotted-id convention only
  // fits a PER-TYPE toggle, not a filter that spans both. `selector:
  // "person"` with `range.multiple: true`: Home Assistant's own
  // multi-target shape for "select some entities of a kind" (this
  // schema's `selector` enum already lists "person" - settings.ts's
  // validateSelectorValue() extends that one case to accept an array
  // when `range.multiple` is set, the first real caller of that branch).
  // The frontend's generic settings renderer had no person multi-select
  // control before this (checked: NextSettingField.tsx's own selector
  // switch had no "person" case at all, same "not supported yet" gap
  // its header comment already named) - PersonMultiSelect.tsx is the
  // new one, composed from the vendored kit's own Combobox/Chips
  // primitives (dashboard/components/ui/combobox.tsx), never hand-built
  // from scratch.
  SettingsKey.parse({
    key: "notifications.file_shared.muted_senders",
    scope: "person",
    selector: "person",
    range: { multiple: true },
    default: [],
    label: "Don't notify me about shares from",
    help: "Pick anyone in the household whose shared files you don't want a notification about. You'll still be notified about everyone else's.",
    level: "basic",
    lives_in: "person.notifications",
    honoured_by: ["home"],
  }),
];
