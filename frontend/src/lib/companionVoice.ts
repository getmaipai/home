// COMPANION-04-lite: the household setting that holds one companion's voice. The hub names it `companion.voice.<id>`, a hyphen in the
// id becoming an underscore (a settings key cannot hold one). The page renders the kit Select itself and saves with
// api.setSetting("household", companionVoiceKey(id), voiceId).
export const companionVoiceKey = (companionId: string): string => `companion.voice.${companionId.replace(/-/g, "_")}`;
