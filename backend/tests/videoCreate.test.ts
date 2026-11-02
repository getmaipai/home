// VIDEO-CREATE-01 (V1a, docs/design/video-create-2026-11-01.md): Make a video from words on the Create page. Adults on their own screen only
// (rule 0); one generation definition (runGenerateVideo, shared with the chat tool); the recipe list is one list served as package data;
// the clip is a kept Library file with no chat behind it; the three Create pages are invisible and refused below adult.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import { db } from "@/db";
import { attachments, videoJobs } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import { getVideoJobFor } from "@/lib/videos/jobs";
import { VIDEO_LOOKS, VIDEO_STARTERS, VIDEO_VOICES, VIDEO_RECIPES, videoLookFor, videoRecipeFor, withVideoLook, withVideoRecipe, withVideoVoices, videoVoicesFor } from "@/lib/videos/recipes";
import { MAX_NEEDS_ADMIN_LINE, allowedQuality, maxOffered } from "@/lib/tiers";
import { speakerAgeBand } from "@/lib/ageBand";
import { QUICK_MAX_SECONDS, DETAILED_MAX_SECONDS } from "@/lib/videos/quality";
import { videoTierSegment } from "@/lib/media/videoCreateApp";
import { __resetVideoAdapterCacheForTests } from "@/lib/videos/adapters";
import { installFakeVideoStack, type FakeVideoStack } from "./videoFixture";
import { __setStackClientForTests } from "@/lib/stackEngine";
import { __setVideoStatusForTests, dropVideoStatusCache, readyVideoStatusForTests } from "@/lib/videos/ready";
import { until } from "./pictureFixture";
import type { PersonRow } from "@/types";
import sharp from "sharp";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { storeFile } from "@/lib/attachments";
import { __setAgeCheckRunnerForTests } from "@/lib/pictures/ageCheck";
import { PACKAGES_DIR } from "@/lib/paths";
import { people as peopleTable } from "@/db/schema";

let fake: FakeVideoStack;
beforeEach(() => { resetDb(); __resetVideoAdapterCacheForTests(); fake = installFakeVideoStack(); });
afterEach(() => { fake.restore(); __setVideoStatusForTests(undefined); });

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
/** The prompt bar sits in the aside of the page's split view (VIDEO-CREATE-02). */
function promptBarOf(body: Array<Record<string, any>>): Record<string, any> | undefined {
  for (const node of body) {
    if (node.type === "prompt_bar") return node;
    const hit = promptBarOf([...(node.main ?? []), ...(node.aside ?? [])]);
    if (hit) return hit;
  }
  return undefined;
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
    // VIDEO-UI-06: the scopes of the three old pages are gone (the feed replaced them); an unknown scope answers nothing.
    for (const scope of ["starters", "making", "last", "newest", "nonsense"]) expect(await (await adult.client.post("/api/plugins/videos/data/recipes", { scope })).json()).toEqual([]);
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
    const feed = await (await adult.client.post("/api/plugins/videos/data/recipes", { scope: "feed" })).json() as Array<Record<string, any>>;
    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({ id: card.id, prompt: BOAT, status: "ready", state: "done", percent: 100, favorite: false, phase: null, error: null });
    expect(feed[0]!.src).toBe(`/api/videos/jobs/${card.id}/files/${clip.id}`);
    expect(feed[0]!.still).toContain(`/api/videos/jobs/${card.id}/files/`);
    const made = await (await adult.client.post("/api/plugins/videos/data/made-at-home", { limit: 200 })).json() as Array<{ id: string }>;
    expect(made.map((r) => r.id)).toContain(clip.id);
  });

  test("a clip being made is the newest feed row with a plain status line", async () => {
    const { adult } = await household();
    fake.pollsToFinish = 1000;
    await adult.client.post("/api/videos/make", { prompt: BOAT });
    const rows = await (await adult.client.post("/api/plugins/videos/data/recipes", { scope: "feed" })).json() as Array<{ prompt: string; status: string; phase: string; src: string | null }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.prompt).toBe(BOAT);
    expect(["queued", "generating"]).toContain(rows[0]!.status);
    expect(rows[0]!.phase.length).toBeGreaterThan(5);
    expect(rows[0]!.src).toBeNull();
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

  test("words that are too short are refused; a Stack that refuses the job later shows its plain reason on the feed row", async () => {
    const { adult } = await household();
    expect((await adult.client.post("/api/videos/make", { prompt: "hi" })).status).toBe(400);
    fake.refuseSubmit = { status: 422, code: "unsupported", error: "That size is not supported." };
    expect((await adult.client.post("/api/videos/make", { prompt: BOAT })).status).toBe(200);
    let rows: Array<{ state: string; status: string; error: string }> = [];
    for (let i = 0; i < 80 && rows[0]?.state !== "failed"; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      rows = await (await adult.client.post("/api/plugins/videos/data/recipes", { scope: "feed" })).json() as typeof rows;
    }
    expect(rows[0]?.state).toBe("failed");
    expect(rows[0]!.status).toBe("failed");
    expect(rows[0]!.error.length).toBeGreaterThan(10);
  });
});

