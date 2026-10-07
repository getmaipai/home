import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dataDirectoryOwnerOnly, diskEncryptionState, keyFileInsideData, swapEncryptionState, type CommandRunner } from "@/lib/protectionStatus";
import { requestUsesHttps } from "@/lib/trustProxy";

const scratch: string[] = [];
afterEach(() => { for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "protection-check-"));
  scratch.push(dir);
  return dir;
}

test("disk encryption reads the system encryption result on macOS", () => {
  const run: CommandRunner = () => ({ ok: true, stdout: "FileVault is On.\n" });
  expect(diskEncryptionState("darwin", run)).toBe("on");
  expect(diskEncryptionState("darwin", () => ({ ok: true, stdout: "FileVault is Off.\n" }))).toBe("off");
});

test("disk encryption reads the system encryption result on Windows", () => {
  expect(diskEncryptionState("win32", () => ({ ok: true, stdout: "on\r\n" }))).toBe("on");
  expect(diskEncryptionState("win32", () => ({ ok: true, stdout: "off\r\n" }))).toBe("off");
});

test("disk encryption checks the mounted Linux root for an active encrypted device", () => {
  const run: CommandRunner = (command) => command === "findmnt"
    ? { ok: true, stdout: "/dev/mapper/system-root\n" }
    : { ok: true, stdout: "system-root is active.\n  type: LUKS2\n" };
  expect(diskEncryptionState("linux", run)).toBe("on");
  expect(diskEncryptionState("linux", (command) => command === "findmnt"
    ? { ok: true, stdout: "/dev/nvme0n1p2\n" }
    : { ok: false, stdout: "" })).toBe("off");
});

test("swap is checked where its state can be read safely", () => {
  expect(swapEncryptionState("linux", () => ({ ok: true, stdout: "Filename Type Size Used Priority\n" }))).toBe("on");
  expect(swapEncryptionState("linux", () => ({ ok: true, stdout: "Filename Type Size Used Priority\n/dev/mapper/swapfile file 1 0 -2\n" }))).toBe("on");
  expect(swapEncryptionState("linux", () => ({ ok: true, stdout: "Filename Type Size Used Priority\n/swapfile file 1 0 -2\n" }))).toBe("unknown");
  expect(swapEncryptionState("win32")).toBe("unknown");
});

test("an unavailable encryption check stays unknown", () => {
  expect(diskEncryptionState("darwin", () => ({ ok: false, stdout: "" }))).toBe("unknown");
  expect(diskEncryptionState("linux", () => ({ ok: false, stdout: "" }))).toBe("unknown");
  expect(diskEncryptionState("freebsd", () => ({ ok: true, stdout: "" }))).toBe("unknown");
});

test("the data folder check requires owner-only mode 700", () => {
  const dir = tempDir();
  chmodSync(dir, 0o700);
  expect(dataDirectoryOwnerOnly(dir, "darwin", process.getuid?.())).toBe("on");
  chmodSync(dir, 0o750);
  expect(dataDirectoryOwnerOnly(dir, "linux", process.getuid?.())).toBe("off");
  expect(dataDirectoryOwnerOnly(dir, "win32", process.getuid?.())).toBe("unknown");
});

test("the key check returns only whether a file-backed key exists", () => {
  const dir = tempDir();
  mkdirSync(join(dir, "keys"));
  expect(keyFileInsideData(dir)).toBe(false);
  writeFileSync(join(dir, "keys", "secret_pepper.key"), "not returned");
  expect(keyFileInsideData(dir)).toBe(true);
});

test("HTTPS uses forwarded protocol only behind a trusted proxy", () => {
  expect(requestUsesHttps("http://hub.local/status", "https", false)).toBe(false);
  expect(requestUsesHttps("http://hub.local/status", "https", true)).toBe(true);
  expect(requestUsesHttps("https://hub.local/status", undefined, false)).toBe(true);
});
