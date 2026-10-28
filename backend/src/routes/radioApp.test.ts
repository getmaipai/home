import { describe, expect, test } from "bun:test";
import { radioCountryRows, radioGenreRows } from "./radioApp";

describe("radio filter rows", () => {
  test("countries are two-letter codes with names the radio directory accepts", () => {
    for (const row of radioCountryRows()) { expect(row.id).toMatch(/^[A-Z]{2}$/); expect(row.label).not.toBe(row.id); }
  });
  test("genres are lowercase keys with capitalised labels", () => {
    for (const row of radioGenreRows()) { expect(row.id).toBe(row.id.toLowerCase()); expect(row.label[0]).toBe(row.label[0]!.toUpperCase()); }
  });
});
