import { describe, expect, test, beforeEach } from "bun:test";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import forge from "node-forge";
import { resetDb } from "./reset-db";
import { dataDir } from "@/lib/paths";
import { detectLanIps } from "@/lib/hubEndpoints";
import { encryptSecret, __resetSecretsKeyCacheForTests } from "@/lib/secrets";
import { __resetFixHandlersForTests, fixIssue, listIssues, raiseIssue } from "@/lib/issues";
import {
  ensureHouseholdCa,
  ensureHouseholdLeaf,
  checkLeafExpiry,
  hasHouseholdLeaf,
  getHouseholdCaCertificate,
  getHouseholdLeafForServer,
  onLeafRenewed,
  registerRenewFixHandler,
  __resetHouseholdCaForTests,
  __clearLeafRenewedListenersForTests,
} from "@/lib/householdCa";

// Mirrors writeKeyFile()'s own encrypt-before-write (lib/secrets) - a
// hand-crafted test leaf has to look exactly like what the real module
// would have written, or readKeyFile() fails to decrypt it.
function writeLeafFiles(certPem: string, keyPem: string): void {
  const keysDir = join(dataDir, "keys");
  mkdirSync(keysDir, { recursive: true });
  writeFileSync(join(keysDir, "hub-leaf-cert.pem"), certPem);
  writeFileSync(join(keysDir, "hub-leaf-key.pem"), encryptSecret(keyPem));
}

beforeEach(() => {
  resetDb();
  __resetFixHandlersForTests();
  __resetHouseholdCaForTests();
  __clearLeafRenewedListenersForTests();
  __resetSecretsKeyCacheForTests();
});

describe("ensureHouseholdCa()", () => {
  test("mints a real, self-signed CA certificate on first call", async () => {
    const ca = await ensureHouseholdCa();
    const cert = forge.pki.certificateFromPem(ca.certPem);
    expect(cert.subject.getField("CN")?.value).toBe("MaiPai Home Household CA");
    // Self-signed: the cert verifies against its own public key.
    expect(cert.verify(cert)).toBe(true);
    const basicConstraints = cert.getExtension("basicConstraints") as { cA?: boolean } | null;
    expect(basicConstraints?.cA).toBe(true);
  });

  test("returns the same CA on every later call, not a fresh one", async () => {
    const first = await ensureHouseholdCa();
    const second = await ensureHouseholdCa();
    expect(second.certPem).toBe(first.certPem);
    expect(second.keyPem).toBe(first.keyPem);
  });
});

