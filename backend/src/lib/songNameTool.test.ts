import { describe, expect, test } from "bun:test";
import { __resetHeardSongsForTests, addHeardCandidates, noteHeardSong } from "@/lib/music/heardSong";
import { runSongNameTool, songNameText } from "./songNameTool";

describe("song_name tool result copy", () => {
  test("returns plain text for every identify result", () => {
    expect(songNameText({ status: "matched", result: { title: "Tune", artist: "Singer", album: "Record", year: null, source: "library", score: 1, musicbrainz_recording_id: null, musicbrainz_artist_id: null, musicbrainz_release_group_id: null } })).toBe("That is Tune by Singer (Record).");
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

describe("song_name discussion actions", () => {
  test("reject promotes a guess and sends its title; command failure does not fail the answer", async () => {
    __resetHeardSongsForTests();
    noteHeardSong("robot", { title: "First", artist: "Artist", source: "shazam", score: 0.9, at: Date.now() });
    addHeardCandidates("robot", [
      { title: "First", artist: "Artist", album: null, year: null, source: "shazam", score: 0.9, agrees: true },
      { title: "Next", artist: "Other", album: null, year: null, source: "acoustid", score: 0.8, agrees: false },
    ]);
    const sent: string[] = [];
    const out = await runSongNameTool({ callId: "c", deviceId: "robot", surface: "robot", args: { action: "reject" }, command: (_id, text) => { sent.push(text); throw new Error("command rejected"); } });
    expect(out.result.reply.text).toContain("Then it may be Next by Other");
    expect(sent).toEqual(["Next - Other"]);
  });
  test("confirm selects a named candidate and sends the face title", async () => {
    __resetHeardSongsForTests();
    noteHeardSong("robot", { title: "First", artist: "Artist", source: "shazam", at: Date.now() });
    addHeardCandidates("robot", [{ title: "Next", artist: "Other", album: null, year: null, source: "acoustid", score: 0.8, agrees: false }]);
    const sent: string[] = [];
    const out = await runSongNameTool({ callId: "c", deviceId: "robot", surface: "robot", args: { action: "confirm", title: "Next" }, command: (_id, text) => sent.push(text) });
    expect(out.result.reply.text).toBe("Got it, that is Next by Other."); expect(sent).toEqual(["Next - Other"]);
  });
});
