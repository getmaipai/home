// The shell's own settings (docs/plans/session-b-ui.md step 2): a
// person's appearance and their pinned-apps order. `person` scope for
// both - a per-person setting the way `persona.active_id` already is,
// never one appearance for the whole household.
import { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";

export const UI_SETTINGS_KEYS: SettingsKey[] = [
  // The shell-on-shadcndashboard stand-up's own flag (docs/plans/
  // shell-on-shadcndashboard-2026-09-21.md, step 1): `household` scope,
  // not `person`, because it governs a second route tree (`/next/*`)
  // everyone in the house sees the same way, and there is no separate
  // chat flag - this one governs both together. Off by default; the
  // day it defaults on, `/next` becomes `/` and the old shell and chat
  // are deleted in the same commit. `level: "advanced"`, not "expert"
  // (2026-09-21, COORDINATOR correction): the settings renderer drops
  // "expert" keys entirely (commons ui/src/settings/groupSettings.ts
  // line 74), so an "expert" key is unreachable from Settings at any
  // account level - "advanced" surfaces it behind "Show N advanced
  // settings" in the System group instead.
  SettingsKey.parse({
    key: "ui.shell.next",
    scope: "household",
    selector: "boolean",
    default: false,
    label: "New shell (preview)",
    help: "Try the shell and chat on the new design at /next before it becomes the default for everyone in this household.",
    level: "advanced",
    lives_in: "household.system",
    honoured_by: ["home"],
  }),
  SettingsKey.parse({
    key: "ui.show_turn_stats",
    scope: "person",
    selector: "boolean",
    default: false,
    label: "Show advanced reply stats",
    help: "Show engine timing and token details below your chat replies.",
    level: "advanced",
    lives_in: "profile.appearance",
    honoured_by: ["home"],
  }),
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
  // The owner's "Two looks, one setting" ruling (2026-09-20): Studio
  // matches the reference design exactly and is the hub's own default;
  // Calm is the softer look HOME-UI-01/02 shipped first, kept as the
  // escape hatch for anyone who prefers it (its group labels and
  // header, unlike Studio's, stay at docs/UI.md's own type floor).
  // Applied live by frontend/src/shell/useLook.ts, the same
  // read-the-shared-cache pattern useAppearance.ts uses for
  // `ui.appearance`, through a `data-look` attribute `tokens.css`'s
  // `studio:` variant and look-scoped tokens key off.
  //
  // HOME-UI-04b (2026-09-21): the seven shadcn base-color presets
  // (ui.shadcn.com/docs/theming's own current list - Neutral, Stone,
  // Zinc, Mauve, Olive, Mist, Taupe) join Studio and Calm on the same
  // enum and the same style-variant mechanism (commons-a/ui/src/
  // dashboard/css/globals.css), applied on /next only (`useNextLook`)
  // - the old shell's `useLook` still resolves the value (`Look`
  // widened to match in `@/shell/useLook.ts`) but has no `.style-<
  // color>` CSS of its own, so an old-shell person who picked a color
  // preset just keeps Studio's own palette there until the old shell
  // retires.
  //
  // HOME-UI-04e (2026-09-21): Studio and Calm's own shared palette
  // stopped being Home's navy hex set and became the shadcndashboard
  // template's own default, byte-for-byte (owner ruling, "identical to
  // the source") - Home's former default survives as its own tenth
  // option, `navy`, on the same mechanism as the shadcn presets above.
  SettingsKey.parse({
    key: "ui.look",
    scope: "person",
    selector: "select",
    range: { options: ["studio", "calm", "neutral", "stone", "zinc", "mauve", "olive", "mist", "taupe", "navy"] },
    default: "studio",
    label: "Look",
    help: "Studio matches the reference design exactly. Calm is the same look, rounder tiles. Navy is Home's own blue-black set. The rest are shadcn's own color presets.",
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
