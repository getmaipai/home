import { assertEquals } from "jsr:@std/assert@1";
import { currentTime } from "./handler.ts";

Deno.test("formats a real time as h:mm AM/PM", () => {
  const result = currentTime(new Date(2026, 0, 1, 14, 5));
  assertEquals(result.text, "It's 2:05 PM.");
});

Deno.test("formats midnight correctly, not as 0:00", () => {
  const result = currentTime(new Date(2026, 0, 1, 0, 0));
  assertEquals(result.text, "It's 12:00 AM.");
});
