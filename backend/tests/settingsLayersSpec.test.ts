// SETTINGS-LAYERS-01a: the pinned spec carries the layer declarations Home's resolver reads, and the
// settings table can say who wrote a user override.
import { beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { settingsValues } from "@/db/schema";
import { getRegistryKey } from "@/lib/settingsRegistry";
import { nextHlc } from "@/lib/hlc";
import { eq } from "drizzle-orm";
import { TestClient } from "./client";
import { people } from "@/db/schema";
import { resetValue, setValue } from "@/lib/settings";

beforeEach(() => resetDb());

describe("SETTINGS-LAYERS-01a registry", () => {
  test("the search block keys are layered unions: user defaults, global defaults, user overrides", () => {
    for (const key of ["search.blocklists", "search.hosts.deny", "search.hosts.allow"]) {
      const def = getRegistryKey(key)!;
      expect(def.layers, key).toEqual(["band", "household", "person"]);
      expect(def.merge, key).toBe("union");
      expect(Object.keys(def.user_defaults_keys ?? {}).sort(), key).toEqual(["adult", "child", "teen"]);
    }
  });

  test("SafeSearch and page-text cleaning are overridable user defaults", () => {
    expect(getRegistryKey("search.safe_search")).toMatchObject({ layers: ["band", "household", "person"], merge: "override" });
    const cleaning = getRegistryKey("search.page_text_cleaning")!;
    expect(cleaning.layers).toEqual(["band", "household", "person"]);
    expect(cleaning.band_default).toEqual({ child: true, teen: true, adult: false });
  });
});

describe("SETTINGS-LAYERS-01a storage", () => {
  test("a settings row remembers who set it, and an older row has none", () => {
    const now = new Date().toISOString();
    db.insert(settingsValues).values([
      { scope: "person:p1", key: "search.safe_search", value: '"strict"', hlc: nextHlc(), source: "user", setBy: "admin-1", updatedAt: now },
      { scope: "person:p2", key: "search.safe_search", value: '"off"', hlc: nextHlc(), source: "user", updatedAt: now },
    ]).run();
    expect(db.select().from(settingsValues).where(eq(settingsValues.scope, "person:p1")).get()?.setBy).toBe("admin-1");
    expect(db.select().from(settingsValues).where(eq(settingsValues.scope, "person:p2")).get()?.setBy).toBeNull();
  });
});

describe("SETTINGS-LAYERS-01a page-text check write guard", () => {
  const KEY = "search.page_text_cleaning";
  async function household() {
    const client = new TestClient();
    expect((await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" })).status).toBe(201);
    const add = async (displayName: string, role: string) => {
      expect((await client.post("/api/people", { displayName, role, ...(role === "adult" ? { secret: "0000" } : {}) })).status).toBe(201);
      return db.select().from(people).where(eq(people.displayName, displayName)).get()!;
    };
    return {
      owner: db.select().from(people).where(eq(people.displayName, "Sage")).get()!,
      child: await add("Bramble", "child"),
      teen: await add("Rill", "teen"),
      adult: await add("Marlow", "adult"),
    };
  }

  test("a child or teen never changes or clears their own; an adult changes their own", async () => {
    const { child, teen, adult } = await household();
    for (const minor of [child, teen]) {
      expect(setValue(minor, `person:${minor.id}`, KEY, false).ok).toBe(false);
      expect(resetValue(minor, `person:${minor.id}`, KEY).ok).toBe(false);
    }
    expect(setValue(adult, `person:${adult.id}`, KEY, true).ok).toBe(true);
  });

  test("an owner sets and clears a child's, and cannot be bypassed by a minor clearing the owner's row", async () => {
    const { owner, child, teen, adult } = await household();
    expect(setValue(owner, `person:${child.id}`, KEY, false).ok).toBe(true);
    // the minor cannot lift or reset what the owner set
    expect(resetValue(child, `person:${child.id}`, KEY).ok).toBe(false);
    expect(setValue(child, `person:${child.id}`, KEY, true).ok).toBe(false);
    expect(resetValue(owner, `person:${child.id}`, KEY).ok).toBe(true);
    expect(setValue(owner, `person:${teen.id}`, KEY, true).ok).toBe(true);
    // an owner does not reach another adult's own choice
    expect(setValue(owner, `person:${adult.id}`, KEY, true).ok).toBe(false);
  });
});
