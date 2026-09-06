import { assertEquals } from "jsr:@std/assert@1";
import { summarizeOnThisDay } from "./handler.ts";

Deno.test("picks the first real event and names its year", () => {
  const result = summarizeOnThisDay({
    events: [
      { text: "The first television broadcast took place.", year: 1926 },
      { text: "A second, less notable event.", year: 1950 },
    ],
  });
  assertEquals(result.text, "In 1926, The first television broadcast took place.");
});

Deno.test("reads no events at all as not found, not a wrong answer", () => {
  const result = summarizeOnThisDay({ events: [] });
  assertEquals(result.text, "I couldn't find anything for this day in history.");
});

Deno.test("reads a malformed response as not found, not a throw", () => {
  const result = summarizeOnThisDay(null);
  assertEquals(result.text, "I couldn't find anything for this day in history.");
});

// A real gap found by code review: a NON-EMPTY events array whose first
// element is itself malformed used to slip past the old "does an
// element exist" check and interpolate "In undefined, undefined."
Deno.test("reads a first event with a missing year as not found, not 'In undefined'", () => {
  const result = summarizeOnThisDay({ events: [{ text: "Something happened." }] });
  assertEquals(result.text, "I couldn't find anything for this day in history.");
});

Deno.test("reads a first event with a missing text as not found, not a wrong answer", () => {
  const result = summarizeOnThisDay({ events: [{ year: 1999 }] });
  assertEquals(result.text, "I couldn't find anything for this day in history.");
});
