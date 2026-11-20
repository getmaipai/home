// FILM-PAGE-01: the Film maker page of the Video app, through to the film backend: plan, draft all, keep or skip, change a shot, finish kept, cut to the beat,
// with the refusals each gate gives. The picture, clip and music engines are fakes; the routes, rows and runs are the real ones.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { PageNodeSchema } from "@/kit/schema/types";
import { createMediaSubject } from "@/lib/mediaSubjects";
import { __setFilmPlanCompleterForTests } from "@/lib/films/plan";
import { __setFilmEnginesForTests } from "@/lib/films/background";
import { getFilmRun } from "@/lib/films/store";
import { activityForViewer } from "@/lib/activity";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { filmRuns, videoJobs } from "@/db/schema";
import { resetDb } from "./reset-db";
import { household } from "./fixtures/adultLock";
import { owner as signedInOwner } from "./support/testAuth";
import type { TestClient } from "./client";
import type { PersonRow } from "@/types";

const plan = { title: "Crossing", summary: "A short crossing.", cast: [{ name: "Willow", kind: "character", locked: "Blue coat." }], shots: [
  { id: "one", subject_ids: [], framing: "wide", still: "Willow in a blue coat on a long pier.", motion: "Walks slowly.", seconds: 5 },
  { id: "two", subject_ids: [], framing: "close", still: "Willow in a blue coat looking up.", motion: "Looks up.", seconds: 5 },
  { id: "three", subject_ids: [], framing: "wide", still: "Willow in a blue coat at the far end.", motion: "Stops.", seconds: 5 },
], music: "Soft piano.", credits: [] };
const wait = () => new Promise((resolve) => setTimeout(resolve, 10));
async function until(fn: () => boolean) { for (let i = 0; i < 300 && !fn(); i++) await wait(); expect(fn()).toBe(true); }
const T = "/api/plugins/video";
let calls: string[];
beforeEach(() => {
  resetDb(); calls = [];
  __setFilmPlanCompleterForTests(async () => ({ ok: true, text: JSON.stringify(plan) }));
  __setFilmEnginesForTests(({ actor }) => ({
    waitForIdle: async () => {},
    ensureSubject: async ({ name, kind, locked }) => { calls.push("cast"); return createMediaSubject(actor, { name, kind, look: locked }).id; },
    makeStill: async ({ shot }) => { calls.push(`still:${shot.id}`); return `pic:${shot.id}:${calls.length}`; },
    makeClip: async ({ shot }) => { calls.push(`clip:${shot.id}`); return `clip:${shot.id}`; },
    makeMusic: async () => { calls.push("music"); return "music"; },
    assemble: async ({ plan: finished, clipFileIds }) => { calls.push(`assemble:${finished.shots.map((s) => s.id).join("+")}:${clipFileIds.length}`); return "cut"; },
  }));
});
afterEach(() => { __setFilmPlanCompleterForTests(null); __setFilmEnginesForTests(null); });

const rows = async (client: TestClient, scope: string, id?: string) => (await (await client.post(`${T}/data/recipes`, { scope, ...(id ? { id } : {}) })).json()) as Array<Record<string, any>>;
async function planned(client: TestClient, row: PersonRow, body: Record<string, unknown> = {}) {
  const res = await client.post(`${T}/actions/film-plan`, { prompt: "A woman in a blue coat crosses a long pier at dusk", ...body });
  expect(res.status).toBe(200);
  const { id } = await res.json() as { id: string };
  await until(() => getFilmRun(row, id)?.state === "waiting_for_go");
  return id;
}

