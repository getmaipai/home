import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { db } from "@/db";
import { people } from "@/db/schema";
import { __setFilmPlanCompleterForTests } from "@/lib/films/plan";
import { makeFilm } from "@/lib/films/engines";
import type { PersonRow } from "@/types";
import { resetDb } from "./reset-db";
import { installFakeImageStack, until as waitForFake } from "./pictureFixture";
import { installFakeVideoStack } from "./videoFixture";
import { __setVideoStatusForTests, readyVideoStatusForTests } from "@/lib/videos/ready";
import { installFakeMusicStack } from "./musicFixture";
import { installFakeEditStack } from "./videoEditStackFixture";
import { __setAgeCheckRunnerForTests } from "@/lib/pictures/ageCheck";
import { __setKeyframesForTests } from "@/lib/pictures/keyframes";
import { getMediaProduction } from "@/lib/mediaProductions";
import { createMediaSubject } from "@/lib/mediaSubjects";
import { storeFile, readAttachment } from "@/lib/attachments";
import sharp from "sharp";
import { __setLookSheetMakerForTests } from "@/lib/castLook";
import { makeSheetFromPictures, cutOutPause } from "@/lib/films/sheetMaker";

function person(id: string, role: "adult" | "teen" | "child" = "adult"): PersonRow {
  const now = new Date().toISOString();
  db.insert(people).values({ id, displayName: id, role, avatarSeed: id, source: "local", createdAt: now, updatedAt: now, hlc: "1:0:test" }).run();
  return db.select().from(people).all().find((row) => row.id === id)!;
}

const plan = { title: "Quiet crossing", summary: "A quiet crossing.", cast: [{ name: "Willow", kind: "character", locked: "A blue coat." }], shots: [1, 2].map((n) => ({ id: `shot-${n}`, subject_ids: [], framing: "wide", still: "Willow in a blue coat.", motion: "The tide rolls gently.", seconds: 5 })), music: "Soft instrumental piano.", credits: [] };

