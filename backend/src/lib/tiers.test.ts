import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "@/db";
import { people, settingsValues } from "@/db/schema";
import { createGrant } from "@/lib/grants";
import { getHouseholdSettingValue, setHouseholdSettingValue } from "@/lib/settings";
import { MAX_NEEDS_ADMIN_LINE, MAX_NOT_ON_THIS_COMPUTER_LINE, tierArgument, authorizeTier, allowedQuality, clampTier, readSlot, slotKey, slotOptionsFor, type TierCategory, type TierDeps } from "@/lib/tiers";
import { householdDetailedEnabled, householdQuickModel } from "@/lib/pictures/policy";
import { migrateTierSlots } from "@/lib/tierSlotMigration";
import type { AgeBand } from "@/lib/ageBand";
import type { PersonRow } from "@/types";
import { resetDb } from "../../tests/reset-db";

const open: TierDeps = { holdsMax: () => true, slotOff: () => false, who: (_c, t) => (t === "max" ? "admins" : "everyone") };
const person = (role: string) => ({ id: `person-${role}0001`, role });
const run = (role: string, band: AgeBand, category: TierCategory, requested: "standard" | "boost" | "max", deps: Partial<TierDeps> = {}) =>
  clampTier({ person: person(role), band, category, requested }, { ...open, ...deps });

describe("clampTier", () => {
  test("a child is always Standard, even holding every grant", () => {
    for (const category of ["chat", "image", "video", "music", "voice"] as const) expect(run("child", "child", category, "max").tier).toBe("standard");
  });
  test("a teen's chat and video clamp to Standard whatever the grant says (RULES.md rule 8)", () => {
    expect(run("teen", "teen", "chat", "max")).toEqual({ tier: "standard", note: "minor_standard" });
    expect(run("teen", "teen", "video", "boost").tier).toBe("standard");
  });
  test("a teen reaches Max pictures only with the picture grant", () => {
    expect(run("teen", "teen", "image", "max", { holdsMax: () => false })).toEqual({ tier: "boost", note: "max_not_granted" });
    expect(run("teen", "teen", "image", "max", { who: () => "everyone" }).tier).toBe("max");
  });
  test("an adult without the grant gets Boost with a note", () => {
    expect(run("adult", "adult", "chat", "max", { holdsMax: () => false })).toEqual({ tier: "boost", note: "max_not_granted" });
  });
  test("a switched-off Max falls back to Boost, and Boost off to Standard", () => {
    expect(run("admin", "adult", "video", "max", { slotOff: (_c, t) => t === "max" })).toEqual({ tier: "boost", note: "slot_off" });
    expect(run("admin", "adult", "video", "max", { slotOff: () => true }).tier).toBe("standard");
  });
  test("Who can use it: admins only keeps Boost from an adult, an admin still has it", () => {
    const adminsOnly = { who: () => "admins" as const };
    expect(run("adult", "adult", "image", "boost", adminsOnly)).toEqual({ tier: "standard", note: "not_for_this_person" });
    expect(run("admin", "adult", "image", "boost", adminsOnly).tier).toBe("boost");
  });
  test("a guest is Standard", () => {
    expect(run("guest", "adult", "image", "boost").tier).toBe("standard");
  });
});

function addPerson(id: string, role: string): PersonRow {
  const now = new Date().toISOString();
  db.insert(people).values({ id, displayName: id, role, avatarSeed: id, source: "local", createdAt: now, updatedAt: now, hlc: "1:0:test" }).run();
  return db.select().from(people).all().find((p) => p.id === id)!;
}

