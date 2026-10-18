// The one list behind the absolute line for pictures and videos: nothing sexual involving a minor or a
// minor-looking person, for anyone, with no setting that reaches it (docs/design/RULES.md rule 0,
// ../.github/docs/SAFETY.md). A request is refused when a MINOR MARKER and a SEXUAL WORD appear anywhere
// in it. Owner's ruling, 2026-10-17: adults get adult content, so the markers are real minor markers
// only. "girl", "boy", "lady", "guy", "man", "woman", "young woman" and "young man" are NOT markers (adult
// women are called girls); "young girl", "young boy", "little girl" and "little boy" ARE. A marker beside a
// non-sexual wording ("a kids' birthday party", "a baby smiling") stays allowed, and "bikini" is swimwear,
// not a sexual word. Update the versioned floor data only; tests/minorLine.test.ts pins both directions.

import { floorsSchema } from "../contentPolicy/dataSchema";
import floorSource from "../contentPolicy/data/floors.v1.json";
const floorData = floorsSchema.parse(floorSource);
for (const values of Object.values(floorData)) if (Array.isArray(values)) Object.freeze(values);
Object.freeze(floorData);

/** Words and phrases that put a minor, or a minor-looking person, in the picture. Matched as whole words; a stem ending "-" is not used, list the plural. */
export const MINOR_MARKERS: readonly string[] = floorData.MINOR_MARKERS;

/** Sexual or nudity words. A marker beside any of these refuses. "bikini" and other ordinary swimwear are deliberately absent. */
export const SEXUAL_WORDS: readonly string[] = floorData.SEXUAL_WORDS;

/** Plain ways to say no clothes without a word above ("two kids playing, no clothes"). Beside a marker they count as sexual; alone they are ordinary (a shirtless man at the beach passes). */
export const UNCLOTHED_PHRASES: readonly string[] = floorData.UNCLOTHED_PHRASES;

// ---------------------------------------------------------------- matching: one normaliser, shared with the chat floor
// All matching goes through commons' spec/safety/ts/fold.ts (the same folding `detectCsam` uses): invisible characters,
// look-alike letters, leetspeak, dotted/spaced/masked/repeated letters, other languages and native scripts. This file keeps
// only the English lists and the pairing rule. Update the versioned floor data only; the folding there and nowhere else.
import {
  MINOR_AGE, MINOR_WORDS_I18N, NATIVE_MINOR, NATIVE_SEXUAL, SEXUAL_WORDS_I18N, TermSet, foldForSafety, hasMinorAge, type SafetyFold,
} from "@maipai/spec/safety/ts/fold.js";

export { MINOR_AGE };

/** The text as plain lowercase words between single spaces, folded the same way the floors fold it (for callers that need a word reading). */
export function normalise(text: string): string {
  return ` ${foldForSafety(text).plain} `;
}

/** Sexual-word terms of six or more letters also match as the start of a word ("masturbat", "molest"); markers are whole words only ("infant" is not "infantry"). */
const sexualPrefix = (term: string): boolean => term.length >= 6;

const SEXUAL_SET = new TermSet([...SEXUAL_WORDS, ...SEXUAL_WORDS_I18N], { prefix: sexualPrefix });
const UNCLOTHED_SET = new TermSet(UNCLOTHED_PHRASES, { prefix: sexualPrefix });
/** "cp" is also vitamin C P, C. P., calcium phosphate and a shell command: it counts as the abbreviation (typed, dotted or spaced) unless the text is about chemistry, nutrition or code. */
const AMBIGUOUS_MARKERS = new Set(["cp"]);
const MARKER_SET = new TermSet([...MINOR_MARKERS.filter((m) => !AMBIGUOUS_MARKERS.has(m)), ...MINOR_WORDS_I18N]);
const CP_SET = new TermSet(["cp"]);
const CP_CONTEXT = /(?<![\p{L}\p{N}])(?:vitamin|vitamins|mineral|minerals|supplement|supplements|calcium|phosphate|phosphorus|chemistry|chemical|protein|cell|cells|folder|file|files|terminal|command|bash|linux|shell|script)(?![\p{L}\p{N}])/u;
function cpMarkerIn(fold: SafetyFold): boolean {
  return CP_SET.matches(fold) && !CP_CONTEXT.test(fold.plain);
}

/** True when `term` (a word or phrase) is in the text under any disguise, read the way a sexual word is read (a long stem matches the start of a word). */
export function hasWord(text: string, term: string): boolean {
  let set = TERM_CACHE.get(term);
  if (!set) { set = new TermSet([term], { prefix: sexualPrefix }); TERM_CACHE.set(term, set); }
  return set.matches(foldForSafety(text));
}
const TERM_CACHE = new Map<string, TermSet>();

/** Phrases that carry a sexual word without being sexual ("sex reveal party"); removed before the check. */
const NEUTRAL_PHRASES = /\b(?:sex|gender)[\s\-]+reveal\b/gi;
function foldedForLine(text: string): SafetyFold {
  return foldForSafety(text.replace(NEUTRAL_PHRASES, " "));
}

function sexualIn(fold: SafetyFold): boolean {
  return SEXUAL_SET.matches(fold) || NATIVE_SEXUAL.test(fold);
}

export function mentionsSexualWord(text: string): boolean {
  return sexualIn(foldedForLine(text));
}

/** True when the text carries a plain "no clothes" phrase (alone it is ordinary; beside a minor marker it counts as sexual). */
export function mentionsUnclothedPhrase(text: string): boolean {
  return UNCLOTHED_SET.matches(foldedForLine(text));
}

/** True when the words carry a minor marker or an age under 18 (any disguise, any listed language), with no sexual word needed. */
export function mentionsMinorCue(text: string): boolean {
  return minorCueIn(foldedForLine(text));
}

function minorCueIn(fold: SafetyFold): boolean {
  return MARKER_SET.matches(fold) || cpMarkerIn(fold) || NATIVE_MINOR.test(fold) || hasMinorAge(fold);
}

/** True when the text puts a minor marker (or an age under 18) beside a sexual or nudity word, however far apart, under any disguise. */
export function minorSexualMatch(text: string): boolean {
  const fold = foldedForLine(text);
  if (!sexualIn(fold) && !UNCLOTHED_SET.matches(fold)) return false;
  return minorCueIn(fold);
}

/**
 * The fail-closed rule for text in more than one script (docs: commons spec/safety/README.md, "the obfuscation normaliser").
 * The folding reads Latin, the listed non-Latin scripts (Japanese, Chinese, Korean, Russian, Arabic) and the look-alike
 * letters; it cannot read the other part of a prompt that mixes Latin letters with some other script, and that part could
 * hold the sexual wording. So a prompt that mixes scripts AND carries any age cue (a minor marker, a native age word or an
 * age under 18) is refused for pictures and videos. A prompt wholly in one script is judged by its own lists; a prompt wholly
 * in an unlisted script is a known gap that only the finished-picture check covers.
 */
export function mixedScriptMinorCue(text: string): boolean {
  const fold = foldedForLine(text);
  return fold.mixedScripts && minorCueIn(fold);
}

/** Shared checks over an already folded matching copy. Existing callers keep their own adapters. */
export function contentChecksForFold(fold: SafetyFold): { minorLine: boolean; adultContent: boolean } {
  const safeFold = { ...fold, forms: fold.forms.map(form => ({ ...form, text: form.text.replace(NEUTRAL_PHRASES, " ") })) };
  const adultContent = sexualIn(safeFold) || UNCLOTHED_SET.matches(safeFold);
  return { adultContent, minorLine: (adultContent || fold.mixedScripts) && minorCueIn(safeFold) };
}
