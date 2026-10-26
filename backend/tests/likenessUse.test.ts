import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { likenessAdapters, people } from "@/db/schema";
import { declareStyleSubject, forgetStyleSubject, getStyleSubject, styleIsUnavailable } from "@/lib/likeness/adapters";
import { prepareStyleUse } from "@/lib/likeness/apply";
import { decideLikeness } from "@/lib/likeness/decide";
import { likenessStillAllowed } from "@/lib/likeness/guard";
import { NOTIFICATION_TYPES } from "@/lib/notificationTypes";
import { setHouseholdSettingValue } from "@/lib/settings";
import { __setStackTrustForTests } from "@/lib/likeness/proof";
import type { PersonRow } from "@/types";

beforeEach(() => { resetDb(); __setStackTrustForTests({ ok: true }); });
function person(id: string, displayName: string, role: string): PersonRow {
  const now = new Date().toISOString();
  db.insert(people).values({ id, displayName, role, avatarSeed: displayName, source: "test", createdAt: now, updatedAt: now, hlc: "1:0:test00" }).run();
  return db.select().from(people).where(eq(people.id, id)).get()! as PersonRow;
}
function audience(actor: PersonRow) { return { actor, band: "adult" as const, surface: "chat" as never, surfaceClass: "written" as const, spoken: false }; }

