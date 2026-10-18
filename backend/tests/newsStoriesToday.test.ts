// Verification pass: the Following rows said "1 stories today". The label now agrees in number.
import { expect, test } from "bun:test";
import { storiesTodayLabel } from "@/lib/news/data";

test("the Following count label is singular for one story and plural otherwise", () => {
  expect(storiesTodayLabel(0)).toBe("0 stories today");
  expect(storiesTodayLabel(1)).toBe("1 story today");
  expect(storiesTodayLabel(2)).toBe("2 stories today");
});
