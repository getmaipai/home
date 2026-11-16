// FEED-HIDE-01: the Create feed's Hide and Show again, the Hidden view, take counts, "Made in N s" and the clip check's plain line.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import { db } from "@/db";
import { people as peopleTable } from "@/db/schema";
import { getVideoJobFor } from "@/lib/videos/jobs";
import { __resetVideoAdapterCacheForTests } from "@/lib/videos/adapters";
import { installFakeVideoStack, type FakeVideoStack } from "./videoFixture";
import { __setVideoStatusForTests } from "@/lib/videos/ready";
import { until } from "./pictureFixture";
import { updateCreationReview } from "@/lib/creations/store";
import { CLIP_FINDING_WORDS, clipFindingLine } from "@/lib/videos/frameCheck";
import type { PersonRow } from "@/types";

let fake: FakeVideoStack;
beforeEach(() => { resetDb(); __resetVideoAdapterCacheForTests(); fake = installFakeVideoStack(); });
afterEach(() => { fake.restore(); __setVideoStatusForTests(undefined); });

type Row = Record<string, any>;
async function household() {
  const owner = new TestClient();
  await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const signIn = async (displayName: string) => {
    const made = await owner.post("/api/people", { displayName, role: "adult", secret: "0000" });
    const created = (await made.json()) as { id: string };
    const client = new TestClient();
    await client.post("/api/auth/verify-secret", { personId: created.id, secret: "0000" });
    return client;
  };
  const adult = await signIn("Marlow");
  const other = await signIn("Quill");
  const row = (name: string) => db.select().from(peopleTable).where(eq(peopleTable.displayName, name)).get()! as PersonRow;
  return { adult, other, row };
}
const feed = async (client: TestClient, extra: Record<string, unknown> = {}) => (await client.post("/api/plugins/video/data/recipes", { scope: "feed", ...extra })).json() as Promise<Row[]>;
const action = (client: TestClient, name: string, body: Record<string, unknown>) => client.post(`/api/plugins/video/actions/${name}`, body);
async function makeClip(client: TestClient, actor: PersonRow) {
  const made = await (await client.post("/api/videos/make", { prompt: "A paper boat floats down a rainy street" })).json() as { id: string };
  await until(() => getVideoJobFor(actor, made.id)?.state === "done");
  return { jobId: made.id, fileId: getVideoJobFor(actor, made.id)!.files[0]!.id };
}

describe("hide and show again", () => {
  test("a hidden clip leaves the default feed, shows in the Hidden view, and comes back; nothing is deleted", async () => {
    const { adult, row } = await household();
    const clip = await makeClip(adult, row("Marlow"));
    expect((await feed(adult))[0]).toMatchObject({ id: clip.jobId, can_hide: true });
    expect((await feed(adult))[0]!.hidden).toBeUndefined();
    const hid = await action(adult, "hide", { id: clip.jobId });
    expect(hid.status).toBe(200);
    expect(await hid.json()).toMatchObject({ ok: true, hidden: true });
    expect(await feed(adult)).toEqual([]);
    const hidden = await feed(adult, { hidden: true });
    expect(hidden.map((r) => r.id)).toEqual([clip.jobId]);
    expect(hidden[0]!.hidden).toBe(true);
    expect(getVideoJobFor(row("Marlow"), clip.jobId)!.files[0]!.id).toBe(clip.fileId);
    // Hide with no flag flips it back (the one card entry); unhide always shows.
    expect(await (await action(adult, "hide", { id: clip.jobId })).json()).toMatchObject({ hidden: false });
    expect((await feed(adult)).map((r) => r.id)).toEqual([clip.jobId]);
    await action(adult, "hide", { id: clip.jobId });
    expect((await action(adult, "unhide", { id: clip.jobId })).status).toBe(200);
    expect(await feed(adult, { hidden: true })).toEqual([]);
    expect((await feed(adult)).length).toBe(1);
  });

  test("only the owner can hide a clip, and a missing clip is one plain line", async () => {
    const { adult, other, row } = await household();
    const clip = await makeClip(adult, row("Marlow"));
    const refused = await action(other, "hide", { id: clip.jobId });
    expect(refused.status).toBe(404);
    expect(((await refused.json()) as { error: string }).error).toContain("isn't available");
    expect((await feed(adult)).length).toBe(1);
    expect((await action(adult, "hide", { id: "nope" })).status).toBe(404);
  });
});

describe("takes, render time and the clip check on the card", () => {
  test("another take counts the chain on the newest card, and each take names its parent", async () => {
    const { adult, row } = await household();
    const first = await makeClip(adult, row("Marlow"));
    const again = await (await action(adult, "another", { id: first.jobId })).json() as { id: string };
    await until(() => getVideoJobFor(row("Marlow"), again.id)?.state === "done");
    const rows = await feed(adult);
    expect(rows.map((r) => r.id)).toEqual([again.id, first.jobId]);
    expect(rows[0]).toMatchObject({ takes: 2, parent_id: first.jobId });
    expect(rows[0]!.tags).toContain("2 takes");
    expect(rows[1]!.takes).toBeUndefined();
    expect(rows[1]!.tags.some((t: string) => /takes/.test(t))).toBe(false);
    await action(adult, "hide", { id: again.id });
    expect((await feed(adult))[0]!.takes).toBeUndefined();
  });

  test("a finished clip shows the seconds it really took", async () => {
    const { adult, row } = await household();
    const clip = await makeClip(adult, row("Marlow"));
    const job = getVideoJobFor(row("Marlow"), clip.jobId)!;
    expect(typeof job.request.madeSeconds).toBe("number");
    job.request.madeSeconds = 42;
    db.run(`UPDATE video_jobs SET request = '${JSON.stringify(job.request).replace(/'/g, "''")}' WHERE id = '${clip.jobId}'`);
    expect((await feed(adult))[0]!.tags).toContain("Made in 42 s");
  });

  test("a clip-check finding shows as one plain line, and a clean clip shows none", async () => {
    const { adult, row } = await household();
    const clip = await makeClip(adult, row("Marlow"));
    expect((await feed(adult))[0]!.tags.some((t: string) => /soft|black/.test(t))).toBe(false);
    updateCreationReview(row("Marlow").id, clip.fileId, { checks: { clip: { findings: [{ code: "soft", level: "warning", message: "x" }], frames: 3, checked_at: new Date().toISOString() } } });
    const [card] = await feed(adult);
    expect(card!.tags).toContain("This clip looks soft. Try Sharpen 2x or another take.");
    expect(card!.check_note).toBe(CLIP_FINDING_WORDS.soft);
  });

  test("every finding code has words, a serious one wins, and none is null", () => {
    for (const code of ["black", "frozen", "soft", "jump", "face_drift", "camera_not_seen", "loop_seam"] as const) expect(CLIP_FINDING_WORDS[code]).toMatch(/\.$/);
    expect(clipFindingLine([{ code: "soft", level: "warning" }, { code: "black", level: "serious" }])).toBe(CLIP_FINDING_WORDS.black);
    expect(clipFindingLine([])).toBeNull();
    expect(clipFindingLine(undefined)).toBeNull();
  });
});
