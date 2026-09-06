// The shell's own settings (docs/plans/session-b-ui.md step 2): a
// person's appearance and their pinned-apps order. `person` scope for
// both - a per-person setting the way `persona.active_id` already is,
// never one appearance for the whole household.
import { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";

export const UI_SETTINGS_KEYS: SettingsKey[] = [
  SettingsKey.parse({
    key: "ui.appearance",
    scope: "person",
    selector: "select",
    range: { options: ["system", "light", "dark"] },
    default: "system",
    label: "Appearance",
    help: "Light, dark, or match this device's own setting.",
    level: "basic",
    lives_in: "profile.appearance",
    honoured_by: ["home"],
  }),
  // No selector in Home Assistant's vocabulary (docs/SETTINGS.md's
  // registry list) fits an ordered list of ids, so this is `text`
  // storing a JSON array - the same "typed, not the real thing yet"
  // posture llm.ts's role list already takes. `level: "expert"` on
  // purpose: the real editing UI is a pin/unpin gesture on each app
  // (docs/BACKLOG.md's home-screen item, step 6), not a settings page
  // text box for hand-editing JSON. Nothing reads or writes this key
  // yet - it exists so the shape is declared before the first caller,
  // the same order the five kit primitives landed in.
  SettingsKey.parse({
    key: "ui.pinned_apps",
    scope: "person",
    selector: "text",
    default: "[]",
    label: "Pinned apps (advanced)",
    help: "A JSON list of nav entry ids, in the order they should appear. Normally set by pinning an app, not by editing this directly.",
    level: "expert",
    lives_in: "profile.appearance",
    honoured_by: ["home"],
  }),
];
