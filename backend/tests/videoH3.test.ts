import { describe, expect, test } from "bun:test";
import { chooseVideoQuality, h3VideoReady, h3PictureReady, h3EndPictureReady, videoSizeFor } from "@/lib/videos/quality";
import { readyVideoStatusForTests } from "@/lib/videos/ready";
import { videoBodyForSlot } from "@/lib/videos/slotBody";
import type { StackVideoStatus } from "@/lib/videos/stack";

const status = (ready = true, pictures = true): StackVideoStatus => {
  const base = readyVideoStatusForTests({ ltx25: "ready" });
  return { ...base, qualities: { ...base.qualities!, h3: {
    id: "minimax-h3", installed: ready, available: true, ready, audio: true,
    image_to_video: pictures, end_image: pictures, video_to_video: false,
    reference_pictures: false, reference_videos: false, reference_audio: false,
    memory: { fits: true, reason: null, peak_gb: 40 }, limits: { max_seconds: 5, default_size: "864x480" },
    loras: { supported: false }, licence: null,
  } } };
};

describe("MiniMax H3 video maker", () => {
  test("readiness and image capabilities come only from Stack status", () => {
    expect(h3VideoReady(status())).toBe(true);
    expect(h3PictureReady(status())).toBe(true);
    expect(h3EndPictureReady(status())).toBe(true);
    expect(h3VideoReady(status(false))).toBe(false);
    expect(h3PictureReady(status(true, false))).toBe(false);
    expect(h3VideoReady(readyVideoStatusForTests())).toBe(false);
  });

  test("Detailed selects H3 only for an adult when ready; Max and minors keep their makers", () => {
    expect(chooseVideoQuality({ requested: "detailed", engine: status(), adultLane: true })).toMatchObject({ maker: "h3", quality: "detailed", seconds: 5 });
    expect(chooseVideoQuality({ requested: "detailed", engine: status(false), adultLane: true })).toMatchObject({ maker: "ltx25", quality: "detailed" });
    expect(chooseVideoQuality({ requested: "detailed", engine: status(), adultLane: false, quickOnly: true })).toMatchObject({ maker: "wan", quality: "quick" });
    const maxStatus = readyVideoStatusForTests({ ltx25: "ready", ltx25max: "ready" });
    expect(chooseVideoQuality({ requested: "detailed", engine: maxStatus, adultLane: true, max: true })).toMatchObject({ maker: "ltx25max" });
    expect(chooseVideoQuality({ requested: "detailed", engine: status(), adultLane: true, hasPicture: true })!.maker).toBe("h3");
  });

  test("uses H3 sizes and carries model, length, and first and end pictures through the slot", () => {
    expect(videoSizeFor("h3", "detailed", false)).toBe("864x480");
    expect(videoSizeFor("h3", "detailed", true)).toBe("480x864");
    const result = videoBodyForSlot({ model: "minimax-h3", prompt: "scene", size: "480x864", seconds: 8, image: "start", end_image: "end", audience: "adult" }, "boost", "adult", "adult", status());
    expect(result.body).toMatchObject({ model: "minimax-h3", size: "480x864", seconds: 5, image: "start", end_image: "end", tier: "boost" });
  });

  test("an old Stack status remains valid without qualities.h3", () => {
    const old = readyVideoStatusForTests();
    expect(old.qualities?.h3).toBeUndefined();
    expect(h3VideoReady(old)).toBe(false);
  });
});
