import { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";

export const ALARM_SETTINGS_KEYS = [
  SettingsKey.parse({ key: "alarms.sound", scope: "person", selector: "select", range: { options: ["none", "bell", "chime", "digital", "rise", "gentle"] }, default: "bell", label: "Alarm sound", level: "basic", lives_in: "person.clock", honoured_by: ["home"] }),
  SettingsKey.parse({ key: "alarms.volume", scope: "person", selector: "select", range: { options: ["low", "medium", "high"] }, default: "medium", label: "Alarm volume", level: "basic", lives_in: "person.clock", honoured_by: ["home"] }),
  SettingsKey.parse({ key: "alarms.snooze_minutes", scope: "person", selector: "select", range: { options: ["5", "10", "15", "30", "60"] }, default: "10", label: "Snooze duration", level: "basic", lives_in: "person.clock", honoured_by: ["home"] }),
];
