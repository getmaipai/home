import { describe, expect, test } from "bun:test";
import { checkInstallPreflight, type InstallPreflightOptions } from "../src/lib/installPreflight";
import { shippedDiskPlan, planVolumes, machineTier, shippedPlanForLevel } from "../src/lib/diskPlan";
import { selectionTotals, diskVerdict, tierForLevel, GIB } from "../../shared/diskPlanMath";
import table from "../../shared/diskPlan.json";

const base = (patch: Partial<InstallPreflightOptions> = {}): InstallPreflightOptions => ({
  platform: "darwin", architecture: "arm64", releaseHost: "github.com", port: 3000,
  memoryBytes: () => ({ free: 8 * GIB, total: 64 * GIB }), systemVersion: () => "macOS", lockInfo: () => null, portBusy: async () => false, reachReleaseHost: async () => true,
  machine: { platform: "darwin", totalMemoryBytes: 64 * GIB }, level: "recommended",
  paths: { program: "/opt/home", data: "/opt/home/data", ai: "/opt/home/stack/data" }, device: () => 1,
  now: () => new Date("2026-10-17T12:00:00.000Z"), ...patch,
});
const disk = async (patch: Partial<InstallPreflightOptions>) => (await checkInstallPreflight(base(patch))).find((row) => row.code.startsWith("install.disk"))!;

describe("installer preflight: disk", () => {
  test("refuses with the plain message, the free and needed figures and the smaller-plan hint when space is short", async () => {
    const row = await disk({ freeBytes: () => 50 * GIB });
    expect(row.code).toBe("install.disk.low");
    expect(row.severity).toBe("error");
    expect(row.text).toMatch(/^This computer needs about \d+ GB free for the recommended setup; it has 50 GB\. Free up space, or choose a smaller plan\.$/);
    expect(row.fix?.label).toContain("--plan moderate");
  });

  test("the requirement is the plan's installed size plus 20 percent plus the temporary space, for the tier the computer reaches", async () => {
    const plan = shippedDiskPlan("p64");
    const want = Math.ceil(plan.default.installed_bytes * 1.2) + plan.default.peak_temp_bytes;
    expect(plan.default.required_free_bytes).toBe(want);
    // One byte under the requirement plus Home's data reserve is red; the requirement plus the reserve plus headroom is green.
    const need = want + 2 * GIB;
    expect((await disk({ freeBytes: () => need - 1 })).severity).toBe("error");
    expect((await disk({ freeBytes: () => need + plan.headroom_warn_bytes })).severity).toBeNull();
  });

  test("warns, and does not block, when it fits by less than the headroom", async () => {
    const plan = shippedDiskPlan("p64");
    const need = plan.default.required_free_bytes + 2 * GIB;
    const row = await disk({ freeBytes: () => need + GIB });
    expect(row.code).toBe("install.disk.tight");
    expect(row.severity).toBe("warning");
    expect(row.text).toContain("leaves little room");
  });

  test("a smaller plan level asks for less: minimal on the same computer", async () => {
    const recommended = (await disk({ freeBytes: () => 40 * GIB }));
    const minimal = (await disk({ freeBytes: () => 40 * GIB, level: "minimal" }));
    expect(recommended.severity).toBe("error");
    expect(minimal.severity).toBeNull();
  });

  test("a computer with less memory than the level asks for is held to the plan it can run", async () => {
    // A 32 GB Mac asking for recommended gets the moderate (p32) plan.
    expect(tierForLevel("recommended", machineTier({ platform: "darwin", totalMemoryBytes: 32 * GIB })!)).toBe("p32");
    const row = await disk({ machine: { platform: "darwin", totalMemoryBytes: 32 * GIB }, freeBytes: () => 33 * GIB });
    expect(row.cause).toContain("p32");
  });

  test("a data folder on another disk is checked on its own disk", async () => {
    const frees: Record<string, number> = { "/opt/home": 200 * GIB, "/data-disk/home": 1 * GIB, "/opt/home/stack/data": 200 * GIB };
    const devices: Record<string, number> = { "/opt/home": 1, "/data-disk/home": 2, "/opt/home/stack/data": 1 };
    const row = await disk({ paths: { program: "/opt/home", data: "/data-disk/home", ai: "/opt/home/stack/data" }, freeBytes: (path) => frees[path] ?? null, device: (path) => devices[path] ?? null });
    expect(row.severity).toBe("error");
    expect(row.text).toMatch(/needs about 2\.0 GB free.*it has 1\.0 GB/);
  });

  test("an AI folder on another disk is checked on that disk, and folders that share a disk add up", async () => {
    const plan = shippedDiskPlan("p64");
    const ai = selectionTotals(plan, plan.default_selected, { only: "ai" }).required_free_bytes;
    const home = selectionTotals(plan, plan.default_selected, { only: "home" }).required_free_bytes;
    const paths = { program: "/a", data: "/a/data", ai: "/b/ai" };
    // Split over two disks: the AI disk holds only the AI, the other holds Home and its data.
    const split = await disk({ paths, freeBytes: (path) => (path === "/b/ai" ? ai + plan.headroom_warn_bytes + 1 : home + 2 * GIB + plan.headroom_warn_bytes + 1), device: (path) => (path === "/b/ai" ? 2 : 1) });
    expect(split.severity).toBeNull();
    // The same free space on one shared disk is not enough for both.
    const shared = await disk({ paths, freeBytes: () => ai, device: () => 1 });
    expect(shared.severity).toBe("error");
  });

  test("unreadable free space warns instead of blocking", async () => {
    const row = await disk({ freeBytes: () => null });
    expect(row.code).toBe("install.disk.unknown");
    expect(row.severity).toBe("warning");
  });

  test("planVolumes puts folders on one disk together and an unknown disk with the first", () => {
    expect(planVolumes({ program: "/a", data: "/a/d", ai: "/a/s" }, { freeBytes: () => 5, device: () => 7 })).toEqual([{ freeBytes: 5, needs: ["home", "data", "ai"] }]);
    expect(planVolumes({ program: "/a", data: "/b", ai: "/c" }, { freeBytes: (p) => ({ "/a": 1, "/b": 2, "/c": 3 }[p] ?? null), device: (p) => ({ "/a": 1, "/b": 2, "/c": 3 }[p] ?? null) })).toEqual([{ freeBytes: 1, needs: ["home"] }, { freeBytes: 2, needs: ["data"] }, { freeBytes: 3, needs: ["ai"] }]);
    expect(planVolumes({ program: "/a", data: "/b", ai: "/c" }, { freeBytes: () => 9, device: () => null })).toEqual([{ freeBytes: 9, needs: ["home", "data", "ai"] }]);
  });
});

