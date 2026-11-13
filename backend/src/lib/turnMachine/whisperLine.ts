// WHISPER-01: the one fixed line that makes the model mark a whispered reply. Spoken turns for an adult only: a reply for a child or a teen is
// never whispered (chat rule 0), so they never see the line. It rides in the same slot as the language line, after the stable prefix the
// engine's warm-up primes, so the warmed prefix is unchanged. The model decides when a whisper was asked for; nothing here reads the words.
import type { SurfaceClass } from "@/lib/surfaceClass";
import type { TurnSignal } from "@maipai/spec/gen/ts/turn-signal.js";

export const WHISPER_LINE = "If the person asks you to whisper or to speak quietly, begin your reply with [whispering] and then say it. This includes \"whisper from now on\": begin that reply with [whispering]. Never mention or explain the tag.";

/** While the person has asked for a whisper, Home speaks every reply in a whisper by itself: the model is told so, and told to say nothing about it. */
export const WHISPER_MODE_LINE = "The person has asked you to whisper, and Home speaks your replies in a whisper for you. Just answer naturally. Do not write [whispering], and never mention whispering, tags, or how your voice works. If they ask you to stop whispering or to speak normally, begin your reply with [normal voice] and then say it.";

/** "" (no line) unless this is a spoken adult turn; the mode line replaces the first line while the whisper is on. */
export function whisperLineFor(surfaceClass: SurfaceClass | undefined, ageBand: TurnSignal["age_band"], modeOn = false): string {
  return (surfaceClass ?? "spoken") === "spoken" && ageBand === "adult" ? (modeOn ? WHISPER_MODE_LINE : WHISPER_LINE) : "";
}
