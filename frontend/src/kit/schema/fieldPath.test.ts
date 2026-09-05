import { describe, expect, test } from "bun:test";
import { readField, fillTemplate, fillTemplateDeep } from "@/kit/schema/fieldPath";

describe("readField", () => {
  test("reads a top-level field", () => {
    expect(readField({ text: "hello" }, "text")).toBe("hello");
  });

  test("reads a nested dotted path", () => {
    expect(readField({ person: { display_name: "Nova" } }, "person.display_name")).toBe("Nova");
  });

  test("returns undefined for a missing path rather than throwing", () => {
    expect(readField({ text: "hi" }, "nope")).toBeUndefined();
    expect(readField({ a: null }, "a.b")).toBeUndefined();
    expect(readField(null, "a")).toBeUndefined();
  });
});

describe("fillTemplate", () => {
  test("substitutes one or more {field} placeholders", () => {
    expect(fillTemplate("Archive \"{text}\"", { text: "a fact" })).toBe('Archive "a fact"');
    expect(fillTemplate("{category} · {scope}", { category: "fact", scope: "person" })).toBe("fact · person");
  });

  test("leaves an unresolvable placeholder as-is rather than dropping it silently", () => {
    expect(fillTemplate("Archive {id}", {})).toBe("Archive {id}");
  });
});

describe("fillTemplateDeep", () => {
  test("substitutes string values inside a nested object, leaving other types untouched", () => {
    const result = fillTemplateDeep({ target: "/api/memory/{id}/archive", count: 3, args: { note: "{text}" } }, {
      id: "mem-1",
      text: "hi",
    });
    expect(result).toEqual({ target: "/api/memory/mem-1/archive", count: 3, args: { note: "hi" } });
  });
});
