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

// SEC-7 (code review, 2026-09-06): the key material used to be
// interpolated straight into the `-Command` string, visible in Task
// Manager and PowerShell transcript logging for the duration of the
// call - exactly what CLAUDE.md > Credentials and secrets forbids
// ("never pass a secret on a command line or in a process list; use a
// file with restricted permissions or the environment of a child
// process"). The script text itself is now fixed (no interpolation at
// all) and read from stdin (`-Command -` is documented powershell.exe
// behavior: "If the value of Command is '-', the command text is read
// from standard input"); the actual value crosses the process boundary
// only through the CHILD's own environment, which neither Task Manager's
// command-line column nor PowerShell transcript logging (which records
// the command TEXT, not env values) ever shows. Split into a pure
// builder plus the real execFileSync call so the builder itself is
// directly unit-testable without invoking PowerShell at all
// (tests/keystore.test.ts).
const DPAPI_PROTECT_SCRIPT =
  "Add-Type -AssemblyName System.Security; " +
  "$b=[System.Text.Encoding]::UTF8.GetBytes($env:MAIPAI_KEYSTORE_VALUE); " +
  "$e=[System.Security.Cryptography.ProtectedData]::Protect($b,$null,'CurrentUser'); " +
  "[Convert]::ToBase64String($e)";

const DPAPI_UNPROTECT_SCRIPT =
  "Add-Type -AssemblyName System.Security; " +
  "$e=[Convert]::FromBase64String($env:MAIPAI_KEYSTORE_VALUE); " +
  "$d=[System.Security.Cryptography.ProtectedData]::Unprotect($e,$null,'CurrentUser'); " +
  "[System.Text.Encoding]::UTF8.GetString($d)";

export function dpapiProtectInvocation(hex: string): { args: string[]; input: string; env: Record<string, string> } {
  return { args: ["-NoProfile", "-NonInteractive", "-Command", "-"], input: DPAPI_PROTECT_SCRIPT, env: { MAIPAI_KEYSTORE_VALUE: hex } };
}

export function dpapiUnprotectInvocation(blob: string): { args: string[]; input: string; env: Record<string, string> } {
  return { args: ["-NoProfile", "-NonInteractive", "-Command", "-"], input: DPAPI_UNPROTECT_SCRIPT, env: { MAIPAI_KEYSTORE_VALUE: blob.slice(DPAPI_PREFIX.length) } };
}

function dpapiProtect(hex: string): string | null {
  try {
    const { args, input, env } = dpapiProtectInvocation(hex);
    const out = execFileSync("powershell", args, { timeout: 8000, input, env: { ...process.env, ...env } });
    return DPAPI_PREFIX + out.toString().trim();
  } catch {
    return null;
  }
}

function dpapiUnprotect(blob: string): string | null {
  try {
    const { args, input, env } = dpapiUnprotectInvocation(blob);
    const out = execFileSync("powershell", args, { timeout: 8000, input, env: { ...process.env, ...env } });
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

// SEC-7 (code review, 2026-09-06): `-w hex` as an argv element put the
// key material in `ps`/Activity Monitor's command-line column for the
// duration of the call. `security -i` reads the identical command
// syntax from stdin instead (Apple's own documented way to keep
// sensitive `security` invocations out of the process list) - the
// command line macOS actually records for the child is just
// `security -i`, no argument ever carries the secret. Pure builder
// (`keychainWriteCommand`), same reason as the DPAPI ones above: directly
// unit-testable without touching the real keychain. Safe to join with
// plain spaces (no shell involved, and quoting either would need):
// KEYCHAIN_ACCOUNT is a fixed constant and keychainService()'s `name` is
// always one of this file's own fixed internal key names, never
// arbitrary or user-supplied text that could contain a space.
export function keychainWriteCommand(name: string, hex: string): string {
  return `add-generic-password -U -a ${KEYCHAIN_ACCOUNT} -s ${keychainService(name)} -w ${hex}\n`;
}

function keychainWrite(name: string, hex: string): boolean {
  try {
    execFileSync("security", ["-i"], { timeout: 5000, input: keychainWriteCommand(name, hex), stdio: ["pipe", "ignore", "ignore"] });
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
