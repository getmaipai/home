import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// P1 (MUSIC-STUDIO-01): a station that cannot be resolved (an unsaved station after a restart or ten minutes) must not be a dead end.
test("the station page's empty player offers a way back to Radio", () => {
  const page = JSON.parse(readFileSync(join(import.meta.dir, "../packages/music/pages/station.json"), "utf8")) as { body: Array<Record<string, any>> };
  const player = page.body.find((block) => block.type === "player");
  expect(player?.empty_state?.action).toEqual({ navigate: { to: "/apps/music/radio" } });
  expect(player?.empty_state?.action_label).toBe("Open Radio");
  expect(player?.empty_state?.text).not.toContain("no longer available");
});
