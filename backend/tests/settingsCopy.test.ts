import { beforeEach, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { entities, people, relationships } from "@/db/schema";
import { calledAdminForOwnSettings } from "@/lib/relationships";
import { setValue } from "@/lib/settings";
import { getRegistry } from "@/lib/settingsRegistry";
import { minorVisibleSettingKeys } from "@/lib/settingsMinorSnapshot";
import { resolveSafeSearchLevel } from "@/lib/safeSearch";
import { photoUploadsAllowed } from "@/lib/chatPictures";
import { answerImagesAllowed } from "@/lib/answerImages/turn";
import { describeSetting } from "@maipai/spec/interpreters/ts/describeSetting.js";
import type { PersonRow } from "@/types";

beforeEach(() => resetDb());

async function makeHousehold() {
  const ownerClient = new TestClient();
  const setup = await ownerClient.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  expect(setup.status).toBe(201);
  const owner = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
  const addPerson = async (displayName: string, role: string) => {
    const response = await ownerClient.post("/api/people", {
      displayName,
      role,
      ...(role === "adult" ? { secret: "0000" } : {}),
    });
    expect(response.status).toBe(201);
    return db.select().from(people).where(eq(people.displayName, displayName)).get()!;
  };
  const child = await addPerson("Bramble", "child");
  const teen = await addPerson("Rill", "teen");
  const adult = await addPerson("Marlow", "adult");
  const addAccountEntity = async (person: PersonRow) => {
    const response = await ownerClient.post("/api/entities", {
      kind: "person", name: person.displayName, account_person_id: person.id,
    });
    expect(response.status).toBe(201);
    return (await response.json() as { id: string }).id;
  };
  const ownerEntity = await addAccountEntity(owner);
  const childEntity = await addAccountEntity(child);
  const teenEntity = await addAccountEntity(teen);
  const adultEntity = await addAccountEntity(adult);
  return { ownerClient, owner, child, teen, adult, ownerEntity, childEntity, teenEntity, adultEntity };
}

function writableValue(key: ReturnType<typeof getRegistry>[number], fallbackPersonId: string): unknown {
  if (key.key === "companions.enabled") return []; // a person-owned list of companion ids; Home validates it as an array
  if (key.selector === "time") return "09:00";
  if (key.selector === "select") {
    const options = (key.range as { options?: unknown[] } | undefined)?.options ?? [];
    return options.includes(key.default) ? key.default : options[0];
  }
  if (key.selector === "person") {
    const multiple = (key.range as { multiple?: boolean } | undefined)?.multiple;
    return multiple ? [] : key.default ?? fallbackPersonId;
  }
  if (key.selector === "text" && key.default == null) return ""; // coding.person.network_hosts is a multiple text in the spec, but Home validates text as one string until CODE-SET-01 builds the list value.
  // An unset-by-default number (the coding caps) is written at its minimum.
  if (key.selector === "number" && key.default == null) return (key.range as { min?: number } | undefined)?.min ?? 1;
  return key.default;
}

// Spec 0.1.185 settings/keys.json: the coding.person.* band defaults (child, teen, and the adult value where the band default differs
// from the key default). Written out here so a drift in the registry fails the test instead of being read back from itself.
const CODING_PERSON_BAND_DEFAULTS: Record<string, { child: unknown; teen: unknown; adult?: unknown }> = {
  "coding.person.api_keys": { child: false, teen: false },
  "coding.person.git_hosts": { child: false, teen: false },
  "coding.person.network_hosts": { child: [], teen: [] },
  "coding.person.max_sessions": { child: 1, teen: 1 },
  "coding.person.daily_tokens": { child: 100000, teen: 200000 },
  "coding.person.sandbox_size": { child: "small", teen: "small", adult: "standard" },
  "coding.person.message_minutes": { child: 15, teen: 15, adult: 30 },
};

describe("settings guard agreement metadata", () => {
  test("each person key describes the current write guard and band default", async () => {
    const { owner, child, teen, adult } = await makeHousehold();
    const personKeys = getRegistry().filter((key) => key.scope === "person");
    expect(personKeys.length).toBeGreaterThan(0);
    expect(personKeys.every((key) => key.control && key.band_default)).toBe(true);
    expect(photoUploadsAllowed(child)).toBe(false);
    expect(answerImagesAllowed({ actor: child, band: "child", surfaceClass: "written", spoken: false, temporary: false, bare: false, ephemeral: false })).toBe(false);

    for (const key of personKeys) {
      const value = writableValue(key, owner.id);
      for (const [band, person] of [["child", child], ["teen", teen], ["adult", adult]] as const) {
        const result = setValue(person, `person:${person.id}`, key.key, value);
        const childVoiceGuard = key.key === "tts.voice_id" && band === "child";
        expect(result.ok, `${key.key} ${band} self write`).toBe(childVoiceGuard ? false : key.control?.[band] === "self");
        // Topic levels exist for a child only; assertCanSetChildTopic refuses a teen or adult target (topicSettingsAccess.test.ts).
        if (key.key.startsWith("topics.") && band !== "child") continue;
        if (key.control?.[band] === "guardian") {
          const guardianResult = setValue(owner, `person:${person.id}`, key.key, value);
          expect(guardianResult.ok, `${key.key} ${band} guardian write`).toBe(true);
        }
      }

      const expectedDefaults = {
        child: key.key === "media.allowlist_only" ? true : key.key === "search.safe_search" ? resolveSafeSearchLevel("default", "child")
          : key.key === "chat.photo_uploads" || key.key === "reference.images" || key.key === "person.robot.may_address" || key.key === "person.robot.follow_up" ? false : key.key.startsWith("news.") || key.key === "ui.home_layout" ? key.band_default?.child
          : key.key === "search.page_text_cleaning" ? true : key.default,
        teen: key.key === "search.safe_search" ? resolveSafeSearchLevel("default", "teen")
          : key.key === "search.page_text_cleaning" ? true : key.default,
        adult: key.key === "search.safe_search" ? resolveSafeSearchLevel("default", "adult") : key.default,
      };
      // Ease of use is comfort, not protection: only the preset and reading level differ for a child (EASE-OF-USE-01).
      const coding = CODING_PERSON_BAND_DEFAULTS[key.key];
      if (key.key.startsWith("coding.person.")) {
        expect(coding, `${key.key} has an expected band default`).toBeDefined();
        expectedDefaults.child = coding!.child as never;
        expectedDefaults.teen = coding!.teen as never;
        if ("adult" in coding!) expectedDefaults.adult = coding!.adult as never;
      }
      if (key.key === "ease.preset") expectedDefaults.child = "simple";
      if (key.key === "ease.reading_level") expectedDefaults.child = "plain";
      expect(key.band_default, `${key.key} band default`).toEqual(expectedDefaults);
    }

    expect(resolveSafeSearchLevel("default", "child")).toBe("strict");
    expect(resolveSafeSearchLevel("default", "teen")).toBe("moderate");
    expect(resolveSafeSearchLevel("default", "adult")).toBe("off");
    expect(minorVisibleSettingKeys("child")?.has("chat.photo_uploads")).toBe(false);
    expect(minorVisibleSettingKeys("teen")?.has("chat.photo_uploads")).toBe(true);
  });
});

describe("called relationship words in setting descriptions", () => {
  test("a child and teen can use only their own visible live called edge, adults do not", async () => {
    const { ownerClient, owner, child, teen, adult, ownerEntity, childEntity, teenEntity } = await makeHousehold();
    const createCalledEdge = async (toEntity: string, called: string, personId: string, type: "parent_of" | "guardian_of") => {
      const response = await ownerClient.post("/api/relationships", {
        type, from_id: ownerEntity, to_id: toEntity, called, scope: "person", person: personId,
      });
      expect(response.status).toBe(201);
    };
    await createCalledEdge(childEntity, "Dad", child.id, "parent_of");
    await createCalledEdge(teenEntity, "Mom", teen.id, "guardian_of");

    expect(calledAdminForOwnSettings(child)).toBe("Dad");
    expect(calledAdminForOwnSettings(teen)).toBe("Mom");
    expect(calledAdminForOwnSettings(adult)).toBeUndefined();

    const childClient = new TestClient();
    await childClient.post("/api/auth/select", { personId: child.id });
    const childResponse = await childClient.get(`/api/settings?scope=person:${child.id}`);
    const childSettings = await childResponse.json() as Array<{ key: string; value: unknown; state?: string; reason?: string }>;
    const childPhoto = childSettings.find((setting) => setting.key === "chat.photo_uploads");
    expect(childPhoto).toMatchObject({ value: false, state: "Off", reason: "Off until Dad turns it on." });

    const guardianPhoto = (await (await ownerClient.get(`/api/settings?scope=person:${child.id}`)).json() as Array<{ key: string; reason?: string }>)
      .find((setting) => setting.key === "chat.photo_uploads");
    expect(guardianPhoto?.reason).toBe("Off for Bramble until you turn it on.");
    expect(guardianPhoto?.reason).not.toContain("Dad");
    expect((await ownerClient.get(`/api/settings?scope=person:${teen.id}`)).status).toBe(403);
  });

  test("sensitive, unconfirmed, ended, deleted, and reader-invisible edges do not supply called", async () => {
    const { ownerClient, owner, child, ownerEntity, childEntity } = await makeHousehold();
    const response = await ownerClient.post("/api/relationships", {
      type: "parent_of", from_id: ownerEntity, to_id: childEntity, called: "Dad", scope: "person", person: child.id,
    });
    expect(response.status).toBe(201);
    const childEdge = db.select().from(relationships).where(and(eq(relationships.type, "child_of"), eq(relationships.toId, ownerEntity))).get()!;

    expect(calledAdminForOwnSettings(child)).toBe("Dad");
    db.update(relationships).set({ sensitive: true }).where(eq(relationships.id, childEdge.id)).run();
    expect(calledAdminForOwnSettings(child)).toBeUndefined();
    db.update(relationships).set({ sensitive: false, source: "inferred", statedByPersonId: null, confidence: 0.9, evidence: '["test"]' })
      .where(eq(relationships.id, childEdge.id)).run();
    expect(calledAdminForOwnSettings(child)).toBeUndefined();
    db.update(relationships).set({ confirmedByPersonId: owner.id, confirmedAt: new Date().toISOString() })
      .where(eq(relationships.id, childEdge.id)).run();
    expect(calledAdminForOwnSettings(child)).toBe("Dad");
    db.update(relationships).set({ validTo: new Date().toISOString() }).where(eq(relationships.id, childEdge.id)).run();
    expect(calledAdminForOwnSettings(child)).toBeUndefined();
    db.update(relationships).set({ validTo: null, person: owner.id }).where(eq(relationships.id, childEdge.id)).run();
    expect(calledAdminForOwnSettings(child)).toBeUndefined();
    db.update(relationships).set({ person: child.id, deletedAt: new Date().toISOString() }).where(eq(relationships.id, childEdge.id)).run();
    expect(calledAdminForOwnSettings(child)).toBeUndefined();
    expect(db.select().from(entities).where(eq(entities.accountPersonId, child.id)).get()).toBeDefined();
  });

  test("teen setting descriptions reveal no state or reason to a guardian or admin", () => {
    const key = getRegistry().find((entry) => entry.key === "chat.photo_uploads")!;
    const privateTeenFixture = {
      setting: key,
      subjectBand: "teen" as const,
      value: false,
      effective: false,
      source: "user" as const,
    };
    for (const viewer of ["guardian", "admin"] as const) {
      expect(describeSetting(privateTeenFixture.setting, {
        subjectBand: privateTeenFixture.subjectBand,
        viewer,
        value: privateTeenFixture.value,
        effective: privateTeenFixture.effective,
        source: privateTeenFixture.source,
        adminName: "Sage",
        personName: "Rill",
      })).toEqual({ does: key.copy?.does ?? key.label });
    }
  });
});
