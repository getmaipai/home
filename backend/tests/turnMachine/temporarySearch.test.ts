// THIN-INC row 4 (rules 0, 7, 12; THIN-4H): a temporary request leaves no
// person-keyed search query history or cache, and the hosted provider is
// refused for a child or a teen. The searxng integration is driven through
// createHost(), the way a package's search tool reaches it, against a real
// local server that stands in for SearXNG and one for the hosted provider
// (the same shape tests/hostedSearch.test.ts uses). No network.
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people } from "@/db/schema";
import { TestClient } from "../client";
import { resetDb } from "../reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { createHost, __resetSearchCacheForTests, __resetSearchRotationForTests, __resetSearxngEnginesCacheForTests } from "@/lib/packageHost";
import { HOSTED_SEARCH_KEY_SETTING, __setHostedSearchEndpointForTests, hostedSearch } from "@/lib/hostedSearch";
import { createConversation, isTemporaryConversation } from "@/lib/conversationHistory";
import { setHouseholdSettingValue } from "@/lib/settings";
import { PackageManifest } from "@maipai/spec/gen/ts/manifest.js";
import type { PersonRow } from "@/types";
import { changedTables, tableCounts } from "./modeHarness";

const SECRET = "BSA-test-key-do-not-log";
const QUERY = "where do otters sleep";

let searxng: ReturnType<typeof Bun.serve>;
let provider: ReturnType<typeof Bun.serve>;
let searxngQueries: string[] = [];
let providerQueries: string[] = [];
let owner: PersonRow;
let client: TestClient;

beforeEach(async () => {
  resetDb();
  __resetThrottleForTests();
  __resetRateLimiterForTests();
  __resetSearchCacheForTests();
  __resetSearchRotationForTests();
  __resetSearxngEnginesCacheForTests();
  searxngQueries = [];
  providerQueries = [];
  searxng = Bun.serve({
    port: 0,
    fetch: (req) => {
      const url = new URL(req.url);
      if (url.pathname === "/search") searxngQueries.push(url.searchParams.get("q") ?? "");
      return Response.json({ results: [{ title: "Keyless", url: "https://keyless.example/", content: "from searxng" }] });
    },
  });
  provider = Bun.serve({
    port: 0,
    fetch: (req) => {
      providerQueries.push(new URL(req.url).searchParams.get("q") ?? "");
      return Response.json({ web: { results: [{ title: "Hosted", url: "https://hosted.example/", description: "from the provider" }] } });
    },
  });
  __setHostedSearchEndpointForTests(`http://127.0.0.1:${provider.port}/res/v1/web/search`);
  setHouseholdSettingValue("search.searxng_url", `http://127.0.0.1:${searxng.port}`);
  client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  owner = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
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

function member(name: string, role: "child" | "teen") {
  const now = new Date().toISOString();
  const id = `person-inc-${name.toLowerCase()}`;
  db.insert(people).values({ id, displayName: name, role, avatarSeed: id, source: "hub", createdAt: now, updatedAt: now, hlc: "1700000000000:2:testfix" }).run();
  return db.select().from(people).where(eq(people.id, id)).get()!;
}

function search(actor: PersonRow, conversationId: string, turnId: string) {
  return createHost(actor, manifest(), [], { id: turnId, conversationId }).integration.call("searxng", "search", { query: QUERY });
}

function conversationFor(actor: PersonRow, mode: "chat" | "temporary"): string {
  const created = createConversation(actor, { surface: "chat", mode });
  if (!created.ok) throw new Error(created.error);
  expect(isTemporaryConversation(created.value.id)).toBe(mode === "temporary");
  return created.value.id;
}

describe("THIN-INC row 4: a temporary search keeps no query history or cache", () => {
  test("durable control: the same query twice in a durable chat is served from the cache", async () => {
    const id = conversationFor(owner, "chat");
    await search(owner, id, "turn-d-1");
    await search(owner, id, "turn-d-2");
    expect(searxngQueries).toEqual([QUERY]);
  });

  test("temporary search leaves no person-keyed query history or cache", async () => {
    const temporaryId = conversationFor(owner, "temporary");
    const durableId = conversationFor(owner, "chat");
    const before = tableCounts();
    await search(owner, temporaryId, "turn-t-1");
    await search(owner, temporaryId, "turn-t-2");
    // Not cached: each lookup went to the engine itself.
    expect(searxngQueries).toEqual([QUERY, QUERY]);
    // Not remembered for later: the same words in a durable chat are a fresh lookup too.
    await search(owner, durableId, "turn-d-1");
    expect(searxngQueries).toEqual([QUERY, QUERY, QUERY]);
    // And no table holds a query.
    expect(changedTables(before, tableCounts())).toEqual([]);
  });
});

describe("THIN-INC row 4: the hosted provider and the age gate", () => {
  test("hosted search refused for a child or teen", async () => {
    setHouseholdSettingValue(HOSTED_SEARCH_KEY_SETTING, SECRET);
    for (const actor of [member("Sprout", "child"), member("Willow", "teen")]) {
      // The provider function itself, with the key set: null, and the key is never used.
      expect(await hostedSearch(QUERY, actor.role === "child" ? "child" : "teen", "strict", undefined, actor.role)).toBeNull();
      // And through the host, in a durable chat (a minor has no temporary chat): SearXNG answers.
      const result = (await search(actor, conversationFor(owner, "chat"), `turn-${actor.id}`)) as { rows: { title: string }[] };
      expect(result.rows[0]?.title).toBe("Keyless");
    }
    expect(providerQueries).toEqual([]);
  });
});
