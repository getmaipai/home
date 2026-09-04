// Keeps at-rest encryption keys (the PIN/password pepper, later the secrets
// AES key) OUT of the SQLite database, so a copied hub.db is useless
// without a second file. Platform plan 4.12 and CLAUDE.md > Credentials and
// secrets: "the keystore key held by DPAPI under the service account on
// Windows and by the OS keyring on macOS and Linux with a written recovery
// path." Adapted from the legacy hub's lib/keystore.ts (principle 8: this
// is hard-won logic, reused; the legacy app_settings migration path is
// dropped, there is nothing to migrate from in a fresh install).
//
// Storage per platform:
//   - macOS:   the login Keychain (via `security`), falling back to the key file.
//   - Windows: the key file, its contents DPAPI-protected (CurrentUser scope).
//   - Linux:   a 0600 hex key file (same trust boundary as the DB file itself).
// An operator-set env var always takes precedence; callers own that check.

import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { dataDir } from "@/lib/paths";

const KEYS_DIR = join(dataDir, "keys");
const KEYCHAIN_ACCOUNT = "maipai-home";
const DPAPI_PREFIX = "dpapi:";

function keyFile(name: string): string {
  return join(KEYS_DIR, `${name}.key`);
}

// Marks that a key was successfully provisioned into the OS keychain, so
// a LATER read failure can be told apart from "never provisioned yet". A
// code review (2026-09-04) found readStored() treating "not found" and
// "keychain unreadable" identically: `security find-generic-password`
// returns null for both a genuinely first-ever run AND a locked/headless
// keychain on a machine that already has a key in it. Treating the second
// case as "not found" silently mints and persists a brand-new pepper,
// which makes every existing person's stored PIN/password hash
// unverifiable (they were hashed with the old pepper), a silent,
// permanent household-wide lockout with no error anywhere. This marker
// (not a secret, just a flag) lets readStored refuse instead of silently
// minting when it can tell a key SHOULD be there.
function keychainMarkerFile(name: string): string {
  return join(KEYS_DIR, `${name}.keychain-marker`);
}

// Exported (not just internal): this is the actual new decision logic,
// separate from the real macOS Keychain calls above, which tests
// deliberately never exercise (MAIPAI_KEYSTORE_BACKEND=file exists
// specifically so a test run never touches the developer's real login
// keychain). Testing these directly is how that new logic gets covered
// without touching the real keychain.
export function markKeychainProvisioned(name: string): void {
  ensureKeysDir();
  try {
    writeFileSync(keychainMarkerFile(name), "1", { mode: 0o600 });
  } catch {
    /* best-effort; a failed write here just means we fall back to
     * silent-remint behavior for this key, no worse than before this fix */
  }
}

export function wasKeychainProvisioned(name: string): boolean {
  return existsSync(keychainMarkerFile(name));
}

export class KeystoreUnavailableError extends Error {
  constructor(name: string) {
    super(
      `Keystore key "${name}" was previously provisioned into the OS keychain ` +
        `but can't be read right now (locked, headless, or the keychain service ` +
        `is unavailable). Refusing to generate a replacement key: doing so would ` +
        `silently invalidate every secret hashed or encrypted with the original ` +
        `one. Unlock the keychain (or run this as an interactive session once) ` +
        `and retry.`,
    );
    this.name = "KeystoreUnavailableError";
  }
}

function ensureKeysDir(): void {
  if (!existsSync(KEYS_DIR)) mkdirSync(KEYS_DIR, { recursive: true, mode: 0o700 });
  try {
    chmodSync(KEYS_DIR, 0o700);
  } catch {
    /* best-effort on non-POSIX */
  }
}

// ── Windows DPAPI (CurrentUser) via PowerShell ──────────────────────────

function dpapiProtect(hex: string): string | null {
  try {
    const ps =
      "Add-Type -AssemblyName System.Security; " +
      `$b=[System.Text.Encoding]::UTF8.GetBytes('${hex}'); ` +
      "$e=[System.Security.Cryptography.ProtectedData]::Protect($b,$null,'CurrentUser'); " +
      "[Convert]::ToBase64String($e)";
    const out = execFileSync(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-Command", ps],
      { timeout: 8000 },
    );
    return DPAPI_PREFIX + out.toString().trim();
  } catch {
    return null;
  }
}

