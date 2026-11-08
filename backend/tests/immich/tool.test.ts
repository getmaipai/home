import { describe, expect, test } from "bun:test";
import { immichAllowed, immichToolSpec, runImmichTool } from "@/lib/immich/tool";
import { immichInstance, fixtureImmichFetch } from "./helpers";
const actor = { id: "owner", role: "owner" as const };
const base = { actor, band: "adult", callId: "call" };
const depsFor = (fixture = fixtureImmichFetch(), instances = [immichInstance()]) => ({ instances: () => instances, fetch: fixture.fetch, readSetting: (key: string) => key === "immich.bad.api_key" ? "wrong-key" : key.startsWith("immich.") ? "test-key" : undefined, audit: (_row: unknown) => {} });

describe("Immich tool", () => {
  test.each(["search", "albums", "album", "stats", "people"] as const)("reads %s through SDK", async (action) => {
    const fixture = fixtureImmichFetch();
    const result = await runImmichTool({ ...base, args: { action, ...(action === "search" ? { query: "mountain" } : {}), ...(action === "album" ? { album: "Family" } : {}) }, deps: depsFor(fixture) });
    expect(result.status).toBe("succeeded"); expect(fixture.requests.length).toBeGreaterThan(0);
    expect(fixture.requests.every((request) => request.host === "192.168.1.20:2283")).toBe(true);
  });
  test("refuses redirects, another host and wrong credentials", async () => {
    for (const [fixture, instance] of [[fixtureImmichFetch({ status: 302, headers: { location: "http://192.168.1.99/" } }), immichInstance("redirect", "http://192.168.1.20:2283")], [fixtureImmichFetch({ wrongHost: true }), immichInstance("host", "http://192.168.1.21:2283")], [fixtureImmichFetch({ wrongKey: true }), { ...immichInstance("key", "http://192.168.1.20:2283"), credentialRef: "immich.bad.api_key" }]] as const) {
      const result = await runImmichTool({ ...base, args: { action: "albums" }, deps: depsFor(fixture, [instance]) }); expect(result.status).not.toBe("succeeded");
    }
  });
  test("maps failure to kind only and rejects URL arguments", async () => {
    const failed = await runImmichTool({ ...base, args: { action: "albums" }, deps: { ...depsFor(), fetch: async () => { throw new Error("secret host token"); } } });
    expect(failed.userMessage).toMatch(/unreachable|refused|timed out/); expect(failed.userMessage).not.toContain("secret");
    expect((immichToolSpec([immichInstance()]).args as { additionalProperties: boolean }).additionalProperties).toBe(false);
    const invalid = await runImmichTool({ ...base, args: { action: "albums", url: "http://example.com" }, deps: depsFor() }); expect(invalid.failureKind).toBe("bad_arguments");
  });
  test("offers only to adults in written chat and requires an instance for ambiguous album names", async () => {
    const instances = [immichInstance("main"), immichInstance("archive", "http://192.168.1.21:2283")];
    expect(immichAllowed({ actor, band: "adult", surfaceClass: "written", spoken: false, bare: false }, { instances: () => instances })).toBe(true);
    expect(immichAllowed({ actor: { role: "teen" }, band: "teen", surfaceClass: "written", spoken: false, bare: false }, { instances: () => instances })).toBe(false);
    expect(immichAllowed({ actor, band: "adult", surfaceClass: "written", surface: "robot", spoken: false, bare: false }, { instances: () => instances })).toBe(false);
    const result = await runImmichTool({ ...base, args: { action: "album", album: "Family" }, deps: { ...depsFor(undefined, instances), fetch: fixtureImmichFetch().fetch } }); expect(result.failureKind).toBe("found_nothing"); expect(result.userMessage).toContain("Choose an instance");
  });
  test("audit excludes names and uses no mutating method", async () => {
    const fixture = fixtureImmichFetch(); let audit: unknown;
    await runImmichTool({ ...base, args: { action: "search", query: "private query" }, deps: { ...depsFor(fixture), audit: (row) => { audit = row; } } });
    expect(JSON.stringify(audit)).not.toMatch(/private query|Family|Secret Photo|Jesse|main/);
    expect(fixture.requests.every((request) => request.method === "GET" || (request.method === "POST" && request.path.includes("search")))).toBe(true);
  });
});
