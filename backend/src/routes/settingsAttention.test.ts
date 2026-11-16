import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { OpenAPIHono } from "@hono/zod-openapi";
import { db } from "@/db";
import { devices, people, sessions, setupState } from "@/db/schema";
import { setValue } from "@/lib/settings";
import { raiseIssue } from "@/lib/issues";
import * as issueStore from "@/lib/issues";
import { createSetupState } from "@/lib/setupState";
import { __setInstallStatusForTests } from "@/lib/installStatus";
import { __setRoleHealthForTests } from "@/lib/roleHealth";
import * as backupStore from "@/lib/backup";
import { settingsRoutes } from "@/routes/settings";
import { resetDb } from "../../tests/reset-db";

const app = new OpenAPIHono();
app.route("/api/settings", settingsRoutes);
const now = new Date().toISOString();
function addPerson(id: string, role: string) {
  db.insert(people).values({ id, displayName: id, role, avatarSeed: id, source: "local", createdAt: now, updatedAt: now, hlc: "1:0:test" }).run();
  const token = `token-${id}`;
  db.insert(sessions).values({ id: `session-${id}`, personId: id, tokenHash: createHash("sha256").update(token).digest("hex").toString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), createdAt: now }).run();
  return { token, person: db.select().from(people).where(eq(people.id, id)).get()! };
}
async function attention(token: string) {
  const response = await app.request("http://localhost/api/settings/attention", { headers: { cookie: `session=${token}` } });
  expect(response.status).toBe(200);
  return await response.json() as { items: Array<{ id: string; kind: string; area: string; title: string; line: string; action: { label: string; href: string } }>; areas: Record<string, { state: string; summary: string }> };
}

beforeEach(() => resetDb());
afterEach(() => { resetDb(); __setInstallStatusForTests(null); __setRoleHealthForTests({}); });

describe("GET /api/settings/attention", () => {
  test("children get no items and no household areas", async () => {
    const { token } = addPerson("person-attnchild", "child");
    expect(await attention(token)).toEqual({ items: [], areas: {} });
  });

  test("teens and adults get only personal summaries", async () => {
    const teen = addPerson("person-attnteen", "teen");
    const teenResult = await attention(teen.token);
    expect(teenResult.areas.profile).toEqual({ state: "ok", summary: "Your settings" });
    expect(Object.keys(teenResult.areas).length).toBeGreaterThan(2);
    const adult = addPerson("person-attnadult", "adult");
    expect((await attention(adult.token)).items).toEqual([]);
  });

  test("owner and admin receive household summaries and plain word items", async () => {
    for (const role of ["owner", "admin"] as const) {
      const { token, person } = addPerson(`person-attn${role}`, role);
      setValue(person, "household", "search.source_mode.web", "mix");
      const result = await attention(token);
      expect(result.areas.search?.state).toBe("missing");
      expect(result.items.some((item) => item.id === "search-address" && item.title === "Web search has no address." && item.line.length > 0 && item.action.href.startsWith("/settings/"))).toBe(true);
    }
  });

  test("existing repairs, setup, install, health, backup and robot sources become attention items", async () => {
    const { token, person } = addPerson("person-attnsource", "owner");
    await raiseIssue({ source: "settings-attention-test", key: "offline", severity: "error", title: "Search service stopped", detail: "Restart the search service.", suppressNotification: true });
    const setup = createSetupState();
    db.insert(setupState).values({ slot: 1, value: JSON.stringify(setup) }).run();
    __setInstallStatusForTests({ state: "failed", chatReady: false, complete: false, percent: 0, completedBytes: 0, totalBytes: 0, bytesPerSecond: null, etaSeconds: null, items: [], problem: "The model download stopped.", stage: null, stageLabel: null, background: null });
    __setRoleHealthForTests({ chat: { availability: "unavailable", reason: "stack_unreachable" } });
    setValue(person, "household", "home.robots.enabled", true);
    db.insert(devices).values({ id: "robot-attnsource", kind: "robot", name: "Kitchen robot", personId: person.id, createdAt: now, updatedAt: now, hlc: "1:0:test" }).run();
    const result = await attention(token);
    expect(result.items.some((item) => item.title === "Search service stopped" && item.area === "advanced")).toBe(true);
    expect(result.items.some((item) => item.id === "backup-key")).toBe(true);
    expect(result.items.some((item) => item.id === "install" && item.line === "The model download stopped.")).toBe(true);
    expect(result.items.some((item) => item.id === "engine-health")).toBe(true);
    expect(result.items.some((item) => item.id === "backups-empty")).toBe(true);
    expect(result.items.some((item) => item.id === "robots-never-connected")).toBe(true);
  });

  test("disabled web search is an empty ok attention shape for that source", async () => {
    const { token, person } = addPerson("person-attnoff", "owner");
    setValue(person, "household", "search.source_mode.web", "offline");
    const result = await attention(token);
    expect(result.areas.search).toEqual({ state: "off", summary: "Web search off" });
    expect(result.items.some((item) => item.id === "search-address")).toBe(false);
  });

  test("a failing source is skipped while other household sources still answer", async () => {
    const { token, person } = addPerson("person-attnfailing", "owner");
    setValue(person, "household", "search.source_mode.web", "mix");
    const fail = spyOn(issueStore, "listIssues").mockImplementation(() => { throw new Error("source unavailable"); });
    try {
      const result = await attention(token);
      expect(result.items.some((item) => item.id === "search-address")).toBe(true);
      expect(result.areas.search?.state).toBe("missing");
    } finally { fail.mockRestore(); }
  });

  test("all healthy sources return the empty ok shape", async () => {
    const { token, person } = addPerson("person-attnok", "owner");
    setValue(person, "household", "search.source_mode.web", "offline");
    const setup = createSetupState();
    db.insert(setupState).values({ slot: 1, value: JSON.stringify({ ...setup, steps: setup.steps.map((step) => step.id === "backup_key" ? { ...step, status: "done" } : step) }) }).run();
    __setInstallStatusForTests({ state: "ready", chatReady: true, complete: true, percent: 100, completedBytes: 1, totalBytes: 1, bytesPerSecond: null, etaSeconds: null, items: [], problem: null, stage: null, stageLabel: null, background: null });
    __setRoleHealthForTests({ chat: { availability: "ready", reason: null } });
    const backups = spyOn(backupStore, "listBackups").mockReturnValue([{ filename: "snapshot.enc", createdAt: now, sizeBytes: 10 } as never]);
    try {
      const result = await attention(token);
      expect(result.items).toEqual([]);
      expect(Object.values(result.areas).every((area) => area.state === "ok" || area.state === "off")).toBe(true);
    } finally { backups.mockRestore(); }
  });
});
