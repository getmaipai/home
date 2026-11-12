// HOST-LAUNCH-03: the one end-user line while the system upgrades, through the existing chat health row.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { composerNotice } from "@/lib/failureCopy";
import { maintenanceActive } from "@/lib/maintenanceFlag";
import { roleHealth, __setRoleHealthForTests } from "@/lib/roleHealth";

const dirs: string[] = [];
function flag(content: string): void {
  const d = mkdtempSync(join(tmpdir(), "maint-")); dirs.push(d);
  writeFileSync(join(d, "m.json"), content);
  process.env.MAIPAI_MAINTENANCE_FLAG = join(d, "m.json");
}
afterEach(() => { delete process.env.MAIPAI_MAINTENANCE_FLAG; __setRoleHealthForTests({}); for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe("maintenance flag", () => {
  test("a future until is active; an expired, malformed or missing flag is not", () => {
    flag(JSON.stringify({ until: Date.now() / 1000 + 60 })); expect(maintenanceActive()).toBe(true);
    flag(JSON.stringify({ until: Date.now() / 1000 - 1 })); expect(maintenanceActive()).toBe(false);
    flag("not json"); expect(maintenanceActive()).toBe(false);
    process.env.MAIPAI_MAINTENANCE_FLAG = "/nonexistent/m.json"; expect(maintenanceActive()).toBe(false);
  });
  test("the chat row reads unavailable with cause upgrading", async () => {
    flag(JSON.stringify({ until: Date.now() / 1000 + 60 }));
    const h = await roleHealth("chat");
    expect(h.availability).toBe("unavailable");
    expect(h.cause).toBe("upgrading");
  });
  test("every band reads the one short line, with no resource words", () => {
    const n = composerNotice("unavailable", "upgrading")!;
    for (const line of [n.adult, n.teen, n.child]) {
      expect(line).toBe("Chat is unavailable while the system upgrades.");
      expect(line).not.toMatch(/memory|RAM|\bGB\b|room|engine/i);
    }
    expect(n.repairs_link).toBeNull();
  });
});
