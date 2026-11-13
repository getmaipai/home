// VIDEO-UI-06 (docs/design/video-create-one-page-2026-11-02.md): the data behind the Create workspace and My clips. The `recipes` scopes `feed` (the person's
// own clips as result_feed rows), `job` (one row by id, what `poll_while.record` reads) and `clips` (My clips by tab), the `favorite`, `cancel` and `max`
// actions, the manifest of two pages, and the rules that did not change: adults only, a person sees only their own jobs, shared clips show as the Library
// shows them, a child or teen reaches none of it.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import { db } from "@/db";
import { videoFavorites, videoJobs, people as peopleTable } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import { getVideoJobFor } from "@/lib/videos/jobs";
import { MAX_NEEDS_ADMIN_LINE } from "@/lib/tiers";
import { __resetVideoAdapterCacheForTests } from "@/lib/videos/adapters";
import { installFakeVideoStack, type FakeVideoStack } from "./videoFixture";
import { __setVideoStatusForTests, readyVideoStatusForTests } from "@/lib/videos/ready";
import { until } from "./pictureFixture";
import { storeFile } from "@/lib/attachments";
import { PACKAGES_DIR } from "@/lib/paths";
import { __setAgeCheckRunnerForTests } from "@/lib/pictures/ageCheck";
import { join } from "node:path";
import { existsSync, statSync } from "node:fs";
import { VIDEO_LOOKS, VIDEO_RECIPES } from "@/lib/videos/recipes";
import sharp from "sharp";
import type { PersonRow } from "@/types";

let fake: FakeVideoStack;
beforeEach(() => { resetDb(); __resetVideoAdapterCacheForTests(); fake = installFakeVideoStack(); });
afterEach(() => { fake.restore(); __setVideoStatusForTests(undefined); });

const BOAT = "A paper boat floats down a rainy street, soft evening light";
type Row = Record<string, any>;

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
  const other = await signIn("Quill", "adult");
  const teen = await signIn("Nova", "teen", { birthdate: "2011-03-01" });
  const child = await signIn("Sprout", "child", { birthdate: "2018-03-01" });
  const row = (name: string) => db.select().from(peopleTable).where(eq(peopleTable.displayName, name)).get()! as PersonRow;
  return { owner, adult, other, teen, child, row };
}
const data = async (client: TestClient, body: Record<string, unknown>) => (await client.post("/api/plugins/video/data/recipes", body)).json() as Promise<Row[]>;
const action = (client: TestClient, name: string, body: Record<string, unknown>) => client.post(`/api/plugins/video/actions/${name}`, body);

async function makeClip(client: TestClient, actor: PersonRow, body: Record<string, unknown> = { prompt: BOAT }) {
  const made = await (await client.post("/api/videos/make", body)).json() as { id: string };
  await until(() => getVideoJobFor(actor, made.id)?.state === "done");
  return { jobId: made.id, fileId: getVideoJobFor(actor, made.id)!.files[0]!.id };
}

