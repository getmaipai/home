import { deleteEpisodesForPerson } from "@/lib/episodes";
import { describe, expect, test, beforeEach } from "bun:test";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { runBackup } from "@/lib/backup";
import { restorePersonFromBackup, PartialRestoreRefused } from "@/lib/partialRestore";
import { remember } from "@/lib/memory";
import { logTurn, resolveOrCreateConversation } from "@/lib/conversationHistory";
import { setValue } from "@/lib/settings";
import { sqlite, db } from "@/db";
import { pendingEmbeddings } from "@/db/schema";
import { backupDir } from "@/lib/paths";
import type { PersonRow } from "@/types";
import type { TurnValue } from "@/wire";

const SAFE: TurnValue["safety"] = {
  flagged: false,
  categories: [],
  action: "allow",
  notify_parent: false,
  matched_signals: [],
  checked_at: new Date().toISOString(),
};

function resetBackupDir(): void {
  if (!existsSync(backupDir)) return;
  for (const f of readdirSync(backupDir)) rmSync(join(backupDir, f), { force: true });
}

beforeEach(() => {
  resetDb();
  __resetThrottleForTests();
  resetBackupDir();
});

function toPersonRow(id: string): PersonRow {
  return sqlite.query("SELECT * FROM people WHERE id = ?").get(id) as unknown as PersonRow;
}

describe("restorePersonFromBackup()", () => {
  test("brings back memories, conversation history and settings, then loses everything live, then restores it", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const personRes = await owner.post("/api/people", { displayName: "Bramble", role: "teen" });
    const person = (await personRes.json()) as { id: string };
    const personRow = toPersonRow(person.id);

    remember(personRow, {
      text: "Bramble likes trains",
      category: "preference",
      tier: "durable",
      scope: "person",
      person: person.id,
      source: "hub",
      importance: 0.5,
    });
    const conv = resolveOrCreateConversation(personRow, "chat");
    if (!conv.ok) throw new Error(conv.error);
    logTurn(personRow, "chat", "hi", { reply: { text: "hello" }, source: "model", safety: SAFE, conversation_id: conv.value.id, turn_id: "turn-1" });
    setValue(personRow, `person:${person.id}`, "tts.voice_id", "alba");

    const backup = await runBackup();

    // Lose it all live: this is the scenario the feature exists for -
    // an accidental forget()/settings reset, not necessarily a delete.
    // pending_embeddings and pending_memory_work both carry an FK to
    // memory_records.id, so their queue rows must go first.
    sqlite.query("DELETE FROM memory_embeddings WHERE memory_id IN (SELECT id FROM memory_records WHERE person = ?)").run(person.id);
    sqlite.query("DELETE FROM pending_embeddings WHERE memory_id IN (SELECT id FROM memory_records WHERE person = ?)").run(person.id);
    sqlite.query("DELETE FROM pending_memory_work WHERE memory_id IN (SELECT id FROM memory_records WHERE person = ?)").run(person.id);
    sqlite.query("DELETE FROM memory_records WHERE person = ?").run(person.id);
    deleteEpisodesForPerson(person.id);
    sqlite.query("DELETE FROM conversation_turns WHERE person_id = ?").run(person.id);
    sqlite.query("DELETE FROM conversations WHERE person_id = ?").run(person.id);
    sqlite.query("DELETE FROM settings_values WHERE scope = ?").run(`person:${person.id}`);

    const result = await restorePersonFromBackup(backup.filename, person.id);
    expect(result.memories).toBe(1);
    expect(result.conversations).toBe(1);
    expect(result.conversationThreads).toBe(1);
    expect(result.settings).toBe(1);
    // MEM-03: the turn's two verbatim episodes come back with it.
    expect(result.episodes).toBe(2);
    expect((sqlite.query("SELECT count(*) AS n FROM episodes WHERE person_id = ?").get(person.id) as { n: number }).n).toBe(2);

    const memory = sqlite.query("SELECT text, embedding_space FROM memory_records WHERE person = ?").get(person.id) as
      | { text: string; embedding_space: string | null }
      | undefined;
    expect(memory?.text).toBe("Bramble likes trains");
    expect(memory?.embedding_space).toBeNull(); // never restored - re-queued instead

    const queued = db.select().from(pendingEmbeddings).all();
    expect(queued.length).toBe(1);

    const settingRow = sqlite.query("SELECT value FROM settings_values WHERE scope = ? AND key = ?").get(`person:${person.id}`, "tts.voice_id") as
      | { value: string }
      | undefined;
    expect(settingRow?.value).toBe(JSON.stringify("alba"));
  });

  test("never touches another person's data in the same backup", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const aRes = await owner.post("/api/people", { displayName: "Bramble", role: "teen" });
    const a = (await aRes.json()) as { id: string };
    const bRes = await owner.post("/api/people", { displayName: "Iris", role: "adult", secret: "0000" });
    const b = (await bRes.json()) as { id: string };

    remember(toPersonRow(a.id), { text: "A's memory", category: "preference", tier: "durable", scope: "person", person: a.id, source: "hub", importance: 0.5 });
    remember(toPersonRow(b.id), { text: "B's memory", category: "preference", tier: "durable", scope: "person", person: b.id, source: "hub", importance: 0.5 });

    const backup = await runBackup();
    sqlite.query("DELETE FROM memory_embeddings WHERE memory_id IN (SELECT id FROM memory_records WHERE person = ?)").run(a.id);
    sqlite.query("DELETE FROM pending_embeddings WHERE memory_id IN (SELECT id FROM memory_records WHERE person = ?)").run(a.id);
    sqlite.query("DELETE FROM pending_memory_work WHERE memory_id IN (SELECT id FROM memory_records WHERE person = ?)").run(a.id);
    sqlite.query("DELETE FROM memory_records WHERE person = ?").run(a.id);
    deleteEpisodesForPerson(a.id);
    sqlite.query("DELETE FROM memory_embeddings WHERE memory_id IN (SELECT id FROM memory_records WHERE person = ?)").run(b.id);
    sqlite.query("DELETE FROM pending_embeddings WHERE memory_id IN (SELECT id FROM memory_records WHERE person = ?)").run(b.id);
    sqlite.query("DELETE FROM pending_memory_work WHERE memory_id IN (SELECT id FROM memory_records WHERE person = ?)").run(b.id);
    sqlite.query("DELETE FROM memory_records WHERE person = ?").run(b.id);
    deleteEpisodesForPerson(b.id);

    await restorePersonFromBackup(backup.filename, a.id);
    expect((sqlite.query("SELECT COUNT(*) AS n FROM memory_records WHERE person = ?").get(a.id) as { n: number }).n).toBe(1);
    expect((sqlite.query("SELECT COUNT(*) AS n FROM memory_records WHERE person = ?").get(b.id) as { n: number }).n).toBe(0);
  });

  test("running it twice on the same backup is a harmless no-op the second time", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const personRes = await owner.post("/api/people", { displayName: "Bramble", role: "teen" });
    const person = (await personRes.json()) as { id: string };
    remember(toPersonRow(person.id), { text: "Bramble likes trains", category: "preference", tier: "durable", scope: "person", person: person.id, source: "hub", importance: 0.5 });

    const backup = await runBackup();
    sqlite.query("DELETE FROM memory_embeddings WHERE memory_id IN (SELECT id FROM memory_records WHERE person = ?)").run(person.id);
    sqlite.query("DELETE FROM pending_embeddings WHERE memory_id IN (SELECT id FROM memory_records WHERE person = ?)").run(person.id);
    sqlite.query("DELETE FROM pending_memory_work WHERE memory_id IN (SELECT id FROM memory_records WHERE person = ?)").run(person.id);
    sqlite.query("DELETE FROM memory_records WHERE person = ?").run(person.id);

    await restorePersonFromBackup(backup.filename, person.id);
    await restorePersonFromBackup(backup.filename, person.id);
    expect((sqlite.query("SELECT COUNT(*) AS n FROM memory_records WHERE person = ?").get(person.id) as { n: number }).n).toBe(1);
  });

  test("refuses a deleted person", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const personRes = await owner.post("/api/people", { displayName: "Bramble", role: "teen" });
    const person = (await personRes.json()) as { id: string };
    const backup = await runBackup();
    await owner.request(`/api/people/${person.id}`, { method: "DELETE" });

    await expect(restorePersonFromBackup(backup.filename, person.id)).rejects.toThrow(PartialRestoreRefused);
  });

  test("refuses a person the backup never contained", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const backup = await runBackup();
    const laterRes = await owner.post("/api/people", { displayName: "Bramble", role: "teen" });
    const later = (await laterRes.json()) as { id: string };

    await expect(restorePersonFromBackup(backup.filename, later.id)).rejects.toThrow(PartialRestoreRefused);
  });

  test("refuses an unknown backup filename", async () => {
    const owner = new TestClient();
    const res = await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const { person } = (await res.json()) as { person: { id: string } };
    await expect(restorePersonFromBackup("backup-nope.db.enc", person.id)).rejects.toThrow(PartialRestoreRefused);
  });
});

