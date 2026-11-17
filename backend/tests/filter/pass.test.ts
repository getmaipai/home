import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db, sqlite } from "@/db";
import { people, settingsValues } from "@/db/schema";
import { resetDb } from "../reset-db";
import { passFor, passForSurface, invalidatePass } from "@/lib/filter/pass";
import { ceilingOf } from "@/lib/filter/ceiling";
import { buildDoor } from "@/lib/filter/door";
import { setValue, resetValue } from "@/lib/settings";
import { createGrant } from "@/lib/grants";
import { listApps } from "@/lib/apps";
import { getRegistry } from "@/lib/settingsRegistry";
import { ACCESS_SETTINGS_KEYS } from "@/settings/accessKeys";
import type { PersonRow } from "@/types";

const now = new Date().toISOString();
function person(id: string, role: string, controls?: string): PersonRow {
  db.insert(people).values({ id, displayName: id, role, avatarSeed: id, source: "hub", createdAt: now, updatedAt: now, hlc: "1700000000000:0:testfix", ...(controls ? { controls } : {}) } as never).run();
  return db.select().from(people).where(eq(people.id, id)).get()! as PersonRow;
}
let owner: PersonRow, admin: PersonRow, adult: PersonRow, teen: PersonRow, teen2: PersonRow, child: PersonRow, guest: PersonRow;
beforeEach(() => {
  resetDb();
  owner = person("person-owneraaa", "owner"); admin = person("person-adminaaa", "admin"); adult = person("person-adultaaa", "adult");
  teen = person("person-teenaaa", "teen"); teen2 = person("person-teentwo", "teen"); child = person("person-childaaa", "child"); guest = person("person-guestaaa", "guest", "teen");
});
const ok = (r: { ok: boolean }) => expect(r.ok).toBe(true);
const refused = (r: { ok: boolean; error?: string }) => { expect(r.ok).toBe(false); expect(r.error).toBe("Only an owner or admin can change this."); };
const rows = (scope: string, key: string) => db.select().from(settingsValues).where(eq(settingsValues.key, key)).all().filter((row) => row.scope === scope);

describe("defaults equal today", () => {
  test("child, teen, adult, guest, unknown surface", () => {
    const c = passFor(child.id);
    expect(Object.values(c.ceiling)).toEqual([0, 0, 0, 0, 0]);
    expect(c.unrated.size).toBe(0);
    expect(c.access.has("thinking")).toBe(false);
    expect([...c.access].filter((a) => a.startsWith("tier."))).toEqual([]);
    const t = passFor(teen.id);
    expect(Object.values(t.ceiling)).toEqual([2, 2, 2, 2, 2]);
    expect(["chat", "image", "video", "music", "voice"].every((w) => t.access.has(`tier.boost:${w}`))).toBe(true);
    expect([...t.access].some((a) => a.startsWith("tier.max"))).toBe(false);
    expect(t.access.has("thinking")).toBe(false);
    const a = passFor(adult.id);
    expect(Object.values(a.ceiling)).toEqual([4, 4, 4, 4, 4]);
    expect(a.unrated.size).toBe(5);
    expect(a.access.has("thinking")).toBe(true);
    expect(a.access.has("tier.max:*")).toBe(false);
    expect(passFor(admin.id).access.has("tier.max:*")).toBe(true);
    expect(passFor(guest.id).ceiling.chat).toBe(2);
    expect(Object.values(passForSurface({ actor: null, band: "adult" }).ceiling)).toEqual([0, 0, 0, 0, 0]);
  });
  test("an unknown speaker on a shared surface gets the child result", () => {
    expect(passForSurface({ actor: adult, band: "child" }).ceiling.chat).toBe(0);
    expect(passForSurface({ actor: adult, band: "child" }).unrated.size).toBe(0);
  });
});