describe("the served Film maker page", () => {
  test("validates against the kit page schema for an adult and is closed to a teen and a child", async () => {
    const { owner, teen, child } = await household();
    const page = await owner.get(`${T}/pages/film-maker`);
    expect(page.status).toBe(200);
    const doc = await page.json() as { body: Array<Record<string, any>> };
    expect(PageNodeSchema.safeParse(doc).success).toBe(true);
    const bar = doc.body.find((node) => node.type === "prompt_bar")!;
    // Every chip is icon only; the format chip lists the reel catalog and the shot chip says there are no shots yet.
    expect(bar.chips.every((chip: any) => chip.icon_only === true && typeof chip.icon === "string")).toBe(true);
    expect(bar.chips.find((chip: any) => chip.state === "format").options.length).toBeGreaterThan(2);
    expect(bar.chips.find((chip: any) => chip.state === "shot").options).toEqual([{ value: "none", label: "No shots yet" }]);
    expect([403, 404]).toContain((await teen.client.get(`${T}/pages/film-maker`)).status);
    expect([403, 404]).toContain((await child.client.get(`${T}/pages/film-maker`)).status);
  });

  test("a teen and a child get no rows and no action starts a film", async () => {
    const { teen, child } = await household();
    for (const who of [teen.client, child.client]) {
      expect((await who.post(`${T}/data/recipes`, { scope: "film" })).status).toBe(404);
      expect((await who.post(`${T}/data/recipes`, { scope: "storyboard-voiced" })).status).toBe(404);
      expect((await who.post(`${T}/data/recipes`, { scope: "film-voiced" })).status).toBe(404);
      for (const name of ["film-plan", "film-draft", "film-review", "film-shot", "film-again", "film-finish", "film-beat", "film-voiced-preview"]) expect((await who.post(`${T}/actions/${name}`, { prompt: "A boat crosses a lake", run: "x", shot: "y" })).status).toBe(404);
    }
  });
});

