import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people } from "@/db/schema";
import { getHouseholdSettingValue } from "@/lib/settings";
import { __setCodingStackForTests, type CodingStack } from "@/lib/stackCodingPieces";
import { __resetStackEngineForTests, __setStackClientForTests } from "@/lib/stackEngine";
import { codingClientLater, setupCodingChoice, SETUP_STEP_IDS } from "@/lib/setupState";
import type { StackComponent as StackComponentType } from "@/lib/stackComponents";
import type { EngineInfo, RoleInfo } from "@/lib/stack/types";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";

const STANDARD = "coding-model-a";
const DRAFT = "coding-draft-a";
const HEAVY = "ornith-1-5-122b-mlx-4bit";
const HEAVY_DRAFT = "ornith-1-5-122b-dflash2-draft";
let tier: "p64" | "p128";
let calls: string[];
const mkComponent = (id: string, state: "installed" | "notInstalled" = "notInstalled", size = 100): StackComponentType => ({
  id, label: id, summary: `Summary ${id}`, group: "chat", kind: "model", state, size_bytes: state === "installed" ? size : null, download_bytes: size, full_bytes: size, required_free_bytes: size,
  plan_need: "recommended", requirement: "optional", requirement_reason: null, last_used_at: null, used_by: ["Coding"], depends_on: [], job: null, percent: null, failure: null,
  can_install: state !== "installed", install_block: state === "installed" ? "It is already installed." : null, can_uninstall: state === "installed", uninstall_block: state === "installed" ? null : "It is not installed.",
});
const engine = (name: string, installed: boolean): EngineInfo => ({ id: name, name, label: name, platform: "darwin", arch: "arm64", verified: true, installed, matchesThisMachine: true, running: null, currentTag: installed ? "1.0" : null, newestTag: "1.0", current: installed, notCurrent: false, needsRestart: false, state: "current", stateReason: null, directory: "/tmp", roleState: "stopped", roleReason: null });
const role = { id: "coding", coding: { state: "installed", engine: "llama-server", engine_requested: "auto", engine_reason: "Splash is not installed." } } as unknown as RoleInfo;
const components = () => [mkComponent(STANDARD), mkComponent(DRAFT), mkComponent(HEAVY, "notInstalled", 69_600_000_000), mkComponent(HEAVY_DRAFT, "notInstalled", 1_900_000_000)];
const fakeCoding: CodingStack = {
  roles: async () => [role], engines: async () => [engine("splash", false), engine("llama-server", true)],
  models: async () => [], catalog: async () => [
    { id: STANDARD, role: "coding", download: { approx_bytes: 20 } }, { id: DRAFT, role: "coding", component: "draft", download: { approx_bytes: 5 } },
    { id: HEAVY, role: "coding", download: { approx_bytes: 69_600_000_000 } }, { id: HEAVY_DRAFT, role: "coding", component: "draft", download: { approx_bytes: 1_900_000_000 } },
  ], jobs: async () => [], components: async () => components(), tier: async () => tier,
  installEngine: async name => { calls.push(`engine:${name}`); return { job: "j" }; }, removeEngineBuild: async () => {},
  installComponent: async id => { calls.push(`component:${id}`); return { job: "j" }; }, uninstallComponent: async id => { calls.push(`remove:${id}`); },
};
const plan = () => ({ level: "recommended", tier, label: "Recommended", memory_gb: tier === "p128" ? 128 : 64, memory_source: "unified", models: [], total_bytes: 0, remaining_bytes: 0, free_disk_bytes: 2_000_000_000_000, fits_disk: true });

beforeEach(() => {
  resetDb(); tier = "p64"; calls = []; __setCodingStackForTests(fakeCoding);
  __setStackClientForTests({ installPlan: async () => plan(), getCodingMode: async () => ({ mode: "normal", state: "stable", reason: null, checks: { engine: false, pieces: false, hardware: false, memory: false, bench: false }, self_test: { passed_at: null, stale: false } }), roles: async () => ({ roles: [{ id: "coding", state: { state: "installed" } }] }) } as never);
});
afterEach(() => { __setCodingStackForTests(null); __resetStackEngineForTests(); });
async function owner() { const client = new TestClient(); await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" }); return client; }

describe("the coding setup screen", () => {
  test("GET lists the standard rows on p64 and the heavy rows only on p128", async () => {
    const client = await owner();
    const base = await (await client.get("/api/setup/coding")).json() as { eligible_mode: boolean; pieces: Array<{id:string;label:string;size_bytes:number|null;state:string}>; total_bytes: number };
    expect(base.eligible_mode).toBe(false); expect(base.pieces.map(p => p.id)).toEqual(["engine","model","draft"]);
    expect(base.total_bytes).toBe(25);
    tier = "p128";
    const large = await (await client.get("/api/setup/coding")).json() as typeof base;
    expect(large.eligible_mode).toBe(true); expect(large.pieces.map(p => p.id)).toEqual(["engine","model","draft","heavy_model","heavy_draft"]);
  });

  test("later records only the choice and leaves Coding disabled", async () => {
    const client = await owner();
    const response = await client.post("/api/setup/coding", { choice: "later" });
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ ok: true, choice: "later" });
    expect(setupCodingChoice()).toBe("later"); expect(codingClientLater()).toBe(true);
    expect(getHouseholdSettingValue("coding.enabled")).not.toBe(true); expect(calls).toEqual([]);
  });

  test("set_up enables Coding and starts available installs in order", async () => {
    tier = "p128";
    const client = await owner();
    const response = await client.post("/api/setup/coding", { choice: "set_up" });
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ ok: true, choice: "set_up", pieces: [{id:"engine",state:"installing"},{id:"model",state:"installing"},{id:"draft",state:"installing"},{id:"heavy_model",state:"installing"},{id:"heavy_draft",state:"installing"}] });
    expect(getHouseholdSettingValue("coding.enabled")).toBe(true); expect(setupCodingChoice()).toBe("set_up");
    expect(calls).toEqual(["engine:splash", `component:${STANDARD}`, `component:${HEAVY}`, `component:${HEAVY_DRAFT}`]);
  });

  test("set_up refuses the plan's disk wording before changing settings or starting installs", async () => {
    __setStackClientForTests({ installPlan: async () => ({ ...plan(), free_disk_bytes: 1, fits_disk: false }) } as never);
    const client = await owner();
    const response = await client.post("/api/setup/coding", { choice: "set_up" });
    expect(response.status).toBe(409); expect(((await response.json()) as {error:string}).error).toContain("Free up space");
    expect(getHouseholdSettingValue("coding.enabled")).not.toBe(true); expect(calls).toEqual([]);
  });

  test("owner/admin access is required and the route is unavailable before an owner exists", async () => {
    const anonymous = new TestClient();
    expect((await anonymous.post("/api/setup/coding", {choice:"later"})).status).toBe(401);
    const client = await owner();
    const actor = db.select().from(people).where(eq(people.displayName,"Sage")).get()!;
    db.update(people).set({role:"adult"}).where(eq(people.id,actor.id)).run();
    expect((await client.get("/api/setup/coding")).status).toBe(403);
    expect((await client.post("/api/setup/coding", {choice:"later"})).status).toBe(403);
    expect(SETUP_STEP_IDS).not.toContain("coding");
  });
});
