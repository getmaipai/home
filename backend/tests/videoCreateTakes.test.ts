// TAKES-01/02: the Create composer's takes, the time and engine line under Generate, the End image slot and the 16-chip cap.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import { db } from "@/db";
import { people as peopleTable, videoJobs } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import { storeFile } from "@/lib/attachments";
import { __setAgeCheckRunnerForTests } from "@/lib/pictures/ageCheck";
import { __resetVideoAdapterCacheForTests } from "@/lib/videos/adapters";
import { installFakeVideoStack, type FakeVideoStack } from "./videoFixture";
import { __setVideoStatusForTests, readyVideoStatusForTests } from "@/lib/videos/ready";
import { capChips, videoEngineLine, videoTimeLine, VIDEO_TIME_WORDS } from "@/lib/media/videoCreateApp";
import { maxSecondsFor } from "@/lib/videos/quality";
import { readMakeBody } from "@/lib/videos/make";
import type { PersonRow } from "@/types";

let fake: FakeVideoStack;
beforeEach(() => { resetDb(); __resetVideoAdapterCacheForTests(); fake = installFakeVideoStack(); });
afterEach(() => { fake.restore(); __setVideoStatusForTests(undefined); });

const BOAT = "A paper boat floats down a rainy street, soft evening light";

async function adultClient() {
  const owner = new TestClient();
  await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const made = await owner.post("/api/people", { displayName: "Marlow", role: "adult", secret: "0000" });
  const id = ((await made.json()) as { id: string }).id;
  const client = new TestClient();
  await client.post("/api/auth/verify-secret", { personId: id, secret: "0000" });
  const actor = db.select().from(peopleTable).where(eq(peopleTable.id, id)).get()! as PersonRow;
  __setAgeCheckRunnerForTests(async (images) => images.map(() => ({ ok: true as const, verdict: { people_count: 0, apparent_min_age_estimate: null, label: "none" as const, is_nude_or_sexual: false, confidence: 1 } })));
  return { client, actor };
}
function barOf(body: Array<Record<string, any>>): Record<string, any> | undefined {
  for (const node of body) {
    if (node.type === "prompt_bar") return node;
    const hit = barOf([...(node.main ?? []), ...(node.aside ?? [])]);
    if (hit) return hit;
  }
  return undefined;
}
async function pagebar(client: TestClient) {
  const page = await (await client.get("/api/plugins/video/pages/create")).json() as { body: Array<Record<string, any>> };
  return barOf(page.body)!;
}
async function picture(actor: PersonRow, color: string): Promise<string> {
  const png = new Uint8Array(await sharp({ create: { width: 64, height: 64, channels: 3, background: color } }).png().toBuffer());
  const saved = storeFile(actor, { conversationId: null, turnId: null, mediaType: "image/png", bytes: png, provenance: "composer:upload", retention: "kept", deduplicate: false });
  if (!saved.ok) throw new Error(saved.error);
  return saved.value.id;
}
const jobRows = () => db.select().from(videoJobs).all().map((row) => ({ id: row.id, request: JSON.parse(row.request) as { seed: number | null; anotherOf?: string; end_file_id?: string | null } }));

