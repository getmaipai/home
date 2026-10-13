// IMGQ-09: the show_images wording and the after-the-answer re-ask instruction.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { SHOW_IMAGES_REASK_INSTRUCTION } from "@/lib/turnMachine/nodes/model";

const manifest = JSON.parse(readFileSync(new URL("../packages/show_images/manifest.json", import.meta.url), "utf8")) as { description: string; args: { properties: { subject: { description: string } } } };

// Held-out bench subjects must never appear in the few-shot block (rule 13: the split stays unseen).
const HELD_OUT = ["einstein", "colosseum", "everest", "cybertruck", "minecraft", "beyonce", "snow leopard", "millennium falcon", "keanu", "tree frog", "bluey", "darth vader", "inflation", "pancake", "photosynthesis", "japan"];

test("the show_images wording holds none of the held-out bench subjects", () => {
  const text = `${manifest.description} ${manifest.args.properties.subject.description}`.toLowerCase();
  for (const word of HELD_OUT) expect(text).not.toContain(word);
});

test("the show_images wording keeps its examples to call shape and intent, no counts and no look descriptions", () => {
  const text = manifest.args.properties.subject.description;
  expect(text).toContain("Examples");
  expect(text).toContain("These never call it");
  expect(text).not.toMatch(/\b\d+ (photos|pictures|images|words)\b/i);
  expect(text).not.toContain("—");
  expect(manifest.description.length).toBeLessThanOrEqual(200);
});

test("the re-ask tells the model the reply is final and never repeats or edits it", () => {
  expect(SHOW_IMAGES_REASK_INSTRUCTION).toContain("already shown");
  expect(SHOW_IMAGES_REASK_INSTRUCTION).toContain("do not repeat or change it");
  expect(SHOW_IMAGES_REASK_INSTRUCTION).not.toContain("—");
});
