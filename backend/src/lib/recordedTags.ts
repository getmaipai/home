import type { RecordedSpeechEngine } from "@/lib/tts";
import { getTtsTags } from "@/lib/ttsCapabilities";
import { KNOWN_CUE_TAGS } from "@/lib/voiceCues";

// Fish Audio Drama 3 model card documents sighs, laughs and whispers; its technical report documents the remaining cues.
export const FISH_DRAMA_TAGS = ["sighs", "laughs", "whispers", "gasps", "coughs", "clears throat", "pause", "softly", "hesitates"] as const;

/** Plain cue names supported by the engine; clients add the brackets. */
export async function tagsForEngine(engine: RecordedSpeechEngine): Promise<string[]> {
  if (engine === "fish-audio-drama-3") return [...FISH_DRAMA_TAGS];
  const advertised = await getTtsTags();
  return KNOWN_CUE_TAGS.filter((name) => advertised.some((tag) => tag.replace(/^\[|\]$/g, "").toLowerCase() === name));
}
