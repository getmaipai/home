import { describe, expect, test } from "bun:test";
import { DOMParser } from "linkedom";
import { writeEdl, writeFcpxml, writeZip, type NleTimeline } from "@/lib/videos/nleExport";
import { makeStudioNleExport } from "@/lib/videos/studioNleExport";
import { __resetAdultLockForTests, __unlockedForTests, withMark } from "@/lib/adultLock";
import { __resetStudioVoicesForTests } from "@/lib/videos/studioVoices";
import { resetDb } from "./reset-db";
import { testMp4 } from "./videoFixture";
import type { PersonRow } from "@/types";
import { db } from "@/db";
import { people, attachments } from "@/db/schema";
import { eq } from "drizzle-orm";
import { storeFile } from "@/lib/attachments";
import { __setVideoJobForTests } from "@/lib/videos/jobs";

let owner: PersonRow; let child: PersonRow;
const vp = (ref: string, over: Record<string, number> = {}) => ({ ref, in_s: 0, out_s: 2, level_db: 0, fade_in_s: 0, fade_out_s: 0, ...over });
const planOf = (pieces: ReturnType<typeof vp>[]) => ({ version: 1, film_s: 0, video: { level_db: 0, muted: false, pieces, transitions: [] }, voice: { level_db: 0, muted: false, pieces: [] }, music: { level_db: 0, muted: false, pieces: [] } });

const timeline: NleTimeline = { frameRate: 24, clips: [
  { name: "A & <one>", path: "media/a.mp4", in_s: 1, out_s: 3, track: 1, frameRate: 24 },
  { name: "Two", path: "media/b.mp4", in_s: 0, out_s: 1, track: 1, frameRate: 24 },
  { name: "Three", path: "media/c.mp4", in_s: 2, out_s: 4, track: 1, frameRate: 24 },
] };

