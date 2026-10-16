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
    addPerson("admin-one", "admin");
    addPerson("owner-one", "owner");

    const refused = createGrant({ id: "admin-one", role: "admin" }, { person: "admin-one", action: "backups.restore", effect: "allow" });
    expect(refused).toMatchObject({ ok: false, status: 400, error: "You can't give someone a permission you don't have. Ask the owner to grant it." });

    const allowed = createGrant({ id: "owner-one", role: "owner" }, { person: "admin-one", action: "backups.restore", effect: "allow" });
    expect(allowed.ok).toBe(true);
  });
});
