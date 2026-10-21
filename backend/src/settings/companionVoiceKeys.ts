// COMPANION-04-lite (owner's ruling, 2026-10-21, docs/design/dynamic-companions-2026-10-21.md): a companion's default voice is a household
// setting, one key per installed companion, because a voice made at home has an id that differs on every hub and a package cannot name it.
// Same voice values as `tts.home_voice`, so the existing voice validation applies. They ride in Home's registry until a commons spec tag
// carries a key family (COMPANION-VOICE-SPEC in the backlog).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";
import { PACKAGES_DIR } from "@/lib/paths";

export const COMPANION_VOICE_PREFIX = "companion.voice.";

/** The settings key that holds one companion's voice. Setting keys cannot hold a hyphen, so `lively-child` becomes `lively_child`. */
export function companionVoiceKey(companionId: string): string {
  return COMPANION_VOICE_PREFIX + companionId.replace(/-/g, "_");
}

export function companionVoiceSettingsKeys(): SettingsKey[] {
  if (!existsSync(PACKAGES_DIR)) return [];
  return readdirSync(PACKAGES_DIR).sort().flatMap((id) => {
    const path = join(PACKAGES_DIR, id, "manifest.json");
    if (!existsSync(path)) return [];
    const manifest = JSON.parse(readFileSync(path, "utf-8")) as { kind?: string; companion?: { display_name?: string } };
    if (manifest.kind !== "companion" || !manifest.companion?.display_name) return [];
    const name = manifest.companion.display_name;
    return [SettingsKey.parse({
      key: companionVoiceKey(id),
      scope: "household",
      selector: "select",
      range: { options_from: "voices.tts" },
      default: "default",
      label: `${name}'s voice`,
      help: `The voice ${name} speaks with on a robot that has no voice of its own. "default" is Home's default voice.`,
      level: "expert",
      secret: false,
      lives_in: "companions",
      honoured_by: ["home"],
    })];
  });
}