describe("ensureHouseholdLeaf()", () => {
  test("mints a leaf certificate genuinely signed by the household CA", async () => {
    const ca = await ensureHouseholdCa();
    const leaf = await ensureHouseholdLeaf();
    const caCert = forge.pki.certificateFromPem(ca.certPem);
    const leafCert = forge.pki.certificateFromPem(leaf.certPem);
    expect(caCert.verify(leafCert)).toBe(true);
    const basicConstraints = leafCert.getExtension("basicConstraints") as { cA?: boolean } | null;
    expect(basicConstraints?.cA).toBe(false);
  });

  test("covers maipai.local in its subjectAltName", async () => {
    const leaf = await ensureHouseholdLeaf();
    const cert = forge.pki.certificateFromPem(leaf.certPem);
    const san = cert.getExtension("subjectAltName") as { altNames?: Array<{ value?: string }> } | null;
    expect(san?.altNames?.some((a) => a.value === "maipai.local")).toBe(true);
  });

  test("a second call with nothing changed returns the identical certificate, not a fresh one", async () => {
    const first = await ensureHouseholdLeaf();
    const second = await ensureHouseholdLeaf();
    expect(second.certPem).toBe(first.certPem);
  });

  test("regenerates when the on-disk leaf is already expired", async () => {
    // Mint a real CA, then hand-craft an already-expired leaf under it -
    // exactly the shape ensureHouseholdLeaf() would find on disk from a
    // very old install, proving the expiry check triggers a real
    // regeneration rather than trusting whatever's already there.
    const ca = await ensureHouseholdCa();
    const caCert = forge.pki.certificateFromPem(ca.certPem);
    const caKey = forge.pki.privateKeyFromPem(ca.keyPem);
    const keys = forge.pki.rsa.generateKeyPair(1024); // small/fast - this cert is thrown away immediately
    const staleCert = forge.pki.createCertificate();
    staleCert.publicKey = keys.publicKey;
    staleCert.serialNumber = "01";
    staleCert.validity.notBefore = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
    staleCert.validity.notAfter = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000); // expired well past the 30-day warning window
    staleCert.setSubject([{ name: "commonName", value: "maipai.local" }]);
    staleCert.setIssuer(caCert.subject.attributes);
    staleCert.sign(caKey, forge.md.sha256.create());
    writeLeafFiles(forge.pki.certificateToPem(staleCert), forge.pki.privateKeyToPem(keys.privateKey));

    const fresh = await ensureHouseholdLeaf();
    expect(fresh.certPem).not.toBe(forge.pki.certificateToPem(staleCert));
    const cert = forge.pki.certificateFromPem(fresh.certPem);
    expect(cert.validity.notAfter.getTime()).toBeGreaterThan(Date.now());
  });

  // COR-3 (code review, 2026-09-06): stillGood used to check only expiry
  // and address coverage, never whether the leaf actually chains to the
  // CA currently on disk - exactly the damage a first-run race (two
  // concurrent ensureHouseholdCa() callers, whichever's write ran second
  // silently replacing the first's CA file) leaves behind: a leaf still
  // individually valid, signed by a CA that's no longer the one on disk.
  test("regenerates when the on-disk leaf doesn't chain to the CA currently on disk", async () => {
    const firstLeaf = await ensureHouseholdLeaf();

    // Simulate exactly that damage: the CA file gets replaced while the
    // leaf - signed under the OLD CA - is left untouched.
    const keysDir = join(dataDir, "keys");
    rmSync(join(keysDir, "household-ca-cert.pem"));
    rmSync(join(keysDir, "household-ca-key.pem"));

    const secondLeaf = await ensureHouseholdLeaf();
    expect(secondLeaf.certPem).not.toBe(firstLeaf.certPem);
    const newCa = await ensureHouseholdCa();
    const caCert = forge.pki.certificateFromPem(newCa.certPem);
    const leafCert = forge.pki.certificateFromPem(secondLeaf.certPem);
    expect(caCert.verify(leafCert)).toBe(true);
  });

  test("fires onLeafRenewed() when it actually regenerates, never when it returns the cached leaf", async () => {
    let calls = 0;
    onLeafRenewed(() => {
      calls++;
    });
    await ensureHouseholdLeaf(); // first real mint
    expect(calls).toBe(1);
    await ensureHouseholdLeaf(); // nothing changed - the cached leaf is still good
    expect(calls).toBe(1);
  });

  // COR-3 (code review, 2026-09-06): two concurrent first-run callers
  // (two devices opening the trust page at once) each used to see no CA/
  // leaf on disk and each mint their own - whichever's write ran second
  // silently overwrote the first's, and fired onLeafRenewed() twice for
  // what should be a single event. singleflight() makes every concurrent
  // caller share the SAME mint.
  test("two concurrent ensureHouseholdCa() calls on an empty keys dir produce exactly one CA", async () => {
    const [first, second] = await Promise.all([ensureHouseholdCa(), ensureHouseholdCa()]);
    expect(second.certPem).toBe(first.certPem);
    expect(second.keyPem).toBe(first.keyPem);
  });

  test("two concurrent ensureHouseholdLeaf() calls on an empty keys dir produce one CA and a leaf that verifies against it, firing onLeafRenewed() exactly once", async () => {
    let calls = 0;
    onLeafRenewed(() => {
      calls++;
    });
    const [first, second] = await Promise.all([ensureHouseholdLeaf(), ensureHouseholdLeaf()]);
    expect(second.certPem).toBe(first.certPem);
    expect(calls).toBe(1);

    const ca = await ensureHouseholdCa();
    const caCert = forge.pki.certificateFromPem(ca.certPem);
    const leafCert = forge.pki.certificateFromPem(first.certPem);
    expect(caCert.verify(leafCert)).toBe(true);
  });
});

