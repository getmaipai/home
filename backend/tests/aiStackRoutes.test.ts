// STACK-MODELS-HOME-01: /api/ai/stack/*, the forwarder for the shared AI and models page, the one-time move of Home's old values to the Stack,
// and the cached read the pipeline uses. The Stack is a scripted fetch; every name is a persona or a made-up model id.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people } from "@/db/schema";
import { invalidateSessionCacheForPerson } from "@/middleware/auth";
import { __setChoicesFetchForTests } from "@/lib/stackChoicesForward";
import { __resetChoiceSnapshotForTests, refreshStackChoiceSnapshot } from "@/lib/stackChoiceSnapshot";
import { collectHomeValues, ensureChoicesMigrated, readMigrationRecord } from "@/lib/stackChoicesMigration";
import { getHouseholdSettingValue, setHouseholdSettingValue } from "@/lib/settings";
import { readSlot } from "@/lib/tiers";
import { __resetStackEngineForTests } from "@/lib/stackEngine";
import { buildAdminLink } from "@/lib/stackAdminLink";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";

let calls: Array<{ method: string; path: string; body: unknown }> = [];
let migrated = false;
let migrateAnswer: Record<string, unknown> = {};
let down = false;
let remoteOn = false;
let view: Record<string, unknown> = { profile: "p64", memory_gb: 64, categories: [], migration: { done: false } };

beforeEach(() => {
  resetDb(); remoteOn = false; calls = []; migrated = false; down = false; __resetChoiceSnapshotForTests();
  migrateAnswer = { dry_run: false, already_done: false, results: [], accepted: 0, refused: [], done_at: "2026-11-22T10:00:00.000Z" };
  view = { profile: "p64", memory_gb: 64, categories: [], migration: { done: false } };
  __setChoicesFetchForTests((async (input: string | URL | Request, init?: RequestInit) => {
    if (down) throw new Error("refused");
    const url = new URL(String(input)); const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ method, path: url.pathname, body });
    if (url.pathname === "/stack/v1/choices/migrate") { migrated = true; return Response.json(migrateAnswer); }
    if (method === "GET" && url.pathname === "/stack/v1/choices") return Response.json(view);
    if (method === "GET" && url.pathname === "/stack/v1/settings") return Response.json({ sections: [], settings: [{ key: "stack.admin.tailscale", in_effect: remoteOn }] });
    if (url.pathname.endsWith("/chat/standard") && method === "PUT") return Response.json({ error: "That model does not fit this computer. Pick a smaller one.", code: "does_not_fit" }, { status: 409 });
    if (method === "PUT" && url.pathname.startsWith("/stack/v1/choices/")) return Response.json({ ok: true, ...(body ?? {}) });
    if (method === "POST" && url.pathname.endsWith("/install")) return Response.json({ job: "job-1", part: "nova-8b", joined: false }, { status: 202 });
    return Response.json({ ok: true });
  }) as never);
});
afterEach(() => { __resetStackEngineForTests(); __setChoicesFetchForTests(null); __resetChoiceSnapshotForTests(); });

async function admin() {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  return { client, actor: db.select().from(people).where(eq(people.displayName, "Sage")).get()! };
}
const demote = (id: string, role: "adult" | "teen" | "child") => { db.update(people).set({ role }).where(eq(people.id, id)).run(); invalidateSessionCacheForPerson(id); };
const writes = () => calls.filter((call) => call.method !== "GET" && !call.path.endsWith("/migrate"));

describe("who may ask", () => {
  test("signed out is 401, a plain adult is 403, nothing reaches the Stack", async () => {
    const { client, actor } = await admin();
    expect((await new TestClient().get("/api/ai/stack/choices")).status).toBe(401);
    demote(actor.id, "adult");
    for (const call of [() => client.get("/api/ai/stack/choices"), () => client.put("/api/ai/stack/choices/chat/standard", { model: "nova-8b" }), () => client.post("/api/ai/stack/choices/recommended", {}), () => client.delete("/api/ai/stack/parts/nova-8b"), () => client.put("/api/ai/stack/settings", { "stack.roles.chat.enabled": false })]) expect((await call()).status).toBe(403);
    expect(calls).toEqual([]);
  });
});

