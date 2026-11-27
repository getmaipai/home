// STACK-MODELS-HOME-01: /api/ai/stack/*, the forwarder for the shared AI and models page, the one-time move of Home's old values to the Stack,
// and the cached read the pipeline uses. The Stack is a scripted fetch; every name is a persona or a made-up model id.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people, settingsValues } from "@/db/schema";
import { invalidateSessionCacheForPerson } from "@/middleware/auth";
import { __setChoicesFetchForTests } from "@/lib/stackChoicesForward";
import { __resetChoiceSnapshotForTests, refreshStackChoiceSnapshot } from "@/lib/stackChoiceSnapshot";
import { collectHomeValues, ensureChoicesMigrated, readMigrationRecord } from "@/lib/stackChoicesMigration";
import { getHouseholdSettingValue, setHouseholdSettingValue } from "@/lib/settings";
import { readSlot } from "@/lib/tiers";
import { __resetStackEngineForTests } from "@/lib/stackEngine";
import { __setAdminLinkSeamsForTests, buildAdminLink } from "@/lib/stackAdminLink";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";

let calls: Array<{ method: string; path: string; body: unknown }> = [];
let migrated = false;
let migrateAnswer: Record<string, unknown> = {};
let down = false;
let remoteOn = false;
let pendingOn = false;
let access: Record<string, unknown> | null = null;
let view: Record<string, unknown> = { profile: "p64", memory_gb: 64, categories: [], migration: { done: false } };

beforeEach(() => {
  resetDb(); remoteOn = false; pendingOn = false; access = null; calls = []; migrated = false; down = false; __resetChoiceSnapshotForTests();
  migrateAnswer = { dry_run: false, already_done: false, results: [], accepted: 0, refused: [], done_at: "2026-11-22T10:00:00.000Z" };
  view = { profile: "p64", memory_gb: 64, categories: [], migration: { done: false } };
  __setChoicesFetchForTests((async (input: string | URL | Request, init?: RequestInit) => {
    if (down) throw new Error("refused");
    const url = new URL(String(input)); const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ method, path: url.pathname, body });
    if (url.pathname === "/stack/v1/choices/migrate") { migrated = true; return Response.json(migrateAnswer); }
    if (method === "GET" && url.pathname === "/stack/v1/choices") return Response.json(view);
    if (url.pathname === "/stack/v1/status") return Response.json({ health: "ok", busy: { running: 1, waiting: 0 }, using: [], memory: { total_bytes: 100, free_bytes: 40, budget_bytes: 90, pressure: "normal" }, jobs: [] });
    if (url.pathname === "/stack/v1/memory") return Response.json({ ledger: { reserved_bytes: 10, warm_bytes: 5, budget_bytes: 90, items: [{ id: "chat", class: "reserved", live_bytes: 7 }] } });
    if (url.pathname === "/healthz") return Response.json({ ok: true, version: "0.4.2", contract: 1, uptimeSeconds: 12 });
    if (url.pathname === "/stack/v1/health") return Response.json({ health: [{ code: "disk_low", severity: "warning", title: "Low disk", text: "x", since: "2026-11-27T00:00:00Z", cause: "x" }] });
    if (url.pathname === "/stack/v1/licences") return Response.json({ terms_version: "2026-11-25", accepted: method === "POST", accepted_at: method === "POST" ? "now" : null, by: body?.by ?? null, licences: [] });
    if (method === "GET" && url.pathname === "/stack/v1/admin-access") return access ? Response.json(access) : Response.json({ error: "Not found" }, { status: 404 });
    if (method === "PUT" && url.pathname === "/stack/v1/settings") { pendingOn = body?.["stack.admin.tailscale"] === true; if (access) access = { tailscale: { state: "restart_pending", url: null, address: "100.64.0.9", port: 8770, message: "The setting is on and takes effect when the Stack restarts." } }; return Response.json({ sections: [], settings: [] }); }
    if (method === "GET" && url.pathname === "/stack/v1/settings") return Response.json({ sections: [], settings: [{ key: "stack.admin.tailscale", in_effect: remoteOn, pending: pendingOn ? true : null }] });
    if (method === "GET" && url.pathname === "/stack/v1/resources/summary") return Response.json({ sampled_at: "2026-11-27T10:00:00Z", current: { total: 1000, used: 400, avail: 600, pressure: 0 } });
    if (method === "GET" && url.pathname === "/stack/v1/resources/engines") return Response.json({ sampled_at: null, budget: { total_bytes: 1000, cap_bytes: 900, loaded_bytes: 70 }, engines: [{ role: "chat", label: "Chat", state: "running", model_id: "nova-8b", memory_bytes: 70 }] });
    if (method === "GET" && url.pathname === "/stack/v1/components") return Response.json({ components: [{ id: "nova-8b", label: "Nova 8B", kind: "model" }] });
    if (url.pathname.endsWith("/chat/standard") && method === "PUT") return Response.json({ error: "That model does not fit this computer. Pick a smaller one.", code: "does_not_fit" }, { status: 409 });
    if (method === "PUT" && url.pathname.startsWith("/stack/v1/choices/")) return Response.json({ ok: true, ...(body ?? {}) });
    if (method === "POST" && url.pathname.endsWith("/install")) return Response.json({ job: "job-1", part: "nova-8b", joined: false }, { status: 202 });
    return Response.json({ ok: true });
  }) as never);
});
afterEach(() => { __setAdminLinkSeamsForTests(null); __resetStackEngineForTests(); __setChoicesFetchForTests(null); __resetChoiceSnapshotForTests(); });

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


