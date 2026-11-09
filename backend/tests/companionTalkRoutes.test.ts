import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { OpenAPIHono } from "@hono/zod-openapi";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { companionsRoutes } from "@/routes/companions";
import { resetDb } from "./reset-db";
import { __reloadPersonasForTests } from "@/lib/persona";
import { __clearCompanionLookJobsForTests } from "@/lib/companionLookJobs";
import { __setPicturesFetchForTests } from "@/lib/pictures/stack";
import { __setPictureStatusForTests, readyStatusForTests } from "@/lib/pictures/ready";
import { __setAgeCheckRunnerForTests, __resetAgeCheckForTests } from "@/lib/pictures/ageCheck";
import { __setChildSafetyRunnerForTests } from "@/lib/pictures/laneGate";
import { __setChatPictureCapabilityForTests } from "@/lib/chatPictures";
import { householdCompanionFolder, setHouseholdCompanionAnimation } from "@/lib/householdCompanions";
import { readLook, updateSheet } from "@/lib/companionLook";
import { padAnchor, __setTalkAnchorCompletionForTests, TALK_ANCHORS_UNAVAILABLE } from "@/lib/companionTalkAnchors";
import { AGE_OK, CHILD_OK, EYES, MOUTH, SIZE, addPerson, installFakeStack, makeCompanion } from "./companionTalkFixture";

const app = new OpenAPIHono();
app.route("/api/companions", companionsRoutes);
const companionRoot = join(process.env.MAIPAI_DATA_DIR!, "companions");

