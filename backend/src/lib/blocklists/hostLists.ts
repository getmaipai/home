// MINOR-SEARCH-01e-5: the blocked-site matcher. One sorted table of 64-bit host hashes for every loaded list with
// a bit mask per entry saying which lists name it, so a band's lists are a mask over one table, not a table per
// band (about 10 bytes a host). A lookup tries the host and each parent down to its registrable domain (public
// suffix list via tldts, private suffixes such as blogspot.com included, so one blog is never confused with the
// whole platform) and never above it.
//
// Fail closed (rule 0): when a band's enabled list is not loaded, `checkHost` answers "lists-not-ready" and the
// caller drops the result; effectiveMode (sourceMode.ts) keeps the band's web side off before it ever gets here.
//
// Counters carry a list id (from the closed set the spec declares), the age band and a count. Never a host, a URL,
// a query or a person (rule 6a).
import { domainToASCII } from "node:url";
import { getDomain } from "tldts";
import type { AgeBand } from "@/lib/ageBand";
import { blocklistIds, enabledListIds } from "@/lib/blocklists/policy";
import { listsReadyForBand, listsReadyOverride, parseStoredFile, readState } from "@/lib/blocklists/listStore";

export const LISTS_NOT_READY = "lists-not-ready";

interface HostIndex {
  signature: string;
  hashes: BigUint64Array;
  bits: Uint32Array;
  bitOf: Map<string, number>;
}

let cached: HostIndex | null = null;

function hashHost(host: string): bigint {
  return BigInt(Bun.hash.wyhash(host));
}

/** Lowercase ASCII host from a URL or a bare host, or null when there is none to check. */
export function normalizeHost(input: string | null | undefined): string | null {
  if (!input) return null;
  let host = input.trim();
  if (host === "") return null;
  if (host.includes("://") || host.startsWith("//")) {
    try {
      host = new URL(host.startsWith("//") ? `https:${host}` : host).hostname;
    } catch {
      return null;
    }
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(host) && !host.includes("://")) return null;
  host = host.replace(/\.$/, "").toLowerCase();
  const ascii = domainToASCII(host);
  return ascii === "" ? null : ascii;
}

function signatureOf(): { signature: string; loaded: Array<[string, string, "hosts" | "domains"]> } {
  const lists = readState().lists;
  const loaded = Object.entries(lists)
    .filter(([id]) => blocklistIds().includes(id))
    .map(([id, entry]) => [id, entry.sha256, entry.format] as [string, string, "hosts" | "domains"])
    .sort((a, b) => a[0].localeCompare(b[0]));
  return { signature: loaded.map(([id, sha]) => `${id}:${sha}`).join(","), loaded };
}

/** Builds the merged table from the verified files. Synchronous; about a second for a 26 MB list, done once per
 * change of the loaded set (the sync job and boot call `prepareHostIndex` so a search does not pay for it). */
function build(signature: string, loaded: Array<[string, string, "hosts" | "domains"]>): HostIndex {
  const ids = blocklistIds();
  if (ids.length > 31) throw new Error("the blocked-site matcher holds at most 31 lists; widen the mask first");
  const bitOf = new Map<string, number>();
  const perList: Array<{ bit: number; hashes: BigUint64Array }> = [];
  for (const [id, sha, format] of loaded) {
    const parsed = parseStoredFile(id, { sha256: sha, format });
    if (!parsed) continue;
    const bit = ids.indexOf(id);
    bitOf.set(id, bit);
    const hashes = new BigUint64Array(parsed.hosts.length);
    for (let i = 0; i < parsed.hosts.length; i++) hashes[i] = hashHost(parsed.hosts[i]!);
    hashes.sort();
    perList.push({ bit, hashes });
  }
  const total = perList.reduce((n, l) => n + l.hashes.length, 0);
  const outHashes = new BigUint64Array(total);
  const outBits = new Uint32Array(total);
  const at = new Array<number>(perList.length).fill(0);
  let n = 0;
  for (;;) {
    let min: bigint | null = null;
    for (let k = 0; k < perList.length; k++) {
      if (at[k]! >= perList[k]!.hashes.length) continue;
      const v = perList[k]!.hashes[at[k]!]!;
      if (min === null || v < min) min = v;
    }
    if (min === null) break;
    let bits = 0;
    for (let k = 0; k < perList.length; k++) {
      const list = perList[k]!;
      while (at[k]! < list.hashes.length && list.hashes[at[k]!] === min) {
        bits |= 1 << list.bit;
        at[k]!++;
      }
    }
    outHashes[n] = min;
    outBits[n] = bits;
    n++;
  }
  return { signature, hashes: outHashes.slice(0, n), bits: outBits.slice(0, n), bitOf };
}

