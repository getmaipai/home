import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import ds from "./datasets/search-recency-07-minor-ext.json";
import six from "./datasets/search-recency-06-heldout.json";

const count = <T>(items: T[], pick: (item: T) => string): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const item of items) out[pick(item)] = (out[pick(item)] ?? 0) + 1;
  return out;
};
const rows = ds.rows as Array<{ id: string; band: string; category: string; followUp: boolean; prompt: string; split: string; channel?: string; hit?: string }>;
const persona = new Set("alfred astro atlas bramble bruno clover cosmo daisy ember indigo iris juniper lucia marlow marsh mopey nadia nova oliver pippa quill raven riff rivet rover sage serena sprout tempo velvet vincent willow".split(" "));

describe("MINOR-SEARCH-01j dataset", () => {
  test("uses the same row schema as the adult held-out set, plus channel and hit", () => {
    const base = Object.keys(six.rows[0]!).sort();
    for (const r of rows) {
      expect(Object.keys(r).filter((k) => k !== "channel" && k !== "hit").sort()).toEqual(base);
      expect(["child", "teen"]).toContain(r.band);
      expect(["tune", "heldout"]).toContain(r.split);
    }
  });
  test("has 24 near-miss (8 per channel), 20 PII and 60 ceiling rows per band", () => {
    for (const band of ["child", "teen"]) {
      const b = rows.filter((r) => r.band === band);
      expect(count(b, (r) => r.category)).toEqual({ unsafe_near_miss: 24, pii_query: 20, ceiling: 60 });
      expect(count(b.filter((r) => r.category === "unsafe_near_miss"), (r) => r.channel ?? "")).toEqual({ library: 8, rss: 8, web: 8 });
      expect(Object.keys(count(b.filter((r) => r.category === "pii_query"), (r) => r.hit ?? "")).sort()).toEqual(["address", "email", "household_name", "id_number", "phone"]);
    }
  });
  test("split was fixed by rule: ceiling all held out, others by sha256(id) mod 100 < 60", () => {
    for (const r of rows) {
      const tune = Number(BigInt("0x" + createHash("sha256").update(r.id).digest("hex")) % 100n) < 60;
      expect(r.split).toBe(r.category === "ceiling" || !tune ? "heldout" : "tune");
    }
  });
  test("ids and prompts are unique, and no prompt repeats the adult held-out set", () => {
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
    expect(new Set(rows.map((r) => r.prompt)).size).toBe(rows.length);
    const adult = new Set(six.rows.map((r) => r.prompt));
    for (const r of rows) expect(adult.has(r.prompt)).toBe(false);
  });
  test("PII rows are synthetic: persona names, example.com, 555-01xx phones, 000 ids", () => {
    for (const r of rows.filter((x) => x.category === "pii_query")) {
      if (r.hit === "email") {
        const m = r.prompt.match(/([a-z]+)@example\.com/);
        expect(m).not.toBeNull();
        expect(persona.has(m![1]!)).toBe(true);
      }
      if (r.hit === "phone") expect(r.prompt).toMatch(/555-01\d\d|\(555\) 010-/);
      if (r.hit === "id_number") expect(r.prompt).toMatch(/000-12-|0000123456/);
      if (r.hit === "address") expect(r.prompt).toContain("Bramble Court, Exampleville");
      if (r.hit === "household_name") expect([...persona].filter((p) => r.prompt.includes(p)).length).toBeGreaterThanOrEqual(2);
    }
  });
});
