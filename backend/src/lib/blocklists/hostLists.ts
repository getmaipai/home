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
import { blocklistIds, enabledListIds, lockedListIds } from "@/lib/blocklists/policy";
import { customHostRules, hostInSet } from "@/lib/blocklists/customHosts";
import { listsReadyForBand, listsReadyOverride, parseStoredFile, readState, stateStamp } from "@/lib/blocklists/listStore";

export const LISTS_NOT_READY = "lists-not-ready";

interface HostIndex {
  signature: string;
  /** `stateStamp()` when the signature was last confirmed, so a lookup does not re-read the state file. */
  stamp: string;
  /** High and low 32 bits of each 64-bit host hash, sorted together by (hi, lo). Two Uint32Arrays rather than one
   * BigUint64Array: a probe compares plain numbers and allocates no BigInt (about 3 times faster, same 12 bytes a host). */
  hi: Uint32Array;
  lo: Uint32Array;
  /** Which lists name the entry: bit i is the list at index i of `blocklistIds()`. */
  bits: Uint32Array;
  bitOf: Map<string, number>;
}

let cached: HostIndex | null = null;

// The 64-bit hash of a host. A collision of two different hosts is accepted by design (section 4 of the lists design,
// about 1 in 10^13 per lookup at 4 million hosts: a table of n entries gives n/2^64 per probe). Its effect is fail
// closed: the colliding host reads as listed and the entry's list bits are the OR of both. The seam below lets a test
// force one.
let hashImpl: (host: string) => bigint = (host) => BigInt(Bun.hash.wyhash(host));
function hashHost(host: string): bigint {
  return BigInt.asUintN(64, hashImpl(host));
}
export function __setHostHashForTests(fn: ((host: string) => bigint) | null): void {
  hashImpl = fn ?? ((host) => BigInt(Bun.hash.wyhash(host)));
  cached = null;
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
function build(signature: string, stamp: string, loaded: Array<[string, string, "hosts" | "domains"]>): HostIndex {
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
  const outHi = new Uint32Array(total);
  const outLo = new Uint32Array(total);
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
    outHi[n] = Number(min >> 32n);
    outLo[n] = Number(min & 0xffffffffn);
    outBits[n] = bits;
    n++;
  }
  return { signature, stamp, hi: outHi.slice(0, n), lo: outLo.slice(0, n), bits: outBits.slice(0, n), bitOf };
}

/** Builds (or reuses) the table for what is loaded now. */
export function prepareHostIndex(): HostIndex {
  const stamp = stateStamp();
  if (cached && cached.stamp === stamp) return cached;
  const { signature, loaded } = signatureOf();
  if (!cached || cached.signature !== signature) cached = build(signature, stamp, loaded);
  else cached.stamp = stamp;
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

/** The list bits of the entry for one 64-bit hash (0 when none): a binary search of about 22 steps at 4 million hosts. */
function bitsAt(index: HostIndex, hash: bigint): number {
  const qh = Number(hash >> 32n);
  const ql = Number(hash & 0xffffffffn);
  const { hi, lo } = index;
  let a = 0;
  let b = hi.length - 1;
  while (a <= b) {
    const mid = (a + b) >>> 1;
    const vh = hi[mid]!;
    if (vh === qh) {
      const vl = lo[mid]!;
      if (vl === ql) return index.bits[mid]!;
      if (vl < ql) a = mid + 1;
      else b = mid - 1;
    } else if (vh < qh) a = mid + 1;
    else b = mid - 1;
  }
  return 0;
}

/** What the table holds, for the memory test and the bench: entries and the bytes the arrays take. */
export function hostIndexStats(): { hosts: number; bytes: number; bytesPerHost: number } {
  const index = prepareHostIndex();
  const hosts = index.hi.length;
  const bytes = index.hi.byteLength + index.lo.byteLength + index.bits.byteLength;
  return { hosts, bytes, bytesPerHost: hosts === 0 ? 0 : bytes / hosts };
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

/** The OR of the list bits for the host and each parent down to its registrable domain. */
function hitMask(index: HostIndex, host: string): number {
  let bits = 0;
  for (const name of probeNames(host)) bits |= bitsAt(index, hashHost(name));
  return bits;
}

/** Bench seam: one probe walk against the current table, no policy, no custom entries. */
export function __hostMaskForBench(host: string): number {
  return hitMask(prepareHostIndex(), host);
}

export const CUSTOM_DENY = "custom-deny";

/** True when a band has anything to check: an enabled list or a custom entry. */
export function siteBlocksActive(band: AgeBand): boolean {
  if (enabledListIds(band).length > 0) return true;
  const rules = customHostRules(band);
  return rules.deny.size > 0;
}

/** A short text that changes whenever a band's lists or custom entries change (a search cache key part). */
export function siteBlockSignature(band: AgeBand): string {
  const rules = customHostRules(band);
  return `${enabledListIds(band).join("+")}|${[...rules.deny].sort().join("+")}|${[...rules.allow].sort().join("+")}`;
}

/** Why this host may not be shown to the band: `custom-deny` (a custom always-block entry, which wins over every
 * allow), a blocked-site list id, `LISTS_NOT_READY` when an enabled list is not loaded (the caller fails closed),
 * or null. A custom allow lifts a hit only when every list naming the host is unlocked for the band, so it can
 * never unblock a locked list (the adult-site list stays locked for child and teen controls). */
export function checkHost(band: AgeBand, input: string | null | undefined): string | null {
  const host = normalizeHost(input);
  const rules = customHostRules(band);
  if (host && hostInSet(host, rules.deny)) return CUSTOM_DENY;
  const enabled = enabledListIds(band);
  if (enabled.length === 0) return null;
  if (!listsReadyForBand(band)) return LISTS_NOT_READY;
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
  const hitBits = hitMask(index, host) & mask;
  if (hitBits === 0) return null;
  const hits = enabled.filter((id) => {
    const bit = index.bitOf.get(id);
    return bit !== undefined && (hitBits & (1 << bit)) !== 0;
  });
  if (hits.length === 0) return null;
  const locked = new Set(lockedListIds(band));
  if (rules.allow.size > 0 && hostInSet(host, rules.allow) && hits.every((id) => !locked.has(id))) {
    bumpCounter(`blocklist.allowed.custom.${band}`);
    return null;
  }
  return hits[0]!;
}

// Drop counters: list id and band and a count, nothing that names a site.
const drops = new Map<string, number>();
function bumpCounter(key: string, by = 1): void {
  if (by <= 0) return;
  drops.set(key, (drops.get(key) ?? 0) + by);
}
export function bumpListDrop(listId: string, band: AgeBand, by = 1): void {
  bumpCounter(`blocklist.dropped.${listId}.${band}`, by);
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
  // A grown-up's band is never held: lists still loading let the page through (a custom deny still applies).
  if (verdict === LISTS_NOT_READY && band === "adult") return true;
  bumpListDrop(verdict, band);
  return false;
}
