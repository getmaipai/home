import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { toSpokenText } from "@/lib/spokenText";
import { synthesizeSpeech } from "@/lib/tts";
import { __setStackClientForTests, __resetStackEngineForTests } from "@/lib/stackEngine";
import { __setOfferedVoicesForTests } from "@/lib/voiceResolve";
import { __setTtsTagsForTests } from "@/lib/ttsCapabilities";
import { resetDb } from "./reset-db";
import { setHouseholdSettingValue } from "@/lib/settings";
import type { StackClient } from "@/lib/stack/client";

describe("toSpokenText", () => {
  const cases: [string, string][] = [
    ["It's 3:27 PM.", "It's three twenty-seven P M."], ["3:05 pm", "three oh five P M"], ["12:00 PM", "noon"], ["12:00 AM", "midnight"], ["9:00 AM", "nine A M"], ["15:30", "three thirty in the afternoon"], ["19:05", "seven oh five in the evening"], ["23:10", "eleven ten at night"], ["00:00", "midnight"], ["3 PM", "three P M"], ["10:15", "ten fifteen"],
    ["Oct 21, 2026", "October twenty-first, twenty twenty-six"], ["October 21, 2026", "October twenty-first, twenty twenty-six"], ["10/21/2026", "October twenty-first, twenty twenty-six"], ["2026-10-21", "October twenty-first, twenty twenty-six"], ["Oct 21", "October twenty-first"], ["Monday", "Monday"],
    ["2026", "twenty twenty-six"], ["2005", "two thousand five"], ["1999", "nineteen ninety-nine"], ["2000", "two thousand"], ["2010", "twenty ten"],
    ["1st", "first"], ["2nd", "second"], ["3rd", "third"], ["4th", "fourth"], ["11th", "eleventh"], ["22nd", "twenty-second"], ["23rd", "twenty-third"], ["31st", "thirty-first"],
    ["0", "zero"], ["1", "one"], ["9", "nine"], ["10", "ten"], ["19", "nineteen"], ["20", "twenty"], ["42", "forty-two"], ["99", "ninety-nine"], ["100", "one hundred"], ["101", "one hundred one"], ["999", "nine hundred ninety-nine"], ["1,000", "one thousand"], ["1,234", "one thousand two hundred thirty-four"], ["12,345", "twelve thousand three hundred forty-five"], ["1,000,000", "one million"], ["1,234,567,890", "one billion two hundred thirty-four million five hundred sixty-seven thousand eight hundred ninety"],
    ["3.5", "three point five"], ["0.25", "zero point two five"], ["-7", "minus seven"], ["-3.5", "minus three point five"], ["70%", "seventy percent"], ["$4.50", "four dollars and fifty cents"], ["$4.05", "four dollars and five cents"], ["$0.99", "ninety-nine cents"], ["$1", "one dollar"], ["$5", "five dollars"], ["€3", "three euros"], ["£2", "two pounds"],
    ["72°F", "seventy-two degrees Fahrenheit"], ["5°C", "five degrees Celsius"], ["5 km", "five kilometers"], ["3 mi", "three miles"], ["10 lb", "ten pounds"], ["2 GB", "two gigabytes"],
    ["Call 555-123-4567", "Call five five five one two three four five six seven"], ["Call 2026-555-0100", "Call two zero two six five five five zero one zero zero"], ["3-5", "three to five"], ["9-5", "nine to five"], ["COVID-19", "COVID-19"], ["B2B", "B2B"], ["#2026", "#2026"], ["Version 0.2.25", "Version 0.2.25"],
    ["It's 3:02 PM.", "It's three oh two P M."], ["It's 3:27 PM on Friday, October 23, 2026.", "It's three twenty-seven P M on Friday, October twenty-third, twenty twenty-six."], ["Today is Friday, Oct 23.", "Today is Friday, October twenty-third."], ["It will be 64°F and 20% rain by 5 PM.", "It will be sixty-four degrees Fahrenheit and twenty percent rain by five P M."], ["The game starts at 7:30 PM, 12-14 points.", "The game starts at seven thirty P M, twelve to fourteen points."],
    ["Visit https://example.com/2026 and email me@home.net", "Visit https://example.com/2026 and email me@home.net"], ["Use `3:27 PM` in code", "Use `3:27 PM` in code"], ["[chuckle] At 3 PM", "[chuckle] At three P M"], ["The day is 21st.", "The day is twenty-first."],
  ];
  test.each(cases)("%s becomes %s", (input, expected) => expect(toSpokenText(input)).toBe(expected));
  test("is idempotent", () => {
    for (const [input] of cases) {
      const once = toSpokenText(input);
      expect(toSpokenText(once)).toBe(once);
    }
  });
  test("leaves non-English locales unchanged", () => expect(toSpokenText("3 PM", { locale: "fr" })).toBe("3 PM"));
});

describe("synthesizeSpeech spoken wording", () => {
  beforeEach(() => {
    resetDb();
    setHouseholdSettingValue("engines.stack.url", "http://127.0.0.1:8771");
    __setTtsTagsForTests(["chuckle"]);
    __setOfferedVoicesForTests(null);
    __resetStackEngineForTests();
  });
  afterEach(() => { __resetStackEngineForTests(); __setOfferedVoicesForTests(undefined); __setTtsTagsForTests(null); });
  test("sends normalized text to Stack while the source text remains unchanged", async () => {
    const source = "It's 3:27 PM. [chuckle]";
    let received = "";
    const client = { speak: async (form: FormData) => { received = String(form.get("text")); return new Response(new Uint8Array([1]), { headers: { "content-type": "audio/wav" } }); } } as unknown as StackClient;
    __setStackClientForTests(client);
    const result = await synthesizeSpeech(source);
    expect(result.ok).toBe(true);
    expect(received).toBe("It's three twenty-seven P M. [chuckle]");
    expect(source).toBe("It's 3:27 PM. [chuckle]");
    const optedOut = await synthesizeSpeech("3 PM", undefined, { normalize: false });
    expect(optedOut.ok).toBe(true);
    expect(received).toBe("3 PM");
  });
});
