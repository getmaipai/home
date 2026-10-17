import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { __resetStackEngineForTests, __setStackClientForTests } from "@/lib/stackEngine";
import { resetInstallStatusCache } from "@/lib/installStatus";
import { getInstallSelection } from "@/lib/setupState";
import { shippedDiskPlan } from "@/lib/diskPlan";
import { sanitizeSelection } from "@/lib/installActions";
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
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("install with a choice of components", () => {
  beforeEach(() => { resetDb(); resetInstallStatusCache(); });
  afterEach(() => __resetStackEngineForTests());

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

  test("no choice sent means the plan's defaults: pictures included, the optional extras not", async () => {
    const pulls: string[] = [];
    __setStackClientForTests(stackWith(10 ** 13, pulls));
    expect((await new TestClient().post("/api/setup/install", {})).status).toBe(202);
    await settle();
    expect(pulls).toContain(klein[0]!);
    expect(getInstallSelection()).toEqual(sanitizeSelection(disk, disk.default_selected));
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
    expect((await new TestClient().post("/api/setup/install", { components: withoutPictures })).status).toBe(202);
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
