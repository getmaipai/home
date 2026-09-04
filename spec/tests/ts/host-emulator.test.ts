import { describe, expect, test } from "bun:test";
import { HostEmulator, HostError } from "../../emulators/ts/host-emulator.js";

describe("HostEmulator", () => {
  test("fetch returns a seeded response", () => {
    const host = new HostEmulator();
    host.setFetchResponse("https://example.com/weather", { tempF: 72 });
    expect(host.fetch("https://example.com/weather")).toEqual({ tempF: 72 });
  });

  test("fetch throws not_found for an unseeded url", () => {
    const host = new HostEmulator();
    expect(() => host.fetch("https://example.com/nope")).toThrow(HostError);
  });

  test("memory.remember then memory.recall finds it by substring", () => {
    const host = new HostEmulator();
    host.memory.remember("Riff prefers oat milk", "preference", "person", "person-a1b2c3");
    const found = host.memory.recall("oat milk");
    expect(found.length).toBe(1);
    expect(found[0].text).toContain("oat milk");
  });

  test("data.forget removes only that person's records", () => {
    const host = new HostEmulator();
    host.memory.remember("about riff", "fact", "person", "person-riff");
    host.memory.remember("about sprout", "fact", "person", "person-sprout");
    const removed = host.data.forget("person-riff");
    expect(removed).toBe(1);
    expect(host.memoryStore.length).toBe(1);
    expect(host.memoryStore[0].person).toBe("person-sprout");
  });

  test("a secret fed through log() never appears verbatim (docs/ENGINEERING.md > Logging)", () => {
    const host = new HostEmulator();
    const secretToken = "sk-super-secret-token-value";
    host.registerSecret(secretToken);
    host.log("info", `authenticated with ${secretToken}`, { token: secretToken });
    for (const entry of host.logs) {
      expect(entry.message).not.toContain(secretToken);
      expect(JSON.stringify(entry.fields)).not.toContain(secretToken);
    }
    expect(host.logs[0].message).toContain("[redacted]");
  });

  test("schedule records a job and returns an id", () => {
    const host = new HostEmulator();
    const id = host.schedule("2026-09-04T21:00:00Z", "bedtime-reminder");
    expect(host.scheduledJobs.length).toBe(1);
    expect(id).toMatch(/^job-emu\d+$/);
  });
});
