// MINOR-SEARCH-01e-4: verifies the signed blocked-site list index (`list-index.json`, a release asset of
// getmaipai/catalog, built by catalog/tools/src/list-index.ts). The hub's own check, a deliberate twin of the
// catalog's validator rather than an import of it (different runtime and trust boundary; the same reason
// storeIndex.ts is a twin of the catalog's index-builder). It refuses an unsigned, expired or rolled-back index,
// a pin that is not at an immutable commit, and a pin over the size limits. An id the spec policy does not
// declare is ignored: the catalog can refresh a pin but can never add a list a household gets.
import { verifyEnvelopeSignature, type SignedEnvelope } from "@/lib/storeIndex";
import { blocklistIds } from "@/lib/blocklists/policy";

/** The one place the hub reads the index from: a static signed file, no MaiPai-operated service in the path. */
export const LIST_INDEX_URL = "https://github.com/getmaipai/catalog/releases/latest/download/list-index.json";
/** The only host a list file may come from; the catalog guard and this check both refuse any other. */
export const LIST_SOURCE_HOST = "raw.githubusercontent.com";
export const LIST_MAX_BYTES = 64 * 1024 * 1024;
export const LIST_MAX_ENTRIES = 2_000_000;
/** The index is a few KB; anything bigger is not the index. */
export const LIST_INDEX_MAX_BYTES = 1024 * 1024;
const PINNED_SOURCE_URL = /^https:\/\/raw\.githubusercontent\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/[0-9a-f]{40}\/[^?#\s]+$/;

export interface ListPin {
  id: string;
  source_url: string;
  sha256: string;
  bytes: number;
  entries: number;
  format: "hosts" | "domains";
  licence: string;
  upstream: string;
  pinned_at: string;
}

export interface ListIndexMetadata {
  type: "list-index";
  version: string;
  expires: string;
  published: number;
  lists: ListPin[];
}

/** The catalog's list-index signing public key(s), PEM. Pinned out of band, never learned from the index. The
 * production key is Jesse's call and is not pinned yet (catalog buildRoot() carries the same note), so until it
 * is, the sync job reports "no key pinned" and every minor stays fail closed. */
export const CATALOG_LIST_KEYS_PEM: string[] = [];

let keysForTests: string[] | null = null;
export function __setListTrustKeysForTests(keys: string[] | null): void {
  keysForTests = keys;
}
export function listTrustKeys(): string[] {
  return keysForTests ?? CATALOG_LIST_KEYS_PEM;
}

export type ListIndexResult = { ok: true; published: number; pins: ListPin[]; ignored: string[] } | { ok: false; error: string };

function validPin(pin: unknown): pin is ListPin {
  if (!pin || typeof pin !== "object") return false;
  const p = pin as Record<string, unknown>;
  return (
    typeof p.id === "string" &&
    typeof p.source_url === "string" &&
    PINNED_SOURCE_URL.test(p.source_url) &&
    !/(^|\/)\.\.?(\/|$)/.test(p.source_url.replace(/^https:\/\//, "")) &&
    typeof p.sha256 === "string" &&
    /^[0-9a-f]{64}$/.test(p.sha256) &&
    Number.isInteger(p.bytes) &&
    (p.bytes as number) >= 1 &&
    (p.bytes as number) <= LIST_MAX_BYTES &&
    Number.isInteger(p.entries) &&
    (p.entries as number) >= 1 &&
    (p.entries as number) <= LIST_MAX_ENTRIES &&
    (p.format === "hosts" || p.format === "domains")
  );
}

export function verifyListIndex(
  envelope: SignedEnvelope<ListIndexMetadata>,
  opts: { keys?: string[]; now?: number; lastPublished?: number } = {},
): ListIndexResult {
  const keys = opts.keys ?? listTrustKeys();
  if (keys.length === 0) return { ok: false, error: "this build has no catalog signing key pinned for the blocked-site list index" };
  const signed = envelope?.signed;
  if (!signed || signed.type !== "list-index" || !Array.isArray(signed.lists) || !Array.isArray(envelope.signatures))
    return { ok: false, error: "the blocked-site list index is not in the expected shape" };
  if (!verifyEnvelopeSignature(envelope, keys)) return { ok: false, error: "the blocked-site list index is not signed by a pinned key" };
  const now = opts.now ?? Date.now();
  if (!(new Date(signed.expires).getTime() > now)) return { ok: false, error: `the blocked-site list index expired at ${signed.expires}` };
  if (!Number.isInteger(signed.published)) return { ok: false, error: "the blocked-site list index has no publish time" };
  if (opts.lastPublished !== undefined && signed.published < opts.lastPublished)
    return { ok: false, error: "the blocked-site list index is older than one this home already saw (a rollback)" };
  const known = new Set(blocklistIds());
  const pins: ListPin[] = [];
  const ignored: string[] = [];
  const seen = new Set<string>();
  for (const pin of signed.lists) {
    const id = (pin as { id?: unknown })?.id;
    if (typeof id !== "string") return { ok: false, error: "the blocked-site list index has a row with no id" };
    if (!known.has(id)) {
      ignored.push(id);
      continue;
    }
    if (seen.has(id)) return { ok: false, error: `the blocked-site list index names ${id} twice` };
    seen.add(id);
    if (!validPin(pin)) return { ok: false, error: `the blocked-site list index has an invalid pin for ${id}` };
    pins.push(pin);
  }
  return { ok: true, published: signed.published, pins, ignored };
}
