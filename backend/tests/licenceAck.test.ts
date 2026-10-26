// LICENCE-ACK-01: the wizard's "Home goes online for you" item also accepts the licences of the parts Home installs. One
// household record (who, when, terms version, component and licence ids); a covered licence never asks for a click; a
// licence the record does not list, or a record at an older terms version, still asks once; an install that never saw the
// wizard wording shows the one admin prompt and never downloads the extras by itself.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people, settingsValues } from "@/db/schema";
import { __resetStackEngineForTests, __setStackClientForTests } from "@/lib/stackEngine";
import { resetInstallStatusCache } from "@/lib/installStatus";
import { shippedDiskPlan } from "@/lib/diskPlan";
import { beginInstall } from "@/lib/installActions";
import { __setComponentsFetchForTests } from "@/lib/stackComponents";
import { currentLicenceAck, readLicenceAck } from "@/lib/licenceAcceptance";
import { licenceOverview } from "@/lib/licenceFlow";
import { LICENCE_ACK_ITEM_ID, LICENCE_ACK_SENTENCE, LICENCE_TERMS_VERSION } from "../../shared/licenceTerms";
import type { StackClient, StackInstallPlan } from "@/lib/stack/client";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";

const disk = shippedDiskPlan("p128");
const firstRun = disk.rows.filter((row) => ["chat", "image-tools", "voice-better"].includes(row.id)).flatMap((row) => row.model_ids);
const pinned = (id: string) => ({ id, role: "chat", url: `https://example.invalid/${id}`, sha256: "a".repeat(64), licence: "MIT", revision: "r", approx_bytes: 1, starter: false, installed: false });
const plan = (): StackInstallPlan => ({ level: "recommended", tier: "p128", label: "x", memory_gb: 128, memory_source: "unified", models: firstRun.map(pinned), optional_models: [], total_bytes: 0, remaining_bytes: 0, free_disk_bytes: 1e13, fits_disk: true, disk });
const stackClient = () => ({ installPlan: async () => plan(), jobs: async () => [], models: async () => [], pullModel: async () => ({}), engineAction: async () => ({}) }) as unknown as StackClient;
const LTX = { id: "ltx-2.x-community-2026-08-11", name: "LTX-2 Community License", url: "https://example.com/licence", summary: ["Free under $10 million a year."], accepted_at: null as string | null };
function ltxStack(licence = LTX) {
  const installs: Array<{ id: string; accepted_licence?: string; accepted_by?: string }> = [];
  const fetchStub = (async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    if (init?.method === "POST" && path.endsWith("/install")) { installs.push({ id: path.split("/").slice(-2)[0]!, ...JSON.parse(String(init.body ?? "{}")) }); return Response.json({ job: "j1", component: "ltx-2-3-distilled-mlx" }, { status: 202 }); }
    return Response.json({ tier: "p128", free_disk_bytes: 1e13, disk_margin_bytes: 0, installed_bytes: 0, components: [{ id: "ltx-2-3-distilled-mlx", label: "Video: Detailed (LTX-2.3)", summary: "x", group: "video", kind: "model", state: "notInstalled", size_bytes: null, download_bytes: 1, full_bytes: 1, required_free_bytes: 1, plan_need: "recommended", requirement: "optional", requirement_reason: null, last_used_at: null, used_by: [], depends_on: [], job: null, percent: null, failure: null, can_install: true, install_block: null, can_uninstall: false, uninstall_block: null, licence }] });
  }) as unknown as typeof fetch;
  return { fetch: fetchStub, installs };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
const rawRecord = (value: object) => db.insert(settingsValues).values({ scope: "household", key: "_licences.accepted", value: JSON.stringify(value), hlc: "0", source: "hub", updatedAt: new Date().toISOString() }).run();

