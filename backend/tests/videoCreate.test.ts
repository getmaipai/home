// VIDEO-CREATE-01 (V1a, docs/design/video-create-2026-11-01.md): Make a video from words on the Create page. Adults on their own screen only
// (rule 0); one generation definition (runGenerateVideo, shared with the chat tool); the recipe list is one list served as package data;
// the clip is a kept Library file with no chat behind it; the three Create pages are invisible and refused below adult.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import { db } from "@/db";
import { attachments } from "@/db/schema";
import { getVideoJobFor } from "@/lib/videos/jobs";
import { VIDEO_RECIPES, videoRecipeFor, withVideoRecipe } from "@/lib/videos/recipes";
import { MAX_NEEDS_ADMIN_LINE } from "@/lib/tiers";
import { __resetVideoAdapterCacheForTests } from "@/lib/videos/adapters";
import { installFakeVideoStack, type FakeVideoStack } from "./videoFixture";
import { until } from "./pictureFixture";
import type { PersonRow } from "@/types";
import { people as peopleTable } from "@/db/schema";

let fake: FakeVideoStack;
beforeEach(() => { resetDb(); __resetVideoAdapterCacheForTests(); fake = installFakeVideoStack(); });
afterEach(() => { fake.restore(); });

async function household() {
  const owner = new TestClient();
  await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const signIn = async (displayName: string, role: string, extra: Record<string, unknown> = {}) => {
    const made = await owner.post("/api/people", { displayName, role, secret: "0000", ...extra });
    const created = (await made.json()) as { id: string };
    const client = new TestClient();
    await client.post("/api/auth/verify-secret", { personId: created.id, secret: "0000" });
    return { client, id: created.id };
  };
  const adult = await signIn("Marlow", "adult");
  const teen = await signIn("Nova", "teen", { birthdate: "2011-03-01" });
  const child = await signIn("Sprout", "child", { birthdate: "2018-03-01" });
  const ownerRow = db.select().from(peopleTable).where(eq(peopleTable.displayName, "Sage")).get()! as PersonRow;
  return { owner, ownerRow, adult, teen, child };
}
const BOAT = "A paper boat floats down a rainy street, soft evening light";

describe("recipes: one list in one place", () => {
  test("about eight, each with an id, a label and wording; found by id or label; appended after the words", () => {
    expect(VIDEO_RECIPES.length).toBe(8);
    expect(new Set(VIDEO_RECIPES.map((r) => r.id)).size).toBe(8);
    expect(videoRecipeFor("Slow orbit")?.id).toBe("slow-orbit");
    expect(videoRecipeFor("dolly-in")?.label).toBe("Dolly in");
    expect(videoRecipeFor("nonsense")).toBeNull();
    const dolly = videoRecipeFor("dolly-in")!;
    expect(withVideoRecipe("a quiet lake.", dolly)).toBe(`a quiet lake. ${dolly.wording}.`);
    expect(withVideoRecipe("a quiet lake", null)).toBe("a quiet lake");
  });
  test("the package serves the list as data to an adult and not to a child or teen", async () => {
    const { adult, teen, child } = await household();
    const rows = await (await adult.client.post("/api/plugins/videos/data/recipes", {})).json() as Array<{ id: string; label: string; hint: string }>;
    expect(rows.map((r) => r.id)).toEqual(VIDEO_RECIPES.map((r) => r.id));
    expect(rows[0]).toEqual({ id: "dolly-in", label: "Dolly in", hint: expect.any(String) });
    for (const other of [teen, child]) expect((await other.client.post("/api/plugins/videos/data/recipes", {})).status).toBe(404);
    const starters = await (await adult.client.post("/api/plugins/videos/data/recipes", { scope: "starters" })).json() as unknown[];
    expect(starters).toHaveLength(3);
  });
});

