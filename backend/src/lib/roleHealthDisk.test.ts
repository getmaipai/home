import { afterEach, describe, expect, test } from "bun:test";
import { __resetMakingHealthForTests, __setRoleHealthForTests, roleHealth } from "@/lib/roleHealth";
import { __resetStackEngineForTests, __setStackClientForTests } from "@/lib/stackEngine";

afterEach(() => { __setRoleHealthForTests({}); __resetMakingHealthForTests(); __resetStackEngineForTests(); });

describe("media role disk readiness", () => {
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
