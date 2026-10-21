// The ids of the companions that can be picked right now (bundled and ready household ones). persona.ts keeps it current; settings.ts reads it,
// so the settings writer needs no import of persona.ts (which would pull the package host into every settings import).
export const LIVE_PERSONA_IDS = new Set<string>();
