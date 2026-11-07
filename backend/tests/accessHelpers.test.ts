// AUDIT-DUP-ROUTES-01: the role and status helpers that replaced 34 inline spellings and two copied status maps.
import { beforeEach, describe, expect, test } from "bun:test";
import { canMakeCompanion, COMPANION_BAND_LINE, isOwnerOrAdmin } from "@/lib/access";
import { conflictStatus } from "@/lib/result";
import { child, owner } from "./support/testAuth";
import { resetDb } from "./reset-db";

beforeEach(() => resetDb());

describe("access helpers", () => {
  test("isOwnerOrAdmin reads only the role", () => {
    expect(isOwnerOrAdmin({ role: "owner" })).toBe(true);
    expect(isOwnerOrAdmin({ role: "admin" })).toBe(true);
    for (const role of ["adult", "teen", "child", "guest"]) expect(isOwnerOrAdmin({ role })).toBe(false);
  });

  test("a child cannot make a companion, an owner can, and the refusal sentence is the one used by the four routes", async () => {
    const { client, row } = await owner();
    const kid = await child(client);
    expect(canMakeCompanion(row)).toBe(true);
    expect(canMakeCompanion(kid.row)).toBe(false);
    expect(COMPANION_BAND_LINE).toBe("Only teens and adults can make a companion.");
    expect((await kid.client.post("/api/companions/draft", { name: "Pippa" })).status).toBe(403);
    expect(await (await kid.client.post("/api/companions/draft", { name: "Pippa" })).json()).toEqual({ error: COMPANION_BAND_LINE });
  });

  test("conflictStatus passes 403, 404 and 409 through and turns everything else into 400", () => {
    expect([404, 403, 409, 400, 422, 500, undefined].map(conflictStatus)).toEqual([404, 403, 409, 400, 400, 400, 400]);
  });
});
