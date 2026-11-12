// HOST-LAUNCH-03: the one end-user line while the system upgrades, through the existing chat health row.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

// The installer writes the flag the hub reads, at the same path (install.sh maintenance_flag_set / _clear).
describe("installer and hub agree on the flag", () => {
  const INSTALL = join(import.meta.dir, "..", "..", "scripts", "install.sh");
  const sh = (script: string, env: Record<string, string>) => Bun.spawnSync(["bash", "-c", `source "${INSTALL}"; ${script}`], { env: { PATH: process.env.PATH!, ...env } });
  test("set writes where the reader looks; the chat row reads upgrading; clear removes it", async () => {
    const root = mkdtempSync(join(tmpdir(), "maint-root-")); dirs.push(root);
    const env = { MAIPAI_DATA_DIR: join(root, "data") };
    {
      const path = sh(`maintenance_flag_path "${root}"`, env).stdout.toString();
      expect(path).toBe(join(env.MAIPAI_DATA_DIR, "local-app", "maintenance.json"));
      expect(sh(`maintenance_flag_set "${root}"`, env).exitCode).toBe(0);
      expect(JSON.parse(readFileSync(path, "utf-8")).until * 1000).toBeGreaterThan(Date.now());
      process.env.MAIPAI_MAINTENANCE_FLAG = path; // what the hub's reader resolves (paths.ts binds dataDir at import)
      expect(maintenanceActive()).toBe(true);
      expect((await roleHealth("chat")).cause).toBe("upgrading");
      sh(`maintenance_flag_clear "${root}"`, env);
      expect(maintenanceActive()).toBe(false);
    }
  });
  test("with no data dir set the live install's data/local-app is used; an expired flag is ignored; an unwritable place never fails the install", () => {
    expect(sh(`maintenance_flag_path /usr/local/maipai-home`, {}).stdout.toString()).toBe("/usr/local/maipai-home/data/local-app/maintenance.json");
    const root = mkdtempSync(join(tmpdir(), "maint-root-")); dirs.push(root);
    const f = join(root, "m.json");
    sh(`maintenance_flag_set "${root}"`, { MAIPAI_MAINTENANCE_FLAG: f, MAIPAI_MAINTENANCE_TTL: "-5" });
    process.env.MAIPAI_MAINTENANCE_FLAG = f; expect(maintenanceActive()).toBe(false);
    expect(sh(`maintenance_flag_set "${root}"; maintenance_flag_clear "${root}"`, { MAIPAI_MAINTENANCE_FLAG: "/proc/none/denied/m.json" }).exitCode).toBe(0);
  });
});