describe("plan, draft, keep or skip, finish", () => {
  test("a sentence plans the shot list, Draft all makes only pictures, skipped shots are left out, Finish kept joins the kept ones", async () => {
    const { client: owner, row } = await signedInOwner();
    const id = await planned(owner, row, { format: "day-in-the-life", seconds: "30" });
    const planRun = getFilmRun(row, id)!;
    expect(planRun.idea).toContain("Day in the life");
    expect(planRun.plan?.target_seconds).toBe(30);
    expect(calls).toEqual([]);
    const film = (await rows(owner, "film"))[0]!;
    expect(film).toMatchObject({ id, can_draft: true, can_finish: false, can_beat: false, making: "no" });
    const shots = await rows(owner, "film-shots");
    expect(shots.length).toBe(planRun.plan!.shots.length);
    expect(shots[0]).toMatchObject({ status: "Not drafted", can_keep: false, can_skip: false, can_redo: true, thumbnail: null });

    expect((await owner.post(`${T}/actions/film-draft`, { run: id })).status).toBe(200);
    await until(() => getFilmRun(row, id)?.state === "waiting_for_go" && calls.some((c) => c.startsWith("still:")));
    expect(calls.some((c) => c.startsWith("clip:") || c === "music" || c.startsWith("assemble"))).toBe(false);
    const drafted = await rows(owner, "film-shots");
    expect(drafted.every((s) => s.status === "Draft" && s.can_keep && s.can_skip && typeof s.thumbnail === "string")).toBe(true);
    expect((await rows(owner, "film"))[0]).toMatchObject({ can_draft: false, can_finish: true });

    const skippedId = drafted[1]!.id as string;
    expect((await owner.post(`${T}/actions/film-review`, { run: id, shot: skippedId, keep: false })).status).toBe(200);
    expect((await owner.post(`${T}/actions/film-review`, { run: id, shot: drafted[0]!.id, keep: true })).status).toBe(200);
    const reviewed = await rows(owner, "film-shots");
    expect(reviewed.find((s) => s.id === skippedId)).toMatchObject({ status: "Skipped", can_keep: true, can_skip: false });
    expect(reviewed[0]).toMatchObject({ status: "Kept", can_keep: false, can_skip: true });

    expect((await owner.post(`${T}/actions/film-finish`, { run: id })).status).toBe(200);
    await until(() => getFilmRun(row, id)?.state === "done");
    expect(calls.filter((c) => c.startsWith("clip:")).sort()).toEqual(planRun.plan!.shots.filter((s) => s.id !== skippedId).map((s) => `clip:${s.id}`).sort());
    expect(calls.find((c) => c.startsWith("assemble:"))!.endsWith(":2")).toBe(true);
    expect(getFilmRun(row, id)).toMatchObject({ film_file_id: "cut", state: "done" });
    expect((await rows(owner, "film"))[0]).toMatchObject({ can_beat: true, can_draft: false, can_finish: false });
  });

  test("Finish kept refuses with a plain line before any picture exists, and with fewer than two kept shots", async () => {
    const { client: owner, row } = await signedInOwner();
    const id = await planned(owner, row);
    const early = await owner.post(`${T}/actions/film-finish`, { run: id });
    expect(early.status).toBe(422);
    expect(((await early.json()) as { error: string }).error).toContain("Draft");
    await owner.post(`${T}/actions/film-draft`, { run: id });
    await until(() => getFilmRun(row, id)?.state === "waiting_for_go" && calls.filter((c) => c.startsWith("still:")).length === 3);
    for (const shot of ["one", "two"]) await owner.post(`${T}/actions/film-review`, { run: id, shot, keep: false });
    const few = await owner.post(`${T}/actions/film-finish`, { run: id });
    expect(few.status).toBe(422);
    expect(((await few.json()) as { error: string }).error).toContain("at least two");
    expect(calls.some((c) => c.startsWith("clip:"))).toBe(false);
  });

  test("Make this shot again redraws only that picture while drafting, and a finished film accepts a redo", async () => {
    const { client: owner, row } = await signedInOwner();
    const id = await planned(owner, row);
    await owner.post(`${T}/actions/film-draft`, { run: id });
    await until(() => getFilmRun(row, id)?.state === "waiting_for_go" && calls.filter((c) => c.startsWith("still:")).length === 3);
    const before = (await rows(owner, "film-shots")).map((s) => s.thumbnail);
    expect((await owner.post(`${T}/actions/film-again`, { run: id, shot: "two" })).status).toBe(200);
    await until(() => getFilmRun(row, id)?.state === "waiting_for_go" && calls.filter((c) => c === "still:two").length === 2);
    expect(calls.filter((c) => c === "still:one").length).toBe(1);
    const after = (await rows(owner, "film-shots")).map((s) => s.thumbnail);
    expect(after[0]).toBe(before[0]);
    expect(after[1]).not.toBe(before[1]);
    expect((await owner.post(`${T}/actions/film-finish`, { run: id })).status).toBe(200);
    await until(() => getFilmRun(row, id)?.state === "done");
    // A finished film's redo is the backend's own `redoFilmRunShot` (it builds the real engines, so only the start is checked here): it is accepted for a shot
    // of the film and refused for one that is not.
    expect((await owner.post(`${T}/actions/film-again`, { run: id, shot: "nope" })).status).toBe(422);
    expect((await owner.post(`${T}/actions/film-again`, { run: id, shot: "three" })).status).toBe(200);
    expect(getFilmRun(row, id)?.state).toBe("running");
    await owner.post(`/api/films/${id}/cancel`, {});
  });
  test("Change a shot edits its words, seconds and camera; new words clear that picture", async () => {
    const { client: owner, row } = await signedInOwner();
    const id = await planned(owner, row);
    await owner.post(`${T}/actions/film-draft`, { run: id });
    await until(() => getFilmRun(row, id)?.state === "waiting_for_go" && calls.filter((c) => c.startsWith("still:")).length === 3);
    const res = await owner.post(`${T}/actions/film-shot`, { run: id, shot: "one", prompt: "Willow in a blue coat stands at the very end of a stormy pier.", shot_seconds: "8", camera: "pan_left" });
    expect(res.status).toBe(200);
    expect(getFilmRun(row, id)!.plan!.shots[0]).toMatchObject({ still: "Willow in a blue coat stands at the very end of a stormy pier.", seconds: 8, motion: "pan left" });
    const shots = await rows(owner, "film-shots");
    expect(shots[0]).toMatchObject({ status: "Not drafted", thumbnail: null });
    expect(shots[1]!.status).toBe("Draft");
    // Seconds alone keep the picture; nonsense is refused with a plain line.
    await owner.post(`${T}/actions/film-shot`, { run: id, shot: "two", shot_seconds: "7" });
    expect((await rows(owner, "film-shots"))[1]).toMatchObject({ status: "Draft" });
    for (const bad of [{ shot_seconds: "99" }, { prompt: "short" }, {}, { shot_seconds: "x" }]) {
      const refused = await owner.post(`${T}/actions/film-shot`, { run: id, shot: "two", ...bad });
      expect(refused.status).toBe(422);
      expect(((await refused.json()) as { error: string }).error.length).toBeGreaterThan(10);
    }
    // Not the Latest film of someone else.
    expect((await owner.post(`${T}/actions/film-shot`, { run: id, shot: "nope", prompt: "A long enough sentence about a pier." })).status).toBe(422);
  });
});

