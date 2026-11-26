import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { attachments, jobs } from "@/db/schema";
import { encryptSecret, decryptSecret } from "@/lib/secrets";
import { __resetAdultLockForTests } from "@/lib/adultLock";
import { __resetSourceForTests, __setSourceTestHooks, sourceRequestCount } from "@/lib/loras/source";
import { reconcileLoraInstalls } from "@/lib/loras/install";
import { listLoraRecords } from "@/lib/loras/stackLibrary";
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
  modelVersions: [{ id: 9011, name: "v1", baseModel: "ZImageTurbo", trainedWords: ["soft z"], downloadUrl: "https://civitai.com/api/download/models/9011", files: [{ id: 901, name: "soft.safetensors", type: "Model", sizeKB: 1024, hashes: { SHA256: HASH }, primary: true }], images: [{ url: "https://image.civitai.com/test.jpg", nsfwLevel: 1, type: "image" }], ...over }],
});
let fake: ReturnType<typeof installFakeVideoStack>;
let install: ReturnType<typeof installFakeLoraJobs>;

function sourceFixture(over: Record<string, unknown> = {}): void {
  __setSourceTestHooks({ gapMs: 0, fetch: (async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.hostname === "civitai.com" && url.pathname === "/api/v1/models/901") return new Response(JSON.stringify(model(over)), { headers: { "content-type": "application/json" } });
    if (url.hostname === "image.civitai.com") return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), { headers: { "content-type": "image/jpeg" } });
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








});
