import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { fetchRawIndex, verifyIndex, verifyEnvelopeSignature, verifyTargetHash, type TargetEntry } from "@/lib/storeIndex";
import { makeKeyPair, sign, buildFixtureIndex } from "./support/tufFixtures";

describe("verifyIndex - the happy path", () => {
  test("a freshly built, correctly signed index verifies clean", () => {
    const built = buildFixtureIndex({});
    const result = verifyIndex(built, { rootPublicKeysPem: [built.rootSigner.publicKeyPem] }, {});
    expect(result.ok).toBe(true);
  });
});

describe("verifyIndex - the tamper suite (docs/PACKAGES.md)", () => {
  test("unknown signer: root.json does not verify against an unrelated pinned key", () => {
    const built = buildFixtureIndex({});
    const impostor = makeKeyPair();
    const result = verifyIndex(built, { rootPublicKeysPem: [impostor.publicKeyPem] }, {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("unknown signer");
  });

  test("unknown signer: targets.json signed by a key root.json never authorized for that role", () => {
    const built = buildFixtureIndex({});
    // Re-sign targets with a brand new key that root's own targets role
    // never lists (simulating an attacker who has SOME valid Ed25519
    // keypair but was never granted the targets role by root).
    const rogueTargets = sign(built.targets.signed, [makeKeyPair()]);
    const result = verifyIndex({ ...built, targets: rogueTargets }, { rootPublicKeysPem: [built.rootSigner.publicKeyPem] }, {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("targets.json: unknown signer");
  });

  test("swapped manifest: a stale-but-validly-signed targets.json served alongside a fresh timestamp", () => {
    // Both targets.json versions are independently well-formed and
    // correctly signed by the real targets key - the attack is serving
    // the OLD one (v1) while timestamp.json (also correctly signed)
    // still points at the hash of the NEW one (v2), the shape a swap at
    // the file-serving layer actually takes rather than a corrupted
    // signature. verifyEnvelopeSignature alone would pass v1; only the
    // hash-pointer check below catches the swap.
    const targetsSigner = makeKeyPair();
    const v1 = buildFixtureIndex({ targetsSigner, targetsVersion: 1 });
    const v2 = buildFixtureIndex({ targetsSigner, targetsVersion: 2 });
    const swapped = { root: v2.root, targets: v1.targets, targetsBytes: v1.targetsBytes, timestamp: v2.timestamp };
    const result = verifyIndex(swapped, { rootPublicKeysPem: [v2.rootSigner.publicKeyPem] }, {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("does not match timestamp.json");
  });

  test("expired timestamp", () => {
    const built = buildFixtureIndex({ timestampExpiresInMs: -1000 });
    const result = verifyIndex(built, { rootPublicKeysPem: [built.rootSigner.publicKeyPem] }, {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("timestamp.json expired");
  });

  test("rolled-back index: a validly-signed, unexpired, but OLDER timestamp is refused", () => {
    const built = buildFixtureIndex({ timestampVersion: 3 });
    const result = verifyIndex(built, { rootPublicKeysPem: [built.rootSigner.publicKeyPem] }, { timestamp: 5 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("rolled back");
  });

  test("rolled-back index: an older targets.json is refused the same way", () => {
    const built = buildFixtureIndex({ targetsVersion: 2 });
    const result = verifyIndex(built, { rootPublicKeysPem: [built.rootSigner.publicKeyPem] }, { targets: 4 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("rolled back");
  });

  test("a version equal to the last seen one is accepted, not treated as a rollback", () => {
    const built = buildFixtureIndex({ timestampVersion: 5 });
    const result = verifyIndex(built, { rootPublicKeysPem: [built.rootSigner.publicKeyPem] }, { timestamp: 5 });
    expect(result.ok).toBe(true);
  });

  test("a newer version advances cleanly past the last seen one", () => {
    const built = buildFixtureIndex({ timestampVersion: 6 });
    const result = verifyIndex(built, { rootPublicKeysPem: [built.rootSigner.publicKeyPem] }, { timestamp: 5 });
    expect(result.ok).toBe(true);
  });

  // Threshold signing exists to survive ONE compromised signer among
  // several - a real gap found by code review: an earlier version of
  // verifyIndex only checked "did SOME authorized key sign this," which
  // is a threshold-1 check regardless of what root.json's own
  // roles.*.threshold field actually declares.
  test("unknown signer: root.json requires 2 pinned keys but only 1 signed it", () => {
    const keyA = makeKeyPair();
    const keyB = makeKeyPair();
    const built = buildFixtureIndex({ rootSigner: keyA });
    const result = verifyIndex(built, { rootPublicKeysPem: [keyA.publicKeyPem, keyB.publicKeyPem], rootThreshold: 2 }, {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("unknown signer");
  });

  test("root.json signed by both of 2 required pinned keys verifies clean", () => {
    const keyA = makeKeyPair();
    const keyB = makeKeyPair();
    const built = buildFixtureIndex({ rootSigner: keyA });
    const doubleSignedRoot = sign(built.root.signed, [keyA, keyB]);
    const result = verifyIndex(
      { ...built, root: doubleSignedRoot },
      { rootPublicKeysPem: [keyA.publicKeyPem, keyB.publicKeyPem], rootThreshold: 2 },
      {},
    );
    expect(result.ok).toBe(true);
  });

  test("unknown signer: targets.json declares a threshold of 2 for its role but only 1 authorized key signed it", () => {
    const signerA = makeKeyPair();
    const signerB = makeKeyPair();
    const built = buildFixtureIndex({ targetsSigner: signerA, targetsRoleKeyids: [signerA, signerB], targetsThreshold: 2 });
    // Only signerA actually signed (buildFixtureIndex's own targets
    // envelope is signed by targetsSigner alone) even though root
    // authorizes both signerA and signerB for the role and requires 2.
    const result = verifyIndex(built, { rootPublicKeysPem: [built.rootSigner.publicKeyPem] }, {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("targets.json: unknown signer");
  });

  test("targets.json signed by both of the 2 keys its role requires verifies clean", () => {
    const signerA = makeKeyPair();
    const signerB = makeKeyPair();
    const built = buildFixtureIndex({ targetsSigner: signerA, targetsRoleKeyids: [signerA, signerB], targetsThreshold: 2 });
    const doubleSignedTargets = sign(built.targets.signed, [signerA, signerB]);
    const targetsBytes = Buffer.from(JSON.stringify(doubleSignedTargets));
    // The timestamp built alongside `built` hashes the SINGLY-signed
    // targets envelope, so it has to be rebuilt against these new bytes
    // too, or the (correct) hash-pointer check would itself fail here.
    const timestampMeta = { ...built.timestamp.signed, meta: { "targets.json": { length: targetsBytes.length, hashes: { sha256: createHash("sha256").update(targetsBytes).digest("hex") } } } };
    const timestamp = sign(timestampMeta, [built.timestampSigner]);
    const result = verifyIndex(
      { root: built.root, targets: doubleSignedTargets, targetsBytes, timestamp },
      { rootPublicKeysPem: [built.rootSigner.publicKeyPem] },
      {},
    );
    expect(result.ok).toBe(true);
  });
});

describe("verifyTargetHash - the bad-hash tamper case", () => {
  const entry: TargetEntry = {
    length: 5,
    hashes: { sha256: createHash("sha256").update("hello").digest("hex") },
    custom: { source_commit: "abc", signer: "primary", min_app: "0.1.0", requires: [], permissions: [], channel: "stable" },
  };

  test("accepts a tarball whose bytes match the recorded hash and length", () => {
    expect(verifyTargetHash(entry, Buffer.from("hello"))).toBe(true);
  });

  test("refuses a tarball with a different length", () => {
    expect(verifyTargetHash(entry, Buffer.from("hello world"))).toBe(false);
  });

  test("refuses a tarball with the same length but different bytes (a bad hash)", () => {
    expect(verifyTargetHash(entry, Buffer.from("HELLO"))).toBe(false);
  });
});

describe("verifyEnvelopeSignature", () => {
  test("a malformed signature is a clean false, never a thrown exception", () => {
    const built = buildFixtureIndex({});
    const tampered = { ...built.root, signatures: [{ keyid: "x", sig: "not-valid-base64!!" }] };
    expect(verifyEnvelopeSignature(tampered, [built.rootSigner.publicKeyPem])).toBe(false);
  });
});

describe("fetchRawIndex", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "maipai-store-index-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("reads and verifies a real index written to a local directory", async () => {
    const built = buildFixtureIndex({});
    writeFileSync(join(dir, "root.json"), JSON.stringify(built.root));
    writeFileSync(join(dir, "targets.json"), built.targetsBytes);
    writeFileSync(join(dir, "timestamp.json"), JSON.stringify(built.timestamp));

    const raw = await fetchRawIndex({ kind: "dir", dir });
    const result = verifyIndex(raw, { rootPublicKeysPem: [built.rootSigner.publicKeyPem] }, {});
    expect(result.ok).toBe(true);
  });

  test("a missing index file throws a clear error rather than a confusing downstream one", async () => {
    mkdirSync(dir, { recursive: true });
    await expect(fetchRawIndex({ kind: "dir", dir })).rejects.toThrow();
  });
});
