// RECENCY-01: the recency bench's dataset is well formed and keeps its two halves apart.
import { expect, test } from "bun:test";
import dataset from "../scripts/bench/datasets/recency-01.json";

type Item = { id: string; prompt: string; kind: string; gold: string; acceptable_tools: string[] };
const items = dataset.fresh.items as Item[];

test("20 prompts that need a lookup or a picture and 10 that must not search, with unique ids", () => {
  expect(items.filter((item) => item.gold === "must")).toHaveLength(20);
  expect(items.filter((item) => item.gold === "must_not")).toHaveLength(10);
  expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
});

test("show-me prompts accept only show_images, and a must-not prompt is timeless", () => {
  for (const item of items.filter((row) => /^show me\b/.test(row.prompt))) expect(item.acceptable_tools).toEqual(["show_images"]);
  for (const item of items.filter((row) => row.gold === "must_not")) expect(item.kind).toBe("timeless");
});
