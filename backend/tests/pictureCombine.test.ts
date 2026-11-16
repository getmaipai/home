// Combine pictures: the operation's registration, its gates (it runs through the shared edit path), the engine-sized count, the numbered
// instruction, and a run against the fake picture engine that sends the numbered references and makes a new version.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments, people, settingsValues } from "@/db/schema";
import { storeFile } from "@/lib/attachments";
import { __resetImageEditForTests, __setImageToolsForTests, LIBRARY_PICTURE_LOCKED } from "@/lib/imageEdit";
import { editPictureSpec } from "@/lib/mediaOps/chatSchema";
import { listMediaOps } from "@/lib/mediaOps/registry";
import { studioOperationRows } from "@/lib/mediaOps/studio";
import { COMBINE_DEFAULT_WORDS, COMBINE_EXTRAS_LINE, COMBINE_NEEDS_ONE_LINE, combineInstruction, combinePictureLimit } from "@/lib/pictures/combine";
import { __setPictureStatusForTests, readyStatusForTests } from "@/lib/pictures/ready";
import { __setPicturesFetchForTests } from "@/lib/pictures/stack";
import { __setRoleHealthForTests } from "@/lib/roleHealth";
import { __resetStackEngineForTests, __setStackClientForTests } from "@/lib/stackEngine";
import type { StackImageToolsStatus } from "@/lib/stack/client";
import type { PersonRow } from "@/types";
import { TestClient } from "./client";
import { installFakeImageStack, type FakeImageStack } from "./pictureFixture";
import { resetDb } from "./reset-db";

const READY: StackImageToolsStatus = { state: "idle", phase: null, vision: true, models: { isnet: true, lama: true, esrgan: true }, limits: { upscale_in: 6 }, operations: ["remove_background", "erase", "upscale", "resize"], reason: null };
const ALL_AGES = 'picture-gen:{"v":1,"audience":"all-ages","prompt":"a boat"}';
const ADULT_LOCKED = 'picture-gen:{"v":1,"audience":"adult-only","made_audience":"adult-only","lock":"on","prompt":"a boat"}';
const withLimit = (references: number) => readyStatusForTests({ edit: { generative: true, masked: true, references } });

let sage: TestClient; let sageActor: PersonRow;
function allowPhotos(personId: string) {
  db.insert(settingsValues).values({ scope: `person:${personId}`, key: "chat.photo_uploads", value: "true", hlc: "1:0:test", source: "self", setBy: personId, updatedAt: new Date().toISOString() }).run();
}
async function png(color: number) { return new Uint8Array(await sharp({ create: { width: 120, height: 80, channels: 3, background: { r: color, g: 120, b: 200 } } }).png().toBuffer()); }
let shade = 10;
async function libraryPicture(owner: PersonRow, provenance = ALL_AGES) {
  shade += 20;
  const stored = storeFile(owner, { conversationId: null, turnId: null, mediaType: "image/png", bytes: await png(shade), provenance, retention: "kept", deduplicate: false });
  if (!stored.ok) throw new Error(stored.error);
  return stored.value;
}
const run = (client: TestClient, body: Record<string, unknown>) => client.post("/api/media-ops/picture.combine", body);

beforeEach(async () => {
  resetDb(); __resetImageEditForTests();
  __setImageToolsForTests(READY, true);
  __setRoleHealthForTests({ image: { availability: "ready", reason: null } });
  sage = new TestClient();
  const made = await sage.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  sageActor = db.select().from(people).where(eq(people.id, ((await made.json()) as { person: { id: string } }).person.id)).get()!;
  allowPhotos(sageActor.id);
});
afterEach(() => { __setStackClientForTests(null); __resetStackEngineForTests(); __setImageToolsForTests(undefined); __setPictureStatusForTests(undefined); __setPicturesFetchForTests(null); __setRoleHealthForTests({}); __resetImageEditForTests(); });

describe("the combine instruction and count", () => {
  test("it numbers the pictures and falls back to the default words", () => {
    expect(combineInstruction(2, "")).toBe(`Picture 1 is the one being changed. Picture 2 is added to it. ${COMBINE_DEFAULT_WORDS}`);
    expect(combineInstruction(3, "put the man in the street.")).toBe("Picture 1 is the one being changed. Pictures 2 and 3 are added to it. put the man in the street.");
    expect(combineInstruction(4, undefined)).toContain("Pictures 2, 3 and 4 are added to it.");
  });
  test("the count is the engine's reference count plus the base, never a fixed number", () => {
    expect(combinePictureLimit(withLimit(1))).toBe(2);
    expect(combinePictureLimit(withLimit(3))).toBe(4);
    expect(combinePictureLimit(null)).toBe(2);
  });
});

