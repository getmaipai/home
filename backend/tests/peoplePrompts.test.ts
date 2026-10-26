// Adult real-person and likeness requests pass through Home; CSAM checks and child-lane rules remain in effect.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { people as peopleTable } from "@/db/schema";
import { setHouseholdSettingValue } from "@/lib/settings";
import { createBenchPeople, type BenchPeople } from "../scripts/bench/conversationRunner";
import { removeTemporaryChatImages, storeTemporaryChatImage } from "@/lib/attachments";
import { runGenerateImage } from "@/lib/pictures/tool";
import { runGenerateVideo } from "@/lib/videos/tool";
import { __setStackClientForTests, __resetStackEngineForTests } from "@/lib/stackEngine";
import { installFakeImageStack, testPng, until, type FakeImageStack } from "./pictureFixture";
import { installFakeVideoStack, type FakeVideoStack } from "./videoFixture";
import { eq } from "drizzle-orm";
import type { PersonRow } from "@/types";
import type { ToolExecutionOutcome } from "@/lib/turnMachine/contract";

let bench: BenchPeople;
let marlow: PersonRow;
let nadia: PersonRow;
let child: PersonRow;
let image: FakeImageStack;
let video: FakeVideoStack;

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
  child = addPerson("Pippa", "child");
  image = installFakeImageStack();
  video = installFakeVideoStack();
});
afterEach(() => { removeTemporaryChatImages("conv-1"); image.restore(); video.restore(); __setStackClientForTests(null); __resetStackEngineForTests(); });

type Img = { id: string; name: string; width: number; height: number; media_type: string };
async function put(owner: PersonRow, id: string): Promise<Img> {
  storeTemporaryChatImage({ id, turnId: "turn-1", conversationId: "conv-1", ownerPersonId: owner.id, name: `${id}.png`, mediaType: "image/png", width: 64, height: 64, bytes: await testPng() });
  return { id, name: `${id}.png`, width: 64, height: 64, media_type: "image/png" };
}
function stateFor(actor: PersonRow, images: Img[] = [], utterance = "") {
  return { actor, surface: "chat" as never, speakerEvidence: undefined, planBasis: { surfaceClass: "written" } as never, plan: undefined as never, conversationId: "conv-1", turnId: `turn-${Math.random()}`, temporary: true, ephemeral: false, images, utterance } as never;
}
const pic = (actor: PersonRow, args: Record<string, unknown>, images: Img[] = [], utterance = "") => runGenerateImage({ state: stateFor(actor, images, utterance), args, callId: "c1", spoken: false });
const vid = (actor: PersonRow, args: Record<string, unknown>, images: Img[] = [], utterance = "") => runGenerateVideo({ state: stateFor(actor, images, utterance), args, callId: "c2", spoken: false });
const text = (o: ToolExecutionOutcome) => (o.result?.reply as { text?: string } | undefined)?.text ?? "";

describe("adult media requests", () => {
  test("CSAM requests remain blocked while real-person requests pass through", async () => {
    expect(text(await pic(nadia, { prompt: "a naked child on a beach" }))).toContain("never allowed");
    expect(text(await pic(nadia, { prompt: "a portrait of a famous senator" }))).not.toContain("No picture was made");
  });

  test("adult media edits and video can use an attached photo without a Home identity check", async () => {
    const photo = await put(nadia, "photo-1");
    const edit = await pic(nadia, { prompt: "change her dress to red", change: "attached" }, [photo]);
    expect(edit.status).toBe("succeeded");
    expect(image.edits[0]).toMatchObject({ image_source: "uploaded", operation: "edit" });
    const videoResult = await vid(nadia, { prompt: "she waves", from_picture: "attached" }, [photo]);
    expect(videoResult.status).toBe("succeeded");
  });
});
