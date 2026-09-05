import { describe, expect, test } from "bun:test";
import { listSkillIds, loadSkill, loadAllSkills } from "@/lib/skills";

describe("the bundled storytime-style skill", () => {
  test("is discoverable and its manifest validates against spec's schema", () => {
    expect(listSkillIds()).toContain("storytime-style");
    const loaded = loadSkill("storytime-style");
    expect(loaded).not.toBeNull();
    if (!loaded) return;
    expect(loaded.manifest.id).toBe("storytime-style");
    expect(loaded.manifest.kind).toBe("skill");
    expect(loaded.manifest.routing?.examples?.length).toBeGreaterThanOrEqual(5);
  });

  // The whole point of Claude-SKILL.md-compatibility: the bundled file has
  // real YAML frontmatter (name/description), and it must not leak into
  // the composed instruction text - a model seeing literal "---\nname:
  // storytime-style..." in its system prompt would be a real regression,
  // not a cosmetic one.
  test("strips the real Claude-format frontmatter from the composed body", () => {
    const loaded = loadSkill("storytime-style");
    expect(loaded).not.toBeNull();
    if (!loaded) return;
    expect(loaded.body).not.toContain("---");
    expect(loaded.body).not.toContain("name: storytime-style");
    expect(loaded.body).toContain("bedtime story");
  });
});

describe("loadSkill", () => {
  test("null for an unknown id, not a throw", () => {
    expect(loadSkill("does-not-exist")).toBeNull();
  });

  // A plugin package (recipe.json, kind: "plugin") has no SKILL.md at all,
  // so it's invisible to this loader by construction - listSkillIds()
  // only ever sees directories with a SKILL.md file.
  test("a plugin package's directory doesn't appear in listSkillIds()", () => {
    expect(listSkillIds()).not.toContain("weather");
    expect(listSkillIds()).not.toContain("joke");
  });
});

describe("loadAllSkills", () => {
  test("sorted by id, every entry actually kind: skill", () => {
    const all = loadAllSkills();
    expect(all.length).toBeGreaterThan(0);
    for (const s of all) expect(s.manifest.kind).toBe("skill");
    const ids = all.map((s) => s.manifest.id);
    expect(ids).toEqual([...ids].sort());
  });
});
