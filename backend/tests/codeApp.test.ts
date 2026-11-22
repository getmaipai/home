// CODE-APP-01 and CODE-TIER-04: the bundled Code app package, who sees it, and the tiers a person may run.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import UI_SCHEMA from "@maipai/spec/ui/schema.json" with { type: "json" };
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people } from "@/db/schema";
import { PACKAGES_DIR } from "@/lib/paths";
import { appPackageProblems, appVisibleTo } from "@/lib/apps";
import { loadManifestOnly, __resetPackageCachesForTests } from "@/lib/plugins";
import { setHouseholdSettingValue } from "@/lib/settings";
import { invalidateSessionCacheForPerson } from "@/middleware/auth";
import { TestClient } from "./client";
import { startRig, input, person } from "./codingRig";
import type { PersonRow } from "@/types";

let rig: ReturnType<typeof startRig>; let client: TestClient; let actor: PersonRow;
beforeEach(async () => {
  rig = startRig(); client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  actor = db.select().from(people).where(eq(people.displayName, "Sage")).get() as PersonRow;
});
afterEach(() => { rig.restore(); __resetPackageCachesForTests(); });

const manifest = () => { const loaded = loadManifestOnly("code"); if (!loaded.ok) throw new Error("code package did not load"); return loaded.value; };

describe("the Code package", () => {
  test("is a valid bundled app whose page validates", () => {
    const m = manifest();
    expect(appPackageProblems(m, join(PACKAGES_DIR, "code"))).toEqual([]);
    expect((m.routing?.examples ?? []).length).toBeGreaterThanOrEqual(5);
    expect(new Ajv2020({ strict: false }).validate(UI_SCHEMA as object, JSON.parse(readFileSync(join(PACKAGES_DIR, "code", "pages", "index.json"), "utf8")))).toBe(true);
  });
  test("an owner sees it while Coding is on, and nobody sees it while Coding is off, paused or missing a piece", () => {
    expect(appVisibleTo(actor, manifest())).toBe(true);
    setHouseholdSettingValue("coding.paused", true);
    expect(appVisibleTo(actor, manifest())).toBe(false);
    setHouseholdSettingValue("coding.paused", false);
    setHouseholdSettingValue("coding.enabled", false);
    expect(appVisibleTo(actor, manifest())).toBe(false);
  });
  test("a teen with an admin grant sees it, and a teen without one does not", async () => {
    const { createGrant } = await import("@/lib/grants");
    const withGrant = person("teen"); const without = person("teen");
    expect(createGrant({ id: actor.id, role: "owner" }, { person: withGrant.id, action: "use:code", effect: "allow" }).ok).toBe(true);
    expect(appVisibleTo(withGrant, manifest())).toBe(true);
    expect(appVisibleTo(without, manifest())).toBe(false);
  });
  test("a person without the use:code pass does not see it", () => {
    setHouseholdSettingValue("coding.adults_by_default", false);
    expect(appVisibleTo(person("teen"), manifest())).toBe(false);
  });
});

describe("GET /api/code/sessions/tiers", () => {
  test("an owner is offered Standard and Max (Boost needs its own grant), and a new session starts on the last tier used", async () => {
    const first = await (await client.get("/api/code/sessions/tiers")).json() as { tiers: string[]; last: string };
    expect(first).toEqual({ tiers: ["standard", "max"], last: "standard" });
    await client.post("/api/code/sessions", input({ tier: "max" }));
    expect(((await (await client.get("/api/code/sessions/tiers")).json()) as { last: string }).last).toBe("max");
  });
  test("a tier the person may not run is absent, never listed", async () => {
    db.update(people).set({ role: "adult" }).where(eq(people.id, actor.id)).run(); invalidateSessionCacheForPerson(actor.id);
    const res = await (await client.get("/api/code/sessions/tiers")).json() as { tiers: string[] };
    expect(res.tiers).not.toContain("max");
    expect(res.tiers).toContain("standard");
  });
  test("a tier whose slot is switched off is absent", async () => {
    setHouseholdSettingValue("engines.coding.tier.max", { model: "off", options: {} });
    expect(((await (await client.get("/api/code/sessions/tiers")).json()) as { tiers: string[] }).tiers).toEqual(["standard"]);
  });
  test("Coding off gives the household's copy", async () => {
    setHouseholdSettingValue("coding.enabled", false);
    const res = await client.get("/api/code/sessions/tiers");
    expect(res.status).toBe(403);
  });
  test("signed out is refused", async () => {
    expect((await new TestClient().get("/api/code/sessions/tiers")).status).toBe(401);
  });
});
