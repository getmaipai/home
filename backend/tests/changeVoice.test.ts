import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { child, owner, teen } from "./support/testAuth";
import { db } from "@/db";
import { attachments } from "@/db/schema";
import { eq } from "drizzle-orm";
import { storeFile } from "@/lib/attachments";
import { __resetStackEngineForTests } from "@/lib/stackEngine";
import { installFakeEditStack, type FakeEditStack } from "./videoEditStackFixture";
import { changeVoice } from "@/lib/changeVoice";

let fake: FakeEditStack;
let transcript = "A harmless sentence.";
const add = (actor: Awaited<ReturnType<typeof owner>>["row"], type = "audio/wav") => {
  const result = storeFile(actor, { conversationId: null, turnId: null, mediaType: type, bytes: new Uint8Array(512).fill(3), retention: "kept", name: "Source" });
  if (!result.ok) throw new Error("source setup failed");
  return result.value.id;
};

beforeEach(() => { resetDb(); transcript = "A harmless sentence."; fake = installFakeEditStack(); });
afterEach(() => { fake.restore(); __resetStackEngineForTests(); });

describe("change voice", () => {
  test("stores only the spoken audio and source provenance", async () => {
    const { row } = await owner(); const source = add(row);
    const result = await changeVoice(row, { file_id: source });
    expect(result).toMatchObject({ ok: true, kind_of_source: "audio", engine: "chatterbox-turbo", voice: "default", kind: "preset" });
    if (!result.ok) return;
    const saved = db.select().from(attachments).where(eq(attachments.id, result.file_id)).get()!;
    expect(saved.provenance).toContain(`"source":"${source}"`);
    expect(saved.provenance).toContain('"voice":"default"');
    expect(JSON.stringify(saved)).not.toContain(transcript);
  });

  test("video runs mute then overlay with the source duration", async () => {
    const { row } = await owner(); const source = add(row, "video/mp4"); fake.durationS = 5.5;
    fake.transcribedText = transcript;
    const result = await changeVoice(row, { file_id: source });
    expect(result).toMatchObject({ ok: true, kind_of_source: "video", source_seconds: 5.5 });
    expect(fake.jobs).toHaveLength(2);
    expect(fake.jobs[0]?.input.ops).toEqual([{ op: "mute" }]);
    expect(fake.jobs[1]?.input.ops).toEqual([{ op: "audio_overlay", input: 1, gain_db: 0, clip_gain_db: 0, start_s: 0, duck: false, end_s: 5.5 }]);
  });

  test("refuses minors, other owners, non-media, missing speech, long text, policy refusal and unknown voices", async () => {
    const { row, client } = await owner(); const source = add(row);
    const teenClient = await teen(client); const teenId = (await teenClient.get("/api/auth/me").then((r) => r.json()) as { id: string }).id;
    const childRow = await child(client);
    expect(await changeVoice(childRow.row, { file_id: source })).toMatchObject({ ok: false, status: 403 });
    const teenRow = db.select().from((await import("@/db/schema")).people).where(eq((await import("@/db/schema")).people.id, teenId)).get()!;
    expect(await changeVoice(teenRow as never, { file_id: source })).toMatchObject({ ok: false, status: 403 });
    const other = { ...row, id: `${row.id}-other` };
    expect(await changeVoice(other as never, { file_id: source })).toMatchObject({ ok: false, status: 404 });
    const image = storeFile(row, { conversationId: null, turnId: null, mediaType: "image/png", bytes: new Uint8Array([1, 2]), retention: "kept" });
    if (!image.ok) throw new Error("image setup failed");
    expect(await changeVoice(row, { file_id: image.value.id })).toMatchObject({ ok: false, status: 404 });
    fake.transcribedText = " "; expect(await changeVoice(row, { file_id: source })).toMatchObject({ ok: false, status: 422 });
    fake.transcribedText = "x".repeat(2001); expect(await changeVoice(row, { file_id: source })).toMatchObject({ ok: false, status: 422 });
    fake.transcribedText = "child porn"; expect(await changeVoice(row, { file_id: source })).toMatchObject({ ok: false, status: 403 });
    fake.transcribedText = "Hi"; expect(await changeVoice(row, { file_id: source, voice: "missing" })).toMatchObject({ ok: false, status: 422 });
  });

  test("authenticated route accepts POST /change", async () => {
    const { row, client } = await owner(); const source = add(row);
    const res = await client.post("/api/voiceover/change", { file_id: source });
    expect(res.status).toBe(200); expect(await res.json()).toMatchObject({ kind_of_source: "audio", voice: "default" });
  });
});
