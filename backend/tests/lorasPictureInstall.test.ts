import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { jobs } from "@/db/schema";
import { encryptSecret, decryptSecret } from "@/lib/secrets";
import { __resetAdultLockForTests } from "@/lib/adultLock";
import { __resetSourceForTests, __setSourceTestHooks } from "@/lib/loras/source";
import { reconcileLoraInstalls } from "@/lib/loras/install";
import { listLoraRecords } from "@/lib/loras/store";
import { putLora } from "./fixtures/lora";
import { __resetLoraSyncForTests } from "@/lib/loras/sync";
import { setHouseholdSettingValue } from "@/lib/settings";
import { pictureInstallBody } from "@/lib/videos/stack";
import { installFakeLoraJobs } from "./fixtures/loraInstallFake";
import { household } from "./fixtures/adultLock";
import { installFakeVideoStack } from "./videoFixture";
import type { TestClient } from "./client";

const HASH = "a".repeat(64);
const TOKEN = "picture-civitai-test-token";
const model = (over: Record<string, unknown> = {}) => ({
  id: 901, name: "Soft Z Image", type: "LORA", nsfw: false, nsfwLevel: 1, allowCommercialUse: ["Image"], tags: [{ name: "style" }],
  modelVersions: [{ id: 9011, name: "v1", baseModel: "ZImageTurbo", trainedWords: ["soft z"], downloadUrl: "https://civitai.com/api/download/models/9011", files: [{ id: 901, name: "soft.safetensors", type: "Model", sizeKB: 1024, hashes: { SHA256: HASH }, primary: true }], images: [{ url: "https://image.civitai.com/test.jpg", nsfwLevel: 1 }], ...over }],
});
let fake: ReturnType<typeof installFakeVideoStack>;
let install: ReturnType<typeof installFakeLoraJobs>;

function sourceFixture(over: Record<string, unknown> = {}): void {
  __setSourceTestHooks({ gapMs: 0, fetch: (async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.hostname === "civitai.com" && url.pathname === "/api/v1/models/901") return new Response(JSON.stringify(model(over)), { headers: { "content-type": "application/json" } });
    return new Response("missing", { status: 404 });
  }) as typeof fetch });
}

const installBody = (over: Record<string, unknown> = {}) => ({ source: "civitai", remote_id: "901", version_id: "9011", media: "picture", audience: "all-ages", licence_confirmed: true, base_model: "z-image-turbo", ...over });
const post = (c: TestClient, body: unknown) => c.request("/api/loras/install", { method: "POST", body });

beforeEach(() => {
  resetDb();
  __resetAdultLockForTests(); __resetSourceForTests(); __resetLoraSyncForTests();
  fake = installFakeVideoStack(); fake.loras = [];
  install = installFakeLoraJobs(fake, "/stack/v1/image/loras/install");
  sourceFixture();
  setHouseholdSettingValue("generation.styles.civitai", true);
  setHouseholdSettingValue("generation.styles.civitai_key", TOKEN);
});
afterEach(() => {
  fake.restore(); __resetSourceForTests();
  setHouseholdSettingValue("generation.styles.civitai", false);
  setHouseholdSettingValue("generation.styles.civitai_key", "");
  setHouseholdSettingValue("voice.hf_token", "");
});