describe("overrides and precedence", () => {
  test("a per-kind override and household vs person precedence", () => {
    ok(setValue(admin, `person:${teen.id}`, "content.ceiling.news", "R"));
    expect(passFor(teen.id).ceiling.news).toBe(3);
    expect(passFor(teen.id).ceiling.chat).toBe(2);
    ok(setValue(admin, "household", "content.ceiling", "PG"));
    ok(setValue(admin, `person:${teen.id}`, "content.ceiling", "R"));
    expect(passFor(teen.id).ceiling.chat).toBe(3);
    expect(passFor(teen2.id).ceiling.chat).toBe(1);
  });
  test("unrated override releases a rater's Unrated, not a withhold, not a missing stamp", async () => {
    ok(setValue(admin, `person:${teen.id}`, "content.unrated.news", "yes"));
    const audience = { actor: teen, band: "teen" as const };
    const unrated = { level: "Unrated" as const, source: "worked_out" as const, rater: "test-rater", rater_version: 1, rated_at: now };
    const door = buildDoor({ raters: [] });
    expect((await door.filterList({ surface: "news", audience, rows: ["a"], rate: () => unrated as never })).length).toBe(1);
    expect((await door.filterList({ surface: "news", audience, rows: ["a"], rate: () => null })).length).toBe(0);
    expect((await door.filterList({ surface: "library", audience, rows: ["a"], rate: () => unrated as never })).length).toBe(0);
    const withholding = buildDoor({ raters: [{ id: "w", version: 1, rates: ["article"], priority: 1, source: "worked_out", reaches_internet: false, rate: () => ({ level: "Unrated", withhold: true }) } as never] });
    expect((await withholding.release({ surface: "news", audience, item: { kind: "explicit", explicit: false } })).verdict).toBe("held");
    const quiet = buildDoor({ raters: [{ id: "q", version: 1, rates: ["article"], priority: 1, source: "worked_out", reaches_internet: false, rate: () => ({ level: "Unrated" }) } as never] });
    expect((await quiet.release({ surface: "news", audience, item: { kind: "explicit", explicit: false } })).verdict).toBe("released");
  });
});

describe("self rules", () => {
  test("a teen lowers and restores their own level; the lower wins", () => {
    ok(setValue(teen, `person:${teen.id}`, "content.own_ceiling", "G"));
    expect(passFor(teen.id).ceiling.chat).toBe(0);
    ok(setValue(teen, `person:${teen.id}`, "content.own_ceiling", "R"));
    expect(passFor(teen.id).ceiling.chat).toBe(2);
    ok(setValue(teen, `person:${teen.id}`, "content.own_ceiling", "default"));
    expect(passFor(teen.id).ceiling.chat).toBe(2);
  });
  test("own lowering never touches an admin's row", () => {
    ok(setValue(admin, `person:${teen.id}`, "content.ceiling.news", "R"));
    const before = rows(`person:${teen.id}`, "content.ceiling.news");
    ok(setValue(teen, `person:${teen.id}`, "content.own_ceiling.news", "PG"));
    expect(passFor(teen.id).ceiling.news).toBe(1);
    ok(setValue(teen, `person:${teen.id}`, "content.own_ceiling.news", "default"));
    expect(passFor(teen.id).ceiling.news).toBe(3);
    expect(rows(`person:${teen.id}`, "content.ceiling.news")).toEqual(before);
  });
  test("override keys: refused for a teen, a parent and a guest; allowed for an admin", () => {
    for (const key of ["content.ceiling", "content.unrated", "access.thinking"]) {
      const value = key === "content.ceiling" ? "R" : true;
      refused(setValue(teen, `person:${teen.id}`, key, value));
      refused(setValue(adult, `person:${child.id}`, key, value));
      refused(setValue(guest, `person:${guest.id}`, key, value));
      refused(resetValue(teen, `person:${teen.id}`, key));
      ok(setValue(admin, `person:${child.id}`, key, value));
    }
    ok(setValue(admin, "household", "content.ceiling", "R"));
  });
  test("a person cannot erase an admin's override", () => {
    ok(setValue(admin, `person:${teen.id}`, "content.ceiling", "R"));
    refused(resetValue(teen, `person:${teen.id}`, "content.ceiling"));
    expect(passFor(teen.id).ceiling.chat).toBe(3);
  });
  test("a guest lowers their own level and sets own_unrated", () => {
    ok(setValue(guest, `person:${guest.id}`, "content.own_ceiling", "G"));
    ok(setValue(guest, `person:${guest.id}`, "content.own_unrated", "no"));
    expect(passFor(guest.id).ceiling.chat).toBe(0);
    expect(setValue(teen, `person:${guest.id}`, "content.own_ceiling", "G").ok).toBe(false);
    ok(setValue(admin, `person:${teen.id}`, "content.own_ceiling", "G"));
  });
  test("an access list key is admin-only and follows the role default", () => {
    refused(setValue(teen, `person:${teen.id}`, "access.tier.max", ["image"]));
    ok(setValue(admin, `person:${teen.id}`, "access.tier.max", ["image", "video"]));
    expect(passFor(teen.id).access.has("tier.max:image")).toBe(true);
    expect(passFor(teen.id).access.has("tier.max:video")).toBe(false); // rule 8: a teen's Max is pictures only
    ok(setValue(admin, `person:${child.id}`, "access.tier.max", ["image"]));
    expect(passFor(child.id).access.has("tier.max:image")).toBe(false); // rule 0
  });
});

