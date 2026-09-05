// Speech normalization (spec/voice/README.md's "the full voice sidecar...
// speech normalization... is Hub v0.3", built ahead of that sequencing,
// 2026-09-04, at Jesse's direct request: "build the entire thing
// properly, not partial"). A pure, portable text transform - no model, no
// I/O - so both the hub backend (the wire-level `reply.speech` field) and
// the browser frontend (per-sentence live TTS streaming, ChatPage.tsx)
// import the identical function rather than each growing their own copy.
//
// The one rule that must never break: this function's OUTPUT is for
// TTS ONLY. Every caller keeps the ORIGINAL text for display untouched
// (Jesse, 2026-09-04: "if you have the voice say ten O four, you still
// display 10:04"). Nothing in this file is ever allowed to become the
// thing shown on screen.
//
// Scope, informed by home-legacy.git's docs/internal/voice-naturalness.md
// (the corpus study of ChatGPT Advanced Voice / Claude voice / Sesame /
// Hume / the OpenAI realtime guide, plus Santa Barbara Corpus extracts):
// that research is clear that REGISTER (brevity, hedging, contractions,
// rounding) is a PROMPT concern - it has to come from how the reply is
// generated, not a rewrite after the fact - so it lives in
// turnEngine.ts's system prompt, not here. What belongs here is the
// purely MECHANICAL half: a correctly-written number, time, date, or
// abbreviation read the way a person would say it out loud, regardless of
// how the text was produced (model, skill, or a constant string).