describe("hasHouseholdLeaf()/getHouseholdLeafForServer()", () => {
  test("false before any leaf is minted, true after", async () => {
    expect(hasHouseholdLeaf()).toBe(false);
    await ensureHouseholdLeaf();
    expect(hasHouseholdLeaf()).toBe(true);
  });

  test("getHouseholdLeafForServer returns a cert/key pair that actually match", async () => {
    await ensureHouseholdLeaf();
    const { cert, key } = getHouseholdLeafForServer();
    // A real TLS-shape check: the private key must actually correspond
    // to the certificate's public key, not just be "some PEM string".
    const parsedCert = forge.pki.certificateFromPem(cert);
    const parsedKey = forge.pki.privateKeyFromPem(key);
    const derivedPublic = forge.pki.setRsaPublicKey(parsedKey.n, parsedKey.e);
    expect(forge.pki.publicKeyToPem(derivedPublic)).toBe(forge.pki.publicKeyToPem(parsedCert.publicKey));
  });
});

describe("getHouseholdCaCertificate()", () => {
  test("returns only the certificate, mints on first call", async () => {
    const pem = await getHouseholdCaCertificate();
    expect(pem).toContain("BEGIN CERTIFICATE");
    expect(pem).not.toContain("PRIVATE KEY");
  });
});

// A code review (2026-09-06) found the CA/leaf private keys written as
// raw plaintext PEM - exactly what CLAUDE.md's "any reversible secret...
// is encrypted with the keystore, never plaintext in a table or JSON
// file" rule exists to prevent. This proves the fix: the on-disk key
// file is never the plaintext PEM, and the real read path still
// recovers a working key pair from it.
describe("private key encryption at rest", () => {
  test("the on-disk key file is never the plaintext PEM", async () => {
    const ca = await ensureHouseholdCa();
    const onDisk = await Bun.file(join(dataDir, "keys", "household-ca-key.pem")).text();
    expect(onDisk).not.toContain("PRIVATE KEY");
    expect(onDisk).not.toBe(ca.keyPem);
  });

  test("the leaf key file round-trips through encryption to the same usable key", async () => {
    const leaf = await ensureHouseholdLeaf();
    const { key } = getHouseholdLeafForServer();
    expect(key).toBe(leaf.keyPem);
  });
});

