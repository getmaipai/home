import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "@/db";
import { people, settingsValues } from "@/db/schema";
import { getHouseholdSettingSource, getHouseholdSettingValue, setHouseholdSettingValue } from "@/lib/settings";
import { mappedMediaSettings, migrateMediaSettings } from "@/lib/settingsMediaMigration";
import { adultStylesAllowed, householdPictureQuality } from "@/lib/pictures/policy";
import { adapterAudiencesFor } from "@/lib/pictures/policy";
import { householdVideoQuality, videoAdapterAudiencesFor } from "@/lib/videos/policy";
import { householdLikenessAllowed, likenessCallRefusal, likenessRefusal, LIKENESS_OFF_LINE, otherMembersNamed } from "@/lib/likeness";
import { resetDb } from "../../tests/reset-db";

const OLD = ["generation.adult_adapters", "generation.video.adult_adapters", "generation.picture_quality", "generation.video_quality"] as const;
const writeStored = (key: string, value: unknown) => db.insert(settingsValues).values({ scope: "household", key, value: JSON.stringify(value), hlc: "1:0:test", source: "user", setBy: null, updatedAt: new Date().toISOString() }).run();

describe("the migration table (each old combination)", () => {
  const adult = ["allowed", "restricted", undefined] as const;
  for (const pictureAdult of adult) for (const videoAdult of adult) {
    const expected = pictureAdult === "restricted" || videoAdult === "restricted" ? "restricted" : undefined;
    test(`picture ${pictureAdult ?? "unset"} and video ${videoAdult ?? "unset"} give ${expected ?? "nothing (the default, allowed)"}`, () => {
      const out = mappedMediaSettings({ pictureAdult, videoAdult, pictureQuality: undefined, videoQuality: undefined });
      expect(out.find((entry) => entry.key === "generation.styles.adult_only")?.value).toBe(expected);
    });
  }
  for (const quality of ["quick", "detailed", undefined, "garbage"] as const) {
    test(`quality ${quality ?? "unset"} maps to ${quality === "detailed" ? "boost" : "the default (standard)"}`, () => {
      const out = mappedMediaSettings({ pictureAdult: undefined, videoAdult: undefined, pictureQuality: quality, videoQuality: quality });
      expect(out.find((entry) => entry.key === "generation.picture_tier")?.value).toBe(quality === "detailed" ? "boost" : undefined);
      expect(out.find((entry) => entry.key === "generation.video_tier")?.value).toBe(quality === "detailed" ? "boost" : undefined);
    });
  }
});

describe("migrateMediaSettings on stored data", () => {
  beforeEach(() => resetDb());

  test("old values are written under the new keys, the old keys stay stored and readable, and the step runs once", () => {
    writeStored("generation.adult_adapters", "allowed");
    writeStored("generation.video.adult_adapters", "restricted");
    writeStored("generation.picture_quality", "detailed");
    writeStored("generation.video_quality", "quick");
    expect(adultStylesAllowed()).toBe(true);
    expect(migrateMediaSettings()).toBe("migrated");
    expect(getHouseholdSettingValue("generation.styles.adult_only")).toBe("restricted");
    expect(getHouseholdSettingValue("generation.picture_tier")).toBe("boost");
    expect(getHouseholdSettingSource("generation.video_tier")).toBeUndefined();
    expect(adultStylesAllowed()).toBe(false);
    expect(householdPictureQuality()).toBe("detailed");
    expect(householdVideoQuality()).toBe("quick");
    // Nothing lost: every old value is still stored and readable.
    expect(OLD.map((key) => getHouseholdSettingValue(key))).toEqual(["allowed", "restricted", "detailed", "quick"]);
    expect(migrateMediaSettings()).toBe("already_ran");
  });

  test("a second run changes nothing and a value already set under a new key wins", () => {
    writeStored("generation.video_quality", "detailed");
    setHouseholdSettingValue("generation.video_tier", "standard");
    expect(migrateMediaSettings()).toBe("migrated");
    expect(getHouseholdSettingValue("generation.video_tier")).toBe("standard");
    const before = db.select().from(settingsValues).all().length;
    expect(migrateMediaSettings()).toBe("already_ran");
    expect(db.select().from(settingsValues).all().length).toBe(before);
  });

  test("a home that never set the old keys gets nothing written and the defaults", () => {
    expect(migrateMediaSettings()).toBe("migrated");
    for (const key of ["generation.styles.adult_only", "generation.picture_tier", "generation.video_tier"]) expect(getHouseholdSettingSource(key)).toBeUndefined();
    expect(adultStylesAllowed()).toBe(true);
    expect(householdPictureQuality()).toBe("quick");
    expect(householdVideoQuality()).toBe("quick");
  });

  test("an old value that is not a known choice is carried as nothing and reads as the default", () => {
    writeStored("generation.picture_quality", "garbage");
    migrateMediaSettings();
    expect(getHouseholdSettingSource("generation.picture_tier")).toBeUndefined();
    expect(householdPictureQuality()).toBe("quick");
  });
});

