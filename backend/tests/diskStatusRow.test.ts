// DISK-GUARD-06: the disk sentence on the admin Status row, from the one shared reader (no second reading of its own).
import { afterEach, describe, expect, test } from "bun:test";
import { withDisk, type HostGuardView } from "@/lib/hostGuard";
import { diskStatusVolumes } from "@/lib/storage";
import { __resetStackEngineForTests, __setStackClientForTests } from "@/lib/stackEngine";
import type { StackClient } from "@/lib/stack/client";

afterEach(() => __resetStackEngineForTests());
const base: HostGuardView = { state: "ok", title: "This Mac's self-check", text: "All good." };

describe("the disk sentence", () => {
  test("one volume: the size in plain words, and nothing more while it is normal", () => {
    const view = withDisk(base, [{ who: "home", freeBytes: 420e9, level: "normal" }]);
    expect(view).toEqual({ state: "ok", title: base.title, text: "All good. Disk: about 420 GB free." });
    expect(view.text).not.toMatch(/%|memory|percent/i);
  });
  test("a small size keeps one decimal; a low level says where to go and watches; a critical one is failing", () => {
    expect(withDisk(base, [{ who: "home", freeBytes: 5.5e9, level: "warn" }])).toMatchObject({ state: "watching", text: "All good. Disk: about 5.5 GB free, getting low. Open Settings, Models and storage to free up space." });
    expect(withDisk(base, [{ who: "home", freeBytes: 9e9, level: "critical" }]).state).toBe("failing");
  });
  test("models and data on different volumes each get their own words; no volume adds nothing", () => {
    expect(withDisk(base, [{ who: "stack", freeBytes: 800e9, level: "normal" }, { who: "home", freeBytes: 30e9, level: "warn" }]).text).toBe("All good. Disk: the AI models have about 800 GB free; Home's data has about 30 GB free, getting low. Open Settings, Models and storage to free up space.");
    expect(withDisk(base, [])).toBe(base);
  });
  test("a Stack volume on the same device as Home's own reading wins and is listed once; another device is listed separately", async () => {
    __setStackClientForTests({ disk: async () => ({ level: "warn", volumes: [{ path: process.cwd(), free_bytes: 25e9, total_bytes: 1e12, level: "warn", warn_bytes: 30e9, critical_bytes: 10e9 }], missing: [] }) } as unknown as StackClient);
    const sameDevice = await diskStatusVolumes(() => ({ totalBytes: 1e12, freeBytes: 900e9, device: require("node:fs").statSync(process.cwd()).dev }));
    expect(sameDevice).toEqual([{ who: "stack", freeBytes: 25e9, level: "warn" }]);
    const other = await diskStatusVolumes(() => ({ totalBytes: 1e12, freeBytes: 900e9, device: -1 }));
    expect(other.map((volume) => volume.who)).toEqual(["stack", "home"]);
  });
});
