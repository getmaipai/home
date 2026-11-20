import { beforeEach, expect, test } from "bun:test";
import { elementPrompt, makeElementFromWords } from "@/lib/elementsMake";
import { owner } from "./support/testAuth";
import { resetDb } from "./reset-db";

beforeEach(() => resetDb());

test("the prompt follows the kind: a face for a character, a view for a place, the object alone for a prop", () => {
  expect(elementPrompt("character", "a blue fox", "adult")).toContain("head-and-shoulders portrait of a blue fox");
  expect(elementPrompt("place", "a sunny kitchen", "adult")).toContain("establishing view of a sunny kitchen");
  expect(elementPrompt("prop", "a red kite", "adult")).toContain("a red kite, shown alone");
});

test("a minor's character stays a cartoon of their own character, an adult's does not", () => {
  expect(elementPrompt("character", "my dragon", "child")).toContain("cartoon of your own character");
  expect(elementPrompt("character", "my dragon", "teen")).toContain("cartoon of your own character");
  expect(elementPrompt("character", "my dragon", "adult")).not.toContain("cartoon of your own character");
});

test("words that are too short or too long are refused in plain words before any picture job starts", async () => {
  const { row } = await owner();
  for (const prompt of ["", "ab", "x".repeat(601), 7]) {
    const made = await makeElementFromWords(row, { kind: "place", prompt });
    expect(made).toMatchObject({ ok: false, status: 422, code: "bad_arguments" });
    if (!made.ok) expect(made.error).toBe("Describe it in 3 to 600 characters, then try again.");
  }
});
