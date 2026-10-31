// CODE-STACK-01 H1: Settings, Coding, "What coding runs on". A fake Stack stands in for the engine; the routes are admin only,
// removal is refused while Coding is on, the Stack's own sentences pass through, progress rides the install strip, a failed
// engine install is a Repairs item, and the key store reads the first missing piece.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people } from "@/db/schema";
import { invalidateSessionCacheForPerson } from "@/middleware/auth";
import { setHouseholdSettingValue } from "@/lib/settings";
import { listIssues } from "@/lib/issues";
import { summarizeBackground } from "@/lib/installStatus";
import { CODING_ON_REFUSAL, __setCodingStackForTests, ensureCodingPiecesFresh, missingCodingPiece, type CodingStack } from "@/lib/stackCodingPieces";
import { StackComponentError, type StackComponent } from "@/lib/stackComponents";
import type { EngineInfo, RoleInfo } from "@/lib/stack/types";
import type { StackJob } from "@maipai/spec/stack/ts/stack-job.js";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";

const MODEL = "coding-model-a";
const DRAFT = "coding-draft-a";
const engine = (over: Partial<EngineInfo>): EngineInfo => ({ id: "splash-1", name: "splash", label: "Splash", platform: "darwin", arch: "arm64", verified: true, installed: false, matchesThisMachine: true, running: null, currentTag: null, newestTag: "1.3.2", current: false, notCurrent: false, needsRestart: false, state: "current", stateReason: null, directory: "/x", roleState: "stopped", roleReason: null, ...over });
const codingRole = (over: Partial<NonNullable<RoleInfo["coding"]>>): RoleInfo => ({ id: "coding", coding: { state: "installed", engine: "splash", engine_requested: "auto", engine_reason: null, ...over } } as never);
const component = (over: Partial<StackComponent>): StackComponent => ({
  id: MODEL, label: "Coding model: Qwen3.8 27B", summary: "The model that writes code.", group: "chat", kind: "model", state: "installed", size_bytes: 20_300_000_000, download_bytes: 20_300_000_000, full_bytes: 20_300_000_000, required_free_bytes: 24_000_000_000,
  plan_need: "recommended", requirement: "optional", requirement_reason: null, last_used_at: null, used_by: ["Coding"], depends_on: [], job: null, percent: null, failure: null,
  can_install: false, install_block: "It is already installed.", can_uninstall: true, uninstall_block: null, ...over,
});
const job = (over: Partial<StackJob>): StackJob => ({ id: "job-1", kind: "engine.install", role: null, state: "running", percent: 40, completedBytes: 30_000_000, totalBytes: 74_590_927, status: "downloading", position: null, input: { engine: "splash-1.3.2-darwin-arm64" }, result: null, reason: null, createdAt: "2026-10-19T10:00:00.000Z", updatedAt: "2026-10-19T10:00:01.000Z", ...over });

interface World { roles: RoleInfo[]; engines: EngineInfo[]; models: Array<{ id: string; state: string; sizeBytes: number | null }>; components: StackComponent[]; jobs: StackJob[]; down: boolean; refuse: string | null; tier: string | null }
let world: World;
let calls: string[];
const fresh = (): World => ({
  roles: [codingRole({})], engines: [engine({ installed: true, currentTag: "1.3.2" }), engine({ id: "llama-1", name: "llama-server", label: "llama.cpp", installed: true, currentTag: "b10797" })],
  models: [{ id: MODEL, state: "installed", sizeBytes: 16_464_440_224 }, { id: DRAFT, state: "installed", sizeBytes: 3_848_819_135 }],
  components: [component({})], jobs: [], down: false, refuse: null, tier: "p64",
});
const fake: CodingStack = {
  roles: async () => { if (world.down) throw new StackComponentError(503, "unreachable", "x"); return world.roles; },
  engines: async () => world.engines,
  models: async () => world.models,
  catalog: async () => [{ id: MODEL, role: "coding", download: { approx_bytes: 16_464_440_224 } }, { id: DRAFT, role: "coding", component: "draft", download: { approx_bytes: 3_848_819_135 } }, { id: "ornith-1-5-122b-mlx-4bit", role: "coding", download: { approx_bytes: 69_600_000_000 } }, { id: "ornith-1-5-122b-dflash2-draft", role: "coding", component: "draft", download: { approx_bytes: 1_900_000_000 } }, { id: "chat-a", role: "chat" }],
  jobs: async () => world.jobs,
  components: async () => world.components,
  tier: async () => world.tier,
  installEngine: async (name) => { calls.push(`install-engine:${name}`); if (world.refuse) throw new StackComponentError(409, "refused", world.refuse); return { job: "job-9" }; },
  removeEngineBuild: async (name, tag) => { calls.push(`remove-engine:${name}:${tag}`); if (world.refuse) throw new StackComponentError(409, "refused", world.refuse); },
  installComponent: async (id) => { calls.push(`install-component:${id}`); if (world.refuse) throw new StackComponentError(409, "refused", world.refuse); return { job: "job-8" }; },
  uninstallComponent: async (id) => { calls.push(`remove-component:${id}`); if (world.refuse) throw new StackComponentError(409, "refused", world.refuse); },
};