async function call(path: string, token: string, method = "GET", body?: unknown, extra: Record<string, string> = {}) {
  return app.request(`http://localhost/api/${path}`, {
    method,
    headers: { "content-type": "application/json", cookie: `session=${token}`, ...extra },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function finish(token: string, id: string, job: string): Promise<{ state: string; error: string | null; percent: number }> {
  for (let attempt = 0; attempt < 400; attempt++) {
    const card = await (await call(`companions/${id}/look/jobs/${job}`, token)).json() as { state: string; error: string | null; percent: number };
    if (!["queued", "running"].includes(card.state)) return card;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("The talk job did not finish.");
}

async function runTalk(token: string, id: string, body: unknown = { anchor: MOUTH, eyes_anchor: EYES }) {
  const started = await call(`companions/${id}/look/talk`, token, "POST", body);
  expect(started.status).toBe(202);
  const { job } = await started.json() as { job: string };
  expect((await finish(token, id, job)).state).toBe("done");
  return job;
}

function reset() {
  resetDb();
  rmSync(companionRoot, { recursive: true, force: true });
  __reloadPersonasForTests();
  __clearCompanionLookJobsForTests();
  __setPicturesFetchForTests(null);
  __setPictureStatusForTests(undefined);
  __setChatPictureCapabilityForTests(null);
  __setTalkAnchorCompletionForTests(undefined);
  __resetAgeCheckForTests();
  __setChildSafetyRunnerForTests(null);
}

beforeEach(() => {
  reset();
  __setPictureStatusForTests(readyStatusForTests());
  __setAgeCheckRunnerForTests(async (images) => images.map(() => AGE_OK));
  __setChildSafetyRunnerForTests(async (images) => images.map(() => CHILD_OK) as never);
});
afterEach(reset);

describe("talk routes", () => {
  test("start with hand anchors keeps them exactly, and the card reaches done with the record waiting for review", async () => {
    installFakeStack();
    const token = addPerson("talk-r-hand", "adult");
    const { id } = await makeCompanion("talk-r-hand", "Route hand");
    const job = await runTalk(token, id);
    expect((await finish(token, id, job)).percent).toBe(100);
    const read = await (await call(`companions/${id}/look/talk`, token)).json() as { talk: { state: string; anchor: unknown; eyes_anchor: unknown; shapes: object; eyes: object } };
    expect(read.talk.state).toBe("needs_review");
    expect(read.talk.anchor).toEqual(MOUTH);
    expect(read.talk.eyes_anchor).toEqual(EYES);
    expect(Object.keys(read.talk.shapes)).toHaveLength(6);
    expect(Object.keys(read.talk.eyes)).toHaveLength(2);
  });

  test("a read before any run is null", async () => {
    const token = addPerson("talk-r-empty", "adult");
    const { id } = await makeCompanion("talk-r-empty", "Route empty");
    expect(await (await call(`companions/${id}/look/talk`, token)).json()).toEqual({ talk: null });
  });

  test("start without anchors detects them and pads them; an unreadable picture gives the plain sentence", async () => {
    installFakeStack();
    const token = addPerson("talk-r-detect", "adult");
    const { id } = await makeCompanion("talk-r-detect", "Route detect");
    __setChatPictureCapabilityForTests({ imageParts: true, pictureTokensMax: 2560 });
    __setTalkAnchorCompletionForTests((async () => ({ ok: false, error: "offline" })) as never);
    const refused = await call(`companions/${id}/look/talk`, token, "POST", {});
    expect(refused.status).toBe(422);
    expect(await refused.json()).toEqual({ error: TALK_ANCHORS_UNAVAILABLE });
    const mouth = { x: 0.4, y: 0.6, w: 0.1, h: 0.05 };
    const eyes = { x: 0.3, y: 0.3, w: 0.3, h: 0.05 };
    __setTalkAnchorCompletionForTests((async () => ({ ok: true, value: { text: JSON.stringify({ mouth, eyes }) } })) as never);
    await runTalk(token, id, {});
    const talk = readLook(id).sheet!.talk!;
    expect(talk.anchor).toEqual(padAnchor(mouth));
    expect(talk.eyes_anchor).toEqual(padAnchor(eyes));
  });

  test("a second start is busy (409) and the existing cancel route stops the talk job", async () => {
    installFakeStack();
    const token = addPerson("talk-r-busy", "adult");
    const { id } = await makeCompanion("talk-r-busy", "Route busy");
    const started = await call(`companions/${id}/look/talk`, token, "POST", { anchor: MOUTH, eyes_anchor: EYES });
    const { job } = await started.json() as { job: string };
    const busy = await call(`companions/${id}/look/talk`, token, "POST", { anchor: MOUTH, eyes_anchor: EYES });
    expect(busy.status).toBe(409);
    expect(((await busy.json()) as { error: string }).error.length).toBeGreaterThan(10);
    expect((await call(`companions/${id}/look/jobs/${job}`, token, "DELETE")).status).toBe(204);
    expect((await (await call(`companions/${id}/look/jobs/${job}`, token)).json() as { state: string }).state).toBe("cancelled");
  });

  test("anchors put resets approval and keeps the pictures; approve needs six shapes; unapprove goes back to review", async () => {
    installFakeStack();
    const token = addPerson("talk-r-approve", "adult");
    const { id, rest } = await makeCompanion("talk-r-approve", "Route approve");
    const sheet = readLook(id).sheet!;
    updateSheet(id, { ...sheet, talk: { state: "needs_review", maker: "crop-edit", anchor: MOUTH, eyes_anchor: EYES, shapes: { A: rest, B: rest }, eyes: {} } });
    const early = await call(`companions/${id}/look/talk/approve`, token, "POST");
    expect(early.status).toBe(400);
    expect(((await early.json()) as { error: string }).error).toContain("six");
    await runTalk(token, id);
    const approved = await call(`companions/${id}/look/talk/approve`, token, "POST");
    expect(approved.status).toBe(200);
    expect(readLook(id).sheet!.talk).toMatchObject({ state: "approved", approved_by: "talk-r-approve" });
    const moved = { x: 0.36, y: 0.61, w: 0.28, h: 0.18 };
    const put = await call(`companions/${id}/look/talk/anchors`, token, "PUT", { anchor: moved, eyes_anchor: EYES });
    expect(put.status).toBe(200);
    const talk = readLook(id).sheet!.talk!;
    expect(talk.state).toBe("needs_review");
    expect(talk.approved_by ?? null).toBeNull();
    expect(talk.approved_at ?? null).toBeNull();
    expect(talk.anchor).toEqual(moved);
    expect(Object.keys(talk.shapes)).toHaveLength(6);
    await call(`companions/${id}/look/talk/approve`, token, "POST");
    expect((await call(`companions/${id}/look/talk/unapprove`, token, "POST")).status).toBe(200);
    expect(readLook(id).sheet!.talk!.state).toBe("needs_review");
    expect(readLook(id).sheet!.talk!.approved_by ?? null).toBeNull();
  });

  test("crops and eyes are served as exact anchor boxes with an etag and 304, and 404 until approved", async () => {
    installFakeStack();
    const token = addPerson("talk-r-crop", "adult");
    const other = addPerson("talk-r-crop-other", "adult");
    const { id } = await makeCompanion("talk-r-crop", "Route crop", true);
    await runTalk(token, id);
    const notYet = await call(`companions/${id}/talk/A`, token);
    expect(notYet.status).toBe(404);
    expect(((await notYet.json()) as { error: string }).error).toBe("That talk picture is not approved.");
    expect((await call(`companions/${id}/talk/eyes/closed`, token)).status).toBe(404);
    await call(`companions/${id}/look/talk/approve`, token, "POST");
    const crop = await call(`companions/${id}/talk/A`, token);
    expect(crop.status).toBe(200);
    expect(crop.headers.get("content-type")).toContain("image/png");
    expect(crop.headers.get("cache-control")).toBe("private, max-age=0, must-revalidate");
    const etag = crop.headers.get("etag")!;
    expect(etag).toBeTruthy();
    const meta = await sharp(new Uint8Array(await crop.arrayBuffer())).metadata();
    expect([meta.width, meta.height]).toEqual([Math.round(MOUTH.w * SIZE), Math.round(MOUTH.h * SIZE)]);
    const cached = await call(`companions/${id}/talk/A`, token, "GET", undefined, { "if-none-match": etag });
    expect(cached.status).toBe(304);
    const eyes = await call(`companions/${id}/talk/eyes/half`, token);
    expect(eyes.status).toBe(200);
    const eyeMeta = await sharp(new Uint8Array(await eyes.arrayBuffer())).metadata();
    expect([eyeMeta.width, eyeMeta.height]).toEqual([Math.round(EYES.w * SIZE), Math.round(EYES.h * SIZE)]);
    expect((await call(`companions/${id}/talk/eyes/half`, token, "GET", undefined, { "if-none-match": eyes.headers.get("etag")! })).status).toBe(304);
    expect((await call(`companions/${id}/talk/F`, other)).status).toBe(200);
    expect((await app.request(`http://localhost/api/companions/${id}/talk/A`)).status).toBe(401);
  });

  test("a companion the person may not use gives the plain 404", async () => {
    installFakeStack();
    const token = addPerson("talk-r-hidden", "adult");
    const other = addPerson("talk-r-hidden-other", "adult");
    const { id } = await makeCompanion("talk-r-hidden", "Route hidden");
    await runTalk(token, id);
    await call(`companions/${id}/look/talk/approve`, token, "POST");
    const denied = await call(`companions/${id}/talk/A`, other);
    expect(denied.status).toBe(404);
    expect(((await denied.json()) as { error: string }).error).toBe("That talk picture is not approved.");
  });

  test("avatar carries the talk block only when approved with six shapes, and its etag follows versions and anchors", async () => {
    installFakeStack();
    const token = addPerson("talk-r-avatar", "adult");
    const { id } = await makeCompanion("talk-r-avatar", "Route avatar", true);
    setHouseholdCompanionAnimation(id, { kind: "video", spec_version: 1, key: "#00FF00", states: { idle: { h264: "idle.h264.mp4", still: "idle.png", loop: true } } });
    const folder = join(householdCompanionFolder(id)!, "animation");
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "idle.h264.mp4"), "0123456789");
    writeFileSync(join(folder, "idle.png"), "png");
    __reloadPersonasForTests();
    expect((await call(`companions/${id}/default`, token, "PUT")).status).toBe(200);
    type Avatar = { avatar: { version: string; talk: null | { anchor: unknown; shapes: Record<string, string>; eyes?: { anchor: unknown; closed: string; half?: string } } } };
    const read = async () => {
      const response = await call("companions/avatar", token);
      return { body: await response.json() as Avatar, etag: response.headers.get("etag")! };
    };
    await runTalk(token, id);
    const review = await read();
    expect(review.body.avatar.talk).toBeNull();
    await call(`companions/${id}/look/talk/approve`, token, "POST");
    const first = await read();
    expect(first.body.avatar.talk!.anchor).toEqual(MOUTH);
    expect(Object.keys(first.body.avatar.talk!.shapes).sort()).toEqual(["A", "B", "C", "D", "E", "F"]);
    expect(first.body.avatar.talk!.shapes.A).toBe(`/api/companions/${id}/talk/A`);
    expect(first.body.avatar.talk!.eyes).toMatchObject({ anchor: EYES, closed: `/api/companions/${id}/talk/eyes/closed`, half: `/api/companions/${id}/talk/eyes/half` });
    expect(first.etag).not.toBe(review.etag);
    await call(`companions/${id}/look/talk/anchors`, token, "PUT", { anchor: { ...MOUTH, x: 0.34 }, eyes_anchor: EYES });
    await call(`companions/${id}/look/talk/approve`, token, "POST");
    const moved = await read();
    expect(moved.etag).not.toBe(first.etag);
    await runTalk(token, id, { anchor: { ...MOUTH, x: 0.34 }, eyes_anchor: EYES });
    await call(`companions/${id}/look/talk/approve`, token, "POST");
    const remade = await read();
    expect(remade.etag).not.toBe(moved.etag);
    const cached = await call("companions/avatar", token, "GET", undefined, { "if-none-match": remade.etag });
    expect(cached.status).toBe(304);
  });
});
