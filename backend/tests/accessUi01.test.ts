import { NOT_AVAILABLE_HERE } from "@/lib/notAvailable";
// ACCESS-UI-01 (RULES.md C7, C10): GET /api/people/:id/features, the admin's list of one person's feature access.
import { beforeEach, describe, expect, test } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { setHouseholdSettingValue } from "@/lib/settings";

beforeEach(() => { resetDb(); setHouseholdSettingValue("coding.adults_by_default", true); });

type Row = { id: string; title: string; min_role: string; role_allows: boolean; effective: boolean; grant: null | { id: string; effect: string }; allow_for_minors?: true };
const DOCUMENTED = ["allow_for_minors", "effective", "grant", "id", "min_role", "role_allows", "title"];

async function setup() {
  const owner = new TestClient();
  expect((await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" })).status).toBe(201);
  const make = async (name: string, role: string) => {
    const res = await owner.post("/api/people", { displayName: name, role, ...(role === "adult" || role === "admin" ? { secret: "0000" } : {}) });
    const { id } = (await res.json()) as { id: string };
    const client = new TestClient();
    if (role === "adult" || role === "admin") await client.post("/api/auth/verify-secret", { personId: id, secret: "0000" });
    else await client.post("/api/auth/select", { personId: id });
    return { id, client };
  };
  return { owner, adult: await make("Willow", "adult"), teen: await make("Marlow", "teen"), child: await make("Nova", "child") };
}
const features = async (c: TestClient, id: string) => ((await (await c.get(`/api/people/${id}/features`)).json()) as { features: Row[] }).features;
const row = (rows: Row[], id: string) => rows.find((r) => r.id === id)!;

describe("the route's shape", () => {
  test("an adult: packages by role, Coding by the household default, nothing but the documented keys", async () => {
    const { owner, adult } = await setup();
    const rows = await features(owner, adult.id);
    expect(rows.length).toBeGreaterThan(1);
    expect(rows[0]).toMatchObject({ id: "code", title: "Coding", min_role: "adult", role_allows: true, effective: true, grant: null, allow_for_minors: true });
    for (const r of rows) {
      expect(Object.keys(r).every((k) => DOCUMENTED.includes(k))).toBe(true);
      if (r.id !== "code") { expect(r.allow_for_minors).toBeUndefined(); expect(r.effective).toBe(r.role_allows); expect(r.grant).toBeNull(); }
    }
    expect(Object.keys((await (await owner.get(`/api/people/${adult.id}/features`)).json()) as object)).toEqual(["features"]);
  });
  test("a child: Coding is not by role and shows the minor option; a package above the child's role is not effective", async () => {
    const { owner, child } = await setup();
    const rows = await features(owner, child.id);
    expect(row(rows, "code")).toMatchObject({ role_allows: false, effective: false, grant: null, allow_for_minors: true });
    expect(rows.some((r) => r.id !== "code" && !r.role_allows && !r.effective)).toBe(true);
  });
  test("a guest has no Coding row", async () => {
    const { owner } = await setup();
    const res = await owner.post("/api/people", { displayName: "Visitor", role: "guest", controls: "teen", guestExpiresAt: new Date(Date.now() + 86_400_000).toISOString() });
    const { id } = (await res.json()) as { id: string };
    expect((await features(owner, id)).some((r) => r.id === "code")).toBe(false);
  });
  test("an unknown person is a 404 with a plain sentence", async () => {
    const { owner } = await setup();
    const res = await owner.get("/api/people/person-nobody/features");
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toContain("Refresh");
  });
});

describe("who may read it", () => {
  test("an adult holding people.grant but no admin role, and the person themself, get 403", async () => {
    const { owner, adult, teen } = await setup();
    expect((await owner.post("/api/grants", { person: adult.id, action: "people.grant", effect: "allow" })).status).toBe(201);
    expect((await adult.client.get(`/api/people/${teen.id}/features`)).status).toBe(403);
    expect((await adult.client.get(`/api/people/${adult.id}/features`)).status).toBe(403);
    expect((await teen.client.get(`/api/people/${teen.id}/features`)).status).toBe(403);
  });
  test("an owner reads their own row, and an admin reads another's", async () => {
    const { owner, adult } = await setup();
    const me = (await (await owner.get("/api/auth/me")).json()) as { id: string };
    expect((await owner.get(`/api/people/${me.id}/features`)).status).toBe(200);
    const res = await owner.post("/api/people", { displayName: "Atlas", role: "admin", secret: "0000" });
    const { id } = (await res.json()) as { id: string };
    const admin = new TestClient(); await admin.post("/api/auth/verify-secret", { personId: id, secret: "0000" });
    expect((await admin.get(`/api/people/${adult.id}/features`)).status).toBe(200);
  });
});

describe("a write shows in the next read", () => {
  test("a deny flips effective, a revoke flips it back", async () => {
    const { owner, adult } = await setup();
    const some = row(await features(owner, adult.id), "weather");
    expect(some.effective).toBe(true);
    const made = await owner.post("/api/grants", { person: adult.id, action: "use:weather", effect: "deny" });
    const g = (await made.json()) as { id: string };
    const denied = row(await features(owner, adult.id), "weather");
    expect(denied).toMatchObject({ effective: false, role_allows: true, grant: { id: g.id, effect: "deny" } });
    expect((await owner.delete(`/api/grants/${g.id}`)).status).toBe(200);
    expect(row(await features(owner, adult.id), "weather")).toMatchObject({ effective: true, grant: null });
  });
  test("Coding: an allow admits a teen, a deny removes it from an adult, back to by role undoes both", async () => {
    const { owner, adult, teen } = await setup();
    const allow = (await (await owner.post("/api/grants", { person: teen.id, action: "use:code", effect: "allow" })).json()) as { id: string };
    expect(row(await features(owner, teen.id), "code")).toMatchObject({ effective: true, role_allows: false, grant: { id: allow.id, effect: "allow" } });
    const deny = (await (await owner.post("/api/grants", { person: adult.id, action: "use:code", effect: "deny" })).json()) as { id: string };
    expect(row(await features(owner, adult.id), "code")).toMatchObject({ effective: false, role_allows: true, grant: { id: deny.id, effect: "deny" } });
    await owner.delete(`/api/grants/${allow.id}`); await owner.delete(`/api/grants/${deny.id}`);
    expect(row(await features(owner, teen.id), "code")).toMatchObject({ effective: false, grant: null });
    expect(row(await features(owner, adult.id), "code")).toMatchObject({ effective: true, grant: null });
  });
  test("an allow for a teen below a package's floor is refused with the API's sentence and the row stays not effective", async () => {
    const { owner, teen } = await setup();
    const above = (await features(owner, teen.id)).find((r) => r.id !== "code" && !r.role_allows)!;
    const res = await owner.post("/api/grants", { person: teen.id, action: `use:${above.id}`, effect: "allow" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe(NOT_AVAILABLE_HERE);
    expect(row(await features(owner, teen.id), above.id)).toMatchObject({ effective: false, grant: null });
  });
});