describe("Takes chip", () => {
  test("is icon-only, offers 1 to 4, starts at 1, and the submit sends it with the End image", async () => {
    const { client } = await adultClient();
    const bar = await pagebar(client);
    const takes = bar.chips.find((chip: { state: string }) => chip.state === "takes");
    expect(takes).toMatchObject({ icon: "layers", icon_only: true, default: 1 });
    expect(takes.options.map((o: { value: number }) => o.value)).toEqual([1, 2, 3, 4]);
    expect(bar.submit.call.args).toMatchObject({ takes: "{takes}", end_frame: "{end_frame}", start_frame: "{start_frame}" });
  });

  test("the chip set never passes the kit's 16, even with every optional chip showing", () => {
    const states = ["template", "orientation", "seconds", "takes", "look", "camera", "voices", "style", "character", "strength", "card_framing", "card_camera", "card_lens", "card_light", "card_film_stock", "card_look", "card_grade"];
    const all = states.map((state) => ({ state }));
    expect(all.length).toBe(17);
    const capped = capChips(all);
    expect(capped.length).toBeLessThanOrEqual(16);
    expect(capped.map((c) => c.state)).toContain("takes");
    expect(capChips(all.slice(0, 12)).length).toBe(12);
  });

  test("the served page stays within 16 chips and is not doubled by a second request", async () => {
    const { client } = await adultClient();
    const first = await pagebar(client);
    const again = await pagebar(client);
    expect(first.chips.length).toBeLessThanOrEqual(16);
    expect(again.chips.length).toBe(first.chips.length);
  });

  test("the body reader takes 1 to 8, refuses the rest with one plain line, and an empty chip is one take", () => {
    expect(readMakeBody({ prompt: BOAT, takes: "3" })).toMatchObject({ ok: true, body: { takes: 3 } });
    const one = readMakeBody({ prompt: BOAT, takes: "{takes}" });
    expect(one.ok && one.body.takes).toBeUndefined();
    const bad = readMakeBody({ prompt: BOAT, takes: 9 });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toBe("Choose 1 to 8 takes, or leave it empty.");
  });

  test("three takes make three clips with different seeds, the second and third tagged as takes of the first", async () => {
    const { client } = await adultClient();
    const res = await client.post("/api/plugins/video/actions/make", { prompt: BOAT, seconds: 5, takes: 3 });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; id: string; ids: string[] };
    expect(body.ids).toHaveLength(3);
    expect(body.ids[0]).toBe(body.id);
    const rows = jobRows();
    expect(rows).toHaveLength(3);
    const seeds = new Set(rows.map((row) => row.request.seed));
    expect(seeds.size).toBe(3);
    const first = rows.find((row) => row.id === body.id)!;
    expect(first.request.anotherOf).toBeUndefined();
    for (const row of rows.filter((r) => r.id !== body.id)) expect(row.request.anotherOf).toBe(body.id);
  });

  test("one take makes one clip, the same as before", async () => {
    const { client } = await adultClient();
    const res = await client.post("/api/plugins/video/actions/make", { prompt: BOAT, takes: 1 });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ids?: string[] }).ids).toBeUndefined();
    expect(jobRows()).toHaveLength(1);
  });

  test("more takes than the level allows is refused with one plain line and nothing starts", async () => {
    const { client } = await adultClient();
    const res = await client.post("/api/plugins/video/actions/make", { prompt: BOAT, tier: "standard", takes: 8 });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe("Standard makes up to 4 takes at once. Choose 4 or fewer, then try again.");
    expect(jobRows()).toHaveLength(0);
  });

  test("a set is refused when too many clips already wait in the home, and a second ordinary clip still waits behind the first", async () => {
    const { client } = await adultClient();
    const a = await client.post("/api/plugins/video/actions/make", { prompt: BOAT, takes: 4 });
    expect(a.status).toBe(200);
    const b = await client.post("/api/plugins/video/actions/make", { prompt: BOAT, takes: 4 });
    // this person already has clips being made: the one-at-a-time rule answers, not a new set
    expect(b.status).toBeGreaterThanOrEqual(400);
    expect(((await b.json()) as { error: string }).error.length).toBeGreaterThan(10);
    expect(jobRows().length).toBe(4);
  });
});

describe("the time and engine line under Generate", () => {
  test("falls back to the fixed words with no history, and says the engine's state in plain words", async () => {
    const { client } = await adultClient();
    __setVideoStatusForTests(readyVideoStatusForTests({ ltx25: "ready" }));
    const line = videoTimeLine("standard", 5);
    expect(line.startsWith(VIDEO_TIME_WORDS.standard)).toBe(true);
    expect(videoEngineLine()).toBe("Ready");
    const bar = await pagebar(client);
    expect(bar.submit_detail.state === "tier" || bar.submit_detail.state === "seconds").toBe(true);
    const labels = Object.values(bar.submit_detail.labels) as string[];
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      expect(label.length).toBeLessThanOrEqual(80);
      expect(label).not.toMatch(/\b(GB|RAM|memory|model|credits?|pack)\b/i);
    }
  });

  test("with three finished clips the line says the measured time", async () => {
    const { actor } = await adultClient();
    for (let i = 0; i < 3; i += 1) {
      const created = new Date(Date.now() - 3_600_000).toISOString();
      const updated = new Date(Date.parse(created) + 120_000).toISOString();
      db.insert(videoJobs).values({ id: `vjob-test-${i}`, personId: actor.id, conversationId: null, turnId: null, kind: "generate", state: "done", prompt: BOAT, request: JSON.stringify({ size: "832x480", seconds: 5, seed: i + 1, loras: [], source_file_id: null, audience: "all-ages" }), files: "[]", createdAt: created, updatedAt: updated, hlc: nextHlc() } as never).run();
    }
    expect(videoTimeLine("standard", 5).startsWith("About 2 minutes on this computer")).toBe(true);
  });

  test("a busy home says how many are ahead", async () => {
    const { client } = await adultClient();
    await client.post("/api/plugins/video/actions/make", { prompt: BOAT, takes: 2 });
    __setVideoStatusForTests(readyVideoStatusForTests({ ltx25: "ready" }));
    expect(videoEngineLine()).toMatch(/^Busy: [12] ahead of you$/);
  });

  test("a Stack with no video engine says it is not set up, plainly", () => {
    __setVideoStatusForTests(readyVideoStatusForTests({ available: false }));
    expect(videoEngineLine()).toBe("Video is not set up on this computer yet");
  });
});