// ── Markup/emoji stripping ────────────────────────────────────────────────
// A small model can still emit markdown or emoji despite the system
// prompt asking it not to (SPOKEN_STYLE_POLICY is a strong nudge, not an
// enforced constraint); TTS engines read `**`, `#`, and pictographs aloud
// as garbage syllables or skip them unpredictably. Adapted from
// home-legacy.git's backend/src/lib/voice/speechText.ts (stripForSpeech),
// narrowed to what MaiPai Home's chat replies can actually contain today
// (no companion roleplay emotes, no code fences in a home-assistant
// reply's normal register - kept only because a model can still emit one
// unprompted).
function stripMarkupForSpeech(text: string): string {
  let s = text;
  s = s.replace(/```[\s\S]*?```/g, " "); // fenced code blocks
  s = s.replace(/`([^`\n]+)`/g, "$1"); // inline code -> keep the word
  s = s.replace(/!\[([^\]]*)]\([^)]*\)/g, "$1"); // images -> alt text
  s = s.replace(/\[([^\]]+)]\([^)]*\)/g, "$1"); // links -> label
  s = s.replace(/\*\*([^*\n]+)\*\*/g, "$1"); // **bold** -> word
  s = s.replace(/__([^_\n]+)__/g, "$1"); // __bold__ -> word
  s = s.replace(/(?<!\w)\*([^*\n]+)\*(?!\w)/g, "$1"); // *emphasis* -> word
  s = s.replace(/(?<!\w)_([^_\n]+)_(?!\w)/g, "$1"); // _emphasis_ -> word
  s = s.replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, ""); // headings
  s = s.replace(/^[ \t]*([-*+]|\d+\.)[ \t]+/gm, ""); // list bullets
  s = s.replace(/^[ \t]*>[ \t]?/gm, ""); // blockquotes
  // Emoji + dingbats + symbol pictographs.
  s = s.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu, "");
  return s;
}

// ── Number-to-words ─────────────────────────────────────────────────────
const ONES = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const SCALES: [number, string][] = [
  [1_000_000_000, "billion"],
  [1_000_000, "million"],
  [1_000, "thousand"],
];

function twoDigitsToWords(n: number): string {
  if (n < 20) return ONES[n]!;
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return ones === 0 ? TENS[tens]! : `${TENS[tens]}-${ONES[ones]}`;
}

function threeDigitsToWords(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds === 0) return twoDigitsToWords(rest);
  const hundredsPart = `${ONES[hundreds]} hundred`;
  return rest === 0 ? hundredsPart : `${hundredsPart} ${twoDigitsToWords(rest)}`;
}

/** Whole numbers only, up to just under a trillion (a home assistant
 * never has a real reason to say a number larger than that; standard
 * English scale words - thousand/million/billion - beyond it need a
 * longer table this domain has no use for). Negative numbers keep their
 * spoken "negative" prefix; 0 reads as "zero". */
export function numberToWords(n: number): string {
  if (n < 0) return `negative ${numberToWords(-n)}`;
  if (n === 0) return "zero";
  const parts: string[] = [];
  let remaining = n;
  for (const [scale, word] of SCALES) {
    if (remaining >= scale) {
      const count = Math.floor(remaining / scale);
      parts.push(`${threeDigitsToWords(count)} ${word}`);
      remaining %= scale;
    }
  }
  if (remaining > 0 || parts.length === 0) parts.push(threeDigitsToWords(remaining));
  return parts.join(" ");
}

const ORDINAL_WORD: Record<string, string> = {
  one: "first", two: "second", three: "third", five: "fifth", eight: "eighth",
  nine: "ninth", twelve: "twelfth", twenty: "twentieth", thirty: "thirtieth",
  forty: "fortieth", fifty: "fiftieth", sixty: "sixtieth", seventy: "seventieth",
  eighty: "eightieth", ninety: "ninetieth",
};

/** "3" -> "third", "21" -> "twenty-first". Only the last word of a spelled-
 * out cardinal ever changes shape for the ordinal form ("twenty-one" ->
 * "twenty-first", not "twentieth-first"), so this rewrites just that
 * tail. */
function ordinalWords(n: number): string {
  const cardinal = numberToWords(n);
  const lastDash = cardinal.lastIndexOf("-");
  const head = lastDash === -1 ? "" : cardinal.slice(0, lastDash + 1);
  const tail = lastDash === -1 ? cardinal : cardinal.slice(lastDash + 1);
  const ordinalTail = ORDINAL_WORD[tail] ?? (tail.endsWith("y") ? `${tail.slice(0, -1)}ieth` : `${tail}th`);
  return head + ordinalTail;
}

// ── Times ────────────────────────────────────────────────────────────────
// "10:04" -> "ten oh four"; "10:04 pm" -> "ten oh four in the evening";
// on-the-hour reads as "o'clock" ("3:00" -> "three o'clock"); the two
// spoken-only special cases a digital clock never distinguishes on its
// own ("12:00 am"/"12:00 pm" -> "midnight"/"noon"). Minutes 1-9 get the
// "oh" a person actually says ("ten oh four"), never "ten zero four" or
// the bare "ten four" a naive digit-read would produce.
// The trailing lookahead is deliberately NOT `\b`: the dotted "a.m."/"p.m."
// forms end in a period, a non-word character, so `\b` never matches
// between that period and the space or sentence-ending period that
// usually follows it (both sides non-word - no boundary exists at all) -
// a real bug this module's own live verification caught (2026-09-05): the
// marker group matched, then got silently backtracked away entirely to
// satisfy an unsatisfiable trailing `\b`, dropping the am/pm suffix.
// "Not followed by a letter" is what this actually needs to mean.
const TIME_RE = /\b(?:([01]?\d|2[0-3]):([0-5]\d))(\s*(?:am|pm|a\.m\.|p\.m\.))?(?![a-zA-Z])/gi;

function meridiemWord(hour: number, marker: string | undefined): { hour12: number; suffix: string } {
  const clean = (marker ?? "").toLowerCase().replace(/\./g, "").trim();
  if (clean === "am" || clean === "pm") {
    const hour12 = hour % 12 === 0 ? 12 : hour % 12;
    return { hour12, suffix: clean === "am" ? " in the morning" : " in the evening" };
  }
  // No am/pm marker at all: 24-hour input (13-23, or a bare 0) still
  // needs converting to a spoken 12-hour hour; a plain 1-12 with no
  // marker is ambiguous in real speech too, so it's read as-is with no
  // suffix, exactly how a person reads an unmarked clock face.
  if (hour === 0) return { hour12: 12, suffix: "" };
  if (hour > 12) return { hour12: hour - 12, suffix: "" };
  return { hour12: hour, suffix: "" };
}

function normalizeTimes(text: string): string {
  return text.replace(TIME_RE, (_whole, h: string, m: string, marker: string | undefined) => {
    const hour = Number(h);
    const minute = Number(m);
    const { hour12, suffix } = meridiemWord(hour, marker);
    const clean = (marker ?? "").toLowerCase().replace(/\./g, "").trim();
    if (hour12 === 12 && minute === 0 && clean === "am") return "midnight";
    if (hour12 === 12 && minute === 0 && clean === "pm") return "noon";
    const hourWords = numberToWords(hour12);
    if (minute === 0) return `${hourWords} o'clock${suffix}`;
    const minuteWords = minute < 10 ? `oh ${numberToWords(minute)}` : numberToWords(minute);
    return `${hourWords} ${minuteWords}${suffix}`;
  });
}

