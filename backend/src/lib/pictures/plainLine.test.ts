import { expect, test } from "bun:test";
import { plainEngineLine } from "./plainLine";

test("a memory line with figures becomes one plain sentence", () => {
  const raw = "This computer is low on memory (53.6 GB available, 10.2 GB kept in reserve), so picture and video making is paused until it recovers. Close big apps, or try again in a minute.";
  expect(plainEngineLine(raw)).toBe("This computer is busy freeing up memory, so picture and video making is paused for a moment. Try again in a minute.");
  expect(plainEngineLine("It needs about 13.5 GB and 30.0 GB is available, which would leave 16.5 GB; 10.2 GB is kept in reserve.")).not.toMatch(/\d GB/);
});

test("other lines pass through untouched", () => {
  expect(plainEngineLine("The picture could not be made. Try again.")).toBe("The picture could not be made. Try again.");
  expect(plainEngineLine("Pictures are limited to 20 MB each.")).toBe("Pictures are limited to 20 MB each.");
});