describe("forwarding", () => {
  test("a read returns the Stack's answer unchanged; a pick forwards the body and the Stack's sentence comes back with its status", async () => {
    const { client } = await admin();
    expect(await (await client.get("/api/ai/stack/choices")).json()).toEqual(view);
    const pick = await client.put("/api/ai/stack/choices/pictures/boost", { model: "atlas-xl", profile: "p64" });
    expect(pick.status).toBe(200);
    expect(writes().at(-1)).toEqual({ method: "PUT", path: "/stack/v1/choices/pictures/boost", body: { model: "atlas-xl", profile: "p64" } });
    const refused = await client.put("/api/ai/stack/choices/chat/standard", { model: "big" });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: "That model does not fit this computer. Pick a smaller one.", code: "does_not_fit" });
  });

  test("the order, recommended preview, unused, add-model and remove calls map to their Stack routes", async () => {
    const { client } = await admin();
    await client.put("/api/ai/stack/choices/music/order", { order: ["a", "b"], off: ["c"] });
    await client.post("/api/ai/stack/choices/recommended", { dry_run: true });
    await client.get("/api/ai/stack/choices/unused");
    await client.post("/api/ai/stack/choices/unused/remove", { ids: ["a"] });
    await client.post("/api/ai/stack/choices/add-model", { source: "owner/repo" });
    await client.delete("/api/ai/stack/parts/nova-8b");
    expect(calls.filter((call) => !call.path.endsWith("/migrate") && !(call.method === "GET" && call.path === "/stack/v1/choices")).map((call) => `${call.method} ${call.path}`)).toEqual([
      "PUT /stack/v1/choices/music/order", "POST /stack/v1/choices/recommended", "GET /stack/v1/choices/unused", "POST /stack/v1/choices/unused/remove", "POST /stack/v1/choices/add-model", "DELETE /stack/v1/parts/nova-8b",
    ]);
  });

  test("an unreachable engine answers 503 with a plain sentence", async () => {
    const { client } = await admin();
    down = true;
    const res = await client.get("/api/ai/stack/choices");
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toContain("engine");
  });

  test("an install forwards to the Stack's parts route", async () => {
    const { client } = await admin();
    const res = await client.post("/api/ai/stack/parts/nova-8b/install", {});
    expect(res.status).toBe(202);
    expect(writes().at(-1)).toMatchObject({ method: "POST", path: "/stack/v1/parts/nova-8b/install" });
  });

  test("the settings route takes only a feature's on or off and priority; a Home feature switch follows (Chat's is the inverse)", async () => {
    const { client } = await admin();
    expect((await client.put("/api/ai/stack/settings", { "stack.memory.budget_percent": 90 })).status).toBe(400);
    expect((await client.put("/api/ai/stack/settings", { "stack.roles.chat.enabled": "no" })).status).toBe(400);
    expect(calls).toEqual([]);
    expect((await client.put("/api/ai/stack/settings", { "stack.roles.chat.enabled": false, "stack.roles.video.enabled": true, "stack.roles.music.priority": 5 })).status).toBe(200);
    expect(calls[0]).toMatchObject({ method: "PUT", path: "/stack/v1/settings", body: { "stack.roles.chat.enabled": false, "stack.roles.video.enabled": true, "stack.roles.music.priority": 5 } });
    expect(getHouseholdSettingValue("chat.paused")).toBe(true);
    expect(getHouseholdSettingValue("generation.video.enabled")).toBe(true);
  });
});

describe("the one-time move of Home's old values", () => {
  test("sends the stored slots, orders, switches and nothing else, once, and records the result", async () => {
    const { client } = await admin();
    setHouseholdSettingValue("engines.image.tier.standard", { model: "atlas-fast", options: {} });
    setHouseholdSettingValue("engines.video.tier.boost", { model: "off", options: {} });
    setHouseholdSettingValue("engines.pictures.order", ["atlas-xl", "atlas-fast"]);
    setHouseholdSettingValue("chat.paused", true);
    setHouseholdSettingValue("generation.music.enabled", false);
    migrateAnswer = { ...migrateAnswer, accepted: 5 };
    const sent = collectHomeValues().body;
    expect(sent.slots).toEqual(expect.arrayContaining([{ role: "image", tier: "standard", model: "atlas-fast" }, { role: "video", tier: "boost", model: "off" }]));
    expect(sent.slots).toHaveLength(2);
    expect(sent.orders).toEqual([{ category: "pictures", order: ["atlas-xl", "atlas-fast"] }]);
    expect(sent.features).toEqual(expect.arrayContaining([{ role: "chat", enabled: false }, { role: "music", enabled: false }]));
    expect((await client.get("/api/ai/stack/choices")).status).toBe(200);
    expect(calls.filter((call) => call.path.endsWith("/migrate"))).toHaveLength(1);
    expect(readMigrationRecord()).toMatchObject({ accepted: 5, refused: [], dismissed: true });
    await client.get("/api/ai/stack/choices");
    await ensureChoicesMigrated();
    expect(calls.filter((call) => call.path.endsWith("/migrate"))).toHaveLength(1);
    expect(getHouseholdSettingValue("engines.image.tier.standard")).toMatchObject({ model: "atlas-fast" });
  });

  test("a value the Stack refuses stays in Home and shows as a notice until the admin dismisses it", async () => {
    const { client } = await admin();
    setHouseholdSettingValue("engines.image.tier.max", { model: "gone-model", options: {} });
    migrateAnswer = { ...migrateAnswer, accepted: 0, refused: [{ kind: "slot", key: "image.max", status: "refused", reason: "gone-model is not a picture model the Stack knows." }] };
    const view1 = await (await client.get("/api/ai/stack/migration")).json() as { done: boolean; refused: Array<{ key: string; reason: string }>; dismissed: boolean };
    expect(view1).toMatchObject({ done: true, dismissed: false, refused: [{ key: "image.max", reason: expect.stringContaining("gone-model") }] });
    expect(getHouseholdSettingValue("engines.image.tier.max")).toMatchObject({ model: "gone-model" });
    expect(((await (await client.post("/api/ai/stack/migration/dismiss", {})).json()) as { dismissed: boolean }).dismissed).toBe(true);
  });

  test("an unreachable Stack records nothing, so the next try sends again", async () => {
    down = true;
    expect(await ensureChoicesMigrated()).toBeNull();
    expect(readMigrationRecord()).toBeNull();
    down = false;
    expect(await ensureChoicesMigrated()).not.toBeNull();
    expect(migrated).toBe(true);
  });

  test("an old added chat model Home cannot describe fully is kept and reported, never dropped", async () => {
    const { db: database } = { db };
    const { addedModels } = await import("@/db/schema");
    database.insert(addedModels).values({ id: "added-lost", record: JSON.stringify({ id: "added-lost", label: "Lost", origin: "added", license: "mit", download: { url: "https://example.com/x.gguf", sha256: "a".repeat(64), approx_bytes: 10 } }), createdAt: "2026-11-01T00:00:00Z", hlc: "0", provenance: "test" }).run();
    database.insert(addedModels).values({ id: "added-nova", record: JSON.stringify({ id: "added-nova", label: "Nova (q4)", origin: "added", license: "Not stated by the repository", download: { url: "https://huggingface.co/owner/nova-gguf/resolve/abc123/nova-q4.gguf", sha256: "b".repeat(64), approx_bytes: 99 } }), createdAt: "2026-11-01T00:00:00Z", hlc: "0", provenance: "test" }).run();
    const { body, unmappable } = collectHomeValues();
    expect(body.added_models).toEqual([{ id: "added-nova", label: "Nova (q4)", repo: "owner/nova-gguf", file: "nova-q4.gguf", url: "https://huggingface.co/owner/nova-gguf/resolve/abc123/nova-q4.gguf", revision: "abc123", sha256: "b".repeat(64), size_bytes: 99, licence: null }]);
    expect(unmappable).toEqual([{ kind: "added_model", key: "added-lost", reason: expect.stringContaining("Add the model again") }]);
    expect((await database.select().from(addedModels).all()).length).toBe(2);
  });
});

