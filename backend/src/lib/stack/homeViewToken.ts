// ADULT-LOCK-03: Home's half of the Stack's "full view" of an adult job (Stack docs/integrations.md, "Adult jobs: the redacted view and the
// full view"). The Stack redacts an adult job for every caller unless the request carries `x-maipai-view: full` and `x-maipai-home-token: <key>`.
// This module owns the key: where it comes from, the one cached copy, and the Repairs row when it cannot be had. It is never logged, never put in
// an error, never returned from a route and never sent to a browser.
//
// Where the key comes from, first match wins:
//   1. `STACK_HOME_VIEW_TOKEN` in Home's own environment (at least 16 characters): the same value the Stack's unit was given.
//   2. The Stack runs on another computer (`--engine-computer`): the key an admin stored with `PUT /api/engine-link/view-token`, encrypted at rest
//      in `data/keys/stack-link/home-view-token.enc` with the same key store as the pairing passphrase. The pairing carries only the SSH key and
//      the engine's public host key; it has no channel for a secret the engine computer made, so this is the one extra thing an admin supplies.
//   3. The Stack runs on this computer: the file the Stack makes itself, `<Stack data folder>/keys/home-view-token` (mode 600, same user).
//      The Stack makes it at first use, and only when a full-view ask presents some token, so a Home that finds no file asks once with a
//      placeholder on `GET /stack/v1/health` (refused 403, which is how the Stack makes the file; `/healthz` answers before that check and does not)
//      and reads the file again.
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "@/lib/paths";
import { decryptSecret, encryptSecret } from "@/lib/secrets";
import { protectSecretPath } from "@/lib/secretPaths";
import { raiseIssue, resolveIssue } from "@/lib/issues";
import { stackDataDir } from "@/lib/localStackService";
import { isRemoteStackSelected } from "@/lib/stackEngine";

export const MIN_TOKEN_CHARS = 16;
export const VIEW_HEADER = "x-maipai-view";
export const HOME_TOKEN_HEADER = "x-maipai-home-token";
const ISSUE_SOURCE = "stack";
const ISSUE_KEY = "adult.view_key";

const linkDir = join(dataDir, "keys", "stack-link");
const remoteTokenPath = join(linkDir, "home-view-token.enc");
const PLACEHOLDER = "home-asks-the-stack-to-make-its-key";

let cached: { source: string; token: string } | null = null;
let lastPrimeAt = 0;
const PRIME_EVERY_MS = 30_000;
let tokenForTests: string | null | undefined;
/** Test seam: a fixed key (null: none, undefined: the real sources). */
export function __setHomeViewTokenForTests(token: string | null | undefined): void { tokenForTests = token; cached = null; problemChecked = false; lastPrimeAt = 0; }

const usable = (value: string | undefined | null): string | null => { const t = value?.trim() ?? ""; return t.length >= MIN_TOKEN_CHARS ? t : null; };

/** The stored key of a Stack on another computer, or null. */
export function readRemoteViewToken(): string | null {
  try { return existsSync(remoteTokenPath) ? usable(decryptSecret(readFileSync(remoteTokenPath, "utf8"))) : null; } catch { return null; }
}
/** Stores the key an admin copied from the engine computer. Returns false for a value that cannot be a key. */
export function storeRemoteViewToken(token: string): boolean {
  const key = usable(token);
  if (!key) return false;
  mkdirSync(linkDir, { recursive: true, mode: 0o700 });
  protectSecretPath(linkDir);
  writeFileSync(remoteTokenPath, encryptSecret(key), { mode: 0o600 });
  try { chmodSync(remoteTokenPath, 0o600); } catch { /* best effort */ }
  cached = null;
  return true;
}
export function removeRemoteViewToken(): void { rmSync(remoteTokenPath, { force: true }); cached = null; }

function readLocalFile(): string | null {
  try {
    const path = join(stackDataDir(), "keys", "home-view-token");
    return existsSync(path) ? usable(readFileSync(path, "utf8")) : null;
  } catch { return null; }
}

/** Where the key would come from right now: a name for the cache and the Repairs copy, never the value. */
function sourceNow(): "test" | "env" | "remote" | "local" {
  if (tokenForTests !== undefined) return "test";
  if (usable(process.env.STACK_HOME_VIEW_TOKEN)) return "env";
  return isRemoteStackSelected() ? "remote" : "local";
}

function readNow(source: ReturnType<typeof sourceNow>): string | null {
  if (source === "test") return usable(tokenForTests);
  if (source === "env") return usable(process.env.STACK_HOME_VIEW_TOKEN);
  if (source === "remote") return readRemoteViewToken();
  return readLocalFile();
}

/** The key, read once and cached until it is refused. `prime` asks the Stack to make its key file (local Stack, no file yet); null when there is no key. */
export async function homeViewToken(prime?: () => Promise<void>): Promise<string | null> {
  const source = sourceNow();
  if (cached && cached.source === source) return cached.token;
  let token = readNow(source);
  // A Stack that has not made its file yet is asked at most once every PRIME_EVERY_MS (a job polls every second or two).
  if (!token && source === "local" && prime && Date.now() - lastPrimeAt >= PRIME_EVERY_MS) {
    lastPrimeAt = Date.now();
    try { await prime(); } catch { /* an unreachable Stack is the caller's own failure */ }
    token = readNow(source);
  }
  if (token) cached = { source, token };
  return token;
}
/** Forget the cached key (it was refused: the Stack may have a new one). */
export function forgetHomeViewToken(): void { cached = null; }
/** The placeholder a priming ask presents. It is not a key and the Stack refuses it. */
export const PRIMING_TOKEN = PLACEHOLDER;

// ---- Repairs -------------------------------------------------------------------------------------------------------------------------------------

let problemChecked = false;
/** Fixed words: no host, path, key or job detail can enter the row. */
export function viewKeyProblemCopy(): { title: string; detail: string } {
  return isRemoteStackSelected()
    ? { title: "Adult items cannot be opened until Home has the engine's key.", detail: "The engine computer has a key that lets Home open adult items. An admin sets it once in Home for that computer." }
    : { title: "Adult items cannot be opened until the engine's key is readable.", detail: "Home could not read the key the engine keeps for it. Restart the engine from Repairs and try again." };
}
export function reportViewKeyProblem(): void {
  problemChecked = false;
  const copy = viewKeyProblemCopy();
  void raiseIssue({ source: ISSUE_SOURCE, key: ISSUE_KEY, severity: "error", title: copy.title, detail: copy.detail, notifyOnEscalation: false, suppressNotification: true }).catch(() => undefined);
}
/** A full-view ask was answered without a refusal: the row (from this run or an earlier one) closes, once per run. */
export function reportViewKeyWorks(): void {
  if (problemChecked) return;
  problemChecked = true;
  try { resolveIssue(ISSUE_SOURCE, ISSUE_KEY, { suppressNotification: true }); } catch { /* the row stays until the next success */ }
}