describe("the wizard's acknowledgement", () => {
  beforeEach(() => { resetDb(); resetInstallStatusCache(); __setStackClientForTests(stackClient()); });
  afterEach(() => { __resetStackEngineForTests(); __setComponentsFetchForTests(null); });

  test("the sentence rides in the existing internet item, not a new item", () => {
    expect(LICENCE_ACK_ITEM_ID).toBe("internet");
    expect(LICENCE_ACK_SENTENCE).toMatch(/accept the licences/);
    expect(LICENCE_ACK_SENTENCE).not.toContain("—");
  });

  test("accepting stores one record with who, when, the terms version, and no licence list until Install widens it", async () => {
    __setComponentsFetchForTests(ltxStack().fetch);
    expect((await new TestClient().post("/api/setup/licences/accept", {})).status).toBe(200);
    const early = readLicenceAck()!;
    expect(early).toMatchObject({ item_id: "internet", by: "setup", terms_version: LICENCE_TERMS_VERSION });
    expect(Date.parse(early.at)).toBeGreaterThan(0);
    expect((await new TestClient().post("/api/setup/install", {})).status).toBe(202);
    await settle();
    expect(readLicenceAck()).toMatchObject({ component_ids: ["ltx-2-3-distilled-mlx"], licence_ids: [LTX.id] });
    expect(db.select().from(settingsValues).where(eq(settingsValues.key, "_licences.accepted")).all().length).toBe(1);
  });

  test("a covered licence installs with no individual accept, and the Stack still gets the notice id", async () => {
    const stack = ltxStack(); __setComponentsFetchForTests(stack.fetch);
    await new TestClient().post("/api/setup/licences/accept", {});
    expect((await new TestClient().post("/api/setup/install", { components: ["video-detailed"] })).status).toBe(202);
    await settle();
    expect(stack.installs).toEqual([{ id: "ltx-2-3-distilled-mlx", accepted_licence: LTX.id }]);
  });

  test("the setup plan lists the licence as covered, information only", async () => {
    __setComponentsFetchForTests(ltxStack().fetch);
    await new TestClient().post("/api/setup/licences/accept", {});
    const body = await (await new TestClient().get("/api/setup/plan")).json() as { licences: Array<{ covered?: boolean }> };
    expect(body.licences[0]!.covered).toBe(true);
  });

  test("no acknowledgement keeps the per-item flow: the install asks for the accept", async () => {
    const stack = ltxStack(); __setComponentsFetchForTests(stack.fetch);
    const refused = await new TestClient().post("/api/setup/install", { components: ["video-detailed"] });
    expect(refused.status).toBe(409);
    expect((await refused.json() as { error: string }).error).toMatch(/needs your accept/);
    expect(stack.installs).toEqual([]);
  });

  test("a licence the record does not list asks once; a record at an older terms version covers nothing", async () => {
    const stack = ltxStack({ ...LTX, id: "ltx-3-new-licence" }); __setComponentsFetchForTests(stack.fetch);
    rawRecord({ item_id: "internet", by: "person-1", at: "2026-10-18T00:00:00.000Z", terms_version: LICENCE_TERMS_VERSION, component_ids: ["ltx-2-3-distilled-mlx"], licence_ids: [LTX.id] });
    const refused = await beginInstall(undefined, true, ["video-detailed"]);
    expect(refused.ok).toBe(false);
    expect(stack.installs).toEqual([]);
    expect((await beginInstall(undefined, true, ["video-detailed"], ["ltx-3-new-licence"])).ok).toBe(true);
    db.delete(settingsValues).where(eq(settingsValues.key, "_licences.accepted")).run();
    __setComponentsFetchForTests(ltxStack().fetch);
    rawRecord({ item_id: "internet", by: "person-1", at: "2026-01-01T00:00:00.000Z", terms_version: "2026-01-01", component_ids: [], licence_ids: [LTX.id] });
    expect(currentLicenceAck()).toBeNull();
    expect((await beginInstall(undefined, true, ["video-detailed"])).ok).toBe(false);
  });
});

describe("an install that never saw the wizard wording", () => {
  beforeEach(() => { resetDb(); resetInstallStatusCache(); __setStackClientForTests(stackClient()); });
  afterEach(() => { __resetStackEngineForTests(); __setComponentsFetchForTests(null); });
  async function owner() {
    const client = new TestClient();
    await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    return { client, actor: db.select().from(people).where(eq(people.displayName, "Sage")).get()! };
  }

  test("the one prompt shows in Repairs, accepting once removes it, and the extras are offered but never started by themselves", async () => {
    const stack = ltxStack(); __setComponentsFetchForTests(stack.fetch);
    const { client, actor } = await owner();
    expect(currentLicenceAck()).toBeNull();
    const before = await (await client.get("/api/install/licences")).json() as { needs_prompt: boolean; extras: unknown };
    expect(before.needs_prompt).toBe(true);
    expect(before.extras).toBeNull();
    const repairs = await (await client.get("/api/repairs")).json() as Array<{ key: string; title: string }>;
    expect(repairs.filter((issue) => issue.key === "licences.accept").length).toBe(1);
    // An upgrade never pulls the licensed extra on its own.
    expect((await beginInstall(undefined, false)).ok).toBe(true);
    await settle();
    expect(stack.installs).toEqual([]);
    expect((await client.post("/api/install/licences/accept", {})).status).toBe(200);
    expect(readLicenceAck()).toMatchObject({ by: actor.id, licence_ids: [LTX.id], component_ids: ["ltx-2-3-distilled-mlx"] });
    await settle();
    expect(stack.installs).toEqual([]);
    const after = await licenceOverview();
    expect(after.needs_prompt).toBe(false);
    const again = await (await client.get("/api/repairs")).json() as Array<{ key: string }>;
    expect(again.filter((issue) => issue.key === "licences.accept").length).toBe(0);
    // Detailed video is optional (AIMODELS-DATA-01), so it is no longer one of the recommended extras and the extras button never asks for its licence.
    expect((await (await client.get("/api/install/licences")).json() as { extras: { ids: string[] } | null }).extras?.ids).not.toContain("video-detailed");
    expect((await client.post("/api/install/licences/install-extras", {})).status).toBe(202);
    await settle();
    expect(stack.installs).toEqual([]);
  });

  test("extras need the acknowledgement first, and a component install after it needs no click", async () => {
    const stack = ltxStack(); __setComponentsFetchForTests(stack.fetch);
    const { client } = await owner();
    expect((await client.post("/api/install/licences/install-extras", {})).status).toBe(409);
    const list = await (await client.get("/api/components")).json() as { components: Array<{ licence: { covered: boolean } }> };
    expect(list.components[0]!.licence.covered).toBe(false);
    await client.post("/api/install/licences/accept", {});
    expect((await client.post("/api/components/ltx-2-3-distilled-mlx/install", {})).status).toBe(202);
    expect(stack.installs.at(-1)).toMatchObject({ accepted_licence: LTX.id });
  });

  test("only an owner or admin sees or accepts the licences", async () => {
    __setComponentsFetchForTests(ltxStack().fetch);
    expect((await new TestClient().get("/api/install/licences")).status).toBeGreaterThanOrEqual(401);
  });
});
