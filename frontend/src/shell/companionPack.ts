// PACK-06: the companion pack seam between Home and the kit's CompanionPackPlayer.
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { phonesFor, PackSpeechBuilder, loadPronouncing, pronouncingReady, type PackSpeechInput } from "@/lib/packSpeech";
import { subscribeSpeechTap, type SpeechSource } from "@/lib/speechTap";
import type { StageMode } from "@maipai/ui/src/elements/companion-stage";
import type { PackState } from "@maipai/ui/src/elements/companion-pack";

/** The pack the avatar route returns when the companion has a valid pack folder. */
export type AvatarPack = { url: string; manifest: Record<string, unknown> };

/** The stage mode as a pack state. Working reads as thinking. */
export function packStateFor(mode: StageMode): PackState {
  return mode === "listening" ? "listen" : mode === "speaking" ? "speak" : mode === "thinking" || mode === "working" ? "think" : "idle";
}

/**
 * PACK-06b: the `speech` prop for the kit player. While a pack companion is on screen it follows the reply voice (lib/speechTap.ts),
 * builds provisional then final mouth cues from the spoken text and the played samples, and clears at once when the voice stops.
 * Returns undefined whenever nothing is being spoken; the pane also gates it on the speaking mode.
 */
export function usePackSpeech(enabled: boolean): PackSpeechInput | undefined {
  const [speech, setSpeech] = useState<PackSpeechInput | undefined>(undefined);
  useEffect(() => {
    if (!enabled) { setSpeech(undefined); return; }
    let current: SpeechSource | null = null;
    let builder: PackSpeechBuilder | null = null;
    let alive = true;
    const publish = () => { if (alive) setSpeech(builder?.build()); };
    const unsubscribe = subscribeSpeechTap((event) => {
      if (event.type === "stop") { if (event.source === current) { builder = null; current = null; setSpeech(undefined); } return; }
      if (event.source !== current) {
        const source = event.source;
        current = source;
        builder = new PackSpeechBuilder({ phonesFor: () => phonesFor, clock: () => source.speechClock() });
        if (!pronouncingReady()) void loadPronouncing(() => api.speechDictionary()).then(() => { if (alive && current === source && builder) { builder.rebuild(); publish(); } });
      }
      if (event.type === "sentence") builder!.sentence(event.sentence, event.text);
      else if (event.type === "audio") { if (builder!.audio(event.sentence, event.samples, event.rate, event.at)) publish(); }
      else if (event.type === "sentenceEnd") { builder!.end(event.sentence); publish(); }
    });
    return () => { alive = false; unsubscribe(); setSpeech(undefined); };
  }, [enabled]);
  return enabled ? speech : undefined;
}