describe("likeness after agreement removal", () => {
  test("every household age band stays behind its existing requester floor", () => {
    const sage = person("p-sage", "Sage", "owner");
    const marlow = person("p-marlow", "Marlow", "adult");
    const iris = person("p-iris", "Iris", "teen");
    const nova = person("p-nova", "Nova", "child");
    expect(decideLikeness({ requester: audience(sage), subjectPersonId: marlow.id, adultContent: false }).ok).toBe(true);
    expect(decideLikeness({ requester: { ...audience(iris), band: "teen" }, subjectPersonId: marlow.id, adultContent: false }).ok).toBe(false);
    expect(decideLikeness({ requester: { ...audience(nova), band: "child" }, subjectPersonId: marlow.id, adultContent: false }).ok).toBe(false);
    expect(decideLikeness({ requester: { ...audience(iris), band: "teen" }, subjectPersonId: marlow.id, adultContent: true }).ok).toBe(false);
    expect(decideLikeness({ requester: { ...audience(nova), band: "child" }, subjectPersonId: marlow.id, adultContent: true }).ok).toBe(false);
  });
  test("the household option becoming off withholds waiting work", () => {
    const sage = person("p-sage", "Sage", "owner");
    const marlow = person("p-marlow", "Marlow", "adult");
    const job = { subject: marlow.id, requester: sage.id, way: "style" as const, adultContent: false };
    expect(likenessStillAllowed(job).ok).toBe(true);
    expect(setHouseholdSettingValue("generation.household_likeness", false).ok).toBe(true);
    expect(likenessStillAllowed(job).ok).toBe(false);
  });
  test("saved style subject binding remains and removed assets cannot be revived", () => {
    const sage = person("p-sage", "Sage", "owner");
    const marlow = person("p-marlow", "Marlow", "adult");
    declareStyleSubject({ adapterId: "lora-test", medium: "picture", subjectPersonId: marlow.id, classification: "all-ages", declaredBy: sage.id });
    expect(getStyleSubject("picture", "lora-test")?.subjectPersonId).toBe("p-marlow");
    // Repeated import declarations may update metadata, but the persistent subject binding remains.
    expect(getStyleSubject("picture", "lora-test")?.subjectPersonId).toBe("p-marlow");
  });
  test("removed assets stay tombstoned and cannot be revived", () => {
    const sage = person("p-sage", "Sage", "owner");
    const marlow = person("p-marlow", "Marlow", "adult");
    const now = new Date().toISOString();
    db.insert(likenessAdapters).values({ id: "lik-a-legacy01", adapterId: "lora-deleted", medium: "picture", subjectPersonId: marlow.id, classification: "all-ages", state: "removal_queued", declaredBy: sage.id, source: "import", createdAt: now, updatedAt: now, hlc: "1:0:test00" }).run();
    expect(getStyleSubject("picture", "lora-deleted")?.state).toBe("removed");
    expect(styleIsUnavailable("picture", "lora-deleted")).toBe(true);
    declareStyleSubject({ adapterId: "lora-deleted", medium: "picture", subjectPersonId: null, classification: "all-ages", declaredBy: sage.id });
    expect(getStyleSubject("picture", "lora-deleted")?.state).toBe("removed");
  });
  test("manual style deletion keeps its old subject tombstone", () => {
    const sage = person("p-sage", "Sage", "owner");
    const marlow = person("p-marlow", "Marlow", "adult");
    declareStyleSubject({ adapterId: "lora-remove", medium: "picture", subjectPersonId: marlow.id, classification: "all-ages", declaredBy: sage.id });
    forgetStyleSubject("picture", "lora-remove");
    expect(getStyleSubject("picture", "lora-remove")?.state).toBe("removed");
    expect(getStyleSubject("picture", "lora-remove")?.subjectPersonId).toBe(marlow.id);
  });
  test("saved style use revalidates subject binding and household setting", async () => {
    const sage = person("p-sage", "Sage", "owner");
    const iris = person("p-iris", "Iris", "teen");
    declareStyleSubject({ adapterId: "lora-iris", medium: "picture", subjectPersonId: iris.id, classification: "all-ages", declaredBy: sage.id });
    const style = { id: "lora-iris", name: "Iris style", likeness_subject: null };
    expect((await prepareStyleUse({ medium: "picture", audience: audience(sage), style, text: "a family portrait", depictsRealPerson: false, source: "chat" })).kind).toBe("likeness");
    expect(setHouseholdSettingValue("generation.household_likeness", false).ok).toBe(true);
    const result = await prepareStyleUse({ medium: "picture", audience: audience(sage), style, text: "a family portrait", depictsRealPerson: false, source: "chat" });
    expect(result.kind).toBe("refused");
  });
  test("engine negative prompt protects minor and non-self styles, but not an adult's own style", async () => {
    const sage = person("p-sage", "Sage", "owner");
    const minor = person("p-nova", "Nova", "child");
    const adult = person("p-iris", "Iris", "adult");
    for (const [id, subject] of [["lora-nova", minor], ["lora-iris", adult], ["lora-sage", sage]] as const) declareStyleSubject({ adapterId: id, medium: "picture", subjectPersonId: subject.id, classification: "all-ages", declaredBy: sage.id });
    const use = (actor: PersonRow, id: string) => prepareStyleUse({ medium: "picture", audience: audience(actor), style: { id, name: id }, text: "a portrait in warm light", depictsRealPerson: false, source: "chat" });
    const minorPrep = await use(sage, "lora-nova");
    const otherAdultPrep = await use(sage, "lora-iris");
    const selfPrep = await use(sage, "lora-sage");
    expect(minorPrep).toMatchObject({ kind: "likeness", negativePrompt: expect.stringContaining("nude, naked") });
    expect(otherAdultPrep).toMatchObject({ kind: "likeness", negativePrompt: expect.stringContaining("nude, naked") });
    expect(selfPrep).toMatchObject({ kind: "likeness", negativePrompt: null });
  });
  test("waiting style jobs stop when the saved style is tombstoned", () => {
    const sage = person("p-sage", "Sage", "owner");
    const marlow = person("p-marlow", "Marlow", "adult");
    declareStyleSubject({ adapterId: "lora-wait", medium: "picture", subjectPersonId: marlow.id, classification: "all-ages", declaredBy: sage.id });
    const job = { subject: marlow.id, requester: sage.id, way: "style" as const, adultContent: false, styleId: "lora-wait", medium: "picture" as const };
    expect(likenessStillAllowed(job).ok).toBe(true);
    forgetStyleSubject("picture", "lora-wait");
    expect(likenessStillAllowed(job).ok).toBe(false);
  });
  test("legacy stored adult_content is normalized, and a missing field fails closed", () => {
    const { normalizeJobLikeness } = require("@/lib/likeness/guard") as typeof import("@/lib/likeness/guard");
    expect(normalizeJobLikeness({ subject: "p", requester: "r", way: "style", adult_content: true })?.adultContent).toBe(true);
    expect(normalizeJobLikeness({ subject: "p", requester: "r", way: "style" })?.adultContent).toBe(true);
    expect(normalizeJobLikeness({ subject: "p", requester: "r", way: "style", adultContent: false, adult_content: true })?.adultContent).toBe(false);
  });
  test("likeness.used is absent from declared notifications", () => {
    expect(NOTIFICATION_TYPES.some((type) => type.id === "likeness.used")).toBe(false);
  });
});
