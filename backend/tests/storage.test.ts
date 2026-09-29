import { describe, expect, test, beforeEach } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { child } from "./support/testAuth";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { storageSummary, storageImpact, checkPersonQuota, checkDiskFull } from "@/lib/storage";
import { stageFactoryReset, pendingFactoryReset, applyPendingFactoryReset, cancelPendingFactoryReset, FACTORY_RESET_CONFIRMATION_PHRASE } from "@/lib/factoryReset";
import { generateDiagnostics } from "@/lib/diagnostics";
import { setValue, setHouseholdSettingValue } from "@/lib/settings";
import { listIssues } from "@/lib/issues";
import { db, sqlite } from "@/db";
import { dataDir, backupDir, visionDir } from "@/lib/paths";
import { readdirSync } from "node:fs";
import { createAttachment } from "@/lib/attachments";
import { resolveOrCreateConversation } from "@/lib/conversationHistory";
import { newConversationTurnId } from "@/lib/id";
import { nextHlc } from "@/lib/hlc";
import { conversationTurns } from "@/db/schema";
import type { PersonRow } from "@/types";

function toPersonRow(id: string): PersonRow {
  return sqlite.query("SELECT * FROM people WHERE id = ?").get(id) as unknown as PersonRow;
}

function resetBackupDir(): void {
  if (!existsSync(backupDir)) return;
  for (const f of readdirSync(backupDir)) rmSync(join(backupDir, f), { force: true });
}

beforeEach(() => {
  resetDb();
  __resetThrottleForTests();
  resetBackupDir();
  cancelPendingFactoryReset();
});

async function owner(): Promise<{ client: TestClient; id: string }> {
  const client = new TestClient();
  const res = await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const { person } = (await res.json()) as { person: { id: string } };
  return { client, id: person.id };
}

describe("storageSummary()", () => {
  test("reports areas, packages and disk usage without throwing on a fresh install", () => {
    const summary = storageSummary();
    expect(summary.areas.length).toBeGreaterThan(0);
    expect(summary.areas.some((area) => area.area === "vision_models")).toBe(true);
    expect(Array.isArray(summary.packages)).toBe(true);
    expect(summary.disk.totalBytes).toBeGreaterThan(0);
  });

  test("counts downloaded vision models in the vision_models area", () => {
    mkdirSync(visionDir, { recursive: true });
    writeFileSync(join(visionDir, "fixture.onnx"), "model-bytes");
    try {
      const area = storageSummary().areas.find((entry) => entry.area === "vision_models");
      expect(area?.bytes).toBe(Buffer.byteLength("model-bytes"));
    } finally {
      rmSync(visionDir, { recursive: true, force: true });
    }
  });
});

describe("GET /api/storage", () => {
  test("owner/admin can read it", async () => {
    const { client } = await owner();
    const res = await client.get("/api/storage");
    expect(res.status).toBe(200);
  });

  test("an adult without backups.run is refused", async () => {
    const { client } = await owner();
    const adultRes = await client.post("/api/people", { displayName: "Marlow", role: "adult", secret: "0000" });
    const adult = (await adultRes.json()) as { id: string };
    const adultClient = new TestClient();
    await adultClient.post("/api/auth/verify-secret", { personId: adult.id, secret: "0000" });
    expect((await adultClient.get("/api/storage")).status).toBe(403);
  });
});

describe("storageImpact()", () => {
  test("fits is true when required bytes are well under free space", () => {
    const impact = storageImpact(dataDir, 1);
    expect(impact.fits).toBe(true);
    expect(impact.freeBytesAfter).toBe(impact.disk.freeBytes - 1);
  });

  test("fits is false when required bytes exceed free space", () => {
    const impact = storageImpact(dataDir, Number.MAX_SAFE_INTEGER);
    expect(impact.fits).toBe(false);
    expect(impact.freeBytesAfter).toBeLessThan(0);
  });
});

