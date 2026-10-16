import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "@/db";
import { people } from "@/db/schema";
import { createGrant } from "@/lib/grants";
import { resetDb } from "../../tests/reset-db";

function addPerson(id: string, role: string): void {
  const now = new Date().toISOString();
  db.insert(people).values({ id, displayName: id, role, avatarSeed: id, source: "local", createdAt: now, updatedAt: now, hlc: "1:0:test" }).run();
}

describe("grant authority", () => {
  beforeEach(() => resetDb());

  test("an admin cannot grant backups.restore, while the owner can", () => {
    addPerson("person-admin001", "admin");
    addPerson("person-owner001", "owner");

    const refused = createGrant({ id: "person-admin001", role: "admin" }, { person: "person-admin001", action: "backups.restore", effect: "allow" });
    expect(refused).toMatchObject({ ok: false, status: 400, error: "Admins cannot grant themselves backup restore access. Ask the owner to grant it." });

    const allowed = createGrant({ id: "person-owner001", role: "owner" }, { person: "person-admin001", action: "backups.restore", effect: "allow" });
    expect(allowed.ok).toBe(true);
    const adminDelegation = createGrant({ id: "person-admin001", role: "admin" }, { person: "person-owner001", action: "backups.restore", effect: "allow" });
    expect(adminDelegation).toMatchObject({ ok: false, error: "You can't give someone a permission you don't have. Ask the owner to grant it." });
  });
});
