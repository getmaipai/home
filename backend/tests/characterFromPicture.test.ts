// SAVE-CHARACTER-01: POST /api/media-subjects/from-picture saves a finished picture as a character through the real route.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import sharp from "sharp";
import { db } from "@/db";
import { attachments } from "@/db/schema";
import { eq } from "drizzle-orm";
import { storeFile } from "@/lib/attachments";
import { listCast } from "@/lib/cast";
import { elementRows } from "@/lib/elementsApp";
import { __setCharacterCaptureForTests, CHARACTER_LOCKED_LINE, CHARACTER_WAITING_LINE, CHARACTER_SAVED_LINE } from "@/lib/characterFromPicture";
import { __setPictureStatusForTests } from "@/lib/pictures/ready";
import type { StackImageStatus } from "@/lib/pictures/stack";
import type { PersonRow } from "@/types";
import { household, unlock, unlockHeader } from "./fixtures/adultLock";
import { resetDb } from "./reset-db";

const started: string[] = [];
beforeEach(() => { resetDb(); started.length = 0; __setCharacterCaptureForTests((_actor, id) => { started.push(id); }); __setPictureStatusForTests({ ready: true } as unknown as StackImageStatus); });
afterEach(() => { __setCharacterCaptureForTests(null); __setPictureStatusForTests(undefined); });

async function picture(actor: PersonRow, provenance = 'picture-gen:{"audience":"all-ages"}', retention: "kept" | "conversation" = "kept"): Promise<string> {
  const bytes = new Uint8Array(await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 90, b: 30 } } }).png().toBuffer());
  const stored = storeFile(actor, { conversationId: null, turnId: null, mediaType: "image/png", bytes, provenance, retention, name: "fox.png" });
  if (!stored.ok) throw new Error(stored.error);
  return stored.value.id;
}
const save = (client: { post: (p: string, b?: unknown, h?: Record<string, string>) => Promise<Response> }, file_id: string, name: unknown, headers?: Record<string, string>) => client.post("/api/media-subjects/from-picture", { file_id, name }, headers);

