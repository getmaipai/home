import { describe, expect, test, beforeEach } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { setHouseholdSettingValue } from "@/lib/settings";
import { listPackageIds, loadPackage, registerAllPackageNotificationTypes, warmPackage } from "@/lib/plugins";

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
  test("400s with a clear message for a malformed expression, not a 500", async () => {
    const client = await owner();
    const res = await client.post("/api/plugins/math/run", { expression: "15 plus 12" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('"15 plus 12" failed to evaluate: Undefined symbol plus');
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
  // formatted-string binding -> llm_complete interpolating it into a
  // prompt -> pick -> format. Not real search or answer quality (that
  // needs a real SearXNG instance and a real model, see this package's
  // own quality_scale.yaml).
  test("runs the recipe end to end: integration.call through to llm_complete, stub chat backend", async () => {
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
      const body = (await res.json()) as { reply?: { text: string } };
      expect(body.reply?.text).toContain("[stub model: no real model loaded, this is a canned reply]");
      expect(body.reply?.text).toContain("Mount Everest");
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

describe("registerAllPackageNotificationTypes", () => {
  test("the boot-time pass over every bundled package's manifest never throws", () => {
    expect(() => registerAllPackageNotificationTypes()).not.toThrow();
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