describe("scope feed: the person's own clips in the result_feed shape", () => {
  test("a finished clip is a ready row with its words, tags, still, clip address and no running fields", async () => {
    const { adult, row } = await household();
    const { jobId, fileId } = await makeClip(adult.client, row("Marlow"), { prompt: BOAT, orientation: "portrait", look: "anime", recipe: "handheld", seconds: 5 });
    const [first] = await data(adult.client, { scope: "feed" });
    expect(Object.keys(first!).sort()).toEqual(["camera", "can_mark", "can_unmark", "created_at", "error", "favorite", "height", "id", "kind", "look", "orientation", "percent", "phase", "prompt", "queue_position", "references", "seconds", "src", "start_frame", "started_at", "state", "status", "still", "tags", "tier", "width"]);
    expect(first).toMatchObject({ id: jobId, prompt: BOAT, status: "ready", state: "done", percent: 100, phase: null, queue_position: null, error: null, favorite: false, orientation: "portrait", look: "anime", camera: "handheld", tier: "standard", references: [], start_frame: "" });
    expect(first!.src).toBe(`/api/videos/jobs/${jobId}/files/${fileId}`);
    expect(first!.tags.slice(0, 3)).toEqual(["Anime", "Handheld", "Standard"]);
    expect(first!.tags.some((tag: string) => /^\d+ s$/.test(tag))).toBe(true);
    expect(typeof first!.created_at).toBe("string");
    expect(typeof first!.started_at).toBe("number");
    // The address plays for its owner.
    expect((await adult.client.get(first!.src)).status).toBe(200);
  });

  test("a queued or running clip is a row too, with a plain phase line and no clip address; a stopped one is cancelled", async () => {
    const { adult } = await household();
    fake.pollsToFinish = 1000;
    const made = await (await adult.client.post("/api/videos/make", { prompt: BOAT })).json() as { id: string };
    const [running] = await data(adult.client, { scope: "feed" });
    expect(["queued", "generating"]).toContain(running!.status);
    expect(running!.phase.length).toBeGreaterThan(5);
    expect(running!.src).toBeNull();
    expect(running!.favorite).toBe(false);
    const stop = await action(adult.client, "cancel", { id: made.id });
    expect(stop.status).toBe(200);
    expect(await stop.json()).toMatchObject({ ok: true, id: made.id, state: "cancelled" });
    const [stopped] = await data(adult.client, { scope: "feed" });
    expect(stopped).toMatchObject({ status: "cancelled", phase: null, src: null });
  });

  test("a failed clip is a row with the plain line to show, and Try again (the another action) works on it", async () => {
    const { adult, row } = await household();
    fake.refuseSubmit = { status: 422, code: "unsupported", error: "That size is not supported." };
    const made = await (await adult.client.post("/api/videos/make", { prompt: BOAT })).json() as { id: string };
    await until(() => getVideoJobFor(row("Marlow"), made.id)?.state === "failed");
    const [failed] = await data(adult.client, { scope: "feed" });
    expect(failed).toMatchObject({ status: "failed", state: "failed", percent: null, src: null });
    expect(failed!.error.length).toBeGreaterThan(10);
    fake.refuseSubmit = null;
    expect((await action(adult.client, "another", { id: made.id })).status).toBe(200);
    const rows = await data(adult.client, { scope: "feed" });
    expect(rows).toHaveLength(2);
    expect(rows[0]!.id).not.toBe(made.id);
  });

  test("newest first, at most the feed's limit, and a clip whose Library file is gone or in Trash is not shown", async () => {
    const { adult, row } = await household();
    const actor = row("Marlow");
    const first = await makeClip(adult.client, actor, { prompt: BOAT });
    const second = await makeClip(adult.client, actor, { prompt: "Sunrise over a misty green valley, birds crossing the sky" });
    expect((await data(adult.client, { scope: "feed" })).map((r) => r.id)).toEqual([second.jobId, first.jobId]);
    expect(await data(adult.client, { scope: "feed", limit: 1 })).toHaveLength(1);
    const { attachments } = await import("@/db/schema");
    db.update(attachments).set({ deletedAt: new Date().toISOString() }).where(eq(attachments.id, first.fileId)).run();
    expect((await data(adult.client, { scope: "feed" })).map((r) => r.id)).toEqual([second.jobId]);
  });

  test("a clip made in chat, or by an edit, is not a Create row", async () => {
    const { adult, row } = await household();
    const now = new Date().toISOString();
    const base = { personId: row("Marlow").id, state: "done", percent: 100, prompt: "chat clip", request: JSON.stringify({ size: "832x480", seconds: 5, loras: [], create: {} }), files: "[]", createdAt: now, updatedAt: now, hlc: nextHlc() };
    db.insert(videoJobs).values({ id: "chat-1", kind: "generate", conversationId: "conv-1", ...base }).run();
    db.insert(videoJobs).values({ id: "edit-1", kind: "edit", conversationId: null, ...base }).run();
    expect(await data(adult.client, { scope: "feed" })).toEqual([]);
  });

  test("the Type filter: Videos keeps the clips, Stills has none yet; Favorites only keeps the marked ones", async () => {
    const { adult, row } = await household();
    const actor = row("Marlow");
    const first = await makeClip(adult.client, actor, { prompt: BOAT });
    await makeClip(adult.client, actor, { prompt: "Sunrise over a misty green valley, birds crossing the sky" });
    expect(await data(adult.client, { scope: "feed", type: "video" })).toHaveLength(2);
    expect(await data(adult.client, { scope: "feed", type: "all" })).toHaveLength(2);
    expect(await data(adult.client, { scope: "feed", type: "still" })).toEqual([]);
    expect(await data(adult.client, { scope: "feed", favorites: true })).toEqual([]);
    await action(adult.client, "favorite", { id: first.jobId });
    const only = await data(adult.client, { scope: "feed", favorites: true });
    expect(only.map((r) => r.id)).toEqual([first.jobId]);
    expect(only[0]!.favorite).toBe(true);
    expect((await data(adult.client, { scope: "feed", favorites: "true" })).map((r) => r.id)).toEqual([first.jobId]);
  });
});

