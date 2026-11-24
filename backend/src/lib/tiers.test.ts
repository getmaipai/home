import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "@/db";
import { people, settingsValues } from "@/db/schema";
import { createGrant } from "@/lib/grants";
import { getHouseholdSettingValue, setHouseholdSettingValue } from "@/lib/settings";
import { maxOffered, MAX_NEEDS_ADMIN_LINE, MAX_NOT_ON_THIS_COMPUTER_LINE, tierArgument, authorizeTier, allowedQuality, clampTier, readSlot, slotKey, slotOptionsFor, type TierCategory, type TierDeps } from "@/lib/tiers";
import { householdDetailedEnabled, householdQuickModel } from "@/lib/pictures/policy";
import { offeredCodingTiers } from "@/lib/codingSessions";
import { migrateTierSlots } from "@/lib/tierSlotMigration";
import { writeChoiceSetting } from "@/lib/choiceSettings";
import type { AgeBand } from "@/lib/ageBand";
import type { PersonRow } from "@/types";
import { resetDb } from "../../tests/reset-db";

const open: TierDeps = { holdsMax: () => true, slotOff: () => false, who: (_c, t) => (t === "max" ? "admins" : "everyone") };
const person = (role: string) => ({ id: `person-${role}0001`, role });
const run = (role: string, band: AgeBand, category: TierCategory, requested: "standard" | "boost" | "max", deps: Partial<TierDeps> = {}) =>
  clampTier({ person: person(role), band, category, requested }, { ...open, ...deps });

describe("clampTier", () => {
  test("a child is always Standard, even holding every grant", () => {
    for (const category of ["chat", "pictures", "video", "music", "voice"] as const) expect(run("child", "child", category, "max").tier).toBe("standard");
  });
  test("a teen's chat and video clamp to Standard whatever the grant says (RULES.md rule 8)", () => {
    expect(run("teen", "teen", "chat", "max")).toEqual({ tier: "standard", note: "no_minor_part" });
    expect(run("teen", "teen", "video", "boost").tier).toBe("standard");
  });
  test("a teen reaches Max pictures only with the picture grant", () => {
    expect(run("teen", "teen", "pictures", "max", { holdsMax: () => false })).toEqual({ tier: "boost", note: "no_max_access" });
    expect(run("teen", "teen", "pictures", "max", { who: () => "everyone" }).tier).toBe("max");
  });
  test("an adult without the grant gets Boost with a note", () => {
    expect(run("adult", "adult", "chat", "max", { holdsMax: () => false })).toEqual({ tier: "boost", note: "no_max_access" });
  });
  test("a switched-off Max falls back to Boost, and Boost off to Standard", () => {
    expect(run("admin", "adult", "video", "max", { slotOff: (_c, t) => t === "max" })).toEqual({ tier: "boost", note: "slot_off" });
    expect(run("admin", "adult", "video", "max", { slotOff: () => true }).tier).toBe("standard");
  });
  test("Who can use it: admins only keeps Boost from an adult, an admin still has it", () => {
    const adminsOnly = { who: () => "admins" as const };
    expect(run("adult", "adult", "pictures", "boost", adminsOnly)).toEqual({ tier: "standard", note: "not_for_this_person" });
    expect(run("admin", "adult", "pictures", "boost", adminsOnly).tier).toBe("boost");
  });
  test("a guest is Standard", () => {
    expect(run("guest", "adult", "pictures", "boost").tier).toBe("standard");
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
    expect(createGrant({ id: owner.id, role: "owner" }, { person: child.id, action: "tier.max:pictures", effect: "allow" }).ok).toBe(false);
    expect(createGrant({ id: owner.id, role: "owner" }, { person: teen.id, action: "tier.max", effect: "allow" }).ok).toBe(false);
    expect(createGrant({ id: owner.id, role: "owner" }, { person: teen.id, action: "tier.max:chat", effect: "allow" }).ok).toBe(false);
    expect(authorizeTier({ person: child, category: "pictures", requested: "max" }).tier).toBe("standard");
    expect(authorizeTier({ person: teen, category: "chat", requested: "max" }).tier).toBe("standard");
    expect(authorizeTier({ person: teen, category: "pictures", requested: "max" }).tier).toBe("boost");
    expect(createGrant({ id: owner.id, role: "owner" }, { person: teen.id, action: "tier.max:pictures", effect: "allow" }).ok).toBe(true);
    expect(authorizeTier({ person: teen, category: "pictures", requested: "max" }).tier).toBe("max");
  });

  test("a switched-off Boost slot turns Detailed into Quick", () => {
    const adult = addPerson("person-adult001", "adult");
    expect(allowedQuality(adult, "pictures", "detailed")).toBe("detailed");
    expect(setHouseholdSettingValue(slotKey("pictures", "boost"), { model: "off", options: {} }).ok).toBe(true);
    expect(allowedQuality(adult, "pictures", "detailed")).toBe("quick");
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
    expect(readSlot("pictures", "standard").model).toBe("flux2-klein-4b");
    expect(readSlot("pictures", "boost").model).toBe("off");
    expect(migrateTierSlots()).toBe("already_ran");
  });

  test("the AI card writes the slots directly, and a write to an old key no longer touches them (VIDEO-SETTINGS-04)", () => {
    expect(writeChoiceSetting("engines.pictures.tier.standard", "klein")).toEqual({ ok: true });
    expect(writeChoiceSetting("engines.pictures.tier.boost", false)).toEqual({ ok: true });
    expect(readSlot("pictures", "standard").model).toBe("flux2-klein-4b");
    expect(readSlot("pictures", "boost").model).toBe("off");
    expect(householdQuickModel()).toBe("klein");
    expect(householdDetailedEnabled()).toBe(false);
    expect(writeChoiceSetting("engines.pictures.tier.boost", true)).toEqual({ ok: true });
    expect(householdDetailedEnabled()).toBe(true);
    expect(getHouseholdSettingValue(slotKey("pictures", "boost"))).toMatchObject({ model: "recommended" });
    // The old keys are still storable and readable, and no longer move a slot.
    setHouseholdSettingValue("generation.picture_quick_model", "ernie");
    setHouseholdSettingValue("generation.picture_detailed.enabled", false);
    expect(readSlot("pictures", "standard").model).toBe("flux2-klein-4b");
    expect(householdDetailedEnabled()).toBe(true);
    expect(getHouseholdSettingValue("generation.picture_quick_model")).toBe("ernie");
  });

  test("a slot write keeps the slot's options", () => {
    setHouseholdSettingValue(slotKey("pictures", "standard"), { model: "ernie-image-turbo", options: { steps: 12 } });
    writeChoiceSetting("engines.pictures.tier.standard", "klein");
    expect(getHouseholdSettingValue(slotKey("pictures", "standard"))).toMatchObject({ model: "flux2-klein-4b", options: { steps: 12 } });
  });
});

