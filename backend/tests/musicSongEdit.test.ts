// AUDIT-DUP-ROUTES-01: runSongEdit is the one path under the revise, details, length and quality routes. The routes' own tests
// cover the full flow; this pins the refusal shape a missing song gets before the maker is asked anything.
import { beforeEach, describe, expect, test } from "bun:test";
import { runSongEdit, SONG_GONE_LINE } from "@/lib/music/songEdit";
import { owner } from "./support/testAuth";
import { resetDb } from "./reset-db";

beforeEach(() => resetDb());

describe("runSongEdit", () => {
  test("a song that is not there is a 404 with the song-gone line and never reaches the plan", async () => {
    const { row } = await owner();
    let planned = false;
    const result = await runSongEdit({ actor: row, jobId: "music-missing", input: () => { planned = true; return { change: "remake" }; } });
    expect(result).toEqual({ ok: false, status: 404, error: SONG_GONE_LINE });
    expect(planned).toBe(false);
  });
});
