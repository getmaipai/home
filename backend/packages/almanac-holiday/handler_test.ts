import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { nextHolidayData, summarizeNextHoliday } from "./handler.ts";

const holidays = JSON.parse(await Deno.readTextFile(new URL("./holidays.json", import.meta.url)));
const now = "2026-07-02T12:30:00.000";

Deno.test("an American home place gets the next US holiday with no network", () => {
  const result = summarizeNextHoliday(holidays, "United States", now);
  assertStringIncludes(result.text, "Independence Day");
  assertEquals(nextHolidayData(holidays, "United States", now), { date: "2026-07-04", name: "Independence Day" });
  const source = Deno.readTextFileSync(new URL("./handler.ts", import.meta.url));
  assert(!source.includes("fetch("));
  assert(!source.includes("https://"));
});

Deno.test("a Canadian home place gets the Canadian list, not the American one", () => {
  assertStringIncludes(summarizeNextHoliday(holidays, "Canada", now).text, "Labour Day");
  assertEquals(summarizeNextHoliday(holidays, "United States", now).text.includes("Labour Day"), false);
});

Deno.test("the next holiday after the last one of the year is the first of next year", () => {
  const result = summarizeNextHoliday(holidays, "United States", "2026-12-26T12:00:00.000");
  assertStringIncludes(result.text, "New Year's Day");
  assertStringIncludes(result.text, "January 1");
});

Deno.test("a fixed-date holiday on a weekend names the observed day off", () => {
  assertStringIncludes(summarizeNextHoliday(holidays, "United States", "2026-07-04T12:00:00.000").text, "observed on Friday, July 3");
});

Deno.test("no home place gives the set-the-home-place answer, not an error", () => {
  assertEquals(summarizeNextHoliday(holidays, null, now).text, "I don't know which country's holidays to use. An owner or admin can set the home place in Settings.");
});

Deno.test("a country the file does not cover is named in a plain two-sentence answer", () => {
  const result = summarizeNextHoliday(holidays, "United Kingdom", now);
  assertEquals(result.text, "I don't have holiday dates for United Kingdom yet. Ask an owner or admin to check for a Home update.");
  assertEquals(result.text.split(".").length - 1, 2);
});

Deno.test("a year outside the file gives the update-Home answer, not an error or a stale date", () => {
  assertEquals(summarizeNextHoliday(holidays, "Canada", "2046-01-01T12:00:00.000").text, "I don't have holiday dates for 2046 yet. Update Home to get newer dates.");
});

Deno.test("the country name is matched exactly and null is unknown", () => {
  assertStringIncludes(summarizeNextHoliday(holidays, "Canada", now).text, "Labour Day");
  assertStringIncludes(summarizeNextHoliday(holidays, "United Kingdom", now).text, "United Kingdom");
  assertEquals(summarizeNextHoliday(holidays, "Canada Street", now).text, "I don't know which country's holidays to use. An owner or admin can set the home place in Settings.");
  assertEquals(summarizeNextHoliday(holidays, null, now).text.startsWith("I don't know"), true);
});

Deno.test("malformed holidays data gives the not-found answer, not a throw", () => {
  assertEquals(summarizeNextHoliday({ bad: true }, "United States", now).text, "I couldn't find an upcoming holiday.");
  assertEquals(summarizeNextHoliday({ ...holidays, years: { "2026": { US: [{ date: "bad", name: "bad" }] } } }, "United States", now).text, "I couldn't find an upcoming holiday.");
});

Deno.test("the result data stays date and name only", () => {
  assertEquals(Object.keys(nextHolidayData(holidays, "United States", now)!).sort(), ["date", "name"]);
});
