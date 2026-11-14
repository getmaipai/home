import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { PageNodeSchema } from "@/kit/schema/types";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import { household } from "./fixtures/adultLock";
import { installFakeVideoStack, type FakeVideoStack } from "./videoFixture";
import { __resetVideoAdapterCacheForTests } from "@/lib/videos/adapters";
import { __setVideoStatusForTests, readyVideoStatusForTests } from "@/lib/videos/ready";
import { getVideoJobFor } from "@/lib/videos/jobs";
import { listCast } from "@/lib/cast";

let fake: FakeVideoStack;
beforeEach(() => { resetDb(); __resetVideoAdapterCacheForTests(); fake = installFakeVideoStack(); __setVideoStatusForTests(readyVideoStatusForTests()); });
afterEach(() => { fake.restore(); __setVideoStatusForTests(undefined); });

describe("Talking avatar page", () => {
  test("adult page is a valid small prompt bar with cast, line, and Create's shape and quality controls", async () => {
    const { owner, teen, child } = await household();
    const res = await owner.get("/api/plugins/video/pages/talking-avatar");
    expect(res.status).toBe(200);
    const page = await res.json() as Record<string, any>;
    expect(PageNodeSchema.safeParse(page).success).toBe(true);
    const bar = page.body.find((n: Record<string, any>) => n.type === "prompt_bar");
    expect(bar.references).toContainEqual(expect.objectContaining({ state: "cast", kind: "character" }));
    expect(bar.prompt_state).toBe("line");
    expect(bar.placeholder).toBe("Type what they should say.");
    expect(bar.chips.length).toBeLessThanOrEqual(6);
    const { iconNames } = await import("../../frontend/node_modules/@maipai/ui/src/icons");
    for (const chip of bar.chips) {
      expect(chip.icon_only).toBe(true);
      expect(iconNames).toContain(chip.icon);
    }
    expect(bar.chips.map((c: { state: string }) => c.state)).toContain("orientation");
    expect(bar.chips.map((c: { state: string }) => c.state)).toContain("tier");
    expect(bar.submit.call.target).toBe("/api/plugins/video/actions/make");
    expect(bar.submit.call.args).toMatchObject({ cast: "{cast}", line: "{line}" });
    expect((await teen.client.get("/api/plugins/video/pages/talking-avatar")).status).toBe(404);
    expect((await child.client.get("/api/plugins/video/pages/talking-avatar")).status).toBe(404);
  });

  test("action routes cast and a quoted typed line through generate_video; unknown cast refuses before a job", async () => {
    const { owner, row } = await household();
    const ownerRow = row("Sage");
    const castId = row("Marlow").id;
    const ok = await owner.post("/api/plugins/video/actions/make", { prompt: "A close-up of the person talking to the camera, looking natural.", cast: castId, line: "Hello there." });
    expect(ok.status).toBe(200);
    const jobId = ((await ok.json()) as { id: string }).id;
    const job = getVideoJobFor(ownerRow, jobId)!;
    const resolvedSubject = listCast(ownerRow).find((entry) => entry.person_id === castId)!.subject_id;
    expect(resolvedSubject).toBeString();
    expect(job.request.subject_ids).toEqual([resolvedSubject!]);
    expect(job.request.subject_ids).toHaveLength(1);
    expect(String(fake.submitted[0]!.prompt)).toContain('"Hello there."');
    const before = fake.submitted.length;
    const bad = await owner.post("/api/plugins/video/actions/make", { prompt: "A close-up of the person talking to the camera, looking natural.", cast: "unknown-cast-id", line: "Hello." });
    expect(bad.status).toBe(422);
    expect((await bad.json() as { error: string }).error).toContain("not in your cast list");
    expect(fake.submitted).toHaveLength(before);
  });

  test("empty cast placeholder means no cast", async () => {
    const { owner } = await household();
    const res = await owner.post("/api/plugins/video/actions/make", { prompt: "A simple talking portrait", cast: "{cast}" });
    expect(res.status).toBe(200);
  });
});
