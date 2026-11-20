import { afterEach, describe, expect, test } from "bun:test";
import { __resetMakingHealthForTests, __setRoleHealthForTests, roleHealth } from "@/lib/roleHealth";
import { __resetStackEngineForTests, __setStackClientForTests, rememberDiskRefusalForTests } from "@/lib/stackEngine";
import { FAILURE_COPY, makingNotice, stackRefusalKind } from "@/lib/failureCopy";

afterEach(() => { __setRoleHealthForTests({}); __resetMakingHealthForTests(); __resetStackEngineForTests(); });

describe("media role disk readiness", () => {
  test("typed refusal kind maps to disk without reading its copy", async () => {
    __setStackClientForTests({ roles: async () => ({ roles: [] }), memory: async () => ({ watchdog: {} }) } as never);
    rememberDiskRefusalForTests("chat");
    await expect(roleHealth("chat")).resolves.toMatchObject({ cause: "disk" });
    expect(stackRefusalKind("offline", "memory is low", "disk")).toBe("disk");
  });
  test("disk copy has four safe audience variants", () => {
    const lines = [FAILURE_COPY.disk.adult, FAILURE_COPY.disk.adultNoRepairs!, makingNotice("image", "unavailable", "disk")!.teen, makingNotice("image", "unavailable", "disk")!.child];
    expect(lines[0]).toContain("Settings, Models and storage");
    expect(lines[1]).toContain("whoever looks after this hub");
    expect(lines.slice(2)).toEqual(["That is paused for now.", "That is paused for now."]);
    for (const line of lines) expect(line).not.toMatch(/\d|\bGB\b|memory/i);
  });
  test("critical Stack disk marks pictures, video and music unavailable with disk cause", async () => {
    __setStackClientForTests({
      roles: async () => ({ roles: [{}] }),
      disk: async () => ({ level: "critical", volumes: [], missing: [] }),
      memory: async () => ({ watchdog: { generation_paused: false } }),
      getCodingMode: async () => { throw new Error("not needed"); },
    } as never);
    for (const role of ["image", "video", "music"] as const) {
      await expect(roleHealth(role)).resolves.toMatchObject({ availability: "unavailable", cause: "disk" });
    }
  });
});