function dpapiUnprotect(blob: string): string | null {
  try {
    const b64 = blob.slice(DPAPI_PREFIX.length);
    const ps =
      "Add-Type -AssemblyName System.Security; " +
      `$e=[Convert]::FromBase64String('${b64}'); ` +
      "$d=[System.Security.Cryptography.ProtectedData]::Unprotect($e,$null,'CurrentUser'); " +
      "[System.Text.Encoding]::UTF8.GetString($d)";
    const out = execFileSync(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-Command", ps],
      { timeout: 8000 },
    );
    return out.toString().trim();
  } catch {
    return null;
  }
}

// ── macOS Keychain via `security` ───────────────────────────────────────

function keychainService(name: string): string {
  return `com.maipai-home.keystore.${name}`;
}

function keychainRead(name: string): string | null {
  try {
    const out = execFileSync(
      "security",
      [
        "find-generic-password",
        "-a",
        KEYCHAIN_ACCOUNT,
        "-s",
        keychainService(name),
        "-w",
      ],
      { timeout: 5000, stdio: ["ignore", "pipe", "ignore"] },
    );
    const val = out.toString().trim();
    return val || null;
  } catch {
    return null; // not found, or the keychain is locked (headless) -> file fallback
  }
}

function keychainWrite(name: string, hex: string): boolean {
  try {
    execFileSync(
      "security",
      [
        "add-generic-password",
        "-U",
        "-a",
        KEYCHAIN_ACCOUNT,
        "-s",
        keychainService(name),
        "-w",
        hex,
      ],
      { timeout: 5000, stdio: "ignore" },
    );
    return true;
  } catch {
    return false;
  }
}

// ── File store (universal fallback / primary off-macOS) ──────────────────

function fileRead(name: string): string | null {
  const path = keyFile(name);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf8").trim();
    if (raw.startsWith(DPAPI_PREFIX)) {
      const dec = dpapiUnprotect(raw);
      return dec && /^[0-9a-fA-F]+$/.test(dec) ? dec : null;
    }
    return /^[0-9a-fA-F]+$/.test(raw) ? raw : null;
  } catch {
    return null;
  }
}

function fileWrite(name: string, hex: string): void {
  ensureKeysDir();
  const path = keyFile(name);
  const body = process.platform === "win32" ? (dpapiProtect(hex) ?? hex) : hex;
  writeFileSync(path, body, { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    /* best-effort on non-POSIX */
  }
}

// ── Platform-aware read/write ─────────────────────────────────────────────

// Escape hatch for tests: writing to the real macOS Keychain on every test
// run would leave `com.maipai-home.keystore.*` entries behind on the
// developer's actual login keychain. tests/preload.ts sets this.
const FORCE_FILE_BACKEND = process.env.MAIPAI_KEYSTORE_BACKEND === "file";

function readStored(name: string): string | null {
  if (process.platform === "darwin" && !FORCE_FILE_BACKEND) {
    const fromChain = keychainRead(name);
    if (fromChain && /^[0-9a-fA-F]+$/.test(fromChain)) {
      // Mark on a successful READ too, not only on write: a code review
      // (2026-09-04) found the marker only got set by writeStored(), so a
      // key that was already in the Keychain before this fix shipped (or
      // provisioned some other way) had no marker and the protection
      // didn't apply to it until the next write, missing the exact
      // upgrade scenario the fix exists for.
      markKeychainProvisioned(name);
      return fromChain;
    }
    if (wasKeychainProvisioned(name)) throw new KeystoreUnavailableError(name);
  }
  return fileRead(name);
}

function writeStored(name: string, hex: string): void {
  if (process.platform === "darwin" && !FORCE_FILE_BACKEND && keychainWrite(name, hex)) {
    markKeychainProvisioned(name);
    return;
  }
  fileWrite(name, hex);
}

// ── Public API ─────────────────────────────────────────────────────────

/** Resolve, or create, a hex key kept outside the database. */
export function getOrCreateHexKey(name: string, bytes = 32): string {
  const existing = readStored(name);
  if (existing) return existing;
  const fresh = randomBytes(bytes).toString("hex");
  writeStored(name, fresh);
  return fresh;
}
