// MEM-SPACE-05 / SETUP-FITS-01: the install plan and the downloads obey the Stack's fits_ever.
// A job whose every listed tier cannot ever run on this computer is left out of the downloads, whatever the
// request asks for, and the answer says why in plain words. A Stack without the capabilities route changes nothing.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { __resetStackEngineForTests, __setStackClientForTests } from "@/lib/stackEngine";
import { resetInstallStatusCache } from "@/lib/installStatus";
import { getInstallSelection } from "@/lib/setupState";
import { shippedDiskPlan } from "@/lib/diskPlan";
import { __setComponentsFetchForTests } from "@/lib/stackComponents";
import type { StackClient, StackInstallPlan } from "@/lib/stack/client";
import type { StackCapabilities } from "@/lib/stack/types";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";

const disk = shippedDiskPlan("p128");
const pinned = (id: string) => ({ id, role: "chat", url: `https://example.invalid/${id}`, sha256: "a".repeat(64), licence: "MIT", revision: "r", approx_bytes: 1, starter: false, installed: false });
const firstRun = disk.rows.filter((row) => ["chat", "image-tools", "voice-better"].includes(row.id)).flatMap((row) => row.model_ids);
const clips = disk.rows.find((row) => row.id === "video")!.model_ids;
const plan: StackInstallPlan = {
  level: "recommended", tier: "p128", label: "x", memory_gb: 128, memory_source: "unified", models: firstRun.map(pinned), optional_models: clips.map(pinned),
  total_bytes: 0, remaining_bytes: 0, free_disk_bytes: 10 ** 13, fits_disk: true, disk,
};
const GB = 1024 ** 3;
const caps = (videoFits: boolean): StackCapabilities => ({ machine_class: "p16", total_bytes: 16 * GB, rows: [
  { category: "chat", tier: "standard", fits_ever: true, needs_bytes: 5 * GB, cap_bytes: 10 * GB, model: "c" },
  { category: "video", tier: "standard", fits_ever: videoFits, needs_bytes: 44 * GB, cap_bytes: 10 * GB, model: videoFits ? "v" : null },
  { category: "video", tier: "max", fits_ever: videoFits, needs_bytes: 60 * GB, cap_bytes: 10 * GB, model: videoFits ? "v" : null },
] });
function stack(pulls: string[], capabilities: (() => Promise<StackCapabilities>) | undefined): StackClient {
  return { installPlan: async () => plan, jobs: async () => [], models: async () => [], pullModel: async (body: { id: string }) => { pulls.push(body.id); return {}; }, engineAction: async () => ({}), modelCatalog: async () => ({ models: [] }), ...(capabilities ? { capabilities } : {}) } as unknown as StackClient;
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("downloads obey fits_ever", () => {
  beforeEach(() => { resetDb(); resetInstallStatusCache(); });
  afterEach(() => { __resetStackEngineForTests(); __setComponentsFetchForTests(null); });

  test("a video model that never fits is not downloaded even when the request asks for it, and the answer says why", async () => {
    const pulls: string[] = [];
    __setStackClientForTests(stack(pulls, async () => caps(false)));
    const response = await new TestClient().post("/api/setup/install", { components: ["video"] });
    expect(response.status).toBe(202);
    const body = (await response.json()) as { left_out?: Array<{ job: string; reason: string }> };
    await settle();
    expect(pulls).not.toContain(clips[0]!);
    expect(pulls).toContain(disk.rows.find((row) => row.id === "chat")!.model_ids[0]!);
    expect(getInstallSelection()).not.toContain("video");
    expect(getInstallSelection()).toContain("chat");
    expect(body.left_out?.[0]?.job).toBe("videos");
    expect(body.left_out?.[0]?.reason).toBe("Videos need about 44 GB of memory, more than this computer can ever give them, so Home does not download them.");
  });

  test("the plan page lists the same reason per job", async () => {
    __setStackClientForTests(stack([], async () => caps(false)));
    const body = (await (await new TestClient().get("/api/setup/plan")).json()) as { cannot_run: string[]; cannot_run_why?: Record<string, string> };
    expect(body.cannot_run).toContain("videos");
    expect(body.cannot_run_why?.videos).toContain("44 GB");
  });

  test("a video model that fits is downloaded, and an older Stack with no capabilities route changes nothing", async () => {
    for (const capabilities of [async () => caps(true), undefined]) {
      resetDb(); resetInstallStatusCache();
      const pulls: string[] = [];
      __setStackClientForTests(stack(pulls, capabilities));
      const response = await new TestClient().post("/api/setup/install", { components: ["video"] });
      expect(response.status).toBe(202);
      expect(((await response.json()) as { left_out?: unknown[] }).left_out ?? []).toEqual([]);
      await settle();
      expect(pulls).toContain(clips[0]!);
    }
  });
});
