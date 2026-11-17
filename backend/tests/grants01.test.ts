// GRANTS-01 (RULES.md C5, C7, C10): one feature access check (`mayUse`) where a feature starts. A refusal looks like absence.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { grants, packageInstalls, people } from "@/db/schema";
import { PACKAGES_DIR, installedPackageVersionDir } from "@/lib/paths";
import { resetDb } from "./reset-db";
import { __resetAppCachesForTests, listApps } from "@/lib/apps";
import { __resetPackageCachesForTests, listInstalledManifests, meetsMinRole, runPlugin } from "@/lib/plugins";
import { mayUse, passFor, invalidatePass } from "@/lib/filter/pass";
import { createGrant, listGrants, revokeGrant } from "@/lib/grants";
import { listWidgets, getWidgetData } from "@/lib/widgets";
import { installedWritingFormats, writingFormatsFor } from "@/lib/writingFormats";
import { policyNode } from "@/lib/turnMachine/nodes/policy";
import { commandsNode } from "@/lib/turnMachine/nodes/commands";
import { owner as ownerSession } from "./support/testAuth";
import { NOT_AVAILABLE_LINE } from "@/lib/turnMachine/nodes/answer";
import type { TurnState } from "@/lib/turnMachine/contract";
import { TestClient } from "./client";
import type { PersonRow } from "@/types";

const now = new Date().toISOString();
function person(id: string, role: string, controls?: string): PersonRow {
  db.insert(people).values({ id, displayName: id, role, avatarSeed: id, source: "hub", createdAt: now, updatedAt: now, hlc: "1700000000000:0:testfix", ...(controls ? { controls } : {}) } as never).run();
  return db.select().from(people).where(eq(people.id, id)).get()! as PersonRow;
}
let owner: PersonRow, adult: PersonRow, teen: PersonRow, child: PersonRow;
beforeEach(() => {
  resetDb();
  owner = person("person-owneraaa", "owner"); adult = person("person-adultaaa", "adult"); teen = person("person-teenaaa", "teen"); child = person("person-childaaa", "child");
});
afterEach(() => { rmSync(installedPackageVersionDir("remind", "9.9.9"), { recursive: true, force: true }); db.delete(packageInstalls).where(eq(packageInstalls.packageId, "remind")).run(); __resetPackageCachesForTests(); __resetAppCachesForTests(); });

const ownerActor = () => ({ id: owner.id, role: "owner" as const });
const deny = (p: PersonRow, pkg: string) => { const r = createGrant(ownerActor(), { person: p.id, action: `use:${pkg}`, effect: "deny" }); expect(r.ok).toBe(true); return (r as { ok: true; value: { id: string } }).value.id; };

/** The bundled remind package installed over itself with a different floor (an admin-only package for the C7 tests). */
function installRemindWithFloor(minRole: string) {
  const dir = installedPackageVersionDir("remind", "9.9.9");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, ".."), { recursive: true });
  cpSync(join(PACKAGES_DIR, "remind"), dir, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf-8"));
  manifest.version = "9.9.9"; manifest.min_role = minRole;
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
  db.delete(packageInstalls).where(eq(packageInstalls.packageId, "remind")).run();
  db.insert(packageInstalls).values({ packageId: "remind", version: "9.9.9", previousVersion: null, channel: "stable", sourceCommit: "test", permissions: "[]", installedAt: "2026-10-17T00:00:00.000Z" }).run();
  __resetPackageCachesForTests(); __resetAppCachesForTests();
  invalidatePass(adult.id); invalidatePass(teen.id); invalidatePass(child.id);
}

