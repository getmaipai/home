import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "@/lib/paths";
import { randomSuffix } from "@/lib/id";

const PATH = join(dataDir, "device-id6.txt");

let cached: string | null = null;

// The `{device6}` suffix in a memory/entity/episode id (3.1). Not a
// secret, just a stable per-install tag distinguishing which node minted
// an id, so it lives as a plain file rather than in the keystore. A real
// Device record (3.1, deferred, see docs/dev.md) will replace this once
// the link (7) needs a device identity beyond "this hub".
export function getDeviceId6(): string {
  if (cached) return cached;
  if (existsSync(PATH)) {
    const raw = readFileSync(PATH, "utf8").trim();
    if (/^[a-z0-9]{6}$/.test(raw)) {
      cached = raw;
      return raw;
    }
  }
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const fresh = randomSuffix(6);
  writeFileSync(PATH, fresh, { mode: 0o600 });
  cached = fresh;
  return fresh;
}