describe("NLE timeline export", () => {
  test("writes numbered 24 fps EDL events with exact timecodes", () => {
    expect(writeEdl(timeline)).toContain("001  AX       V     C        00:00:01:00 00:00:03:00 00:00:00:00 00:00:02:00\n* FROM CLIP NAME: media/a.mp4");
    expect(writeEdl(timeline)).toContain("003  AX       V     C        00:00:02:00 00:00:04:00 00:00:03:00 00:00:05:00");
  });
  test("writes escaped FCPXML with asset clips, offsets and durations", () => {
    const xml = writeFcpxml(timeline); const doc = new DOMParser().parseFromString(xml, "text/xml"); const clips = [...doc.querySelectorAll("asset-clip")];
    expect(clips).toHaveLength(3); expect(clips[0]?.getAttribute("name")).toBe("A &amp; &lt;one&gt;");
    expect(clips[0]?.getAttribute("offset")).toBe("0/24s"); expect(clips[0]?.getAttribute("duration")).toBe("48/24s");
    expect(xml).toContain("A &amp; &lt;one&gt;");
  });
  test("zip contains the requested manifest and source files", () => {
    const bytes = writeZip([{ name: "Studio.edl", bytes: new TextEncoder().encode("edl") }, { name: "media/a.mp4", bytes: new Uint8Array([1, 2, 3]) }]);
    const names = new TextDecoder().decode(bytes);
    expect(names).toContain("Studio.edl"); expect(names).toContain("media/a.mp4");
  });
  test("Studio timeline README lists each title with its range and position", async () => {
    resetDb(); __resetAdultLockForTests(); __resetStudioVoicesForTests();
    const makePerson = (role: string, name: string) => { const now = new Date().toISOString(); const id = `person-nle${name}`; db.insert(people).values({ id, displayName: name, role, avatarSeed: name, source: "local", createdAt: now, updatedAt: now, hlc: "1:0:test" }).run(); return db.select().from(people).all().find((p) => p.id === id)! as PersonRow; };
    const actor = makePerson("owner", "readme"); const made = storeFile(actor, { conversationId: null, turnId: null, mediaType: "video/mp4", bytes: testMp4(), provenance: "video-gen:{}", retention: "kept" });
    if (!made.ok) throw new Error(made.error);
    __setVideoJobForTests({ id: "nle-readme", personId: actor.id, conversationId: null, turnId: null, companionId: null, kind: "generate", state: "done", stackJob: null, percent: 100, phase: "ready", position: null, prompt: "Clip", request: { size: "832x480", seconds: 2, seed: null, loras: [], source_file_id: null, audience: "all-ages", stackBody: {} }, error: null, files: [{ id: made.value.id, mediaType: "video/mp4", seconds: 2, width: 832, height: 480 }], temporary: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as never);
    const result = await makeStudioNleExport(actor, { plan: { ...planOf([vp(made.value.id)]), titles: [{ text: "Hello", from_s: 0.5, to_s: 1.5, position: "middle" }] } });
    if (!result.ok) throw new Error("NLE export refused");
    const zip = result.bytes; let offset = 0; let readme = "";
    while (offset + 30 < zip.length && new DataView(zip.buffer, zip.byteOffset + offset).getUint32(0, true) === 0x04034b50) {
      const view = new DataView(zip.buffer, zip.byteOffset + offset); const size = view.getUint32(18, true); const nameLength = view.getUint16(26, true); const extraLength = view.getUint16(28, true);
      const name = new TextDecoder().decode(zip.subarray(offset + 30, offset + 30 + nameLength)); const start = offset + 30 + nameLength + extraLength;
      if (name === "README.txt") readme = new TextDecoder().decode(zip.subarray(start, start + size));
      offset = start + size;
    }
    expect(readme).toContain("0.5-1.5s, middle, Hello");
  });
  test("uses existing Studio gates and carries the strictest mark", async () => {
    resetDb(); __resetAdultLockForTests(); __resetStudioVoicesForTests();
    const makePerson = (role: string, name: string) => { const now = new Date().toISOString(); const id = `person-nle${name}`; db.insert(people).values({ id, displayName: name, role, avatarSeed: name, source: "local", createdAt: now, updatedAt: now, hlc: "1:0:test" }).run(); return db.select().from(people).all().find((p) => p.id === id)! as PersonRow; };
    const owner = makePerson("owner", "owner"); const child = makePerson("child", "child");
    const makeFile = (n: number, audience: "all-ages" | "adult-only") => {
      const made = storeFile(owner, { conversationId: null, turnId: null, mediaType: "video/mp4", bytes: testMp4(), provenance: `video-gen:{"audience":"${audience}"}`, retention: "kept" });
      if (!made.ok) throw new Error(made.error);
      __setVideoJobForTests({ id: `nle-job-${n}`, personId: owner.id, conversationId: null, turnId: null, companionId: null, kind: "generate", state: "done", stackJob: null, percent: 100, phase: "ready", position: null, prompt: `Clip ${n}`, request: { size: "832x480", seconds: 2, seed: null, loras: [], source_file_id: null, audience, stackBody: {} }, error: null, files: [{ id: made.value.id, mediaType: "video/mp4", seconds: 2, width: 832, height: 480 }], temporary: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as never);
      return made.value.id;
    };
    const a = makeFile(1, "all-ages"); const b = makeFile(2, "adult-only");
    const row = db.select().from(attachments).where(eq(attachments.id, b)).get()!; const marked = withMark(row.provenance, { lock: "on", raiseToAdult: true }); if (marked) db.update(attachments).set({ provenance: marked }).where(eq(attachments.id, b)).run();
    const payload = { plan: planOf([vp(a), vp(b)]) };
    const refused = await makeStudioNleExport(child, payload); expect(refused).toMatchObject({ ok: false, status: 403 });
    const exported = await __unlockedForTests(owner.id, () => makeStudioNleExport(owner, payload));
    if (!exported.ok) throw new Error(JSON.stringify(exported)); expect(exported.ok).toBe(true);
    if (exported.ok) expect(exported.mark).toEqual({ madeAudience: "adult-only", lock: "on" });
  });
});