describe("with no grants every role sees today's packages", () => {
  test("the pass, the app list, the widgets and the writing formats match the role ladder", () => {
    for (const p of [owner, adult, teen, child]) {
      const expected = listInstalledManifests().filter((m) => meetsMinRole(p.role, m.min_role)).map((m) => m.id).sort();
      expect([...passFor(p.id).access].filter((a) => a.startsWith("use:") && a !== "use:code").map((a) => a.slice(4)).sort()).toEqual(expected); // `use:code` is Coding, not a package (ACCESS-UI-01)
      for (const m of listInstalledManifests()) expect(mayUse(p, m.id)).toBe(meetsMinRole(p.role, m.min_role));
      expect(listWidgets(p).map((w) => w.package).every((id) => expected.includes(id))).toBe(true);
      expect(writingFormatsFor(p).map((s) => s.manifest.id).sort()).toEqual(installedWritingFormats().filter((s) => meetsMinRole(p.role, s.manifest.min_role)).map((s) => s.manifest.id).sort());
      expect(listApps(p).map((a) => a.package).every((id) => expected.includes(id))).toBe(true);
    }
    expect(listApps(adult).map((a) => a.package)).toContain("weather");
  });
});

describe("a deny grant removes the feature everywhere, a revoke brings it back", () => {
  test("lists, run, commands and the policy node, in the same write", async () => {
    expect(mayUse(adult, "weather")).toBe(true);
    expect(listApps(adult).map((a) => a.package)).toContain("weather");
    expect(listWidgets(adult).map((w) => w.package)).toContain("weather");
    expect(writingFormatsFor(adult).map((s) => s.manifest.id)).toContain("format-email");

    const weatherDeny = deny(adult, "weather");
    const emailDeny = deny(adult, "format-email");
    const remindDeny = deny(adult, "remind");
    expect(mayUse(adult, "weather")).toBe(false);
    expect(listApps(adult).map((a) => a.package)).not.toContain("weather");
    expect(listWidgets(adult).map((w) => w.package)).not.toContain("weather");
    expect(writingFormatsFor(adult).map((s) => s.manifest.id)).not.toContain("format-email");
    expect(passFor(adult.id).access.has("use:weather")).toBe(false);

    // runPlugin and a widget run answer exactly as for a package that does not exist.
    expect(await runPlugin("weather", adult, {})).toEqual(await runPlugin("no-such-package-x", adult, {}).then((r) => ({ ...r, error: (r as { error: string }).error.replace("no-such-package-x", "weather") })));
    expect(await getWidgetData(adult, "weather", "current")).toMatchObject({ ok: false, status: 404 });

    // The policy node refuses the tool as not available (no age, role or rule word).
    const state = { actor: adult, surface: "chat", speakerEvidence: { kind: "person" }, context: [], crisis: false, temporary: false, utterance: "what is the weather" } as unknown as TurnState;
    const outcome = await policyNode(state, { calls: [{ id: "c1", tool: "weather", args: { place: "Springfield" } }] }, new AbortController().signal);
    expect(outcome.output.entries[0]?.decision).toMatchObject({ allow: false, reason: "not_available" });
    const fmt = await policyNode(state, { calls: [{ id: "c2", tool: "writing_format", args: { format: "format-email" } }] }, new AbortController().signal);
    expect(fmt.output.entries[0]?.decision.allow).toBe(false);

    for (const id of [weatherDeny, emailDeny, remindDeny]) expect(revokeGrant(id).ok).toBe(true);
    expect(mayUse(adult, "weather")).toBe(true);
    expect(listApps(adult).map((a) => a.package)).toContain("weather");
    expect(writingFormatsFor(adult).map((s) => s.manifest.id)).toContain("format-email");
  });

  test("the command loop skips a denied package silently", async () => {
    const state = { actor: adult, surface: "chat", speakerEvidence: { kind: "person" }, context: [], crisis: false, temporary: false, utterance: "what time is it" } as unknown as TurnState;
    const before = await commandsNode(state, { utterance: "what time is it" }, new AbortController().signal);
    expect(before.output.matched).toBe(true);
    deny(adult, "almanac-time");
    const after = await commandsNode(state, { utterance: "what time is it" }, new AbortController().signal);
    expect(after.output.matched).toBe(false);
  });

  test("the /api/plugins list and the skills list drop a denied package and bring it back on revoke", async () => {
    resetDb();
    const { client, row } = await ownerSession();
    const read = async () => ({
      plugins: ((await (await client.get("/api/plugins")).json()) as Array<{ id: string }>).map((r) => r.id),
      skills: ((await (await client.get("/api/plugins/skills")).json()) as Array<{ id: string }>).map((r) => r.id),
    });
    const before = await read();
    expect(before.plugins).toContain("weather");
    expect(before.skills).toContain("weather");
    const id = (createGrant({ id: row.id, role: "owner" }, { person: row.id, action: "use:weather", effect: "deny" }) as { ok: true; value: { id: string } }).value.id;
    const during = await read();
    expect(during.plugins).not.toContain("weather");
    expect(during.skills).not.toContain("weather");
    expect(during.plugins.length).toBe(before.plugins.length - 1);
    expect(revokeGrant(id).ok).toBe(true);
    expect(await read()).toEqual(before);
  });

  test("a deny is always accepted, for a child and a teen too", () => {
    expect(createGrant(ownerActor(), { person: child.id, action: "use:weather", effect: "deny" }).ok).toBe(true);
    expect(createGrant(ownerActor(), { person: teen.id, action: "use:weather", effect: "deny" }).ok).toBe(true);
    expect(mayUse(child, "weather")).toBe(false);
  });
});