describe("picture LoRA install", () => {
  test("maps the shared body to the picture Stack contract", () => {
    expect(pictureInstallBody({ source: "civitai", url: "https://civitai.com/api/download/models/1", name: "Z", licence: "MIT", licence_acknowledged: true, audience: "adult", base_model: "z-image-turbo", sha256_expected: HASH, token: TOKEN })).toEqual({ site: "civitai", url: "https://civitai.com/api/download/models/1", name: "Z", licence: "MIT", licence_acknowledged: true, classification: "adult-only", base_model: "z-image-turbo", sha256_expected: HASH, token: TOKEN });
  });

  test("finishes a Civitai ZImageTurbo install as an admin-only picture record with unknown base", async () => {
    const { owner, row } = await household();
    const started = await post(owner, installBody());
    expect(started.status, await started.clone().text()).toBe(202);
    install.classification = "all-ages";
    expect(install.all).toHaveLength(1);
    expect(install.bodies[0]).toMatchObject({ site: "civitai", classification: "all-ages", base_model: "z-image-turbo", sha256_expected: HASH, token: TOKEN });
    expect(JSON.stringify(install.bodies)).toContain(TOKEN);
    expect((await started.text())).not.toContain(TOKEN);
    expect(JSON.stringify(db.select().from(jobs).all())).not.toContain(TOKEN);

    install.state = "done";
    await reconcileLoraInstalls();
    expect(listLoraRecords()).toHaveLength(1);
    expect(listLoraRecords()[0]).toMatchObject({ media: "picture", base_model: "unknown", audience: "all-ages", availability: { who: "admins", people: [] }, added_by: row("Sage").id });
  });

  test("rejects a video base for pictures and a picture base for video before Stack", async () => {
    const { owner } = await household();
    const picture = await post(owner, installBody({ base_model: "ltx-2.5" }));
    const video = await post(owner, installBody({ media: "video", base_model: "z-image-turbo" }));
    expect(picture.status).toBe(400);
    expect(await picture.json()).toEqual({ error: "That base is not available for picture." });
    expect(video.status).toBe(400);
    expect(await video.json()).toEqual({ error: "That base is not available for video." });
    expect(install.all).toHaveLength(0);
  });

  test("a matching video record does not count as a duplicate picture style", async () => {
    const { owner, row } = await household();
    putLora(row("Sage").id, {
      media: "video",
      source: { site: "civitai", url: null, remote_id: "901", version_id: "9011", token_ref: null },
      file: { sha256: HASH, bytes: 1024 * 1024, rank: 1, modules: [], format: "safetensors" },
    });
    const res = await post(owner, installBody());
    expect(res.status).toBe(202);
    expect(install.all).toHaveLength(1);
  });

  test("a Stack duplicate uses the same plain line as video", async () => {
    const { owner } = await household();
    install.refuse = { status: 409, code: "duplicate_lora", error: "Already present", existing_id: "not-in-home" };
    const res = await post(owner, installBody());
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "duplicate_lora", error: "You already have this style." });
  });

  test("a failed picture job retries through the picture route", async () => {
    const { owner } = await household();
    await post(owner, installBody({ audience: "adult-only" }));
    install.state = "failed"; install.reason = "hash_mismatch: The source hash did not match. Try again.";
    await reconcileLoraInstalls();
    const { listIssues } = await import("@/lib/issues");
    const issue = listIssues().find((item) => item.source === "styles")!;
    expect(issue.title).toBe("A style did not download");
    install.state = "running";
    expect((await owner.post(`/api/repairs/${issue.id}/fix`, {})).status).toBe(200);
    expect(install.bodies).toHaveLength(2);
    expect(install.all).toHaveLength(2);
  });

  test("a sealed context without media still completes as video", async () => {
    const { owner } = await household();
    install = installFakeLoraJobs(fake, "/stack/v1/video/loras/install");
    sourceFixture({ baseModel: "LTXV 2.5" });
    const started = await post(owner, { ...installBody(), media: "video", base_model: "ltx-2.5" });
    expect(started.status).toBe(202);
    const row = db.select().from(jobs).where(eq(jobs.kind, "lora_install")).get()!;
    const provenance = JSON.parse(row.provenance) as { ctx: string; stackJobId: string };
    const ctx = JSON.parse(decryptSecret(provenance.ctx)) as Record<string, unknown>;
    delete ctx.media;
    db.update(jobs).set({ provenance: JSON.stringify({ ...provenance, ctx: encryptSecret(JSON.stringify(ctx)) }) }).where(eq(jobs.id, row.id)).run();
    install.state = "done";
    await reconcileLoraInstalls();
    expect(listLoraRecords()[0]).toMatchObject({ media: "video", base_model: "ltx-2.5" });
  });

  test("an unknown picture hit cannot be lowered to all ages while the admin is locked", async () => {
    const { owner } = await household();
    sourceFixture({ images: [] });
    const res = await post(owner, installBody({ audience: "all-ages" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "unlock_needed", error: "Unlock adult items first to choose All ages for this style." });
    expect(install.all).toHaveLength(0);
  });
});
