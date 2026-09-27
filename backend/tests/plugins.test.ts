import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdirSync, writeFileSync, utimesSync, rmSync } from "node:fs";
import { join } from "node:path";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { setHouseholdSettingValue } from "@/lib/settings";
import {
  listPackageIds,
  loadPackage,
  loadManifestOnly,
  loadProjectPackage,
  registerAllPackageNotificationTypes,
  registerAllPackageProjectTypes,
  warmPackage,
  withHouseholdPlaceDefault,
  __resetPackageCachesForTests,
} from "@/lib/plugins";
import { getProjectType, __resetProjectTypesForTests } from "@/lib/projects/projectTypes";
import { installedPackageVersionDir } from "@/lib/paths";
import { db } from "@/db";
import { scheduledJobs, packageInstalls } from "@/db/schema";
import { eq } from "drizzle-orm";

beforeEach(() => {
  resetDb();
  __resetThrottleForTests();
  __resetLlmSupervisorForTests();
});

describe("the bundled remember package", () => {
  test("is discoverable and its manifest + recipe validate against spec's schemas", () => {
    expect(listPackageIds()).toContain("remember");
    const loaded = loadPackage("remember");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.manifest.id).toBe("remember");
    expect(loaded.value.manifest.permissions).toContain("memory:write");
    expect(loaded.value.recipe.steps.length).toBeGreaterThan(0);
  });
});

describe("the bundled recall package", () => {
  test("is discoverable and its manifest + recipe validate against spec's schemas", () => {
    expect(listPackageIds()).toContain("recall");
    const loaded = loadPackage("recall");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.manifest.id).toBe("recall");
    expect(loaded.value.manifest.permissions).toContain("memory:read");
    expect(loaded.value.recipe.steps.length).toBeGreaterThan(0);
  });
});

// The first real plugin built on host.fetch (2026-09-05). No automated
// test here calls the real Open-Meteo API (bun:test stays deterministic
// and offline per .github/CLAUDE.md's testing standards); the recipe's
// own step logic - geocode, pick coordinates, forecast, pick temperature,
// format - has its own dedicated conformance fixture
// (spec/fixtures/recipes/weather-geocoded.json) using response shapes
// captured from a real Open-Meteo call, and the real host.fetch mechanics
// (permission/rate-limit/SSRF gating, the actual HTTP call) are covered
// in packageHost.test.ts. This just proves the package itself is real
// and well-formed.
describe("the bundled weather package", () => {
  test("is discoverable and its manifest + recipe validate against spec's schemas", () => {
    expect(listPackageIds()).toContain("weather");
    const loaded = loadPackage("weather");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.manifest.id).toBe("weather");
    expect(loaded.value.manifest.permissions).toEqual(
      expect.arrayContaining(["net:geocoding-api.open-meteo.com", "net:api.open-meteo.com"]),
    );
    expect(loaded.value.recipe.steps.length).toBeGreaterThan(0);
  });
});

// The second real plugin built on host.fetch (2026-09-05). Same posture as
// the weather package's own test: no automated test here calls the real
// dictionaryapi.dev (bun:test stays deterministic and offline); the
// recipe's own step logic has its own dedicated conformance fixture
// (spec/fixtures/recipes/define-word.json). Live-verified manually
// against the real API - including a real, live-observed transient
// outage (two consecutive 15s timeouts, recovered less than a minute
// later) that surfaced as the ordinary, graceful "That didn't work -
// sorry" plugin-error phrasing rather than a crash or a hang, real
// confirmation that host.fetch's timeout and error handling work under
// a genuine failure, not just a synthetic test one.
describe("the bundled define package", () => {
  test("is discoverable and its manifest + recipe validate against spec's schemas", () => {
    expect(listPackageIds()).toContain("define");
    const loaded = loadPackage("define");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.manifest.id).toBe("define");
    expect(loaded.value.manifest.permissions).toContain("net:api.dictionaryapi.dev");
    expect(loaded.value.recipe.steps.length).toBeGreaterThan(0);
  });
});

// The third real plugin built on host.fetch (2026-09-05), and the first
// with zero inputs - no wildcard capture, `deterministicArgs()`'s
// no-required-args path fires it with `{}`. Same posture as the other
// two: no automated test calls the real icanhazdadjoke.com; the recipe's
// own step logic has its own conformance fixture
// (spec/fixtures/recipes/joke.json). Live-verified through both
// runPlugin directly and the full turn engine's real deterministic
// routing.
describe("the bundled joke package", () => {
  test("is discoverable and its manifest + recipe validate against spec's schemas", () => {
    expect(listPackageIds()).toContain("joke");
    const loaded = loadPackage("joke");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.manifest.id).toBe("joke");
    expect(loaded.value.manifest.permissions).toContain("net:icanhazdadjoke.com");
    expect(loaded.value.recipe.inputs).toEqual([]);
    expect(loaded.value.recipe.steps.length).toBeGreaterThan(0);
  });
});

// The fourth real plugin built on host.fetch (2026-09-05). Same posture as
// the others: no automated test here calls the real opentdb.com; the
// recipe's own step logic has its own conformance fixture
// (spec/fixtures/recipes/trivia.json), using a real captured response that
// includes opentdb.com's own unconditional HTML-entity encoding - the fixture
// that drove interpolate()'s entity-decoding fix (recipe-interpreter.ts,
// recipe_interpreter.py) landing the same day.
describe("the bundled trivia package", () => {
  test("is discoverable and its manifest + recipe validate against spec's schemas", () => {
    expect(listPackageIds()).toContain("trivia");
    const loaded = loadPackage("trivia");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.manifest.id).toBe("trivia");
    expect(loaded.value.manifest.permissions).toContain("net:opentdb.com");
    expect(loaded.value.recipe.inputs).toEqual([]);
    expect(loaded.value.recipe.steps.length).toBeGreaterThan(0);
  });
});