beforeEach(() => { resetDb(); world = fresh(); calls = []; __setCodingStackForTests(fake); });
afterEach(() => __setCodingStackForTests(null));

async function owner() {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const actor = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
  return { client, actor };
}
type Piece = { id: string; name: string; state: string; size_bytes: number | null; can_install: boolean; install_block: string | null; can_remove: boolean; remove_block: string | null; percent: number | null; failure: string | null };
type Listed = { stack: string; engine: string | null; missing: string | null; coding_enabled: boolean; pieces: Piece[] };
const list = async (client: TestClient) => await (await client.get("/api/coding-setup/pieces")).json() as Listed;

describe("the list", () => {
  test("on a Mac that runs Splash: the engine, the model and the draft, with state and disk size", async () => {
    const { client } = await owner();
    const body = await list(client);
    expect(body).toMatchObject({ stack: "ok", engine: "splash", missing: null, coding_enabled: false });
    expect(body.pieces.map((p) => [p.id, p.name, p.state])).toEqual([["engine", "splash", "installed"], ["model", MODEL, "installed"], ["draft", DRAFT, "installed"]]);
    expect(body.pieces[1]).toMatchObject({ size_bytes: 16_464_440_224, can_remove: true });
    expect(body.pieces[2]).toMatchObject({ size_bytes: 3_848_819_135, can_install: false, can_remove: false, remove_block: "It is removed with the coding model." });
  });
  test("the heavy pair is visible only on p128, and each piece uses its Stack component state", async () => {
    const { client } = await owner();
    world.tier = "p128";
    const heavyModel = component({ id: "ornith-1-5-122b-mlx-4bit", label: "Ornith 122B", summary: "The heavy coding model.", state: "notInstalled", size_bytes: null, download_bytes: 69_600_000_000, can_install: true, install_block: null, can_uninstall: false, uninstall_block: "It is not installed." });
    const heavyDraft = component({ id: "ornith-1-5-122b-dflash2-draft", label: "Ornith draft", summary: "The heavy draft.", state: "notInstalled", size_bytes: null, download_bytes: 1_900_000_000, can_install: true, install_block: null, can_uninstall: true, uninstall_block: null });
    world.components.push(heavyModel, heavyDraft);
    world.models.push({ id: heavyModel.id, state: "notInstalled", sizeBytes: null }, { id: heavyDraft.id, state: "notInstalled", sizeBytes: null });
    const body = await list(client);
    expect(body.pieces.map(piece => piece.id)).toEqual(["engine","model","draft","heavy_model","heavy_draft"]);
    expect(body.pieces[3]).toMatchObject({ name: heavyModel.id, state: "notInstalled", size_bytes: 69_600_000_000, can_install: true });
    expect(body.pieces[4]).toMatchObject({ name: heavyDraft.id, state: "notInstalled", size_bytes: 1_900_000_000, can_install: true });
    expect((await client.request("/api/coding-setup/pieces/heavy_model/install", {method:"POST"})).status).toBe(202);
    expect((await client.request("/api/coding-setup/pieces/heavy_draft", {method:"DELETE"})).status).toBe(200);
    expect(calls).toContain(`install-component:${heavyModel.id}`);
    expect(calls).toContain(`remove-component:${heavyDraft.id}`);
  });
  test("p64 never exposes heavy pieces", async () => {
    const { client } = await owner();
    world.tier = "p64";
    expect((await list(client)).pieces.map(piece => piece.id)).toEqual(["engine","model","draft"]);
    expect((await client.request("/api/coding-setup/pieces/heavy_model/install", {method:"POST"})).status).toBe(404);
  });
  test("on a computer that cannot run Splash the engine is the shared llama-server and has no draft", async () => {
    const { client } = await owner();
    world.engines = [engine({ matchesThisMachine: false }), engine({ id: "llama-1", name: "llama-server", installed: true, currentTag: "b10797" })];
    world.roles = [codingRole({ engine: "llama-server" })];
    const body = await list(client);
    expect(body.engine).toBe("llama-server");
    expect(body.pieces.map((p) => p.id)).toEqual(["engine", "model", "draft"]);
    expect(body.pieces[2]).toMatchObject({state:"unsupported",can_install:false,can_remove:false});
    expect(body.pieces[0]).toMatchObject({ name: "llama-server", can_remove: false, remove_block: "Chat uses this engine as well, so it stays." });
  });
  test("Splash wanted but not installed: it is the engine piece, installable, and coding is not missing the model", async () => {
    const { client } = await owner();
    world.engines = [engine({ installed: false }), engine({ id: "llama-1", name: "llama-server", installed: true, currentTag: "b10797" })];
    world.roles = [codingRole({ engine: "llama-server", engine_reason: "Splash is not installed. Install it in Settings, Coding." })];
    world.models = [{ id: MODEL, state: "installed", sizeBytes: 1 }, { id: DRAFT, state: "notInstalled", sizeBytes: null }];
    const body = await list(client);
    expect(body.pieces[0]).toMatchObject({ id: "engine", name: "splash", state: "notInstalled", can_install: true });
    expect(body.pieces[2]).toMatchObject({ id: "draft", state: "notInstalled", size_bytes: 3_848_819_135 });
    expect(body.missing).toBeNull();
  });
  test("a memory tier that cannot run coding: the model is unsupported with the reason, nothing installs", async () => {
    const { client } = await owner();
    world.components = [];
    world.engines = [engine({ matchesThisMachine: false }), engine({ id: "llama-1", name: "llama-server", installed: true })];
    const body = await list(client);
    expect(body.pieces.find((p) => p.id === "model")).toMatchObject({ state: "unsupported", can_install: false, install_block: "This computer does not have enough memory to run a coding model." });
  });
  test("a model the Stack says is unsupported keeps the Stack's reason", async () => {
    const { client } = await owner();
    world.components = [component({ state: "notInstalled", requirement: "unsupported", requirement_reason: "Coding needs more memory.", can_install: false, install_block: "Coding needs more memory.", can_uninstall: false, uninstall_block: "It is not installed." })];
    const model = (await list(client)).pieces.find((p) => p.id === "model")!;
    expect(model).toMatchObject({ state: "unsupported", install_block: "Coding needs more memory." });
  });
  test("the missing sentence names the model first, and a download in progress says so", async () => {
    const { client } = await owner();
    world.components = [component({ state: "notInstalled", can_install: true, install_block: null, can_uninstall: false, uninstall_block: "It is not installed." })];
    expect((await list(client)).missing).toBe("The coding model is not installed. An admin can install it in Settings, Coding.");
    world.components = [component({ state: "installing", percent: 30, can_install: false })];
    const body = await list(client);
    expect(body.missing).toBe("The coding model is still downloading.");
    expect(body.pieces[1]).toMatchObject({ state: "installing", percent: 30 });
  });
  test("an unreachable engine is a sentence, not an error page", async () => {
    const { client } = await owner();
    world.down = true;
    const res = await client.get("/api/coding-setup/pieces");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ stack: "unreachable", pieces: [], message: "x" });
  });
  test("only an owner or admin may read, install or remove", async () => {
    const { client, actor } = await owner();
    db.update(people).set({ role: "adult" }).where(eq(people.id, actor.id)).run();
    invalidateSessionCacheForPerson(actor.id);
    expect((await client.get("/api/coding-setup/pieces")).status).toBe(403);
    expect((await client.request("/api/coding-setup/pieces/model/install", { method: "POST" })).status).toBe(403);
    expect((await client.request("/api/coding-setup/pieces/model", { method: "DELETE" })).status).toBe(403);
    expect(calls).toEqual([]);
  });
  test("a signed-out caller is refused", async () => {
    expect((await new TestClient().get("/api/coding-setup/pieces")).status).toBe(401);
  });
});

