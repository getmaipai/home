// CODE-STACK-01 H2: the three coding settings the Stack reads that the pinned spec does not declare yet. Declared in Home until a
// commons spec tag carries them (spec first for a shared shape; the spec change is owed). Ranges and defaults are the Stack's own
// declarations (stack.engines.coding.*), so a value Home accepts is a value the Stack accepts.
import { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";

export const STACK_CODING_SETTINGS_KEYS: SettingsKey[] = [
  SettingsKey.parse({
    key: "coding.yield_to_chat", scope: "household", selector: "boolean", default: true, level: "advanced", lives_in: "household.coding_limits", honoured_by: ["home"],
    label: "Coding waits for chat",
    help: "While chat, voice or picture reading is being answered, the coding model pauses for at most two minutes at a time, so chat stays as fast as when coding is idle. Coding answers finish a little later when both are used at once.",
    copy: { does: "Pauses the coding model while chat is being answered." },
  }),
  SettingsKey.parse({
    key: "coding.engine", scope: "household", selector: "select", default: "auto", level: "advanced", lives_in: "household.coding_limits", honoured_by: ["home"],
    range: { options: ["auto", "splash", "llama-server"] },
    label: "Coding engine",
    help: "Automatic uses Splash, the faster engine, on a Mac that can run it and the engine chat uses everywhere else. Choose llama-server to keep coding on the slower engine. Takes effect the next time the coding model loads.",
    copy: { does: "Chooses the engine that runs the coding model.", option_labels: { auto: "Automatic", splash: "Splash", "llama-server": "llama-server" } },
  }),
  SettingsKey.parse({
    key: "coding.splash_cache_gb", scope: "household", selector: "number", default: 8, level: "expert", lives_in: "household.coding_limits", honoured_by: ["home"],
    range: { min: 0, max: 64, step: 1 },
    label: "Splash temporary disk (GB)",
    help: "The most disk, in GB, that Splash may use for temporary files that make long coding sessions faster. They are deleted each time the coding model loads. Zero turns them off.",
    copy: { does: "Limits the disk Splash uses for temporary files." },
  }),
];
