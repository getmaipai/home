// ROBOT-VISION-01 (owner's ruling, 2026-10-21): the per-robot camera setting an admin chooses in Settings, Devices. Device scope like
// robot.voice.id, so the existing settings routes, the admin gate and the settings_changed push to the robot carry it. It rides in
// Home's registry until a commons spec tag carries it (the same way robot.controls does). The rule is lib/robotVision.ts.
import { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";

export const ROBOT_VISION_KEY = "robot.vision";

export const ROBOT_VISION_SETTINGS_KEYS: SettingsKey[] = [
  SettingsKey.parse({
    key: ROBOT_VISION_KEY,
    scope: "device",
    selector: "select",
    range: { options: ["continual", "on_demand", "none"] },
    default: "continual",
    label: "Robot vision",
    help: "How this robot uses its camera. Always watching keeps a short-lived idea of what is around it. Only when I ask looks when someone asks it to. Camera off never uses the camera. Pictures are never saved.",
    copy: {
      does: "Chooses when the robot looks through its camera.",
      options: {
        continual: "The robot keeps a short, expiring idea of what is around it: who is in view, what it is looking at, whether the room is dark. Pictures are checked and thrown away.",
        on_demand: "The robot looks only when someone asks it to, for example 'what do you see?'.",
        none: "The camera is never used. The robot cannot see anything.",
      },
      option_labels: {
        continual: "Always watching (default)",
        on_demand: "Only when I ask",
        none: "Camera off",
      },
    },
    level: "basic",
    lives_in: "robot.hello",
    honoured_by: ["home", "bot"],
  }),
];
