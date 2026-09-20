import { describe, expect, test, beforeEach } from "bun:test";
import { resetDb } from "./reset-db";
import { getHubInstanceId, getHubName, setHubName, __resetHubIdentityForTests } from "@/lib/hubIdentity";

beforeEach(() => {
  resetDb();
  __resetHubIdentityForTests();
});

describe("getHubInstanceId()", () => {
  test("mints one on first read and returns the same one on every later call", () => {
    const first = getHubInstanceId();
    expect(first.length).toBeGreaterThan(0);
    expect(getHubInstanceId()).toBe(first);
  });

  test("survives a fresh in-process cache (a restart) by reading what was already stored", () => {
    const first = getHubInstanceId();
    __resetHubIdentityForTests(); // simulates a process restart's cold cache
    expect(getHubInstanceId()).toBe(first);
  });
});

describe("getHubName()/setHubName()", () => {
  test("defaults to something non-empty before any name is set", () => {
    expect(getHubName().length).toBeGreaterThan(0);
  });

  test("setHubName() changes what getHubName() returns", () => {
    setHubName("Basement Hub");
    expect(getHubName()).toBe("Basement Hub");
  });

  test("trims and caps the name at 60 characters", () => {
    setHubName(`  ${"a".repeat(100)}  `);
    expect(getHubName()).toBe("a".repeat(60));
  });

  test("setting the name never changes the instance id", () => {
    const id = getHubInstanceId();
    setHubName("Something Else");
    expect(getHubInstanceId()).toBe(id);
  });

  // scripts/screenshot.ts's own throwaway backend sets this so a
  // machine's real hostname never becomes the seeded name behind a
  // committed capture (owner finding, "The phone composition,"
  // 2026-09-20).
  test("MAIPAI_DEMO_HUB_NAME overrides the machine hostname as the default, first-boot name", () => {
    const original = process.env.MAIPAI_DEMO_HUB_NAME;
    process.env.MAIPAI_DEMO_HUB_NAME = "Bramble hub";
    try {
      __resetHubIdentityForTests();
      resetDb();
      expect(getHubName()).toBe("Bramble hub");
    } finally {
      if (original === undefined) delete process.env.MAIPAI_DEMO_HUB_NAME;
      else process.env.MAIPAI_DEMO_HUB_NAME = original;
    }
  });
});
