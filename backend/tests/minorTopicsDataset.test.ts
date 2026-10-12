// MINOR-TOPICS-01f: the minor-topics bench dataset keeps the shape the design (section 6.1) promises.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildAll, toJsonl } from "../scripts/bench/minor-topics-01/build";
import type { Band, Row } from "../scripts/bench/minor-topics-01/schema";

const DIR = join(import.meta.dir, "../scripts/bench/minor-topics-01");
const all = buildAll();
const rowsOf = (band: Band) => all[band];
const SUBTOPICS = 33;

describe("minor-topics dataset", () => {
  test("the committed JSONL files are exactly what the builder makes from the seeds", () => {
    expect(readFileSync(join(DIR, "child.jsonl"), "utf-8")).toBe(toJsonl(all.child));
    expect(readFileSync(join(DIR, "teen.jsonl"), "utf-8")).toBe(toJsonl(all.teen));
  });

  for (const band of ["child", "teen"] as const) {
    describe(band, () => {
      const rows = rowsOf(band);
      const bySubtopic = (name: string, kind: Row["kind"]) => rows.filter((row) => row.subtopic === name && row.kind === kind);

      test("33 subtopics have 12 topic rows each, and self-harm has 30", () => {
        const topicRows = rows.filter((row) => row.kind === "topic");
        const names = new Set(topicRows.map((row) => row.subtopic));
        expect(names.size).toBe(SUBTOPICS);
        for (const name of names) {
          expect(bySubtopic(name, "topic").length, name).toBe(name === "self_harm_suicide" ? 30 : 12);
        }
        expect(bySubtopic("self_harm_suicide", "topic").filter((row) => row.implicit).length).toBeGreaterThanOrEqual(15);
      });

      test("200 benign near-miss rows, at least 5 per subtopic", () => {
        const near = rows.filter((row) => row.kind === "near_miss");
        expect(near.length).toBe(200);
        const perSubtopic = new Map<string, number>();
        for (const row of near) perSubtopic.set(row.subtopic, (perSubtopic.get(row.subtopic) ?? 0) + 1);
        for (const [name, count] of perSubtopic) if (name !== "general") expect(count, name).toBeGreaterThanOrEqual(5);
        expect([...perSubtopic.keys()].filter((name) => name !== "general").length).toBe(SUBTOPICS);
      });

      test("every hard line has at least 15 rows", () => {
        const lines = ["sexual_content", "weapon_steps", "drug_acquire_or_dose", "crime_howto", "dangerous_challenge", "extremist_praise", "betting_tips"];
        for (const line of lines) expect(rows.filter((row) => row.hard_line === line).length, line).toBeGreaterThanOrEqual(15);
      });

      test("safety-emergency rows exist for check 9", () => {
        expect(rows.filter((row) => row.kind === "safety_emergency").length).toBeGreaterThanOrEqual(16);
      });

      test("ids and texts are unique, plain and free of em dashes", () => {
        expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
        expect(new Set(rows.map((row) => row.text)).size).toBe(rows.length);
        for (const row of rows) {
          expect(row.text.includes("—"), row.id).toBe(false);
          expect(row.text.trim().length, row.id).toBeGreaterThan(8);
        }
      });

      test("the split is 50/50 within a point and a seed's variants never cross it", () => {
        const dev = rows.filter((row) => row.split === "dev").length;
        expect(Math.abs(dev / rows.length - 0.5)).toBeLessThan(0.02);
        const splitOf = new Map<string, string>();
        for (const row of rows) {
          const seen = splitOf.get(row.group);
          if (seen) expect(seen, row.group).toBe(row.split);
          splitOf.set(row.group, row.split);
        }
      });

      test("about a fifth of the seeds are marked for human review", () => {
        const share = rows.filter((row) => row.human_review).length / rows.length;
        expect(share).toBeGreaterThan(0.15);
        expect(share).toBeLessThan(0.25);
      });
    });
  }

  test("the child set has 40 family-story rows and the teen set has none", () => {
    expect(all.child.filter((row) => row.kind === "family_story").length).toBe(40);
    expect(all.teen.filter((row) => row.kind === "family_story").length).toBe(0);
  });

  test("every capitalised word inside a row is a roster persona name or on the reviewed list of public terms", () => {
    const roster = new Set(["alfred", "astro", "atlas", "bramble", "bruno", "clover", "cosmo", "daisy", "ember", "indigo", "iris", "juniper", "lucia", "marlow", "marsh", "mopey", "nadia", "nova", "oliver", "pippa", "quill", "raven", "riff", "rivet", "rover", "sage", "serena", "sprout", "tempo", "velvet", "vincent", "willow"]);
    // Public figures, places, brands and acronyms a reviewer has read. A new capitalised word fails until a person adds it here.
    const publicTerms = new Set("AR Abraham Adderall Amendment Battle Benadryl Boston Buddhism Bunny Christmas Claus Cold Convention DEA Day Diwali East Easter Elf FBI FDA Fairy Geneva Gettysburg God Grandpa HPV Harvey Holocaust ID ISIS Instagram Irish Islam Jr Juliet King LGBTQ Lincoln Luther MDMA Marshall Martin Mary Memorial Middle Milk NyQuil Parks Party Plan Poppins Pride Prohibition Renaissance Romans Rome Romeo Rosa Russia SAT STI Santa Second Shelf Smithsonian Tea TikTok Tooth Troubles Tylenol US Ukraine Vikings War World Xanax".split(" "));
    const unknown = new Set<string>();
    for (const row of [...all.child, ...all.teen]) {
      if (row.framing !== "plain") continue;
      for (const match of row.text.matchAll(/(?<![.!?]\s)(?<!^)\b([A-Z][a-zA-Z0-9]+)\b/g)) {
        const word = match[1]!;
        if (!roster.has(word.toLowerCase()) && !publicTerms.has(word)) unknown.add(word);
      }
    }
    expect([...unknown]).toEqual([]);
  });

  test("each kind splits 50/50 within ten points in each band", () => {
    for (const rows of [all.child, all.teen]) {
      for (const kind of ["topic", "near_miss", "hard_line", "safety_emergency"] as const) {
        const of = rows.filter((row) => row.kind === kind);
        expect(Math.abs(of.filter((row) => row.split === "dev").length / of.length - 0.5), kind).toBeLessThan(0.1);
      }
    }
  });
});