describe("an allow grant (C7)", () => {
  test("lifts an admin-only package for an adult", () => {
    installRemindWithFloor("admin");
    expect(mayUse(adult, "remind")).toBe(false);
    const created = createGrant(ownerActor(), { person: adult.id, action: "use:remind", effect: "allow" });
    expect(created.ok).toBe(true);
    expect(mayUse(adult, "remind")).toBe(true);
    // a deny beats an allow
    deny(adult, "remind");
    expect(mayUse(adult, "remind")).toBe(false);
  });

  test("never lifts adult or teen for a child or a teen: refused at createGrant and ignored if inserted directly", () => {
    installRemindWithFloor("adult");
    for (const p of [child, teen]) {
      const r = createGrant(ownerActor(), { person: p.id, action: "use:remind", effect: "allow" });
      expect(r).toMatchObject({ ok: false, error: "That one isn't available for this profile." });
      db.insert(grants).values({ id: `grant-direct${p.role}`, person: p.id, action: "use:remind", effect: "allow", validFrom: null, validTo: null, grantedByPersonId: owner.id, reason: null, acknowledgedAt: null, acknowledgedByPersonId: null, createdAt: now, updatedAt: now, deletedAt: null, hlc: "1700000000000:1:testfix" } as never).run();
      invalidatePass(p.id);
      expect(listGrants(p.id).some((g) => g.action === "use:remind")).toBe(true);
      expect(mayUse(p, "remind")).toBe(false);
    }
    installRemindWithFloor("teen");
    expect(createGrant(ownerActor(), { person: child.id, action: "use:remind", effect: "allow" }).ok).toBe(false);
    invalidatePass(child.id);
    expect(mayUse(child, "remind")).toBe(false);
    expect(mayUse(teen, "remind")).toBe(true);
  });
});

describe("a refusal is absence (C10)", () => {
  test("the refused runPlugin has the shape of the unknown-package response", async () => {
    deny(adult, "math");
    const refused = await runPlugin("math", adult, {});
    const unknown = await runPlugin("not-a-package", adult, {});
    expect(refused.ok).toBe(false);
    expect(Object.keys(refused).sort()).toEqual(Object.keys(unknown).sort());
    expect((refused as { status: number }).status).toBe((unknown as { status: number }).status);
    expect((refused as { status: number }).status).toBe(404);
  });

  test("the answer copy has no age, role or rule word, and the two old lines are gone from src", () => {
    expect(NOT_AVAILABLE_LINE).not.toMatch(/grown-up|adult|role|age|rule|allowed|permission/i);
    const hits: string[] = [];
    const walk = (dir: string) => { for (const name of readdirSync(dir)) { const full = join(dir, name); if (statSync(full).isDirectory()) { walk(full); continue; } if (!/\.(ts|tsx)$/.test(name) || name === "grants01.test.ts") continue; const text = readFileSync(full, "utf-8"); if (text.includes("That one needs a grown-up") || text.includes("needs role ${manifest.min_role}")) hits.push(full); } };
    walk(join(import.meta.dir, "..", "src"));
    expect(hits).toEqual([]);
  });
});