describe("film engine entry", () => {
  let image: ReturnType<typeof installFakeImageStack>;
  let video: ReturnType<typeof installFakeVideoStack>;
  let music: ReturnType<typeof installFakeMusicStack>;
  let edit: ReturnType<typeof installFakeEditStack>;
  beforeEach(() => { resetDb(); __setFilmPlanCompleterForTests(null); cutOutPause.ms = 0; __setLookSheetMakerForTests((pictures) => makeSheetFromPictures(pictures, { removeBackground: async (bytes) => bytes, findFaces: async () => [] })); });
  afterEach(() => { image?.restore(); video?.restore(); music?.restore(); edit?.restore(); __setKeyframesForTests(null); __setLookSheetMakerForTests(null); });

  test("refuses a child before calling the planner or starting engines", async () => {
    let calls = 0;
    __setFilmPlanCompleterForTests(async () => { calls++; return { ok: true, text: JSON.stringify(plan) }; });
    expect(await makeFilm({ actor: person("person-filmchild", "child"), idea: "A crossing", signal: new AbortController().signal })).toEqual({ line: "Making a film is for adults on their own written screen." });
    expect(calls).toBe(0);
  });

  test("returns a planner refusal without creating a production", async () => {
    __setFilmPlanCompleterForTests(async () => ({ ok: false, unavailable: true }));
    const result = await makeFilm({ actor: person("person-filmadult"), idea: "A crossing", signal: new AbortController().signal });
    expect(result).toMatchObject({ line: expect.stringContaining("Resume") });
  });

  test("VF-ROUTE-01 follow-up: on a Stack whose catalog lists the keys, every clip is a film shot (look, line, start picture, no size); on one that lists none the old door makes it as before", async () => {
    process.env.MAIPAI_TEST_DOOR = "1";
    try {
      image = installFakeImageStack(); video = installFakeVideoStack(); __setVideoStatusForTests(readyVideoStatusForTests({ ltx25: "ready", ltx25Picture: true })); music = installFakeMusicStack(); edit = installFakeEditStack();
      __setAgeCheckRunnerForTests(async (images) => images.map(() => ({ ok: true as const, verdict: { people_count: 0, apparent_min_age_estimate: null, label: "none" as const, is_nude_or_sexual: false, confidence: 1 } })));
      __setKeyframesForTests(async () => [new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), new Uint8Array([0xff, 0xd8, 0xff, 0xe0])]);
      const shots = [1, 2, 3].map((n) => ({ id: `shot-${n}`, subject_ids: [], framing: "wide", still: `Willow in a blue coat, shot ${n}.`, motion: "The tide rolls gently.", seconds: 5, ...(n === 2 ? { line: "Please put the blue mug back." } : {}) }));
      __setFilmPlanCompleterForTests(async () => ({ ok: true, text: JSON.stringify({ ...plan, shots }) }));
      const actor = person("person-filmowner");
      const result = await makeFilm({ actor, idea: "A quiet crossing", signal: new AbortController().signal });
      expect("productionId" in result).toBe(true);
      const filmShots = video.makeRequests.filter((request) => request.operation === "clip_film_shot");
      expect(filmShots).toHaveLength(3);
      expect(filmShots.map((request) => request.look)).toEqual([1, 2, 3].map((n) => `Willow in a blue coat, shot ${n}.`));
      expect(filmShots[1]!.dialogue).toEqual([{ speaker: "Willow", text: "Please put the blue mug back." }]);
      expect("dialogue" in filmShots[0]!).toBe(false);
      for (const request of filmShots) { expect("size" in request).toBe(false); expect(String(request.start_picture)).toMatch(/^data:image\/png;base64,/); expect(request.level).toBe("standard"); }
    } finally { delete process.env.MAIPAI_TEST_DOOR; }
  });

  test("makes stills, clips, a song, and sequential film and mix edits, then keeps the artifacts on its production", async () => {
    image = installFakeImageStack(); video = installFakeVideoStack(); __setVideoStatusForTests(readyVideoStatusForTests({ ltx25: "ready", ltx25Picture: true })); music = installFakeMusicStack(); edit = installFakeEditStack();
    __setAgeCheckRunnerForTests(async (images) => images.map(() => ({ ok: true as const, verdict: { people_count: 0, apparent_min_age_estimate: null, label: "none" as const, is_nude_or_sexual: false, confidence: 1 } })));
    __setKeyframesForTests(async () => [new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), new Uint8Array([0xff, 0xd8, 0xff, 0xe0])]);
    const threeShotPlan = { ...plan, shots: [1, 2, 3].map((n) => ({ id: `shot-${n}`, subject_ids: [], framing: "wide", still: "Willow in a blue coat.", motion: "The tide rolls gently.", seconds: 5 })) };
    __setFilmPlanCompleterForTests(async () => ({ ok: true, text: JSON.stringify(threeShotPlan) }));
    const actor = person("person-filmowner");
    const result = await makeFilm({ actor, idea: "A quiet crossing", signal: new AbortController().signal });
    expect("productionId" in result).toBe(true);
    if (!("productionId" in result)) return;
    const production = getMediaProduction(actor, result.productionId)!;
    expect(image.submitted.filter((body) => body.size === "1024x576")).toHaveLength(3); // the three stills
    expect(image.submitted.filter((body) => body.size === "1024x1024" && String(body.prompt).startsWith("A clean picture of"))).toHaveLength(1); // the new character's portrait, which the one sheet builder (CREATOR-06) makes the look sheet from
    expect(video.submitted).toHaveLength(3);
    expect(music.submitted).toHaveLength(1);
    expect(edit.jobs).toHaveLength(2);
    expect(edit.jobs[0]?.input.ops.some((op) => op.op === "concat" || op.op === "transition")).toBe(true);
    expect(edit.jobs[1]?.input.ops.some((op) => op.op === "audio_overlay")).toBe(true);
    expect(production.episodes[0]?.scenes[0]?.shots.every((shot) => shot.picture_file_id && shot.clip_file_id)).toBe(true);
    expect(production.music_line_ids).toHaveLength(1);
    expect(production.finished_cut_file_ids.at(-1)).toBe(result.filmFileId);
    await waitForFake(() => edit.jobs.every((job) => job.state === "done"));
  });
  test("a shot whose only picture is a supplied place uses that photo itself as its first frame, with no image model", async () => {
    image = installFakeImageStack(); video = installFakeVideoStack(); __setVideoStatusForTests(readyVideoStatusForTests({ ltx25: "ready", ltx25Picture: true })); music = installFakeMusicStack(); edit = installFakeEditStack();
    __setAgeCheckRunnerForTests(async (images) => images.map(() => ({ ok: true as const, verdict: { people_count: 0, apparent_min_age_estimate: null, label: "none" as const, is_nude_or_sexual: false, confidence: 1 } })));
    __setKeyframesForTests(async () => [new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), new Uint8Array([0xff, 0xd8, 0xff, 0xe0])]);
    const actor = person("person-filmplace");
    const photo = new Uint8Array(await sharp({ create: { width: 640, height: 360, channels: 3, background: { r: 200, g: 30, b: 30 } } }).png().toBuffer());
    const stored = storeFile(actor, { conversationId: null, turnId: null, mediaType: "image/png", bytes: photo, provenance: `media-subject-reference:${JSON.stringify({ audience: "all-ages" })}`, deduplicate: false, retention: "kept" });
    if (!stored.ok) throw new Error("photo not stored");
    createMediaSubject(actor, { name: "Factory floor", kind: "place", look: "A bright indoor factory floor.", referenceIds: [stored.value.id] });
    const placePlan = { title: "The floor", summary: "A look at the floor.", cast: [{ name: "Willow", kind: "character", locked: "A blue coat." }, { name: "Factory floor", kind: "place", locked: "A bright indoor factory floor." }], shots: [1, 2].map((n) => ({ id: `shot-${n}`, subject_ids: [], framing: "wide", still: "Factory floor, wide.", motion: "A slow push in.", seconds: 5 })), music: "Soft instrumental piano.", credits: [] };
    __setFilmPlanCompleterForTests(async () => ({ ok: true, text: JSON.stringify(placePlan) }));
    const result = await makeFilm({ actor, idea: "A look at the floor", signal: new AbortController().signal });
    if (!("productionId" in result)) throw new Error(JSON.stringify(result));
    if (!("productionId" in result)) return;
    const shots = getMediaProduction(actor, result.productionId)!.episodes[0]!.scenes[0]!.shots;
    expect(image.submitted.filter((body) => String(body.prompt ?? "").includes("Factory floor, wide."))).toHaveLength(0);
    const first = readAttachment(actor, shots[0]!.picture_file_id!);
    if (!first.ok) throw new Error("still unreadable");
    const meta = await sharp(Buffer.from(first.value.bytes)).metadata();
    expect([meta.width, meta.height]).toEqual([1024, 576]);
    const stats = await sharp(Buffer.from(first.value.bytes)).stats();
    expect(stats.channels[0]!.mean).toBeGreaterThan(150); // his red photo, not a generated picture
    await waitForFake(() => edit.jobs.every((job) => job.state === "done"));
  });
});

