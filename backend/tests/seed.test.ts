import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reserveFreePort } from "./fixtures/reserveFreePort";
import { waitForBackendPort } from "../../scripts/screenshotRuntime";
import { seedDemoHousehold } from "../../scripts/seed";
import { TOUR_AUTOSTART_SETTING } from "../../scripts/screenshotTourSeed";

const backendDir = join(import.meta.dir, "..");
const dataDir = mkdtempSync(join(tmpdir(), "maipai-seed-test-"));
const backend = Bun.spawn({
  cmd: ["bun", "run", "src/index.ts"], cwd: backendDir,
  env: { ...process.env, MAIPAI_TEST_ALLOW_MULTIPLE_HUBS: "1", MAIPAI_MDNS: "off", PORT: "0", MAIPAI_DATA_DIR: dataDir,
    MAIPAI_BACKUP_DIR: join(dataDir, "backups"), MAIPAI_KEYSTORE_BACKEND: "file", MAIPAI_TTS_DISABLE_SPAWN: "1",
    MAIPAI_KIWIX_PORT: String(reserveFreePort()), MAIPAI_WYOMING_PORT: "0", MAIPAI_BACKGROUND_URL: "http://127.0.0.1:1",
    MAIPAI_LLAMA_SERVER_URL: "", MAIPAI_EMBED_URL: "" }, stdout: "pipe", stderr: "ignore",
});
let base = "";
let seeded: Awaited<ReturnType<typeof seedDemoHousehold>>;
const commandBackends: { process: typeof backend; dataDir: string }[] = [];

async function startBackend(dir: string): Promise<{ process: typeof backend; base: string }> {
  const proc = Bun.spawn({
    cmd: ["bun", "run", "src/index.ts"], cwd: backendDir,
    env: { ...process.env, MAIPAI_TEST_ALLOW_MULTIPLE_HUBS: "1", MAIPAI_MDNS: "off", PORT: "0", MAIPAI_DATA_DIR: dir,
      MAIPAI_BACKUP_DIR: join(dir, "backups"), MAIPAI_KEYSTORE_BACKEND: "file", MAIPAI_TTS_DISABLE_SPAWN: "1",
      MAIPAI_KIWIX_PORT: String(reserveFreePort()), MAIPAI_WYOMING_PORT: "0", MAIPAI_BACKGROUND_URL: "http://127.0.0.1:1",
      MAIPAI_LLAMA_SERVER_URL: "", MAIPAI_EMBED_URL: "" }, stdout: "pipe", stderr: "ignore",
  });
  if (!proc.stdout || typeof proc.stdout === "number") throw new Error("scratch backend has no stdout");
  return { process: proc, base: `http://127.0.0.1:${await waitForBackendPort(proc.stdout, 60_000)}` };
}

beforeAll(async () => {
  if (!backend.stdout || typeof backend.stdout === "number") throw new Error("scratch backend has no stdout");
  base = `http://127.0.0.1:${await waitForBackendPort(backend.stdout, 60_000)}`;
  seeded = await seedDemoHousehold({ baseUrl: base, dataDir });
}, 60_000);

afterAll(() => {
  for (const proc of [backend, ...commandBackends.map((entry) => entry.process)]) { try { proc.kill("SIGKILL"); } catch { /* already exited */ } }
  for (const entry of commandBackends) rmSync(entry.dataDir, { recursive: true, force: true });
  rmSync(dataDir, { recursive: true, force: true });
});

describe("seedDemoHousehold", () => {
  test("creates the three demo people and returns their ids", async () => {
    const response = await fetch(`${base}/api/people`, { headers: { Cookie: seeded.cookie } });
    expect(response.ok).toBe(true);
    const roster = await response.json() as { id: string; display_name: string; role: string }[];
    const demo = roster.filter((person) => ["Sage", "Marlow", "Nova"].includes(person.display_name));
    expect(demo.map((person) => [person.display_name, person.role]).sort()).toEqual([["Marlow", "teen"], ["Nova", "child"], ["Sage", demo.find((person) => person.display_name === "Sage")!.role]].sort());
    expect(Object.values(seeded.people).sort()).toEqual(demo.map((person) => person.id).sort());
    expect(seeded.people.sage).toBe(demo.find((person) => person.display_name === "Sage")!.id);
    expect(seeded.people.marlow).toBe(demo.find((person) => person.display_name === "Marlow")!.id);
    expect(seeded.people.nova).toBe(demo.find((person) => person.display_name === "Nova")!.id);
  }, 60_000);

  test("disables tours for each seeded person", () => {
    const db = new Database(join(dataDir, "hub.db"), { readonly: true });
    try {
      const query = db.query("SELECT value FROM settings_values WHERE scope = ? AND key = ?");
      for (const id of Object.values(seeded.people)) expect(query.get(`person:${id}`, TOUR_AUTOSTART_SETTING)).toEqual({ value: "false" });
    } finally { db.close(); }
  });

  test("sets Seattle as the household home place", async () => {
    const [settingsResponse, entitiesResponse] = await Promise.all([
      fetch(`${base}/api/settings?scope=household`, { headers: { Cookie: seeded.cookie } }),
      fetch(`${base}/api/entities`, { headers: { Cookie: seeded.cookie } }),
    ]);
    expect(settingsResponse.ok).toBe(true);
    expect(entitiesResponse.ok).toBe(true);
    const settings = await settingsResponse.json() as { key: string; value: unknown }[];
    const entities = await entitiesResponse.json() as { id: string; name: string }[];
    const home = settings.find((setting) => setting.key === "household.home")?.value;
    expect(entities.find((entity) => entity.id === home)?.name).toBe("Seattle, WA");
  });

  test("command form prints a JSON result", async () => {
    const dataDir2 = mkdtempSync(join(tmpdir(), "maipai-seed-command-"));
    const { process: proc, base: base2 } = await startBackend(dataDir2);
    commandBackends.push({ process: proc, dataDir: dataDir2 });
    const result = Bun.spawnSync({ cmd: ["bun", "run", "scripts/seed.ts", "--base", base2, "--data-dir", dataDir2], cwd: join(import.meta.dir, "..", ".."), stdout: "pipe", stderr: "pipe" });
    const stderr = new TextDecoder().decode(result.stderr);
    const stdout = new TextDecoder().decode(result.stdout);
    if (result.exitCode !== 0) throw new Error(`seed.ts exited ${result.exitCode}\nstderr: ${stderr}\nstdout: ${stdout}`);
    const parsed = JSON.parse(new TextDecoder().decode(result.stdout)) as { cookie: string; people: Record<string, string> };
    expect(parsed.cookie.startsWith("session=")).toBe(true);
    expect(Object.keys(parsed.people).sort()).toEqual(["marlow", "nova", "sage"]);
    expect(Object.values(parsed.people).every((id) => typeof id === "string" && id.length > 0)).toBe(true);
  }, 60_000);
});
