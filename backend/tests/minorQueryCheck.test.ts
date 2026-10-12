// MINOR-SEARCH-01f: a child's or teen's query with a closed personal detail never reaches the web.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { people } from "@/db/schema";
import { createHost } from "@/lib/packageHost";
import { createEntity } from "@/lib/entities";
import { setHouseholdSettingValue } from "@/lib/settings";
import { closedFormatHit, minorQueryHit } from "@/lib/retrieval/minorQueryCheck";
import type { PackageManifest } from "@maipai/spec/gen/ts/manifest.js";

let server: ReturnType<typeof Bun.serve> | null = null;
let hits = 0;
beforeEach(() => {
  resetDb();
  hits = 0;
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => { hits += 1; return Response.json({ results: [{ title: "Water", url: "https://example.com/w", content: "Water boils at 100 C." }] }); } });
});
afterEach(() => { server?.stop(true); });

async function owner() {
  await new TestClient().post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  return db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
}
const manifest = { id: "t", name: "t", version: "1.0.0", permissions: ["integration:searxng"] } as unknown as PackageManifest;

describe("closed formats", () => {
  test("emails, phone numbers and id numbers are caught", () => {
    expect(closedFormatHit("write to sam@example.com please")).toBe("email");
    expect(closedFormatHit("call 206-555-0142 now")).toBe("phone");
    expect(closedFormatHit("(206) 555 0142")).toBe("phone");
    expect(closedFormatHit("my id is 123-45-6789")).toBe("id_number");
    expect(closedFormatHit("account 4111111111111111")).toBe("id_number");
    expect(closedFormatHit("card 4111 1111 1111 1111")).toBe("id_number");
    expect(closedFormatHit("call 555-0142")).toBe("phone");
  });
  test("ordinary numbers and years are not", () => {
    expect(closedFormatHit("world war 1914 1918 2024 timeline")).toBeNull();
    expect(closedFormatHit("why is the sky blue")).toBeNull();
    expect(closedFormatHit("area code 206 history")).toBeNull();
    expect(closedFormatHit("how far is the sun 93000000 miles")).toBeNull();
  });
});

describe("minor search path", () => {
  test("a child's query with a household name is refused with the fix and never reaches SearXNG", async () => {
    const actor = await owner();
    setHouseholdSettingValue("search.searxng_url", `http://127.0.0.1:${server!.port}`);
    const child = { ...actor, role: "child" as const };
    const host = createHost(child, manifest);
    const res = (await host.integration.call("searxng", "search", { query: "where does Sage live" })) as { text: string; rows: unknown[] };
    expect(res.text).toBe("That search has a real name, address, phone number, email or ID number in it, so I didn't send it to the web. Ask again without those details, or ask a grown-up to help.");
    expect(res.rows).toEqual([]);
    expect(hits).toBe(0);
  });

  test("a phone number is refused for a child and a teen, and an adult's is not checked", async () => {
    const actor = await owner();
    setHouseholdSettingValue("search.searxng_url", `http://127.0.0.1:${server!.port}`);
    for (const role of ["child", "teen"] as const) {
      const res = (await createHost({ ...actor, role }, manifest).integration.call("searxng", "search", { query: "who owns 206-555-0142" })) as { text: string };
      expect(res.text).toContain("Ask again without those details");
    }
    expect(hits).toBe(0);
    expect(minorQueryHit("who owns 206-555-0142", "adult")).toBeNull();
  });

  test("a teen's query naming a household member is refused; a page read with an email in its address is too", async () => {
    const actor = await owner();
    setHouseholdSettingValue("search.searxng_url", `http://127.0.0.1:${server!.port}`);
    const host = createHost({ ...actor, role: "teen" as const }, manifest);
    const res = (await host.integration.call("searxng", "search", { query: "sage address" })) as { text: string };
    expect(res.text).toContain("Ask again without those details");
    let code = "";
    try { await host.integration.call("searxng", "page.read", { url: "https://example.com/?e=sam@example.com" }); } catch (e) { code = (e as { code: string }).code; }
    expect(code).toBe("invalid_input");
    expect(hits).toBe(0);
  });

  test("a harmless child query passes the check", async () => {
    const actor = await owner();
    expect(minorQueryHit("how hot is the sun", "child")).toBeNull();
    expect(actor.displayName).toBe("Sage");
  });

  test("the stored household address is refused, a bare place name is not", async () => {
    const actor = await owner();
    const home = createEntity(actor, { kind: "place", place_kind: "map", name: "12 Maple Street", scope: "household", geo: { lat: 47.6, lon: -122.3, precision: "area", area: "Seattle", from: "typed" } });
    expect(home.ok).toBe(true);
    expect(setHouseholdSettingValue("household.home", (home as { value: { id: string } }).value.id).ok).toBe(true);
    expect(minorQueryHit("pizza near 12 maple street", "child")).toBe("address");
    expect(minorQueryHit("what is maple syrup", "child")).toBeNull();
  });
});
