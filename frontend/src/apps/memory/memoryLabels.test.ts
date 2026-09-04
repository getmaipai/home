import { describe, expect, test } from "bun:test";
import { scopeLabel, CATEGORY_LABELS } from "@/apps/memory/memoryLabels";
import type { MemoryRecord } from "@/lib/api";

function record(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: "mem1-abc123",
    record_kind: "memory",
    text: "Likes dinosaurs",
    category: "preference",
    tier: "durable",
    status: "active",
    scope: "person",
    person: "person-abc123",
    source: "chat",
    importance: 0.5,
    pinned: false,
    sensitive: false,
    uses: 0,
    created_at: "2026-09-04T00:00:00.000Z",
    last_used_at: "2026-09-04T00:00:00.000Z",
    valid_from: null,
    valid_to: null,
    expired_at: null,
    superseded_by: null,
    embedding_space: null,
    ...overrides,
  };
}

describe("scopeLabel", () => {
  test("self scope is MaiPai's own", () => {
    expect(scopeLabel(record({ scope: "self", person: null }), new Map())).toBe("MaiPai's own");
  });

  test("household scope reads as Household", () => {
    expect(scopeLabel(record({ scope: "household", person: null }), new Map())).toBe("Household");
  });

  test("person scope resolves the id against the roster", () => {
    const names = new Map([["person-abc123", "Nova"]]);
    expect(scopeLabel(record({ scope: "person", person: "person-abc123" }), names)).toBe("Nova");
  });

  test("an unresolvable person id falls back honestly, not to a raw id", () => {
    expect(scopeLabel(record({ scope: "person", person: "person-gone" }), new Map())).toBe(
      "A household member",
    );
  });
});

describe("CATEGORY_LABELS", () => {
  test("covers every category the schema declares", () => {
    const categories: MemoryRecord["category"][] = [
      "person",
      "place",
      "thing",
      "preference",
      "identity",
      "event",
      "project",
      "goal",
      "relationship",
      "fact",
      "state",
    ];
    for (const c of categories) {
      expect(CATEGORY_LABELS[c]).toBeTruthy();
    }
  });
});
