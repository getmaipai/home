// NAT-07b: the person's own switch for being asked about something they mentioned last time, once, when a chat opens
// ("how did the interview go?"). Declared here until a commons spec tag carries it (spec/settings/keys.json).
import { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";

export const PICK_UP_THREADS_KEY = "chat.pick_up_threads";

export const CHAT_SETTINGS_KEYS: SettingsKey[] = [
  SettingsKey.parse({
    key: PICK_UP_THREADS_KEY,
    scope: "person",
    selector: "boolean",
    default: true,
    label: "Pick up where we left off",
    help: "When a chat opens with a hello, the assistant may ask once about something you mentioned last time, like an event that has now passed. Adults are on by default; teens are off until they turn it on; children never get it. Nothing is asked in a private chat.",
    level: "basic",
    copy: { does: "Lets a new chat ask once how something you mentioned went." },
    lives_in: "person.chat",
    honoured_by: ["home"],
  }),
];