describe("scope job: one row by id, for poll_while", () => {
  test("a running job is read by its id as a row in the feed's shape, and moves to ready when it finishes", async () => {
    const { adult, row } = await household();
    fake.pollsToFinish = 1000;
    const made = await (await adult.client.post("/api/videos/make", { prompt: BOAT })).json() as { id: string };
    const [one] = await data(adult.client, { scope: "job", id: made.id });
    const [inFeed] = await data(adult.client, { scope: "feed" });
    expect(Object.keys(one!).sort()).toEqual(Object.keys(inFeed!).sort());
    expect(["queued", "generating"]).toContain(one!.status);
    // The record read follows the job: settle it and the same call answers ready.
    const job = getVideoJobFor(row("Marlow"), made.id)!;
    job.state = "failed";
    job.error = "I couldn't make that video. It did not finish. Try again.";
    const [settled] = await data(adult.client, { scope: "job", id: made.id });
    expect(settled).toMatchObject({ id: made.id, status: "failed" });
  });

  test("nothing for another person's job, a missing id or no id", async () => {
    const { adult, other } = await household();
    fake.pollsToFinish = 1000;
    const made = await (await adult.client.post("/api/videos/make", { prompt: BOAT })).json() as { id: string };
    expect(await data(other.client, { scope: "job", id: made.id })).toEqual([]);
    expect(await data(adult.client, { scope: "job", id: "nope" })).toEqual([]);
    expect(await data(adult.client, { scope: "job" })).toEqual([]);
    expect(await data(other.client, { scope: "feed" })).toEqual([]);
  });

  test("a child and a teen reach no scope", async () => {
    const { teen, child } = await household();
    for (const who of [teen, child]) for (const scope of ["feed", "job", "clips", "showcase"]) expect((await who.client.post("/api/plugins/video/data/recipes", { scope, id: "x" })).status).toBe(404);
  });
});

describe("favorite", () => {
  test("flips by default, sets with an explicit value, by the job (feed) or by the file (My clips); stored once per person and clip", async () => {
    const { adult, row } = await household();
    const { jobId, fileId } = await makeClip(adult.client, row("Marlow"));
    expect(await (await action(adult.client, "favorite", { id: jobId })).json()).toMatchObject({ ok: true, favorite: true });
    expect(await (await action(adult.client, "favorite", { id: fileId, favorite: true })).json()).toMatchObject({ favorite: true });
    expect(db.select().from(videoFavorites).all()).toHaveLength(1);
    expect((await data(adult.client, { scope: "feed" }))[0]!.favorite).toBe(true);
    expect(await (await action(adult.client, "favorite", { id: fileId, favorite: false })).json()).toMatchObject({ favorite: false });
    expect(await (await action(adult.client, "favorite", { id: jobId, favorite: "true" })).json()).toMatchObject({ favorite: true });
    expect(await (await action(adult.client, "favorite", { id: jobId })).json()).toMatchObject({ favorite: false });
    expect(db.select().from(videoFavorites).all()).toHaveLength(0);
  });

  test("a missing clip, a clip still being made, another person's clip and a teen or child are refused with one plain line", async () => {
    const { adult, other, teen, child, row } = await household();
    const { fileId, jobId } = await makeClip(adult.client, row("Marlow"));
    fake.pollsToFinish = 1000;
    const running = await (await other.client.post("/api/videos/make", { prompt: BOAT })).json() as { id: string };
    expect((await action(adult.client, "favorite", { id: "nope" })).status).toBe(404);
    expect((await action(other.client, "favorite", { id: running.id })).status).toBe(404);
    expect((await action(other.client, "favorite", { id: jobId })).status).toBe(404);
    expect((await action(other.client, "favorite", { id: fileId })).status).toBe(404);
    for (const who of [teen, child]) expect((await action(who.client, "favorite", { id: jobId })).status).toBe(404);
    expect(db.select().from(videoFavorites).all()).toHaveLength(0);
  });

  test("a clip shared with another adult can be a favorite of that adult alone", async () => {
    const { adult, other, row } = await household();
    const { fileId } = await makeClip(adult.client, row("Marlow"));
    expect((await action(adult.client, "share-add", { id: fileId, person_id: other.id })).status).toBe(200);
    expect((await action(other.client, "favorite", { id: fileId, favorite: true })).status).toBe(200);
    expect((await data(other.client, { scope: "clips", view: "favorites" })).map((r) => r.id)).toEqual([fileId]);
    expect(await data(adult.client, { scope: "clips", view: "favorites" })).toEqual([]);
  });
});

