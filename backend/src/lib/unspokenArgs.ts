// Item 4a (docs/plans/baseline-fixes-2026-09-13.md): a tool never runs
// on an argument the person did not say. The 47-conversation bench
// (docs/dev/session-a.md) saw "set a timer" run a ten-minute timer the
// model invented and "add it to the list" add the word "it". The rule,
// applied before any package runs on either path (the literal pattern's
// capture in prepareTurn(), a Tier 2 call in resolveToolCalls()): an
// argument whose value carries a number or a duration unit that does
// not appear in the utterance, or that is a bare pronoun, is not run;
// the turn asks for the value through the existing ask path instead. A
// pronoun resolves through the active subject once CHAT-13 lands; until
// then it asks.
//
// Deliberately narrow: only numbers and duration units are compared, so
// a model that writes "5 minutes" for a spoken "five minutes" or "6pm"
// for "at 6" is not read as inventing (number words fold to digits, and
// am/pm is a qualifier the rule does not read). A value with no number,
// unit or pronoun in it ("weather in Lisbon", "call Nadia") is never
// questioned here: the package's own argument check still applies.

const PRONOUNS = new Set(["it", "that", "this", "them", "those", "these", "him", "her", "one", "something", "stuff", "the thing"]);

const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100,
  couple: 2, dozen: 12,
};

const UNIT_SYNONYMS: Record<string, string> = {
  s: "second", sec: "second", secs: "second", second: "second", seconds: "second",
  m: "minute", min: "minute", mins: "minute", minute: "minute", minutes: "minute",
  h: "hour", hr: "hour", hrs: "hour", hour: "hour", hours: "hour",
  d: "day", day: "day", days: "day",
  w: "week", wk: "week", wks: "week", week: "week", weeks: "week",
};
const UNITS = new Set(Object.values(UNIT_SYNONYMS));

const TENS = new Set([20, 30, 40, 50, 60, 70, 80, 90]);
const FRACTIONS: Record<string, number> = { half: 0.5, quarter: 0.25 };

/** Folds a run of number words to one number: "twenty five" 25,
 * "forty-five" 45 (the hyphen splits first), "a hundred and twenty"
 * 120, "one and a half" 1.5, "half" alone 0.5, "a dozen" 12 (a review:
 * single words folded and every compound length was withheld). Returns
 * the value and how many words it consumed, or null when the run does
 * not start with a number. */
function foldNumberRun(words: readonly string[], start: number): { value: number; consumed: number } | null {
  let i = start;
  let total = 0;
  let current = 0; // the part below a hundred being built
  let seen = false;
  let lastWasDigitWord = false;
  const result = () => (seen ? { value: total + current, consumed: i - start } : null);
  while (i < words.length) {
    const w = words[i]!;
    const next = words[i + 1];
    if (w === "a" || w === "an") {
      if (next === "hundred" || next === "dozen" || next === "half" || next === "quarter") {
        i++; // "a hundred", "a half": the word after carries it
        continue;
      }
      return result();
    }
    if (w === "and") {
      if (seen && next !== undefined && (next in NUMBER_WORDS || next in FRACTIONS || ((next === "a" || next === "an") && words[i + 2] !== undefined && (words[i + 2]! in FRACTIONS || words[i + 2] === "hundred")))) {
        lastWasDigitWord = false; // "three hundred and five"
        i++;
        continue;
      }
      return result();
    }
    if (w in FRACTIONS) {
      total += current + FRACTIONS[w]!;
      current = 0;
      seen = true;
      i++;
      return result(); // a fraction ends the number ("one and a half", "half")
    }
    if (!(w in NUMBER_WORDS)) return result();
    const n = NUMBER_WORDS[w]!;
    if (w === "hundred" || w === "dozen") {
      current = (current || 1) * (w === "hundred" ? 100 : 12);
      seen = true;
      lastWasDigitWord = false;
      i++;
      continue;
    } else if (TENS.has(n)) {
      if (current !== 0 && current < 100) return result(); // "twenty thirty": two numbers
      current += n;
    } else if (n < 20) {
      if (lastWasDigitWord && !TENS.has(current % 100) && current !== 0) return result(); // "five five": two numbers
      if (current !== 0 && current % 100 !== 0 && !TENS.has(current % 100)) return result();
      current += n;
    } else {
      current += n;
    }
    seen = true;
    lastWasDigitWord = true;
    i++;
  }
  return result();
}

