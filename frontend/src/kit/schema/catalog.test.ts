import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { NODE_TYPES } from "@/kit/schema/types";
import { NodeRenderer } from "@/kit/schema/NodeRenderer";

// docs/plans/session-b-ui.md step 5: "each React primitive's props are a
// superset of its node; every node kind has a catalog entry." Checked
// two ways: NodeRenderer.tsx's own switch covers every declared type
// (a real render smoke test, not just a lookup, lives in
// NodeRenderer.test.tsx), and - here - the two sources of truth
// (spec/ui/schema.json's $defs and kit/schema/types.ts's NODE_TYPES)
// never silently drift apart.
describe("catalog/schema agreement", () => {
  test("every schema.json $def with a `type` const is listed in NODE_TYPES", () => {
    const schemaPath = new URL("../../../../spec/ui/schema.json", import.meta.url);
    const schema = JSON.parse(readFileSync(schemaPath, "utf-8")) as {
      $defs: Record<string, { properties?: { type?: { const?: string } } }>;
    };
    const declaredTypes = Object.values(schema.$defs)
      .map((def) => def.properties?.type?.const)
      .filter((t): t is string => typeof t === "string");

    expect(declaredTypes.length).toBeGreaterThan(0);
    for (const type of declaredTypes) {
      expect(NODE_TYPES).toContain(type as (typeof NODE_TYPES)[number]);
    }
    // The reverse direction too: NODE_TYPES never names a type schema.json
    // doesn't actually declare (a stale entry after a schema.json edit).
    for (const type of NODE_TYPES) {
      expect(declaredTypes).toContain(type);
    }
  });

  test("NodeRenderer's switch has a real case for every declared node type", () => {
    // Reads the compiled function's own source rather than rendering
    // every kind (several need real props/bindings that belong in
    // NodeRenderer.test.tsx's more thorough per-kind tests) - this test
    // exists purely to catch a NODE_TYPES entry with no `case` at all,
    // which would otherwise fall through to the switch's implicit
    // `undefined` return with no error anywhere.
    const source = NodeRenderer.toString();
    for (const type of NODE_TYPES) {
      expect(source).toContain(`"${type}"`);
    }
  });
});
