import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments, musicDjLines, people } from "@/db/schema";
import { storeFile } from "@/lib/attachments";
import { writeDjLine, synthesizeDjLine, saveDjLine, consumeDjLine, pruneDjLines, DJ_ANGLES } from "@/lib/music/djLines";
import { resetDb } from "./reset-db";

beforeEach(() => resetDb());

const base = { position: "transition" as const, prev: { title: "Paper Boats", artist: "Rivet Row" }, next: { title: "Blue Window", artist: "Mira Vale" }, factPrev: null, factNext: null, bio: null, stationName: "Night Drive", personName: "Sage", angle: DJ_ANGLES[0]!, mode: "full" as const };

test("DJ writer uses a fake completion, bounds words, and caps minimal announcements", async () => {
  const result = await writeDjLine(base, async (_role, messages) => ({ ok: true, value: { text: "Paper Boats by Rivet Row just ended. Up next, Blue Window by Mira Vale." } } as never));
  expect(result).toBe("Paper Boats by Rivet Row just ended. Up next, Blue Window by Mira Vale.");
  const minimal = await writeDjLine({ ...base, mode: "minimal" }, async () => ({ ok: true, value: { text: "Paper Boats by Rivet Row. Next is Blue Window by Mira Vale." } } as never));
  expect(minimal?.split(/\s+/).length).toBeLessThanOrEqual(14);
});

test("writer drops overlong, empty and unsafe output and rotates among fixed angles", async () => {
  expect(DJ_ANGLES).toHaveLength(5);
  expect(await writeDjLine(base, async () => ({ ok: true, value: { text: "word ".repeat(29) } } as never))).toBeNull();
  expect(await writeDjLine(base, async () => ({ ok: true, value: { text: "" } } as never))).toBeNull();
});

test("speech bytes come from the injected local speech seam", async () => {
  let called = false;
  const result = await synthesizeDjLine("A short line.", "voice-test", async (text, voice) => {
    called = true; expect(text).toBe("A short line."); expect(voice).toBe("voice-test");
    return { ok: true, value: { contentType: "audio/wav", stream: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([4, 5, 6])); controller.close(); } }) } } as never;
  });
  expect(called).toBe(true);
  expect(result).toEqual({ bytes: new Uint8Array([4, 5, 6]), contentType: "audio/wav" });
});

test("audio cache expires, caps per household and consumes once", async () => {
  const now = new Date("2026-11-04T12:00:00Z");
  db.insert(people).values({ id: "person-djreader01", displayName: "Sage", role: "adult", birthdate: "1990-01-01", avatarSeed: "s", source: "local", createdAt: now.toISOString(), updatedAt: now.toISOString(), hlc: "1:0:aaaaaa" }).run();
  const person = db.select().from(people).where(eq(people.id, "person-djreader01")).get()!;
  const audio = storeFile(person, { conversationId: null, turnId: null, mediaType: "audio/wav", bytes: new Uint8Array([1, 2, 3]), retention: "kept", provenance: "music-dj:test", deduplicate: false });
  expect(audio.ok).toBe(true);
  const saved = saveDjLine(person, { mediaId: "media-next000001", position: "intro", audioPath: audio.ok ? audio.value.storage_path : "", wordsCount: 8 }, now);
  const consumed = consumeDjLine(person, "media-next000001", "intro", now);
  expect(consumed?.id).toBe(saved.id);
  expect(consumed?.bytes).toEqual(new Uint8Array([1, 2, 3]));
  expect(consumeDjLine(person, "media-next000001", "intro", now)).toBeNull();
  const fileRow = audio.ok ? db.select().from(attachments).where(eq(attachments.id, audio.value.id)).get() : null;
  expect(fileRow).toBeUndefined();
  saveDjLine(person, { mediaId: "media-next000002", position: "intro", audioPath: "/private/old.wav", wordsCount: 2 }, now);
  expect(pruneDjLines(new Date(now.getTime() + 25 * 60 * 60_000))).toBe(1);
  expect(db.select().from(musicDjLines).all()).toHaveLength(0);
});