describe("Stack licence proxy", () => {
  test("GET and POST forward to the Stack without storing a Home acceptance", async () => {
    const { client, actor } = await admin();
    const read = await client.get("/api/ai/stack/licences");
    expect(read.status).toBe(200);
    expect((await read.json() as { terms_version: string }).terms_version).toBe("2026-11-25");
    const accepted = await client.post("/api/ai/stack/licences", {});
    expect(accepted.status).toBe(200);
    expect(calls.filter((call) => call.path === "/stack/v1/licences")).toEqual([
      { method: "GET", path: "/stack/v1/licences", body: undefined },
      { method: "POST", path: "/stack/v1/licences", body: { by: actor.id } },
    ]);
    expect(db.select().from(settingsValues).all().some((row) => row.key === "_licences.accepted")).toBe(false);
  });

  test("a non-admin POST is refused and does not reach the Stack", async () => {
    const { client, actor } = await admin();
    demote(actor.id, "adult");
    const before = calls.length;
    expect((await client.post("/api/ai/stack/licences", {})).status).toBe(403);
    expect(calls).toHaveLength(before);
  });
});

describe("the one-time move of Home's old values", () => {
  test("sends the stored slots, orders, switches and nothing else, once, and records the result", async () => {
    const { client } = await admin();
    setHouseholdSettingValue("engines.pictures.tier.standard", { model: "atlas-fast", options: {} });
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
    expect(getHouseholdSettingValue("engines.pictures.tier.standard")).toMatchObject({ model: "atlas-fast" });
  });

  test("a value the Stack refuses stays in Home and shows as a notice until the admin dismisses it", async () => {
    const { client } = await admin();
    setHouseholdSettingValue("engines.pictures.tier.max", { model: "gone-model", options: {} });
    migrateAnswer = { ...migrateAnswer, accepted: 0, refused: [{ kind: "slot", key: "image.max", status: "refused", reason: "gone-model is not a picture model the Stack knows." }] };
    const view1 = await (await client.get("/api/ai/stack/migration")).json() as { done: boolean; refused: Array<{ key: string; reason: string }>; dismissed: boolean };
    expect(view1).toMatchObject({ done: true, dismissed: false, refused: [{ key: "image.max", reason: expect.stringContaining("gone-model") }] });
    expect(getHouseholdSettingValue("engines.pictures.tier.max")).toMatchObject({ model: "gone-model" });
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
    setHouseholdSettingValue("engines.pictures.tier.boost", { model: "old-pick", options: {} });
    expect(readSlot("pictures", "boost").model).toBe("old-pick");
    view = { categories: [{ id: "pictures", role: "image", tiers: [level("standard", "recommended", "atlas-fast"), level("boost", "household", "atlas-xl"), level("max", "off", null), level("reduced", "none", null)] }, { id: "chat", tiers: [level("reduced", "recommended", "nova-3b")] }] };
    await refreshStackChoiceSnapshot();
    expect(readSlot("pictures", "boost").model).toBe("atlas-xl");
    expect(readSlot("pictures", "max").model).toBe("off");
    expect(readSlot("pictures", "standard").model).toBe("recommended");
    expect(readSlot("chat", "reduced").model).toBe("off");
  });
  test("an unreachable Stack puts Home's stored value back in charge", async () => {
    view = { categories: [{ id: "pictures", role: "image", tiers: [{ tier: "max", chosen: null, chosen_by: "off" }] }] };
    await refreshStackChoiceSnapshot();
    expect(readSlot("pictures", "max").model).toBe("off");
    down = true;
    await refreshStackChoiceSnapshot();
    expect(readSlot("pictures", "max").model).toBe("recommended");
  });
});