const formatNumber = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));

const IN_MINUTES: Record<string, number> = { second: 1 / 60, minute: 1, hour: 60, day: 1440, week: 10080 };

/** Every duration phrase in a token list, in minutes: "1 hour 30
 * minute" and "1 hour and 0.5" are 90, "0.5 1 hour" ("half an hour")
 * and "0.25 of 1 hour" are 30 and 15, "90 second" is 1.5. Consecutive
 * amount-and-unit pairs, joined by nothing or "and", sum to one phrase
 * (a review: "an hour and a half" written as "1 hour 30 minutes" was
 * withheld). */
function durationsInMinutes(tokens: readonly string[]): number[] {
  const totals: number[] = [];
  let i = 0;
  while (i < tokens.length) {
    let total: number | null = null;
    for (;;) {
      const t = tokens[i];
      const isNum = t !== undefined && /^\d+(?:\.\d+)?$/.test(t);
      if (!isNum) break;
      let amount = Number(t);
      let j = i + 1;
      // "0.5 1 hour" (half an hour), "0.25 of 1 hour" (a quarter of an hour)
      if (tokens[j] === "of") j++;
      if (tokens[j] === "1" && amount < 1) j++;
      const unit = tokens[j];
      if (unit === undefined || !(unit in IN_MINUTES)) break;
      j++;
      // "1 hour and 0.5": the fraction after the unit belongs to it.
      if (tokens[j] === "and" && tokens[j + 1] !== undefined && /^0\.\d+$/.test(tokens[j + 1]!) && !(tokens[j + 2] !== undefined && tokens[j + 2]! in IN_MINUTES)) {
        amount += Number(tokens[j + 1]);
        j += 2;
      }
      total = (total ?? 0) + amount * IN_MINUTES[unit]!;
      i = j;
      if (tokens[i] === "and") i++;
    }
    if (total !== null) totals.push(Math.round(total * 1000) / 1000);
    else i++;
  }
  return totals;
}

/** The utterance's durations in every unit the model might write them
 * in: "an hour and a half" is also "90 minutes" and "1.5 hours", "half
 * an hour" also "30 minutes", "ninety seconds" also "1.5 minutes". */
function expandDurations(tokens: readonly string[]): string[] {
  const extra: string[] = [];
  for (const minutes of durationsInMinutes(tokens)) {
    for (const [other, per] of Object.entries(IN_MINUTES)) {
      const converted = minutes / per;
      if (converted > 0 && converted < 100000 && Math.abs(converted * 100 - Math.round(converted * 100)) < 1e-9) extra.push(formatNumber(converted), other);
    }
  }
  return extra;
}

/** Lowercases, splits digits from letters ("10min", "6pm"), folds number
 * words to digits (compound ones too), "a"/"an" before a unit to 1, and
 * unit synonyms to one word: the shape both the value and the utterance
 * are compared in. */
