import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { resetDb } from "./reset-db";
import { __reloadPersonasForTests } from "@/lib/persona";
import { __clearCompanionLookJobsForTests } from "@/lib/companionLookJobs";
import { __setPicturesFetchForTests } from "@/lib/pictures/stack";
import { __setPictureStatusForTests, readyStatusForTests } from "@/lib/pictures/ready";
import { __setAgeCheckRunnerForTests, __resetAgeCheckForTests } from "@/lib/pictures/ageCheck";
import { __setChatPictureCapabilityForTests } from "@/lib/chatPictures";
import { LookSchema, EMPTY_LOOK, addVersion, readLook, updateSheet } from "@/lib/companionLook";
import { cutTalkCrop, makeTalkPicture, talkCropGeometry } from "@/lib/companionTalkMaker";
import { detectTalkAnchors, padAnchor, __setTalkAnchorCompletionForTests, TALK_ANCHORS_UNAVAILABLE } from "@/lib/companionTalkAnchors";
import { cancelTalkJob, publicTalkJob, startCompanionTalk } from "@/lib/companionTalkJobs";
import { AGE_OK, AGE_WITHHELD, EYES, MOUTH, SIZE, addPerson, installFakeStack, makeCompanion, personRow, restPicture, waitForTalk } from "./companionTalkFixture";

const companionRoot = join(process.env.MAIPAI_DATA_DIR!, "companions");

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
}

beforeEach(() => {
  reset();
  __setPictureStatusForTests(readyStatusForTests());
  __setAgeCheckRunnerForTests(async (images) => images.map(() => AGE_OK));
});
afterEach(reset);

describe("companion talk data", () => {
  test("old look records still parse and talk uses fractional anchors", () => {
    expect(LookSchema.parse(EMPTY_LOOK).sheet).toBeNull();
    const look = LookSchema.parse({
      ...EMPTY_LOOK,
      sheet: {
        views: { left: null, right: null, mouth: null },
        card: null,
        key: "#00FF00",
        state: "needs_review",
        approved_by: null,
        approved_at: null,
        talk: { state: "needs_review", maker: "crop-edit", anchor: { x: 0.5, y: 0.5, w: 0.1, h: 0.08 }, eyes_anchor: { x: 0.5, y: 0.3, w: 0.3, h: 0.1 }, shapes: {}, eyes: {} },
      },
    });
    expect(look.sheet?.talk?.anchor.w).toBe(0.1);
  });
});

