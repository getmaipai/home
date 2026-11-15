import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { household } from "./fixtures/adultLock";
import { autoLocked } from "./fixtures/clearAutoLocks";
import { db } from "@/db";
import { attachments } from "@/db/schema";
import { dataDir } from "@/lib/paths";
import { lockItemOfProvenance, lockState } from "@/lib/adultLock";
import { logMark } from "@/lib/adultMarks";
import { listLibrary } from "@/lib/library";
import type { PersonRow } from "@/types";

beforeEach(() => { resetDb(); rmSync(join(dataDir, "adult-lock-cleanups"), { recursive: true, force: true }); });

const item = (id: string) => db.select().from(attachments).where(eq(attachments.id, id)).get()!;
const marks = (id: string) => {
  const row = item(id);
  return lockItemOfProvenance(row.ownerPersonId, row.provenance);
};
const visible = (actor: PersonRow, id: string) => listLibrary(actor, {}).items.some((entry) => entry.id === id);
const getState = (actor: PersonRow, id: string) => lockState(marks(id), actor);
const clearPath = "/api/adult-lock/auto-locks/clear";
const scanPath = "/api/adult-lock/auto-locks";
const undoPath = "/api/adult-lock/auto-locks/undo";

describe("automatic lock cleanup routes", () => {
  test("owner can scan, clear, see the picture, and undo exactly once", async () => {
    const h = await household();
    const actor = h.row("Sage");
    const candidate = await autoLocked(actor);
    const before = item(candidate).provenance;

    const scanResponse = await h.owner.get(scanPath);
    expect(scanResponse.status).toBe(200);
    const scan = await scanResponse.json() as { candidates: number; last_run: unknown };
    expect(scan.candidates).toBe(1);
    expect(JSON.stringify(scan)).not.toContain(candidate);

    const cleared = await h.owner.post(clearPath, { expected: scan.candidates });
    expect(cleared.status).toBe(200);
    const result = await cleared.json() as { run_id: string; changed: number };
    expect(result.changed).toBe(1);
    expect(getState(actor, candidate)).toBe("open");
    expect(visible(actor, candidate)).toBe(true);

    const reportPath = join(dataDir, "adult-lock-cleanups", `${result.run_id}.json`);
    expect(existsSync(reportPath)).toBe(true);
    const reportText = readFileSync(reportPath, "utf8");
    expect(JSON.parse(reportText)).toMatchObject({ id: result.run_id, by_person_id: actor.id, changed: [{ item_id: candidate }] });
    expect(reportText).not.toMatch(/picture-gen|landscape|prompt|title/i);

    const undone = await h.owner.post(undoPath, { run_id: result.run_id });
    expect(undone.status).toBe(200);
    expect(await undone.json()).toEqual({ restored: 1, changed_since: 0 });
    expect(item(candidate).provenance).toBe(before);
    expect(getState(actor, candidate)).toBe("locked");
    expect(visible(actor, candidate)).toBe(false);
    const secondUndo = await h.owner.post(undoPath, { run_id: result.run_id });
    expect(secondUndo.status).toBe(409);
    expect((await secondUndo.json() as { error: string }).error).toMatch(/already/i);
  });

  test("admin and other people are refused", async () => {
    const h = await household();
    const response = await h.adult.client.get(scanPath);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "owner_only" });
  });

  test("a stale expected count changes nothing", async () => {
    const h = await household();
    const actor = h.row("Sage");
    await autoLocked(actor);
    const response = await h.owner.post(clearPath, { expected: 0 });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "count_changed", error: "The number changed. Look again and confirm." });
    expect((await h.owner.get(scanPath).then((r) => r.json()) as { candidates: number }).candidates).toBe(1);
  });

  test("nothing to clear gives the plain line", async () => {
    const h = await household();
    const response = await h.owner.post(clearPath, { expected: 0 });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "nothing_to_clear", error: "Nothing needs clearing. No picture was locked by the app on its own." });
  });

  test("hand-locked, adult-style, and minor-owned pictures stay locked", async () => {
    const h = await household();
    const owner = h.row("Sage");
    const source = await autoLocked(owner);
    logMark({ itemId: source, action: "mark", actorId: owner.id, via: "creator" });
    const minor = await autoLocked(h.row("Nova"));
    const adultStyle = await autoLocked(owner, true);
    const response = await h.owner.post(clearPath, { expected: 0 });
    expect(response.status).toBe(409);
    expect(getState(owner, source)).toBe("locked");
    expect(item(minor).provenance).toContain('"lock":"on"');
    expect(item(adultStyle).provenance).toContain('"lock":"on"');
  });

  test("an item changed after clear is counted and left as changed", async () => {
    const h = await household();
    const owner = h.row("Sage");
    const candidate = await autoLocked(owner);
    const result = await (await h.owner.post(clearPath, { expected: 1 })).json() as { run_id: string };
    logMark({ itemId: candidate, action: "mark", actorId: owner.id, via: "creator" });
    expect(await (await h.owner.post(undoPath, { run_id: result.run_id })).json()).toEqual({ restored: 0, changed_since: 1 });
  });
});
