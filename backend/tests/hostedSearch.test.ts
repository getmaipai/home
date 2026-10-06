// THIN-4H (rule 7): the optional hosted search key. Adults only, off by
// default, a write-only secret, and a child's or teen's query never
// reaches the provider whatever is set. Same shape as packageHost.test.ts's
// searxng rows: a real local server stands in for each service.
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people, settingsValues } from "@/db/schema";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { createHost, __resetSearchCacheForTests, __resetSearchRotationForTests, __resetSearxngEnginesCacheForTests } from "@/lib/packageHost";
import { HOSTED_SEARCH_KEY_SETTING, __setHostedSearchEndpointForTests } from "@/lib/hostedSearch";
import { setHouseholdSettingValue, resetValue } from "@/lib/settings";
import { PackageManifest } from "@maipai/spec/gen/ts/manifest.js";

const SECRET = "BSA-test-key-do-not-log";

let searxng: ReturnType<typeof Bun.serve>;
let provider: ReturnType<typeof Bun.serve>;
let searxngHits = 0;
let providerHits: { key: string | null; query: string | null }[] = [];

beforeEach(() => {
  resetDb();
  __resetThrottleForTests();
  __resetRateLimiterForTests();
  __resetSearchCacheForTests();
  __resetSearchRotationForTests();
  __resetSearxngEnginesCacheForTests();
  searxngHits = 0;
  providerHits = [];
  searxng = Bun.serve({ hostname: "127.0.0.1", port: 0,
    fetch: (req) => {
      if (new URL(req.url).pathname === "/search") searxngHits += 1;
      return Response.json({ results: [{ title: "Keyless", url: "https://keyless.example/", content: "from searxng" }] });
    },
  });
  provider = Bun.serve({ hostname: "127.0.0.1", port: 0,
    fetch: (req) => {
      const url = new URL(req.url);
      providerHits.push({ key: req.headers.get("x-subscription-token"), query: url.searchParams.get("q") });
      return Response.json({ web: { results: [{ title: "Hosted", url: "https://hosted.example/", description: "from the provider" }] } });
    },
  });
  __setHostedSearchEndpointForTests(`http://127.0.0.1:${provider.port}/res/v1/web/search`);
  setHouseholdSettingValue("search.searxng_url", `http://127.0.0.1:${searxng.port}`);
});

afterEach(() => {
  searxng.stop(true);
  provider.stop(true);
  __setHostedSearchEndpointForTests(null);
});

function manifest(): PackageManifest {
  return PackageManifest.parse({
    id: "test-pkg", version: "0.1.0", kind: "plugin", category: "Utilities", display: "Test",
    description: "A test package.", author: "test", license: "AGPL-3.0", platforms: ["home"],
    min_role: "child", incognito: "unaffected", consequential: false, offline: "full",
    min_app: "0.1.0", tier: 0, permissions: ["integration:searxng"],
  });
}

async function owner() {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Oliver", secret: "correcthorse" });
  return db.select().from(people).where(eq(people.displayName, "Oliver")).get()!;
}

function member(name: string, role: "child" | "teen" | "guest") {
  const now = new Date().toISOString();
  const id = `person-hosted-${name.toLowerCase()}`;
  db.insert(people).values({ id, displayName: name, role, avatarSeed: id, source: "hub", createdAt: now, updatedAt: now, hlc: "1700000000000:2:testfix" }).run();
  return db.select().from(people).where(eq(people.id, id)).get()!;
}

async function search(actor: Awaited<ReturnType<typeof owner>>) {
  return (await createHost(actor, manifest()).integration.call("searxng", "search", { query: "node.js runtime" })) as { text: string; rows: { title: string }[] };
}

