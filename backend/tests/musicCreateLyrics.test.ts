import { afterEach, beforeEach, describe, expect, test, spyOn } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people } from "@/db/schema";
import * as llm from "@/lib/llm";
import { getMusicJobFor } from "@/lib/music/jobs";
import { installFakeMusicStack } from "./musicFixture";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";

let fake: ReturnType<typeof installFakeMusicStack>;
let completeSpy: ReturnType<typeof spyOn>;
beforeEach(() => { resetDb(); fake = installFakeMusicStack(); });
afterEach(() => { fake.restore(); completeSpy?.mockRestore(); });
async function owner() {
  const client = new TestClient();
  expect((await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" })).status).toBe(201);
  return { client, actor: db.select().from(people).where(eq(people.displayName, "Sage")).get()! };
}
const generated = "[Verse]\nRain taps softly on the pane\nWe make a boat and name the rain\n[Chorus]\nSail, little paper boat, sail\nFollow the silver stream and sail";
function model(text = generated) {
  completeSpy = spyOn(llm, "complete").mockImplementation(async () => ({ ok: true, value: { text, model: "test" } }) as never);
}
async function make(client: TestClient, body: Record<string, unknown>) { return client.post("/api/music/songs", { idea: "a gentle song about rain", ...body }); }

describe("Create writes missing lyrics", () => {
  test("writes and sends lyrics when the field is blank", async () => {
    model(); const { client, actor } = await owner();
    const response = await make(client, { lyrics: "  " });
    expect(response.status).toBe(201); expect(completeSpy).toHaveBeenCalledTimes(1);
    const card = await response.json() as { id: string };
    expect(getMusicJobFor(actor, card.id)?.request.lyrics).toBe(generated);
  });
  test("keeps typed lyrics unchanged without calling the writer", async () => {
    model(); const { client, actor } = await owner(); const lyrics = "[Verse]\nTyped words\n[Chorus]\nTyped hook";
    const response = await make(client, { lyrics }); const card = await response.json() as { id: string };
    expect(response.status).toBe(201); expect(completeSpy).not.toHaveBeenCalled(); expect(getMusicJobFor(actor, card.id)?.request.lyrics).toBe(lyrics);
  });
  test("does not write lyrics for an instrumental", async () => {
    model(); const { client, actor } = await owner(); const response = await make(client, { instrumental: true });
    const card = await response.json() as { id: string };
    expect(response.status).toBe(201); expect(completeSpy).not.toHaveBeenCalled(); expect(getMusicJobFor(actor, card.id)?.request.instrumental).toBe(true);
    expect(fake.submitted.at(-1)?.lyrics).toBe("[Instrumental]");
  });
  test("model failure still creates a song without lyrics", async () => {
    completeSpy = spyOn(llm, "complete").mockImplementation(async () => ({ ok: false, error: { code: "offline" } }) as never);
    const { client, actor } = await owner(); const response = await make(client, {}); const card = await response.json() as { id: string };
    expect(response.status).toBe(201); expect(getMusicJobFor(actor, card.id)?.request.lyrics).toBeUndefined();
  });
  test("refused generated lyrics still create the song without words", async () => {
    model("[Verse]\nA sexual song about children"); const { client, actor } = await owner();
    const response = await make(client, {}); const card = await response.json() as { id: string };
    expect(response.status).toBe(201); expect(getMusicJobFor(actor, card.id)?.request.lyrics).toBeUndefined();
  });
});
