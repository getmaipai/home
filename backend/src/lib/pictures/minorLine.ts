// The one list behind the absolute line for pictures and videos: nothing sexual involving a minor or a
// minor-looking person, for anyone, with no setting that reaches it (docs/design/RULES.md rule 0,
// ../.github/docs/SAFETY.md). A request is refused when a MINOR MARKER and a SEXUAL WORD appear anywhere
// in it. Owner's ruling, 2026-10-17: adults get adult content, so the markers are real minor markers
// only. "girl", "boy", "lady", "guy", "man", "woman", "young woman" and "young man" are NOT markers (adult
// women are called girls); "young girl", "young boy", "little girl" and "little boy" ARE. A marker beside a
// non-sexual wording ("a kids' birthday party", "a baby smiling") stays allowed, and "bikini" is swimwear,
// not a sexual word. Update the lists here and nowhere else; tests/minorLine.test.ts pins both directions.

/** Words and phrases that put a minor, or a minor-looking person, in the picture. Matched as whole words; a stem ending "-" is not used, list the plural. */
export const MINOR_MARKERS: readonly string[] = [
  // plain minors
  "child", "children", "kid", "kids", "kiddo", "kiddos", "minor", "minors", "underage", "underaged", "under age", "under aged", "juvenile", "juveniles",
  "toddler", "toddlers", "baby", "babies", "infant", "infants", "newborn", "newborns",
  "preteen", "preteens", "pre teen", "pre teens", "tween", "tweens", "teen", "teens", "teenager", "teenagers", "teenage", "teenaged", "teen aged",
  "pubescent", "prepubescent", "pre pubescent",
  // gendered young phrases (the bare words girl and boy are NOT markers)
  "little girl", "little girls", "little boy", "little boys", "young girl", "young girls", "young boy", "young boys",
  "small girl", "small girls", "small boy", "small boys", "baby girl", "baby girls", "baby boy", "baby boys", "youngster", "youngsters",
  // school
  "schoolgirl", "schoolgirls", "schoolboy", "schoolboys", "school girl", "school girls", "school boy", "school boys", "schoolkid", "schoolkids", "schoolchild", "schoolchildren", "preschooler", "preschoolers", "under 18", "under eighteen", "below 18", "younger than 18",
  "school uniform", "high school", "middle school", "elementary", "kindergarten", "grade school", "preschool",
  // looks young
  "childlike", "child like", "childish", "babyface", "baby face", "young looking", "youthful looking", "flat chest", "flat chested",
  // coded terms
  "loli", "lolis", "lolita", "lolitas", "lolicon", "shota", "shotacon", "jailbait", "barely legal", "just turned 18", "cp",
];

/** Sexual or nudity words. A marker beside any of these refuses. "bikini" and other ordinary swimwear are deliberately absent. */
export const SEXUAL_WORDS: readonly string[] = [
  "nude", "naked", "nudity", "topless", "bottomless", "undress", "undressed", "undressing", "lingerie", "underwear", "panties", "bra", "thong", "cleavage", "breasts", "boobs", "nipples",
  "genital", "genitals", "vagina", "penis", "cock", "pussy", "buttocks", "crotch", "groin",
  "sex", "sexy", "sexual", "sexualized", "sexualised", "erotic", "erotica", "porn", "porno", "pornographic", "nsfw", "explicit", "lewd", "hentai", "ecchi", "fetish", "seductive", "provocative", "suggestive",
  "nipple", "breast", "bare breast", "bare breasts", "nudes", "nakedness", "butt", "tits", "sensual", "horny", "anal", "orgy", "cum", "cumming", "dick",
  "orgasm", "masturbat", "fellatio", "blowjob", "cumshot", "intercourse", "molest", "rape", "bondage", "kinky", "xxx", "r18", "uncensored", "spread legs", "legs spread",
];

/** Plain ways to say no clothes without a word above ("two kids playing, no clothes"). Beside a marker they count as sexual; alone they are ordinary (a shirtless man at the beach passes). */
export const UNCLOTHED_PHRASES: readonly string[] = [
  "unclothed", "shirtless", "no clothes", "no clothing", "without clothes", "without clothing", "without a shirt", "clothes off", "clothing off", "stripped", "skinny dipping", "skinny dip",
  "bare chested", "bare skin", "bare bottom", "bare butt", "birthday suit", "au naturel", "wearing nothing", "not wearing anything", "not wearing any clothes",
];

// ---------------------------------------------------------------- matching: one normaliser, shared with the chat floor
// All matching goes through commons' spec/safety/ts/fold.ts (the same folding `detectCsam` uses): invisible characters,
// look-alike letters, leetspeak, dotted/spaced/masked/repeated letters, other languages and native scripts. This file keeps
// only the English lists and the pairing rule. Update the lists here and nowhere else; the folding there and nowhere else.
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
const MARKER_SET = new TermSet([...MINOR_MARKERS, ...MINOR_WORDS_I18N]);

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
  return MARKER_SET.matches(fold) || NATIVE_MINOR.test(fold) || hasMinorAge(fold);
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