describe("scope clips: My clips", () => {
  test("All lists the person's made clips with day, level, length, heart and thumbnail; Favorites narrows it", async () => {
    const { adult, row } = await household();
    const actor = row("Marlow");
    const a = await makeClip(adult.client, actor, { prompt: BOAT, tier: "standard" });
    const b = await makeClip(adult.client, actor, { prompt: "Sunrise over a misty green valley, birds crossing the sky" });
    const all = await data(adult.client, { scope: "clips", view: "all" });
    expect(all.map((r) => r.id)).toEqual([b.fileId, a.fileId]);
    expect(Object.keys(all[0]!).sort()).toEqual(["can_mark", "can_unmark", "created_at", "duration_s", "favorite", "id", "kind", "subtitle", "thumbnail", "title"]);
    expect(all[0]).toMatchObject({ favorite: false, kind: "video" });
    expect(all[0]!.subtitle).toMatch(/^Standard, \d+ s$/);
    expect(all[0]!.thumbnail).toContain("/thumb");
    await action(adult.client, "favorite", { id: a.fileId });
    expect((await data(adult.client, { scope: "clips", view: "favorites" })).map((r) => r.id)).toEqual([a.fileId]);
    expect((await data(adult.client, { scope: "clips", view: "all" })).find((r) => r.id === a.fileId)!.favorite).toBe(true);
    expect(await data(adult.client, { scope: "clips", limit: 1 })).toHaveLength(1);
  });

  test("another adult sees only their own clips, until one is shared with them; then it shows with its maker's name", async () => {
    const { adult, other, owner, row } = await household();
    const { fileId } = await makeClip(adult.client, row("Marlow"));
    expect(await data(other.client, { scope: "clips", view: "all" })).toEqual([]);
    expect(await data(owner, { scope: "clips", view: "all" })).toEqual([]);
    await action(adult.client, "share-add", { id: fileId, person_id: other.id });
    const seen = await data(other.client, { scope: "clips", view: "all" });
    expect(seen.map((r) => r.id)).toEqual([fileId]);
    expect(seen[0]!.subtitle).toBe("Marlow");
    // Stopping sharing takes it away again.
    await action(adult.client, "share-private", { id: fileId });
    expect(await data(other.client, { scope: "clips", view: "all" })).toEqual([]);
  });

  test("Uploaded lists the pictures the person put in, never a made picture, a clip or another person's file", async () => {
    const { adult, other, row } = await household();
    const png = new Uint8Array(await sharp({ create: { width: 32, height: 32, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer());
    const put = (who: PersonRow, provenance: string) => { const made = storeFile(who, { conversationId: null, turnId: null, mediaType: "image/png", bytes: png, provenance, retention: "kept", deduplicate: false }); if (!made.ok) throw new Error(made.error); return made.value.id; };
    const mine = put(row("Marlow"), "composer:upload");
    put(row("Marlow"), `picture-gen:${JSON.stringify({ job: "pic-1" })}`);
    put(row("Quill"), "composer:upload");
    await makeClip(adult.client, row("Marlow"));
    const uploaded = await data(adult.client, { scope: "clips", view: "uploaded" });
    expect(uploaded.map((r) => r.id)).toEqual([mine]);
    expect(uploaded[0]).toMatchObject({ kind: "image", favorite: false });
    expect(uploaded[0]!.thumbnail).toContain(`/api/files/${mine}/thumb`);
    expect((await data(other.client, { scope: "clips", view: "uploaded" })).map((r) => r.id)).not.toContain(mine);
  });
});

describe("Make it Max", () => {
  test("refused with the Max line without the grant, with one plain line when the Max model is not ready, and not for a clip still being made or someone else's", async () => {
    const { adult, owner, other, teen, row } = await household();
    const { jobId } = await makeClip(adult.client, row("Marlow"));
    const refused = await action(adult.client, "max", { id: jobId });
    expect(refused.status).toBe(422);
    expect((await refused.json() as { error: string }).error).toBe(MAX_NEEDS_ADMIN_LINE);
    expect((await action(other.client, "max", { id: jobId })).status).toBe(404);
    expect((await action(teen.client, "max", { id: jobId })).status).toBe(404);
    expect((await action(adult.client, "max", { id: "nope" })).status).toBe(404);
    // The owner holds Max by role; the Stack has not got the Max model ready.
    const mine = await makeClip(owner, row("Sage"));
    const notReady = await action(owner, "max", { id: mine.jobId });
    expect(notReady.status).toBe(503);
    expect(((await notReady.json()) as { code: string }).code).toBe("max_not_ready");
    expect(fake.submitted).toHaveLength(2);
  });

  test("with the grant and a ready Max model it makes the same words again at Max with the same seed, once; a clip already at Max says so", async () => {
    const { owner, row } = await household();
    fake.ltx25 = "ready";
    fake.ltx25max = "ready";
    __setVideoStatusForTests(readyVideoStatusForTests({ ltx25: "ready", ltx25max: "ready" }));
    const mine = await makeClip(owner, row("Sage"));
    const res = await action(owner, "max", { id: mine.fileId });
    expect(res.status).toBe(200);
    const made = await res.json() as { id: string };
    const sent = fake.submitted[1]!;
    expect(sent.model).toBe("ltx25-max");
    expect(sent.seed).toBe(fake.submitted[0]!.seed);
    await until(() => getVideoJobFor(row("Sage"), made.id)?.state === "done");
    const again = await action(owner, "max", { id: made.id });
    expect(again.status).toBe(422);
    expect((await again.json() as { code: string }).code).toBe("already_max");
    const rows = await data(owner, { scope: "feed" });
    expect(rows[0]).toMatchObject({ id: made.id, tier: "max" });
    expect(rows[0]!.tags).toContain("Max");
  });
});

describe("Make it Max on a clip that started from a picture", () => {
  const png = async () => new Uint8Array(await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 9, g: 99, b: 199 } } }).png().toBuffer());
  test("it is refused while the Max model cannot start from a picture, and keeps the Start frame when it can", async () => {
    const { owner, row } = await household();
    const sage = row("Sage");
    const made = storeFile(sage, { conversationId: null, turnId: null, mediaType: "image/png", bytes: await png(), provenance: "composer:upload", retention: "kept", deduplicate: false });
    if (!made.ok) throw new Error(made.error);
    __setAgeCheckRunnerForTests(async (images) => images.map(() => ({ ok: true as const, verdict: { people_count: 0, apparent_min_age_estimate: null, label: "none" as const, is_nude_or_sexual: false, confidence: 1 } })));
    fake.ltx25 = "ready";
    fake.ltx25max = "ready";
    __setVideoStatusForTests(readyVideoStatusForTests({ ltx25: "ready", ltx25max: "ready", ltx25Picture: true }));
    const first = await makeClip(owner, sage, { prompt: BOAT, start_frame: made.value.id });
    const refused = await action(owner, "max", { id: first.jobId });
    expect(refused.status).toBe(422);
    expect(((await refused.json()) as { code: string }).code).toBe("max_words_only");
    const submitted = fake.submitted.length;
    __setVideoStatusForTests(readyVideoStatusForTests({ ltx25: "ready", ltx25max: "ready", ltx25Picture: true, ltx25maxPicture: true }));
    const ok = await action(owner, "max", { id: first.jobId });
    expect(ok.status).toBe(200);
    expect(fake.submitted).toHaveLength(submitted + 1);
    const sent = fake.submitted[submitted]!;
    expect(sent.model).toBe("ltx25-max");
    expect(sent.image_source).toBe("uploaded");
    expect(typeof sent.image).toBe("string");
  });
});