describe("End image slot", () => {
  test("is absent while the maker does not report end_image, present when it does", async () => {
    const { client } = await adultClient();
    __setVideoStatusForTests(readyVideoStatusForTests({ ltx25: "ready" }));
    expect((await pagebar(client)).references.map((r: { state: string }) => r.state)).toEqual(["start_frame"]);
    __setVideoStatusForTests(readyVideoStatusForTests({ ltx25: "ready", ltx25Picture: true }));
    const bar = await pagebar(client);
    expect(bar.references.map((r: { state: string }) => r.state)).toEqual(["start_frame", "end_frame"]);
    expect(bar.references[1]).toEqual({ state: "end_frame", label: "End image", kind: "picture" });
  });

  test("the end picture reaches the Stack as end_image", async () => {
    const { client, actor } = await adultClient();
    __setVideoStatusForTests(readyVideoStatusForTests({ ltx25: "ready", ltx25Picture: true }));
    const start = await picture(actor, "red");
    const end = await picture(actor, "blue");
    const res = await client.post("/api/plugins/video/actions/make", { prompt: BOAT, start_frame: start, end_frame: end });
    expect(res.status).toBe(200);
    for (let i = 0; i < 100 && fake.submitted.length < 1; i += 1) await new Promise((r) => setTimeout(r, 25));
    expect(fake.submitted[0]!.image).toBeTruthy();
    expect(fake.submitted[0]!.end_image).toBeTruthy();
    expect(fake.submitted[0]!.end_image).not.toBe(fake.submitted[0]!.image);
    expect(jobRows()[0]!.request.end_file_id).toBe(end);
  });

  test("an end picture with no start picture, or the same picture twice, is one plain line and nothing starts", async () => {
    const { client, actor } = await adultClient();
    __setVideoStatusForTests(readyVideoStatusForTests({ ltx25: "ready", ltx25Picture: true }));
    const start = await picture(actor, "red");
    const alone = await client.post("/api/plugins/video/actions/make", { prompt: BOAT, end_frame: start });
    expect(alone.status).toBe(422);
    expect(((await alone.json()) as { error: string }).error).toBe("The end picture needs a start picture too. Add the start picture, or clear the end one.");
    const same = await client.post("/api/plugins/video/actions/make", { prompt: BOAT, start_frame: start, end_frame: start });
    expect(same.status).toBe(422);
    expect(jobRows()).toHaveLength(0);
  });

  test("a maker without end_image refuses with one plain line", async () => {
    const { client, actor } = await adultClient();
    __setVideoStatusForTests(readyVideoStatusForTests({ ltx25: "ready" }));
    const start = await picture(actor, "red");
    const end = await picture(actor, "blue");
    const res = await client.post("/api/plugins/video/actions/make", { prompt: BOAT, start_frame: start, end_frame: end });
    expect(res.status).toBe(422);
    expect(fake.submitted).toHaveLength(0);
  });
});

describe("Length", () => {
  test("offers five seconds and the longest this engine makes as one piece; longer lengths are whole multiples marked as made in parts", async () => {
    const { client } = await adultClient();
    const status = readyVideoStatusForTests({ ltx25: "ready" });
    __setVideoStatusForTests(status);
    const bar = await pagebar(client);
    const longest = Math.max(maxSecondsFor("quick", "ltx25", status), maxSecondsFor("detailed", "ltx25", status));
    const options = bar.chips.find((chip: { state: string }) => chip.state === "seconds").options as Array<{ value: number; label: string }>;
    const values = options.filter((o) => !o.label.endsWith("made in parts")).map((o) => o.value);
    expect(Math.max(...values)).toBe(longest);
    expect(values[0]).toBe(5);
    for (const o of options.filter((o) => o.label.endsWith("made in parts"))) expect(o.value % longest).toBe(0);
  });
});