describe("POST /api/backups/:filename/restore-person/:personId", () => {
  test("owner/admin can trigger it over the API", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const personRes = await owner.post("/api/people", { displayName: "Bramble", role: "teen" });
    const person = (await personRes.json()) as { id: string };
    remember(toPersonRow(person.id), { text: "Bramble likes trains", category: "preference", tier: "durable", scope: "person", person: person.id, source: "hub", importance: 0.5 });

    const backup = await runBackup();
    sqlite.query("DELETE FROM memory_embeddings WHERE memory_id IN (SELECT id FROM memory_records WHERE person = ?)").run(person.id);
    sqlite.query("DELETE FROM pending_embeddings WHERE memory_id IN (SELECT id FROM memory_records WHERE person = ?)").run(person.id);
    sqlite.query("DELETE FROM pending_memory_work WHERE memory_id IN (SELECT id FROM memory_records WHERE person = ?)").run(person.id);
    sqlite.query("DELETE FROM memory_records WHERE person = ?").run(person.id);

    const res = await owner.request(`/api/backups/${backup.filename}/restore-person/${person.id}`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { memories: number };
    expect(body.memories).toBe(1);
  });

  test("refuses a filename that is not a real backup, including a traversal attempt", async () => {
    const owner = new TestClient();
    const res = await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const { person } = (await res.json()) as { person: { id: string } };
    const nope = await owner.request(`/api/backups/nope.db.enc/restore-person/${person.id}`, { method: "POST" });
    expect(nope.status).toBe(404);
    const traversal = await owner.request(`/api/backups/${encodeURIComponent("../../etc/passwd")}/restore-person/${person.id}`, { method: "POST" });
    expect(traversal.status).toBe(404);
  });

  test("an adult without backups.restore is refused", async () => {
    const owner = new TestClient();
    await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const adultRes = await owner.post("/api/people", { displayName: "Marlow", role: "adult", secret: "0000" });
    const adult = (await adultRes.json()) as { id: string };
    const backup = await runBackup();

    const adultClient = new TestClient();
    await adultClient.post("/api/auth/verify-secret", { personId: adult.id, secret: "0000" });
    const res = await adultClient.request(`/api/backups/${backup.filename}/restore-person/${adult.id}`, { method: "POST" });
    expect(res.status).toBe(403);
  });
});
