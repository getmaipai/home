import { describe, expect, test, beforeEach } from "bun:test";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { listPackageIds, loadPackage } from "@/lib/skills";

beforeEach(() => {
  resetDb();
  __resetThrottleForTests();
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

// The first real skill built on host.fetch (2026-09-05). No automated
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

describe("GET /api/skills", () => {
  test("requires auth", async () => {
    const res = await new TestClient().get("/api/skills");
    expect(res.status).toBe(401);
  });

  test("lists the bundled remember package's manifest", async () => {
    const client = await owner();
    const res = await client.get("/api/skills");
    const body = (await res.json()) as Array<{ id: string }>;
    expect(body.some((m) => m.id === "remember")).toBe(true);
  });
});

describe("POST /api/skills/remember/run", () => {
  test("runs the recipe end to end: replies, and the fact lands in the real memory store", async () => {
    const client = await owner();
    const res = await client.post("/api/skills/remember/run", { fact: "the wifi password is on the fridge" });
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
    const res = await childClient.post("/api/skills/remember/run", { fact: "loses the second remote" });
    expect(res.status).toBe(200);
  });

  test("404s for an unknown package id", async () => {
    const client = await owner();
    const res = await client.post("/api/skills/does-not-exist/run", { fact: "x" });
    expect(res.status).toBe(404);
  });

  // A review (2026-09-04) found that a missing required input reached
  // the interpreter, left its `{fact}` placeholder un-interpolated, and
  // was written to the real memory store as literal text with a 200
  // back. This is the regression test for that fix.
  test("400s and writes nothing when a required input is missing", async () => {
    const client = await owner();
    const res = await client.post("/api/skills/remember/run", {});
    expect(res.status).toBe(400);

    const recall = await client.post("/api/memory/recall", { q: "fact" });
    const matches = (await recall.json()) as Array<{ record: { text: string } }>;
    expect(matches.some((m) => m.record.text.includes("{fact}"))).toBe(false);
  });
});

describe("POST /api/skills/recall/run", () => {
  test("runs the recipe end to end: finds and speaks back a real remembered fact", async () => {
    const client = await owner();
    const remembered = await client.post("/api/skills/remember/run", { fact: "the wifi password is on the fridge" });
    expect(remembered.status).toBe(200);

    const res = await client.post("/api/skills/recall/run", { topic: "wifi password" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { reply?: { text: string } };
    expect(body.reply?.text).toContain("wifi password");
  });

  test("a plain, honest reply when nothing matches - not an empty string or an error", async () => {
    const client = await owner();
    const res = await client.post("/api/skills/recall/run", { topic: "the moon landing" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { reply?: { text: string } };
    expect(body.reply?.text).toBe("I don't remember anything about that.");
  });

  test("a child, exactly at the min_role floor, can still run it", async () => {
    const ownerClient = await owner();
    const childClient = await child(ownerClient);
    const res = await childClient.post("/api/skills/recall/run", { topic: "anything" });
    expect(res.status).toBe(200);
  });

  test("400s for a missing required input", async () => {
    const client = await owner();
    const res = await client.post("/api/skills/recall/run", {});
    expect(res.status).toBe(400);
  });
});
