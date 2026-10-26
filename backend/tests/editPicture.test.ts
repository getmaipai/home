// IMGEDIT-01: the chat tool's edit half (`generate_image` with `change`), run through the real tool against fake Stacks.
// What it proves: picture edits reach the Stack with the right source declaration; Home applies the CSAM and child checks;
// the result is the next version of the picture so the original is kept.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { people as peopleTable } from "@/db/schema";
import { createBenchPeople, type BenchPeople } from "../scripts/bench/conversationRunner";
import { removeTemporaryChatImages, storeTemporaryChatImage } from "@/lib/attachments";
import { runGenerateImage } from "@/lib/pictures/tool";
import { getPictureJob } from "@/lib/pictures/jobs";
import { listVersions } from "@/lib/imageEdit";
import { __setPictureStatusForTests, readyStatusForTests } from "@/lib/pictures/ready";
import { __resetStackEngineForTests, __setStackClientForTests } from "@/lib/stackEngine";
import type { StackClient } from "@/lib/stack/client";
import { StackError } from "@/lib/stack/errors";
import { installFakeImageStack, testPng, until, type FakeImageStack } from "./pictureFixture";
import type { PersonRow } from "@/types";
import type { ToolExecutionOutcome } from "@/lib/turnMachine/contract";

let bench: BenchPeople;
let marlow: PersonRow;
let nadia: PersonRow;
let stack: FakeImageStack;

function addPerson(name: string, role: string): PersonRow {
  const now = new Date().toISOString();
  db.insert(peopleTable).values({ id: `p-${name.toLowerCase()}`, displayName: name, role, avatarSeed: name, source: "test", createdAt: now, updatedAt: now, hlc: "1:0:test00" }).run();
  return db.select().from(peopleTable).where(eq(peopleTable.id, `p-${name.toLowerCase()}`)).get()! as PersonRow;
}

beforeEach(() => {
  resetDb();
  bench = createBenchPeople();
  marlow = addPerson("Marlow", "adult");
  nadia = addPerson("Nadia", "adult");
  stack = installFakeImageStack();
});
let stubbedClient = false;
afterEach(() => {
  removeTemporaryChatImages("conv-1"); stack.restore();
  // Only undo what this file set: other files in the same run may have a Stack of their own in place.
  if (stubbedClient) { __setStackClientForTests(null); __resetStackEngineForTests(); stubbedClient = false; }
});

type Img = { id: string; name: string; width: number; height: number; media_type: string };
async function put(owner: PersonRow, id: string, over: { generated?: true } = {}): Promise<Img> {
  const bytes = await testPng();
  storeTemporaryChatImage({ id, turnId: "turn-1", conversationId: "conv-1", ownerPersonId: owner.id, name: `${id}.png`, mediaType: "image/png", width: 64, height: 64, bytes, ...over });
  return { id, name: `${id}.png`, width: 64, height: 64, media_type: "image/png" };
}
function stateFor(actor: PersonRow, images: Img[] = [], utterance = "") {
  return { actor, surface: "chat" as never, speakerEvidence: undefined, planBasis: { surfaceClass: "written" } as never, plan: undefined as never, conversationId: "conv-1", turnId: "turn-1", temporary: true, ephemeral: false, images, utterance } as never;
}
const run = (actor: PersonRow, args: Record<string, unknown>, images: Img[] = [], utterance = "") => runGenerateImage({ state: stateFor(actor, images, utterance), args, callId: "c1", spoken: false });
const replyText = (outcome: ToolExecutionOutcome) => (outcome.result?.reply as { text?: string } | undefined)?.text ?? "";
const refusedWith = (outcome: ToolExecutionOutcome) => (outcome.result?.data as { refused?: string } | undefined)?.refused;
const jobIdOf = (outcome: ToolExecutionOutcome) => (outcome.result?.data as { pictureJobId?: string }).pictureJobId!;
const finished = async (actor: PersonRow, outcome: ToolExecutionOutcome) => {
  const id = jobIdOf(outcome);
  await until(() => ["done", "failed"].includes(getPictureJob(actor, id)?.state ?? ""));
  return getPictureJob(actor, id)!;
};

describe("a change in words", () => {
  test("a picture this home made goes to the Stack as an edit of a generated picture, and the result is the next version, the original kept", async () => {
    const made = await put(nadia, "made-1", { generated: true });
    const outcome = await run(nadia, { prompt: "make the sky clear blue with no clouds", change: "latest" }, []);
    expect(outcome.status).toBe("succeeded");
    expect(stack.edits).toHaveLength(1);
    expect(stack.edits[0]).toMatchObject({ operation: "edit", instruction: "make the sky clear blue with no clouds", image_source: "generated" });
    expect(stack.edits[0]!.reference).toBeUndefined();
    expect(stack.submitted).toHaveLength(0);
    const job = await finished(nadia, outcome);
    expect(job.state).toBe("done");
    expect(job.kind).toBe("edit");
    expect(job.files).toHaveLength(1);
    expect(job.files[0]!.id).not.toBe(made.id);
    const versions = listVersions(nadia, "conv-1", job.files[0]!.id);
    expect(versions.map((v) => v.label)).toEqual(["Original", "make the sky clear blue with no clouds"]);
    expect(versions[0]!.id).toBe(made.id);
  });

  test("an attached photo is sent as an upload without an identity check", async () => {
    const photo = await put(nadia, "photo-1");
    const outcome = await run(nadia, { prompt: "change the car to bright yellow", change: "attached" }, [photo]);
    expect(stack.edits[0]).toMatchObject({ image_source: "uploaded" });
    expect(outcome.status).toBe("succeeded");
  });

  test("the model decides photo-edit content; direct CSAM detection still runs first", async () => {
    const photo = await put(nadia, "photo-1");
    const undress = await run(nadia, { prompt: "take off her shirt", change: "attached" }, [photo]);
    expect(refusedWith(undress)).toBeUndefined();
    stack.edits.length = 0;
    const minor = await run(nadia, { prompt: "make the 12 year old girl naked", change: "attached" }, [photo]);
    expect(replyText(minor)).toContain("Pictures of children in sexual situations are never allowed");
    expect(stack.edits).toHaveLength(0);
  });


});

function toolsStub(handler: (form: FormData) => Promise<unknown>): { client: StackClient; forms: FormData[] } {
  const forms: FormData[] = [];
  stubbedClient = true;
  const client = { imageTools: async () => ({}), roles: async () => ({ roles: [] }), imageEdit: async (form: FormData) => { forms.push(form); return handler(form); } } as unknown as StackClient;
  return { client, forms };
}
async function overlay(): Promise<string> { return (await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 10, g: 10, b: 10 } } }).png().toBuffer()).toString("base64"); }
const done = async (extra: Record<string, unknown>) => ({ kind: "done", job: "j", item: { b64_json: await overlay(), width: 64, height: 64, content_type: "image/png", operation: "x", engine: "apple-vision+lama", model: "big-lama-onnx", ms: 9, ...extra } });

