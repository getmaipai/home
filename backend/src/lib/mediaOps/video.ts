// MAKE-CLEARER-01: the video half of Make clearer in the one operations table. It starts the same edit the chat tool's `upscale` change runs (clipEditStart: the edit
// gate for adults, the person's own open clip, the Adult lock check), so the Create feed, the video Studio and chat share one start. The original clip is kept.
import { z } from "zod";
import { registerMediaOp } from "./registry";
import { CLEARER_VIDEO_LEVELS } from "./clearerLevels";
import { startClipEdit } from "@/lib/videos/clipEditStart";
import { ImageEditError } from "@/lib/imageEdit";

const clearerArgs = z.object({ level: z.enum(["quick", "better", "best"]).default("quick").describe("quick: less grain, sharper, same size. better: AI enlarges to twice the size. best: AI restore (may be unavailable).") });

registerMediaOp({
  id: "video.make_clearer",
  label: "Make clearer",
  summary: "Make a clip clearer. Quick is fast, Better and Best use AI.",
  input: "video",
  output: "video",
  args: clearerArgs,
  controls: [{ kind: "choice", name: "level", label: "Level", options: ["quick", "better", "best"] }],
  levels: CLEARER_VIDEO_LEVELS,
  needs: null,
  minBand: "adult",
  run: async ({ actor }, { source, args }) => {
    const started = await startClipEdit(actor, source.id, { change: "upscale", clarity: (args as z.infer<typeof clearerArgs>).level }, "I couldn't make that video clearer. Try again.", "clearer_failed");
    if (!started.ok) throw new ImageEditError(started.status, started.error, started.code);
    return { job: started.job };
  },
});