/** Builds (or reuses) the table for what is loaded now. */
export function prepareHostIndex(): HostIndex {
  const { signature, loaded } = signatureOf();
  if (!cached || cached.signature !== signature) cached = build(signature, loaded);
  return cached;
}

/** Builds the table now (after a sync or at boot) so the first child or teen search does not pay for it. A failure
 * is logged and leaves the gate closed: the search path rebuilds, and a list that cannot be read is not ready. */
export function warmHostIndex(): void {
  try {
    prepareHostIndex();
  } catch (err) {
    console.warn("blocked-site table could not be built:", err);
  }
}

export function __resetHostIndexForTests(): void {
  cached = null;
}

function bitsAt(index: HostIndex, hash: bigint): number {
  let lo = 0;
  let hi = index.hashes.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const v = index.hashes[mid]!;
    if (v === hash) return index.bits[mid]!;
    if (v < hash) lo = mid + 1;
    else hi = mid - 1;
  }
  return 0;
}

/** The host and each parent down to (and including) its registrable domain. */
export function probeNames(host: string): string[] {
  const domain = getDomain(host, { allowPrivateDomains: true });
  if (!domain) return [host];
  const labels = host.split(".");
  const names: string[] = [];
  for (let i = 0; i < labels.length; i++) {
    const name = labels.slice(i).join(".");
    names.push(name);
    if (name === domain) break;
  }
  return names;
}

/** Which of the band's enabled lists name this host. Returns the list id, `LISTS_NOT_READY` when an enabled list
 * is not loaded (the caller fails closed), or null when no enabled list names it or there is no host to check. */
export function checkHost(band: AgeBand, input: string | null | undefined): string | null {
  const enabled = enabledListIds(band);
  if (enabled.length === 0) return null;
  if (!listsReadyForBand(band)) return LISTS_NOT_READY;
  const host = normalizeHost(input);
  if (!host) return null;
  let index: HostIndex;
  try {
    index = prepareHostIndex();
  } catch {
    return LISTS_NOT_READY;
  }
  let mask = 0;
  for (const id of enabled) {
    const bit = index.bitOf.get(id);
    if (bit === undefined) {
      if (listsReadyOverride() === true) continue;
      return LISTS_NOT_READY;
    }
    mask |= 1 << bit;
  }
  for (const name of probeNames(host)) {
    const hit = bitsAt(index, hashHost(name)) & mask;
    if (hit === 0) continue;
    for (const id of enabled) {
      const bit = index.bitOf.get(id);
      if (bit !== undefined && hit & (1 << bit)) return id;
    }
  }
  return null;
}

// Drop counters: list id and band and a count, nothing that names a site.
const drops = new Map<string, number>();
export function bumpListDrop(listId: string, band: AgeBand, by = 1): void {
  if (by <= 0) return;
  const key = `blocklist.dropped.${listId}.${band}`;
  drops.set(key, (drops.get(key) ?? 0) + by);
}
export function listDropCounters(): Record<string, number> {
  return Object.fromEntries(drops);
}
export function __resetListDropCountersForTests(): void {
  drops.clear();
}

/** True when a URL (or host) may be shown to this band. Counts a drop by list id. A band with no enabled list
 * always passes; one with an unloaded list never does. An empty value has nothing to show and passes; a value
 * with no readable host (a relative path, a data: address, malformed text) is dropped for a band that has lists. */
export function urlAllowedFor(band: AgeBand, url: string | null | undefined): boolean {
  if (url === null || url === undefined || url.trim() === "") return true;
  if (enabledListIds(band).length > 0 && normalizeHost(url) === null) {
    bumpListDrop("unreadable-address", band);
    return false;
  }
  const verdict = checkHost(band, url);
  if (verdict === null) return true;
  bumpListDrop(verdict, band);
  return false;
}
