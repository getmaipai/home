import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readdirSync, utimesSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

test("stale lock takeover is exclusive between concurrent ships", async () => {
  const root = mkdtempSync(join(tmpdir(), "ship-lock-"));
  const lock = join(root, "ship.lock.d"); mkdirSync(lock);
  writeFileSync(join(lock, "pid"), "99999999\n");
  const old = new Date(Date.now() - 300_000); utimesSync(lock, old, old);
  const ship = readFileSync(join(import.meta.dir, "ship.sh"), "utf8");
  const start = ship.indexOf('lock_dir="${MAIPAI_SHIP_LOCK:-$data/ship.lock.d}"');
  const end = ship.indexOf("  trap release_lock EXIT", start);
  const block = ship.slice(start, end);
  const script = `set -euo pipefail\nMAIPAI_SHIP_LOCK="${lock}"; lock_wait=5; held_lock=0; waited=0; data="${root}"; label=test; dry=0\n` +
    `die() { echo "$*" >&2; exit 2; }\nrelease_lock() { if (( held_lock )); then rm -rf "$lock_dir"; held_lock=0; fi; }\n` + block +
    `\necho acquired >> "${root}/owners"; sleep .3; release_lock\nfi`;
  const env = { ...process.env, LOCK: lock };
  const a = spawn("bash", ["-c", script], { env }); const b = spawn("bash", ["-c", script], { env });
  const wait = (child: typeof a) => new Promise<{ code: number; err: string }>((resolve) => { let err = ""; child.stderr?.on("data", (chunk) => err += chunk.toString()); child.on("exit", (code) => resolve({ code: code ?? 1, err })); });
  try {
    const exits = await Promise.all([wait(a), wait(b)]); expect(exits.map((item) => item.code)).toEqual([0, 0]);
    expect(exits.some((item) => item.err.includes("clearing its lock"))).toBe(true);
    expect(readdirSync(root).filter((name) => name.startsWith("ship.lock.d.stale.")).length).toBe(0);
    expect(readFileSync(join(root, "owners"), "utf8").trim().split("\n")).toHaveLength(2);
  } catch (error) { throw error; }
  finally { rmSync(root, { recursive: true, force: true }); }
});
