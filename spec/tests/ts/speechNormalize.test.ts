// normalizeForSpeech (spec/voice/ts/normalizeForSpeech.ts): the mechanical
// half of the voice sidecar's speech normalization. Every case here checks
// the SPOKEN form only - callers keep the original text for display
// untouched (Jesse, 2026-09-04: "if you have the voice say ten O four, you
// still display 10:04" - this file never asserts anything about display
// text because this module never produces any).
import { describe, expect, test } from "bun:test";
import { normalizeForSpeech, numberToWords } from "../../voice/ts/normalizeForSpeech.js";

describe("numberToWords", () => {
  test("zero and small numbers", () => {
    expect(numberToWords(0)).toBe("zero");
    expect(numberToWords(5)).toBe("five");
    expect(numberToWords(19)).toBe("nineteen");
  });
  test("tens and compound tens", () => {
    expect(numberToWords(20)).toBe("twenty");
    expect(numberToWords(21)).toBe("twenty-one");
    expect(numberToWords(99)).toBe("ninety-nine");
  });
  test("hundreds", () => {
    expect(numberToWords(100)).toBe("one hundred");
    expect(numberToWords(234)).toBe("two hundred thirty-four");
    expect(numberToWords(905)).toBe("nine hundred five");
  });
  test("thousands and millions compose with the smaller scales", () => {
    expect(numberToWords(1000)).toBe("one thousand");
    expect(numberToWords(1234)).toBe("one thousand two hundred thirty-four");
    expect(numberToWords(2_500_000)).toBe("two million five hundred thousand");
  });
  test("negative numbers", () => {
    expect(numberToWords(-42)).toBe("negative forty-two");
  });
});

describe("normalizeForSpeech: times", () => {
  test("a plain digital time reads with 'oh' for a single-digit minute, never a bare digit or 'zero'", () => {
    expect(normalizeForSpeech("It's 10:04.")).toBe("It's ten oh four.");
  });
  test("pm reads as 'in the evening', am as 'in the morning'", () => {
    expect(normalizeForSpeech("It's 10:04pm.")).toBe("It's ten oh four in the evening.");
    expect(normalizeForSpeech("It's 7:15 am.")).toBe("It's seven fifteen in the morning.");
  });
  test("the dotted 'a.m.'/'p.m.' forms get their suffix too, even right before a sentence period", () => {
    // A real bug this module's own live verification caught (2026-09-05):
    // a trailing `\b` right after a dotted marker never matched (both the
    // period and whatever follows it are non-word characters), so the
    // whole marker silently got dropped.
    expect(normalizeForSpeech("It's about 4:13 a.m. here.")).toBe("It's about four thirteen in the morning here.");
    // "p.m."'s own trailing period is consumed as part of the abbreviation
    // itself, correctly - there's no separate sentence-terminating period
    // left over to keep.
    expect(normalizeForSpeech("Set an alarm for 9:00 p.m.")).toBe("Set an alarm for nine o'clock in the evening");
  });
  test("on the hour reads as o'clock, not 'oh zero'", () => {
    expect(normalizeForSpeech("The bus leaves at 3:00.")).toBe("The bus leaves at three o'clock.");
  });
  test("12:00 am/pm are midnight and noon, not 'twelve o'clock'", () => {
    expect(normalizeForSpeech("Set it for 12:00 am.")).toBe("Set it for midnight.");
    expect(normalizeForSpeech("Lunch is at 12:00 pm.")).toBe("Lunch is at noon.");
  });
  test("24-hour input past noon converts to a spoken 12-hour hour", () => {
    expect(normalizeForSpeech("It's 21:00.")).toBe("It's nine o'clock.");
  });
});

describe("normalizeForSpeech: dates", () => {
  test("an ISO date reads as month, ordinal day, and spoken year", () => {
    expect(normalizeForSpeech("Due 2026-09-04.")).toBe("Due September fourth, twenty twenty-six.");
  });
  test("a written month/day/year reads the day as an ordinal", () => {
    expect(normalizeForSpeech("It's due September 4, 2026.")).toBe("It's due September fourth, twenty twenty-six.");
  });
  test("a month/day with no year still ordinalizes the day", () => {
    expect(normalizeForSpeech("The party is May 21.")).toBe("The party is May twenty-first.");
  });
});