describe("the link to the Stack's own admin page", () => {
  const listening = { state: "listening" as const, url: "http://100.64.0.9:8770/admin/", message: null };
  const base = { port: 8770, onThisComputer: true, access: { state: "off" as const, url: null, message: "Turn on it." } };
  test("buildAdminLink: the local link when the Stack runs here; the remote link only while the Stack says it listens on the tailnet; plain reasons otherwise", () => {
    expect(buildAdminLink(base)).toMatchObject({ local_url: "http://127.0.0.1:8770/admin/", remote_url: null, remote_state: "off", can_turn_on: true, reason: "Turn on it." });
    expect(buildAdminLink({ ...base, access: listening })).toMatchObject({ remote_url: "http://100.64.0.9:8770/admin/", reason: null, can_turn_on: false });
    const pending = buildAdminLink({ ...base, access: { state: "restart_pending", url: null, message: "Restart the Stack." } });
    expect(pending).toMatchObject({ remote_url: null, remote_state: "restart_pending", can_turn_on: false, reason: "Restart the Stack." });
    expect(buildAdminLink({ ...base, access: { state: "no_address", url: null, message: "No Tailscale address." } }).can_turn_on).toBe(false);
    // The Stack on another computer reports its own tailnet address, so the link still works; only the loopback link is gone.
    expect(buildAdminLink({ ...base, onThisComputer: false, access: listening })).toMatchObject({ local_url: null, remote_url: "http://100.64.0.9:8770/admin/" });
    expect(buildAdminLink({ ...base, access: null })).toMatchObject({ remote_state: "unknown", can_turn_on: false });
    expect(buildAdminLink({ ...base, access: null }).reason).toContain("Check that the Stack is running");
  });
  test("the page never tells people it opens only on the computer that runs it", () => {
    const words = [buildAdminLink(base).reason, buildAdminLink({ ...base, access: null }).reason, buildAdminLink({ ...base, onThisComputer: false }).reason].join(" ");
    expect(words).not.toMatch(/only on the computer|same computer/i);
  });
  test("the route is for owners and admins only and answers the Stack's own report: listening gives the tailnet link", async () => {
    access = { tailscale: { state: "listening", url: "http://100.64.0.9:8770/admin/", address: "100.64.0.9", port: 8770, message: "ok" } };
    const { client, actor } = await admin();
    const res = await client.get("/api/ai/stack/admin-link");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ local_url: "http://127.0.0.1:8770/admin/", remote_url: "http://100.64.0.9:8770/admin/", remote_state: "listening", reason: null });
    demote(actor.id, "adult");
    expect((await client.get("/api/ai/stack/admin-link")).status).toBe(403);
  });
  test("a Stack that reports the setting on but not listening yet says restart pending, with no link", async () => {
    access = { tailscale: { state: "restart_pending", url: null, address: "100.64.0.9", port: 8770, message: "The setting is on and takes effect when the Stack restarts." } };
    const { client } = await admin();
    expect(await (await client.get("/api/ai/stack/admin-link")).json()).toMatchObject({ remote_url: null, remote_state: "restart_pending", reason: expect.stringContaining("restarts") });
  });
  test("an older Stack with no admin-access route is read from its settings: pending becomes restart pending, off offers the switch", async () => {
    const { client } = await admin();
    expect(await (await client.get("/api/ai/stack/admin-link")).json()).toMatchObject({ remote_state: "off", can_turn_on: true });
    pendingOn = true;
    expect(await (await client.get("/api/ai/stack/admin-link")).json()).toMatchObject({ remote_state: "restart_pending", can_turn_on: false, remote_url: null });
  });
  test("an older Stack with the setting in effect is offered only when its tailnet address really answers", async () => {
    remoteOn = true;
    __setAdminLinkSeamsForTests({ address: async () => "100.64.0.9", probe: async () => false });
    const { client } = await admin();
    expect(await (await client.get("/api/ai/stack/admin-link")).json()).toMatchObject({ remote_state: "restart_pending", remote_url: null, reason: expect.stringContaining("not listening on your tailnet yet") });
    __setAdminLinkSeamsForTests({ address: async () => "100.64.0.9", probe: async (url) => url === "http://100.64.0.9:8770/admin/" });
    expect(await (await client.get("/api/ai/stack/admin-link")).json()).toMatchObject({ remote_state: "listening", remote_url: "http://100.64.0.9:8770/admin/", reason: null });
    __setAdminLinkSeamsForTests({ address: async () => null });
    expect(await (await client.get("/api/ai/stack/admin-link")).json()).toMatchObject({ remote_state: "no_address", remote_url: null });
  });
  test("turn-on sends the one setting to the Stack and answers the new state; an adult who is not an admin is refused", async () => {
    access = { tailscale: { state: "off", url: null, address: "100.64.0.9", port: 8770, message: "Turn on." } };
    const { client, actor } = await admin();
    const res = await client.post("/api/ai/stack/admin-link/turn-on", {});
    expect(res.status).toBe(200);
    expect(writes().at(-1)).toEqual({ method: "PUT", path: "/stack/v1/settings", body: { "stack.admin.tailscale": true } });
    expect(await res.json()).toMatchObject({ remote_state: "restart_pending", can_turn_on: false });
    demote(actor.id, "adult");
    expect((await client.post("/api/ai/stack/admin-link/turn-on", {})).status).toBe(403);
  });
});

