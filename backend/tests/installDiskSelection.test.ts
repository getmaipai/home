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
  level: "recommended", tier: "p128", label: "x", memory_gb: 128, memory_source: "unified", models: firstRun.map((id) => pinned(id)), optional_models: [...klein, ...disk.rows.filter((row) => row.id === "video-ltx25").flatMap((row) => row.model_ids)].map((id) => pinned(id)),
  total_bytes: 0, remaining_bytes: 0, free_disk_bytes: free, fits_disk: true, disk,
});
function stackWith(free: number, pulls: string[]) {
  return { installPlan: async () => plan(free), jobs: async () => [], models: async () => [], pullModel: async (body: { id: string }) => { pulls.push(body.id); return {}; }, engineAction: async () => ({}), modelCatalog: async () => ({ models: [] }) } as unknown as StackClient;
}
const LICENCE = { id: "ltx-2.x-community-2026-08-11", name: "LTX-2 Community License", url: "https://example.com/licence", summary: ["Free under $10 million a year."] };
/** A Stack that lists the Detailed video component with its licence and records the installs it is asked for. */
function ltxStack() {
  const installs: Array<{ id: string; body: Record<string, unknown> }> = [];
  const fetchStub = (async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    if (init?.method === "POST" && path.endsWith("/install")) { installs.push({ id: path.split("/").slice(-2)[0]!, body: JSON.parse(String(init.body ?? "{}")) }); return Response.json({ job: "j1", component: "ltx-2-5-q8-distilled-mlx" }, { status: 202 }); }
    return Response.json({ tier: "p128", free_disk_bytes: 1e13, disk_margin_bytes: 0, installed_bytes: 0, components: [{ id: "ffmpeg", state: "installed" }, { id: "ltx-2-5-q8-distilled-mlx", licence: { ...LICENCE, accepted_at: null } }] });
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

  test("no choice sent means the plan's defaults: the picture model is pulled and Detailed video (optional) is not installed", async () => {
    const pulls: string[] = [];
    __setStackClientForTests(stackWith(10 ** 13, pulls));
    const stack = ltxStack();
    __setComponentsFetchForTests(stack.fetch);
    expect((await new TestClient().post("/api/setup/install", {})).status).toBe(202);
    await settle();
    expect(pulls).toContain(klein[0]!);
    expect(getInstallSelection()).toEqual(sanitizeSelection(disk, disk.default_selected));
    expect(stack.installs).toEqual([]);
  });

  test("Detailed video is optional and off by default; selecting it sends no licence acceptance", async () => {
    expect(disk.rows.find((row) => row.id === "video-ltx25")).toMatchObject({ need: "optional" });
    expect(disk.default_selected).not.toContain("video-ltx25");
    const picked = [...disk.default_selected, "video-ltx25"];
    const pulls: string[] = [];
    __setStackClientForTests(stackWith(10 ** 13, pulls));
    const stack = ltxStack();
    __setComponentsFetchForTests(stack.fetch);
    const attempted = await new TestClient().post("/api/setup/install", { components: picked });
    expect(attempted.status).toBe(202);
    await settle();
    expect(pulls).toContain(disk.rows.find((row) => row.id === "video-ltx25")!.model_ids[0]!);
    expect(stack.installs).toEqual([]);
    // Not picked: nothing of it installs and no accept is needed.
    expect((await new TestClient().post("/api/setup/install", {})).status).toBe(202);
    await settle();
    expect(stack.installs).toEqual([]);
  });


  test("an upgrade does not pull optional Detailed video, and selecting it sends no Home acceptance", async () => {
    const pulls: string[] = [];
    __setStackClientForTests(stackWith(10 ** 13, pulls));
    const stack = ltxStack();
    __setComponentsFetchForTests(stack.fetch);
    expect((await beginInstall(undefined, false)).ok).toBe(true);
    await settle();
    expect(stack.installs).toEqual([]);
    expect(getInstallSelection()).not.toContain("video-ltx25");
    expect((await beginInstall(undefined, false, ["video-ltx25"])).ok).toBe(true);
    await settle();
    expect(stack.installs).toEqual([]);
    expect(pulls).toContain(disk.rows.find((row) => row.id === "video-ltx25")!.model_ids[0]!);
  });

  test("a selected plan row set is checked against available disk", async () => {
    const withoutVideo = disk.default_selected.filter((id) => id !== "video" && id !== "video-ltx25");
    const fits = selectionTotals(disk, withoutVideo).required_free_bytes + 2 * GIB + disk.headroom_warn_bytes + 1;
    __setStackClientForTests(stackWith(fits, []));
    const response = await new TestClient().post("/api/setup/install", { components: withoutVideo });
    expect(response.status).toBe(202);
  });

  test("required rows cannot be left off and unknown ids are dropped", () => {
    const chosen = sanitizeSelection(disk, ["nonsense", "engine:video", "video"]);
    expect(chosen).toContain("chat");
    expect(chosen).toContain("home");
    expect(chosen).toContain("video");
    expect(chosen).not.toContain("nonsense");
    expect(chosen).not.toContain("engine:video");
  });

  test("MP-09: a listed ffmpeg that is not installed is asked for once, an installed one never", async () => {
    const pulls: string[] = [];
    __setStackClientForTests(stackWith(10 ** 13, pulls));
    const installs: string[] = [];
    __setComponentsFetchForTests((async (url: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(url)).pathname;
      if (init?.method === "POST" && path.endsWith("/install")) { installs.push(path.split("/").slice(-2)[0]!); return Response.json({ job: "j1", component: "ffmpeg" }); }
      return Response.json({ tier: "p128", free_disk_bytes: 1e13, disk_margin_bytes: 0, installed_bytes: 0, components: [{ id: "ffmpeg", state: "notInstalled" }] });
    }) as unknown as typeof fetch);
    expect((await new TestClient().post("/api/setup/install", {})).status).toBe(202);
    await settle();
    expect(installs).toEqual(["ffmpeg"]);
  });
});
