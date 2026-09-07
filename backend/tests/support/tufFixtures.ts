// Shared test-only TUF-shaped index fixtures for tests/storeIndex.test.ts
// and tests/store.test.ts. Deliberately NOT a reuse of catalog's own
// tools/src/index-builder.ts (a real cross-repo dependency neither
// repo's build supports - the same reason storeIndex.ts itself is a
// hand-written twin of that file's algorithm, not an import of it).
// Before this file existed, both test files hand-copied the identical
// canonicalize/sign/makeKeyPair logic (a real gap found by code review:
// three independent copies of the same signing algorithm - this one,
// storeIndex.ts's own production copy, and a second test copy - meant a
// canonicalization change in production could silently drift out of
// sync with what the tests actually verify against). This is the ONE
// test-side copy now; storeIndex.ts's own production copy remains
// independent on purpose (different repo boundary, different trust
// boundary), the two test files no longer duplicate each other.
import { generateKeyPairSync, sign as cryptoSign, createHash } from "node:crypto";
import type { SignedEnvelope, RootMetadata, TargetsMetadata, TimestampMetadata, TargetEntry } from "@/lib/storeIndex";

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as object).sort()) sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    return sorted;
  }
  return value;
}

export function canonicalize(obj: unknown): Buffer {
  return Buffer.from(JSON.stringify(sortKeysDeep(obj)));
}

export interface KeyPair {
  keyid: string;
  publicKeyPem: string;
  privateKeyPem: string;
}

export function makeKeyPair(): KeyPair {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }) as string;
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  const keyid = createHash("sha256").update(publicKey.export({ type: "spki", format: "der" })).digest("hex");
  return { keyid, publicKeyPem, privateKeyPem };
}

export function sign<T>(signed: T, signers: KeyPair[]): SignedEnvelope<T> {
  const bytes = canonicalize(signed);
  return {
    signed,
    signatures: signers.map((s) => ({ keyid: s.keyid, sig: cryptoSign(null, bytes, s.privateKeyPem).toString("base64") })),
  };
}

const DAY = 24 * 3_600_000;

export interface FixtureOptions {
  rootSigner?: KeyPair;
  targetsSigner?: KeyPair;
  timestampSigner?: KeyPair;
  rootVersion?: number;
  targetsVersion?: number;
  timestampVersion?: number;
  rootExpiresInMs?: number;
  targetsExpiresInMs?: number;
  timestampExpiresInMs?: number;
  targets?: Record<string, TargetEntry>;
  /** Every key allowed to sign root.json - defaults to [rootSigner].
   * `roleSigners` below lets a test declare MORE authorized keys than
   * actually sign, the shape a threshold check needs to be tested at all. */
  rootRoleKeyids?: KeyPair[];
  targetsRoleKeyids?: KeyPair[];
  timestampRoleKeyids?: KeyPair[];
  rootThreshold?: number;
  targetsThreshold?: number;
  timestampThreshold?: number;
}

export interface BuiltFixture {
  root: SignedEnvelope<RootMetadata>;
  targets: SignedEnvelope<TargetsMetadata>;
  targetsBytes: Buffer;
  timestamp: SignedEnvelope<TimestampMetadata>;
  rootSigner: KeyPair;
  targetsSigner: KeyPair;
  timestampSigner: KeyPair;
}

export function buildFixtureIndex(opts: FixtureOptions): BuiltFixture {
  const rootSigner = opts.rootSigner ?? makeKeyPair();
  const targetsSigner = opts.targetsSigner ?? makeKeyPair();
  const timestampSigner = opts.timestampSigner ?? makeKeyPair();

  const rootRoleKeyids = opts.rootRoleKeyids ?? [rootSigner];
  const targetsRoleKeyids = opts.targetsRoleKeyids ?? [targetsSigner];
  const timestampRoleKeyids = opts.timestampRoleKeyids ?? [timestampSigner];
  const allKeys = [rootSigner, targetsSigner, timestampSigner, ...rootRoleKeyids, ...targetsRoleKeyids, ...timestampRoleKeyids];
  const keys: RootMetadata["keys"] = {};
  for (const k of allKeys) keys[k.keyid] = { keytype: "ed25519", public: k.publicKeyPem };

  const rootMeta: RootMetadata = {
    type: "root",
    version: opts.rootVersion ?? 1,
    expires: new Date(Date.now() + (opts.rootExpiresInMs ?? 365 * DAY)).toISOString(),
    keys,
    roles: {
      root: { keyids: rootRoleKeyids.map((k) => k.keyid), threshold: opts.rootThreshold ?? 1 },
      targets: { keyids: targetsRoleKeyids.map((k) => k.keyid), threshold: opts.targetsThreshold ?? 1 },
      timestamp: { keyids: timestampRoleKeyids.map((k) => k.keyid), threshold: opts.timestampThreshold ?? 1 },
    },
  };
  const root = sign(rootMeta, [rootSigner]);

  const targetsMeta: TargetsMetadata = {
    type: "targets",
    version: opts.targetsVersion ?? 1,
    expires: new Date(Date.now() + (opts.targetsExpiresInMs ?? 365 * DAY)).toISOString(),
    targets: opts.targets ?? {
      "plugins/utilities/weather/0.1.0": {
        length: 100,
        hashes: { sha256: "a".repeat(64) },
        custom: { source_commit: "abc123", signer: "primary", min_app: "0.1.0", requires: [], permissions: [], channel: "stable" },
      },
    },
  };
  const targets = sign(targetsMeta, [targetsSigner]);
  // What actually sits in targets.json ON DISK is the FULL signed
  // envelope (matching catalog's own writeEnvelope()), not just the bare
  // `signed` payload - timestamp.json's own hash pointer is computed
  // over exactly those file bytes (catalog's buildTimestamp() hashes
  // `readFileSync(targetsPath)`, the real file it just wrote).
  const targetsBytes = Buffer.from(JSON.stringify(targets));

  const timestampMeta: TimestampMetadata = {
    type: "timestamp",
    version: opts.timestampVersion ?? 1,
    expires: new Date(Date.now() + (opts.timestampExpiresInMs ?? 30 * DAY)).toISOString(),
    meta: {
      "targets.json": {
        length: targetsBytes.length,
        hashes: { sha256: createHash("sha256").update(targetsBytes).digest("hex") },
      },
    },
  };
  const timestamp = sign(timestampMeta, [timestampSigner]);

  return { root, targets, targetsBytes, timestamp, rootSigner, targetsSigner, timestampSigner };
}
