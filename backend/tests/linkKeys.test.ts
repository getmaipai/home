import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { __resetPairingForTests, getLinkCredentialStatus, getLinkKeyPaths, getPairingPublicKey, issuePairingCode, revokeLinkKey, verifyPairingPayload } from "@/lib/stack/linkKeys";

afterEach(() => { revokeLinkKey(); __resetPairingForTests(); });

describe("engine link pairing credentials", () => {
  test("expires after ten minutes and is single use", () => {
    const issued = issuePairingCode(10_000);
    expect(issued.code).toMatch(/^[A-Z2-7]{12}$/);
    expect(getPairingPublicKey(issued.code, "household-1", 10_000 + 10 * 60_000)).toBeNull();
    const second = issuePairingCode(10_000);
    const payload = getPairingPublicKey(second.code, "household-1", 10_001);
    expect(payload?.household_id).toBe("household-1");
    expect(getPairingPublicKey(second.code, "household-1", 10_002)).toBeNull();
  });

  test("stops after five failed attempts", () => {
    const issued = issuePairingCode(1_000);
    for (let i = 0; i < 5; i++) expect(getPairingPublicKey("AAAAAAAAAAAA", "household-1", 1_001 + i)).toBeNull();
    expect(getPairingPublicKey(issued.code, "household-1", 1_010)).toBeNull();
  });

  test("HMAC binds both returned values and refuses a mismatch", () => {
    const issued = issuePairingCode();
    const payload = getPairingPublicKey(issued.code, "household-1")!;
    expect(verifyPairingPayload(issued.code, payload)).toBe(true);
    expect(verifyPairingPayload(issued.code, { ...payload, household_id: "other-household" })).toBe(false);
    expect(verifyPairingPayload(issued.code, { ...payload, public_key: `${payload.public_key} changed` })).toBe(false);
  });

  test("keeps the private key out of pairing output and stores an encrypted OpenSSH key", () => {
    const issued = issuePairingCode();
    const payload = getPairingPublicKey(issued.code, "household-1")!;
    const paths = getLinkKeyPaths();
    const privateKey = readFileSync(paths.privateKeyPath, "utf8");
    expect(payload.public_key).not.toContain("PRIVATE KEY");
    expect(JSON.stringify({ issued, payload })).not.toContain(privateKey);
    expect(privateKey).toContain("BEGIN OPENSSH PRIVATE KEY");
    expect(spawnSync("ssh-keygen", ["-y", "-P", "", "-f", paths.privateKeyPath], { stdio: "ignore" }).status).not.toBe(0);
    if (process.platform !== "win32") {
      expect(statSync(paths.privateKeyPath).mode & 0o777).toBe(0o600);
      expect(statSync(dirname(paths.knownHostsPath)).mode & 0o777).toBe(0o700);
    }
    expect(getLinkCredentialStatus()).toEqual({ paired: false });
    expect(existsSync(paths.knownHostsPath)).toBe(false);
  });
});