describe("install", () => {
  test("the engine installs through the Stack's engine route and the model through its component route", async () => {
    const { client } = await owner();
    world.engines = [engine({ installed: false }), engine({ id: "llama-1", name: "llama-server", installed: true })];
    world.roles = [codingRole({ engine: "llama-server", engine_reason: "Splash is not installed." })];
    world.components = [component({ state: "notInstalled", can_install: true, install_block: null, can_uninstall: false, uninstall_block: "It is not installed." })];
    const engineRes = await client.request("/api/coding-setup/pieces/engine/install", { method: "POST" });
    expect(engineRes.status).toBe(202);
    expect(await engineRes.json()).toEqual({ job: "job-9", piece: "engine" });
    const modelRes = await client.request("/api/coding-setup/pieces/model/install", { method: "POST" });
    expect(modelRes.status).toBe(202);
    expect(calls).toEqual(["install-engine:splash", `install-component:${MODEL}`]);
  });
  test("the draft installs only with the model; an installed piece says so; the Stack's refusal is passed on", async () => {
    const { client } = await owner();
    const draft = await client.request("/api/coding-setup/pieces/draft/install", { method: "POST" });
    expect(draft.status).toBe(409);
    expect(await draft.json()).toMatchObject({ error: "It installs with the coding model." });
    const installed = await client.request("/api/coding-setup/pieces/model/install", { method: "POST" });
    expect(installed.status).toBe(409);
    expect(await installed.json()).toMatchObject({ error: "It is already installed." });
    world.components = [component({ state: "notInstalled", can_install: true, install_block: null })];
    world.refuse = "There is not enough room on the disk. Free 24 GB, then try again.";
    const refused = await client.request("/api/coding-setup/pieces/model/install", { method: "POST" });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: "There is not enough room on the disk. Free 24 GB, then try again." });
  });
  test("an unknown piece is a 404 from the route's own enum check", async () => {
    const { client } = await owner();
    const res = await client.request("/api/coding-setup/pieces/laptop/install", { method: "POST" });
    expect([400, 404]).toContain(res.status);
  });
});

