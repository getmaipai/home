// STYLES-02: picture and video share one prompt plan; media only selects the no-base sentence.
import { describe, expect, test } from "bun:test";
import { buildPromptPlan, noBaseLine, TWO_AT_A_TIME_LINE, TWO_CHARACTERS_LINE, type StyleForPlan } from "@/lib/loras/promptPlan";

type MediaStyle = StyleForPlan & { media: "video" | "picture" };
function record(id: string, kind: "style" | "character", media: MediaStyle["media"]): MediaStyle {
  return {
    id, name: id, kind, media, trigger_words: [`${id} trigger`], trigger_position: "start",
    positive_addins: [`${id} add-in`], negative_addins: [], avoid_as_positive: [], strength: { default: 0.8, min: 0, max: 2 },
  };
}

describe("shared prompt plan media", () => {
  test("one style and one character produce the same prompt, LoRAs and lines for either media", () => {
    // One style plus one character is the simplest valid two-record example, with each record adding both phrase types.
    const video = [record("style", "style", "video"), record("character", "character", "video")];
    const picture = video.map((item) => ({ ...item, media: "picture" as const }));
    const videoPlan = buildPromptPlan({ words: "A fox", styles: video, media: "video" });
    const picturePlan = buildPromptPlan({ words: "A fox", styles: picture, media: "picture" });
    expect(videoPlan).toMatchObject({ ok: true });
    expect(picturePlan).toMatchObject({ ok: true });
    if (!videoPlan.ok || !picturePlan.ok) throw new Error("expected both plans to succeed");
    expect({ prompt: picturePlan.prompt, loras: picturePlan.loras, lines: picturePlan.lines }).toEqual({ prompt: videoPlan.prompt, loras: videoPlan.loras, lines: videoPlan.lines });
  });

  test("three styles and two characters return the same limit lines for either media", () => {
    const styles = [record("one", "style", "video"), record("two", "style", "video"), record("three", "style", "video")];
    const pictures = styles.map((item) => ({ ...item, media: "picture" as const }));
    expect(buildPromptPlan({ words: "A fox", styles, media: "video" })).toEqual({ ok: false, code: "too_many", line: TWO_AT_A_TIME_LINE });
    expect(buildPromptPlan({ words: "A fox", styles: pictures, media: "picture" })).toEqual({ ok: false, code: "too_many", line: TWO_AT_A_TIME_LINE });
    const characters = [record("one", "character", "video"), record("two", "character", "video")];
    expect(buildPromptPlan({ words: "A fox", styles: characters, media: "video" })).toEqual({ ok: false, code: "two_characters", line: TWO_CHARACTERS_LINE });
    expect(buildPromptPlan({ words: "A fox", styles: characters.map((item) => ({ ...item, media: "picture" as const })), media: "picture" })).toEqual({ ok: false, code: "two_characters", line: TWO_CHARACTERS_LINE });
  });

  test("the no-base sentence names the requested media", () => {
    expect(noBaseLine("video")).toContain("video type");
    expect(noBaseLine("picture")).toContain("picture type");
  });
});