// ── Dates ────────────────────────────────────────────────────────────────
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTH_RE = new RegExp(`\\b(${MONTHS.join("|")})\\s+(\\d{1,2})(?:,\\s*(\\d{4}))?\\b`, "g");
const ISO_DATE_RE = /\b(\d{4})-(\d{2})-(\d{2})\b/g;

function spokenYear(year: number): string {
  // "2026" -> "twenty twenty-six", the way a person actually says a
  // four-digit year, not "two thousand twenty-six" (also correct, just
  // not how a home assistant register talks). Years before 1000 or
  // outside a clean century split (e.g. 2005) fall back to a plain
  // cardinal read, which is still perfectly natural for those cases
  // ("nineteen oh five" isn't worth a special rule this domain never
  // exercises).
  if (year >= 2000 && year <= 2099) {
    const rest = year - 2000;
    return rest === 0 ? "twenty hundred" : `twenty ${twoDigitsToWords(rest)}`;
  }
  if (year >= 1000 && year <= 1999 && year % 100 !== 0) {
    return `${twoDigitsToWords(Math.floor(year / 100))} ${twoDigitsToWords(year % 100)}`;
  }
  return numberToWords(year);
}

function normalizeDates(text: string): string {
  let s = text.replace(MONTH_RE, (_whole, month: string, day: string, year: string | undefined) => {
    const spoken = `${month} ${ordinalWords(Number(day))}`;
    return year ? `${spoken}, ${spokenYear(Number(year))}` : spoken;
  });
  s = s.replace(ISO_DATE_RE, (_whole, y: string, mo: string, d: string) => {
    const month = MONTHS[Number(mo) - 1];
    if (!month) return _whole; // an out-of-range month isn't a real date; leave it untouched
    return `${month} ${ordinalWords(Number(d))}, ${spokenYear(Number(y))}`;
  });
  return s;
}

// ── Currency ─────────────────────────────────────────────────────────────
// "$5" -> "five dollars"; "$5.50" -> "five dollars and fifty cents";
// "$0.50"/"50 cents" already spoken as cents -> "fifty cents"; "$1" (never
// "$1 dollars") and "1 cent" (never "1 cents") keep the singular a person
// actually says.
const CURRENCY_RE = /\$(\d[\d,]*)(?:\.(\d{2}))?/g;

function dollarsAndCents(dollars: number, cents: number | undefined): string {
  const dollarWord = dollars === 1 ? "dollar" : "dollars";
  const dollarsPart = `${numberToWords(dollars)} ${dollarWord}`;
  if (!cents) return dollarsPart;
  const centWord = cents === 1 ? "cent" : "cents";
  return `${dollarsPart} and ${numberToWords(cents)} ${centWord}`;
}

function normalizeCurrency(text: string): string {
  return text.replace(CURRENCY_RE, (_whole, dollarsStr: string, centsStr: string | undefined) => {
    const dollars = Number(dollarsStr.replace(/,/g, ""));
    const cents = centsStr ? Number(centsStr) : undefined;
    return dollarsAndCents(dollars, cents);
  });
}

// ── Percentages ──────────────────────────────────────────────────────────
const PERCENT_RE = /(\d+(?:\.\d+)?)\s?%/g;

function normalizePercent(text: string): string {
  return text.replace(PERCENT_RE, (_whole, n: string) => `${spokenDecimal(n)} percent`);
}

function spokenDecimal(n: string): string {
  const [whole, frac] = n.split(".");
  const wholeWords = numberToWords(Number(whole));
  if (!frac) return wholeWords;
  const fracWords = [...frac].map((d) => ONES[Number(d)]).join(" ");
  return `${wholeWords} point ${fracWords}`;
}

// ── Units and common abbreviations ────────────────────────────────────────
// Expanded to their spoken full form BEFORE the generic number pass, so
// the digit that precedes each one still gets spelled out normally
// afterward ("5mph" -> "5 miles per hour" -> "five miles per hour").
const UNIT_ABBREVIATIONS: [RegExp, string][] = [
  [/\bmph\b/gi, "miles per hour"],
  [/\bkm\/h\b/gi, "kilometers per hour"],
  [/°F\b/g, " degrees Fahrenheit"],
  [/°C\b/g, " degrees Celsius"],
  [/\bft\b/gi, "feet"],
  // Unlike the other abbreviations here, "in" alone is a common English
  // word ("I put it in."), so this only fires right after a digit -
  // "5 in." / "5in." are unambiguous; a bare "in." never is.
  [/(?<=\d)\s?in\.(?=\s|$)/g, " inches"],
  [/\blbs?\b/gi, "pounds"],
  [/\boz\b/gi, "ounces"],
  [/\bkm\b/gi, "kilometers"],
  [/\bkg\b/gi, "kilograms"],
  [/\bmi\b/gi, "miles"],
  [/\bhrs?\b/gi, "hours"],
  [/\bmins?\b/gi, "minutes"],
];

