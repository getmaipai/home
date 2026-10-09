import { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";

export const SAFETY_ALARM_SETTINGS_KEYS: SettingsKey[] = [
  SettingsKey.parse({
    key: "safety.alarm.sensors", scope: "household", selector: "text", default: "",
    label: "Home Assistant safety sensors",
    help: "Sensors mapped here raise a fixed safety alarm when they stay on for 10 seconds. This alarm cannot be turned off in settings.",
    level: "basic", lives_in: "household.integrations", honoured_by: ["home"],
  }),
  SettingsKey.parse({
    key: "safety.alarm.child_line", scope: "household", selector: "text", default: "A home safety alarm is sounding.",
    label: "What children hear during an alarm", help: "A fixed household-written line used around children or unknown visitors.",
    level: "advanced", lives_in: "household.integrations", honoured_by: ["home"],
  }),
  SettingsKey.parse({
    key: "safety.alarm.volume", scope: "household", selector: "number", default: 70,
    range: { min: 70, max: 100 }, label: "Alarm volume floor", help: "The alarm always uses at least 70% volume.",
    level: "advanced", lives_in: "household.integrations", honoured_by: ["home"],
  }),
  SettingsKey.parse({
    key: "safety.alarm.repeat_seconds", scope: "household", selector: "number", default: 20,
    range: { min: 10, max: 60 }, label: "Alarm repeat interval", help: "How often paired robots repeat an active alarm.",
    level: "advanced", lives_in: "household.integrations", honoured_by: ["home"],
  }),
];
