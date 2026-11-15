import { describe, expect, test } from "bun:test";
import { CLIP_RULES, shouldRetake } from "@/lib/videos/frameCheck";
import { ltx25EndPictureReady } from "@/lib/videos/quality";
import { endAnchorEnabled } from "@/lib/videos/policy";
import { getHouseholdSettingValue } from "@/lib/settings";
import { VIDEO_SETTINGS_KEYS } from "@/settings/videoKeys";

describe("CREATOR-12 end picture anchor and face fallback rules", () => {
  test("the anchor setting is defined once and defaults off", () => {
    const entry = VIDEO_SETTINGS_KEYS.find((key) => key.key === "video.end_anchor");
    expect(entry?.default).toBe(false);
    expect(endAnchorEnabled()).toBe(false);
    expect(getHouseholdSettingValue("video.end_anchor")).toBe(false);
  });

  test("only makers explicitly reporting end_image are capable", () => {
    const base = { ready: true, image_to_video: true };
    const engine = (ltx25: unknown) => ({ qualities: { quick: {}, detailed: {}, ltx25 } }) as never;
    expect(ltx25EndPictureReady(engine(base))).toBe(false);
    expect(ltx25EndPictureReady(engine({ ...base, end_image: true }))).toBe(true);
    expect(CLIP_RULES.faceMedian).toBe(0.363);
  });

  test("low measured face drift starts one take, and a retake is never retaken", () => {
    const finding = { code: "face_drift" as const, level: "warning" as const, message: "The faces in this clip may not match the pictures." };
    expect(shouldRetake({ findings: [finding], isRetake: false })).toBe(false);
    expect(shouldRetake({ findings: [{ ...finding, level: "serious" }], isRetake: false })).toBe(true);
    expect(shouldRetake({ findings: [{ ...finding, level: "serious" }], isRetake: true })).toBe(false);
  });
});
