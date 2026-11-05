// STYLES-05 finding (2026-11-05): a real picture style installed through the dev hub never showed in GET /api/loras, because the list routes called
// `readLoras` without a media and it defaults to video. Both list routes take an optional `media` now; no media still means video.
import { beforeEach, expect, setDefaultTimeout, test } from "bun:test";
import { resetDb } from "./reset-db";
import { household } from "./fixtures/adultLock";
import { putLora } from "./fixtures/lora";
import { __resetLoraSyncForTests } from "@/lib/loras/sync";

setDefaultTimeout(30_000);
beforeEach(() => { resetDb(); __resetLoraSyncForTests(); });

const names = async (response: Response): Promise<string[]> => ((await response.json()) as { items: Array<{ name: string }> }).items.map((item) => item.name).sort();

test("the admin list returns video styles by default and picture styles when asked", async () => {
  const { owner, row } = await household();
  const admin = row("Sage");
  putLora(admin.id, { name: "Clay video", media: "video", audience: "all-ages", audience_set_by: admin.id, audience_set_at: "2026-11-05T00:00:00.000Z" });
  putLora(admin.id, { name: "Pixel picture", media: "picture", base_model: "unknown", compatible_with: [], audience: "all-ages", audience_set_by: admin.id, audience_set_at: "2026-11-05T00:00:00.000Z" });
  expect(await names(await owner.get("/api/loras"))).toEqual(["Clay video"]);
  expect(await names(await owner.get("/api/loras?media=video"))).toEqual(["Clay video"]);
  expect(await names(await owner.get("/api/loras?media=picture"))).toEqual(["Pixel picture"]);
});

test("the available list takes the same media, and a bad media is refused", async () => {
  const { owner, row } = await household();
  const admin = row("Sage");
  putLora(admin.id, { name: "Clay video", media: "video", audience: "all-ages", audience_set_by: admin.id, audience_set_at: "2026-11-05T00:00:00.000Z", availability: { who: "adults", people: [] } });
  putLora(admin.id, { name: "Pixel picture", media: "picture", base_model: "unknown", compatible_with: [], audience: "all-ages", audience_set_by: admin.id, audience_set_at: "2026-11-05T00:00:00.000Z", availability: { who: "adults", people: [] } });
  expect(await names(await owner.get("/api/loras/available"))).toEqual(["Clay video"]);
  expect(await names(await owner.get("/api/loras/available?media=picture"))).toEqual(["Pixel picture"]);
  expect((await owner.get("/api/loras?media=song")).status).toBe(400);
});