// The first package to hand a household member's own free-typed text
// straight to the `compute` step (step 7) rather than a package's own
// hardcoded template - unlike weather/define/joke/trivia above, no
// network call to avoid, so this one runs for real, deterministically
// and offline, in every test run rather than only being conformance-
// fixture-covered.
describe("the bundled math package", () => {
  test("is discoverable and its manifest + recipe validate against spec's schemas", () => {
    expect(listPackageIds()).toContain("math");
    const loaded = loadPackage("math");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.manifest.id).toBe("math");
    expect(loaded.value.manifest.permissions).toEqual([]);
    expect(loaded.value.recipe.steps.length).toBeGreaterThan(0);
  });
});

describe("the bundled convert package", () => {
  test("is discoverable and its manifest + recipe validate against spec's schemas", () => {
    expect(listPackageIds()).toContain("convert");
    const loaded = loadPackage("convert");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.manifest.id).toBe("convert");
    expect(loaded.value.manifest.permissions).toEqual([]);
    expect(loaded.value.recipe.steps.length).toBeGreaterThan(0);
  });
});

describe("the bundled translate package", () => {
  test("is discoverable and its manifest + recipe validate against spec's schemas", () => {
    expect(listPackageIds()).toContain("translate");
    const loaded = loadPackage("translate");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.manifest.id).toBe("translate");
    expect(loaded.value.manifest.permissions).toEqual(["llm:complete"]);
    expect(loaded.value.recipe.steps.length).toBeGreaterThan(0);
  });
});

describe("the bundled websearch package", () => {
  test("is discoverable and its manifest + recipe validate against spec's schemas", () => {
    expect(listPackageIds()).toContain("websearch");
    const loaded = loadPackage("websearch");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.manifest.id).toBe("websearch");
    expect(loaded.value.manifest.permissions).toEqual(["integration:searxng", "llm:complete"]);
    expect(loaded.value.recipe.steps.length).toBeGreaterThan(0);
  });
});

describe("the bundled step-8 packages (lists, reminders, timers)", () => {
  const cases: [string, string[]][] = [
    ["list-add", ["lists:write"]],
    ["list-view", ["lists:read"]],
    ["remind", ["reminders:write"]],
    ["timer", ["timers:write"]],
  ];
  for (const [id, permissions] of cases) {
    test(`${id} is discoverable and its manifest + recipe validate against spec's schemas`, () => {
      expect(listPackageIds()).toContain(id);
      const loaded = loadPackage(id);
      expect(loaded.ok).toBe(true);
      if (!loaded.ok) return;
      expect(loaded.value.manifest.id).toBe(id);
      expect(loaded.value.manifest.permissions).toEqual(permissions);
      expect(loaded.value.recipe.steps.length).toBeGreaterThan(0);
    });
  }
});

describe("the bundled step-9 packages (lights, lock)", () => {
  const cases: [string, string[]][] = [
    ["lights-on", ["home:light"]],
    ["lights-off", ["home:light"]],
    ["lock-doors", ["home:lock"]],
  ];
  for (const [id, permissions] of cases) {
    test(`${id} is discoverable and its manifest + recipe validate against spec's schemas`, () => {
      expect(listPackageIds()).toContain(id);
      const loaded = loadPackage(id);
      expect(loaded.ok).toBe(true);
      if (!loaded.ok) return;
      expect(loaded.value.manifest.id).toBe(id);
      expect(loaded.value.manifest.permissions).toEqual(permissions);
      expect(loaded.value.recipe.steps.length).toBeGreaterThan(0);
    });
  }

  test("lock-doors declares consequential: true and no routing.patterns", () => {
    const loaded = loadPackage("lock-doors");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.manifest.consequential).toBe(true);
    expect(loaded.value.manifest.routing?.patterns ?? []).toEqual([]);
  });
});

describe("SEC-2: PACKAGES_DIR readers reject a malformed/traversal id before any join()", () => {
  test("loadManifestOnly rejects it", () => {
    const result = loadManifestOnly("../../data/packages/weather");
    expect(result.ok).toBe(false);
  });

  test("loadPackage rejects it", () => {
    const result = loadPackage("../../data/packages/weather");
    expect(result.ok).toBe(false);
  });
});

async function owner() {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  return client;
}

async function child(owner: TestClient) {
  const created = await owner.post("/api/people", { displayName: "Bramble", role: "child" });
  const person = (await created.json()) as { id: string };
  const client = new TestClient();
  await client.post("/api/auth/select", { personId: person.id });
  return client;
}

async function teen(owner: TestClient) {
  const created = await owner.post("/api/people", { displayName: "Nova", role: "teen" });
  const person = (await created.json()) as { id: string };
  const client = new TestClient();
  await client.post("/api/auth/select", { personId: person.id });
  return client;
}

describe("GET /api/plugins", () => {
  test("requires auth", async () => {
    const res = await new TestClient().get("/api/plugins");
    expect(res.status).toBe(401);
  });

  test("lists the bundled remember package's manifest", async () => {
    const client = await owner();
    const res = await client.get("/api/plugins");
    const body = (await res.json()) as Array<{ id: string }>;
    expect(body.some((m) => m.id === "remember")).toBe(true);
  });

  test("filters packages by the signed-in person's minimum role", async () => {
    const ownerClient = await owner();
    const ownerResponse = await ownerClient.get("/api/plugins");
    const ownerPackages = (await ownerResponse.json()) as Array<{ id: string }>;
    const allIds = ownerPackages.map((manifest) => manifest.id).sort();
    expect(allIds).toContain("lock-doors");

    const childClient = await child(ownerClient);
    const childResponse = await childClient.get("/api/plugins");
    const childPackages = (await childResponse.json()) as Array<{ id: string }>;
    expect(childPackages.map((manifest) => manifest.id).sort()).toEqual(allIds.filter((id) => id !== "lock-doors"));

    const teenClient = await teen(ownerClient);
    const teenResponse = await teenClient.get("/api/plugins");
    const teenPackages = (await teenResponse.json()) as Array<{ id: string }>;
    expect(teenPackages.map((manifest) => manifest.id).sort()).toEqual(allIds);
    expect(teenPackages.map((manifest) => manifest.id)).toContain("lock-doors");
  });
});

