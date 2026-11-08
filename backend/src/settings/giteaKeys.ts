import { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";

export const GITEA_SETTINGS_KEYS = [
  SettingsKey.parse({ key: "gitea.access_token", scope: "household", selector: "text", default: "", label: "Gitea access token", help: "A token used by the read only Gitea connection.", level: "advanced", secret: true, lives_in: "household.integrations", honoured_by: ["home"] }),
  SettingsKey.parse({ key: "gitea.mcp_command", scope: "household", selector: "text", default: "", label: "Gitea MCP command", help: "Absolute path to the installed official gitea-mcp executable.", level: "advanced", lives_in: "household.integrations", honoured_by: ["home"] }),
  SettingsKey.parse({ key: "gitea.mcp_pins", scope: "household", selector: "text", default: "{}", label: "Gitea MCP tool pins", help: "JSON map of read tool names to approved definition hashes.", level: "advanced", lives_in: "household.integrations", honoured_by: ["home"] }),
];
