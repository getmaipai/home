import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { __resetPairingForTests, confirmHostKey, derivePairingLookup, getLinkCredentialStatus, getLinkKeyPaths, getLinkSshAskpassEnvironment, getPairingPublicKey, issuePairingCode, revokeLinkKey, scanHostKey, verifyPairingPayload } from "@/lib/stack/linkKeys";

afterEach(() => { revokeLinkKey(); __resetPairingForTests(); });

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
