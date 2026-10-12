// SETTINGS-LAYERS-01d: the People page view of a person's site-block categories.
import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { people } from "@/db/schema";
import { setHouseholdSettingValue } from "@/lib/settings";
import { changeOverrides, hiddenOwnChoice, resetBlocklistRow, siteBlocksView } from "@/lib/settingsLayers";
import type { PersonRow } from "@/types";

let owner: PersonRow;
let willow: PersonRow;

beforeEach(async () => {
  resetDb();
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  await client.post("/api/people", { displayName: "Willow", role: "teen" });
  owner = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
  willow = db.select().from(people).where(eq(people.displayName, "Willow")).get()!;
});

describe("the site-block view", () => {
  test("an admin adds a category for a teen: the label counts it, the row says who set it, and Back to Teen clears it", () => {
    expect(siteBlocksView(owner, willow.id)).toMatchObject({ ok: true, value: { label: "Teen", resetLabel: "Back to Teen" } });
    expect(changeOverrides(owner, willow.id, "search.blocklists", { add: ["blp-drugs"] }).ok).toBe(true);
    const view = siteBlocksView(owner, willow.id);
    if (!view.ok) throw new Error(view.error);
    expect(view.value.label).toBe("Teen + 1 change");
    expect(view.value.mine).toContain("blp-drugs");
    expect(view.value.defaults).not.toContain("blp-drugs");
    expect(view.value.setBy["blp-drugs"]).toBe("Set by Sage");
    expect(resetBlocklistRow(owner, willow.id, "blp-drugs").ok).toBe(true);
    const after = siteBlocksView(owner, willow.id);
    if (!after.ok) throw new Error(after.error);
    expect(after.value.label).toBe("Teen");
    expect(after.value.mine).not.toContain("blp-drugs");
  });

  test("a teen's own extra block never shows on the admin's screen, in the label or in the rows", () => {
    expect(changeOverrides(willow, willow.id, "search.blocklists", { add: ["blp-drugs"] }).ok).toBe(true);
    const view = siteBlocksView(owner, willow.id);
    if (!view.ok) throw new Error(view.error);
    expect(view.value.label).toBe("Teen");
    expect(view.value.mine).not.toContain("blp-drugs");
    expect(JSON.stringify(view.value)).not.toContain("Set by Willow");
  });

  test("a teen cannot read what an admin set, and the locked adult-site row stays ticked and locked", () => {
    expect(changeOverrides(owner, willow.id, "search.blocklists", { add: ["blp-drugs"] }).ok).toBe(true);
    const own = siteBlocksView(willow, willow.id);
    if (!own.ok) throw new Error(own.error);
    expect(own.value.mine).not.toContain("blp-drugs");
    expect(own.value.locked).toContain("blp-porn");
    expect(own.value.mine).toContain("blp-porn");
    expect(changeOverrides(owner, willow.id, "search.blocklists", { remove: ["blp-porn"] }).ok).toBe(false);
  });

  test("a global-defaults change leaves a person's override in place", () => {
    expect(changeOverrides(owner, willow.id, "search.blocklists", { add: ["blp-drugs"] }).ok).toBe(true);
    setHouseholdSettingValue("search.blocklists.teen", ["blp-porn", "blp-scam"]);
    const view = siteBlocksView(owner, willow.id);
    if (!view.ok) throw new Error(view.error);
    expect(view.value.mine).toContain("blp-drugs");
    expect(view.value.defaults).toContain("blp-scam");
  });
});

describe("the site-block write routes keep a teen's choices private", () => {
  test("an admin touching or resetting a category the teen set themself gets a quiet no-op, never a refusal", async () => {
    expect(changeOverrides(willow, willow.id, "search.blocklists", { add: ["blp-drugs"] }).ok).toBe(true);
    expect(hiddenOwnChoice(owner, willow.id, "blp-drugs")).toBe(true);
    expect(hiddenOwnChoice(owner, willow.id, "blp-gambling")).toBe(false);
    const r = resetBlocklistRow(owner, willow.id, "blp-drugs");
    expect(r.ok).toBe(true);
    // the teen's own block is still there
    expect(hiddenOwnChoice(owner, willow.id, "blp-drugs")).toBe(true);
  });

  test("Back to Teen on a row clears an admin entry even when the global defaults now hold the same category", () => {
    expect(changeOverrides(owner, willow.id, "search.blocklists", { add: ["blp-drugs"] }).ok).toBe(true);
    setHouseholdSettingValue("search.blocklists", JSON.stringify(["blp-drugs"]));
    expect(resetBlocklistRow(owner, willow.id, "blp-drugs").ok).toBe(true);
    const after = siteBlocksView(owner, willow.id);
    if (!after.ok) throw new Error(after.error);
    expect(after.value.setBy["blp-drugs"]).toBeUndefined();
    expect(after.value.label).toBe("Teen");
  });
});
