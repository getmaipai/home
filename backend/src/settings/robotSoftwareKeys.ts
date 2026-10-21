import { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";

// ROBOT-SOFTWARE-01: an internal value written only by the firmware success route.
export const ROBOT_SOFTWARE_SETTINGS_KEYS = [
  SettingsKey.parse({
    key: "robot.firmware.installed",
    scope: "device",
    selector: "text",
    default: "",
    label: "Installed robot firmware",
    help: "Firmware version and install time recorded by Home.",
    level: "expert",
    lives_in: "robot.settings",
    honoured_by: ["home"],
  }),
];