describe("the shipped table", () => {
  test("every tier's default selection adds up from its rows, and the margin is 20 percent", () => {
    for (const tier of ["p16", "p32", "p64", "p128"] as const) {
      const plan = shippedDiskPlan(tier);
      const totals = selectionTotals(plan, plan.default_selected);
      expect(totals).toEqual(plan.default);
      expect(plan.margin_percent).toBe(20);
    }
  });

  test("the shell reads the same figures: docs flat keys match the tiers", () => {
    const flat = (table as unknown as { installer: Record<string, number> }).installer;
    for (const tier of ["p16", "p32", "p64", "p128"] as const) expect(flat[`${tier}.required_free_bytes`]).toBe(shippedDiskPlan(tier).default.required_free_bytes);
  });

  test("shippedPlanForLevel caps the level by what the computer can run and falls back to the smallest plan", () => {
    expect(shippedPlanForLevel("recommended", { platform: "darwin", totalMemoryBytes: 128 * GIB }).tier).toBe("p128");
    expect(shippedPlanForLevel("moderate", { platform: "darwin", totalMemoryBytes: 128 * GIB }).tier).toBe("p32");
    expect(shippedPlanForLevel("recommended", { platform: "darwin", totalMemoryBytes: 8 * GIB }).tier).toBe("p16");
    expect(shippedPlanForLevel("recommended", { platform: "linux", graphicsGb: () => null }).tier).toBe("p16");
  });

  test("the verdict is red short of the requirement, amber inside the headroom and green past it", () => {
    const plan = shippedDiskPlan("p16");
    const need = plan.default.required_free_bytes;
    const volumes = (free: number) => [{ freeBytes: free, needs: ["home", "ai"] as Array<"home" | "ai"> }];
    expect(diskVerdict(plan, plan.default_selected, volumes(need - 1)).state).toBe("red");
    expect(diskVerdict(plan, plan.default_selected, volumes(need)).state).toBe("amber");
    expect(diskVerdict(plan, plan.default_selected, volumes(need + plan.headroom_warn_bytes)).state).toBe("green");
  });
});
