// Verifies the TUF-shaped signed catalog index (session-d-packages-and-
// store.md step 6, docs/PACKAGES.md's "Apps refuse an expired or
// rolled-back index, verify every package twice..., never downgrade
// without an explicit rollback, and hold one pinned store URL"). This
// is the hub's OWN independent verification, not a reuse of catalog's
// `tools/src/index-builder.ts` (a real cross-repo dependency neither
// repo's build supports today - the same reason `schema/` is mirrored
// by a plain copy script rather than imported live): the types and the
// canonicalization algorithm below are a deliberate, field-for-field
// TWIN of that file's, so a signature produced there verifies here.
// Different runtime, different trust boundary, the same reason MCP
// itself has independent client and server implementations agreeing on
// one wire contract rather than one shared module.
import { createHash, createPublicKey, verify as cryptoVerify } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface SignedEnvelope<T> {
  signed: T;
  signatures: { keyid: string; sig: string }[];
}

export interface RootMetadata {
  type: "root";
  version: number;
  expires: string;
  keys: Record<string, { keytype: "ed25519"; public: string }>;
  roles: {
    root: { keyids: string[]; threshold: number };
    targets: { keyids: string[]; threshold: number };
    timestamp: { keyids: string[]; threshold: number };
  };
}

export interface TargetEntry {
  length: number;
  hashes: { sha256: string };
  custom: {
    source_commit: string;
    signer: string;
    min_app: string;
    requires: string[];
    permissions: string[];
    channel: "stable" | "beta";
    changelog_url?: string;
  };
}

export interface TargetsMetadata {
  type: "targets";
  version: number;
  expires: string;
  targets: Record<string, TargetEntry>;
}

export interface TimestampMetadata {
  type: "timestamp";
  version: number;
  expires: string;
  meta: { "targets.json": { length: number; hashes: { sha256: string } } };
}

