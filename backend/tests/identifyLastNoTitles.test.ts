import { beforeEach, describe, expect, test } from "bun:test";
import { recordIdentifyOutcome, lastIdentifyOutcome, resetIdentifyLast } from "@/lib/music/identifyLast";
import { identifyHealthEntry } from "@/lib/roleHealth";

beforeEach(() => resetIdentifyLast());

describe("rule 6a: the song-naming status carries no title or artist", () => {
  test("a matched outcome is recorded without title or artist even when a caller passes them", () => {
    recordIdentifyOutcome({ at: 1, deviceId: null, status: "matched", reason: null, seconds: 10, source: "person", matchSource: "shazam", title: "Secret Title", artist: "Secret Artist" } as never);
    expect(JSON.stringify(lastIdentifyOutcome())).not.toContain("Secret");
  });
  test("the status line names the source and nothing a person's clip produced", () => {
    for (const [matchSource, name] of [["library", "your library"], ["shazam", "Shazam"], ["acoustid", "AcoustID"]] as const) {
      recordIdentifyOutcome({ at: 1, deviceId: null, status: "matched", reason: null, seconds: 10, source: "robot", matchSource, title: "Secret Title" } as never);
      const line = identifyHealthEntry().identify_last?.line ?? "";
      expect(line).toBe(`Matched a song from ${name}.`);
    }
  });
});
