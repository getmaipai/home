// WHISPER-01: the one fixed line that makes the model mark a whispered reply. Spoken turns for an adult only: a reply for a child or a teen is
// never whispered (chat rule 0), so they never see the line. It rides in the same slot as the language line, after the stable prefix the
// engine's warm-up primes, so the warmed prefix is unchanged. The model decides when a whisper was asked for; nothing here reads the words.
import type { SurfaceClass } from "@/lib/surfaceClass";
import type { TurnSignal } from "@maipai/spec/gen/ts/turn-signal.js";

export const WHISPER_LINE = "If the person asks you to whisper or to speak quietly, begin your reply with [whispering] and then say it. Never mention or explain the tag.";

/** "" (no line) unless this is a spoken adult turn. */
export function whisperLineFor(surfaceClass: SurfaceClass | undefined, ageBand: TurnSignal["age_band"]): string {
  return (surfaceClass ?? "spoken") === "spoken" && ageBand === "adult" ? WHISPER_LINE : "";
}
