import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { couldNotLine, HUB_MUTATION_VERBS } from "@/lib/hubMutationVerbs";
import { messages as messagesEnUS } from "@/locales/en-US/messages.po";

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

describe("useHubMutation verbs", () => {
  test("every verb a screen passes to useHubMutation has a catalog sentence", () => {
    const used = new Set<string>();
    for (const file of sources(join(import.meta.dir, ".."))) {
      const text = readFileSync(file, "utf8");
      for (const at of text.matchAll(/useHubMutation(?:<[^(]*>)?\(/g)) {
        const verb = text.slice(at.index, at.index + 400).match(/\bverb:\s*"([^"]+)"/)?.[1];
        if (verb) used.add(verb);
      }
    }
    expect(used.size).toBeGreaterThan(10);
    expect([...used].filter((verb) => !HUB_MUTATION_VERBS.includes(verb))).toEqual([]);
    expect(HUB_MUTATION_VERBS.filter((verb) => !used.has(verb))).toEqual([]);
  });

  test("each verb sentence is in the catalog, and an unknown verb falls back to English", () => {
    const catalog = messagesEnUS as Record<string, unknown>;
    for (const verb of HUB_MUTATION_VERBS) expect(`Could not ${verb}.` in catalog).toBe(true);
    expect(couldNotLine("do something new")).toBe("Could not do something new.");
    expect(couldNotLine("save the alarm")).toBe("Could not save the alarm.");
  });
});