describe("tierArgument (the typed tier of a generating tool)", () => {
  beforeEach(() => resetDb());

  test("standard is Quick, boost is Detailed, and no value changes nothing", () => {
    const adult = addPerson("person-adult001", "adult");
    expect(tierArgument({ person: adult, category: "pictures", arg: "standard" })).toMatchObject({ quality: "quick", line: null });
    expect(tierArgument({ person: adult, category: "pictures", arg: "boost" })).toMatchObject({ quality: "detailed", line: null });
    expect(tierArgument({ person: adult, category: "pictures", arg: "loud" })).toEqual({ quality: undefined, tier: undefined, line: null });
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
    expect(tierArgument({ person: child, category: "pictures", arg: "boost" })).toMatchObject({ quality: "quick", line: null });
  });
});

describe("Max on a card (TIER-HOME-03)", () => {
  beforeEach(() => resetDb());

  test("Max is offered only when a Max model is set, the slot is on and the person holds it", () => {
    const owner = addPerson("person-owner001", "owner");
    const adult = addPerson("person-adult001", "adult");
    expect(maxOffered(owner, "video")).toBe(false);
    expect(setHouseholdSettingValue(slotKey("video", "max"), { model: "ltx-big", options: {} }).ok).toBe(true);
    expect(maxOffered(owner, "video")).toBe(true);
    expect(maxOffered(adult, "video")).toBe(false);
    expect(tierArgument({ person: owner, category: "video", arg: "max" }).line).toBeNull();
    expect(setHouseholdSettingValue(slotKey("video", "max"), { model: "off", options: {} }).ok).toBe(true);
    expect(maxOffered(owner, "video")).toBe(false);
  });

  test("a teen's Max picture needs the grant; a child never sees it", () => {
    const owner = addPerson("person-owner001", "owner");
    const teen = addPerson("person-teen0001", "teen");
    const child = addPerson("person-child001", "child");
    setHouseholdSettingValue(slotKey("pictures", "max"), { model: "big-picture", options: {} });
    expect(maxOffered(teen, "pictures")).toBe(false);
    createGrant({ id: owner.id, role: "owner" }, { person: teen.id, action: "tier.max:pictures", effect: "allow" });
    expect(maxOffered(teen, "pictures")).toBe(true);
    expect(maxOffered(child, "pictures")).toBe(false);
  });
});

describe("the coding slots (CODE-FIX-03)", () => {
  beforeEach(() => resetDb());
  test("every coding level defaults to the Stack's recommended model, not off", () => {
    for (const tier of ["standard", "boost", "max"] as const) expect(readSlot("coding", tier).model).toBe("recommended");
  });
  test("an admin is authorized for coding Boost and Max, and a slot set to off still lowers", () => {
    const owner = addPerson("person-owner001", "owner");
    expect(authorizeTier({ person: owner, category: "coding", requested: "max" }).tier).toBe("max");
    expect(authorizeTier({ person: owner, category: "coding", requested: "boost" }).tier).toBe("boost");
    expect(setHouseholdSettingValue(slotKey("coding", "max"), { model: "off", options: {} }).ok).toBe(true);
    expect(authorizeTier({ person: owner, category: "coding", requested: "max" })).toEqual({ tier: "boost", note: "slot_off" });
  });
  test("offeredCodingTiers lists Boost and Max for an admin and only the granted tiers for a member", () => {
    const owner = addPerson("person-owner001", "owner");
    expect(offeredCodingTiers(owner).tiers).toEqual(["standard", "boost", "max"]);
    const member = addPerson("person-adult001", "adult");
    expect(offeredCodingTiers(member).tiers).not.toContain("max");
    createGrant({ id: owner.id, role: "owner" }, { person: member.id, action: "tier.max:coding", effect: "allow" });
    expect(offeredCodingTiers(member).tiers).toContain("max");
  });
  test("an adult member's pass holds coding Boost by the role default", () => {
    const member = addPerson("person-adult001", "adult");
    expect(offeredCodingTiers(member).tiers).toContain("boost");
  });
});