describe("Another take, Stop and the gates the buttons call", () => {
  test("a person cannot stop or repeat another person's clip, a chat clip is not stopped from here, and a teen reaches neither", async () => {
    const { adult, other, teen, row } = await household();
    fake.pollsToFinish = 1000;
    const made = await (await adult.client.post("/api/videos/make", { prompt: BOAT })).json() as { id: string };
    expect((await action(other.client, "cancel", { id: made.id })).status).toBe(404);
    expect((await action(teen.client, "cancel", { id: made.id })).status).toBe(404);
    expect(getVideoJobFor(row("Marlow"), made.id)!.state).not.toBe("cancelled");
    const now = new Date().toISOString();
    db.insert(videoJobs).values({ id: "chat-9", personId: row("Marlow").id, kind: "generate", conversationId: "conv-9", state: "running", percent: 3, prompt: "chat", request: JSON.stringify({ size: "832x480", seconds: 5, loras: [] }), files: "[]", createdAt: now, updatedAt: now, hlc: nextHlc() }).run();
    expect((await action(adult.client, "cancel", { id: "chat-9" })).status).toBe(404);
    // A stopped clip stays stopped when Stop is pressed twice.
    expect((await action(adult.client, "cancel", { id: made.id })).status).toBe(200);
    expect((await action(adult.client, "cancel", { id: made.id })).status).toBe(200);
    expect(getVideoJobFor(row("Marlow"), made.id)!.state).toBe("cancelled");
  });
});

