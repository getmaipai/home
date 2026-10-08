import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, statSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { utils as sshUtils } from "ssh2";
import { __resetPairingForTests, __setLinkKeyCommandForTests, confirmHostKey, derivePairingLookup, getLinkCredentialStatus, getLinkKeyPaths, getLinkSshAskpassEnvironment, getPairingPublicKey, hostKeyCheckCode, issuePairingCode, revokeLinkKey, scanHostKey, verifyPairingPayload } from "@/lib/stack/linkKeys";

afterEach(() => { revokeLinkKey(); __resetPairingForTests(); __setLinkKeyCommandForTests(null); });

describe("engine link pairing credentials", () => {
  test("expires after ten minutes and is single use", () => {
    const issued = issuePairingCode(10_000); expect(issued.code).toMatch(/^[A-Z2-7]{12}$/);
    expect(getPairingPublicKey(derivePairingLookup(issued.code), "household-1", 10_000 + 10 * 60_000)).toBeNull();
    const second = issuePairingCode(10_000); const payload = getPairingPublicKey(derivePairingLookup(second.code), "household-1", 10_001);
    expect(payload?.household_id).toBe("household-1"); expect(getPairingPublicKey(derivePairingLookup(second.code), "household-1", 10_002)).toBeNull();
  });
  test("bad lookups are constant time checked but do not exhaust the valid code for everyone", () => {
    const issued = issuePairingCode();
    for (let i = 0; i < 20; i++) expect(getPairingPublicKey("0".repeat(32), "household-1")).toBeNull();
    expect(getPairingPublicKey(derivePairingLookup(issued.code), "household-1")).not.toBeNull();
  });
  test("derives lookup and MAC from normalized dashed or uppercase code", () => {
    expect(derivePairingLookup("ABCD-EFGH-JKLM")).toBe(derivePairingLookup("abcdefghjklm"));
    const issued = issuePairingCode(); const payload = getPairingPublicKey(derivePairingLookup(issued.code), "household-1")!;
    expect(verifyPairingPayload(issued.code.toLowerCase(), payload)).toBe(true);
    expect(verifyPairingPayload(issued.code, { ...payload, household_id: "other" })).toBe(false);
    expect(verifyPairingPayload(issued.code, { ...payload, hmac: "zz" })).toBe(false);
  });
  test("SHA-256 host fingerprint check codes differ between ed25519 hosts", () => {
    const first = sshUtils.generateKeyPairSync("ed25519", { format: "new" }).public.trim();
    const second = sshUtils.generateKeyPairSync("ed25519", { format: "new" }).public.trim();
    expect(hostKeyCheckCode(first)).not.toBe(hostKeyCheckCode(second));
  });
  test("matches ssh-keygen SHA256 fingerprint bytes for a known host key", () => {
    const line = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPoISQD6sKkxbk5FD8YL6LuvYzhXACmFp4cr8oleBk1h known-vector";
    const folder = mkdtempSync(join(tmpdir(), "pair1d-known-host-"));
    const path = join(folder, "host.pub");
    try {
      writeFileSync(path, line);
      const fingerprint = spawnSync("ssh-keygen", ["-lf", path, "-E", "sha256"], { encoding: "utf8" });
      expect(fingerprint.status).toBe(0);
      const encoded = fingerprint.stdout.match(/SHA256:([^\s]+)/)?.[1];
      expect(encoded).toBe("zj6OfpYgJaRfYytqKm342NNJmzrPjjoH6zmAUXs/Ps4");
      expect(hostKeyCheckCode(line)).toBe("ZY7I47UWEAS2");
    } finally { rmSync(folder, { recursive: true, force: true }); }
  });
  test("pairing completes in issue, fetch, scan, confirm order and lookup is case-insensitive", async () => {
    const issued = issuePairingCode();
    const publicKey = getPairingPublicKey(derivePairingLookup(issued.code).toUpperCase(), "household-1");
    expect(publicKey?.household_id).toBe("household-1");
    const publicBlob = "AAAAC3NzaC1lZDI1NTE5AAAAIPoISQD6sKkxbk5FD8YL6LuvYzhXACmFp4cr8oleBk1h";
    __setLinkKeyCommandForTests(async () => ({ code: 0, stdout: `engine.local ssh-ed25519 ${publicBlob} test\n` }));
    const scanned = await scanHostKey("engine.local", 22);
    confirmHostKey(scanned.check_code);
    expect(getLinkCredentialStatus()).toEqual({ paired: true });
    expect(getPairingPublicKey(derivePairingLookup(issued.code), "household-1")).toBeNull();
  });
  test("scan requires a public key fetch", async () => {
    issuePairingCode();
    __setLinkKeyCommandForTests(async () => ({ code: 0, stdout: "engine.local ssh-ed25519 AAAA test\n" }));
    await expect(scanHostKey("engine.local", 22)).rejects.toThrow();
  });
  test("keeps the private key out of pairing output and stores an encrypted OpenSSH key", () => {
    const issued = issuePairingCode(); const payload = getPairingPublicKey(derivePairingLookup(issued.code), "household-1")!; const paths = getLinkKeyPaths();
    const privateKey = readFileSync(paths.privateKeyPath, "utf8"); expect(payload.public_key).not.toContain("PRIVATE KEY"); expect(JSON.stringify({ issued, payload })).not.toContain(privateKey);
    expect(privateKey).toContain("BEGIN OPENSSH PRIVATE KEY");
    expect(spawnSync("ssh-keygen", ["-y", "-P", "", "-f", paths.privateKeyPath], { stdio: "ignore" }).status).not.toBe(0);
    if (process.platform !== "win32") { expect(statSync(paths.privateKeyPath).mode & 0o777).toBe(0o600); expect(statSync(dirname(paths.knownHostsPath)).mode & 0o777).toBe(0o700); }
    expect(getLinkCredentialStatus()).toEqual({ paired: false }); expect(existsSync(paths.knownHostsPath)).toBe(false);
  });
  test("provides a minimal SSH environment and revoke removes askpass helper", () => {
    issuePairingCode(); const env = getLinkSshAskpassEnvironment();
    expect(Object.keys(env).sort()).toEqual(["DISPLAY", "HOME", "MAIPAI_LINK_ASKPASS", "PATH", "SSH_ASKPASS", "SSH_ASKPASS_REQUIRE"].sort());
    expect(env).not.toHaveProperty("NODE_OPTIONS"); expect(existsSync(getLinkKeyPaths().askpassPath)).toBe(true);
    revokeLinkKey(); expect(existsSync(getLinkKeyPaths().askpassPath)).toBe(false);
  });
  test("a wrong check code cannot confirm and expired pairing cannot scan or confirm", () => {
    issuePairingCode(1000);
    expect(() => confirmHostKey("000000000000")).toThrow();
    expect(scanHostKey("engine.local", 22)).rejects.toThrow();
  });
});
