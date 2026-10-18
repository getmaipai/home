import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { __resetStackEngineForTests, __setStackClientForTests } from "@/lib/stackEngine";
import { resetInstallStatusCache } from "@/lib/installStatus";
import { getInstallSelection } from "@/lib/setupState";
import { shippedDiskPlan } from "@/lib/diskPlan";
import { beginInstall, sanitizeSelection } from "@/lib/installActions";
import { __setComponentsFetchForTests } from "@/lib/stackComponents";
import { selectionTotals } from "../../shared/diskPlanMath";
import type { StackClient, StackInstallPlan } from "@/lib/stack/client";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";

const GIB = 1024 ** 3;
const disk = shippedDiskPlan("p128");
const pinned = (id: string, installed = false) => ({ id, role: "chat", url: `https://example.invalid/${id}`, sha256: "a".repeat(64), licence: "MIT", revision: "r", approx_bytes: 1, starter: false, installed });
const firstRun = disk.rows.filter((row) => ["chat", "image-tools", "voice-better"].includes(row.id)).flatMap((row) => row.model_ids);
const klein = disk.rows.find((row) => row.id === "pictures")!.model_ids;
const plan = (free: number): StackInstallPlan => ({
  level: "recommended", tier: "p128", label: "x", memory_gb: 128, memory_source: "unified", models: firstRun.map((id) => pinned(id)), optional_models: klein.map((id) => pinned(id)),
  total_bytes: 0, remaining_bytes: 0, free_disk_bytes: free, fits_disk: true, disk,
});
function stackWith(free: number, pulls: string[]) {
  return { installPlan: async () => plan(free), jobs: async () => [], models: async () => [], pullModel: async (body: { id: string }) => { pulls.push(body.id); return {}; }, engineAction: async () => ({}), modelCatalog: async () => ({ models: [] }) } as unknown as StackClient;
}
const LICENCE = { id: "ltx-2.x-community-2026-08-11", name: "LTX-2 Community License", url: "https://example.com/licence", summary: ["Free under $10 million a year."], accepted_at: null as string | null };
/** A Stack that lists the Detailed video component with its licence and records the installs it is asked for. */
function ltxStack(acceptedAt: string | null) {
  const installs: Array<{ id: string; accepted_licence?: string }> = [];
  const fetchStub = (async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    if (init?.method === "POST" && path.endsWith("/install")) { installs.push({ id: path.split("/").slice(-2)[0]!, ...JSON.parse(String(init.body ?? "{}")) }); return Response.json({ job: "j1", component: "ltx-2-3-distilled-mlx" }, { status: 202 }); }
    return Response.json({ tier: "p128", free_disk_bytes: 1e13, disk_margin_bytes: 0, installed_bytes: 0, components: [{ id: "ltx-2-3-distilled-mlx", licence: { ...LICENCE, accepted_at: acceptedAt } }] });
  }) as unknown as typeof fetch;
  return { fetch: fetchStub, installs };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("install with a choice of components", () => {
  beforeEach(() => { resetDb(); resetInstallStatusCache(); });
  afterEach(() => { __resetStackEngineForTests(); __setComponentsFetchForTests(null); });

  test("the rows left off are not pulled, the picture row turned on is, and the choice is saved", async () => {
    const pulls: string[] = [];
    __setStackClientForTests(stackWith(10 ** 13, pulls));
    const response = await new TestClient().post("/api/setup/install", { components: ["pictures"] });
    expect(response.status).toBe(202);
    await settle();
    expect(pulls).toContain(klein[0]!);
    expect(pulls).not.toContain(disk.rows.find((row) => row.id === "image-tools")!.model_ids[0]!);
    expect(pulls).not.toContain(disk.rows.find((row) => row.id === "voice-better")!.model_ids[0]!);
    expect(pulls).toContain(disk.rows.find((row) => row.id === "chat")!.model_ids[0]!);
    const saved = getInstallSelection()!;
    expect(saved).toContain("pictures");
    expect(saved).toContain("chat");
    expect(saved).not.toContain("video");
  });

  test("no choice sent means the plan's defaults: pictures and Detailed video (once its licence is accepted), the optional extras not", async () => {
    const pulls: string[] = [];
    __setStackClientForTests(stackWith(10 ** 13, pulls));
    const stack = ltxStack(null);
    __setComponentsFetchForTests(stack.fetch);
    expect((await new TestClient().post("/api/setup/install", { accepted_licences: [LICENCE.id] })).status).toBe(202);
    await settle();
    expect(pulls).toContain(klein[0]!);
    expect(getInstallSelection()).toEqual(sanitizeSelection(disk, disk.default_selected));
    expect(stack.installs).toEqual([{ id: "ltx-2-3-distilled-mlx", accepted_licence: LICENCE.id }]);
  });

  test("Detailed video is recommended, on by default, and the install does not start without its licence accepted", async () => {
    expect(disk.rows.find((row) => row.id === "video-detailed")).toMatchObject({ need: "recommended" });
    expect(disk.default_selected).toContain("video-detailed");
    const pulls: string[] = [];
    __setStackClientForTests(stackWith(10 ** 13, pulls));
    const stack = ltxStack(null);
    __setComponentsFetchForTests(stack.fetch);
    const refused = await new TestClient().post("/api/setup/install", {});
    expect(refused.status).toBe(409);
    expect((await refused.json() as { error: string }).error).toMatch(/licence.*needs your accept/);
    await settle();
    expect(pulls).toEqual([]);
    expect(stack.installs).toEqual([]);
    // Unticked: nothing of it installs and no accept is needed.
    expect((await new TestClient().post("/api/setup/install", { components: disk.default_selected.filter((id) => id !== "video-detailed") })).status).toBe(202);
    await settle();
    expect(stack.installs).toEqual([]);
    // Already accepted earlier: no accept is asked again.
    const known = ltxStack("2026-10-17T00:00:00.000Z");
    __setComponentsFetchForTests(known.fetch);
    expect((await new TestClient().post("/api/setup/install", {})).status).toBe(202);
    await settle();
    expect(known.installs.length).toBe(1);
  });

  test("an upgrade or a Home settings install with no choice never pulls Detailed video: it stays recommended but not installed", async () => {
    const pulls: string[] = [];
    __setStackClientForTests(stackWith(10 ** 13, pulls));
    const stack = ltxStack(null);
    __setComponentsFetchForTests(stack.fetch);
    expect((await beginInstall(undefined, false)).ok).toBe(true);
    await settle();
    expect(stack.installs).toEqual([]);
    expect(getInstallSelection()).not.toContain("video-detailed");
    // An explicit admin choice of it (with the accept) is the only way in.
    expect((await beginInstall(undefined, false, ["video-detailed"], [LICENCE.id])).ok).toBe(true);
    await settle();
    expect(stack.installs.length).toBe(1);
  });

  test("a disk too small for the default choice refuses, and turning off the pictures makes it fit", async () => {
    const withoutPictures = disk.default_selected.filter((id) => id !== "pictures");
    const fits = selectionTotals(disk, withoutPictures).required_free_bytes + 2 * GIB + disk.headroom_warn_bytes + 1;
    expect(fits).toBeLessThan(selectionTotals(disk, disk.default_selected).required_free_bytes + 2 * GIB);
    __setStackClientForTests(stackWith(fits, []));
    const refused = await new TestClient().post("/api/setup/install", {});
    expect(refused.status).toBe(409);
    const body = await refused.json() as { error: string; next: string };
    expect(body.error).toMatch(/^This computer needs about \d+ GB free for the recommended setup; it has \d+ GB\./);
    expect(body.next).toContain("turn off an extra");
    expect((await new TestClient().post("/api/setup/install", { components: withoutPictures.filter((id) => id !== "video-detailed") })).status).toBe(202);
  });

  test("required rows cannot be left off and unknown ids are dropped", () => {
    const chosen = sanitizeSelection(disk, ["nonsense", "engine:video", "video"]);
    expect(chosen).toContain("chat");
    expect(chosen).toContain("home");
    expect(chosen).toContain("video");
    expect(chosen).not.toContain("nonsense");
    expect(chosen).not.toContain("engine:video");
  });
});
