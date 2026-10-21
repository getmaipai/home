// RECENCY-02: the shipped weather head is a valid manifest for the embedding Home runs, with a recorded threshold.
import { describe, expect, test } from "bun:test";
import { weatherHead, WEATHER_TOOL } from "@/lib/searchAssist/weatherAssist";
import { buildFeatures, scoreHead } from "@/lib/searchAssist/score";

describe("the shipped weather head", () => {
  test("parses, names the Stack's nomic embedding and records a threshold for the weather tool", () => {
    const head = weatherHead();
    expect(head).not.toBeNull();
    expect(head!.embed).toEqual({ model: "nomic-embed-text-v1.5.Q4_K_M", dims: 768, preprocess: "v1", prefix: "" });
    expect(head!.classes).toEqual(["other", "weather"]);
    expect(head!.thresholds[WEATHER_TOOL]!.value).toBeGreaterThan(0.3);
    expect(head!.thresholds[WEATHER_TOOL]!.value).toBeLessThan(0.95);
  });
  test("a vector pointing along the head's weights scores over, its opposite scores low", () => {
    const head = weatherHead()!;
    const along = head.coef[0]!.map((v) => v * 40);
    const against = head.coef[0]!.map((v) => -v * 40);
    expect(scoreHead(buildFeatures({ alone: along }, head)!, head, WEATHER_TOOL).over).toBe(true);
    expect(scoreHead(buildFeatures({ alone: against }, head)!, head, WEATHER_TOOL).over).toBe(false);
  });
});
