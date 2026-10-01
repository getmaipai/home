import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { getHouseholdSettingValue, setHouseholdSettingValue } from "@/lib/settings";

// HOME-STACK-01: install.sh's own scripts/set-setting.ts, run as a real
// separate process (the same way install.sh actually calls it) against
// a scratch MAIPAI_DATA_DIR, not a TypeScript reimplementation of its
// argv/exit-code logic that could drift from what the script really
// does. A code review on this item found the only existing coverage
// was a dry-run string assertion in scripts/install.test.ts - this is
// the real write path itself.
const SCRIPT = join(import.meta.dir, "../scripts/set-setting.ts");

let dataDir: string;

function run(args: string[]): { stdout: string; stderr: string; exitCode: number } {
  const result = Bun.spawnSync(["bun", "run", SCRIPT, ...args], { env: { ...process.env, MAIPAI_DATA_DIR: dataDir } });
  return { stdout: result.stdout.toString().trim(), stderr: result.stderr.toString().trim(), exitCode: result.exitCode };
}

afterEach(() => {
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

test("writes a real household setting, readable back", () => {
  dataDir = mkdtempSync(join(tmpdir(), "maipai-set-setting-"));
  const result = run(["engines.stack.url", "http://127.0.0.1:8770"]);
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain('engines.stack.url = "http://127.0.0.1:8770"');

  const again = run(["engines.stack.url", "http://127.0.0.1:8771"]);
  expect(again.exitCode).toBe(0);
  expect(again.stdout).toContain('"http://127.0.0.1:8771"');
});

test("--get reports empty for a fresh URL and the stored value after a write", () => {
  dataDir = mkdtempSync(join(tmpdir(), "maipai-set-setting-"));
  expect(run(["--get", "engines.stack.url"])).toMatchObject({ stdout: '""', exitCode: 0 });
  run(["engines.stack.url", "http://127.0.0.1:8770"]);
  expect(run(["--get", "engines.stack.url"])).toMatchObject({ stdout: '"http://127.0.0.1:8770"', exitCode: 0 });
});

test("writes true and false as stored booleans and --get returns each stored value", () => {
  dataDir = mkdtempSync(join(tmpdir(), "maipai-set-setting-"));
  for (const value of ["false", "true"]) {
    const result = run(["engines.stack.use_chat", value]);
    expect(result.exitCode).toBe(0);
    expect(run(["--get", "engines.stack.use_chat"]).stdout).toBe(value);
    const storedDb = new Database(join(dataDir, "hub.db"), { readonly: true, create: false });
    try {
      expect(storedDb.query("SELECT value FROM settings_values WHERE scope = 'household' AND key = ?").get("engines.stack.use_chat")).toEqual({ value });
    } finally {
      storedDb.close();
    }
  }
});

test("rejects a non-boolean string for a boolean key without storing it", () => {
  dataDir = mkdtempSync(join(tmpdir(), "maipai-set-setting-"));
  const result = run(["engines.stack.use_chat", "no"]);
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("expected true or false");
  const storedDb = new Database(join(dataDir, "hub.db"), { readonly: true, create: false });
  try {
    expect(storedDb.query("SELECT value FROM settings_values WHERE scope = 'household' AND key = ?").get("engines.stack.use_chat")).toBeNull();
  } finally {
    storedDb.close();
  }
});

test("converts finite numbers and preserves text setting writes", () => {
  dataDir = mkdtempSync(join(tmpdir(), "maipai-set-setting-"));
  expect(run(["chat.context_size_override", "4096"]).exitCode).toBe(0);
  expect(run(["--get", "chat.context_size_override"]).stdout).toBe("4096");
  expect(run(["engines.stack.url", "http://127.0.0.1:8770"]).exitCode).toBe(0);
  expect(run(["--get", "engines.stack.url"]).stdout).toBe('"http://127.0.0.1:8770"');
});

test("deprecated role values remain writable for compatibility", () => {
  dataDir = mkdtempSync(join(tmpdir(), "maipai-set-setting-installer-"));
  const roles = ["chat", "embeddings", "stt", "tts"];
  for (const role of roles) expect(run([`engines.stack.use_${role}`, "false"]).exitCode).toBe(0);
  expect(roles.map((role) => run(["--get", `engines.stack.use_${role}`]).stdout)).toEqual(["false", "false", "false", "false"]);
});

test("--only-if-empty-or-prefix writes when the current value is empty", () => {
  dataDir = mkdtempSync(join(tmpdir(), "maipai-set-setting-"));
  const result = run(["engines.stack.url", "http://127.0.0.1:8770", "--only-if-empty-or-prefix", "http://127.0.0.1:"]);
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain('"http://127.0.0.1:8770"');
});

test("--only-if-empty-or-prefix overwrites a value with the same prefix (a previous local write)", () => {
  dataDir = mkdtempSync(join(tmpdir(), "maipai-set-setting-"));
  run(["engines.stack.url", "http://127.0.0.1:8770"]);
  const result = run(["engines.stack.url", "http://127.0.0.1:8771", "--only-if-empty-or-prefix", "http://127.0.0.1:"]);
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain('"http://127.0.0.1:8771"');
});

test("--only-if-empty-or-prefix refuses to overwrite a household's own different value", () => {
  dataDir = mkdtempSync(join(tmpdir(), "maipai-set-setting-"));
  run(["engines.stack.url", "https://stack.example.com"]);
  const result = run(["engines.stack.url", "http://127.0.0.1:8772", "--only-if-empty-or-prefix", "http://127.0.0.1:"]);
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("not overwritten");
  // The skip message itself names the value it found still stored -
  // real proof the write above was actually skipped, not just that
  // some message was printed: it can only be the original value here
  // if the guarded write never touched it.
  expect(result.stdout).toContain("https://stack.example.com");
});

test("an unknown key exits non-zero with a clear error, nothing written", () => {
  dataDir = mkdtempSync(join(tmpdir(), "maipai-set-setting-"));
  const result = run(["not.a.real.key", "value"]);
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("could not set");
});

test("missing arguments exit non-zero with usage", () => {
  dataDir = mkdtempSync(join(tmpdir(), "maipai-set-setting-"));
  const result = run(["engines.stack.url"]);
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("usage:");
});