describe("talk maker", () => {
  test("the geometry centre is x + w/2, y + h/2 of the anchor", () => {
    const g = talkCropGeometry(SIZE, SIZE, MOUTH);
    expect(g.left + g.cx).toBeCloseTo((MOUTH.x + MOUTH.w / 2) * SIZE, 0);
    expect(g.top + g.cy).toBeCloseTo((MOUTH.y + MOUTH.h / 2) * SIZE, 0);
    const eyes = talkCropGeometry(SIZE, SIZE, EYES, true);
    expect(eyes.left + eyes.cx).toBeCloseTo((EYES.x + EYES.w / 2) * SIZE, 0);
    expect(eyes.top + eyes.cy).toBeCloseTo((EYES.y + EYES.h / 2) * SIZE, 0);
  });

  test("only the paste ellipse changes, and it lies inside the anchor box", async () => {
    installFakeStack();
    const rest = await restPicture();
    const made = await makeTalkPicture({ rest, anchor: MOUTH, instruction: "Change only the mouth.", companionId: "hc-talk-test" });
    const before = await sharp(rest).removeAlpha().raw().toBuffer();
    const after = await sharp(made).removeAlpha().raw().toBuffer();
    const boxLeft = Math.round(MOUTH.x * SIZE);
    const boxTop = Math.round(MOUTH.y * SIZE);
    const boxRight = boxLeft + Math.round(MOUTH.w * SIZE);
    const boxBottom = boxTop + Math.round(MOUTH.h * SIZE);
    const cx = (MOUTH.x + MOUTH.w / 2) * SIZE;
    const cy = (MOUTH.y + MOUTH.h / 2) * SIZE;
    const rx = 0.46 * MOUTH.w * SIZE;
    const ry = 0.46 * MOUTH.h * SIZE;
    const featherMargin = 10;
    let changedInside = 0;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const at = (y * SIZE + x) * 3;
        const same = before[at] === after[at] && before[at + 1] === after[at + 1] && before[at + 2] === after[at + 2];
        const insideBox = x >= boxLeft && x < boxRight && y >= boxTop && y < boxBottom;
        const farOutside = ((x - cx) / (rx + featherMargin)) ** 2 + ((y - cy) / (ry + featherMargin)) ** 2 > 1;
        if (!insideBox) expect(same).toBe(true);
        if (farOutside) expect(same).toBe(true);
        if (!same) changedInside++;
      }
    }
    expect(changedInside).toBeGreaterThan(1000);
    const centre = (Math.round(cy) * SIZE + Math.round(cx)) * 3;
    expect(after[centre]).toBeLessThan(10);
    expect(before[centre]).not.toBe(after[centre]);
  });

  test("the request carries edit_masked, a shared seed and the instruction, and no face, fit or style", async () => {
    const fake = installFakeStack();
    const rest = await restPicture();
    await makeTalkPicture({ rest, anchor: MOUTH, instruction: "Change only the mouth: closed.", companionId: "hc-talk-seed" });
    await makeTalkPicture({ rest, anchor: EYES, instruction: "Change only the eyes: closed.", companionId: "hc-talk-seed", eyes: true });
    const [first, second] = fake.forms;
    expect(first!.get("operation")).toBe("edit_masked");
    expect(first!.get("instruction")).toBe("Change only the mouth: closed.");
    expect(first!.get("seed")).toBeTruthy();
    expect(second!.get("seed")).toBe(first!.get("seed"));
    for (const key of ["face", "fit", "style"]) expect(first!.has(key)).toBe(false);
  });

  test("cutTalkCrop returns exactly the anchor box", async () => {
    const crop = await cutTalkCrop(await restPicture(), MOUTH);
    const meta = await sharp(crop).metadata();
    expect(meta.width).toBe(Math.round(MOUTH.w * SIZE));
    expect(meta.height).toBe(Math.round(MOUTH.h * SIZE));
    const rest = await sharp(await restPicture()).extract({ left: Math.round(MOUTH.x * SIZE), top: Math.round(MOUTH.y * SIZE), width: meta.width!, height: meta.height! }).removeAlpha().raw().toBuffer();
    expect(Buffer.compare(rest, await sharp(crop).removeAlpha().raw().toBuffer())).toBe(0);
  });
});