// Identical to catalog's own tools/src/index-builder.ts sortKeysDeep():
// arrays keep their real order (a target's own requires/permissions
// lists are meaningful sequences), every object's own keys sort
// recursively so two builds of the identical logical metadata always
// sign (and verify against) the same bytes regardless of key insertion
// order.
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as object).sort()) {
      sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

function canonicalize<T>(obj: T): Buffer {
  return Buffer.from(JSON.stringify(sortKeysDeep(obj)));
}

function verifyBytes(data: Buffer, signatureBase64: string, publicKeyPem: string): boolean {
  try {
    return cryptoVerify(null, data, createPublicKey(publicKeyPem), Buffer.from(signatureBase64, "base64"));
  } catch {
    // A malformed signature or public key is a verification FAILURE,
    // never an exception a caller has to special-case - the tamper
    // suite relies on this returning false for every malformed-input
    // shape it tries, the identical contract catalog's own sign.ts
    // verifyBytes() makes.
    return false;
  }
}

/** How many DISTINCT keys in `candidatePems` produced a valid signature
 * over `envelope`'s own `signed` content - the real building block
 * threshold signing needs (a real gap found by code review: an earlier
 * version treated "some candidate key signed it" as sufficient on its
 * own, which is only a threshold-1 check; root.json can declare a
 * higher threshold per role and it must actually be enforced, or
 * compromising ONE signer among several is enough to forge an update).
 * Counts distinct KEYS satisfied, not distinct signatures - two
 * signatures from the same key toward a threshold of 2 must not count
 * twice. */
function countSatisfiedKeys<T>(envelope: SignedEnvelope<T>, candidatePems: string[]): number {
  const bytes = canonicalize(envelope.signed);
  let satisfied = 0;
  for (const pem of candidatePems) {
    if (envelope.signatures.some((sig) => verifyBytes(bytes, sig.sig, pem))) satisfied++;
  }
  return satisfied;
}

/** True if at least `threshold` of `candidatePems` each produced one of
 * `envelope`'s own signatures - exported for tests and for any future
 * caller that only needs a plain "does this envelope satisfy this key
 * set" check without needing the exact count. */
export function verifyEnvelopeSignature<T>(envelope: SignedEnvelope<T>, candidatePems: string[], threshold = 1): boolean {
  return countSatisfiedKeys(envelope, candidatePems) >= threshold;
}

export interface RawIndex {
  root: SignedEnvelope<RootMetadata>;
  targets: SignedEnvelope<TargetsMetadata>;
  targetsBytes: Buffer;
  timestamp: SignedEnvelope<TimestampMetadata>;
}

export type IndexSource = { kind: "dir"; dir: string } | { kind: "url"; baseUrl: string };

/** Reads the three index files from `source` - a local directory (dev,
 * tests, and today's "install from the local index" acceptance case) or
 * an HTTP base URL (the real pinned store URL, once one exists). Raw,
 * unverified: `verifyIndex()` below is the only function that may treat
 * anything this returns as trustworthy. */
export async function fetchRawIndex(source: IndexSource): Promise<RawIndex> {
  const read = async (name: string): Promise<Buffer> => {
    if (source.kind === "dir") return readFileSync(join(source.dir, name));
    const res = await fetch(`${source.baseUrl.replace(/\/$/, "")}/${name}`);
    if (!res.ok) throw new Error(`fetching ${name} from ${source.baseUrl} failed: HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  };
  const [rootBytes, targetsBytes, timestampBytes] = await Promise.all([read("root.json"), read("targets.json"), read("timestamp.json")]);
  return {
    root: JSON.parse(rootBytes.toString("utf-8")),
    targets: JSON.parse(targetsBytes.toString("utf-8")),
    targetsBytes,
    timestamp: JSON.parse(timestampBytes.toString("utf-8")),
  };
}

export interface TrustConfig {
  /** The out-of-band pinned root key(s) - bootstrap trust, never learned
   * from the index itself. A real production key is Jesse's own call,
   * still deferred (catalog's own index-builder.ts buildRoot() carries
   * the identical note); tests and today's local-index install pass
   * whatever keypair built the index under test. */
  rootPublicKeysPem: string[];
  /** How many of `rootPublicKeysPem` must have signed root.json - the
   * CLIENT's own pinned threshold, deliberately independent of whatever
   * root.json's own `roles.root.threshold` field claims: trusting a
   * root's self-reported threshold for verifying ITSELF would let a
   * malicious root simultaneously declare and satisfy threshold 1.
   * Defaults to 1 (any single pinned key), matching every root built so
   * far (index-builder.ts's own threshold is always 1 today) - raise
   * this once a real key-loss recovery procedure and a genuine 2-of-2
   * signing ceremony exist. */
  rootThreshold?: number;
}

/** The highest version this hub has ever seen for each role - TUF's own
 * rollback defense (docs/PACKAGES.md's "a rolled-back index" tamper
 * case): an expiry check alone only catches STALENESS, never a
 * deliberate rollback to an older, still-unexpired, validly-signed
 * file. `lib/store.ts` persists this in the `store_index_state` table
 * (survives a reboot - an in-memory-only high-water mark would let a
 * restart un-remember a rollback attempt). Absent fields mean "never
 * seen," accepting whatever version comes first. */
export interface LastSeenVersions {
  root?: number;
  targets?: number;
  timestamp?: number;
}

export interface VerifiedIndex {
  root: RootMetadata;
  targets: TargetsMetadata;
  timestamp: TimestampMetadata;
}

export type VerifyResult = { ok: true; index: VerifiedIndex } | { ok: false; error: string };

function keysForRole(root: RootMetadata, role: "targets" | "timestamp"): string[] {
  return root.roles[role].keyids.map((keyid) => root.keys[keyid]?.public).filter((pem): pem is string => Boolean(pem));
}

/** The full tamper suite in one function (docs/PACKAGES.md: "a bad hash,
 * a swapped manifest, an expired timestamp, a rolled-back index, and an
 * unknown signer are all refused on hub and robot, with a clear message
 * and no partial unpack"). A bad-hash check for one specific package's
 * own tarball is `verifyTargetHash()` below - a per-package check that
 * only makes sense against an already-verified index, so it isn't part
 * of this function. Every other case is checked here, in order, each
 * with its own clear, distinct error so a Repairs item can say exactly
 * which one fired. */
export function verifyIndex(raw: RawIndex, trust: TrustConfig, lastSeen: LastSeenVersions): VerifyResult {
  const now = Date.now();
  const rootThreshold = trust.rootThreshold ?? 1;

  if (!verifyEnvelopeSignature(raw.root, trust.rootPublicKeysPem, rootThreshold)) {
    return {
      ok: false,
      error: `root.json: unknown signer (fewer than ${rootThreshold} of the pinned root key(s) signed it)`,
    };
  }
  const root = raw.root.signed;
  if (new Date(root.expires).getTime() <= now) {
    return { ok: false, error: `root.json expired at ${root.expires}` };
  }
  if (lastSeen.root !== undefined && root.version < lastSeen.root) {
    return { ok: false, error: `root.json rolled back: version ${root.version} is older than the last seen version ${lastSeen.root}` };
  }

  const targetsKeys = keysForRole(root, "targets");
  if (!verifyEnvelopeSignature(raw.targets, targetsKeys, root.roles.targets.threshold)) {
    return {
      ok: false,
      error: `targets.json: unknown signer (fewer than root.json's own required ${root.roles.targets.threshold} key(s) for the targets role signed it)`,
    };
  }
  const targets = raw.targets.signed;
  if (new Date(targets.expires).getTime() <= now) {
    return { ok: false, error: `targets.json expired at ${targets.expires}` };
  }
  if (lastSeen.targets !== undefined && targets.version < lastSeen.targets) {
    return {
      ok: false,
      error: `targets.json rolled back: version ${targets.version} is older than the last seen version ${lastSeen.targets}`,
    };
  }

  const timestampKeys = keysForRole(root, "timestamp");
  if (!verifyEnvelopeSignature(raw.timestamp, timestampKeys, root.roles.timestamp.threshold)) {
    return {
      ok: false,
      error: `timestamp.json: unknown signer (fewer than root.json's own required ${root.roles.timestamp.threshold} key(s) for the timestamp role signed it)`,
    };
  }
  const timestamp = raw.timestamp.signed;
  if (new Date(timestamp.expires).getTime() <= now) {
    return { ok: false, error: `timestamp.json expired at ${timestamp.expires}` };
  }
  if (lastSeen.timestamp !== undefined && timestamp.version < lastSeen.timestamp) {
    return {
      ok: false,
      error: `timestamp.json rolled back: version ${timestamp.version} is older than the last seen version ${lastSeen.timestamp}`,
    };
  }

  // The freshness anchor's own hash pointer: even a targets.json that is
  // independently well-formed and validly signed must be the SAME BYTES
  // the freshest timestamp actually vouches for - "the swapped manifest"
  // tamper case, if the swap happened between timestamp and targets
  // rather than inside targets itself.
  const actualTargetsHash = createHash("sha256").update(raw.targetsBytes).digest("hex");
  const expectedTargetsHash = timestamp.meta["targets.json"].hashes.sha256;
  if (actualTargetsHash !== expectedTargetsHash) {
    return {
      ok: false,
      error: `targets.json does not match timestamp.json's own hash (expected ${expectedTargetsHash}, got ${actualTargetsHash})`,
    };
  }

  return { ok: true, index: { root, targets, timestamp } };
}

/** The other half of the tamper suite: one specific package's own
 * downloaded tarball against its already-verified targets.json entry -
 * "a bad hash" (docs/PACKAGES.md). Only meaningful against a
 * `VerifiedIndex` (`verifyIndex()`'s own return), never a raw,
 * unverified one. */
export function verifyTargetHash(entry: TargetEntry, tarballBytes: Buffer): boolean {
  if (tarballBytes.length !== entry.length) return false;
  return createHash("sha256").update(tarballBytes).digest("hex") === entry.hashes.sha256;
}