describe("the Create page and the make action", () => {
  test("the served Create page holds the panel prompt bar with the recipes, lengths and only the levels this person may use, and the feed beside it", async () => {
    const { adult } = await household();
    const page = await (await adult.client.get("/api/plugins/videos/pages/create")).json() as { body: Array<Record<string, any>> };
    const bar = promptBarOf(page.body)!;
    expect(bar.submit.call.target).toBe("/api/plugins/videos/actions/make");
    const chip = (state: string) => bar.chips.find((c: { state: string }) => c.state === state);
    expect(chip("orientation").options.map((o: { value: string }) => o.value)).toEqual(["landscape", "portrait"]);
    expect(chip("seconds").options.map((o: { value: number }) => o.value)).toEqual([QUICK_MAX_SECONDS, DETAILED_MAX_SECONDS]);
    expect(chip("camera").options.map((o: { value: string }) => o.value)).toEqual(["none", ...VIDEO_RECIPES.map((r) => r.id)]);
    // Levels: Standard first; Max only when the person is offered it, Boost only when they may use it; one level alone shows no segment.
    const adultRow = db.select().from(peopleTable).where(eq(peopleTable.displayName, "Marlow")).get()! as PersonRow;
    const expected = ["standard", ...(allowedQuality(adultRow, "video", "detailed", speakerAgeBand(adultRow, new Date())) === "detailed" ? ["boost"] : []), ...(maxOffered(adultRow, "video", speakerAgeBand(adultRow, new Date())) ? ["max"] : [])];
    if (expected.length === 1) expect(bar.tier).toBeUndefined();
    else expect(bar.tier.tiers.map((t: { id: string }) => t.id)).toEqual(expected);
    expect(bar.tier?.tiers.map((t: { id: string }) => t.id) ?? []).not.toContain("max");
    // VIDEO-UI-15: the segment is drawn as three cards (the one definition stays `videoTierSegment`).
    const segment = videoTierSegment({ ...adultRow, role: "adult" });
    expect(segment ? { ...segment, presentation: "cards" } : null).toEqual(bar.tier ?? null);
    // The page document itself is not changed by serving it: a second request gets one set of chips, not two.
    const again = await (await adult.client.get("/api/plugins/videos/pages/create")).json() as { body: Array<Record<string, any>> };
    expect(promptBarOf(again.body)!.chips).toHaveLength(5);
    // VIDEO-UI-06: two panes, the panel on the left, and nothing of the old three pages.
    const split = page.body[0] as Record<string, any>;
    expect(split.type).toBe("split_view");
    expect(split.aside_side).toBe("start");
    // VIDEO-UI-15: the roomy panel on a recessed stage, a large prompt box, the Style banner with its wide popover, the time inside the button.
    expect(split).toMatchObject({ aside_width: "wide", main_surface: "stage" });
    expect(bar.field_size).toBe("large");
    expect(chip("look")).toMatchObject({ trigger: "banner", popover_size: "wide" });
    if (bar.tier) expect(bar.tier.presentation).toBe("cards");
    expect(bar.placement).toBe("panel");
    expect(bar.starts).toBe("video");
    expect(bar.submit_label).toBe("Generate");
    expect(bar.references).toEqual([{ state: "start_frame", label: "Start frame", hint: "Optional. Begin from a picture.", kind: "picture", placement: "tile" }]);
    expect(bar.suggestions.map((s: { text: string }) => s.text)).toEqual(VIDEO_STARTERS.map((idea) => idea.prompt));
    expect(chip("look")).toMatchObject({ presentation: "popover", group: "Style" });
    expect(chip("camera")).toMatchObject({ presentation: "popover", group: "Style" });
    expect(chip("voices").fold).toBe(true);
    // The time under Generate is plain words per level, never credits, memory or a model name.
    const detail = bar.submit_detail as { state: string; labels: Record<string, string> };
    expect(detail.state).toBe(bar.tier ? "tier" : "seconds");
    expect((bar.submit_detail as { placement: string }).placement).toBe("in_button");
    for (const line of Object.values(detail.labels)) expect(line).toMatch(/under a minute|about a minute|about four minutes/);
    expect(JSON.stringify(page.body)).not.toMatch(/\b(GB|RAM|memory|model|credits?|pack)\b/i);
    // The feed sits in a "Your clips" section (the kit's feed has no heading of its own), in the media look with the filters behind one View button.
    const section = (split.main as Array<Record<string, any>>).find((node) => node.type === "section")!;
    expect(section.heading).toBe("Your clips");
    const feedNode = section.children[0] as Record<string, any>;
    expect(feedNode.type).toBe("result_feed");
    expect(feedNode).toMatchObject({ look: "media", filters_presentation: "popover" });
    expect(feedNode.poll_while).toEqual({ statuses: ["queued", "generating"], record: { path: "recipes", params: { scope: "job", id: "{id}" } } });
    expect(feedNode.bind.params.scope).toBe("feed");
  });

  // MAX-FIRST-LOAD-01: the segment read the Stack's status without waiting, so the first page after Home started (cold cache) had no Max.
  test("the first Make page after a cold start already offers Max to a person who holds it", async () => {
    const { owner } = await household();
    // The real status read (cold cache), answered by the fake Stack: the fixture's own test status is switched off for this test.
    __setVideoStatusForTests(undefined);
    __setStackClientForTests({} as never);
    fake.ltx25max = "ready";
    dropVideoStatusCache();
    const first = await (await owner.get("/api/plugins/videos/pages/create")).json() as { body: Array<Record<string, any>> };
    expect(promptBarOf(first.body)!.tier.tiers.map((t: { id: string }) => t.id)).toContain("max");
    // Not ready on the Stack: a cold first page shows nothing for Max rather than a stale yes.
    fake.ltx25max = undefined;
    dropVideoStatusCache();
    const cold = await (await owner.get("/api/plugins/videos/pages/create")).json() as { body: Array<Record<string, any>> };
    expect((promptBarOf(cold.body)!.tier?.tiers ?? []).map((t: { id: string }) => t.id)).not.toContain("max");
    __setStackClientForTests(null);
  });

  // MAX-WAIT-REASON-01: a Max clip the Stack holds shows its reason on its feed entry, not "Making your video".
  test("the feed entry says why a held Max clip waits, in plain words", async () => {
    const { adult } = await household();
    const person = db.select().from(peopleTable).where(eq(peopleTable.displayName, "Marlow")).get()! as PersonRow;
    const now = new Date().toISOString();
    db.insert(videoJobs).values({ id: "held-1", personId: person.id, kind: "generate", state: "running", stackJob: "stack-1", percent: 0, phase: "waiting for the computer", prompt: BOAT, request: JSON.stringify({ loras: [], create: {} }), files: "[]", createdAt: now, updatedAt: now, hlc: nextHlc() }).run();
    const rows = await (await adult.client.post("/api/plugins/videos/data/recipes", { scope: "feed" })).json() as Array<{ status: string; phase: string }>;
    expect(rows[0]!.status).toBe("generating");
    expect(rows[0]!.phase).toBe("Waiting for the computer to finish other work. Your video starts by itself, or tap Cancel.");
    expect(rows[0]!.phase).not.toContain("Making your video");
  });

  test("the prompt bar's submit args fill from the item and the action takes them", async () => {
    const { adult } = await household();
    const res = await adult.client.post("/api/plugins/videos/actions/make", { prompt: BOAT, orientation: "portrait", seconds: 10, tier: "standard", recipe: "none" });
    expect(res.status).toBe(200);
    expect(fake.submitted[0]!.size).toBe("480x832");
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
  const PAGES = ["create", "clips"];
  const appRow = async (client: TestClient) => ((await (await client.get("/api/apps")).json()) as Array<Record<string, any>>).find((row) => row.package === "videos")!;
  test("the create group, the Create header mode and the two pages are gone below adult", async () => {
    const { adult, teen, child } = await household();
    const adultApp = await appRow(adult.client);
    expect(adultApp.sidebar.groups.map((g: { id: string }) => g.id)).toEqual(["play", "create"]);
    expect(adultApp.sidebar.groups.find((g: { id: string }) => g.id === "create").pages.map((p: { page: string }) => p.page)).toEqual(["create", "clips"]);
    expect(adultApp.header.modes.map((m: { id: string }) => m.id)).toEqual(["play", "create"]);
    for (const other of [teen, child]) {
      const row = await appRow(other.client);
      expect(row.sidebar.groups.map((g: { id: string }) => g.id)).toEqual(["play"]);
      expect(row.sidebar.groups[0].pages.map((p: { page: string }) => p.page)).toEqual(["index", "library", "history", "watch-later"]);
      expect(row.header.modes.map((m: { id: string }) => m.id)).toEqual(["play"]);
      for (const page of [...PAGES, "make-video", "creations"]) expect((await other.client.get(`/api/plugins/videos/pages/${page}`)).status).toBe(404);
      expect((await other.client.get("/api/plugins/videos/pages/index")).status).toBe(200);
    }
    for (const page of PAGES) expect((await adult.client.get(`/api/plugins/videos/pages/${page}`)).status).toBe(200);
    // The three old pages are gone for adults too: a removed page is a plain 404, not an empty page.
    for (const page of ["make-video", "creations"]) expect((await adult.client.get(`/api/plugins/videos/pages/${page}`)).status).toBe(404);
  });
});

describe("V1b: look, length, voices, hint and Another take", () => {
  test("the chips come from the single lists", async () => {
    const { adult } = await household();
    const page = await (await adult.client.get("/api/plugins/videos/pages/create")).json() as { body: Array<Record<string, any>> };
    const bar = promptBarOf(page.body)!;
    const chip = (state: string) => bar.chips.find((c: { state: string }) => c.state === state);
    expect(chip("look").options.map((o: { value: string }) => o.value)).toEqual(VIDEO_LOOKS.map((l) => l.id));
    expect(chip("look").default).toBe("natural");
    expect(chip("voices").options.map((o: { value: string }) => o.value)).toEqual(VIDEO_VOICES.map((v) => v.id));
    expect(chip("voices").default).toBe("clean");
    expect(bar.submit.call.args.look).toBe("{look}");
    expect(videoLookFor("Classic cartoon")?.id).toBe("classic-cartoon");
    expect(withVideoLook("a dog", videoLookFor("natural"))).toBe("a dog");
    expect(withVideoLook("a dog", videoLookFor("anime"))).toStartWith("2D anime style");
    expect(withVideoVoices("a dog", videoVoicesFor("full"))).toBe("a dog");
    expect(withVideoVoices("a dog.", videoVoicesFor("clean"))).toBe("a dog. no laugh track, no music, only one character speaks at a time.");
  });

  test("a look goes before the words and clean voices after, on a Boost clip; the card keeps only what was typed", async () => {
    const { owner } = await household();
    fake.detailed = "installed";
    __setVideoStatusForTests(readyVideoStatusForTests({ detailed: "installed" }));
    const res = await owner.post("/api/videos/make", { prompt: BOAT, tier: "boost", seconds: 10, look: "classic-cartoon", voices: "clean", recipe: "dolly-in" });
    expect(res.status).toBe(200);
    const card = await res.json() as { items: Array<{ prompt: string }>; notice: string | null };
    expect(card.items[0]!.prompt).toBe(BOAT);
    expect(card.notice).toBeNull();
    const sent = String(fake.submitted[0]!.prompt);
    expect(sent).toStartWith(videoLookFor("classic-cartoon")!.wording);
    expect(sent).toContain(BOAT);
    expect(sent.indexOf(BOAT)).toBeLessThan(sent.indexOf(videoRecipeFor("dolly-in")!.wording));
    expect(sent).toEndWith("no laugh track, no music, only one character speaks at a time.");
    expect(fake.submitted[0]!.seconds).toBe(10);
    expect(typeof fake.submitted[0]!.seed).toBe("number");
  });

  test("Standard cannot make 10 seconds: it makes 5 and says so in one plain line, also on the making list", async () => {
    const { adult } = await household();
    fake.pollsToFinish = 1000;
    const res = await adult.client.post("/api/plugins/videos/actions/make", { prompt: BOAT, tier: "standard", seconds: 10 });
    expect(res.status).toBe(200);
    const body = await res.json() as { notice: string };
    expect(body.notice).toContain("5 seconds");
    expect(body.notice).not.toContain("\u2014");
    expect(fake.submitted[0]!.seconds).toBe(5);
    const rows = await (await adult.client.post("/api/plugins/videos/data/recipes", { scope: "feed" })).json() as Array<{ phase: string; seconds: number; tags: string[] }>;
    expect(rows[0]!.phase).toContain("5 seconds");
    expect(rows[0]!.seconds).toBe(5);
    expect(rows[0]!.tags).toContain("5 s");
  });

  test("an unknown look or voices choice is a plain 422", async () => {
    const { adult } = await household();
    expect((await adult.client.post("/api/plugins/videos/actions/make", { prompt: BOAT, look: "neon" })).status).toBe(422);
    expect((await adult.client.post("/api/plugins/videos/actions/make", { prompt: BOAT, voices: "loud" })).status).toBe(422);
    expect(fake.submitted).toHaveLength(0);
  });

  test("Another take on a conversation-less clip repeats the words and choices with a new job and seed; the route and the action both work", async () => {
    const { adult, teen } = await household();
    const actor = db.select().from(peopleTable).where(eq(peopleTable.displayName, "Marlow")).get()! as PersonRow;
    const first = await (await adult.client.post("/api/videos/make", { prompt: BOAT, orientation: "portrait", look: "anime", recipe: "handheld" })).json() as { id: string };
    // Not while it is still being made.
    expect((await adult.client.post(`/api/videos/jobs/${first.id}/another`, {})).status).toBe(404);
    await until(() => getVideoJobFor(actor, first.id)?.state === "done");
    const last = await (await adult.client.post("/api/plugins/videos/data/recipes", { scope: "feed" })).json() as Array<{ id: string; prompt: string; status: string; orientation: string; look: string; camera: string }>;
    expect(last[0]).toMatchObject({ id: first.id, prompt: BOAT, status: "ready", orientation: "portrait", look: "anime", camera: "handheld" });
    const res = await adult.client.post(`/api/videos/jobs/${first.id}/another`, {});
    expect(res.status).toBe(200);
    const card = await res.json() as { id: string; conversation_id: string | null };
    expect(card.id).not.toBe(first.id);
    expect(card.conversation_id).toBeNull();
    expect(fake.submitted).toHaveLength(2);
    const [a, b] = fake.submitted as Array<Record<string, unknown>>;
    expect(b!.prompt).toBe(a!.prompt);
    expect(b!.size).toBe("480x832");
    expect(String(b!.prompt)).toStartWith(videoLookFor("anime")!.wording);
    await until(() => getVideoJobFor(actor, card.id)?.state === "done");
    const viaAction = await adult.client.post("/api/plugins/videos/actions/another", { id: card.id });
    expect(viaAction.status).toBe(200);
    expect(fake.submitted).toHaveLength(3);
    // Someone else's clip, a missing one and a teen are all refused; nothing more reaches the Stack.
    expect((await teen.client.post(`/api/videos/jobs/${first.id}/another`, {})).status).toBe(404);
    expect((await teen.client.post("/api/plugins/videos/actions/another", { id: first.id })).status).toBe(404);
    expect((await adult.client.post("/api/plugins/videos/actions/another", { id: "nope" })).status).toBe(404);
    expect(fake.submitted).toHaveLength(3);
  });

  test("adult-only refusals still hold: a child gets no look or voices wording and the make is refused", async () => {
    const { child, teen } = await household();
    for (const who of [child, teen]) {
      const res = await who.client.post("/api/videos/make", { prompt: BOAT, look: "film", voices: "clean" });
      expect(res.status).toBe(403);
    }
    expect(fake.submitted).toHaveLength(0);
  });
});

// VIDEO-CREATE-02 (U3): the Start frame (the Picture slot), the Camera cards and the per-person fill's loops.
describe("U3: Start frame", () => {
  const person = (name: string) => db.select().from(peopleTable).where(eq(peopleTable.displayName, name)).get()! as PersonRow;
  async function libraryPicture(owner: PersonRow, width = 64, height = 64, mediaType = "image/png"): Promise<{ id: string; png: Uint8Array }> {
    const png = new Uint8Array(await sharp({ create: { width, height, channels: 3, background: { r: 10, g: 120, b: 200 } } }).png().toBuffer());
    const made = storeFile(owner, { conversationId: null, turnId: null, mediaType, bytes: png, provenance: "composer:upload", retention: "kept", deduplicate: false });
    if (!made.ok) throw new Error(`file: ${made.error}`);
    return { id: made.value.id, png };
  }
  const screened = () => { const seen = { calls: 0 }; __setAgeCheckRunnerForTests(async (images) => { seen.calls += images.length; return images.map(() => ({ ok: true as const, verdict: { people_count: 0, apparent_min_age_estimate: null, label: "none" as const, is_nude_or_sexual: false, confidence: 1 } })); }); return seen; };

  test("a Library picture the person owns starts the clip: the stored bytes go to the Stack as an uploaded picture, the picture's shape sets the size, and the input screen ran", async () => {
    const { adult } = await household();
    const { id, png } = await libraryPicture(person("Marlow"), 64, 128);
    const seen = screened();
    const res = await adult.client.post("/api/plugins/videos/actions/make", { prompt: BOAT, orientation: "landscape", start_frame: id });
    expect(res.status).toBe(200);
    const job = getVideoJobFor(person("Marlow"), ((await res.json()) as { id: string }).id)!;
    expect(job.kind).toBe("animate");
    expect(job.request.source_file_id).toBe(id);
    expect(seen.calls).toBe(1);
    const sent = fake.submitted[0]!;
    expect(sent.image_source).toBe("uploaded");
    expect(Buffer.from(sent.image as string, "base64").equals(Buffer.from(png))).toBe(true);
    expect(sent.size).toBe("480x832");
  });

  test("an empty slot leaves {start_frame} in place and means no picture: a text clip", async () => {
    const { adult } = await household();
    const seen = screened();
    const res = await adult.client.post("/api/plugins/videos/actions/make", { prompt: BOAT, start_frame: "{start_frame}", camera: "{camera}" });
    expect(res.status).toBe(200);
    expect(fake.submitted[0]!.image).toBeUndefined();
    expect(seen.calls).toBe(0);
  });

  test("an unknown id, another person's file and a file that is not a picture are one plain 404 and nothing reaches the Stack", async () => {
    const { adult } = await household();
    const theirs = await libraryPicture(person("Sage"));
    const notPicture = storeFile(person("Marlow"), { conversationId: null, turnId: null, mediaType: "application/pdf", bytes: new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52, 10]), provenance: "composer:upload", retention: "kept", deduplicate: false });
    if (!notPicture.ok) throw new Error("pdf");
    const seen = screened();
    const lines = new Set<string>();
    for (const id of ["nope", theirs.id, notPicture.value.id]) {
      const res = await adult.client.post("/api/plugins/videos/actions/make", { prompt: BOAT, start_frame: id });
      expect(res.status).toBe(404);
      lines.add(((await res.json()) as { error: string }).error);
    }
    expect([...lines]).toHaveLength(1);
    expect([...lines][0]).toContain("Library");
    expect(fake.submitted).toHaveLength(0);
    expect(seen.calls).toBe(0);
  });

  test("a teen and a child are refused before the picture is read or screened", async () => {
    const { teen, child } = await household();
    const mine = await libraryPicture(person("Nova"));
    const seen = screened();
    for (const who of [teen, child]) expect((await who.client.post("/api/videos/make", { prompt: BOAT, start_frame: mine.id })).status).toBe(403);
    expect(seen.calls).toBe(0);
    expect(fake.submitted).toHaveLength(0);
  });

  test("a picture the input screen refuses (a possible minor in a nude or sexual picture) is a plain 422 and nothing reaches the Stack", async () => {
    const { adult } = await household();
    const { id } = await libraryPicture(person("Marlow"));
    __setAgeCheckRunnerForTests(async (images) => images.map(() => ({ ok: true as const, verdict: { people_count: 1, apparent_min_age_estimate: 12, label: "minor" as never, is_nude_or_sexual: true, confidence: 1 } })));
    const res = await adult.client.post("/api/plugins/videos/actions/make", { prompt: BOAT, start_frame: id });
    expect(res.status).toBe(422);
    expect(fake.submitted).toHaveLength(0);
  });

  test("Another take keeps the Start frame, and both the clip's file id and its job id name the source", async () => {
    const { adult } = await household();
    const actor = person("Marlow");
    const { id } = await libraryPicture(actor);
    screened();
    const first = await (await adult.client.post("/api/plugins/videos/actions/make", { prompt: BOAT, start_frame: id })).json() as { id: string };
    await until(() => getVideoJobFor(actor, first.id)?.state === "done");
    const fileId = getVideoJobFor(actor, first.id)!.files[0]!.id;
    const res = await adult.client.post("/api/plugins/videos/actions/another", { id: fileId });
    expect(res.status).toBe(200);
    expect(fake.submitted).toHaveLength(2);
    expect(fake.submitted[1]!.image_source).toBe("uploaded");
    // The feed row of the first clip keeps the Start frame as a chip with its thumbnail, and the Remix refill carries its id.
    const feed = await (await adult.client.post("/api/plugins/videos/data/recipes", { scope: "feed" })).json() as Array<{ id: string; src: string | null; references: Array<{ label: string; thumb: string }>; start_frame: string }>;
    expect(feed).toHaveLength(2);
    const old = feed.find((row) => row.id === first.id)!;
    expect(old.src).toContain(fileId);
    expect(old.references).toEqual([{ label: "Start frame", thumb: `/api/files/${id}/thumb?w=320` }]);
    expect(old.start_frame).toBe(id);
  });
});