describe("talk anchors", () => {
  test("padding grows around the centre and clamps to the picture", () => {
    const padded = padAnchor({ x: 0.4, y: 0.5, w: 0.1, h: 0.05 });
    expect(padded.w).toBeCloseTo(0.16, 6);
    expect(padded.h).toBeCloseTo(0.08, 6);
    expect(padded.x + padded.w / 2).toBeCloseTo(0.45, 6);
    expect(padded.y + padded.h / 2).toBeCloseTo(0.525, 6);
    const corner = padAnchor({ x: 0.95, y: 0.95, w: 0.05, h: 0.05 });
    expect(corner.x + corner.w).toBeLessThanOrEqual(1 + 1e-9);
    expect(corner.y + corner.h).toBeLessThanOrEqual(1 + 1e-9);
    expect(padAnchor({ x: 0.1, y: 0.1, w: 0.9, h: 0.9 })).toMatchObject({ x: 0, y: 0, w: 1, h: 1 });
  });

  test("detected anchors are padded", async () => {
    __setChatPictureCapabilityForTests({ imageParts: true, pictureTokensMax: 2560 });
    const mouth = { x: 0.4, y: 0.6, w: 0.1, h: 0.05 };
    const eyes = { x: 0.3, y: 0.3, w: 0.3, h: 0.05 };
    __setTalkAnchorCompletionForTests((async () => ({ ok: true, value: { text: JSON.stringify({ mouth, eyes }) } })) as never);
    const found = await detectTalkAnchors(await restPicture());
    expect(found.anchor).toEqual(padAnchor(mouth));
    expect(found.eyes_anchor).toEqual(padAnchor(eyes));
  });

  test("a failing or garbled reader gives the plain unavailable sentence", async () => {
    __setChatPictureCapabilityForTests({ imageParts: true, pictureTokensMax: 2560 });
    __setTalkAnchorCompletionForTests((async () => ({ ok: false, error: "offline" })) as never);
    await expect(detectTalkAnchors(await restPicture())).rejects.toThrow(TALK_ANCHORS_UNAVAILABLE);
    __setTalkAnchorCompletionForTests((async () => ({ ok: true, value: { text: "not json" } })) as never);
    await expect(detectTalkAnchors(await restPicture())).rejects.toThrow(TALK_ANCHORS_UNAVAILABLE);
  });
});