describe("hosted search key (THIN-4H)", () => {
  test("an adult with a key set: the query goes to the provider with the key", async () => {
    const adult = await owner();
    setHouseholdSettingValue(HOSTED_SEARCH_KEY_SETTING, SECRET);
    const result = await search(adult);
    expect(providerHits).toEqual([{ key: SECRET, query: "node.js runtime" }]);
    expect(result.rows[0]?.title).toBe("Hosted");
    expect(searxngHits).toBe(0);
  });

  test("a child with a key set: the provider is never called, SearXNG answers", async () => {
    await owner();
    setHouseholdSettingValue(HOSTED_SEARCH_KEY_SETTING, SECRET);
    const result = await search(member("Sprout", "child"));
    expect(providerHits).toEqual([]);
    expect(searxngHits).toBeGreaterThan(0);
    expect(result.rows[0]?.title).toBe("Keyless");
  });

  test("a teen with a key set: the provider is never called, SearXNG answers", async () => {
    await owner();
    setHouseholdSettingValue(HOSTED_SEARCH_KEY_SETTING, SECRET);
    const result = await search(member("Willow", "teen"));
    expect(providerHits).toEqual([]);
    expect(result.rows[0]?.title).toBe("Keyless");
  });

  test("a guest with a key set: no age signal, so the provider is never called", async () => {
    await owner();
    setHouseholdSettingValue(HOSTED_SEARCH_KEY_SETTING, SECRET);
    const result = await search(member("Marsh", "guest"));
    expect(providerHits).toEqual([]);
    expect(result.rows[0]?.title).toBe("Keyless");
  });

  test("a stored key that no longer decrypts falls back to SearXNG, never fails the search", async () => {
    const adult = await owner();
    setHouseholdSettingValue(HOSTED_SEARCH_KEY_SETTING, SECRET);
    db.update(settingsValues).set({ value: "enc:v1:garbage" }).where(eq(settingsValues.key, HOSTED_SEARCH_KEY_SETTING)).run();
    const result = await search(adult);
    expect(providerHits).toEqual([]);
    expect(result.rows[0]?.title).toBe("Keyless");
  });

  test("provider markup and entities are stripped from titles and snippets", async () => {
    const adult = await owner();
    setHouseholdSettingValue(HOSTED_SEARCH_KEY_SETTING, SECRET);
    provider.stop(true);
    provider = Bun.serve({ hostname: "127.0.0.1", port: 0,
      fetch: () => Response.json({ web: { results: [{ title: "Node &amp; <strong>Bun</strong>", url: "https://hosted.example/", description: "a &lt;b&gt; <strong>runtime</strong> &#x27;fast&#x27;" }] } }),
    });
    __setHostedSearchEndpointForTests(`http://127.0.0.1:${provider.port}/res/v1/web/search`);
    const result = await search(adult);
    expect(result.rows[0]?.title).toBe("Node & Bun");
    expect(result.text).toContain("a <b> runtime 'fast'");
    expect(result.text).not.toContain("<strong>");
  });

  test("no key (the default): an adult gets keyless SearXNG as today", async () => {
    const adult = await owner();
    const result = await search(adult);
    expect(providerHits).toEqual([]);
    expect(result.rows[0]?.title).toBe("Keyless");
  });

  test("clearing the key restores the keyless default", async () => {
    const adult = await owner();
    setHouseholdSettingValue(HOSTED_SEARCH_KEY_SETTING, SECRET);
    resetValue(adult, "household", HOSTED_SEARCH_KEY_SETTING);
    const result = await search(adult);
    expect(providerHits).toEqual([]);
    expect(result.rows[0]?.title).toBe("Keyless");
  });

  test("a provider failure never fails the search: the adult falls back to SearXNG", async () => {
    const adult = await owner();
    setHouseholdSettingValue(HOSTED_SEARCH_KEY_SETTING, SECRET);
    provider.stop(true);
    const result = await search(adult);
    expect(result.rows[0]?.title).toBe("Keyless");
  });

  test("the key is stored encrypted, never as plaintext", async () => {
    await owner();
    setHouseholdSettingValue(HOSTED_SEARCH_KEY_SETTING, SECRET);
    const row = db.select().from(settingsValues).where(eq(settingsValues.key, HOSTED_SEARCH_KEY_SETTING)).get();
    expect(row).toBeDefined();
    expect(JSON.stringify(row)).not.toContain(SECRET);
  });
});

describe("hosted search on the privacy list (THIN-4H)", () => {
  test("no row without a key; a row naming the provider once a key is set", async () => {
    const { platformConnections } = await import("@/lib/privacy");
    await owner();
    expect(platformConnections().some((c) => c.id === "platform:hosted-search")).toBe(false);
    setHouseholdSettingValue(HOSTED_SEARCH_KEY_SETTING, SECRET);
    const found = platformConnections().find((c) => c.id === "platform:hosted-search");
    expect(found?.destination ?? JSON.stringify(found)).toContain("api.search.brave.com");
    expect(JSON.stringify(found)).not.toContain(SECRET);
  });
});