describe("the pipeline's cached read of the Stack's choice", () => {
  const level = (tier: string, chosen_by: string, chosen: string | null) => ({ tier, chosen, chosen_by });
  test("before the move, Home's stored value rules; after it, the Stack's household pick and off state do, and a level nobody chose is the recommended one (Reduced stays off)", async () => {
    setHouseholdSettingValue("engines.image.tier.boost", { model: "old-pick", options: {} });
    expect(readSlot("image", "boost").model).toBe("old-pick");
    view = { categories: [{ id: "pictures", tiers: [level("standard", "recommended", "atlas-fast"), level("boost", "household", "atlas-xl"), level("max", "off", null), level("reduced", "none", null)] }, { id: "chat", tiers: [level("reduced", "recommended", "nova-3b")] }] };
    await refreshStackChoiceSnapshot();
    expect(readSlot("image", "boost").model).toBe("atlas-xl");
    expect(readSlot("image", "max").model).toBe("off");
    expect(readSlot("image", "standard").model).toBe("recommended");
    expect(readSlot("chat", "reduced").model).toBe("off");
  });
  test("an unreachable Stack puts Home's stored value back in charge", async () => {
    view = { categories: [{ id: "pictures", tiers: [{ tier: "max", chosen: null, chosen_by: "off" }] }] };
    await refreshStackChoiceSnapshot();
    expect(readSlot("image", "max").model).toBe("off");
    down = true;
    await refreshStackChoiceSnapshot();
    expect(readSlot("image", "max").model).toBe("recommended");
  });
});

describe("the link to the Stack's own admin page", () => {
  const base = { port: 8770, onThisComputer: true, remoteOn: false, tailscaleAddress: null as string | null };
  test("buildAdminLink: loopback link always; a remote link only when remote access is on and an address exists; plain reasons otherwise", () => {
    expect(buildAdminLink(base)).toMatchObject({ local_url: "http://127.0.0.1:8770/admin/", remote_url: null });
    expect(buildAdminLink(base).reason).toContain("turn on remote access");
    expect(buildAdminLink({ ...base, remoteOn: true, tailscaleAddress: "100.64.0.9" })).toMatchObject({ remote_url: "http://100.64.0.9:8770/admin/" });
    expect(buildAdminLink({ ...base, remoteOn: true }).remote_url).toBeNull();
    expect(buildAdminLink({ ...base, remoteOn: true }).reason).toContain("Tailscale");
    expect(buildAdminLink({ ...base, onThisComputer: false })).toMatchObject({ local_url: null, remote_url: null });
    expect(buildAdminLink({ ...base, onThisComputer: false }).reason).toContain("another computer");
  });
  test("the route is for owners and admins only and answers the local link with the remote flag read from the Stack", async () => {
    const { client, actor } = await admin();
    const res = await client.get("/api/ai/stack/admin-link");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ local_url: "http://127.0.0.1:8770/admin/", remote_url: null });
    demote(actor.id, "adult");
    expect((await client.get("/api/ai/stack/admin-link")).status).toBe(403);
  });
});
