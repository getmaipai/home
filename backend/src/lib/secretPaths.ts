import { chmodSync, existsSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";

/** Apply the credential directory/file ACL in the policy on every write
 * and at startup. Windows gets explicit service-account, SYSTEM and
 * Administrators ACEs; POSIX gets owner-only access. */
export function protectSecretPath(path: string): void {
  const isDirectory = statSync(path).isDirectory();
  if (process.platform !== "win32") {
    chmodSync(path, isDirectory ? 0o700 : 0o600);
    return;
  }
  const who = spawnSync("whoami", [], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
  const account = who.stdout.trim();
  if (who.error || who.status !== 0 || !account) throw new Error("Could not determine the service account for credential permissions");
  const inheritance = isDirectory ? "(OI)(CI)F" : "F";
  const secured = spawnSync("icacls", [path, "/inheritance:r", "/grant:r", `${account}:${inheritance}`, `*S-1-5-18:${inheritance}`, `*S-1-5-32-544:${inheritance}`], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "ignore", "ignore"] });
  if (secured.error || secured.status !== 0) throw new Error("Could not restrict credential file permissions");
}

export function protectExistingSecretPaths(paths: string[]): void {
  for (const path of paths) if (existsSync(path)) protectSecretPath(path);
}
