// MODELS-FROM-STACK-01 (2026-11-22): the Stack knows each model; Home keeps no name, description or id for one on the Settings pages or in the
// install strip (platform principle 4, one definition in one place). A model reaches these screens only as data the Stack sent, so adding a
// model to the Stack needs no Home edit. This test reads the source: a model-family word in a Settings component fails it.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const FAMILY_WORDS = /\b(qwen\d?|huihui|flux\d?|minimax|ltx|wan2|chatterbox|voxcpm|pocket-?tts|parakeet|moonshine|ace-?step|ornith|muse[- ]glimmer|kokoro|demucs|z-image|ernie)\b/i;

const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)]);
// The style (LoRA) pages name the base video model a style was trained on; that is a compatibility fact of the style file, not a model choice,
// and moving it is its own task (reported in docs/reports/stack-preset-audit-2026-11-22.md).
const sources = [...files(join(root, "apps", "settings")).filter((file) => !file.includes("/settings/styles/")), join(root, "lib", "stackModelsClient.ts")]
  .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file) && !/\.d\.ts$/.test(file));
const installWordsSource = readFileSync(join(root, "shell", "installWords.ts"), "utf8");

describe("no hand-kept model names on the Settings pages", () => {
  test("the sources are found", () => { expect(sources.length).toBeGreaterThan(20); });
  test("no install word carries a product name: names come from the Stack", () => {
    expect(installWordsSource.split("\n").filter((line) => /^\s*\{ match:.*\bproduct:/.test(line))).toEqual([]);
  });
  test("no Settings component names a model family", () => {
    const hits = sources.flatMap((file) => readFileSync(file, "utf8").split("\n").map((line, index) => ({ file: file.replace(root + "/", ""), line: index + 1, text: line })).filter((row) => FAMILY_WORDS.test(row.text) && !/^\s*(\/\/|\*|\/\*)/.test(row.text)));
    expect(hits.map((row) => `${row.file}:${row.line}: ${row.text.trim().slice(0, 100)}`)).toEqual([]);
  });
});