describe("POST /api/videos/make", () => {
  test("a child and a teen are refused with a plain line and nothing reaches the Stack", async () => {
    const { teen, child } = await household();
    for (const who of [child, teen]) {
      const res = await who.client.post("/api/videos/make", { prompt: BOAT });
      expect(res.status).toBe(403);
      const body = await res.json() as { error: string };
      expect(body.error).toContain("adult");
    }
    expect(fake.submitted).toHaveLength(0);
  });

  test("an adult starts a clip from words: the card is returned, the recipe wording goes to the Stack and not onto the card, portrait changes the size", async () => {
    const { adult } = await household();
    const res = await adult.client.post("/api/videos/make", { prompt: BOAT, orientation: "portrait", recipe: "dolly-in" });
    expect(res.status).toBe(200);
    const card = await res.json() as { id: string; conversation_id: string | null; items: Array<{ id: string; prompt: string; state: string }> };
    expect(card.conversation_id).toBeNull();
    expect(card.items[0]!.prompt).toBe(BOAT);
    expect(fake.submitted).toHaveLength(1);
    const sent = fake.submitted[0]!;
    expect(String(sent.prompt)).toStartWith(BOAT);
    expect(String(sent.prompt)).toContain(videoRecipeFor("dolly-in")!.wording);
    expect(sent.size).toBe("480x832");
    expect(sent.audience).toBe("adult");
    // While it is made the Make page lists it; when it finishes it is a kept Library file the person can open.
    const actor = db.select().from(peopleTable).where(eq(peopleTable.id, (await (await adult.client.get("/api/auth/me")).json() as { id: string }).id)).get()! as PersonRow;
    await until(() => getVideoJobFor(actor, card.id)?.state === "done");
    const job = getVideoJobFor(actor, card.id)!;
    const clip = db.select().from(attachments).where(eq(attachments.id, job.files[0]!.id)).get()!;
    expect(clip.retention).toBe("kept");
    expect(clip.conversationId).toBeNull();
    expect(clip.provenance.startsWith("video-gen:")).toBe(true);
    const file = await adult.client.get(`/api/videos/jobs/${card.id}/files/${job.files[0]!.id}`);
    expect(file.status).toBe(200);
    expect((await adult.client.post("/api/plugins/videos/data/recipes", { scope: "making" }).then((r) => r.json())) as unknown[]).toEqual([]);
    const made = await (await adult.client.post("/api/plugins/videos/data/made-at-home", { limit: 200 })).json() as Array<{ id: string }>;
    expect(made.map((r) => r.id)).toContain(clip.id);
  });

  test("a clip being made shows on the making list with a plain status", async () => {
    const { adult } = await household();
    fake.pollsToFinish = 1000;
    await adult.client.post("/api/videos/make", { prompt: BOAT });
    const rows = await (await adult.client.post("/api/plugins/videos/data/recipes", { scope: "making" })).json() as Array<{ title: string; status: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toBe(BOAT);
    expect(rows[0]!.status.length).toBeGreaterThan(5);
  });

  test("a second clip while one is being made is refused with the Stack's own plain line", async () => {
    const { adult } = await household();
    fake.pollsToFinish = 1000;
    expect((await adult.client.post("/api/videos/make", { prompt: BOAT })).status).toBe(200);
    const again = await adult.client.post("/api/videos/make", { prompt: BOAT });
    expect(again.status).toBe(422);
    expect((await again.json() as { error: string }).error).toContain("already have a video");
  });

  test("Max without an admin's OK is refused with one plain line; Standard and Boost go through", async () => {
    const { adult } = await household();
    const refused = await adult.client.post("/api/videos/make", { prompt: BOAT, tier: "max" });
    expect(refused.status).toBe(422);
    expect((await refused.json() as { error: string }).error).toBe(MAX_NEEDS_ADMIN_LINE);
    expect(fake.submitted).toHaveLength(0);
    expect((await adult.client.post("/api/videos/make", { prompt: BOAT, tier: "standard" })).status).toBe(200);
  });

  test("words that are too short are refused; a Stack that refuses the job later shows its plain reason on the making list", async () => {
    const { adult } = await household();
    expect((await adult.client.post("/api/videos/make", { prompt: "hi" })).status).toBe(400);
    fake.refuseSubmit = { status: 422, code: "unsupported", error: "That size is not supported." };
    expect((await adult.client.post("/api/videos/make", { prompt: BOAT })).status).toBe(200);
    let rows: Array<{ state: string; status: string }> = [];
    for (let i = 0; i < 80 && rows[0]?.state !== "failed"; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      rows = await (await adult.client.post("/api/plugins/videos/data/recipes", { scope: "making" })).json() as typeof rows;
    }
    expect(rows[0]?.state).toBe("failed");
    expect(rows[0]!.status.length).toBeGreaterThan(10);
  });
});

describe("the Make a video page's pickers and action", () => {
  test("the echo row carries the page's choices to the action; the pickers list what this person may use", async () => {
    const { adult } = await household();
    const post = async (body: Record<string, unknown>) => (await adult.client.post("/api/plugins/videos/data/recipes", body)).json() as Promise<any>;
    expect(await post({ scope: "make" })).toEqual([]);
    expect(await post({ scope: "make", prompt: "hi" })).toEqual([]);
    const [row] = await post({ scope: "make", prompt: BOAT, orientation: "portrait", seconds: "10", tier: "boost", recipe: "aerial" });
    expect(row).toMatchObject({ prompt: BOAT, orientation: "portrait", seconds: "10", tier: "boost", recipe: "aerial", title: "Make this video" });
    expect(row.summary).toBe("Portrait, 10 seconds, Boost level, Aerial");
    const options = await post({ scope: "options" });
    expect(options.rows.map((r: { id: string }) => r.id)).toEqual(VIDEO_RECIPES.map((r) => r.id));
    const tiers = await post({ scope: "tiers" });
    expect(tiers.rows.map((r: { label: string }) => r.label)).not.toContain("Max");
    expect(tiers.rows[0]).toEqual({ id: "standard", label: "Standard" });
  });

  test("untouched fields arrive as {name} and mean not given; a typed shape, length and recipe name are used", async () => {
    const { adult } = await household();
    const res = await adult.client.post("/api/plugins/videos/actions/make", { prompt: BOAT, orientation: "{orientation}", seconds: "{seconds}", tier: "{tier}", recipe: "Slow orbit" });
    expect(res.status).toBe(200);
    expect(fake.submitted[0]!.size).toBe("832x480");
    expect(String(fake.submitted[0]!.prompt)).toContain(videoRecipeFor("slow-orbit")!.wording);
  });
  test("an unknown shape or camera move is a plain 422, and a child or teen cannot reach the action", async () => {
    const { adult, teen, child } = await household();
    const bad = await adult.client.post("/api/plugins/videos/actions/make", { prompt: BOAT, orientation: "sideways" });
    expect(bad.status).toBe(422);
    expect((await bad.json() as { error: string }).error).toContain("landscape or portrait");
    expect((await adult.client.post("/api/plugins/videos/actions/make", { prompt: BOAT, recipe: "spin" })).status).toBe(422);
    for (const other of [teen, child]) expect((await other.client.post("/api/plugins/videos/actions/make", { prompt: BOAT })).status).toBe(404);
    expect(fake.submitted).toHaveLength(0);
  });
});

describe("Create is adult-only; Browse is unchanged", () => {
  const appRow = async (client: TestClient) => ((await (await client.get("/api/apps")).json()) as Array<Record<string, any>>).find((row) => row.package === "videos")!;
  test("the create group, the Create header mode and the three pages are gone below adult", async () => {
    const { adult, teen, child } = await household();
    const adultApp = await appRow(adult.client);
    expect(adultApp.sidebar.groups.map((g: { id: string }) => g.id)).toEqual(["play", "create"]);
    expect(adultApp.sidebar.groups.find((g: { id: string }) => g.id === "create").pages.map((p: { page: string }) => p.page)).toEqual(["create", "make-video", "creations"]);
    expect(adultApp.header.modes.map((m: { id: string }) => m.id)).toEqual(["play", "create"]);
    for (const other of [teen, child]) {
      const row = await appRow(other.client);
      expect(row.sidebar.groups.map((g: { id: string }) => g.id)).toEqual(["play"]);
      expect(row.sidebar.groups[0].pages.map((p: { page: string }) => p.page)).toEqual(["index", "library", "history", "watch-later"]);
      expect(row.header.modes.map((m: { id: string }) => m.id)).toEqual(["play"]);
      for (const page of ["create", "make-video", "creations"]) expect((await other.client.get(`/api/plugins/videos/pages/${page}`)).status).toBe(404);
      expect((await other.client.get("/api/plugins/videos/pages/index")).status).toBe(200);
    }
    for (const page of ["create", "make-video", "creations"]) expect((await adult.client.get(`/api/plugins/videos/pages/${page}`)).status).toBe(200);
  });
});