describe("one reader per setting", () => {
  beforeEach(() => resetDb());

  test("the adult-only styles switch is one key for pictures, videos and the adult lanes", () => {
    const adultAudience = { actor: { id: "a", role: "adult" }, band: "adult", surface: "chat", surfaceClass: "written", spoken: false } as never;
    expect(adapterAudiencesFor(adultAudience)).toEqual(["all-ages", "adult-only"]);
    expect(videoAdapterAudiencesFor(adultAudience)).toEqual(["all-ages", "adult-only"]);
    setHouseholdSettingValue("generation.styles.adult_only", "restricted");
    expect(adapterAudiencesFor(adultAudience)).toEqual(["all-ages"]);
    expect(videoAdapterAudiencesFor(adultAudience)).toEqual(["all-ages"]);
    // The old keys no longer decide anything.
    setHouseholdSettingValue("generation.styles.adult_only", "allowed");
    setHouseholdSettingValue("generation.adult_adapters", "restricted");
    setHouseholdSettingValue("generation.video.adult_adapters", "restricted");
    expect(adultStylesAllowed()).toBe(true);
  });

  test("the picture and video levels read their tier keys", () => {
    setHouseholdSettingValue("generation.picture_tier", "boost");
    setHouseholdSettingValue("generation.video_tier", "boost");
    expect(householdPictureQuality()).toBe("detailed");
    expect(householdVideoQuality()).toBe("detailed");
    setHouseholdSettingValue("generation.picture_quality", "quick");
    expect(householdPictureQuality()).toBe("detailed");
  });
});

describe("the household likeness reader (LIKENESS-01, rule 0)", () => {
  beforeEach(() => resetDb());
  const now = new Date().toISOString();
  const add = (id: string, displayName: string, role: string, extra: Record<string, unknown> = {}) => db.insert(people).values({ id, displayName, role, avatarSeed: id, source: "local", createdAt: now, updatedAt: now, hlc: "1:0:test", ...extra }).run();

  test("on by default: nothing is refused, even naming a household member", () => {
    add("p-sage", "Sage", "owner"); add("p-nova", "Nova", "child");
    expect(householdLikenessAllowed()).toBe(true);
    expect(likenessRefusal({ id: "p-sage" }, "a picture of Nova on a bike")).toBeNull();
  });

  test("off: naming another household member is refused with the plain line, naming yourself or nobody is not", () => {
    add("p-sage", "Sage", "owner"); add("p-nova", "Nova", "child", { nickname: "Novie" }); add("p-guest", "Visitor", "guest");
    setHouseholdSettingValue("generation.household_likeness", false);
    expect(householdLikenessAllowed()).toBe(false);
    expect(likenessRefusal({ id: "p-sage" }, "a picture of Nova on a bike")).toBe(LIKENESS_OFF_LINE);
    expect(likenessRefusal({ id: "p-sage" }, "a song for novie")).toBe(LIKENESS_OFF_LINE);
    expect(likenessRefusal({ id: "p-sage" }, "a picture of Sage on a bike")).toBeNull();
    expect(likenessRefusal({ id: "p-sage" }, "a picture of Novak")).toBeNull();
    expect(likenessRefusal({ id: "p-sage" }, "a picture of a visitor")).toBeNull();
    expect(otherMembersNamed("Nova and Sage", "p-sage")).toEqual(["Nova"]);
    expect(likenessCallRefusal({ id: "p-sage" }, { prompt: "Nova at the beach" })).toMatchObject({ kind: "likeness", why: "household_likeness_off", line: LIKENESS_OFF_LINE });
    expect(likenessCallRefusal({ id: "p-sage" }, { lyrics: "la la Nova" })).not.toBeNull();
    expect(likenessCallRefusal({ id: "p-sage" }, { prompt: "a quiet lake" })).toBeNull();
    setHouseholdSettingValue("generation.household_likeness", true);
    expect(likenessRefusal({ id: "p-sage" }, "a picture of Nova on a bike")).toBeNull();
  });
});
