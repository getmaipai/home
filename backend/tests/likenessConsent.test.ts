import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { people, settingsValues } from "@/db/schema";
import { decideLikeness } from "@/lib/likeness/decide";
import { resetValue, setValue, getHouseholdSettingValue } from "@/lib/settings";
import type { PersonRow } from "@/types";

beforeEach(() => resetDb());
function person(id: string, displayName: string, role: string): PersonRow {
  const now = new Date().toISOString();
  db.insert(people).values({ id, displayName, role, avatarSeed: displayName, source: "test", createdAt: now, updatedAt: now, hlc: "1:0:test00" }).run();
  return db.select().from(people).where(eq(people.id, id)).get()! as PersonRow;
}
function audience(actor: PersonRow) { return { actor, band: "adult" as const, surface: "chat" as never, surfaceClass: "written" as const, spoken: false }; }

describe("household likeness decision", () => {
  test("the household option defaults on and an owner can turn it off", () => {
    const sage = person("p-sage", "Sage", "owner");
    expect(getHouseholdSettingValue("generation.household_likeness")).toBe(true);
    expect(setValue(sage, "household", "generation.household_likeness", false).ok).toBe(true);
    expect(decideLikeness({ requester: audience(sage), subjectPersonId: sage.id, adultContent: false }).ok).toBe(false);
  });
  test("self adult content is allowed; another household adult is refused plainly", () => {
    const sage = person("p-sage", "Sage", "owner");
    const marlow = person("p-marlow", "Marlow", "adult");
    expect(decideLikeness({ requester: audience(sage), subjectPersonId: sage.id, adultContent: true }).ok).toBe(true);
    const result = decideLikeness({ requester: audience(sage), subjectPersonId: marlow.id, adultContent: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.line).toContain("Use your own saved style");
  });
  test("minors may be subjects of ordinary family media; guests, unknown and public subjects are refused and minors cannot be adult subjects", () => {
    const sage = person("p-sage", "Sage", "owner");
    const nova = person("p-nova", "Nova", "child");
    const guest = person("p-guest", "Guest", "guest");
    expect(decideLikeness({ requester: audience(sage), subjectPersonId: nova.id, adultContent: false }).ok).toBe(true);
    expect(decideLikeness({ requester: audience(sage), subjectPersonId: nova.id, adultContent: true }).ok).toBe(false);
    const iris = person("p-iris", "Iris", "teen");
    const marlow = person("p-marlow", "Marlow", "adult");
    expect(decideLikeness({ requester: audience(sage), subjectPersonId: iris.id, adultContent: false }).ok).toBe(true);
    const photoAdult = { ...audience(sage), surface: "chat" as never, surfaceClass: "written" as const, spoken: false };
    expect(decideLikeness({ requester: { ...photoAdult, surfaceClass: "glance" as never }, subjectPersonId: marlow.id, adultContent: false }).ok).toBe(false);
    expect(decideLikeness({ requester: { ...photoAdult, spoken: true }, subjectPersonId: marlow.id, adultContent: false }).ok).toBe(false);
    for (const id of [guest.id, "p-unknown", "public-figure"]) expect(decideLikeness({ requester: audience(sage), subjectPersonId: id, adultContent: false }).ok).toBe(false);
  });
  test("retired writes use the settings layer's unknown-key error", () => {
    const sage = person("p-sage", "Sage", "owner");
    for (const key of ["likeness.adults", "likeness.adult_content"]) expect(setValue(sage, "person:p-sage", key, true)).toMatchObject({ ok: false, status: 400, error: `unknown settings key: ${key}` });
    for (const key of ["likeness.adults", "likeness.adult_content"]) expect(resetValue(sage, "person:p-sage", key)).toMatchObject({ ok: false, status: 400, error: `unknown settings key: ${key}` });
  });
  test("an old stored value is ignored by decisions", () => {
    const sage = person("p-sage", "Sage", "owner");
    const marlow = person("p-marlow", "Marlow", "adult");
    const now = new Date().toISOString();
    db.insert(settingsValues).values({ scope: `person:${marlow.id}`, key: "likeness.adult_content", value: "true", source: "test", updatedAt: now, hlc: "1:0:test00" }).run();
    const result = decideLikeness({ requester: audience(sage), subjectPersonId: marlow.id, adultContent: true });
    expect(result.ok).toBe(false);
  });
});