describe("the colored memory breakdown reads the Stack's own numbers", () => {
  test("resources summary, engines and components pass through unchanged for an admin and are refused otherwise", async () => {
    const { client, actor } = await admin();
    expect(await (await client.get("/api/ai/stack/resources/summary")).json()).toMatchObject({ current: { total: 1000, used: 400 } });
    expect(await (await client.get("/api/ai/stack/resources/engines")).json()).toMatchObject({ budget: { cap_bytes: 900 }, engines: [{ role: "chat", memory_bytes: 70 }] });
    expect(await (await client.get("/api/ai/stack/components")).json()).toMatchObject({ components: [{ id: "nova-8b" }] });
    demote(actor.id, "adult");
    expect((await client.get("/api/ai/stack/resources/summary")).status).toBe(403);
  });
});

describe("the General tab's read (STACK-MENU-SYNC-01)", () => {
  test("an admin gets where it runs, the version and the problem count, all read from the Stack", async () => {
    const { client } = await admin();
    const res = await client.get("/api/ai/stack/general");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ where: "this_computer", reachable: true, version: "0.4.2", problems: 1, reason: null });
  });
  test("a Stack that does not answer is a plain answer with its sentence, never an error", async () => {
    const { client } = await admin();
    down = true;
    const res = await client.get("/api/ai/stack/general");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ reachable: false, version: null, problems: null, reason: expect.stringContaining("engine") });
  });
  test("signed out, a guest-level adult, a teen and a child get a refusal and nothing reaches the Stack", async () => {
    const { client, actor } = await admin();
    expect((await new TestClient().get("/api/ai/stack/general")).status).toBe(401);
    for (const role of ["adult", "teen", "child"] as const) { demote(actor.id, role); expect((await client.get("/api/ai/stack/general")).status).toBe(403); }
    expect(calls).toEqual([]);
  });
});