describe("authorizeTier against real grants and slots", () => {
  beforeEach(() => resetDb());

  test("tier.max:<category> opens Max for one category only; an admin always holds it", () => {
    const owner = addPerson("person-owner001", "owner");
    const adult = addPerson("person-adult001", "adult");
    expect(authorizeTier({ person: owner, category: "chat", requested: "max" }).tier).toBe("max");
    expect(authorizeTier({ person: adult, category: "video", requested: "max" }).tier).toBe("boost");
    expect(createGrant({ id: owner.id, role: "owner" }, { person: adult.id, action: "tier.max:video", effect: "allow" }).ok).toBe(true);
    expect(authorizeTier({ person: adult, category: "video", requested: "max" }).tier).toBe("max");
    expect(authorizeTier({ person: adult, category: "chat", requested: "max" }).tier).toBe("boost");
  });

  test("a child's grant is refused by the spec policy, and a stored one never lifts the clamp", () => {
    const owner = addPerson("person-owner001", "owner");
    const child = addPerson("person-child001", "child");
    const teen = addPerson("person-teen0001", "teen");
    expect(createGrant({ id: owner.id, role: "owner" }, { person: child.id, action: "tier.max", effect: "allow" }).ok).toBe(false);
    expect(createGrant({ id: owner.id, role: "owner" }, { person: child.id, action: "tier.max:image", effect: "allow" }).ok).toBe(false);
    expect(createGrant({ id: owner.id, role: "owner" }, { person: teen.id, action: "tier.max", effect: "allow" }).ok).toBe(false);
    expect(createGrant({ id: owner.id, role: "owner" }, { person: teen.id, action: "tier.max:chat", effect: "allow" }).ok).toBe(false);
    expect(authorizeTier({ person: child, category: "image", requested: "max" }).tier).toBe("standard");
    expect(authorizeTier({ person: teen, category: "chat", requested: "max" }).tier).toBe("standard");
    expect(authorizeTier({ person: teen, category: "image", requested: "max" }).tier).toBe("boost");
    expect(createGrant({ id: owner.id, role: "owner" }, { person: teen.id, action: "tier.max:image", effect: "allow" }).ok).toBe(true);
    expect(authorizeTier({ person: teen, category: "image", requested: "max" }).tier).toBe("max");
  });

  test("a switched-off Boost slot turns Detailed into Quick", () => {
    const adult = addPerson("person-adult001", "adult");
    expect(allowedQuality(adult, "image", "detailed")).toBe("detailed");
    expect(setHouseholdSettingValue(slotKey("image", "boost"), { model: "off", options: {} }).ok).toBe(true);
    expect(allowedQuality(adult, "image", "detailed")).toBe("quick");
  });

  test("a minor never receives a thinking option from a slot", () => {
    expect(setHouseholdSettingValue(slotKey("chat", "boost"), { model: "recommended", options: { thinking: true, reasoning_budget: 4096 } }).ok).toBe(true);
    expect(slotOptionsFor("chat", "boost", "adult")).toEqual({ thinking: true, reasoning_budget: 4096 });
    expect(slotOptionsFor("chat", "boost", "teen")).toEqual({ thinking: false, reasoning_budget: 0 });
    expect(slotOptionsFor("chat", "boost", "child")).toEqual({ thinking: false, reasoning_budget: 0 });
  });

  test("a slot value with an unknown option is refused", () => {
    expect(setHouseholdSettingValue(slotKey("chat", "boost"), { model: "recommended", options: { turbo: true } }).ok).toBe(false);
    expect(readSlot("chat", "boost").model).toBe("recommended");
  });
});

describe("Quick and Detailed migrate into the slots", () => {
  beforeEach(() => resetDb());

  test("values a person set move into the slots once, and readers follow the slots", () => {
    // Stored straight into the table, as an older Home left them, so no live mirror has run.
    for (const [key, value] of [["generation.picture_quick_model", "klein"], ["generation.picture_detailed.enabled", false]] as const) {
      db.insert(settingsValues).values({ scope: "household", key, value: JSON.stringify(value), hlc: "1:0:test", source: "user", setBy: null, updatedAt: new Date().toISOString() }).run();
    }
    expect(householdQuickModel()).toBe("ernie");
    expect(migrateTierSlots()).toBe("migrated");
    expect(readSlot("image", "standard").model).toBe("flux2-klein-4b");
    expect(readSlot("image", "boost").model).toBe("off");
    expect(migrateTierSlots()).toBe("already_ran");
  });

  test("an explicit legacy write is mirrored into its slot at once", () => {
    setHouseholdSettingValue("generation.picture_quick_model", "klein");
    setHouseholdSettingValue("generation.picture_detailed.enabled", false);
    expect(readSlot("image", "standard").model).toBe("flux2-klein-4b");
    expect(readSlot("image", "boost").model).toBe("off");
    expect(householdQuickModel()).toBe("klein");
    expect(householdDetailedEnabled()).toBe(false);
    setHouseholdSettingValue("generation.picture_detailed.enabled", true);
    expect(householdDetailedEnabled()).toBe(true);
    expect(getHouseholdSettingValue(slotKey("image", "boost"))).toMatchObject({ model: "recommended" });
  });
});

describe("tierArgument (the typed tier of a generating tool)", () => {
  beforeEach(() => resetDb());

  test("standard is Quick, boost is Detailed, and no value changes nothing", () => {
    const adult = addPerson("person-adult001", "adult");
    expect(tierArgument({ person: adult, category: "image", arg: "standard" })).toMatchObject({ quality: "quick", line: null });
    expect(tierArgument({ person: adult, category: "image", arg: "boost" })).toMatchObject({ quality: "detailed", line: null });
    expect(tierArgument({ person: adult, category: "image", arg: "loud" })).toEqual({ quality: undefined, tier: undefined, line: null });
  });

  test("Max without the grant says an admin must do it; with it, says Max is not here yet and makes Boost", () => {
    const owner = addPerson("person-owner001", "owner");
    const adult = addPerson("person-adult001", "adult");
    expect(tierArgument({ person: adult, category: "video", arg: "max" })).toMatchObject({ tier: "boost", quality: "detailed", line: MAX_NEEDS_ADMIN_LINE });
    expect(tierArgument({ person: owner, category: "video", arg: "max" })).toMatchObject({ tier: "max", quality: "detailed", line: MAX_NOT_ON_THIS_COMPUTER_LINE });
    expect(tierArgument({ person: owner, category: "video", arg: "max", maxAvailable: true }).line).toBeNull();
  });

  test("a child or teen is lowered without a line about Max", () => {
    const teen = addPerson("person-teen0001", "teen");
    const child = addPerson("person-child001", "child");
    expect(tierArgument({ person: teen, category: "chat", arg: "max" })).toEqual({ quality: "quick", tier: "standard", line: null });
    expect(tierArgument({ person: child, category: "image", arg: "boost" })).toMatchObject({ quality: "quick", line: null });
  });
});
