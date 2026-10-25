import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prefetchBudget, PREFETCH_SCHEMA } from "../src/lib/news/prefetchBudget";

// Pure simulated clock bench. No application imports, fixture server, or network.
test("simulated day: 150 pages per site, 30 second pace per site, no midnight burst, receipts survive restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "news-prefetch-budget-"));
  const path = join(dir, "knowledge.db");
  let sqlite = new Database(path);
  sqlite.exec(PREFETCH_SCHEMA);
  let store = prefetchBudget(sqlite);
  try {
    const start = Date.parse("2026-10-17T23:00:00Z");
    const accepted: Array<{ site: string; at: number }> = [];
    for (let second = 0; second < 86_400; second++) {
      const site = second % 2 ? "wire.example.test" : "kids.example.test";
      if (store.claimPrefetch(`https://${site}/${second}`, site, start + second * 1000)) accepted.push({ site, at: start + second * 1000 });
    }
    expect(accepted.filter((row) => row.site === "wire.example.test")).toHaveLength(150);
    expect(accepted.filter((row) => row.site === "kids.example.test")).toHaveLength(150);
    for (const site of ["wire.example.test", "kids.example.test"]) {
      const own = accepted.filter((row) => row.site === site);
      expect(own.every((row, i) => i === 0 || row.at - own[i - 1]!.at >= 30_000)).toBe(true);
    }
    sqlite.close(); sqlite = new Database(path); store = prefetchBudget(sqlite);
    expect(store.claimPrefetch("https://kids.example.test/0", "kids.example.test", start + 2 * 86_400_000)).toBe(false);
    expect(store.claimPrefetch("https://kids.example.test/new", "kids.example.test", start + 86_400_000)).toBe(true);
    expect(store.claimPrefetch("https://wire.example.test/new", "wire.example.test", start + 86_400_001)).toBe(false);
  } finally { sqlite.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("quiet mode persists across handles, doubles on failure and clears only after success", () => {
  const sqlite = new Database(":memory:"); sqlite.exec(PREFETCH_SCHEMA);
  const store = prefetchBudget(sqlite);
  try {
    expect(store.claimPrefetch("https://example.test/a", "example.test", 0)).toBe(true);
    store.prefetchOutcome(false, 0, "example.test");
    expect(prefetchBudget(sqlite).claimPrefetch("https://example.test/b", "example.test", 3_599_999)).toBe(false);
    expect(store.claimPrefetch("https://example.test/b", "example.test", 3_600_000)).toBe(true);
    store.prefetchOutcome(false, 3_600_000, "example.test");
    expect(store.claimPrefetch("https://example.test/c", "example.test", 10_799_999)).toBe(false);
    // Another site is not held back by this one's refusals.
    expect(store.claimPrefetch("https://other.test/z", "other.test", 10_799_999)).toBe(true);
    expect(store.claimPrefetch("https://example.test/c", "example.test", 10_800_000)).toBe(true);
    store.prefetchOutcome(true, 10_800_000, "example.test");
    expect(store.claimPrefetch("https://example.test/d", "example.test", 10_830_000)).toBe(true);
  } finally { sqlite.close(); }
});

test("independent handles cannot spend the same receipt or restart the global pace", () => {
  const dir = mkdtempSync(join(tmpdir(), "news-prefetch-shared-"));
  const path = join(dir, "knowledge.db");
  const first = new Database(path); first.exec(PREFETCH_SCHEMA);
  const second = new Database(path);
  try {
    const a = prefetchBudget(first), b = prefetchBudget(second);
    expect(a.claimPrefetch("https://example.test/a", "example.test", 0)).toBe(true);
    expect(b.claimPrefetch("https://example.test/b", "example.test", 29_999)).toBe(false);
    expect(b.claimPrefetch("https://other.test/b", "other.test", 29_999)).toBe(true);
    expect(b.claimPrefetch("https://example.test/a", "example.test", 30_000)).toBe(false);
    expect(b.claimPrefetch("https://example.test/b", "example.test", 30_000)).toBe(true);
    a.prefetchOutcome(false, 30_000, "example.test");
    expect(b.claimPrefetch("https://example.test/c", "example.test", 60_000)).toBe(false);
  } finally { first.close(); second.close(); rmSync(dir, { recursive: true, force: true }); }
});
