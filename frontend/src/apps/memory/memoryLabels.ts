import type { MemoryRecord } from "@/lib/api";

export const CATEGORY_LABELS: Record<MemoryRecord["category"], string> = {
  person: "Person",
  place: "Place",
  thing: "Thing",
  preference: "Preference",
  identity: "Identity",
  event: "Event",
  project: "Project",
  goal: "Goal",
  relationship: "Relationship",
  fact: "Fact",
  state: "State",
};

// scope: "self" is MaiPai's own memory of itself, never shared with
// anyone (spec/schemas/memory-record.schema.json's own description);
// "household" and "person" need a human-readable subject, which for
// person-scope means resolving the id against the roster - names, not
// raw "person-xxxxxx" ids, are what a family member actually reads.
export function scopeLabel(record: MemoryRecord, nameById: Map<string, string>): string {
  if (record.scope === "self") return "MaiPai's own";
  if (record.scope === "household") return "Household";
  return record.person ? (nameById.get(record.person) ?? "A household member") : "A household member";
}
