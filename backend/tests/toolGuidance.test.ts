import { describe, expect, test } from "bun:test";
import { toolSpecFor } from "@/lib/turnMachine/nodes/model";
import { loadManifestOnly } from "@/lib/plugins";

// FAST-03 shortened these two manifest descriptions; the model must still receive exactly the words it was tuned with (copied from the manifests before the change).
const BEFORE: Record<string, string> = {
  impression: "Call with action start and a synth name when asked for an impression of, or to act as, a synth or person; do not ask first. Call with action stop when told to stop. Keeps its voice and memories.",
  song_name: "Name the song playing near the robot. listen: asked what it is or who performs it, quote their words in question. playback: pause, skip, repeat, volume, like or save; the robot cannot do those.",
};
describe("tool guidance the model sees (FAST-03)", () => {
  for (const [id, before] of Object.entries(BEFORE)) {
    test(`${id}: the model receives the same words as before, and the manifest description is the short sentence`, () => {
      const spec = toolSpecFor(id);
      expect(spec?.description).toBe(before);
      const loaded = loadManifestOnly(id);
      expect(loaded.ok && loaded.value.description.length <= 120 && loaded.value.description !== before).toBe(true);
    });
  }
});