// Common written abbreviations a TTS engine either mispronounces (reads
// the letters/period literally) or stumbles on; expanded to the word a
// person actually says. Deliberately short: only forms plausible in a
// home assistant's own reply, not a general-purpose abbreviation list.
const WORD_ABBREVIATIONS: [RegExp, string][] = [
  [/\bMr\.\s?/g, "Mister "],
  [/\bMrs\.\s?/g, "Missus "],
  [/\bMs\.\s?/g, "Miz "],
  [/\bDr\.\s?/g, "Doctor "],
  [/\bSt\.\s?/g, "Saint "],
  [/\bvs\.\s?/g, "versus "],
  [/\betc\.\s?/g, "et cetera "],
  [/\bapprox\.\s?/g, "approximately "],
];

function normalizeUnitsAndAbbreviations(text: string): string {
  let s = text;
  for (const [re, word] of UNIT_ABBREVIATIONS) s = s.replace(re, word);
  for (const [re, word] of WORD_ABBREVIATIONS) s = s.replace(re, word);
  return s;
}

// ── Generic numbers (the catch-all, run last) ─────────────────────────────
// Ordinal digits ("1st", "22nd") first, since a plain-number pass would
// otherwise spell out the leading digits and strand the suffix letters as
// noise; then thousands-separated and plain cardinals. Decimals spoken
// digit-by-digit after "point" ("3.5" -> "three point five"), the way a
// person reads a decimal that isn't money or a percentage (both already
// consumed above).
const ORDINAL_DIGIT_RE = /\b(\d+)(st|nd|rd|th)\b/gi;
const NUMBER_RE = /\b\d[\d,]*(?:\.\d+)?\b/g;

/** Grammar agreement for the one case normalization itself can create: a
 * template's hardcoded plural noun next to the specific count 1 ("1
 * items" - the recipe/skill's own string, not this function's fault, but
 * "one items" is exactly the seams-showing tell a person never produces).
 * Deliberately narrow (regular "-s" plurals only; irregular ones like
 * "children" are a documented, accepted gap): the ambiguity of guessing
 * plural-vs-already-singular for every noun in English isn't worth
 * chasing for a rule that exists to fix one specific known seam. */
function fixSingularAgreement(text: string): string {
  return text.replace(/\bone ([a-z]+)s\b/g, (whole, stem: string) => {
    // Words that already end in "s" in their singular form ("bus", "gas",
    // "lens", "glass") aren't plurals to begin with; stripping the
    // capturing group's trailing "s" back off would break them, not fix
    // them - so the check runs against the FULL word (stem + the "s" the
    // pattern consumed), not the truncated stem alone.
    if (/(ss|us|is|as|ens)$/i.test(`${stem}s`)) return whole;
    return `one ${stem}`;
  });
}

function normalizeGenericNumbers(text: string): string {
  let s = text.replace(ORDINAL_DIGIT_RE, (_whole, n: string) => ordinalWords(Number(n)));
  s = s.replace(NUMBER_RE, (whole) => spokenDecimal(whole.replace(/,/g, "")));
  return fixSingularAgreement(s);
}

/** The one, central, mechanical text-to-speech normalizer (voice sidecar,
 * `spec/voice/README.md`): numbers, times, dates, currency, percentages,
 * units, common abbreviations, and stray markdown/emoji, each read the
 * way a person actually says them out loud. Pure and side-effect free;
 * never call it on anything meant for the screen. Order matters - each
 * pass below consumes the digit patterns the later, more general passes
 * would otherwise mis-read (a time's "10:04" must become words before the
 * generic number pass ever sees a bare "04"), so this is not a set of
 * independent regexes callers can reorder or run a subset of. */
export function normalizeForSpeech(text: string): string {
  let s = stripMarkupForSpeech(text);
  s = normalizeDates(s);
  s = normalizeTimes(s);
  s = normalizeCurrency(s);
  s = normalizePercent(s);
  s = normalizeUnitsAndAbbreviations(s);
  s = normalizeGenericNumbers(s);
  s = s.replace(/[ \t]{2,}/g, " ");
  s = s.replace(/\s+([.,!?;:])/g, "$1");
  return s.trim();
}
