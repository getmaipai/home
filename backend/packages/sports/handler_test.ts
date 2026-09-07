import { assertEquals } from "jsr:@std/assert@1";
import { summarizeScores } from "./handler.ts";

function game(state: string, awayName: string, awayScore: number, homeName: string, homeScore: number) {
  return {
    status: { abstractGameState: state },
    teams: {
      away: { team: { name: awayName }, score: awayScore },
      home: { team: { name: homeName }, score: homeScore },
    },
  };
}

Deno.test("reports a final game's score", () => {
  const data = { dates: [{ games: [game("Final", "Milwaukee Brewers", 0, "Cincinnati Reds", 4)] }] };
  const result = summarizeScores(data);
  assertEquals(result.text, "Milwaukee Brewers 0, Cincinnati Reds 4 (final).");
});

Deno.test("reports an in-progress game as in progress, not final", () => {
  const data = { dates: [{ games: [game("Live", "New York Yankees", 3, "Boston Red Sox", 2)] }] };
  const result = summarizeScores(data);
  assertEquals(result.text, "New York Yankees 3, Boston Red Sox 2 (in progress).");
});

Deno.test("skips a not-yet-started game rather than reporting a false 0-0", () => {
  const data = { dates: [{ games: [game("Preview", "Chicago Cubs", 0, "St. Louis Cardinals", 0)] }] };
  const result = summarizeScores(data);
  assertEquals(result.text, "No MLB games have started yet today.");
});

Deno.test("reports up to the count limit, in schedule order", () => {
  const data = {
    dates: [
      {
        games: [
          game("Final", "A", 1, "B", 2),
          game("Final", "C", 3, "D", 4),
          game("Final", "E", 5, "F", 6),
          game("Final", "G", 7, "H", 8),
        ],
      },
    ],
  };
  const result = summarizeScores(data, 2);
  assertEquals(result.text, "A 1, B 2 (final). C 3, D 4 (final).");
});

Deno.test("reads no games at all as none started, not a crash", () => {
  const result = summarizeScores({ dates: [{ games: [] }] });
  assertEquals(result.text, "No MLB games have started yet today.");
});

Deno.test("reads a malformed (non-object) response as none started, not a throw", () => {
  const result = summarizeScores(null);
  assertEquals(result.text, "No MLB games have started yet today.");
});

// The same class of gap code review found in almanac-holiday and
// almanac-onthisday: a live/final game whose own team name or score
// field is missing or the wrong type must be skipped, not interpolated
// as "undefined" or "NaN".
Deno.test("skips a live game with a missing score field instead of reporting NaN", () => {
  const malformed = { status: { abstractGameState: "Live" }, teams: { away: { team: { name: "A" } }, home: { team: { name: "B" }, score: 2 } } };
  const result = summarizeScores({ dates: [{ games: [malformed] }] });
  assertEquals(result.text, "No MLB games have started yet today.");
});
