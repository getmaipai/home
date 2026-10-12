// MINOR-SEARCH-01e-11: the blocked-site table stays the compact structure the lists design promises (a sorted run of
// 64-bit host hashes with one bit mask per entry, about 12 bytes a host, not a string map), and a hash collision
// fails closed. Measured at build time with synthetic hosts shaped like real list entries.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { resetDb } from "./reset-db";
import { blockListsDir } from "@/lib/paths";
import { blocklistIds } from "@/lib/blocklists/policy";
import { __setListsReadyForTests, emptyState, listFilePath, writeState } from "@/lib/blocklists/listStore";
import { __resetHostIndexForTests, __setHostHashForTests, checkHost, hostIndexStats } from "@/lib/blocklists/hostLists";

function loadAll(lines: Record<string, string[]>): void {
  const state = emptyState();
  for (const id of blocklistIds()) {
    const text = `${(lines[id] ?? ["placeholder.invalid"]).join("\n")}\n`;
    const sha = createHash("sha256").update(text).digest("hex");
    const path = listFilePath(id, sha);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
    state.lists[id] = { sha256: sha, entries: text.split("\n").filter(Boolean).length, bytes: text.length, format: "domains", pinnedAt: "2026-10-12", loadedAt: "2026-10-12T00:00:00Z", previousSha256: null };
  }
  writeState(state);
  __resetHostIndexForTests();
}

beforeEach(() => {
  resetDb();
  rmSync(blockListsDir, { recursive: true, force: true });
  __setListsReadyForTests(null);
  __resetHostIndexForTests();
});
afterEach(() => {
  __setHostHashForTests(null);
  __setListsReadyForTests(true);
});

describe("compact blocked-site table", () => {
  test("holds at most 16 bytes a host (design: about 10, under 10 MB a million; a string map is over 100)", () => {
    const N = 200_000;
    const tlds = ["com", "net", "org", "xyz", "co.uk"];
    const hosts: string[] = [];
    for (let i = 0; i < N; i++) hosts.push(`${(i * 2654435761 % 4294967296).toString(36)}-${i.toString(36)}.${tlds[i % tlds.length]}`);
    const id = blocklistIds()[0]!;
    loadAll({ [id]: hosts });
    const stats = hostIndexStats();
    expect(stats.hosts).toBeGreaterThanOrEqual(N);
    expect(stats.bytesPerHost).toBeLessThanOrEqual(16);
    const mid = hosts[N >> 1]!;
    expect(checkHost("child", `https://${mid}/`)).toBe(id);
    expect(checkHost("child", "https://not-listed-anywhere.example.org/")).toBeNull();
  });

  test("hosts whose hashes share the high 32 bits are still told apart by the low 32 bits", () => {
    const id = blocklistIds()[0]!;
    __setHostHashForTests((host) => 0xabcd1234_00000000n | BigInt([...host].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7)));
    loadAll({ [id]: ["one.example.com", "two.example.net", "three.example.org"] });
    expect(checkHost("child", "https://one.example.com/")).toBe(id);
    expect(checkHost("child", "https://two.example.net/")).toBe(id);
    expect(checkHost("child", "https://three.example.org/")).toBe(id);
    expect(checkHost("child", "https://four.example.dev/")).toBeNull();
  });

  test("a 64-bit hash collision fails closed: an unlisted host that collides with a listed one reads as listed", () => {
    const [a] = blocklistIds();
    const base = (host: string): bigint => BigInt(Bun.hash.wyhash(host));
    __setHostHashForTests((host) => (host === "innocent.example.net" ? base("listed-a.example.com") : base(host)));
    loadAll({ [a!]: ["listed-a.example.com"] });
    expect(checkHost("child", "https://listed-a.example.com/")).toBe(a!);
    expect(checkHost("child", "https://innocent.example.net/")).toBe(a!);
    expect(checkHost("child", "https://unrelated.example.org/")).toBeNull();
  });

  test("two lists whose hosts collide share one entry and keep both lists' bits", () => {
    const [a, b] = blocklistIds();
    const base = (host: string): bigint => BigInt(Bun.hash.wyhash(host));
    __setHostHashForTests((host) => (host === "two.example.net" ? base("one.example.com") : base(host)));
    loadAll({ [a!]: ["one.example.com"], [b!]: ["two.example.net"] });
    expect(hostIndexStats().hosts).toBe(2);
    expect(checkHost("child", "https://one.example.com/")).not.toBeNull();
    expect(checkHost("child", "https://two.example.net/")).not.toBeNull();
  });
});
