import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { db } from "@/db";
import { people } from "@/db/schema";
import { canCreateCompanion, listCompanionCards } from "@/lib/companionsApp";
import { createHouseholdCompanion, setHouseholdCompanionStatus } from "@/lib/householdCompanions";
import { loadManifestOnly } from "@/lib/plugins";
import { __reloadPersonasForTests } from "@/lib/persona";
import { resetDb } from "../../tests/reset-db";

const root = join(process.env.MAIPAI_DATA_DIR!, "companions");
function addPerson(id: string, role: string) {
  const now = new Date().toISOString();
  db.insert(people).values({ id, displayName: id, role, avatarSeed: id, source: "local", createdAt: now, updatedAt: now, hlc: "1:0:test" }).run();
}
beforeEach(() => { resetDb(); rmSync(root, { recursive: true, force: true }); __reloadPersonasForTests(); });
afterEach(() => { resetDb(); rmSync(root, { recursive: true, force: true }); __reloadPersonasForTests(); });

describe("companion app cards", () => {
  test("only adults and admins may create companions", () => {
    addPerson("person-adult-create", "adult"); addPerson("person-teen-create", "teen"); addPerson("person-child-create", "child"); addPerson("person-admin-create", "admin");
    const rows = db.select().from(people).all();
    expect(canCreateCompanion(rows.find((row) => row.id === "person-adult-create")!)).toBe(true);
    expect(canCreateCompanion(rows.find((row) => row.id === "person-teen-create")!)).toBe(false);
    expect(canCreateCompanion(rows.find((row) => row.id === "person-child-create")!)).toBe(false);
    expect(canCreateCompanion(rows.find((row) => row.id === "person-admin-create")!, true)).toBe(true);
  });
  test("ready household companions are listed with household status; the author sees their draft", () => {
    addPerson("person-adult06", "adult");
    const loaded = loadManifestOnly("rivet"); if (!loaded.ok || !loaded.value.companion) throw new Error("rivet fixture is unavailable");
    const ready = createHouseholdCompanion({ ...loaded.value.companion, display_name: "Ready house" }, { display_name: "author", person_id: "person-adult06" });
    const draft = createHouseholdCompanion({ ...loaded.value.companion, display_name: "Draft house", examples: undefined }, { display_name: "author", person_id: "person-adult06" });
    if (!ready.ok || !draft.ok) throw new Error("test fixtures could not be created");
    setHouseholdCompanionStatus(ready.value.id, "ready");
    __reloadPersonasForTests();
    const cards = listCompanionCards(db.select().from(people).get()!);
    expect(cards.find((card) => card.id === ready.value.id)).toMatchObject({ is_household: true, status: "ready" });
    expect(cards.find((card) => card.id === draft.value.id)).toMatchObject({ is_household: true, status: "draft", is_default: false });
  });
});