export function normalizeQuantities(text: string, opts: { articleAsOne?: boolean } = {}): string[] {
  const articleAsOne = opts.articleAsOne ?? true;
  const words = text
    .toLowerCase()
    .replace(/(\d)([a-z])/g, "$1 $2")
    .replace(/([a-z])(\d)/g, "$1 $2")
    .split(/[^a-z0-9.]+/)
    .map((w) => w.replace(/^\.+|\.+$/g, "")) // "minutes." at a sentence's end is the unit (a review)
    .filter((w) => w.length > 0);
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    const next = words[i + 1];
    if ((w === "a" || w === "an" || w === "next" || w === "per" || w === "every") && next && UNIT_SYNONYMS[next]) {
      // The person's "an hour" or "next week" is the model's "1 hour" or
      // "1 week"; the model's own "half an hour" carries no number the
      // person had to say (a review), so the article counts as one on
      // the utterance side only.
      if (articleAsOne) out.push("1");
      continue;
    }
    const run = foldNumberRun(words, i);
    if (run && run.consumed > 0) {
      out.push(formatNumber(run.value));
      i += run.consumed - 1;
      continue;
    }
    if (UNIT_SYNONYMS[w]) {
      out.push(UNIT_SYNONYMS[w]!);
      continue;
    }
    out.push(w);
  }
  return out;
}

const isNumber = (w: string) => /^\d+(?:\.\d+)?$/.test(w);

export interface UnspokenArgument {
  name: string;
  value: string;
  reason: "pronoun" | "number" | "unit";
}

/** The first argument whose value the person did not say, or null when
 * every argument is grounded in the utterance by this rule. A number is
 * read only in a value that also carries a duration unit ("ten
 * minutes", "2 hours"): a clock time or a date the model normalized
 * ("6:30" for "half past six", "18:00" for "6pm", "1 week" for "next
 * week") is not an invented quantity, and a duration is where the
 * invention was seen (a review). */
export function unspokenArgument(args: Record<string, unknown>, utterance: string): UnspokenArgument | null {
  const spoken = normalizeQuantities(utterance);
  const said = new Set([...spoken, ...expandDurations(spoken)]);
  for (const [name, raw] of Object.entries(args)) {
    if (typeof raw !== "string" && typeof raw !== "number") continue;
    const value = String(raw).trim();
    if (PRONOUNS.has(value.toLowerCase())) return { name, value, reason: "pronoun" };
    const tokens = normalizeQuantities(value, { articleAsOne: false });
    const hasUnit = tokens.some((t) => UNITS.has(t));
    // A duration the value writes in two units ("1 hour 30 minutes") is
    // what was said when its total is one of the utterance's.
    const spokenTotals = durationsInMinutes(spoken);
    const valueTotals = durationsInMinutes(tokens);
    if (hasUnit && valueTotals.length > 0 && valueTotals.every((v) => spokenTotals.some((u) => Math.abs(u - v) < 1e-6))) continue;
    for (const token of tokens) {
      if (hasUnit && isNumber(token) && !said.has(token)) return { name, value, reason: "number" };
      if (UNITS.has(token) && !said.has(token)) return { name, value, reason: "unit" };
    }
  }
  return null;
}

// The question the turn asks in place of the run: by package and
// argument where the wording matters, and by the reason otherwise,
// never the argument's internal name (a review: "What should the topic
// be?" fails the dad test). A package that wants its own wording
// declares an `ask` on its result (the recipe shape); this is the
// engine's own question for a call it refused to make.
const ASK_PROMPTS: Record<string, string> = {
  "timer:expression": "For how long?",
  "list-add:item": "Add what to the list?",
  "remind:expression": "Remind you about what, and when?",
};

export function askPromptFor(packageId: string, argName: string, reason: UnspokenArgument["reason"] = "pronoun"): string {
  return ASK_PROMPTS[`${packageId}:${argName}`] ?? (reason === "pronoun" ? "Which one do you mean?" : "How much, or for how long?");
}

/** The rule reads action packages only: a lookup's argument is the
 * model's own rephrasing of the question ("World War 2" for "the
 * second world war"), and a memory's is the person's words as a
 * sentence, neither a quantity the person had to say (a review). An
 * action is a consequential package or one with a write permission
 * other than memory's, or a home device permission. */
export function isActionPackage(manifest: { consequential?: boolean; permissions?: readonly string[] }): boolean {
  if (manifest.consequential) return true;
  return (manifest.permissions ?? []).some((p) => /^home:/.test(p) || (/:write$/.test(p) && !p.startsWith("memory:")));
}
