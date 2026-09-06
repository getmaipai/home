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
    lives_in: "person.notifications",
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
    lives_in: "person.notifications",
    honoured_by: ["home"],
  }),
  SettingsKey.parse({
    key: "notifications.model.download_failed.telegram",
    scope: "person",
    selector: "boolean",
    default: false,
    label: "Telegram me when a model download fails",
    level: "basic",
    lives_in: "person.notifications",
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
    lives_in: "person.notifications",
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
    lives_in: "person.notifications",
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
    lives_in: "person.notifications",
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
    lives_in: "person.notifications",
    honoured_by: ["home"],
  }),
];