describe("the combine operation", () => {
  test("it is registered, listed, kept out of the Studio rail and offered to chat", async () => {
    __setPictureStatusForTests(readyStatusForTests());
    const ops = await listMediaOps(sageActor, { input: "picture" });
    expect(ops.find((op) => op.id === "picture.combine")).toMatchObject({ label: "Combine", input: "picture", output: "picture", needs: "image", enabled: true });
    const file = await libraryPicture(sageActor);
    const rows = await studioOperationRows(sageActor, { id: file.id });
    expect(rows.find((row) => row.id === "picture.combine")).toBeUndefined();
    const schema = editPictureSpec("edit_picture", { editPictureAllowed: true, editPictureOps: ops, editPictureIds: [], actor: sageActor } as never)!;
    expect((schema.args.properties as { op: { enum: string[] } }).op.enum).toContain("picture.combine");
    expect(schema.description).toContain("picture.combine");
  });

  test("zero references is refused with one plain line and nothing is sent", async () => {
    __setPictureStatusForTests(withLimit(2));
    const sent: unknown[] = [];
    __setPicturesFetchForTests((async (_i, init) => { sent.push(init?.body); return new Response("{}", { status: 500 }); }) as typeof fetch);
    const file = await libraryPicture(sageActor);
    for (const references of [[], [""]]) {
      const res = await run(sage, { file_id: file.id, args: { references } });
      expect(res.status).toBe(422);
      expect(((await res.json()) as { error: string }).error).toBe(COMBINE_NEEDS_ONE_LINE);
    }
    expect(sent).toHaveLength(0);
  });

  test("a locked reference is refused with the locked line", async () => {
    __setPictureStatusForTests(withLimit(2));
    const file = await libraryPicture(sageActor);
    const locked = await libraryPicture(sageActor, ADULT_LOCKED);
    const res = await run(sage, { file_id: file.id, args: { references: [locked.id] } });
    expect(res.status).toBe(423);
    expect(await res.json()).toEqual({ error: LIBRARY_PICTURE_LOCKED, code: "locked" });
  });

  test("a reference that is not there is refused", async () => {
    __setPictureStatusForTests(withLimit(2));
    const file = await libraryPicture(sageActor);
    expect((await run(sage, { file_id: file.id, args: { references: ["nope"] } })).status).toBe(404);
  });

  describe("with the fake picture engine", () => {
    let fake: FakeImageStack;
    beforeEach(() => { fake = installFakeImageStack(); });
    afterEach(() => { fake.restore(); });
    const capture = () => {
      const forms: FormData[] = [];
      const inner = fake.handler;
      __setPicturesFetchForTests((async (input, init) => { if (init?.body instanceof FormData) forms.push(init.body); return inner(input, init); }) as typeof fetch);
      return forms;
    };

    test("two references at a limit of 3 are both sent, numbered, and the result is a new version", async () => {
      __setPictureStatusForTests(withLimit(3));
      const [base, one, two] = [await libraryPicture(sageActor), await libraryPicture(sageActor), await libraryPicture(sageActor)];
      const forms = capture();
      const res = await run(sage, { file_id: base.id, args: { references: [one.id, two.id], words: "put the man in the street" } });
      expect(res.status).toBe(200);
      const started = (await res.json()) as { state: string; job: string; note?: string };
      expect(started.state).toBe("running");
      expect(started.note).toBeUndefined();
      const form = forms[0]!;
      expect(form.get("reference")).toBeTruthy();
      expect(form.get("reference2")).toBeTruthy();
      expect(String(form.get("instruction"))).toBe("Picture 1 is the one being changed. Pictures 2 and 3 are added to it. put the man in the street.");
      let progress = (await (await sage.get(`/api/media-ops/jobs/${started.job}`)).json()) as { state: string; preview?: { token: string } };
      for (let i = 0; i < 8 && progress.state !== "done"; i += 1) progress = (await (await sage.get(`/api/media-ops/jobs/${started.job}`)).json()) as typeof progress;
      expect(progress.state).toBe("done");
      const before = db.select().from(attachments).all().length;
      const applied = await sage.post(`/api/media-ops/previews/${progress.preview!.token}/apply`, {});
      expect(applied.status).toBe(200);
      expect(((await applied.json()) as { version: { source: string } }).version.source).toBe(base.id);
      expect(db.select().from(attachments).all().length).toBe(before + 1);
    });

    test("at a limit of 1 the extras are dropped and the plain note comes back", async () => {
      __setPictureStatusForTests(withLimit(1));
      const [base, one, two] = [await libraryPicture(sageActor), await libraryPicture(sageActor), await libraryPicture(sageActor)];
      const forms = capture();
      const res = await run(sage, { file_id: base.id, args: { references: [one.id, two.id] } });
      expect(res.status).toBe(200);
      expect(((await res.json()) as { note?: string }).note).toBe(COMBINE_EXTRAS_LINE);
      const form = forms[0]!;
      expect(form.get("reference")).toBeTruthy();
      expect(form.get("reference2")).toBeNull();
      expect(String(form.get("instruction"))).toBe(`Picture 1 is the one being changed. Picture 2 is added to it. ${COMBINE_DEFAULT_WORDS}`);
    });
  });
});