describe("live use of the Stack's computer (General tab)", () => {
  test("an admin reads the Stack's status and memory ledger unchanged; anyone else is refused and nothing reaches the Stack", async () => {
    const { client, actor } = await admin();
    expect(await (await client.get("/api/ai/stack/status")).json()).toMatchObject({ busy: { running: 1 }, memory: { budget_bytes: 90 } });
    expect(await (await client.get("/api/ai/stack/memory")).json()).toMatchObject({ ledger: { items: [{ id: "chat" }] } });
    calls = [];
    demote(actor.id, "adult");
    expect((await client.get("/api/ai/stack/status")).status).toBe(403);
    expect((await client.get("/api/ai/stack/memory")).status).toBe(403);
    expect(calls).toEqual([]);
  });
});

describe("drives", () => {
  test("an admin reads drives, feature locations and moves; a dry run is a read; a real move is audited and reaches the Stack", async () => {
    const { client } = await admin();
    expect((await client.get("/api/ai/stack/disks")).status).toBe(200);
    expect((await client.get("/api/ai/stack/disks/features")).status).toBe(200);
    expect((await client.get("/api/ai/stack/disks/moves")).status).toBe(200);
    await client.post("/api/ai/stack/disks/moves", { feature_id: "coding", to_disk_id: "usb", dry_run: true });
    await client.post("/api/ai/stack/disks/moves", { feature_id: "coding", to_disk_id: "usb" });
    await client.post("/api/ai/stack/disks/moves/cancel", {});
    expect(calls.filter((call) => call.path.startsWith("/stack/v1/disks")).map((call) => `${call.method} ${call.path}${(call.body as { dry_run?: boolean } | undefined)?.dry_run ? " dry" : ""}`)).toEqual([
      "GET /stack/v1/disks", "GET /stack/v1/disks/features", "GET /stack/v1/disks/moves", "POST /stack/v1/disks/moves dry", "POST /stack/v1/disks/moves", "POST /stack/v1/disks/moves/cancel"]);
  });
  test("a plain adult is refused and nothing reaches the Stack", async () => {
    const { client, actor } = await admin(); demote(actor.id, "adult");
    expect((await client.post("/api/ai/stack/disks/moves", { feature_id: "coding", to_disk_id: "usb" })).status).toBe(403);
    expect((await client.get("/api/ai/stack/disks")).status).toBe(403);
    expect(calls.filter((call) => call.path.startsWith("/stack/v1/disks"))).toEqual([]);
  });
  test("adding and removing a drive reach the Stack and are audited; a plain adult is refused", async () => {
    const { client, actor } = await admin();
    expect((await client.post("/api/ai/stack/disks", { label: "Spare", root_path: "/Volumes/Spare", removable: true })).status).toBe(200);
    expect((await client.delete("/api/ai/stack/disks/spare")).status).toBe(200);
    expect(calls.filter((call) => call.path.startsWith("/stack/v1/disks")).map((call) => `${call.method} ${call.path}`)).toEqual(["POST /stack/v1/disks", "DELETE /stack/v1/disks/spare"]);
    calls = []; demote(actor.id, "adult");
    expect((await client.post("/api/ai/stack/disks", { label: "X", root_path: "/x", removable: false })).status).toBe(403);
    expect(calls).toEqual([]);
  });
});
