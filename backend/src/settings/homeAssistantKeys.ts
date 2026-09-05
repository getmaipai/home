// The household's Home Assistant connection (2026-09-05, closing one of
// the two gaps docs/dev.md named for `home.call_service`: "no permission
// exists yet for it" is the other, closed alongside this in
// packageHost.ts and spec/vocab/permissions.json). `household` scope, not
// `person`: one Home Assistant instance serves the whole home, the same
// shape `voice.hf_token` already takes for a whole-hub credential
// (voiceKeys.ts).
//
// Two keys, not one, because the base URL and the token have different
// sensitivity: the URL is often just `http://homeassistant.local:8123`
// (real-world useful in logs and diagnostics, not a secret), while the
// long-lived access token is a bearer credential that grants full control
// of the household's own smart-home devices - `secret: true` routes it
// through lib/settings.ts's at-rest encryption (lib/secrets.ts), the same
// mechanism `voice.hf_token` exercises first.
//
// Deliberately no `select` options and no live "test connection" flow
// here: that needs an actual round-trip to the instance this key names,
// which is UI/route work for whoever builds the settings page for this,
// not the settings key itself. `packageHost.ts`'s real `home.call_service`
// throws a clear, actionable error when either value is unset, so an
// unconfigured household gets a real explanation instead of a silent
// no-op or a confusing network error.
import { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";

export const HOME_ASSISTANT_SETTINGS_KEYS: SettingsKey[] = [
  SettingsKey.parse({
    key: "home.base_url",
    scope: "household",
    selector: "text",
    default: "",
    label: "Home Assistant URL",
    help: "The address of your Home Assistant instance, e.g. http://homeassistant.local:8123.",
    level: "advanced",
    lives_in: "household.integrations",
    honoured_by: ["home"],
  }),
  SettingsKey.parse({
    key: "home.access_token",
    scope: "household",
    selector: "text",
    default: "",
    label: "Home Assistant access token",
    help: "A long-lived access token from your Home Assistant profile page, used to control your smart-home devices.",
    level: "advanced",
    secret: true,
    lives_in: "household.integrations",
    honoured_by: ["home"],
  }),
];
