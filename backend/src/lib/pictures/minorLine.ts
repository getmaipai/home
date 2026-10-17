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
  "small girl", "small boy", "baby girl", "baby boy",
  // school
  "schoolgirl", "schoolgirls", "schoolboy", "schoolboys", "school girl", "school girls", "school boy", "school boys", "schoolkid", "schoolkids",
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
  "orgasm", "masturbat", "fellatio", "blowjob", "cumshot", "intercourse", "molest", "rape", "bondage", "kinky", "xxx", "r18", "uncensored", "spread legs", "legs spread",
];

/** Plain ways to say no clothes without a word above ("two kids playing, no clothes"). Beside a marker they count as sexual; alone they are ordinary (a shirtless man at the beach passes). */
export const UNCLOTHED_PHRASES: readonly string[] = [
  "unclothed", "shirtless", "no clothes", "no clothing", "without clothes", "without clothing", "without a shirt", "clothes off", "clothing off", "stripped", "skinny dipping", "skinny dip",
  "bare chested", "bare skin", "bare bottom", "bare butt", "birthday suit", "au naturel", "wearing nothing", "not wearing anything", "not wearing any clothes",
];

const AGE_WORDS = "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen";
const AGE_NUMBER = "(?:[1-9]|1[0-7])";
/** An age under 18 in any written form: "14yo", "15 y o", "12 yr", "16 year old", "12 years of age", "age 15", "aged 9", "twelve years old". Whole numbers only, so 25 and 40 pass. */
export const MINOR_AGE = new RegExp(
  [
    `\\b${AGE_NUMBER}\\s?(?:yo|y o|yr|yrs)\\b`,
    `\\b${AGE_NUMBER}\\s?(?:year|years|yr|yrs)\\s(?:old|olds|of age)\\b`,
    `\\bage[sd]?\\s${AGE_NUMBER}\\b`,
    `\\b(?:${AGE_WORDS})\\s(?:year|years|yr|yrs)\\s(?:old|of age)\\b`,
    `\\b(?:${AGE_WORDS})\\s?(?:yo|y o)\\b`,
  ].join("|"),
);

export function normalise(text: string): string {
  return ` ${text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim()} `;
}

export function hasWord(haystack: string, term: string): boolean {
  const needle = ` ${term} `;
  if (haystack.includes(needle)) return true;
  // A stem such as "masturbat" or "molest" matches the start of a word.
  return term.length >= 6 && haystack.includes(` ${term}`);
}

export function mentionsSexualWord(text: string): boolean {
  const n = normalise(text);
  return SEXUAL_WORDS.some((term) => hasWord(n, term));
}

/** True when the text puts a minor marker (or an age under 18) beside a sexual or nudity word, however far apart. */
export function minorSexualMatch(text: string): boolean {
  const n = normalise(text);
  const sexual = SEXUAL_WORDS.some((term) => hasWord(n, term)) || UNCLOTHED_PHRASES.some((term) => hasWord(n, term));
  if (!sexual) return false;
  return MINOR_MARKERS.some((term) => hasWord(n, term)) || MINOR_AGE.test(n);
}