describe("remove", () => {
  test("with Coding off each piece is removed through the Stack: the engine build by its current tag, the model by its component", async () => {
    const { client } = await owner();
    expect((await client.request("/api/coding-setup/pieces/engine", { method: "DELETE" })).status).toBe(200);
    const model = await client.request("/api/coding-setup/pieces/model", { method: "DELETE" });
    expect(model.status).toBe(200);
    expect(await model.json()).toEqual({ piece: "model", removed: true });
    expect(calls).toEqual(["remove-engine:splash:1.3.2", `remove-component:${MODEL}`]);
  });
  test("with Coding on every removal is refused with the plain sentence and the Stack is not called", async () => {
    const { client } = await owner();
    setHouseholdSettingValue("coding.enabled", true);
    for (const id of ["engine", "model", "draft"]) {
      const res = await client.request(`/api/coding-setup/pieces/${id}`, { method: "DELETE" });
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ error: CODING_ON_REFUSAL, code: "coding_on" });
    }
    expect(CODING_ON_REFUSAL).toContain("Turn Coding off");
    expect(calls).toEqual([]);
    const listed = await list(client);
    expect(listed.pieces.every((p) => !p.can_remove)).toBe(true);
    expect(listed.pieces[1]!.remove_block).toBe(CODING_ON_REFUSAL);
  });
  test("the shared llama-server and the draft cannot be removed on their own; the Stack's refusal for a running engine is passed on", async () => {
    const { client } = await owner();
    expect(await (await client.request("/api/coding-setup/pieces/draft", { method: "DELETE" })).json()).toMatchObject({ error: "It is removed with the coding model." });
    world.refuse = "This engine build is serving a role right now. Stop the role first, then remove the build.";
    const res = await client.request("/api/coding-setup/pieces/engine", { method: "DELETE" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "This engine build is serving a role right now. Stop the role first, then remove the build." });
    world.engines = [engine({ matchesThisMachine: false }), engine({ id: "llama-1", name: "llama-server", installed: true, currentTag: "b1" })];
    world.roles = [codingRole({ engine: "llama-server" })];
    const shared = await client.request("/api/coding-setup/pieces/engine", { method: "DELETE" });
    expect(await shared.json()).toMatchObject({ error: "Chat uses this engine as well, so it stays." });
  });
});