describe("scope showcase: the Try this rail (VIDEO-UI-11)", () => {
  test("five to eight rows of {id, title, subtitle, thumbnail, prompt, look, camera}, each look and camera a real card value and each poster served", async () => {
    const { adult, owner } = await household();
    const rows = await data(adult.client, { scope: "showcase" });
    expect(rows.length).toBeGreaterThanOrEqual(5);
    expect(rows.length).toBeLessThanOrEqual(8);
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(["camera", "id", "look", "loop", "prompt", "subtitle", "thumbnail", "title"]);
      expect(VIDEO_LOOKS.map((l) => l.id)).toContain(row.look);
      expect(["none", ...VIDEO_RECIPES.map((r) => r.id)]).toContain(row.camera);
      expect(row.prompt.length).toBeGreaterThan(20);
      expect(row.thumbnail).toMatch(/^\/api\/plugins\/video\/assets\/loops\/[a-z0-9-]+\.jpg$/);
      const res = await adult.client.get(row.thumbnail);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/jpeg");
      // VIDEO-UI-15: each tile also names its loop (same origin, an mp4 the package ships) for the shelf's media_loop.
      expect(row.loop).toBe(row.thumbnail.replace(/\.jpg$/, ".mp4"));
      expect((await adult.client.get(row.loop)).status).toBe(200);
    }
    expect((await data(owner, { scope: "showcase" })).length).toBe(rows.length);
  });

  test("the featured idea scope honors its page limit so the billboard stays one slide", async () => {
    const { adult } = await household();
    const rows = await data(adult.client, { scope: "showcase", limit: 1 });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe("paper-boat-anime");
  });

  test("every loop has a small poster beside it, and the rows never name a resource, a model or a credit", async () => {
    const { adult } = await household();
    for (const loop of [...VIDEO_LOOKS, ...VIDEO_RECIPES].map((entry) => entry.loop)) {
      const poster = join(PACKAGES_DIR, "video", "assets", loop.replace(/\.mp4$/, ".jpg"));
      expect(existsSync(poster)).toBe(true);
      expect(statSync(poster).size).toBeLessThan(300 * 1024);
    }
    const text = JSON.stringify(await data(adult.client, { scope: "showcase" }));
    expect(text).not.toMatch(/\b(RAM|VRAM|memory|GPU|credits?|LTX|Wan|model)\b/i);
  });

  test("a minor reaches the rows and the posters on no path, and nothing the rail does starts a clip", async () => {
    const { teen, child, adult } = await household();
    for (const who of [teen, child]) {
      expect((await who.client.post("/api/plugins/video/data/recipes", { scope: "showcase" })).status).toBe(404);
      expect((await who.client.get("/api/plugins/video/assets/loops/anime.jpg")).status).toBe(404);
    }
    const before = db.select().from(videoJobs).all().length;
    await data(adult.client, { scope: "showcase" });
    expect(db.select().from(videoJobs).all().length).toBe(before);
  });

  test("the served Create page puts the rail above the feed: a plain poster shelf whose press only navigates with prompt, look and camera; the empty feed keeps its one line", async () => {
    const { adult } = await household();
    const page = await (await adult.client.get("/api/plugins/video/pages/create")).json() as { body: Array<Row> };
    expect(page.body.map((node) => node.type)).toEqual(["prompt_bar", "media_shelf", "section"]);
    expect(page.body[0]).toMatchObject({ type: "prompt_bar", placement: "inline", layout: "chat" });
    const shelf = page.body[1]!;
    expect(shelf).toMatchObject({ heading: "Inspiration", aspect: "wide", layout: "rail", variant: "plain", press_scale: true, item_media_field: "thumbnail", media_loop: true, item_loop_field: "loop", bind: { path: "recipes", params: { scope: "showcase", limit: 4 } } });
    expect(shelf.on_select).toEqual({ navigate: { to: "/apps/video/create", state: { prompt: "{prompt}", look: "{look}", camera: "{camera}" } } });
    expect(JSON.stringify(shelf)).not.toContain("call");
    expect(page.body[2]!.children[0].empty_state.text).toBe("Your clips show here. Pick an idea below or describe a video above and press Generate.");
  });
});

