import { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";

export const TOOL_BRAKE_SETTINGS_KEYS = [
  SettingsKey.parse({ key: "tools.remind.mode", scope: "household", selector: "select", range: { options: ["do", "ask", "never"] }, default: "do", label: "Reminder actions", help: "Choose whether reminder changes happen at once, ask first, or stay off. Safety checks may still ask first.", level: "basic", lives_in: "household.ai_advanced", honoured_by: ["home"] }),
  SettingsKey.parse({ key: "tools.timer.mode", scope: "household", selector: "select", range: { options: ["do", "ask", "never"] }, default: "do", label: "Timer actions", help: "Choose whether timer changes happen at once, ask first, or stay off. Safety checks may still ask first.", level: "basic", lives_in: "household.ai_advanced", honoured_by: ["home"] }),
  SettingsKey.parse({ key: "tools.lists.mode", scope: "household", selector: "select", range: { options: ["do", "ask", "never"] }, default: "do", label: "List actions", help: "Choose whether list changes happen at once, ask first, or stay off. Safety checks may still ask first.", level: "basic", lives_in: "household.ai_advanced", honoured_by: ["home"] }),
];