describe("checkLeafExpiry()", () => {
  test("raises no issue when nothing has been minted yet", async () => {
    await checkLeafExpiry();
    expect(listIssues()).toHaveLength(0);
  });

  test("raises no issue for a freshly-minted, far-from-expiry leaf", async () => {
    await ensureHouseholdLeaf();
    await checkLeafExpiry();
    expect(listIssues()).toHaveLength(0);
  });

  test("raises a real Repairs issue with a working fix when the leaf is expiring soon, and the fix resolves it", async () => {
    const ca = await ensureHouseholdCa();
    const caCert = forge.pki.certificateFromPem(ca.certPem);
    const caKey = forge.pki.privateKeyFromPem(ca.keyPem);
    const keys = forge.pki.rsa.generateKeyPair(1024);
    const soonExpiring = forge.pki.createCertificate();
    soonExpiring.publicKey = keys.publicKey;
    soonExpiring.serialNumber = "01";
    soonExpiring.validity.notBefore = new Date();
    soonExpiring.validity.notAfter = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000); // 5 days out, inside the 30-day warning window
    soonExpiring.setSubject([{ name: "commonName", value: "maipai.local" }]);
    soonExpiring.setIssuer(caCert.subject.attributes);
    // Full SAN coverage (matching what a real leaf would carry) so this
    // test isolates the expiry check alone - a cert missing SAN entries
    // would also trip the separate leaf_stale coverage check below.
    const altNames = ["maipai.local", ...detectLanIps()];
    soonExpiring.setExtensions([
      {
        name: "subjectAltName",
        altNames: altNames.map((name) => (/^\d+\.\d+\.\d+\.\d+$/.test(name) ? { type: 7, ip: name } : { type: 2, value: name })),
      },
    ]);
    soonExpiring.sign(caKey, forge.md.sha256.create());
    writeLeafFiles(forge.pki.certificateToPem(soonExpiring), forge.pki.privateKeyToPem(keys.privateKey));

    await checkLeafExpiry();
    const issues = listIssues();
    expect(issues).toHaveLength(1);
    expect(issues[0]!.source).toBe("householdCa");
    expect(issues[0]!.key).toBe("leaf_expiring");
    expect(issues[0]!.fix).toEqual({ label: "Renew now", action: "renew_household_leaf" });

    const result = await fixIssue(issues[0]!.id);
    expect(result.ok).toBe(true);
    expect(listIssues()).toHaveLength(0);
    // The fix actually renewed it - a fresh, far-future-valid leaf now on disk.
    expect(hasHouseholdLeaf()).toBe(true);
    const { cert } = getHouseholdLeafForServer();
    expect(forge.pki.certificateFromPem(cert).validity.notAfter.getTime()).toBeGreaterThan(Date.now() + 300 * 24 * 60 * 60 * 1000);
  });

  // A code review (2026-09-06) found the first version of checkLeafExpiry()
  // only ever checked expiry, never whether the leaf still covers the
  // machine's current addresses - a LAN address change (a new DHCP lease)
  // would go unnoticed forever unless someone happened to hit
  // GET /api/setup/ca again. This proves the coverage check independently
  // of expiry, with a cert that is otherwise far from expiring.
  test("raises leaf_stale (not leaf_expiring) when a far-from-expiry leaf no longer covers the machine's current addresses, and the fix resolves it", async () => {
    const ca = await ensureHouseholdCa();
    const caCert = forge.pki.certificateFromPem(ca.certPem);
    const caKey = forge.pki.privateKeyFromPem(ca.keyPem);
    const keys = forge.pki.rsa.generateKeyPair(1024);
    const staleCoverage = forge.pki.createCertificate();
    staleCoverage.publicKey = keys.publicKey;
    staleCoverage.serialNumber = "01";
    staleCoverage.validity.notBefore = new Date();
    staleCoverage.validity.notAfter = addYearsForTest(1); // far from expiring
    staleCoverage.setSubject([{ name: "commonName", value: "old-address.invalid" }]);
    staleCoverage.setIssuer(caCert.subject.attributes);
    // Deliberately covers an address this machine does NOT have, and
    // none of the ones it does - the exact shape a stale DHCP-era leaf
    // would have.
    staleCoverage.setExtensions([{ name: "subjectAltName", altNames: [{ type: 2, value: "old-address.invalid" }] }]);
    staleCoverage.sign(caKey, forge.md.sha256.create());
    writeLeafFiles(forge.pki.certificateToPem(staleCoverage), forge.pki.privateKeyToPem(keys.privateKey));

    await checkLeafExpiry();
    const issues = listIssues();
    expect(issues).toHaveLength(1);
    expect(issues[0]!.source).toBe("householdCa");
    expect(issues[0]!.key).toBe("leaf_stale");
    expect(issues[0]!.fix).toEqual({ label: "Renew now", action: "renew_household_leaf" });

    const result = await fixIssue(issues[0]!.id);
    expect(result.ok).toBe(true);
    expect(listIssues()).toHaveLength(0);
    const { cert } = getHouseholdLeafForServer();
    expect(forge.pki.certificateFromPem(cert).subject.getField("CN")?.value).not.toBe("old-address.invalid");
  });
});

// A code review (2026-09-06) found registerRenewFixHandler() only ever
// called lazily from inside ensureHouseholdLeaf()/checkLeafExpiry() -
// neither of which the boot path calls (it only checks
// hasHouseholdLeaf(), a pure existence check). A leaf_expiring/
// leaf_stale issue raised in a PREVIOUS process run survives a restart
// in the issues table, so its "Renew now" fix had no handler behind it
// until the daily job or a setup-page hit happened to register one.
// index.ts now calls registerRenewFixHandler() unconditionally at boot;
// this proves that call is what actually closes the gap.
describe("registerRenewFixHandler() (what index.ts calls at boot, unconditionally)", () => {
  test("without it, a fix registered by nothing else fails - proving the boot call is load-bearing", async () => {
    await raiseIssue({
      source: "householdCa",
      key: "leaf_expiring",
      severity: "warning",
      title: "test",
      detail: "test",
      fix: { label: "Renew now", action: "renew_household_leaf" },
    });
    const [issue] = listIssues();
    const result = await fixIssue(issue!.id);
    expect(result.ok).toBe(false);
  });

  test("calling it directly (as index.ts does at boot, before anything else touches the CA) makes the fix work", async () => {
    registerRenewFixHandler();
    await raiseIssue({
      source: "householdCa",
      key: "leaf_expiring",
      severity: "warning",
      title: "test",
      detail: "test",
      fix: { label: "Renew now", action: "renew_household_leaf" },
    });
    const [issue] = listIssues();
    const result = await fixIssue(issue!.id);
    expect(result.ok).toBe(true);
    expect(hasHouseholdLeaf()).toBe(true);
  });
});

function addYearsForTest(years: number): Date {
  const d = new Date();
  d.setFullYear(d.getFullYear() + years);
  return d;
}
