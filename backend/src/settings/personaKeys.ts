// Persona selection (2026-09-05), the settings-registry half of
// `lib/persona.ts`'s new composition mechanism. `person` scope, not
// `household`, the same posture `tts.voice_id` already takes: each
// household member picks their own persona for their own conversations,
// not one voice for the whole house.
import { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";
import { PERSONA_IDS, DEFAULT_PERSONA_ID } from "@/lib/persona";

export const PERSONA_SETTINGS_KEYS: SettingsKey[] = [
  SettingsKey.parse({
    key: "persona.active_id",
    scope: "person",
    selector: "select",
    range: { options: [...PERSONA_IDS] },
    default: DEFAULT_PERSONA_ID,
    label: "Personality",
    help: "How MaiPai talks to you: formality, complexity, and how much it follows up on what you say.",
    level: "basic",
    lives_in: "person.persona",
    honoured_by: ["home"],
  }),
];