describe("POST /api/plugins/remember/run", () => {
  test("runs the recipe end to end: replies, and the fact lands in the real memory store", async () => {
    const client = await owner();
    const res = await client.post("/api/plugins/remember/run", { fact: "the wifi password is on the fridge" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { reply?: { text: string } };
    expect(body.reply?.text).toBe("Got it, I'll remember that.");

    const recall = await client.post("/api/memory/recall", { q: "wifi password" });
    const matches = (await recall.json()) as Array<{ record: { text: string } }>;
    expect(matches.some((m) => m.record.text.includes("wifi password"))).toBe(true);
  });

  test("a child, exactly at the min_role floor, can still run it", async () => {
    const ownerClient = await owner();
    const childClient = await child(ownerClient);
    const res = await childClient.post("/api/plugins/remember/run", { fact: "loses the second remote" });
    expect(res.status).toBe(200);
  });

  test("404s for an unknown package id", async () => {
    const client = await owner();
    const res = await client.post("/api/plugins/does-not-exist/run", { fact: "x" });
    expect(res.status).toBe(404);
  });

  // SEC-2 (code review, 2026-09-06): Hono matches `/:id/run` on the raw,
  // un-decoded path and only percent-decodes the param afterward, so a
  // `%2F`-encoded id used to reach `join(PACKAGES_DIR, id, ...)` as a
  // real `../../` traversal. app.request() (what TestClient wraps) does
  // the identical raw-path routing a real HTTP request would.
  test("a path-traversal id is rejected without ever touching the filesystem, not treated as a 404", async () => {
    const client = await owner();
    const res = await client.post("/api/plugins/..%2F..%2Fdata%2Fpackages%2Fweather/run", { fact: "x" });
    expect(res.status).toBe(400);
  });


  // A review (2026-09-04) found that a missing required input reached
  // the interpreter, left its `{fact}` placeholder un-interpolated, and
  // was written to the real memory store as literal text with a 200
  // back. This is the regression test for that fix.
  test("400s and writes nothing when a required input is missing", async () => {
    const client = await owner();
    const res = await client.post("/api/plugins/remember/run", {});
    expect(res.status).toBe(400);

    const recall = await client.post("/api/memory/recall", { q: "fact" });
    const matches = (await recall.json()) as Array<{ record: { text: string } }>;
    expect(matches.some((m) => m.record.text.includes("{fact}"))).toBe(false);
  });
});

describe("POST /api/plugins/recall/run", () => {
  test("runs the recipe end to end: finds and speaks back a real remembered fact", async () => {
    const client = await owner();
    const remembered = await client.post("/api/plugins/remember/run", { fact: "the wifi password is on the fridge" });
    expect(remembered.status).toBe(200);

    const res = await client.post("/api/plugins/recall/run", { topic: "wifi password" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { reply?: { text: string } };
    expect(body.reply?.text).toContain("wifi password");
  });

  test("a plain, honest reply when nothing matches - not an empty string or an error", async () => {
    const client = await owner();
    const res = await client.post("/api/plugins/recall/run", { topic: "the moon landing" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { reply?: { text: string } };
    expect(body.reply?.text).toBe("I don't remember anything about that.");
  });

  test("a child, exactly at the min_role floor, can still run it", async () => {
    const ownerClient = await owner();
    const childClient = await child(ownerClient);
    const res = await childClient.post("/api/plugins/recall/run", { topic: "anything" });
    expect(res.status).toBe(200);
  });

  test("400s for a missing required input", async () => {
    const client = await owner();
    const res = await client.post("/api/plugins/recall/run", {});
    expect(res.status).toBe(400);
  });
});

describe("POST /api/plugins/math/run", () => {
  test("runs the recipe end to end: a real compute step evaluation", async () => {
    const client = await owner();
    const res = await client.post("/api/plugins/math/run", { expression: "15 * 12" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { reply?: { text: string } };
    expect(body.reply?.text).toBe("180");
  });

  // Names what this actually exercises: sqrt(), not unit conversion -
  // real unit-conversion coverage (compute's "X unit to unit" syntax)
  // lives in the convert package's own tests below, since that's the
  // package scoped to that syntax.
  test("supports sqrt(), via compute's own restricted evaluator", async () => {
    const client = await owner();
    const res = await client.post("/api/plugins/math/run", { expression: "sqrt(144)" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { reply?: { text: string } };
    expect(body.reply?.text).toBe("12");
  });

  // A real gap found while building this package: a malformed expression
  // (compute's own restricted evaluator can't parse "plus" as an
  // operator) used to propagate as an unhandled error all the way past
  // this route - runPlugin() had no case for ComputeError, only
  // HostError, so it fell through to `throw err` and Hono's own
  // catch-all returned a bare 500 instead of a clean, specific 400. This
  // is the regression test for that fix (lib/plugins.ts, spec's own
  // recipe-interpreter.ts on both TS and Python). The exact message is
  // asserted (not just a substring that's always present because the
  // input round-trips into it) so a regression in evaluateExpression's
  // own message-generation logic - not just its ComputeError-ness -
  // would fail this test too.
  // #72's normalizeSpokenMath() (b9ffc9c) now turns "plus"/"minus"/
  // "times"/etc into real operators before evaluation, so "15 plus 12"
  // itself no longer reaches the evaluator malformed - it evaluates to
  // 27. "fifteen plus twelve" still does, since normalizeSpokenMath()
  // only rewrites operator WORDS, not spelled-out number words, and the
  // error message reports the normalized text (what the evaluator
  // actually saw), not the original input.
  test("400s with a clear message for a malformed expression, not a 500", async () => {
    const client = await owner();
    const res = await client.post("/api/plugins/math/run", { expression: "fifteen plus twelve" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('"fifteen + twelve" failed to evaluate: Undefined symbol fifteen');
  });
});

describe("POST /api/plugins/convert/run", () => {
  test("runs the recipe end to end: compute's own unit-conversion syntax", async () => {
    const client = await owner();
    const res = await client.post("/api/plugins/convert/run", { expression: "5 miles to km" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { reply?: { text: string } };
    expect(body.reply?.text).toBe("8.04672 km");
  });

  // mathjs has no currency units - this is the honest boundary
  // documented in the package's own README, not a bug: currency needs a
  // separate package with a real exchange-rate lookup.
  test("400s for currency, which isn't a unit mathjs knows", async () => {
    const client = await owner();
    const res = await client.post("/api/plugins/convert/run", { expression: "5 dollars to euros" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('"5 dollars to euros" failed to evaluate: Undefined symbol dollars');
  });
});

describe("POST /api/plugins/translate/run", () => {
  // No real chat model in tests - lib/llm.ts's own default (no engine
  // configured) resolves to a deterministic stub client (the same one
  // backend/tests/llm.test.ts and packageHost.test.ts use), so this
  // proves the real recipe -> llm_complete -> host.llm.complete ->
  // lib/llm.ts wiring end to end without needing a real model loaded,
  // not real translation quality (that's the model's own job).
  test("runs the recipe end to end: llm_complete through the real host, stub chat backend", async () => {
    const client = await owner();
    const res = await client.post("/api/plugins/translate/run", { expression: "hello world to spanish" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { reply?: { text: string } };
    expect(body.reply?.text).toContain("hello world to spanish");
    expect(body.reply?.text).toContain("[stub model: no real model loaded, this is a canned reply]");
  });
});

describe("POST /api/plugins/websearch/run", () => {
  // A real local SearXNG stand-in (Bun.serve) plus the stub chat backend
  // (no real engine configured in tests) - proves the real recipe chain
  // end to end: integration.call("searxng", "search", ...) -> the real
  // rows binding -> pick -> format with a synthesis_hint and no text
  // (CHAT-16: the composer phrases the rows in the turn; run directly,
  // the package returns the rows, the hint and no reply). Not real
  // search or answer quality (that needs a real SearXNG instance and a
  // real model, see this package's own quality_scale.yaml).
  test("runs the recipe end to end: integration.call through to the rows and the synthesis_hint, no reply", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () =>
        Response.json({
          results: [{ title: "Mount Everest", url: "https://example.com/everest", content: "The tallest mountain above sea level." }],
        }),
    });
    try {
      setHouseholdSettingValue("search.searxng_url", `http://127.0.0.1:${server.port}`);
      const client = await owner();
      const res = await client.post("/api/plugins/websearch/run", { expression: "the tallest mountain" });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { reply?: { text: string }; data?: { rows?: { title: string; url: string }[]; query?: string }; synthesis_hint?: string };
      expect(body.reply).toBeUndefined();
      expect(body.synthesis_hint).toContain("answer the question from these search results");
      expect(body.data?.rows?.map((r) => r.title)).toEqual(["Mount Everest"]);
      expect(body.data?.query).toBe("the tallest mountain");
    } finally {
      server.stop(true);
    }
  });

  test("400s with a clear message when SearXNG isn't set up yet", async () => {
    const client = await owner();
    const res = await client.post("/api/plugins/websearch/run", { expression: "the tallest mountain" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toContain("isn't set up yet");
  });
});

describe("POST /api/plugins/list-add/run and list-view/run", () => {
  test("adds an item, then view reads it back - the real shopping list, not a canned reply", async () => {
    const client = await owner();
    const addRes = await client.post("/api/plugins/list-add/run", { item: "milk" });
    expect(addRes.status).toBe(200);
    const addBody = (await addRes.json()) as { reply?: { text: string } };
    expect(addBody.reply?.text).toBe("Added milk to your shopping list.");

    const viewRes = await client.post("/api/plugins/list-view/run", {});
    expect(viewRes.status).toBe(200);
    const viewBody = (await viewRes.json()) as { reply?: { text: string } };
    expect(viewBody.reply?.text).toBe("milk");
  });

  test("view reports an empty list plainly", async () => {
    const client = await owner();
    const res = await client.post("/api/plugins/list-view/run", {});
    expect(res.status).toBe(200);
    const body = (await res.json()) as { reply?: { text: string } };
    expect(body.reply?.text).toBe("Your shopping list is empty.");
  });
});

describe("POST /api/plugins/remind/run", () => {
  test("runs the recipe end to end: real chrono-node parsing, a real scheduled core job", async () => {
    const client = await owner();
    const res = await client.post("/api/plugins/remind/run", { expression: "at 6 to call Nadia" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { reply?: { text: string } };
    expect(body.reply?.text).toContain("call Nadia");
    const rows = db.select().from(scheduledJobs).where(eq(scheduledJobs.job, "reminders.fire")).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe("core");
  });

  test("400s with a clear message when no time phrase is found", async () => {
    const client = await owner();
    const res = await client.post("/api/plugins/remind/run", { expression: "call Nadia" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toContain("figure out when");
  });
});

describe("POST /api/plugins/timer/run", () => {
  test("runs the recipe end to end: exact deterministic duration parsing, a real scheduled core job", async () => {
    const client = await owner();
    const before = Date.now();
    const res = await client.post("/api/plugins/timer/run", { expression: "ten minutes" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { reply?: { text: string } };
    expect(body.reply?.text).toContain("ten minutes");
    const rows = db.select().from(scheduledJobs).where(eq(scheduledJobs.job, "timers.fire")).all();
    expect(rows).toHaveLength(1);
    const nextRunAt = new Date(rows[0]!.nextRunAt).getTime();
    expect(nextRunAt).toBeGreaterThanOrEqual(before + 600_000);
    expect(nextRunAt).toBeLessThan(before + 601_000);
  });

  test("400s with a clear message for a duration this grammar doesn't cover", async () => {
    const client = await owner();
    const res = await client.post("/api/plugins/timer/run", { expression: "a while" });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/plugins/lights-on and lights-off/run", () => {
  test("runs the recipe end to end: a real POST to Home Assistant's own REST shape", async () => {
    let seenPath = "";
    let seenBody: unknown = null;
    const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        seenPath = new URL(req.url).pathname;
        seenBody = await req.json();
        return Response.json({ context: { id: "abc" } });
      },
    });
    try {
      setHouseholdSettingValue("home.base_url", `http://127.0.0.1:${server.port}`);
      setHouseholdSettingValue("home.access_token", "test-token");
      const client = await owner();
      const res = await client.post("/api/plugins/lights-on/run", { room: "living room" });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { reply?: { text: string } };
      expect(body.reply?.text).toBe("Turning on the living room light.");
      expect(seenPath).toBe("/api/services/light/turn_on");
      expect(seenBody).toEqual({ area: "living room" });
    } finally {
      server.stop(true);
    }
  });

  test("400s with a clear message when Home Assistant isn't set up yet", async () => {
    const client = await owner();
    const res = await client.post("/api/plugins/lights-off/run", { room: "kitchen" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toContain("isn't set up yet");
  });
});

describe("POST /api/plugins/lock-doors/run", () => {
  test("runs the recipe end to end: a real POST to Home Assistant's own lock.lock service", async () => {
    let seenPath = "";
    const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        seenPath = new URL(req.url).pathname;
        return Response.json({ context: { id: "abc" } });
      },
    });
    try {
      setHouseholdSettingValue("home.base_url", `http://127.0.0.1:${server.port}`);
      setHouseholdSettingValue("home.access_token", "test-token");
      const client = await owner();
      const res = await client.post("/api/plugins/lock-doors/run", {});
      expect(res.status).toBe(200);
      const body = (await res.json()) as { reply?: { text: string } };
      expect(body.reply?.text).toBe("Locking the front door.");
      expect(seenPath).toBe("/api/services/lock/lock");
    } finally {
      server.stop(true);
    }
  });
});

describe("registerAllPackageNotificationTypes", () => {
  test("the boot-time pass over every bundled package's manifest never throws", () => {
    expect(() => registerAllPackageNotificationTypes()).not.toThrow();
  });
});

// Found live 2026-09-11: Home's own weather cards showed the manifest's
// hardcoded "Seattle" widget default next to a place-free chat turn that
// left the model to guess a `place` on its own (it guessed the literal
// word "here" - and Open-Meteo genuinely has a village named that).
// docs/BACKLOG.md's "A household-location setting" fixes both by giving
// warmPackage() and getWidgetData() a real place to fall back to.
describe("withHouseholdPlaceDefault", () => {
  test("leaves a declared place alone when the household hasn't set a location", () => {
    expect(withHouseholdPlaceDefault("weather", { place: "Seattle" })).toEqual({ place: "Seattle" });
  });

  test("overrides a manifest's own declared place with the household's real one once set", () => {
    setHouseholdSettingValue("household.home_place", "Portland, OR");
    expect(withHouseholdPlaceDefault("weather", { place: "Seattle" })).toEqual({ place: "Portland, OR" });
  });

  test("never adds a place to inputs that don't declare one", () => {
    setHouseholdSettingValue("household.home_place", "Portland, OR");
    expect(withHouseholdPlaceDefault("weather", {})).toEqual({});
  });

  // Code review, 2026-09-11: a future package could declare its own
  // `place` input meaning something unrelated to the household's own
  // location (a travel planner's destination, say) - scoped to `weather`
  // by package id so this can never silently rewrite it.
  test("never touches another package's own place input, even with the same field name", () => {
    setHouseholdSettingValue("household.home_place", "Portland, OR");
    expect(withHouseholdPlaceDefault("travel-planner", { place: "Tokyo" })).toEqual({ place: "Tokyo" });
  });
});

describe("warmPackage (session-d-packages-and-store.md step 3)", () => {
  test("a runPlugin failure (here: a key missing weather's own required 'place') is logged, never thrown or silent", async () => {
    await owner(); // warmActor() needs at least one active person to run at all
    const weather = loadPackage("weather");
    expect(weather.ok).toBe(true);
    if (!weather.ok) return;
    const originalError = console.error;
    const lines: string[] = [];
    console.error = (line: string) => lines.push(line);
    try {
      // A deliberately invalid warm key (weather's real args schema
      // requires "place") - runPlugin() fails ajv validation and
      // returns { ok: false } before ever reaching host.fetch, so this
      // never touches the network. Found by review: the first version
      // of warmPackage() never inspected runPlugin()'s own returned
      // failure shape at all, so this exact case failed silently.
      await warmPackage("weather", { ...weather.value.manifest, warm: { keys: [{}] } });
    } finally {
      console.error = originalError;
    }
    expect(lines.some((l) => l.includes("weather") && l.includes("failed to warm"))).toBe(true);
  });

  test("no warm.keys declared: a no-op, no actor lookup, nothing logged", async () => {
    const weather = loadPackage("weather");
    expect(weather.ok).toBe(true);
    if (!weather.ok) return;
    await expect(warmPackage("weather", { ...weather.value.manifest, warm: undefined })).resolves.toBeUndefined();
  });
});

// FAST-03 (docs/BACKLOG.md's 2026-09-12 chat block): one sentence per
// package that a person would say, because it is read in three places:
// the store card, the native tool description the chat model sees, and
// the confirm prompt ("Do you want me to ...?"), where a date, a
// parenthesis or a developer note gets spoken aloud.
describe("every bundled package's description is one sentence a person would say (FAST-03)", () => {
  // Tighter than the work order's `[^()]` body: no period, question
  // mark or exclamation inside, so a two-sentence description cannot
  // pass as one (a code review on this item).
  const RULE = /^[A-Z][^().?!]{10,118}\.$/;
  for (const id of listPackageIds()) {
    test(`${id}: one imperative sentence, at most 120 characters, no parentheses, no year`, () => {
      const loaded = loadManifestOnly(id);
      expect(loaded.ok).toBe(true);
      if (!loaded.ok) return;
      const description = loaded.value.description;
      expect(description).toMatch(RULE);
      expect(description).not.toMatch(/\b\d{4}\b/);
      expect(description.length).toBeLessThanOrEqual(120);
    });
  }
});

// MANIFEST-REFUSAL-01 (fixes getmaipai/home#166): the live incident
// (2026-09-26) had every bundled manifest fail validation against the
// still-running process's older schema with nothing logged anywhere -
// a household member just saw a refusal two hours later. This proves
// the loader itself now warns the moment a manifest stops validating,
// exactly once per real change (mtime), never once per read - the
// manifest here fails Zod validation on every single call (it is never
// cached the way a valid one is), so a naive "log on every read" would
// have flooded the log on every turn that ever tries this tool.
describe("loadManifestOnly: a manifest that fails validation is warned about once per change, not once per read", () => {
  const TEST_PKG_DIR = installedPackageVersionDir("broken-pkg", "1.0.0");
  const MANIFEST_PATH = join(TEST_PKG_DIR, "manifest.json");

  afterEach(() => {
    rmSync(TEST_PKG_DIR, { recursive: true, force: true });
    __resetPackageCachesForTests();
  });

  test("one warning for two reads of the same manifest, a second warning once it's edited", () => {
    db.insert(packageInstalls)
      .values({
        packageId: "broken-pkg",
        version: "1.0.0",
        previousVersion: null,
        channel: "stable",
        sourceCommit: "test",
        permissions: "[]",
        installedAt: "2026-01-01T00:00:00.000Z",
      })
      .run();
    mkdirSync(TEST_PKG_DIR, { recursive: true });
    writeFileSync(MANIFEST_PATH, JSON.stringify({ id: "broken-pkg", not_a_real_field: true }));

    const warnSpy = spyOn(console, "warn");
    try {
      const first = loadManifestOnly("broken-pkg");
      expect(first.ok).toBe(false);
      const second = loadManifestOnly("broken-pkg");
      expect(second.ok).toBe(false);
      expect(warnSpy.mock.calls.length).toBe(1);

      // Touch the file: a distinct mtime is the loader's own signal
      // that the manifest genuinely changed, forced explicitly rather
      // than trusting two writeFileSync calls a few microseconds apart
      // to land on different filesystem-reported millisecond values.
      writeFileSync(MANIFEST_PATH, JSON.stringify({ id: "broken-pkg", still_not_a_real_field: true }));
      utimesSync(MANIFEST_PATH, new Date(Date.now() + 60_000), new Date(Date.now() + 60_000));

      const third = loadManifestOnly("broken-pkg");
      expect(third.ok).toBe(false);
      expect(warnSpy.mock.calls.length).toBe(2);
    } finally {
      warnSpy.mockRestore();
    }
  });
});

// PROJECT-PKGTYPE-01: a real "project"-kind manifest + plan.json pair on
// disk, loaded through loadManifestOnly()/loadProjectPackage() and
// registered through registerAllPackageProjectTypes() - the loader
// proven against a real fixture package, not just commons' own
// round-trip fixture (which only proves the SCHEMA, never that this
// repo's own loader and registration wiring actually reads one off
// disk). Mirrors the "broken-pkg" fixture above: installedPackageVersionDir()
// + a packageInstalls row, so resolvePackageDir() resolves here without
// touching backend/packages/ at all.
describe("PROJECT-PKGTYPE-01: registerAllPackageProjectTypes() loads a real project-kind fixture package", () => {
  const TEST_PKG_DIR = installedPackageVersionDir("test-project-fixture", "1.0.0");
  const MANIFEST_PATH = join(TEST_PKG_DIR, "manifest.json");
  const PLAN_PATH = join(TEST_PKG_DIR, "plan.json");

  afterEach(() => {
    rmSync(TEST_PKG_DIR, { recursive: true, force: true });
    __resetPackageCachesForTests();
    __resetProjectTypesForTests();
  });

  test("a real manifest.json + plan.json pair registers as a real ProjectType, args filled into promptTemplate", () => {
    db.insert(packageInstalls)
      .values({
        packageId: "test-project-fixture",
        version: "1.0.0",
        previousVersion: null,
        channel: "stable",
        sourceCommit: "test",
        permissions: "[]",
        installedAt: "2026-01-01T00:00:00.000Z",
      })
      .run();
    mkdirSync(TEST_PKG_DIR, { recursive: true });
    writeFileSync(
      MANIFEST_PATH,
      JSON.stringify({
        id: "test-project-fixture",
        version: "0.1.0",
        kind: "project",
        category: "Family",
        display: "Test project fixture",
        description: "A fixture project type for loader tests.",
        author: "test",
        license: "AGPL-3.0",
        args: { type: "object", required: ["topic"], properties: { topic: { type: "string" } } },
        incognito: "unaffected",
        platforms: ["home"],
        min_role: "adult",
        consequential: false,
        offline: "full",
        min_app: "0.1.0",
        tier: 0,
      }),
    );
    writeFileSync(
      PLAN_PATH,
      JSON.stringify({
        steps: [{ id: "draft", kind: "text", needs: [], params: { role: "chat", promptTemplate: "Write about {topic}.", inputs: [] } }],
        ceilings: { maxWallSeconds: 60, maxGeneratorJobs: 1 },
      }),
    );

    expect(loadManifestOnly("test-project-fixture").ok).toBe(true);
    expect(loadProjectPackage("test-project-fixture").ok).toBe(true);

    registerAllPackageProjectTypes();
    const registered = getProjectType("test-project-fixture");
    expect(registered).toBeDefined();
    expect(registered?.title).toBe("Test project fixture");
    expect(registered?.minRole).toBe("adult");

    const plan = registered!.buildPlan({ topic: "dinosaurs" });
    const step = plan.steps[0] as { params: { promptTemplate: string } };
    expect(step.params.promptTemplate).toBe("Write about dinosaurs.");
  });

  test("a plan.json with an unbound {arg} placeholder is refused and skipped, not registered", () => {
    db.insert(packageInstalls)
      .values({
        packageId: "test-project-fixture",
        version: "1.0.0",
        previousVersion: null,
        channel: "stable",
        sourceCommit: "test",
        permissions: "[]",
        installedAt: "2026-01-01T00:00:00.000Z",
      })
      .run();
    mkdirSync(TEST_PKG_DIR, { recursive: true });
    writeFileSync(
      MANIFEST_PATH,
      JSON.stringify({
        id: "test-project-fixture",
        version: "0.1.0",
        kind: "project",
        category: "Family",
        display: "Test project fixture",
        description: "A fixture project type for loader tests.",
        author: "test",
        license: "AGPL-3.0",
        // No "topic" arg declared at all - the plan below references it.
        args: { type: "object", properties: {} },
        incognito: "unaffected",
        platforms: ["home"],
        min_role: "adult",
        consequential: false,
        offline: "full",
        min_app: "0.1.0",
        tier: 0,
      }),
    );
    writeFileSync(
      PLAN_PATH,
      JSON.stringify({
        steps: [{ id: "draft", kind: "text", needs: [], params: { role: "chat", promptTemplate: "Write about {topic}.", inputs: [] } }],
        ceilings: { maxWallSeconds: 60, maxGeneratorJobs: 1 },
      }),
    );

    const warnSpy = spyOn(console, "warn");
    try {
      registerAllPackageProjectTypes();
      expect(getProjectType("test-project-fixture")).toBeUndefined();
      expect(warnSpy.mock.calls.length).toBe(1);
      expect(String(warnSpy.mock.calls[0]?.[0])).toContain("not a declared arg");
    } finally {
      warnSpy.mockRestore();
    }
  });

  // A review's own finding: without this check, `{age}` below would
  // have been silently `String()`-ed into the prompt as the literal
  // text "[object Object]" instead of being refused.
  test("an arg declared type: object, referenced in a promptTemplate, is refused rather than silently stringified", () => {
    db.insert(packageInstalls)
      .values({ packageId: "test-project-fixture", version: "1.0.0", previousVersion: null, channel: "stable", sourceCommit: "test", permissions: "[]", installedAt: "2026-01-01T00:00:00.000Z" })
      .run();
    mkdirSync(TEST_PKG_DIR, { recursive: true });
    writeFileSync(
      MANIFEST_PATH,
      JSON.stringify({
        id: "test-project-fixture",
        version: "0.1.0",
        kind: "project",
        category: "Family",
        display: "Test project fixture",
        description: "A fixture project type for loader tests.",
        author: "test",
        license: "AGPL-3.0",
        args: { type: "object", required: ["age"], properties: { age: { type: "object" } } },
        incognito: "unaffected",
        platforms: ["home"],
        min_role: "adult",
        consequential: false,
        offline: "full",
        min_app: "0.1.0",
        tier: 0,
      }),
    );
    writeFileSync(
      PLAN_PATH,
      JSON.stringify({
        steps: [{ id: "draft", kind: "text", needs: [], params: { role: "chat", promptTemplate: "Write for {age}.", inputs: [] } }],
        ceilings: { maxWallSeconds: 60, maxGeneratorJobs: 1 },
      }),
    );

    const warnSpy = spyOn(console, "warn");
    try {
      registerAllPackageProjectTypes();
      expect(getProjectType("test-project-fixture")).toBeUndefined();
      expect(String(warnSpy.mock.calls[0]?.[0])).toContain("substituting an object or array would silently corrupt the prompt");
    } finally {
      warnSpy.mockRestore();
    }
  });

  // A review's own finding: PackageManifest.safeParse only validates
  // `args` loosely (it's `z.any()`), so a schema-invalid args field
  // (here, an unterminated regex `pattern`) passes manifest validation
  // and only fails once ajv actually tries to compile it - synchronously,
  // inside buildProjectTypeFromManifest(). This proves that throw is
  // caught and the package is skipped, never crashing the whole
  // registration loop (and, unguarded, the hub's boot) over one bad
  // package - registerAllPackageProjectTypes()'s own doc comment's
  // "one bad package can't take down boot" promise, for a throw, not
  // just an `ok: false`.
  test("a manifest args schema ajv can't compile (a throw, not a validation failure) is warned about and skipped, never crashes registration", () => {
    db.insert(packageInstalls)
      .values({ packageId: "test-project-fixture", version: "1.0.0", previousVersion: null, channel: "stable", sourceCommit: "test", permissions: "[]", installedAt: "2026-01-01T00:00:00.000Z" })
      .run();
    mkdirSync(TEST_PKG_DIR, { recursive: true });
    writeFileSync(
      MANIFEST_PATH,
      JSON.stringify({
        id: "test-project-fixture",
        version: "0.1.0",
        kind: "project",
        category: "Family",
        display: "Test project fixture",
        description: "A fixture project type for loader tests.",
        author: "test",
        license: "AGPL-3.0",
        args: { type: "object", properties: { topic: { type: "string", pattern: "(" } } },
        incognito: "unaffected",
        platforms: ["home"],
        min_role: "adult",
        consequential: false,
        offline: "full",
        min_app: "0.1.0",
        tier: 0,
      }),
    );
    writeFileSync(
      PLAN_PATH,
      JSON.stringify({
        steps: [{ id: "draft", kind: "text", needs: [], params: { role: "chat", promptTemplate: "hello", inputs: [] } }],
        ceilings: { maxWallSeconds: 60, maxGeneratorJobs: 1 },
      }),
    );

    const warnSpy = spyOn(console, "warn");
    try {
      expect(() => registerAllPackageProjectTypes()).not.toThrow();
      expect(getProjectType("test-project-fixture")).toBeUndefined();
      expect(String(warnSpy.mock.calls[0]?.[0])).toContain("threw while building");
    } finally {
      warnSpy.mockRestore();
    }
  });

  test("a hyphenated arg name in a promptTemplate is recognized, validated and substituted", () => {
    db.insert(packageInstalls)
      .values({ packageId: "test-project-fixture", version: "1.0.0", previousVersion: null, channel: "stable", sourceCommit: "test", permissions: "[]", installedAt: "2026-01-01T00:00:00.000Z" })
      .run();
    mkdirSync(TEST_PKG_DIR, { recursive: true });
    writeFileSync(
      MANIFEST_PATH,
      JSON.stringify({
        id: "test-project-fixture",
        version: "0.1.0",
        kind: "project",
        category: "Family",
        display: "Test project fixture",
        description: "A fixture project type for loader tests.",
        author: "test",
        license: "AGPL-3.0",
        args: { type: "object", required: ["reader-age"], properties: { "reader-age": { type: "integer" } } },
        incognito: "unaffected",
        platforms: ["home"],
        min_role: "adult",
        consequential: false,
        offline: "full",
        min_app: "0.1.0",
        tier: 0,
      }),
    );
    writeFileSync(
      PLAN_PATH,
      JSON.stringify({
        steps: [{ id: "draft", kind: "text", needs: [], params: { role: "chat", promptTemplate: "For age {reader-age}.", inputs: [] } }],
        ceilings: { maxWallSeconds: 60, maxGeneratorJobs: 1 },
      }),
    );

    registerAllPackageProjectTypes();
    const registered = getProjectType("test-project-fixture");
    expect(registered).toBeDefined();
    const plan = registered!.buildPlan({ "reader-age": 7 });
    const step = plan.steps[0] as { params: { promptTemplate: string } };
    expect(step.params.promptTemplate).toBe("For age 7.");
  });

  test("a nullable-union arg type (JSON-Schema array [\"string\",\"null\"]) is accepted in a promptTemplate", () => {
    db.insert(packageInstalls)
      .values({ packageId: "test-project-fixture", version: "1.0.0", previousVersion: null, channel: "stable", sourceCommit: "test", permissions: "[]", installedAt: "2026-01-01T00:00:00.000Z" })
      .run();
    mkdirSync(TEST_PKG_DIR, { recursive: true });
    writeFileSync(
      MANIFEST_PATH,
      JSON.stringify({
        id: "test-project-fixture",
        version: "0.1.0",
        kind: "project",
        category: "Family",
        display: "Test project fixture",
        description: "A fixture project type for loader tests.",
        author: "test",
        license: "AGPL-3.0",
        args: { type: "object", required: ["topic"], properties: { topic: { type: ["string", "null"] } } },
        incognito: "unaffected",
        platforms: ["home"],
        min_role: "adult",
        consequential: false,
        offline: "full",
        min_app: "0.1.0",
        tier: 0,
      }),
    );
    writeFileSync(
      PLAN_PATH,
      JSON.stringify({
        steps: [{ id: "draft", kind: "text", needs: [], params: { role: "chat", promptTemplate: "Write about {topic}.", inputs: [] } }],
        ceilings: { maxWallSeconds: 60, maxGeneratorJobs: 1 },
      }),
    );

    registerAllPackageProjectTypes();
    expect(getProjectType("test-project-fixture")).toBeDefined();
  });

  // A re-review's own finding: without filtering by kind before calling
  // loadProjectPackage(), an ordinary package's own manifest failure
  // (nothing to do with plan.json) got a second, misleading "project
  // plan failed to load" warning on top of loadManifestOnly()'s own
  // correct one - registerAllPackageProjectTypes()'s own doc comment's
  // "skipped without a warning" promise, broken for exactly the wrong
  // packages (every ordinary one with a broken manifest, not project
  // packages at all).
  test("a broken, non-project manifest gets loadManifestOnly()'s own one warning, never a second 'project plan failed' one", () => {
    db.insert(packageInstalls)
      .values({ packageId: "test-project-fixture", version: "1.0.0", previousVersion: null, channel: "stable", sourceCommit: "test", permissions: "[]", installedAt: "2026-01-01T00:00:00.000Z" })
      .run();
    mkdirSync(TEST_PKG_DIR, { recursive: true });
    writeFileSync(MANIFEST_PATH, JSON.stringify({ id: "test-project-fixture", not_a_real_field: true }));

    const warnSpy = spyOn(console, "warn");
    try {
      registerAllPackageProjectTypes();
      expect(getProjectType("test-project-fixture")).toBeUndefined();
      expect(warnSpy.mock.calls.length).toBe(1);
      expect(String(warnSpy.mock.calls[0]?.[0])).toContain("manifest failed validation");
      expect(String(warnSpy.mock.calls[0]?.[0])).not.toContain("project plan failed to load");
    } finally {
      warnSpy.mockRestore();
    }
  });
});
