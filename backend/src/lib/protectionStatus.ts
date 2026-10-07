import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";

export type CheckState = "on" | "off" | "unknown";
export type CommandOutput = { ok: boolean; stdout: string };
export type CommandRunner = (command: string, args: string[]) => CommandOutput;

function runCommand(command: string, args: string[]): CommandOutput {
  try {
    const stdout = execFileSync(command, args, { encoding: "utf8", timeout: 4000, stdio: ["ignore", "pipe", "ignore"] });
    return { ok: true, stdout };
  } catch {
    return { ok: false, stdout: "" };
  }
}

export function diskEncryptionState(platform: NodeJS.Platform, run: CommandRunner = runCommand): CheckState {
  if (platform === "darwin") {
    const result = run("fdesetup", ["status"]);
    if (!result.ok) return "unknown";
    if (/^FileVault is On\.?\s*$/im.test(result.stdout)) return "on";
    if (/^FileVault is Off\.?\s*$/im.test(result.stdout)) return "off";
    return "unknown";
  }

  if (platform === "win32") {
    const script = "$v=Get-BitLockerVolume -MountPoint $env:SystemDrive; if ($null -eq $v) { exit 2 }; if ($v.ProtectionStatus -eq 'On' -and $v.VolumeStatus -eq 'FullyEncrypted') { 'on' } else { 'off' }";
    const result = run("powershell", ["-NoProfile", "-NonInteractive", "-Command", script]);
    if (!result.ok) return "unknown";
    const value = result.stdout.trim().toLowerCase();
    return value === "on" || value === "off" ? value : "unknown";
  }

  if (platform === "linux") {
    const mount = run("findmnt", ["-n", "-o", "SOURCE", "/"]);
    if (!mount.ok) return "unknown";
    const source = mount.stdout.trim();
    if (source.startsWith("/dev/mapper/")) {
      const state = run("cryptsetup", ["status", basename(source)]);
      if (!state.ok) return "unknown";
      return /^\s*type:\s*(?:LUKS\d*|PLAIN)(?:\s|$)/im.test(state.stdout) ? "on" : "unknown";
    }
    if (/^\/dev\/(?:sd[a-z]\d*|nvme\d+n\d+(?:p\d+)?|vd[a-z]\d*|xvd[a-z]\d*)$/.test(source)) return "off";
    return "unknown";
  }

  return "unknown";
}

export function swapEncryptionState(platform: NodeJS.Platform, run: CommandRunner = runCommand): CheckState {
  if (platform === "darwin") {
    const result = run("sysctl", ["vm.swapusage"]);
    return result.ok && /\bused\s*=\s*\d+(?:\.\d+)?[KMG]?\s*,\s*encrypted\s*=\s*yes\b/i.test(result.stdout) ? "on" : "unknown";
  }
  if (platform === "linux") {
    const result = run("sh", ["-c", "cat /proc/swaps"]);
    if (!result.ok) return "unknown";
    const entries = result.stdout.split(/\r?\n/).slice(1).filter((line) => line.trim().length > 0);
    if (entries.length === 0) return "on";
    return entries.every((line) => /^\/dev\/mapper\//.test(line.split(/\s+/)[0] ?? "")) ? "on" : "unknown";
  }
  if (platform === "win32") return "unknown";
  return "unknown";
}

export function dataDirectoryOwnerOnly(dataDir: string, platform: NodeJS.Platform, uid = process.getuid?.()): CheckState {
  if (platform === "win32" || uid === undefined) return "unknown";
  try {
    const stat = statSync(dataDir);
    if (!stat.isDirectory()) return "off";
    return stat.uid === uid && (stat.mode & 0o777) === 0o700 ? "on" : "off";
  } catch {
    return "unknown";
  }
}

export function keyFileInsideData(dataDir: string): boolean {
  const keysDir = join(dataDir, "keys");
  if (!existsSync(keysDir)) return false;
  try {
    return readdirSync(keysDir, { withFileTypes: true }).some((entry) => entry.isFile() && entry.name.endsWith(".key"));
  } catch {
    return false;
  }
}
