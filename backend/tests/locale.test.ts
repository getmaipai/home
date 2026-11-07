import { describe, expect, test } from "bun:test";
import { isSafeAutoTranslation, resolveLocaleFromValues } from "@/lib/locale";

describe("locale resolver", () => {
  test("uses person row then household then en-US, ignoring junk and household sentinel", () => {
    expect(resolveLocaleFromValues("es", "en-GB")).toBe("es");
    expect(resolveLocaleFromValues(undefined, "en-GB")).toBe("en-GB");
    expect(resolveLocaleFromValues("fr-FR", "es")).toBe("es");
    expect(resolveLocaleFromValues("household", "es")).toBe("es");
    expect(resolveLocaleFromValues("bad", "bad")).toBe("en-US");
  });
  test("automatic translation excludes protected content", () => {
    expect(isSafeAutoTranslation("apps/home/Home.tsx", "Welcome home")).toBe(true);
    for (const id of ["child greeting", "teen copy", "crisis support", "consent", "refusal", "spoken clip", "robot line", "SEARCH-DOWN-EMPTY-01"]) expect(isSafeAutoTranslation("src/page.tsx", id)).toBe(false);
  });
});

import { beforeEach } from "bun:test";
import { eq } from "drizzle-orm";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { people, settingsValues } from "@/db/schema";
import { resolveLocale, householdLocale } from "@/lib/locale";
import { __resetSettingsCacheForTests } from "@/lib/settings";
import { DEFAULT_PERSONA } from "@/lib/persona";
import { buildStablePrefix } from "@/lib/turnShared";

async function owner() {
  const client = new TestClient();
  const res = await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const { person } = (await res.json()) as { person: { id: string } };
  const row = db.select().from(people).where(eq(people.id, person.id)).get()!;
  return { client, row };
}

describe("resolveLocale against the database", () => {
  beforeEach(() => { resetDb(); });

  test("no household row: en-US for everyone, and for no person", async () => {
    const { row } = await owner();
    expect(resolveLocale(null)).toBe("en-US");
    expect(resolveLocale(row)).toBe("en-US");
    expect(householdLocale()).toBe("en-US");
  });

  test("no person row: follows the household value", async () => {
    const { client, row } = await owner();
    const res = await client.request("/api/settings", { method: "PUT", body: { scope: "household", key: "household.locale", value: "en-GB" } });
    expect(res.status).toBe(200);
    expect(resolveLocale(row)).toBe("en-GB");
    expect(resolveLocale(null)).toBe("en-GB");
  });

  test("a person row wins, and the household sentinel means follow the household", async () => {
    const { client, row } = await owner();
    await client.request("/api/settings", { method: "PUT", body: { scope: "household", key: "household.locale", value: "en-GB" } });
    const put = await client.request("/api/settings", { method: "PUT", body: { scope: `person:${row.id}`, key: "person.locale", value: "es" } });
    expect(put.status).toBe(200);
    expect(resolveLocale(row)).toBe("es");
    await client.request("/api/settings", { method: "PUT", body: { scope: `person:${row.id}`, key: "person.locale", value: "household" } });
    expect(resolveLocale(row)).toBe("en-GB");
  });

  test("a junk stored value falls back to the household, and junk everywhere to en-US", async () => {
    const { row } = await owner();
    const now = new Date().toISOString();
    db.insert(settingsValues).values({ scope: `person:${row.id}`, key: "person.locale", value: JSON.stringify("klingon"), hlc: "0", source: "test", updatedAt: now }).run();
    __resetSettingsCacheForTests();
    expect(resolveLocale(row)).toBe("en-US");
  });

  test("GET /api/auth/locale is public and returns only the household value", async () => {
    const { client } = await owner();
    await client.request("/api/settings", { method: "PUT", body: { scope: "household", key: "household.locale", value: "en-GB" } });
    const anonymous = new TestClient();
    const res = await anonymous.get("/api/auth/locale");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ locale: "en-GB" });
  });

  test("no language line: the stable prefix for an es adult equals en-US", async () => {
    const { client, row } = await owner();
    const before = buildStablePrefix(DEFAULT_PERSONA, "written");
    await client.request("/api/settings", { method: "PUT", body: { scope: `person:${row.id}`, key: "person.locale", value: "es" } });
    expect(resolveLocale(row)).toBe("es");
    const after = buildStablePrefix(DEFAULT_PERSONA, "written");
    expect(after).toBe(before);
    expect(after).toBe("You are MaiPai, a private, self-hosted AI assistant for this household. Nothing you say leaves this house. You cannot tell who a person in a photo is.");
    expect(buildStablePrefix(DEFAULT_PERSONA, "spoken")).not.toMatch(/Spanish|español|language is/i);
  });
});
