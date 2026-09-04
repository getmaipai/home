// The recipe conformance suite (platform plan 3.2): every fixture in
// spec/fixtures/recipes/ must produce the same result from this
// interpreter as from the Python one (tests/py/test_recipe_conformance.py).
// This is the TS half of that proof.
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Recipe } from "../../gen/ts/recipe.js";
import { HostEmulator } from "../../emulators/ts/host-emulator.js";
import { runRecipe } from "../../interpreters/ts/recipe-interpreter.js";

const FIXTURES_DIR = join(import.meta.dir, "..", "..", "fixtures", "recipes");

interface ConformanceFixture {
  description: string;
  recipe: unknown;
  inputs: Record<string, unknown>;
  host_setup: { fetch?: Record<string, unknown>; config?: Record<string, unknown> };
  expected: {
    reply: { text: string; speech?: string } | null;
    actions: { kind: string; payload?: unknown }[];
    scheduled_jobs: { when: string; job: string }[];
    home_calls: { domain: string; service: string; target: unknown; data: unknown }[];
    memory_added: { text: string; category?: string; scope?: string }[];
  };
}

const fixtureFiles = readdirSync(FIXTURES_DIR).filter((f) => f.endsWith(".json"));

describe("recipe conformance", () => {
  for (const file of fixtureFiles) {
    test(file, () => {
      const fixture = JSON.parse(readFileSync(join(FIXTURES_DIR, file), "utf-8")) as ConformanceFixture;
      const recipe = Recipe.parse(fixture.recipe);

      const host = new HostEmulator();
      for (const [url, body] of Object.entries(fixture.host_setup.fetch ?? {})) {
        host.setFetchResponse(url, body);
      }
      for (const [key, value] of Object.entries(fixture.host_setup.config ?? {})) {
        host.seedConfig(key, value);
      }

      const result = runRecipe(recipe, fixture.inputs, host);

      expect(result.reply ?? null).toEqual(fixture.expected.reply);
      expect(result.actions).toEqual(fixture.expected.actions);
      expect(host.scheduledJobs.map(({ when, job }) => ({ when, job }))).toEqual(
        fixture.expected.scheduled_jobs,
      );
      expect(host.homeCallsLog).toEqual(fixture.expected.home_calls);
      expect(
        host.memoryStore.map(({ text, category, scope }) => ({ text, category, scope })),
      ).toEqual(fixture.expected.memory_added);
    });
  }
});
