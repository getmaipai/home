import { describe, expect, test } from "bun:test";
import { podcastStatusLabel } from "./podcastSkipModel";

describe("podcast segment badge view model", () => {
  test("labels processing, review and playback outcomes", () => {
    expect(podcastStatusLabel("ready", 3, "skip")).toBe("3 breaks skipped");
    expect(podcastStatusLabel("nothing_found", 0, "skip")).toBe("No ads found");
    expect(podcastStatusLabel("ready", 0, "off")).toBe("Skipping off");
    expect(podcastStatusLabel("processing", 0, "skip")).toBe("Processing");
    expect(podcastStatusLabel("offline", 0, "skip")).toBe("Stack offline");
    expect(podcastStatusLabel("not_processed", 0, "skip")).toBe("Needs review");
  });
});
