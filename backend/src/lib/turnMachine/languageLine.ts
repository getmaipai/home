// I18N-C1: the one fixed language line of the chat turn's system prompt.
// A closed table keyed by the validated `resolveLocale` value, declared
// here and nowhere else. An adult's written turn in a locale with an entry
// gets that line at the end of the stable prefix; every other locale
// (`en-US`, `en-GB`) has no entry, so its prompt is unchanged byte for
// byte. The line is language only: nothing about length, style, register,
// tools or search, and no setting text is ever pasted into it.
import { isWrittenAdultTurn } from "@/lib/surfaceClass";
import type { SurfaceClass } from "@/lib/surfaceClass";
import type { TurnSignal } from "@maipai/spec/gen/ts/turn-signal.js";

export const LANGUAGE_LINES: Readonly<Record<string, string>> = Object.freeze({
  es: "The person's language is Spanish. Answer in Spanish unless they write in another language.",
});

/** "" (no line) unless this is a written adult turn (isWrittenAdultTurn) and the locale has a table entry. */
export function languageLineFor(locale: string | undefined, surfaceClass: SurfaceClass | undefined, ageBand: TurnSignal["age_band"]): string {
  if (!locale || !isWrittenAdultTurn(surfaceClass, ageBand)) return "";
  return Object.prototype.hasOwnProperty.call(LANGUAGE_LINES, locale) ? LANGUAGE_LINES[locale]! : "";
}
