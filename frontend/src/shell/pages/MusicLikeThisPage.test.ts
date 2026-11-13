import { describe, expect, test } from "bun:test";
import { BAND_PROMPT, SONG_PROMPT, likeThisMessage } from "./MusicLikeThisPage";

describe("MUSIC-LIKE-01: the like-this chat message", () => {
  test("a band ask carries the song reference, so the turn follows the object", () => {
    expect(likeThisMessage("band", "med_1")).toBe(`${BAND_PROMPT}\n\nmaipai://audio/track/med_1`);
  });
  test("a song ask carries a style only, never the title or a reference", () => {
    const text = likeThisMessage("song", "med_1", "indie rock");
    expect(text).toBe(`${SONG_PROMPT} The style is indie rock.`);
    expect(text).not.toContain("maipai://");
    expect(likeThisMessage("song", "med_1")).toBe(SONG_PROMPT);
  });
});
