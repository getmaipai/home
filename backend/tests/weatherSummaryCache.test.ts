// AUDIT-PERF-01 item 6: the weather summary cache keeps one hour per place; the package manifest stat is cached for 5 s.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { summaryFor, __resetWeatherSummaryForTests, __setWeatherSummaryCompleterForTests, __weatherSummaryCacheKeysForTests } from "@/lib/weatherSummary";
import { cachedMtimeMs, invalidateManifestStats, MANIFEST_STAT_TTL_MS } from "@/lib/manifestStat";

const HOUR = 3_600_000;
const flush = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); };

describe("weather summary cache", () => {
  beforeEach(() => { __resetWeatherSummaryForTests(); __setWeatherSummaryCompleterForTests(async () => ({ ok: true, text: "Sunny and mild." })); });
  afterEach(() => __resetWeatherSummaryForTests());

  test("writing a place's new hour deletes its previous hour, and leaves other places alone", async () => {
    const base = 1_800_000_000_000;
    const hartford = { place: "Hartford", unit: "fahrenheit" as const, temp: 60, condition: "Sunny", high: 65, low: 50 };
    const boston = { ...hartford, place: "Boston" };
    summaryFor(hartford, base); summaryFor(boston, base); await flush();
    expect(__weatherSummaryCacheKeysForTests()).toHaveLength(2);
    summaryFor(hartford, base + HOUR); await flush();
    const keys = __weatherSummaryCacheKeysForTests();
    expect(keys).toHaveLength(2);
    expect(keys.filter((key) => key.startsWith("Hartford|"))).toEqual([`Hartford|fahrenheit|${Math.floor((base + HOUR) / HOUR)}`]);
    expect(keys.some((key) => key.startsWith("Boston|"))).toBe(true);
  });
});

describe("manifest stat cache", () => {
  let dir = "";
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "manifest-stat-")); invalidateManifestStats(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); invalidateManifestStats(); });

  test("a second read inside 5 s does not stat again; after 5 s or an invalidation it does", () => {
    const file = join(dir, "manifest.json");
    writeFileSync(file, "{}");
    utimesSync(file, 1000, 1000);
    const realNow = Date.now;
    const t0 = realNow();
    try {
      Date.now = () => t0;
      const first = cachedMtimeMs(file);
      utimesSync(file, 2000, 2000);
      Date.now = () => t0 + MANIFEST_STAT_TTL_MS - 1;
      expect(cachedMtimeMs(file)).toBe(first);
      invalidateManifestStats();
      expect(cachedMtimeMs(file)).not.toBe(first);
      utimesSync(file, 3000, 3000);
      const second = cachedMtimeMs(file);
      Date.now = () => t0 + 2 * MANIFEST_STAT_TTL_MS + 5;
      expect(cachedMtimeMs(file)).not.toBe(second);
      expect(cachedMtimeMs(join(dir, "missing.json"))).toBeNull();
    } finally { Date.now = realNow; }
  });
});

describe("package changes drop the manifest stat cache", () => {
  test("install, rollback and uninstall each invalidate it before the live process is restarted", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(join(import.meta.dir, "../src/lib/store.ts"), "utf8");
    expect(source.match(/invalidateManifestStats\(\);\s*\n\s*await killLiveProcessForInstallChange\(/g)?.length).toBe(3);
  });
});
