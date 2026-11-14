import { describe, expect, test } from "bun:test";
import { runSongNameTool, songNameText } from "./songNameTool";

describe("song_name tool result copy", () => {
  test("returns plain text for every identify result", () => {
    expect(songNameText({ status: "matched", result: { title: "Tune", artist: "Singer", album: "Record", source: "library", score: 1, musicbrainz_recording_id: null, musicbrainz_artist_id: null, musicbrainz_release_group_id: null } })).toBe("That is Tune by Singer (Record).");
    expect(songNameText({ status: "no_match" })).toBe("I listened but could not tell which song that is.");
    expect(songNameText({ status: "needs_confirm" })).toBe("I may have a match; the household has song naming set to ask first.");
    expect(songNameText({ status: "not_ready", reason: "no_key", line: "Not ready line." })).toBe("Not ready line.");
    expect(songNameText({ status: "timeout" })).toBe("The robot did not answer in time.");
    expect(songNameText({ status: "failed", reason: "unexpected" })).toContain("could not identify");
  });
  test("a non-robot surface gets the honest robot-only line", async () => {
    const outcome = await runSongNameTool({ callId: "c1", surface: "chat", deviceId: null });
    expect(outcome.result.reply.text).toBe("I can only listen through the robot right now.");
    expect(outcome.status).toBe("succeeded");
  });
});
