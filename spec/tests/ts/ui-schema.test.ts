// Validates every page in spec/ui/pages/ against spec/ui/schema.json using
// ajv (proper $ref/oneOf/discriminator support for a recursive schema; see
// spec/ui/README.md for why this doesn't go through the Zod codegen path).
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";

const UI_DIR = join(import.meta.dir, "..", "..", "ui");
const schema = JSON.parse(readFileSync(join(UI_DIR, "schema.json"), "utf-8"));

const ajv = new Ajv2020({ strict: true });
const validate = ajv.compile(schema);

const pageFiles = readdirSync(join(UI_DIR, "pages")).filter((f) => f.endsWith(".json"));

describe("UI schema", () => {
  test("at least one page exists to validate", () => {
    expect(pageFiles.length).toBeGreaterThan(0);
  });

  for (const file of pageFiles) {
    test(`pages/${file} conforms to schema.json`, () => {
      const page = JSON.parse(readFileSync(join(UI_DIR, "pages", file), "utf-8"));
      const valid = validate(page);
      if (!valid) {
        throw new Error(JSON.stringify(validate.errors, null, 2));
      }
      expect(valid).toBe(true);
    });
  }

  test("a node with an unknown type is rejected", () => {
    const bad = { type: "not_a_real_type" };
    expect(validate(bad)).toBe(false);
  });

  test("a message_thread missing its required bind is rejected", () => {
    const bad = { type: "message_thread", sender_field: "x", text_field: "y" };
    expect(validate(bad)).toBe(false);
  });
});