describe("normalizeForSpeech: currency", () => {
  test("a whole dollar amount", () => {
    expect(normalizeForSpeech("It costs $5.")).toBe("It costs five dollars.");
  });
  test("dollars and cents, both pluralized correctly", () => {
    expect(normalizeForSpeech("It's $1.01.")).toBe("It's one dollar and one cent.");
    expect(normalizeForSpeech("It's $5.50.")).toBe("It's five dollars and fifty cents.");
  });
  test("a thousands-separated amount", () => {
    expect(normalizeForSpeech("It's $1,250.")).toBe("It's one thousand two hundred fifty dollars.");
  });
});

describe("normalizeForSpeech: percentages", () => {
  test("a whole percent", () => {
    expect(normalizeForSpeech("There's a 25% chance of rain.")).toBe("There's a twenty-five percent chance of rain.");
  });
  test("a decimal percent reads digit by digit after 'point'", () => {
    expect(normalizeForSpeech("Inflation is 3.5%.")).toBe("Inflation is three point five percent.");
  });
});

describe("normalizeForSpeech: units and abbreviations", () => {
  test("a speed unit expands before the leading number is spelled out", () => {
    expect(normalizeForSpeech("Winds at 5 mph.")).toBe("Winds at five miles per hour.");
  });
  test("a temperature unit expands to the full word", () => {
    expect(normalizeForSpeech("It's 72°F outside.")).toBe("It's seventy-two degrees Fahrenheit outside.");
  });
  test("a digit-anchored inches abbreviation expands, but a bare sentence-final 'in.' is left alone", () => {
    expect(normalizeForSpeech("It's 5in. long.")).toBe("It's five inches long.");
    expect(normalizeForSpeech("Come in.")).toBe("Come in.");
  });
  test("a title abbreviation expands to the spoken word", () => {
    expect(normalizeForSpeech("Ask Dr. Lee.")).toBe("Ask Doctor Lee.");
  });
});

describe("normalizeForSpeech: generic numbers and ordinals", () => {
  test("a bare cardinal number", () => {
    expect(normalizeForSpeech("There are 42 emails.")).toBe("There are forty-two emails.");
  });
  test("a digit ordinal", () => {
    expect(normalizeForSpeech("It's her 3rd try.")).toBe("It's her third try.");
    expect(normalizeForSpeech("Finished 21st.")).toBe("Finished twenty-first.");
  });
  test("a decimal number reads digit by digit after 'point'", () => {
    expect(normalizeForSpeech("It's 3.5 miles away.")).toBe("It's three point five miles away.");
  });
  test("singularizes a count of one against a naive plural noun", () => {
    expect(normalizeForSpeech("You have 1 items in your cart.")).toBe("You have one item in your cart.");
  });
  test("does not mangle a noun that is already singular but ends in 's'", () => {
    expect(normalizeForSpeech("There's 1 bus outside.")).toBe("There's one bus outside.");
  });
});

describe("normalizeForSpeech: markup and emoji", () => {
  test("strips bold/italic markers but keeps the words", () => {
    expect(normalizeForSpeech("It's **very** cold, *really*.")).toBe("It's very cold, really.");
  });
  test("strips a bullet list into plain lines", () => {
    expect(normalizeForSpeech("- milk\n- eggs")).toBe("milk\neggs");
  });
  test("drops emoji entirely", () => {
    expect(normalizeForSpeech("Sounds good! \u{1F389}")).toBe("Sounds good!");
  });
});

describe("normalizeForSpeech: never touches the caller's own text", () => {
  test("is a pure function - the same input always normalizes the same way", () => {
    const input = "It's 10:04 and 25% chance of rain, $5.50.";
    expect(normalizeForSpeech(input)).toBe(normalizeForSpeech(input));
    // And the input string itself is never mutated - this is the whole
    // point of keeping normalizeForSpeech's output out of reply.text.
    expect(input).toBe("It's 10:04 and 25% chance of rain, $5.50.");
  });
});
