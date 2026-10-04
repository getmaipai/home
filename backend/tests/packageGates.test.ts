// R1 of the tools design (docs/plans/tools-ecosystem-design-2026-10-03.md
// section 5) and CAP-GATE-01: the manifest fields that were decorative
// (`incognito`, `offline`, `requires`, `optional`) are read by the host.
// Each fixture is a real installed package (installedPackageVersionDir +
// a packageInstalls row, the same shape plugins.test.ts's "broken-pkg"
// uses), run through the real runPlugin() and GET /api/plugins.
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { people, packageInstalls, statusEvents } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import { installedPackageVersionDir, PACKAGES_DIR } from "@/lib/paths";
import { resolveOrCreateConversation } from "@/lib/conversationHistory";
import { listInstalledManifests, loadManifestOnly, runPlugin, __resetPackageCachesForTests } from "@/lib/plugins";
import { __setStackClientForTests } from "@/lib/stackEngine";
import { startStackFixture, useDefaultScriptedStack, type StackFixture } from "./stackFixture";
import { list as listMemories } from "@/lib/memory";

const MANIFEST = {
  version: "1.0.0",
  kind: "plugin",
  category: "Utilities",
  display: "Gate fixture",
  description: "A fixture for the manifest gate tests.",
  author: "MaiPai",
  license: "AGPL-3.0",
  platforms: ["home"],
  min_role: "child",
  consequential: false,
  offline: "full",
  min_app: "0.1.0",
  tier: 0,
  incognito: "unaffected",
  args: { type: "object", properties: {} },
};
const FORMAT_STEP = { op: "format", as: "reply", text: "ran", speech: "ran" };
const REMEMBER_STEP = { op: "remember", text: "I like the gate fixture", category: "fact" };

const made: string[] = [];
function install(id: string, overrides: Record<string, unknown>): void {
  const dir = installedPackageVersionDir(id, "1.0.0");
  mkdirSync(dir, { recursive: true });
  const manifest = { ...MANIFEST, id, permissions: ["memory:write"], ...overrides };
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
  // The remember step is only in the recipe when the package declares the
  // permission it needs, so a refusal in a test is the gate's, not a bare
  // missing-permission failure.
  const steps = manifest.permissions.includes("memory:write") ? [REMEMBER_STEP, FORMAT_STEP] : [FORMAT_STEP];
  writeFileSync(join(dir, "recipe.json"), JSON.stringify({ id, inputs: [], steps }));
  db.insert(packageInstalls)
    .values({ packageId: id, version: "1.0.0", previousVersion: null, channel: "stable", sourceCommit: "test", permissions: "[]", installedAt: "2026-01-01T00:00:00.000Z" })
    .run();
  made.push(id);
}

async function owner() {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Juniper", secret: "correcthorse" });
  return { client, actor: db.select().from(people).where(eq(people.displayName, "Juniper")).get()! };
}

function conversation(actor: typeof people.$inferSelect, temporary: boolean): string {
  const result = resolveOrCreateConversation(actor, "chat", undefined, { temporary });
  if (!result.ok) throw new Error(result.error);
  return result.value.id;
}

function internetOutage(): void {
  db.insert(statusEvents)
    .values({ id: `sev-test-${Math.random().toString(36).slice(2)}`, component: "internet", state: "outage", at: new Date().toISOString(), source: "sample", detail: null, hlc: nextHlc() })
    .run();
}

let stack: StackFixture | null = null;
function stackWithRoles(states: Record<string, "notInstalled" | "ready">): void {
  const roles = Object.entries(states).map(([id, state]) => ({ id, label: id, wire: "job", residency: "installed", endpoints: [], quality: [], sharesModelWith: null, state: { state, since: "2026-01-01T00:00:00.000Z" }, reason: null, model: null, check: { state: "not checked", at: null, reason: null, stale: false } }));
  stack = startStackFixture({ "GET /stack/v1/roles": () => Response.json({ roles }) });
  __setStackClientForTests(stack.client);
}

beforeEach(() => {
  resetDb();
  useDefaultScriptedStack();
});
afterEach(() => {
  db.delete(statusEvents).run();
  for (const id of made.splice(0)) rmSync(installedPackageVersionDir(id, "1.0.0"), { recursive: true, force: true });
  __resetPackageCachesForTests();
  stack?.stop();
  stack = null;
});