describe("Prohibited and crisis are unreachable", () => {
  test("no option is Prohibited; a stored Prohibited reads as X", () => {
    for (const def of ACCESS_SETTINGS_KEYS) expect(((def.range as { options?: string[] } | undefined)?.options ?? []).includes("Prohibited")).toBe(false);
    for (const def of getRegistry().filter((k) => k.key.startsWith("content.ceiling"))) expect(JSON.stringify(def.range)).not.toContain("Prohibited");
    db.insert(settingsValues).values({ scope: `person:${teen.id}`, key: "content.ceiling", value: JSON.stringify("Prohibited"), hlc: "1700000000000:1:testfix", source: "user", updatedAt: now, setBy: null } as never).run();
    invalidatePass();
    expect(passFor(teen.id).ceiling.chat).toBe(4);
  });
  test("safety.ts does not read the pass", () => {
    expect(readFileSync(new URL("../../src/lib/safety.ts", import.meta.url), "utf-8")).not.toMatch(/filter\/pass/);
  });
});

describe("no reads on the hot path", () => {
  test("10,000 reads issue no statements and take under 10 ms", () => {
    passFor(teen.id);
    const audience = { actor: teen, band: "teen" as const };
    passForSurface(audience);
    const counts = { n: 0 };
    const s = sqlite as unknown as Record<string, (...a: unknown[]) => unknown>;
    const originals = { prepare: s.prepare, query: s.query, run: s.run, exec: s.exec };
    for (const name of Object.keys(originals) as Array<keyof typeof originals>) {
      if (typeof originals[name] === "function") s[name] = function (this: unknown, ...a: unknown[]) { counts.n++; return originals[name]!.apply(sqlite, a); };
    }
    let total = 0;
    const start = performance.now();
    try {
      for (let i = 0; i < 10_000; i++) { total += passForSurface(audience).ceiling.chat; total += ceilingOf(audience, "reply"); }
    } finally { Object.assign(s, originals); }
    const ms = performance.now() - start;
    console.log(`pass hot path: 20,000 reads (10,000 passForSurface + 10,000 ceilingOf) in ${ms.toFixed(2)} ms, statements: ${counts.n}`);
    expect(total).toBe(40_000);
    expect(counts.n).toBe(0);
    expect(ms).toBeLessThan(10);
  });
});

describe("rebuild on write", () => {
  test("setValue, grants and role change rebuild the pass", () => {
    const v1 = passFor(teen.id).version;
    ok(setValue(admin, `person:${teen.id}`, "content.ceiling", "R"));
    const v2 = passFor(teen.id);
    expect(v2.version).toBeGreaterThan(v1);
    expect(v2.ceiling.chat).toBe(3);
    const apps = (p: PersonRow) => listApps(p).map((a) => a.package);
    const before = apps(adult);
    expect(before.length).toBeGreaterThan(0);
    const target = before[0]!;
    expect(passFor(adult.id).access.has(`use:${target}`)).toBe(true);
    const granted = createGrant({ id: admin.id, role: "admin" } as never, { person: adult.id, action: `use:${target}`, effect: "deny" } as never);
    expect(granted).toMatchObject({ ok: true });
    expect(passFor(adult.id).access.has(`use:${target}`)).toBe(false);
    expect(apps(adult)).not.toContain(target);
    db.update(people).set({ role: "child" }).where(eq(people.id, teen.id)).run();
    invalidatePass(teen.id);
    expect(passFor(teen.id).band).toBe("child");
  });
  test("the app list: a child holds nothing outside the pass; an adult's list is every visible app", () => {
    for (const app of listApps(child)) expect(passFor(child.id).access.has(`use:${app.package}`)).toBe(true);
    expect(listApps(adult).length).toBeGreaterThan(0);
  });
});