describe("refusals and access", () => {
  test("plan refuses an empty sentence, an unknown style, a bad length and an unknown cast member, each with a plain line", async () => {
    const { client: owner } = await signedInOwner();
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ prompt: "ab" }, "Describe the film"],
      [{ prompt: "A woman crosses a pier", format: "not-a-format" }, "film style"],
      [{ prompt: "A woman crosses a pier", seconds: "5" }, "between 10 and 300"],
      [{ prompt: "A woman crosses a pier", cast: "someone-who-is-not-there" }, "cast"],
    ];
    for (const [body, words] of cases) {
      const res = await owner.post(`${T}/actions/film-plan`, body);
      expect(res.status).toBe(422);
      expect((((await res.json()) as { error: string }).error).toLowerCase()).toContain(words.toLowerCase());
    }
    expect(calls).toEqual([]);
  });

  test("a second film is refused while one is planning, and another person cannot see or act on a film", async () => {
    const { owner, adult, row } = await household();
    let release!: () => void; const hold = new Promise<void>((resolve) => { release = resolve; });
    __setFilmPlanCompleterForTests(async () => { await hold; return { ok: true, text: JSON.stringify(plan) }; });
    const first = await owner.post(`${T}/actions/film-plan`, { prompt: "A woman in a blue coat crosses a long pier" });
    expect(first.status).toBe(200);
    const second = await owner.post(`${T}/actions/film-plan`, { prompt: "A boat crosses a lake at dawn" });
    expect(second.status).toBe(422);
    expect(((await second.json()) as { error: string }).error).toContain("already running");
    release();
    const { id } = await first.json() as { id: string };
    await until(() => getFilmRun(row("Sage"), id)?.state === "waiting_for_go");
    expect(await rows(adult.client, "film")).toEqual([]);
    expect((await adult.client.post(`${T}/actions/film-draft`, { run: id })).status).toBe(404);
    expect(calls).toEqual([]);
  });

  test("a film shows in the Activity list while it is planned, with a link back to the page", async () => {
    const { client: owner, row } = await signedInOwner();
    const id = await planned(owner, row);
    const item = activityForViewer(row).items.find((entry) => entry.id === `film:${id}`);
    expect(item).toMatchObject({ state: "attention", href: "/apps/video/film-maker", title: "Crossing" });
  });
  test("the storyboard rows and the render bar for a planned film: the silent animatic, one row per kept shot, no picture yet, a plain reason, and none for a teen (VF-UI-09)", async () => {
    const { adult, teen, row } = await household();
    const owner = adult.client;
    const id = await planned(owner, row("Marlow"));
    const shots = await rows(owner, "storyboard");
    const run = getFilmRun(row("Marlow"), id)!;
    expect(shots.map((r) => r.shot_id)).toEqual(run.plan!.shots.map((shot) => shot.id));
    for (const shot of shots) {
      expect(shot).toMatchObject({ status: "no_picture", still: null, clip: null, line_audio: null, line_wave: null });
      expect(shot.duration_sec).toBeGreaterThan(0);
      expect(String(shot.caption).length).toBeGreaterThan(0);
      expect(JSON.stringify(shot)).not.toMatch(/ltx|wan|h3|minimax|\d{3,4}\s*[x×]\s*\d{3,4}/i);
    }
    const bar = await rows(owner, "render-plan");
    expect(bar).toEqual([{ run_id: id, ready: false, reason: expect.stringMatching(/no picture yet\. Draft all makes them\.$/) }]);
    expect((await teen.client.post(`${T}/data/recipes`, { scope: "storyboard" })).status).toBe(404);
    expect((await teen.client.post(`${T}/data/recipes`, { scope: "render-plan" })).status).toBe(404);
  });

  test("the rough-cut op's result becomes the same rows the page reads (the Stack's committed fixture), and the page's item_fields name exactly those keys", async () => {
    const { roughCutShotRows } = await import("@maipai/spec/stack/ts/stack-rough-cut.js");
    const fixture = JSON.parse((await import("node:fs")).readFileSync("node_modules/@maipai/spec/fixtures/stack-rough-cut-result/valid-six-shots-three-lines.json", "utf8"));
    const out = roughCutShotRows(fixture, { captions: { "shot-1": "1 · Kitchen" }, stills: { "shot-1": "/api/files/f1/thumb?w=640" }, lineTexts: {} });
    expect(out).toHaveLength(6);
    const page = JSON.parse((await import("node:fs")).readFileSync("packages/video/pages/film-maker.json", "utf8")) as { body: Array<Record<string, any>> };
    const player = page.body.find((node) => node.type === "storyboard_player")!;
    expect(Object.values(player.item_fields as Record<string, string>).sort()).toEqual(Object.keys(out[0]!).sort());
    expect(page.body.find((node) => node.type === "action_bar")!.primary.label).toBe("Render film");
  });

  test("a running film is one Activity row: its shot clips are folded into it, other clips stay their own rows (VF-FILMDOCK-01)", async () => {
    const { client: owner, row } = await signedInOwner();
    const id = await planned(owner, row);
    const sage = row;
    const stamp = new Date().toISOString();
    const job = (jobId: string) => db.insert(videoJobs).values({ id: jobId, personId: sage.id, kind: "generate", state: "running", percent: 40, phase: "generating", position: 0, prompt: "A woman crosses a pier", request: JSON.stringify({ size: "832x480", seconds: 5, audience: "all-ages" }), files: "[]", createdAt: stamp, updatedAt: stamp, hlc: "h" }).run();
    job("shot-job-1"); job("other-job");
    db.update(filmRuns).set({ state: "running", progressJson: JSON.stringify({ shots: { s1: { job_id: "shot-job-1" } } }) }).where(eq(filmRuns.id, id)).run();
    const ids = activityForViewer(sage).items.map((entry) => entry.id);
    expect(ids).toContain(`film:${id}`);
    expect(ids).not.toContain("video:shot-job-1");
    expect(ids).toContain("video:other-job");
    db.update(filmRuns).set({ state: "done" }).where(eq(filmRuns.id, id)).run();
    expect(activityForViewer(sage).items.map((entry) => entry.id)).toContain("video:shot-job-1");
  });

  test("VOICED-ROUGH-CUT-HOME-01: the voiced preview action runs in the background; a failure is a plain line on the film's own card, a pass clears it, an adult's other film is never touched", async () => {
    const { owner, row } = await household();
    const id = await planned(owner, row("Sage"));
    const { __setVoicedMakerForTests } = await import("@/lib/films/voicedPreview");
    __setVoicedMakerForTests((async () => ({ ok: false, line: "The voiced preview did not pass its check. Shot 2: its line is heard twice. Render that shot again." })) as never);
    const res = await owner.post(`${T}/actions/film-voiced-preview`, { run: id });
    expect(res.status).toBe(200);
    await until(() => (getFilmRun(row("Sage"), id)?.note ?? "").includes("did not pass its check"));
    __setVoicedMakerForTests((async () => ({ ok: true, fileId: "f", seconds: 30, shots: 3, lines: 1, note: null })) as never);
    expect((await owner.post(`${T}/actions/film-voiced-preview`, { run: id })).status).toBe(200);
    await until(() => getFilmRun(row("Sage"), id)?.note === null);
    expect((await owner.post(`${T}/actions/film-voiced-preview`, { run: "film-nope" })).status).toBe(404);
    __setVoicedMakerForTests(null);
  });

  test("the film-voiced offer is one row only when the Stack lists media.rough_cut, the film is waiting with a plan that has a line, for an adult; unknown reads as not offered", async () => {
    const { owner, row } = await household();
    const { __setStackHttpFetchForTests, __resetRoughCutAvailabilityForTests, refreshRoughCutAvailability } = await import("@/lib/films/roughCut");
    const listing = (kinds: string[]) => __setStackHttpFetchForTests((async () => new Response(JSON.stringify({ media: { kinds } }), { status: 200 })) as unknown as typeof fetch);
    const id = await planned(owner, row("Sage"));
    expect(getFilmRun(row("Sage"), id)!.plan!.shots.some((shot) => shot.line)).toBe(false);
    __resetRoughCutAvailabilityForTests();
    // Never answered, and a plan with no line to speak: not offered.
    expect(await rows(owner, "film-voiced", id)).toEqual([]);
    const { updateFilmRun } = await import("@/lib/films/store");
    const run = getFilmRun(row("Sage"), id)!;
    updateFilmRun(row("Sage"), id, { plan: { ...run.plan!, shots: run.plan!.shots.map((shot, i) => (i === 0 ? { ...shot, line: "Please put the blue mug back." } : shot)) } });
    listing(["media.edit"]); __resetRoughCutAvailabilityForTests(); await refreshRoughCutAvailability();
    expect(await rows(owner, "film-voiced", id)).toEqual([]);
    listing(["media.edit", "media.rough_cut"]); __resetRoughCutAvailabilityForTests(); await refreshRoughCutAvailability();
    const offered = await rows(owner, "film-voiced", id);
    expect(offered).toEqual([{ run_id: id, reason: "Hear the lines in the voices of your cast." }]);
    __setStackHttpFetchForTests(null); __resetRoughCutAvailabilityForTests();
  });

  test("the page's one storyboard shows the voiced preview's rows once a fresh one exists, and the silent rows again when the plan changes", async () => {
    const { client: owner, row } = await signedInOwner();
    const id = await planned(owner, row);
    const run = getFilmRun(row, id)!;
    const silent = await rows(owner, "storyboard");
    expect(silent.every((r) => r.line_audio === null)).toBe(true);
    const { storeFile } = await import("@/lib/attachments");
    const { planFingerprint } = await import("@/lib/films/roughCut");
    const fixture = JSON.parse((await import("node:fs")).readFileSync("node_modules/@maipai/spec/fixtures/stack-rough-cut-result/valid-six-shots-three-lines.json", "utf8"));
    const saved = storeFile(row, { conversationId: null, turnId: null, mediaType: "video/mp4", bytes: new Uint8Array([1, 2, 3]), retention: "kept", name: "preview.mp4", deduplicate: false, provenance: `video-edit:${JSON.stringify({ v: 1, kind: "film-rough-cut", production: run.production_id, shots: 3, seconds: 15, plan: planFingerprint(run.plan!), result: { total_s: fixture.total_s, shots: fixture.shots, lines: fixture.lines.map((line: { audio: string }, n: number) => ({ ...line, audio: `/api/files/line-${n}/content` })) } })}` });
    expect(saved.ok).toBe(true);
    const voiced = await rows(owner, "storyboard");
    expect(voiced.some((r) => typeof r.line_audio === "string" && r.line_audio.startsWith("/api/files/"))).toBe(true);
    expect(voiced).toEqual(await rows(owner, "storyboard-voiced"));
    // the plan changes (a shot's length): the preview is stale, the silent rows come back
    const changed = { ...run.plan!, shots: run.plan!.shots.map((shot, index) => (index === 0 ? { ...shot, seconds: shot.seconds + 1 } : shot)) };
    db.update(filmRuns).set({ planJson: JSON.stringify({ plan: changed }) }).where(eq(filmRuns.id, id)).run();
    expect((await rows(owner, "storyboard")).every((r) => r.line_audio === null)).toBe(true);
  });

  test("the film card row carries the run's note as its own field, in the plain words written, empty when there is none; an adult only", async () => {
    const { owner, teen, row } = await household();
    const id = await planned(owner, row("Sage"));
    const { updateFilmRun } = await import("@/lib/films/store");
    expect((await rows(owner, "film", id))[0]!.note).toBe("");
    const line = "One line was left out of the voiced preview because it could not be used. The rest are spoken.";
    updateFilmRun(row("Sage"), id, { note: line });
    expect((await rows(owner, "film", id))[0]!.note).toBe(line);
    updateFilmRun(row("Sage"), id, { note: null });
    expect((await rows(owner, "film", id))[0]!.note).toBe("");
    expect((await teen.client.post(`${T}/data/recipes`, { scope: "film", id })).status).toBe(404);
  });

  test("the film card shows the run's note after its status line, so a voiced preview's working, failure and left-out lines are on the card", async () => {
    const page = JSON.parse((await import("node:fs")).readFileSync("packages/video/pages/film-maker.json", "utf8")) as { body: Array<Record<string, any>> };
    const card = page.body.find((node) => node.type === "media_shelf" && node.heading === "Your film")!;
    expect(card.item_subtitle_field).toBe("{subtitle} {note}");
  });

  // FILM-CANCEL-01
  describe("stop and resume a film (FILM-CANCEL-01)", () => {
    const addJob = (personId: string, jobId: string, state: string) => db.insert(videoJobs).values({ id: jobId, personId, kind: "generate", state, percent: 40, phase: "generating", position: 0, prompt: "A woman crosses a pier", request: JSON.stringify({ size: "832x480", seconds: 5, audience: "all-ages" }), files: "[]", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), hlc: "h" }).run();
    const jobState = (jobId: string) => db.select().from(videoJobs).where(eq(videoJobs.id, jobId)).get()!.state;

    test("Stop cancels the shot job in flight, keeps the finished one, shows Stopped (never Failed), and a second Stop does nothing", async () => {
      const { client: owner, row } = await signedInOwner();
      const id = await planned(owner, row);
      addJob(row.id, "done-job", "done"); addJob(row.id, "live-job", "running");
      db.update(filmRuns).set({ state: "running", progressJson: JSON.stringify({ shots: { one: { job_id: "done-job" }, two: { job_id: "live-job" } } }) }).where(eq(filmRuns.id, id)).run();
      expect((await rows(owner, "film-stop"))).toEqual([{ run_id: id, reason: expect.stringMatching(/stop it and carry on later/) }]);
      expect((await owner.post(`${T}/actions/film-cancel`, { run: id })).status).toBe(200);
      await until(() => jobState("live-job") === "cancelled");
      expect(jobState("done-job")).toBe("done");
      expect(getFilmRun(row, id)!.state).toBe("cancelled");
      const item = activityForViewer(row).items.find((entry) => entry.id === `film:${id}`)!;
      expect(item).toMatchObject({ state: "waiting", line: "Stopped. The shots already made are kept. Press Resume to carry on." });
      expect(await rows(owner, "film-stop")).toEqual([]);
      expect(await rows(owner, "film-resume")).toEqual([{ run_id: id, reason: "Stopped. The shots already made are kept. Press Resume to carry on." }]);
      expect((await owner.post(`${T}/actions/film-cancel`, { run: id })).status).toBe(200); // a second Stop changes nothing
      expect(getFilmRun(row, id)!.state).toBe("cancelled");
      expect(jobState("done-job")).toBe("done");
    });

    test("Resume starts the film again from the first unfinished shot; a teen cannot stop, resume or see the bars", async () => {
      const { adult, teen, row } = await household();
      const owner = adult.client;
      const id = await planned(owner, row("Marlow"));
      expect((await owner.post(`${T}/actions/film-draft`, { run: id })).status).toBe(200);
      await until(() => getFilmRun(row("Marlow"), id)?.state === "waiting_for_go" && calls.filter((c) => c.startsWith("still:")).length === 3);
      db.update(filmRuns).set({ state: "cancelled" }).where(eq(filmRuns.id, id)).run();
      const stills = calls.filter((c) => c.startsWith("still:")).length;
      expect((await owner.post(`${T}/actions/film-resume`, { run: id })).status).toBe(200);
      await until(() => calls.includes("clip:one") && calls.includes("clip:three"));
      expect(calls.filter((c) => c.startsWith("still:")).length).toBe(stills); // the pictures already made are kept, not made again
      await until(() => getFilmRun(row("Marlow"), id)?.state === "done");
      db.update(filmRuns).set({ state: "cancelled" }).where(eq(filmRuns.id, id)).run();
      for (const action of ["film-cancel", "film-resume"]) expect((await teen.client.post(`${T}/actions/${action}`, { run: id })).status).toBeGreaterThanOrEqual(403);
      for (const scope of ["film-stop", "film-resume"]) expect((await teen.client.post(`${T}/data/recipes`, { scope })).status).toBe(404);
    });
  });
});
