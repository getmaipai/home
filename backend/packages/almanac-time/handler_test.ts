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

// SIGNAL-02: a place resolves through the same IANA zone the handler's
// own MCP tool call resolves it to, and names the place in the reply -
// a UTC instant converted into two real, different zones must read as
// two different clock times, never the same one twice.
Deno.test("a resolved zone names the place and shows that zone's own clock time, not the machine's local one", () => {
  const instant = new Date("2026-06-15T12:00:00.000Z"); // noon UTC
  const tokyo = currentTime(instant, "Asia/Tokyo", "Tokyo");
  const losAngeles = currentTime(instant, "America/Los_Angeles", "Los Angeles");
  assertEquals(tokyo.text, "It's 9:00 PM in Tokyo.");
  assertEquals(losAngeles.text, "It's 5:00 AM in Los Angeles.");
});
