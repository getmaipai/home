// H2 (tools-ecosystem-design-2026-10-03.md section 4): reduce a tool's JSON
// Schema to the small subset llama-server's grammar accepts. Unknown
// keywords are dropped and the function never throws (rule 6: a bad schema
// costs one tool its argument hints, never the turn).
import { describe, expect, test } from "bun:test";
import { sanitiseSchema } from "@/lib/mcp/schemaSanitiser";

describe("sanitiseSchema", () => {
  test("keeps the supported subset and drops unknown keywords", () => {
    const out = sanitiseSchema({
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      title: "ignored",
      properties: {
        entity: { type: "string", description: "which one", minLength: 1, maxLength: 80, examples: ["x"], $comment: "c" },
        level: { type: "integer", minimum: 0, maximum: 100, default: 50, exclusiveMinimum: -1 },
        mode: { type: "string", enum: ["on", "off"] },
      },
      required: ["entity"],
      additionalProperties: false,
      patternProperties: { "^x": { type: "string" } },
    });
    expect(out).toEqual({
      type: "object",
      properties: {
        entity: { type: "string", description: "which one", minLength: 1, maxLength: 80 },
        level: { type: "integer", minimum: 0, maximum: 100, default: 50 },
        mode: { type: "string", enum: ["on", "off"] },
      },
      required: ["entity"],
      additionalProperties: false,
    });
  });

  test("a non-object top level becomes an empty object schema", () => {
    expect(sanitiseSchema({ type: "string" })).toEqual({ type: "object", properties: {} });
    expect(sanitiseSchema(undefined)).toEqual({ type: "object", properties: {} });
    expect(sanitiseSchema("junk")).toEqual({ type: "object", properties: {} });
    expect(sanitiseSchema(null)).toEqual({ type: "object", properties: {} });
  });

  test("a type array becomes anyOf, oneOf is renamed anyOf", () => {
    const out = sanitiseSchema({
      type: "object",
      properties: {
        a: { type: ["string", "null"] },
        b: { oneOf: [{ type: "string" }, { type: "number", multipleOf: 2 }] },
      },
    }) as { properties: Record<string, unknown> };
    expect(out.properties.a).toEqual({ anyOf: [{ type: "string" }, { type: "null" }] });
    expect(out.properties.b).toEqual({ anyOf: [{ type: "string" }, { type: "number" }] });
  });

  test("array items are sanitised and item counts kept", () => {
    const out = sanitiseSchema({
      type: "object",
      properties: { ids: { type: "array", items: { type: "string", format: "uuid", pattern: "^a" }, minItems: 1, maxItems: 5, uniqueItems: true } },
    }) as { properties: Record<string, unknown> };
    expect(out.properties.ids).toEqual({ type: "array", items: { type: "string", pattern: "^a" }, minItems: 1, maxItems: 5 });
  });

  test("a local $ref is inlined; a cyclic one is cut, never thrown", () => {
    const out = sanitiseSchema({
      type: "object",
      properties: { who: { $ref: "#/$defs/Who" }, tree: { $ref: "#/$defs/Node" } },
      $defs: {
        Who: { type: "string", enum: ["juniper", "oliver"] },
        Node: { type: "object", properties: { next: { $ref: "#/$defs/Node" } } },
      },
    }) as { properties: Record<string, unknown> };
    expect(out.properties.who).toEqual({ type: "string", enum: ["juniper", "oliver"] });
    expect(out.properties.tree).toEqual({ type: "object", properties: { next: {} } });
    expect(sanitiseSchema({ type: "object", properties: { x: { $ref: "https://example.com/x.json" } } })).toEqual({
      type: "object",
      properties: { x: {} },
    });
  });

  test("hostile shapes never throw", () => {
    const deep: Record<string, unknown> = { type: "object" };
    let cur = deep;
    for (let i = 0; i < 200; i++) {
      const next: Record<string, unknown> = { type: "object" };
      cur.properties = { n: next };
      cur = next;
    }
    expect(() => sanitiseSchema(deep)).not.toThrow();
    expect(() => sanitiseSchema({ type: "object", properties: { a: 5, b: null, c: [] }, required: "x", enum: 3 })).not.toThrow();
    const cyc: Record<string, unknown> = { type: "object" };
    cyc.properties = { self: cyc };
    expect(() => sanitiseSchema(cyc)).not.toThrow();
  });

  test("required keeps only names that are properties", () => {
    const out = sanitiseSchema({ type: "object", properties: { a: { type: "string" } }, required: ["a", "ghost", 4] });
    expect(out).toMatchObject({ required: ["a"] });
  });
});
