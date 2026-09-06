import { assertEquals, assert } from "jsr:@std/assert@1";
import { summarizeNextHoliday } from "./handler.ts";

Deno.test("names the first (soonest) holiday in the list", () => {
  const result = summarizeNextHoliday([
    { date: "2026-12-25", localName: "Christmas Day", name: "Christmas Day" },
    { date: "2027-01-01", localName: "New Year's Day", name: "New Year's Day" },
  ]);
  assert(result.text.includes("Christmas Day"));
  assert(result.text.includes("December"));
});

Deno.test("reads an empty list as not found, not a wrong answer", () => {
  const result = summarizeNextHoliday([]);
  assertEquals(result.text, "I couldn't find an upcoming holiday.");
});

Deno.test("reads a malformed response as not found, not a throw", () => {
  const result = summarizeNextHoliday(null);
  assertEquals(result.text, "I couldn't find an upcoming holiday.");
});

// A real gap found by code review: a NON-EMPTY array whose first
// element is itself malformed used to slip past the old "does an
// element exist" check and interpolate straight into the reply.
Deno.test("reads a non-empty list with a missing name as not found, not a wrong answer", () => {
  const result = summarizeNextHoliday([{ date: "2026-12-25", localName: "x" }]);
  assertEquals(result.text, "I couldn't find an upcoming holiday.");
});

Deno.test("reads a non-empty list with an unparseable date as not found, not 'Invalid Date'", () => {
  const result = summarizeNextHoliday([{ date: "not-a-date", localName: "x", name: "Mystery Day" }]);
  assertEquals(result.text, "I couldn't find an upcoming holiday.");
});
