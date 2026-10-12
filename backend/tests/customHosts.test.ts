import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { resetDb } from "./reset-db";
import { blockListsDir } from "@/lib/paths";
import { blocklistIds, lockedListIds } from "@/lib/blocklists/policy";
import { __setListsReadyForTests, emptyState, listFilePath, readState, writeState } from "@/lib/blocklists/listStore";
import { __resetHostIndexForTests, __resetListDropCountersForTests, checkHost, CUSTOM_DENY, LISTS_NOT_READY, listDropCounters, urlAllowedFor } from "@/lib/blocklists/hostLists";
import { parseHostEntries, validateCustomHosts } from "@/lib/blocklists/customHosts";
import { setHouseholdSettingValue } from "@/lib/settings";

function put(id: string, text: string): void {
  const sha = createHash("sha256").update(text).digest("hex");
  const path = listFilePath(id, sha);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  const state = readState().lists ? readState() : emptyState();
  state.lists[id] = { sha256: sha, entries: 1, bytes: text.length, format: "domains", pinnedAt: "2026-10-12", loadedAt: "2026-10-12T00:00:00Z", previousSha256: null };
  writeState(state);
  __resetHostIndexForTests();
}
function loadAll(text: Record<string, string>): void {
  for (const id of blocklistIds()) put(id, text[id] ?? "placeholder.invalid\n");
}
function set(key: "search.hosts.deny" | "search.hosts.allow", value: string): void {
  const r = setHouseholdSettingValue(key, value);
  expect(r.ok).toBe(true);
}

beforeEach(() => {
  resetDb();
  rmSync(blockListsDir, { recursive: true, force: true });
  __setListsReadyForTests(null);
  __resetHostIndexForTests();
  __resetListDropCountersForTests();
});
afterEach(() => __setListsReadyForTests(true));

const LOCKED = lockedListIds("child")[0]!;
const UNLOCKED = blocklistIds().find((id) => !lockedListIds("child").includes(id) && id !== LOCKED)!;

describe("custom host entries", () => {
  test("entries split on commas, spaces and lines, drop junk, keep subdomain-free hosts, dedupe", () => {
    expect(parseHostEntries("Example.com, *.news.example.org\nexample.com  https://x.example.net/path;nodot")).toEqual(["example.com", "news.example.org", "x.example.net"]);
  });
  test("a bad entry is refused with the entry named and the fix said", () => {
    expect(validateCustomHosts("search.hosts.deny", "ok.example.com, nodot")).toContain("nodot");
    expect(validateCustomHosts("search.hosts.deny", "ok.example.com, nodot")).toContain("example.com");
    expect(validateCustomHosts("search.hosts.deny", "ok.example.com")).toBeNull();
    expect(validateCustomHosts("search.other", "###")).toBeNull();
    expect(validateCustomHosts("search.hosts.allow", "co.uk")).toContain("co.uk");
    expect(validateCustomHosts("search.hosts.allow", null)).toBeNull();
  });
});

describe("custom deny and allow", () => {
  test("a custom deny blocks every band, subdomains included, even with no lists", () => {
    set("search.hosts.deny", "blocked.example.com");
    for (const band of ["child", "teen", "adult"] as const) {
      expect(checkHost(band, "https://a.blocked.example.com/x")).toBe(CUSTOM_DENY);
    }
    expect(urlAllowedFor("adult", "https://blocked.example.com/")).toBe(false);
    expect(listDropCounters()["blocklist.dropped.custom-deny.adult"]).toBe(1);
    expect(checkHost("adult", "https://fine.example.com/")).toBeNull();
  });

  test("deny wins over allow for the same host", () => {
    set("search.hosts.deny", "both.example.com");
    set("search.hosts.allow", "both.example.com");
    expect(checkHost("child", "https://both.example.com/")).toBe(CUSTOM_DENY);
  });

  test("a custom allow lifts a hit from an unlocked list", () => {
    loadAll({ [UNLOCKED]: "ok-site.example.com\n" });
    expect(checkHost("child", "https://ok-site.example.com/")).toBe(UNLOCKED);
    set("search.hosts.allow", "ok-site.example.com");
    expect(checkHost("child", "https://ok-site.example.com/")).toBeNull();
    expect(listDropCounters()["blocklist.allowed.custom.child"]).toBe(1);
  });

  test("a custom allow never lifts a hit from a list locked for the band", () => {
    loadAll({ [LOCKED]: "adult-site.example.com\n" });
    set("search.hosts.allow", "adult-site.example.com");
    expect(checkHost("child", "https://adult-site.example.com/")).toBe(LOCKED);
    expect(checkHost("teen", "https://adult-site.example.com/")).toBe(LOCKED);
  });

  test("a host on a locked and an unlocked list stays blocked despite an allow", () => {
    loadAll({ [LOCKED]: "mixed.example.com\n", [UNLOCKED]: "mixed.example.com\n" });
    set("search.hosts.allow", "mixed.example.com");
    expect(checkHost("child", "https://mixed.example.com/")).not.toBeNull();
  });

  test("an adult is never held by lists still loading, but a custom deny still applies", () => {
    set("search.hosts.deny", "blocked.example.com");
    expect(urlAllowedFor("adult", "https://anything.example.com/")).toBe(true);
    expect(urlAllowedFor("adult", "https://blocked.example.com/")).toBe(false);
    expect(checkHost("child", "https://anything.example.com/")).toBe(LISTS_NOT_READY);
  });
});