describe("incognito: the manifest's own declaration is honoured in a temporary chat", () => {
  test("a package declared 'blocked' does not run in a temporary chat and runs in a saved one", async () => {
    const { actor } = await owner();
    install("gate-blocked", { incognito: "blocked", permissions: [] });
    const turn = (conversationId: string) => ({ id: "turn-gate-1", conversationId });
    const temp = await runPlugin("gate-blocked", actor, {}, turn(conversation(actor, true)));
    expect(temp.ok).toBe(false);
    if (!temp.ok) expect(temp.code).toBe("incognito_blocked");
    const saved = await runPlugin("gate-blocked", actor, {}, turn(conversation(actor, false)));
    expect(saved.ok).toBe(true);
  });

  test("a package declared 'ephemeral' runs in a temporary chat but writes nothing that persists, whatever its permission string says", async () => {
    const { actor } = await owner();
    install("gate-ephemeral", { incognito: "ephemeral" });
    const result = await runPlugin("gate-ephemeral", actor, {}, { id: "turn-gate-2", conversationId: conversation(actor, true) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("permission_denied");
    expect(listMemories(actor).length).toBe(0);
  });

  test("a package declared 'unaffected' is untouched by a temporary chat", async () => {
    const { actor } = await owner();
    install("gate-unaffected", { incognito: "unaffected" });
    const result = await runPlugin("gate-unaffected", actor, {}, { id: "turn-gate-3", conversationId: conversation(actor, true) });
    expect(result.ok).toBe(true);
  });
});

describe("offline: a package declared 'unavailable' is not run when the hub has no network", () => {
  test("it fails with the network_unreachable kind while the internet is down, and runs while it is up", async () => {
    const { actor } = await owner();
    install("gate-offline", { offline: "unavailable", permissions: [] });
    expect((await runPlugin("gate-offline", actor, {})).ok).toBe(true);
    internetOutage();
    const down = await runPlugin("gate-offline", actor, {});
    expect(down.ok).toBe(false);
    if (!down.ok) {
      expect(down.code).toBe("network_unreachable");
      // rule 6: the kind, never raw error text.
      expect(down.error).not.toMatch(/outage|status_events|sev-/);
    }
  });

  test("a package declared 'full' or 'degraded' still runs with the internet down", async () => {
    const { actor } = await owner();
    install("gate-offline-full", { offline: "full", permissions: [] });
    install("gate-offline-degraded", { offline: "degraded", permissions: [] });
    internetOutage();
    expect((await runPlugin("gate-offline-full", actor, {})).ok).toBe(true);
    expect((await runPlugin("gate-offline-degraded", actor, {})).ok).toBe(true);
  });
});

describe("requires and optional (CAP-GATE-01): the package follows the node's capability set", () => {
  test("a package requiring image is absent from the packages route while image is not installed, and present once it is", async () => {
    const { client } = await owner();
    install("gate-image", { requires: ["image"], permissions: [] });
    stackWithRoles({ image: "notInstalled" });
    const off = (await (await client.get("/api/plugins")).json()) as Array<{ id: string }>;
    expect(off.map((p) => p.id)).not.toContain("gate-image");
    stack?.stop();
    stackWithRoles({ image: "ready" });
    const on = (await (await client.get("/api/plugins")).json()) as Array<{ id: string }>;
    expect(on.map((p) => p.id)).toContain("gate-image");
  });

  test("a package requiring a capability that is off does not run, and says which one", async () => {
    const { actor } = await owner();
    install("gate-image-run", { requires: ["image"], permissions: [] });
    stackWithRoles({ image: "notInstalled" });
    const result = await runPlugin("gate-image-run", actor, {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("capability_off");
      expect(result.error).toContain("image");
    }
  });

  test("an optional capability that is off degrades the row and never hides or blocks it", async () => {
    const { client, actor } = await owner();
    install("gate-optional", { optional: ["image"], permissions: [] });
    stackWithRoles({ image: "notInstalled" });
    const rows = (await (await client.get("/api/plugins")).json()) as Array<{ id: string; degraded?: string[] }>;
    const row = rows.find((p) => p.id === "gate-optional");
    expect(row?.degraded).toEqual(["image"]);
    expect((await runPlugin("gate-optional", actor, {})).ok).toBe(true);
  });

  test("a capability the node cannot derive (no Stack answer) is never treated as off", async () => {
    const { client } = await owner();
    install("gate-unknown", { requires: ["image", "motors"], permissions: [] });
    const rows = (await (await client.get("/api/plugins")).json()) as Array<{ id: string }>;
    expect(rows.map((p) => p.id)).toContain("gate-unknown");
  });
});

describe("regression: the bundled manifests still load with the gates in place", () => {
  test("every bundled package loads through loadManifestOnly()", () => {
    const ids = readdirSync(PACKAGES_DIR, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
    expect(ids.length).toBe(35);
    for (const id of ids) {
      const loaded = loadManifestOnly(id);
      expect(loaded.ok).toBe(true);
      expect(JSON.parse(readFileSync(join(PACKAGES_DIR, id, "manifest.json"), "utf-8")).id).toBe(id);
    }
  });

  test("the packages route lists every installed bundled package for the owner, none marked degraded", async () => {
    const { client } = await owner();
    const rows = (await (await client.get("/api/plugins")).json()) as Array<{ id: string; degraded?: string[] }>;
    expect(rows.length).toBe(listInstalledManifests().length);
    expect(rows.filter((r) => r.degraded?.length).length).toBe(0);
  });
});

describe("R3: GET /api/plugins reports the install's real channel", () => {
  test("a store-installed package on the beta channel says beta, a bundled one stays stable", async () => {
    const { client } = await owner();
    install("gate-beta", { permissions: [] });
    db.update(packageInstalls).set({ channel: "beta" }).where(eq(packageInstalls.packageId, "gate-beta")).run();
    const rows = (await (await client.get("/api/plugins")).json()) as Array<{ id: string; channel: string }>;
    expect(rows.find((r) => r.id === "gate-beta")?.channel).toBe("beta");
    expect(rows.find((r) => r.id === "weather")?.channel).toBe("stable");
  });
});
