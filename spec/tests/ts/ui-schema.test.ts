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

  // Session B step 4 rebuilt Chat on @assistant-ui/react, which owns its
  // own history/streaming/actions entirely in React - message_thread is
  // now just a mount point (step 5), so the old per-turn bind/
  // sender_field/text_field properties are no longer part of its shape.
  test("a message_thread is just a bare mount point - old v0 turn-list properties are rejected", () => {
    const bareIsValid = { type: "message_thread" };
    expect(validate(bareIsValid)).toBe(true);
    const stale = { type: "message_thread", bind: { source: "route", path: "/api/conversations" }, sender_field: "x", text_field: "y" };
    expect(validate(stale)).toBe(false);
  });

  test("settings_editor is a bare mount point for the kit's own generic settings renderer", () => {
    expect(validate({ type: "settings_editor" })).toBe(true);
    expect(validate({ type: "settings_editor", extra: true })).toBe(false);
  });

  test("a list missing its required bind is rejected", () => {
    const bad = { type: "list", item_key_field: "id", item_label_field: "text" };
    expect(validate(bad)).toBe(false);
  });

  test("a minimal list validates", () => {
    const good = {
      type: "list",
      bind: { source: "route", path: "/api/memory" },
      item_key_field: "id",
      item_label_field: "text",
    };
    expect(validate(good)).toBe(true);
  });

  test("a list's batch action requires a scope of selected or all", () => {
    const badScope = {
      type: "list",
      bind: { source: "route", path: "/api/memory" },
      item_key_field: "id",
      item_label_field: "text",
      batch: {
        actions: [{ label: "Archive", scope: "everything", action: { call: { target: "/api/memory/{id}/archive" } } }],
      },
    };
    expect(validate(badScope)).toBe(false);

    const goodScope = {
      ...badScope,
      batch: {
        actions: [{ label: "Archive", scope: "selected", action: { call: { target: "/api/memory/{id}/archive" } } }],
      },
    };
    expect(validate(goodScope)).toBe(true);
  });

  test("card_grid, media_shelf, detail_pane and split_view validate their own minimal shapes", () => {
    expect(
      validate({ type: "card_grid", bind: { source: "route", path: "/api/x" }, item_key_field: "id", item_label_field: "title" }),
    ).toBe(true);
    expect(
      validate({
        type: "media_shelf",
        bind: { source: "route", path: "/api/x" },
        item_key_field: "id",
        item_label_field: "title",
        item_media_field: "poster",
      }),
    ).toBe(true);
    expect(
      validate({ type: "detail_pane", title: "A thing", body: [{ type: "empty_state", icon: "inbox", text: "Nothing." }] }),
    ).toBe(true);
    expect(
      validate({
        type: "split_view",
        list: { type: "list", bind: { source: "route", path: "/api/x" }, item_key_field: "id", item_label_field: "title" },
        detail: { type: "detail_pane", title: "A thing", body: [{ type: "empty_state", icon: "inbox", text: "Nothing." }] },
      }),
    ).toBe(true);
  });
});
