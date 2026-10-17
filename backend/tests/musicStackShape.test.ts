// MUSIC-GEN-06 regression: the real Stack wraps its music status as `{ music: {...} }` (Stack routes/music.ts, like
// `GET /stack/v1/video`). Home read it flat, so a real, installed music engine always looked "not ready" and the tool was
// never offered. The fixture below is the shape a scratch Stack returned on the Studio (trimmed).
import { afterEach, expect, test } from "bun:test";
import { __setMusicFetchForTests, musicStatus } from "@/lib/music/stack";
import { musicStatusReady } from "@/lib/music/ready";

afterEach(() => __setMusicFetchForTests(null));

const REAL = { music: { state: "needs-setup", available: true, code: null, reason: null, tier: "p128", memory: { fits: true, reason: null, peak_gb: 33 }, model: { id: "ace-step-1-5-turbo", installed: true }, limits: { min_seconds: 10, max_seconds: 240, default_seconds: 60 }, quality: ["quick", "detailed"], default_quality: "detailed", tasks: ["text2music", "cover", "repaint", "extend", "edit"] } };

test("the Stack's wrapped music status reads as ready", async () => {
  __setMusicFetchForTests((async () => Response.json(REAL)) as unknown as typeof fetch);
  const status = await musicStatus();
  expect(status?.default_quality).toBe("detailed");
  expect(status?.limits.max_seconds).toBe(240);
  expect(musicStatusReady(status)).toBe(true);
});

test("a flat status still reads, and a body with neither shape is not ready", async () => {
  __setMusicFetchForTests((async () => Response.json(REAL.music)) as unknown as typeof fetch);
  expect(musicStatusReady(await musicStatus())).toBe(true);
  __setMusicFetchForTests((async () => Response.json({ video: {} })) as unknown as typeof fetch);
  expect(await musicStatus()).toBeNull();
});
