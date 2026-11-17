// OVERRIDES-01: the audit rows an override write leaves (SETTINGS-AUDIT-01). Kept apart from pass.test.ts so the pass tests run
// without the audit module; runs once the audit row is in the tree.
import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people } from "@/db/schema";
import { resetDb } from "../reset-db";
import { setValue } from "@/lib/settings";
import { listSettingsChanges } from "@/lib/settingsAudit";
import type { PersonRow } from "@/types";

const now = new Date().toISOString();
function person(id: string, role: string): PersonRow {
  db.insert(people).values({ id, displayName: id, role, avatarSeed: id, source: "hub", createdAt: now, updatedAt: now, hlc: "1700000000000:0:testfix" } as never).run();
  return db.select().from(people).where(eq(people.id, id)).get()! as PersonRow;
}
let admin: PersonRow, teen: PersonRow;
beforeEach(() => { resetDb(); admin = person("person-adminaaa", "admin"); teen = person("person-teenaaa", "teen"); });

test("each admin override write leaves exactly one row with a scope and no person id", () => {
  const writes: Array<[string, string, unknown, "person" | "household"]> = [
    [`person:${teen.id}`, "content.ceiling", "R", "person"],
    ["household", "content.ceiling", "PG", "household"],
    [`person:${teen.id}`, "content.unrated.news", "yes", "person"],
    [`person:${teen.id}`, "access.thinking", true, "person"],
    [`person:${teen.id}`, "access.tier.max", ["image"], "person"],
  ];
  for (const [scope, key, value, expected] of writes) {
    const before = listSettingsChanges(1000).length;
    expect(setValue(admin, scope, key, value).ok).toBe(true);
    const rows = listSettingsChanges(1000);
    expect(rows.length).toBe(before + 1);
    const row = rows.find((r) => r.key === key && r.scope === expected)!;
    expect(row).toBeDefined();
    expect(row.actor_role).toBe("admin");
    expect(JSON.stringify(row)).not.toContain(teen.id);
    expect(JSON.stringify(row)).not.toContain(admin.id);
  }
});

test("a person's own lowering leaves no row; an admin writing someone's own key does", () => {
  expect(setValue(teen, `person:${teen.id}`, "content.own_ceiling", "G").ok).toBe(true);
  expect(listSettingsChanges(100).length).toBe(0);
  expect(setValue(admin, `person:${teen.id}`, "content.own_ceiling", "PG").ok).toBe(true);
  expect(listSettingsChanges(100).length).toBe(1);
});
