// MINOR-SEARCH-01e-8: the household's own always-block and allow host lists (Jesse's decision, 2026-10-12).
// Two rules, both non-negotiable, enforced in hostLists.ts `checkHost`:
//   1. a custom deny is always honoured, for every band, and wins over any allow;
//   2. a custom allow can never unblock a host on a list locked for the band (the adult-site list stays locked
//      for child and teen controls).
// An entry matches that host and every subdomain of it. Entries are comma, space or line separated.
import { getDomain } from "tldts";
import type { AgeBand } from "@/lib/ageBand";
import { getHouseholdSettingValue } from "@/lib/settings";
import { normalizeHost } from "@/lib/blocklists/hostLists";

export const HOSTS_DENY_KEY = "search.hosts.deny";
export const HOSTS_ALLOW_KEY = "search.hosts.allow";
export const MAX_CUSTOM_HOSTS = 500;

const HOST_SHAPE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/** The hosts named in a settings value; entries that are not a site address are skipped. */
export function parseHostEntries(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  const out = new Set<string>();
  for (const piece of raw.split(/[\s,;]+/)) {
    if (piece === "") continue;
    const host = normalizeHost(piece.replace(/^\*\./, ""));
    if (host && HOST_SHAPE.test(host) && getDomain(host) !== null) out.add(host);
    if (out.size >= MAX_CUSTOM_HOSTS) break;
  }
  return [...out];
}

/** Settings write check: names the entry that is wrong and what to type instead. */
export function validateCustomHosts(key: string, value: unknown): string | null {
  if (key !== HOSTS_DENY_KEY && key !== HOSTS_ALLOW_KEY) return null;
  if (value === null) return null;
  if (typeof value !== "string") return "Type site names separated by commas, like example.com, news.example.org.";
  const pieces = value.split(/[\s,;]+/).filter((piece) => piece !== "");
  if (pieces.length > MAX_CUSTOM_HOSTS) return `That list has ${pieces.length} sites. Keep it to ${MAX_CUSTOM_HOSTS} or fewer.`;
  for (const piece of pieces) {
    const host = normalizeHost(piece.replace(/^\*\./, ""));
    if (!host || !HOST_SHAPE.test(host) || getDomain(host) === null) return `"${piece.slice(0, 60)}" is not a site name. Type names like example.com, separated by commas.`;
  }
  return null;
}

export interface CustomHostRules {
  deny: Set<string>;
  allow: Set<string>;
}

const parsed = new Map<string, Set<string>>();
function setFor(raw: unknown): Set<string> {
  const text = typeof raw === "string" ? raw : "";
  let set = parsed.get(text);
  if (!set) {
    set = new Set(parseHostEntries(text));
    if (parsed.size > 32) parsed.clear();
    parsed.set(text, set);
  }
  return set;
}

function read(key: string): Set<string> {
  try {
    return setFor(getHouseholdSettingValue(key));
  } catch {
    return setFor("");
  }
}

/** The custom lists that count for a band: the household's today (01e-9 adds the band's own beside them). */
export function customHostRules(_band: AgeBand): CustomHostRules {
  return { deny: read(HOSTS_DENY_KEY), allow: read(HOSTS_ALLOW_KEY) };
}

/** True when the host, or any parent of it, is in the set. */
export function hostInSet(host: string, set: ReadonlySet<string>): boolean {
  if (set.size === 0) return false;
  const labels = host.split(".");
  for (let i = 0; i < labels.length - 1; i++) {
    if (set.has(labels.slice(i).join("."))) return true;
  }
  return false;
}