describe("GET /api/storage/impact", () => {
  test("reports disk usage and fit for a chosen path and size", async () => {
    const { client } = await owner();
    const res = await client.get(`/api/storage/impact?path=${encodeURIComponent(dataDir)}&requiredBytes=1`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { fits: boolean; requiredBytes: number };
    expect(body.fits).toBe(true);
    expect(body.requiredBytes).toBe(1);
  });
});

describe("checkPersonQuota()", () => {
  test("unlimited (default 0) always allows", () => {
    const { id } = { id: "person-doesnotexist" };
    expect(checkPersonQuota(id, 999_999_999).ok).toBe(true);
  });

  test("refuses when a set quota would be exceeded", async () => {
    const { id } = await owner();
    setValue(toPersonRow(id), `person:${id}`, "storage.person_quota_gb", 1);
    const oneGb = 1024 * 1024 * 1024;
    expect(checkPersonQuota(id, oneGb - 1).ok).toBe(true);
    expect(checkPersonQuota(id, oneGb + 1).ok).toBe(false);
  });
});

describe("checkDiskFull()", () => {
  test("raises a Repairs issue when free space is below the household threshold", () => {
    setHouseholdSettingValue("storage.critical_free_gb", Number.MAX_SAFE_INTEGER);
    checkDiskFull();
    const issue = listIssues().find((i) => i.source === "storage" && i.key === "disk_full");
    expect(issue?.severity).toBe("error");
  });

  test("resolves the issue once space is no longer critical", () => {
    setHouseholdSettingValue("storage.critical_free_gb", Number.MAX_SAFE_INTEGER);
    checkDiskFull();
    setHouseholdSettingValue("storage.critical_free_gb", 0);
    checkDiskFull();
    const issue = listIssues().find((i) => i.source === "storage" && i.key === "disk_full");
    expect(issue?.resolved_at).not.toBeNull();
  });
});

describe("NAS mounts", () => {
  test("declares, lists, and removes a mount pointing at a real directory", async () => {
    const { client } = await owner();
    const dir = mkdtempSync(join(tmpdir(), "maipai-nas-test-"));

    const created = await client.post("/api/storage/nas-mounts", { label: "Media NAS", path: dir, scanPaths: ["movies", "shows"] });
    expect(created.status).toBe(201);
    const mount = (await created.json()) as { id: string };

    const list = (await (await client.get("/api/storage/nas-mounts")).json()) as Array<{ id: string; scanPaths: string[] }>;
    expect(list.some((m) => m.id === mount.id && m.scanPaths.length === 2)).toBe(true);

    const del = await client.request(`/api/storage/nas-mounts/${mount.id}`, { method: "DELETE" });
    expect(del.status).toBe(200);
  });

  test("refuses a path that does not exist", async () => {
    const { client } = await owner();
    const res = await client.post("/api/storage/nas-mounts", { label: "Nope", path: "/no/such/path", scanPaths: [] });
    expect(res.status).toBe(400);
  });
});

describe("factory reset", () => {
  test("refuses the wrong confirmation phrase", async () => {
    const result = await stageFactoryReset("delete everything");
    expect(result.ok).toBe(false);
  });

  test("stages with a fresh backup on the right phrase, then applies at the next boot", async () => {
    const stageResult = await stageFactoryReset(FACTORY_RESET_CONFIRMATION_PHRASE);
    expect(stageResult.ok).toBe(true);
    expect(stageResult.backupFilename).toBeTruthy();
    expect(existsSync(join(backupDir, stageResult.backupFilename!))).toBe(true);

    const pending = pendingFactoryReset();
    expect(pending?.backupFilename).toBe(stageResult.backupFilename!);

    // Simulate the next boot against a throwaway directory - never the
    // live dataDir, the same reason restoreStaging.test.ts's own
    // applyPendingRestore() tests do this (a real open handle on this
    // process's own hub.db must never be renamed out from under it).
    const throwawayDir = mkdtempSync(join(tmpdir(), "maipai-factory-reset-test-"));
    writeFileSync(join(throwawayDir, "hub.db"), "not a real database, just needs to exist");
    writeFileSync(
      join(throwawayDir, "factory-reset-pending.json"),
      JSON.stringify({ stagedAt: new Date().toISOString(), backupFilename: stageResult.backupFilename }),
    );
    const applied = applyPendingFactoryReset(throwawayDir);
    expect(applied).not.toBeNull();
    expect(existsSync(join(throwawayDir, "hub.db"))).toBe(false); // moved aside
    expect(existsSync(join(throwawayDir, "hub.db.pre-factory-reset"))).toBe(true);
    expect(pendingFactoryReset(throwawayDir)).toBeNull();
  });

  test("cancelling removes the marker without touching the live database", async () => {
    await stageFactoryReset(FACTORY_RESET_CONFIRMATION_PHRASE);
    expect(cancelPendingFactoryReset()).toBe(true);
    expect(pendingFactoryReset()).toBeNull();
    expect(existsSync(join(dataDir, "hub.db"))).toBe(true); // untouched
  });

  // A code review (2026-09-06): a crash right after renaming hub.db to
  // the pre-reset slot, but before its own -wal/-shm got the same
  // treatment, leaves exactly this state - the main file already at
  // `hub.db.pre-factory-reset`, hub.db itself gone, and its -wal still
  // sitting under the OLD `hub.db-wal` name. The buggy version's retry
  // archived that lone main file (since it alone was checked for) to a
  // timestamped name, then separately moved the still-present `hub.db-
  // wal` onto the now-bare `hub.db.pre-factory-reset-wal` - a main file
  // with no journal sitting next to a journal with no main file.
  test("a crash between renaming the main file and its own WAL/SHM does not split them on retry", async () => {
    const throwawayDir = mkdtempSync(join(tmpdir(), "maipai-factory-reset-crash-test-"));
    writeFileSync(join(throwawayDir, "factory-reset-pending.json"), JSON.stringify({ stagedAt: new Date().toISOString(), backupFilename: "backup-x.db.enc" }));

    // State left behind by the crashed first attempt: hub.db already
    // renamed to the pre-reset slot, but its -wal was not yet moved.
    writeFileSync(join(throwawayDir, "hub.db.pre-factory-reset"), "main file from the crashed attempt");
    writeFileSync(join(throwawayDir, "hub.db-wal"), "its own wal, not yet moved when the crash happened");

    const applied = applyPendingFactoryReset(throwawayDir);
    expect(applied).not.toBeNull();

    // Never split: every "-wal" file's own main file (its name minus the
    // "-wal" suffix) must exist too, and vice versa - whatever name each
    // pair ends up under, bare or archived-with-a-timestamp.
    const files = new Set(readdirSync(throwawayDir).filter((f) => f.startsWith("hub.db.pre-factory-reset")));
    for (const f of files) {
      if (f.endsWith("-wal")) expect(files.has(f.slice(0, -"-wal".length))).toBe(true);
    }
    for (const f of files) {
      if (!f.endsWith("-wal") && !f.endsWith("-shm")) expect(files.has(`${f}-wal`)).toBe(true);
    }
  });
});

describe("POST /api/storage/factory-reset", () => {
  test("owner-only, even with backups.restore granted to an admin", async () => {
    const { client } = await owner();
    const adminRes = await client.post("/api/people", { displayName: "Marlow", role: "admin", secret: "correcthorse2" });
    const admin = (await adminRes.json()) as { id: string };
    await client.post("/api/grants", { person: admin.id, action: "backups.restore", effect: "allow" });

    const adminClient = new TestClient();
    await adminClient.post("/api/auth/verify-secret", { personId: admin.id, secret: "correcthorse2" });
    const res = await adminClient.post("/api/storage/factory-reset", { confirmation: FACTORY_RESET_CONFIRMATION_PHRASE });
    expect(res.status).toBe(403);
  });

  test("the owner can stage one over the API", async () => {
    const { client } = await owner();
    const res = await client.post("/api/storage/factory-reset", { confirmation: FACTORY_RESET_CONFIRMATION_PHRASE });
    expect(res.status).toBe(200);
  });
});

function conversationFor(actor: PersonRow): string {
  const result = resolveOrCreateConversation(actor, "chat");
  if (!result.ok) throw new Error(result.error);
  return result.value.id;
}

function turnFor(actor: PersonRow, conversationId: string): string {
  const id = newConversationTurnId();
  db.insert(conversationTurns)
    .values({
      id,
      personId: actor.id,
      surface: "chat",
      conversationId,
      userText: "here's a picture",
      replyText: "saved",
      source: "model",
      safetyAction: "allow",
      createdAt: new Date().toISOString(),
      hlc: nextHlc(),
    })
    .run();
  return id;
}

async function upload(actor: PersonRow, mediaType: string, text: string): Promise<void> {
  const conversationId = conversationFor(actor);
  const turnId = turnFor(actor, conversationId);
  const result = createAttachment(actor, { conversationId, turnId, mediaType, bytes: new TextEncoder().encode(text) });
  if (!result.ok) throw new Error(result.error);
}

// STORE-PAGE-01 (docs/BACKLOG.md): the Storage settings page's one read,
// GET /api/storage/usage - and the proof that it and GET /api/performance
// share the exact household number, not just numbers that happen to match.
describe("GET /api/storage/usage", () => {
  test("an owner/admin sees every person's row plus the household total", async () => {
    const { client, id } = await owner();
    const ownerRow = toPersonRow(id);
    const { row: childRow } = await child(client);
    await upload(ownerRow, "image/png", "a picture from the owner");
    await upload(childRow, "video/mp4", "a clip from the child");

    const res = await client.get("/api/storage/usage");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      people: Array<{ personId: string; usageBytes: number; byKind: Array<{ kind: string; bytes: number }> }>;
      household: { usageBytes: number; capBytes: number } | null;
    };

    expect(body.people).toHaveLength(2);
    const ownerRowOut = body.people.find((p) => p.personId === id)!;
    const childRowOut = body.people.find((p) => p.personId === childRow.id)!;
    expect(ownerRowOut.usageBytes).toBe("a picture from the owner".length);
    expect(ownerRowOut.byKind).toEqual([{ kind: "image", bytes: "a picture from the owner".length }]);
    expect(childRowOut.usageBytes).toBe("a clip from the child".length);
    expect(childRowOut.byKind).toEqual([{ kind: "video", bytes: "a clip from the child".length }]);

    expect(body.household).not.toBeNull();
    expect(body.household!.usageBytes).toBe("a picture from the owner".length + "a clip from the child".length);
  });

  test("a child sees only their own row - never the household total, never a sibling's row", async () => {
    const { client: ownerClient, id: ownerId } = await owner();
    const ownerRow = toPersonRow(ownerId);
    const { client: childClient, row: childRow } = await child(ownerClient);
    await upload(ownerRow, "image/png", "the owner's own private picture");
    await upload(childRow, "audio/mp3", "the child's own clip");

    const res = await childClient.get("/api/storage/usage");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      people: Array<{ personId: string; usageBytes: number }>;
      household: unknown;
    };

    expect(body.people).toHaveLength(1);
    expect(body.people[0]!.personId).toBe(childRow.id);
    expect(body.people[0]!.usageBytes).toBe("the child's own clip".length);
    expect(body.household).toBeNull();
  });

  test("largest kinds per person, sorted with the biggest first", async () => {
    const { client, id } = await owner();
    const ownerRow = toPersonRow(id);
    await upload(ownerRow, "audio/mp3", "a short clip"); // 12 bytes
    await upload(ownerRow, "image/png", "a much longer picture description used as bytes"); // longer

    const res = await client.get("/api/storage/usage");
    const body = (await res.json()) as { people: Array<{ personId: string; byKind: Array<{ kind: string; bytes: number }> }> };
    const row = body.people.find((p) => p.personId === id)!;
    expect(row.byKind[0]!.kind).toBe("image");
    expect(row.byKind[1]!.kind).toBe("audio");
  });

  test("requires sign-in", async () => {
    const client = new TestClient();
    expect((await client.get("/api/storage/usage")).status).toBe(401);
  });

  test("the Storage page's household total and the performance panel's disk area are the exact same number, from the exact same function", async () => {
    const { client, id } = await owner();
    const ownerRow = toPersonRow(id);
    await upload(ownerRow, "image/png", "bytes counted on both surfaces");

    const usageRes = await client.get("/api/storage/usage");
    const usageBody = (await usageRes.json()) as { household: { usageBytes: number } };

    const perfRes = await client.get("/api/performance");
    const perfBody = (await perfRes.json()) as { disk: { areas: Array<{ area: string; bytes: number }> } };
    const attachmentsArea = perfBody.disk.areas.find((a) => a.area === "attachments");

    expect(attachmentsArea).toBeDefined();
    expect(attachmentsArea!.bytes).toBe(usageBody.household.usageBytes);
    expect(attachmentsArea!.bytes).toBe("bytes counted on both surfaces".length);
  });
});

