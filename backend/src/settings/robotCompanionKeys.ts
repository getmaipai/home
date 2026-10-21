// ROBOT-COMPANION-01: the two per-robot values an admin sets in Settings, Devices. Device scope, like robot.voice.id, so the
// existing settings routes and the owner/admin gate carry them. They ride in Home's registry until a commons spec tag carries
// them (the same way search.brave_api_key did). The pairing rule is lib/robotCompanion.ts, enforced in routes/settings.ts.
import { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";

export const ROBOT_COMPANION_SETTINGS_KEYS: SettingsKey[] = [
  SettingsKey.parse({
    key: "robot.controls",
    scope: "device",
    selector: "select",
    range: { options: ["child", "teen", "adult"] },
    default: "child",
    label: "Robot controls",
    help: "Which companions this robot may use: child controls allow child companions, teen controls child and teen, adult controls any. Only an admin sets it.",
    level: "expert",
    lives_in: "robot.settings",
    honoured_by: ["home"],
  }),
  SettingsKey.parse({
    key: "robot.companion.id",
    scope: "device",
    selector: "text",
    default: "",
    label: "Robot companion",
    help: "The companion this robot talks as. Its type (child, teen or adult) sets how the robot answers. With none chosen the robot answers with child controls.",
    level: "expert",
    lives_in: "robot.settings",
    honoured_by: ["home"],
  }),
];
