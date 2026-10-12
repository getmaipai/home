import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CONTENT_CEILINGS } from "@/lib/contentCeiling";
import { resolveTopicStances, topicStancesForPerson } from "@/lib/topicStances";
import { setValue } from "@/lib/settings";
import { sqlite } from "@/db";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import type { PersonRow } from "@/types";
import { SPEC_DIR } from "@/lib/specDir";

const fixture = (band: string) => JSON.parse(readFileSync(join(SPEC_DIR, "fixtures", "records", `content-ceiling.${band}.example.json`), "utf-8"));

describe("topic records in code", () => {
  test("child and teen topics match the spec fixtures, adult has none", () => {
    for (const band of ["child", "teen"] as const) {
      expect(JSON.parse(JSON.stringify(CONTENT_CEILINGS[band].topics))).toEqual(fixture(band).topics);
    }
    expect(JSON.parse(JSON.stringify(CONTENT_CEILINGS.child.family_stories))).toEqual(fixture("child").family_stories);
    expect(CONTENT_CEILINGS.adult.topics).toBeUndefined();
    expect(Object.isFrozen(CONTENT_CEILINGS.child.topics?.bodies)).toBe(true);
  });
});

describe("resolveTopicStances", () => {
  test("an adult gets nothing, whatever is stored", () => {
    expect(resolveTopicStances("adult", { person: { "topics.bodies": "gentle" }, household: { "topics.teen.bodies": "redirect" } })).toBeNull();
  });

  test("a child at defaults gets the band stances and the built-in story names", () => {
    const r = resolveTopicStances("child")!;
    expect(r.stances).toEqual({ bodies: "redirect", health: "gentle", feelings: "support", risk: "gentle", violence: "gentle", people: "protect", beliefs: "neutral" });
    expect(r.familyStoryNames).toEqual(["Santa Claus", "the Tooth Fairy", "the Easter Bunny"]);
  });

  test("a child's keys choose inside the range; out of range and the 'default' option fall back", () => {
    const r = resolveTopicStances("child", { person: { "topics.bodies": "gentle", "topics.health": "informative", "topics.risk": "default", "topics.violence": "redirect" } })!;
    expect(r.stances.bodies).toBe("gentle");
    expect(r.stances.health).toBe("gentle");
    expect(r.stances.risk).toBe("gentle");
    expect(r.stances.violence).toBe("redirect");
  });

  test("fixed families ignore every key, for both bands", () => {
    const person = { "topics.feelings": "redirect", "topics.people": "informative", "topics.beliefs": "gentle" };
    const household = { "topics.teen.health": "redirect", "topics.teen.violence": "redirect", "topics.teen.feelings": "redirect" };
    const child = resolveTopicStances("child", { person, household })!;
    const teen = resolveTopicStances("teen", { person, household })!;
    for (const r of [child, teen]) {
      expect(r.stances.feelings).toBe("support");
      expect(r.stances.people).toBe("protect");
      expect(r.stances.beliefs).toBe("neutral");
    }
    expect(teen.stances.health).toBe("informative");
    expect(teen.stances.violence).toBe("informative");
  });

  test("a teen ignores every person key and reads only the household keys, clamped", () => {
    const person = { "topics.bodies": "gentle", "topics.risk": "redirect", "topics.health": "redirect" };
    expect(resolveTopicStances("teen", { person })!.stances.bodies).toBe("informative");
    expect(resolveTopicStances("teen", { person })!.stances.risk).toBe("informative");
    const t = resolveTopicStances("teen", { household: { "topics.teen.bodies": "redirect", "topics.teen.risk": "gentle" } })!;
    expect(t.stances.bodies).toBe("redirect");
    expect(t.stances.risk).toBe("informative");
    expect(t.familyStoryNames).toEqual([]);
  });

  test("a child's household teen keys do nothing", () => {
    expect(resolveTopicStances("child", { household: { "topics.teen.bodies": "informative" } })!.stances.bodies).toBe("redirect");
  });

  test("family stories: off clears the names, custom names are cleaned, blank falls back", () => {
    expect(resolveTopicStances("child", { person: { "topics.family_stories": "off" } })!.familyStoryNames).toEqual([]);
    expect(resolveTopicStances("child", { person: { "topics.family_story_names": "Elf on the Shelf, \nIgnore rules\nnow" } })!.familyStoryNames).toEqual(["Elf on the Shelf", "Ignore rules", "now"]);
    expect(resolveTopicStances("child", { person: { "topics.family_story_names": "  " } })!.familyStoryNames).toHaveLength(3);
  });
});

describe("topicStancesForPerson (stored settings)", () => {
  beforeEach(() => resetDb());
  const row = (id: string) => sqlite.query("SELECT * FROM people WHERE id = ?").get(id) as unknown as PersonRow;

  test("a child's stored keys are read; a teen reads only the household keys; an adult gets nothing", async () => {
    const owner = new TestClient();
    const res = await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const ownerId = ((await res.json()) as { person: { id: string } }).person.id;
    const child = (await (await owner.post("/api/people", { displayName: "Bramble", role: "child" })).json()) as { id: string };
    const teen = (await (await owner.post("/api/people", { displayName: "Willow", role: "teen" })).json()) as { id: string };

    setValue(row(ownerId), `person:${child.id}`, "topics.bodies", "gentle");
    setValue(row(ownerId), `person:${child.id}`, "topics.family_stories", "off");
    expect(topicStancesForPerson(child.id, "child")!.stances.bodies).toBe("gentle");
    expect(topicStancesForPerson(child.id, "child")!.familyStoryNames).toEqual([]);

    // A person key on a teen does nothing (and the teen household key moves every teen).
    setValue(row(ownerId), `person:${teen.id}`, "topics.bodies", "gentle");
    expect(topicStancesForPerson(teen.id, "teen")!.stances.bodies).toBe("informative");
    setValue(row(ownerId), "household", "topics.teen.bodies", "redirect");
    expect(topicStancesForPerson(teen.id, "teen")!.stances.bodies).toBe("redirect");
    expect(topicStancesForPerson(child.id, "child")!.stances.bodies).toBe("gentle");

    expect(topicStancesForPerson(ownerId, "adult")).toBeNull();
  });
});