describe("status goes through the existing mechanisms", () => {
  test("the Splash engine download rides the install strip beside the component installs", () => {
    const strip = summarizeBackground([job({})]);
    expect(strip).toMatchObject({ state: "running", label: "Downloading the coding engine", count: 1 });
    expect(summarizeBackground([job({ kind: "engine.install", input: { engine: "llama-server-b1" } })])).toBeNull();
  });
  test("a failed engine install is a Repairs item with Try again, and it clears when Splash is installed", async () => {
    const { client } = await owner();
    world.engines = [engine({ installed: false }), engine({ id: "llama-1", name: "llama-server", installed: true })];
    world.roles = [codingRole({ engine: "llama-server", engine_reason: "Splash is not installed." })];
    world.jobs = [job({ state: "failed", reason: "The download stopped at 60 percent." })];
    const body = await list(client);
    expect(body.pieces[0]).toMatchObject({ state: "failed", failure: "The download stopped at 60 percent.", can_install: true });
    const issue = listIssues().find((row) => row.source === "coding" && row.key === "engine_install")!;
    expect(issue).toMatchObject({ severity: "warning", fix: { label: "Try again" } });
    world.engines = [engine({ installed: true, currentTag: "1.3.2" }), engine({ id: "llama-1", name: "llama-server", installed: true })];
    world.jobs = [];
    await list(client);
    expect(listIssues().find((row) => row.source === "coding" && row.key === "engine_install")).toBeUndefined();
  });
});

describe("the key store's view", () => {
  test("the first missing piece is remembered for the synchronous key check and refreshed only while Coding is on", async () => {
    world.components = [component({ state: "notInstalled", can_install: true, install_block: null })];
    await ensureCodingPiecesFresh(0);
    expect(missingCodingPiece()).toBeNull();
    setHouseholdSettingValue("coding.enabled", true);
    await ensureCodingPiecesFresh(0);
    expect(missingCodingPiece()).toBe("The coding model is not installed. An admin can install it in Settings, Coding.");
    world.components = [component({})];
    await ensureCodingPiecesFresh(60_000);
    expect(missingCodingPiece()).not.toBeNull();
    await ensureCodingPiecesFresh(0);
    expect(missingCodingPiece()).toBeNull();
  });
  test("a Stack that does not answer leaves the last reading and never throws", async () => {
    setHouseholdSettingValue("coding.enabled", true);
    world.components = [component({ state: "notInstalled", can_install: true, install_block: null })];
    await ensureCodingPiecesFresh(0);
    world.down = true;
    await ensureCodingPiecesFresh(0);
    expect(missingCodingPiece()).toContain("not installed");
  });
});

describe("missingFrom in coding mode", () => {
  const piece = (id: string, state: string, name = id) => ({ id, name, state }) as never;
  test("the large model alone is enough, the small one is not required", async () => {
    const { missingFrom } = await import("@/lib/stackCodingPieces");
    const pieces = [piece("engine", "installed", "splash"), piece("model", "notInstalled"), piece("heavy_model", "installed")];
    expect(missingFrom(pieces)).toContain("not installed");
    const { registerActiveChatLease } = await import("@/lib/chatLease");
    registerActiveChatLease({ snapshot: () => ({ state: "held" }) } as never);
    try { expect(missingFrom(pieces)).toBeNull(); } finally { registerActiveChatLease(null); }
  });
});