describe("generateDiagnostics()", () => {
  test("never includes a family name, a real address, or a secret settings value", async () => {
    const { id } = await owner();
    sqlite.query("UPDATE people SET display_name = ?, nickname = ? WHERE id = ?").run("Sage Torres", "Dad", id);
    sqlite.query("INSERT INTO hub_endpoints (id, name, url, kind, priority, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
      "endpoint-1",
      "Living room router",
      "https://192.168.1.50:8787",
      "lan",
      0,
      1,
      new Date().toISOString(),
      new Date().toISOString(),
    );
    setHouseholdSettingValue("notifications.telegram.bot_token", "super-secret-token-value");

    const report = generateDiagnostics();
    const dump = JSON.stringify(report);

    expect(dump).not.toContain("Sage Torres");
    expect(dump).not.toContain("Dad");
    expect(dump).not.toContain("Living room router");
    expect(dump).not.toContain("192.168.1.50");
    expect(dump).not.toContain("super-secret-token-value");

    expect(report.endpointCount).toBe(1);
    const botTokenSetting = report.settings.find((s) => s.key === "notifications.telegram.bot_token");
    expect(botTokenSetting?.value).toBe("[redacted]");
  });

  test("never includes any person-scoped setting value", async () => {
    const { id } = await owner();
    setValue(toPersonRow(id), `person:${id}`, "tts.voice_id", "a-distinctive-voice-id-12345");
    const report = generateDiagnostics();
    expect(JSON.stringify(report)).not.toContain("a-distinctive-voice-id-12345");
  });

  test("never includes a custom hub display name", async () => {
    const { setHubName } = await import("@/lib/hubIdentity");
    setHubName("The Torres House");
    const report = generateDiagnostics();
    expect(JSON.stringify(report)).not.toContain("Torres");
  });
});
