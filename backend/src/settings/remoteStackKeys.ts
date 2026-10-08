import { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";

// These declarations were published in spec-v0.1.105 and accidentally
// dropped from v0.1.106, which this checkout pins. Keep Home's registry
// complete until the shared spec restores them.
export const REMOTE_STACK_SETTINGS_KEYS = [
  {
    key: "engines.stack.where", scope: "household", selector: "select",
    range: { options: ["this_computer", "another_computer"] }, default: "this_computer",
    label: "Where the engine runs",
    help: "Another computer at home can run the AI if it has a stronger graphics card.",
    copy: { does: "Another computer at home can run the AI if it has a stronger graphics card.", options: { this_computer: "Home and the engine share one computer.", another_computer: "The engine sits on a different computer you own." } },
    level: "basic", secret: false, lives_in: "household.ai", honoured_by: ["home"],
  },
  {
    key: "engines.stack.remote.local_port", scope: "household", selector: "number", range: { min: 1, max: 65535, step: 1 }, default: 8771,
    label: "Engine computer local port", help: "The port on this computer where the engine computer's connection appears. Change it only if another program already uses it. Only an admin can change this. Shown only while the engine runs on another computer.",
    level: "advanced", secret: false, lives_in: "household.ai", honoured_by: ["home"],
  },
  {
    key: "engines.stack.remote.host", scope: "household", selector: "text", default: "",
    label: "Engine computer name", help: "The name of the computer that runs the engine, the way your network knows it. Only an admin can change this. Shown only while the engine runs on another computer.",
    copy: { does: "Tells Home which machine to reach for the engine." }, level: "basic", secret: false, lives_in: "household.ai", honoured_by: ["home"],
  },
  {
    key: "engines.stack.remote.ssh_port", scope: "household", selector: "number", range: { min: 1, max: 65535, step: 1 }, default: 22,
    label: "Engine computer secure connection port", help: "The port Home uses to open its secure connection to the engine computer. Leave it at 22 unless that computer was set up differently. Only an admin can change this. Shown only while the engine runs on another computer.",
    copy: { does: "Sets the door Home knocks on to open a secure link." }, level: "advanced", secret: false, lives_in: "household.ai", honoured_by: ["home"],
  },
  {
    key: "engines.stack.remote.allow_tailnet", scope: "household", selector: "boolean", default: false,
    label: "Reach the engine computer when away from home", help: "Lets this computer reach the engine computer through your own Tailscale network when you are away from home. Chats then cross the internet inside Tailscale's encrypted link.",
    copy: { does: "Allows a private tailnet route to the engine when nobody is at the house." }, level: "advanced", secret: false, lives_in: "household.ai", honoured_by: ["home"],
  },
  {
    key: "engines.stack.url", scope: "household", selector: "text", default: "",
    label: "MaiPai Stack address", help: "Home sets this when the engine is on another computer.",
    level: "expert", secret: false, lives_in: "household.ai", honoured_by: ["home"],
  },
].map((entry) => SettingsKey.parse(entry));