describe("talk job", () => {
  const anchors = { anchor: MOUTH, eyes_anchor: EYES };

  test("a full run makes eight steps and leaves a record waiting for review", async () => {
    installFakeStack();
    addPerson("talk-job-adult", "adult");
    const actor = personRow("talk-job-adult");
    const { id } = await makeCompanion("talk-job-adult", "Talk lifecycle");
    const job = await startCompanionTalk({ actor, companionId: id, anchors });
    expect(publicTalkJob(job, actor, id)!.steps).toHaveLength(8);
    const done = await waitForTalk(() => publicTalkJob(job, actor, id));
    expect(done.state).toBe("done");
    expect(publicTalkJob(job, actor, id)!.percent).toBe(100);
    const talk = readLook(id).sheet!.talk!;
    expect(talk.state).toBe("needs_review");
    expect(Object.keys(talk.shapes).sort()).toEqual(["A", "B", "C", "D", "E", "F"]);
    expect(Object.keys(talk.eyes).sort()).toEqual(["closed", "half"]);
    expect(talk.anchor).toEqual(MOUTH);
    expect(talk.eyes_anchor).toEqual(EYES);
  });

  test("a second start while one runs is busy (409), and one after it ended starts again", async () => {
    installFakeStack();
    addPerson("talk-busy-adult", "adult");
    const actor = personRow("talk-busy-adult");
    const { id } = await makeCompanion("talk-busy-adult", "Talk busy");
    const job = await startCompanionTalk({ actor, companionId: id, anchors });
    await expect(startCompanionTalk({ actor, companionId: id, anchors })).rejects.toMatchObject({ status: 409 });
    await waitForTalk(() => publicTalkJob(job, actor, id));
    const again = await startCompanionTalk({ actor, companionId: id, anchors });
    expect(again).not.toBe(job);
    await waitForTalk(() => publicTalkJob(again, actor, id));
  });

  test("cancel stops the job and frees the companion", async () => {
    installFakeStack();
    addPerson("talk-cancel-adult", "adult");
    const actor = personRow("talk-cancel-adult");
    const { id } = await makeCompanion("talk-cancel-adult", "Talk cancel");
    const job = await startCompanionTalk({ actor, companionId: id, anchors });
    expect(cancelTalkJob(job, actor, id)).toBe(true);
    expect(publicTalkJob(job, actor, id)!.state).toBe("cancelled");
    expect(cancelTalkJob(job, actor, id)).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(publicTalkJob(job, actor, id)!.state).toBe("cancelled");
    const next = await startCompanionTalk({ actor, companionId: id, anchors });
    await waitForTalk(() => publicTalkJob(next, actor, id));
  });

  test("a withheld picture fails the job with the withheld line and keeps nothing", async () => {
    installFakeStack();
    __setAgeCheckRunnerForTests(async (images) => images.map(() => AGE_WITHHELD));
    addPerson("talk-withheld-adult", "adult");
    const actor = personRow("talk-withheld-adult");
    const { id } = await makeCompanion("talk-withheld-adult", "Talk withheld");
    const job = await startCompanionTalk({ actor, companionId: id, anchors });
    const done = await waitForTalk(() => publicTalkJob(job, actor, id));
    expect(done.state).toBe("failed");
    expect(done.error).not.toBe("The talk pictures did not work. Try again.");
    expect((done.error ?? "").length).toBeGreaterThan(10);
    expect(Object.keys(readLook(id).sheet!.talk!.shapes)).toHaveLength(0);
  });

  test("a guest is refused like the sheet job, and so is a start while the engine is not ready", async () => {
    installFakeStack();
    addPerson("talk-gate-owner", "adult");
    const { id } = await makeCompanion("talk-gate-owner", "Talk gate");
    addPerson("talk-gate-guest", "guest");
    await expect(startCompanionTalk({ actor: personRow("talk-gate-guest"), companionId: id, anchors })).rejects.toMatchObject({ status: 403 });
    addPerson("talk-gate-adult", "adult");
    __setPictureStatusForTests(null);
    await expect(startCompanionTalk({ actor: personRow("talk-gate-adult"), companionId: id, anchors })).rejects.toMatchObject({ status: 503 });
  });

  test("a child and a teen run under their own safety check, which withholds an unsafe picture", async () => {
    installFakeStack();
    __setAgeCheckRunnerForTests(async (images) => images.map(() => AGE_WITHHELD));
    for (const role of ["child", "teen"]) {
      addPerson(`talk-band-${role}`, role);
      const actor = personRow(`talk-band-${role}`);
      const { id } = await makeCompanion(`talk-band-${role}`, `Talk band ${role}`);
      const job = await startCompanionTalk({ actor, companionId: id, anchors });
      const done = await waitForTalk(() => publicTalkJob(job, actor, id));
      expect(done.state).toBe("failed");
      expect(Object.keys(readLook(id).sheet!.talk!.shapes)).toHaveLength(0);
    }
  });

  test("a second run prunes the older talk pictures and leaves the rest, sheet views and other pictures alone", async () => {
    installFakeStack();
    addPerson("talk-prune-adult", "adult");
    const actor = personRow("talk-prune-adult");
    const { id, rest } = await makeCompanion("talk-prune-adult", "Talk prune");
    const png = await restPicture();
    const view = addVersion(id, png, { source: "edit", label: "Left view", width: SIZE, height: SIZE, from: rest });
    const other = addVersion(id, png, { source: "edit", label: "My own edit", width: SIZE, height: SIZE, from: rest });
    const sheet = readLook(id).sheet!;
    updateSheet(id, { ...sheet, views: { ...sheet.views, left: view.id } });
    const first = await startCompanionTalk({ actor, companionId: id, anchors });
    await waitForTalk(() => publicTalkJob(first, actor, id));
    const firstIds = readLook(id).versions.filter((item) => /^(Talk|Eyes) /.test(item.label)).map((item) => item.id);
    expect(firstIds).toHaveLength(8);
    const second = await startCompanionTalk({ actor, companionId: id, anchors });
    await waitForTalk(() => publicTalkJob(second, actor, id));
    const look = readLook(id);
    const talkIds = look.versions.filter((item) => /^(Talk|Eyes) /.test(item.label)).map((item) => item.id);
    expect(talkIds).toHaveLength(8);
    for (const old of firstIds) expect(talkIds).not.toContain(old);
    const kept = look.versions.map((item) => item.id);
    expect(kept).toContain(rest);
    expect(kept).toContain(view.id);
    expect(kept).toContain(other.id);
    expect(look.rest).toBe(rest);
    expect(look.sheet!.views.left).toBe(view.id);
  });
});
