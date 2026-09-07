import { assertEquals } from "jsr:@std/assert@1";
import { currentDate } from "./handler.ts";

Deno.test("formats a real date with weekday, month, and day", () => {
  const result = currentDate(new Date(2026, 0, 1)); // a real Thursday
  assertEquals(result.text, "Today is Thursday, January 1, 2026.");
});

Deno.test("speech and text are identical - nothing here needs a spoken-vs-shown distinction", () => {
  const result = currentDate(new Date(2026, 5, 15));
  assertEquals(result.speech, result.text);
});