describe("save a picture as a character", () => {
  test("ELEMENTS-HOME-03: a place or a prop is saved the same way with no look capture, and its refusal lines name the kind", async () => {
    const { adult, row } = await household();
    const me = row("Marlow");
    const file = await picture(me);
    for (const kind of ["place", "prop"] as const) {
      const res = await adult.client.post("/api/media-subjects/from-picture", { file_id: file, name: `Test ${kind}`, kind });
      expect(res.status).toBe(201);
      const body = await res.json() as { subject: { kind: string; reference_ids: string[] }; line: string };
      expect(body.subject).toMatchObject({ kind, reference_ids: [file] });
      expect(body.line).toBe("Saved.");
      expect(elementRows(me, { kind }).map((item) => item.title)).toContain(`Test ${kind}`);
    }
    expect(started).toEqual([]);
    const refused = await adult.client.post("/api/media-subjects/from-picture", { file_id: "nope", name: "Barn", kind: "place" });
    expect(refused.status).toBe(404);
    expect(((await refused.json()) as { error: string }).error).toContain("Choose one of your own pictures");
  });

  test("the owner saves a picture: a character with that picture, in the cast list, the Elements Characters rows and the @ mention list, and the look capture starts", async () => {
    const { adult, row } = await household();
    const me = row("Marlow");
    const file = await picture(me);
    const res = await save(adult.client, file, "  Juniper  ");
    expect(res.status).toBe(201);
    const body = await res.json() as { subject: { id: string; name: string; kind: string; reference_ids: string[]; real: boolean }; capture: string; line: string; job_id: string | null };
    expect(body.subject).toMatchObject({ name: "Juniper", kind: "character", reference_ids: [file], real: false });
    expect(body).toMatchObject({ capture: "started", line: CHARACTER_SAVED_LINE, job_id: null });
    expect(started).toEqual([body.subject.id]);
    expect(listCast(me).some((entry) => entry.subject_id === body.subject.id && entry.name === "Juniper")).toBe(true);
    const rows = elementRows(me, { kind: "character" });
    const mine = rows.find((item) => item.title === "Juniper");
    expect(mine?.thumbnail).toBe(`/api/files/${file}/thumb?w=320`);
    expect((await (await adult.client.get("/api/media-subjects")).json() as { subjects: Array<{ id: string }> }).subjects.map((s) => s.id)).toContain(body.subject.id);
  });

  test("with the picture engine down the character is still saved, no capture starts, and the line says the sheet waits", async () => {
    const { adult, row } = await household();
    __setPictureStatusForTests(null);
    const res = await save(adult.client, await picture(row("Marlow")), "Bruno");
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ capture: "waiting", line: CHARACTER_WAITING_LINE });
    expect(started).toEqual([]);
  });

  test("the name is required, trimmed and 1 to 60 characters; the same name twice is allowed", async () => {
    const { adult, row } = await household();
    const file = await picture(row("Marlow"));
    expect((await save(adult.client, file, "")).status).toBe(400);
    expect((await save(adult.client, file, "   ")).status).toBe(400);
    expect((await save(adult.client, file, "x".repeat(61))).status).toBe(400);
    expect((await save(adult.client, file, undefined)).status).toBe(400);
    expect((await save(adult.client, file, "x".repeat(60))).status).toBe(201);
    expect((await save(adult.client, file, "Twin")).status).toBe(201);
    expect((await save(adult.client, file, "Twin")).status).toBe(201);
    expect((elementRows(row("Marlow"), { kind: "character" }) as Array<{ title: string }>).filter((item) => item.title === "Twin")).toHaveLength(2);
  });

  test("a picture that is not the person's own, or is gone, is refused with a plain line", async () => {
    const { adult, other, row } = await household();
    const theirs = await picture(row("Quill"));
    const refused = await save(adult.client, theirs, "Nope");
    expect(refused.status).toBe(404);
    expect((await refused.json() as { error: string }).error).toContain("not in your Library");
    expect((await save(adult.client, "missing-file", "Nope")).status).toBe(404);
    const mine = await picture(row("Marlow"));
    db.update(attachments).set({ deletedAt: new Date().toISOString() }).where(eq(attachments.id, mine)).run();
    expect((await save(adult.client, mine, "Gone")).status).toBe(404);
    expect(other.id).toBeTruthy();
  });

  test("a locked adult-only picture is refused with the lock line, and saves once the page is unlocked", async () => {
    const { adult, row } = await household();
    const file = await picture(row("Marlow"), 'picture-gen:{"audience":"adult-only"}');
    const locked = await save(adult.client, file, "Velvet");
    expect(locked.status).toBe(403);
    expect((await locked.json() as { error: string }).error).toBe(CHARACTER_LOCKED_LINE);
    expect(started).toEqual([]);
    const proof = unlockHeader(await unlock(adult.client));
    const opened = await save(adult.client, file, "Velvet", proof);
    expect(opened.status).toBe(201);
  });

  test("a teen or child never saves an adult-only picture, even one they own", async () => {
    const { teen, child, row } = await household();
    for (const [who, name] of [[teen, "Nova"], [child, "Sprout"]] as const) {
      const file = await picture(row(name), 'picture-gen:{"audience":"adult-only"}');
      const res = await save(who.client, file, "Nope");
      expect(res.status).toBe(403);
    }
    expect(started).toEqual([]);
  });

  test("a teen saves their own all-ages picture as their own character; an adult sees no trace of it", async () => {
    const { teen, adult, row } = await household();
    const file = await picture(row("Nova"));
    const res = await save(teen.client, file, "Pip");
    expect(res.status).toBe(201);
    const id = (await res.json() as { subject: { id: string } }).subject.id;
    expect((elementRows(row("Nova"), { kind: "character" }) as Array<{ id: string }>).map((item) => item.id)).toContain(id);
    expect((await (await adult.client.get("/api/media-subjects")).json() as { subjects: Array<{ id: string }> }).subjects.map((s) => s.id)).not.toContain(id);
  });

  test("a picture that is neither kept nor made by Home is refused with the keep line", async () => {
    const { adult, row } = await household();
    const file = await picture(row("Marlow"), "composer:upload", "conversation");
    const res = await save(adult.client, file, "Temp");
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toContain("Keep this picture");
  });

  test("signed-out callers get 401", async () => {
    const { owner } = await household();
    const { TestClient } = await import("./client");
    expect((await new TestClient().post("/api/media-subjects/from-picture", { file_id: "x", name: "A" })).status).toBe(401);
    expect(owner).toBeTruthy();
  });
});
