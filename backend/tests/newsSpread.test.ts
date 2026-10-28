import { expect, test } from "bun:test";
import { spreadPublishers } from "../src/lib/news/spread";

const row = (publisher: string, group: string, n: number) => ({ publisher, group, n });

test("spreadPublishers keeps the first few rows of each publisher per day group and the order", () => {
  const rows = [
    ...Array.from({ length: 6 }, (_, i) => row("Nature", "This afternoon", i)),
    row("BBC", "This afternoon", 10),
    row("Nature", "Yesterday", 20),
  ];
  const out = spreadPublishers(rows, (r) => r.group, 4);
  expect(out.filter((r) => r.publisher === "Nature" && r.group === "This afternoon")).toHaveLength(4);
  expect(out.map((r) => r.n)).toEqual([0, 1, 2, 3, 10, 20]);
});