describe("U3: Camera and Look cards from the one lists, with their loops", () => {
  test("the served page puts the cards' loop paths on the options, from VIDEO_LOOKS and VIDEO_RECIPES, and lists no loop in the page JSON", async () => {
    const { adult } = await household();
    const page = await (await adult.client.get("/api/plugins/videos/pages/create")).json() as { body: Array<Record<string, any>> };
    const bar = promptBarOf(page.body)!;
    const chip = (state: string) => bar.chips.find((c: { state: string }) => c.state === state);
    expect(chip("look").variant).toBe("cards");
    const shipped = (loop: string) => existsSync(join(PACKAGES_DIR, "videos", "assets", loop));
    expect(chip("look").options).toEqual(VIDEO_LOOKS.map((l) => ({ value: l.id, label: l.id === "natural" ? "Auto" : l.label, ...(shipped(l.loop) ? { media: l.loop } : {}) })));
    expect(chip("look").options.some((o: { media?: string }) => o.media)).toBe(true);
    expect(chip("camera").variant).toBe("cards");
    expect(chip("camera").default).toBe("none");
    expect(chip("camera").options).toEqual([{ value: "none", label: "Auto" }, ...VIDEO_RECIPES.map((r) => ({ value: r.id, label: r.label, ...(shipped(r.loop) ? { media: r.loop } : {}) }))]);
    expect(bar.references).toEqual([{ state: "start_frame", label: "Start frame", hint: "Optional. Begin from a picture.", kind: "picture", placement: "tile" }]);
    expect(bar.submit.call.args).toMatchObject({ camera: "{camera}", start_frame: "{start_frame}", look: "{look}" });
    const source = await Bun.file(join(PACKAGES_DIR, "videos", "pages", "create.json")).text();
    expect(source).not.toContain(".mp4");
    expect(VIDEO_RECIPES).toHaveLength(8);
  });

  test("every loop that ships is small and served only to an adult; a card without its loop is a plain tile", async () => {
    const { adult, teen, child, owner } = await household();
    const loops = [...VIDEO_LOOKS, ...VIDEO_RECIPES].map((entry) => entry.loop);
    expect(new Set(loops).size).toBe(13);
    const present = loops.filter((loop) => existsSync(join(PACKAGES_DIR, "videos", "assets", loop)));
    expect(present.length).toBeGreaterThan(0);
    for (const loop of present) {
      const file = join(PACKAGES_DIR, "videos", "assets", loop);
      expect(statSync(file).size).toBeLessThan(300 * 1024);
      const res = await adult.client.get(`/api/plugins/videos/assets/${loop}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("video/mp4");
      for (const other of [teen, child]) expect((await other.client.get(`/api/plugins/videos/assets/${loop}`)).status).toBe(404);
    }
    expect((await owner.get(`/api/plugins/videos/assets/${present[0]}`)).status).toBe(200);
  });
});