describe("the manifest of three pages", () => {
  test("Create, Studio and My clips are the whole Create group; the three old pages and their files are gone, the data list is still 16 ids", async () => {
    const manifest = JSON.parse(await Bun.file(join(PACKAGES_DIR, "video", "manifest.json")).text()) as { contributes: { sidebar: { groups: Array<{ id: string; pages: string[] }> }; pages: Array<{ id: string; module: string; min_role?: string }>; data: Array<{ id: string }>; header: { modes: Array<{ id: string; page: string }>; search: { label: string } } } };
    const create = manifest.contributes.sidebar.groups.find((group) => group.id === "create")!;
    expect(create.pages).toEqual(["create", "studio", "clips"]);
    const ids = manifest.contributes.pages.map((page) => page.id);
    expect(ids).not.toContain("make-video");
    expect(ids).not.toContain("creations");
    for (const id of ["create", "studio", "clips"]) expect(manifest.contributes.pages.find((page) => page.id === id)).toMatchObject({ module: id, min_role: "adult" });
    for (const page of manifest.contributes.pages) expect(await Bun.file(join(PACKAGES_DIR, "video", "pages", `${page.module}.json`)).exists()).toBe(true);
    expect(await Bun.file(join(PACKAGES_DIR, "video", "pages", "make-video.json")).exists()).toBe(false);
    expect(await Bun.file(join(PACKAGES_DIR, "video", "pages", "creations.json")).exists()).toBe(false);
    expect(manifest.contributes.data).toHaveLength(16);
    expect(manifest.contributes.header.modes.find((mode) => mode.id === "create")).toMatchObject({ page: "create" });
    expect(manifest.contributes.header.search.label).toBe("Search Video");
  });

  test("the served My clips page is three tabs of day-grouped grids with a size slider; only All and Favorites carry the heart; no page links to a removed page", async () => {
    const { adult, teen } = await household();
    const page = await (await adult.client.get("/api/plugins/video/pages/clips")).json() as { body: Array<Row> };
    const tabs = page.body[0]!;
    expect(tabs.type).toBe("tabs");
    expect(tabs.tabs.map((tab: Row) => tab.id)).toEqual(["all", "favorites", "uploaded"]);
    for (const tab of tabs.tabs as Row[]) {
      const shelf = tab.body[0] as Row;
      expect(shelf).toMatchObject({ type: "media_shelf", layout: "grid", group_by_field: "created_at", size_control: true });
      expect(shelf.bind.params.scope).toBe("clips");
      expect(shelf.bind.params.view).toBe(tab.id);
      expect(Boolean(shelf.favorite)).toBe(tab.id !== "uploaded");
    }
    expect((await teen.client.get("/api/plugins/video/pages/clips")).status).toBe(404);
    for (const file of ["index", "library", "create", "clips", "history", "watch-later", "watch", "search"]) {
      const text = await Bun.file(join(PACKAGES_DIR, "video", "pages", `${file}.json`)).text();
      expect(text).not.toMatch(/videos\/(make-video|creations)/);
    }
  });
});
