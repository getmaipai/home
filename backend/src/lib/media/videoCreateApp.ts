// VIDEO-CREATE-01: the Videos package's Create data, added to the shared media host. The manifest's `contributes.data` is at the spec's cap of
// 16 ids, so one id, `recipes`, answers three ways by `scope`: none = the recipe list (lib/videos/recipes.ts), "starters" = three ideas for the
// Create home, "making" = the person's newest Create job while it waits, runs or has failed (a finished clip moves to the shelves; the
// creations shelf is `made-at-home` with a larger `limit`). Only the Create pages bind it and they have an adult floor, so appRouteAllowed refuses the rest.
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { videoJobs } from "@/db/schema";
import { getVideoJobFor } from "@/lib/videos/jobs";
import { VIDEO_RECIPES, VIDEO_STARTERS } from "@/lib/videos/recipes";
import { speakerAgeBand } from "@/lib/ageBand";
import { allowedQuality, maxOffered } from "@/lib/tiers";
import { videoRecipeFor } from "@/lib/videos/recipes";
import { registerMediaAppData } from "./appHost";

/** One plain line for what a Create job is doing now. */
function statusLine(state: string, percent: number, error: string | null): string {
  if (state === "queued") return "Waiting for its turn";
  if (state === "running") return percent > 0 ? `Making your video, ${percent}% done` : "Making your video";
  return error ?? "It did not finish. Try again.";
}

const asOf = () => new Date().toISOString();
const field = (value: unknown): string => (typeof value === "string" ? value : "");

registerMediaAppData("videos", (person, dataId, params) => {
  if (dataId !== "recipes") return null;
  switch (params.scope) {
    case undefined: return VIDEO_RECIPES.map(({ id, label, hint }) => ({ id, label, hint }));
    // A picker draws {rows}: the camera moves, and the levels this person may use (Max only when they hold it and a Max model is set).
    case "options": return { as_of: asOf(), rows: VIDEO_RECIPES.map(({ id, label }) => ({ id, label })) };
    case "tiers": {
      const band = speakerAgeBand(person, new Date());
      const rows = [{ id: "standard", label: "Standard" }, ...(allowedQuality(person, "video", "detailed", band) === "detailed" ? [{ id: "boost", label: "Boost" }] : []), ...(maxOffered(person, "video", band) ? [{ id: "max", label: "Max" }] : [])];
      return { as_of: asOf(), rows };
    }
    case "starters": return VIDEO_STARTERS.map((idea) => ({ ...idea }));
    // The kit's pickers and search box write page state; only a data call can read it back, so this row echoes the choices
    // (sent as `prompt`, `orientation`, `seconds`, `tier`, `recipe`) and its row action carries them to the Make action.
    case "make": {
      const prompt = field(params.prompt).trim();
      if (prompt.length < 3) return [];
      const recipe = videoRecipeFor(params.recipe);
      const orientation = field(params.orientation) === "portrait" ? "portrait" : "landscape";
      const seconds = field(params.seconds);
      const tier = field(params.tier);
      const summary = [orientation === "portrait" ? "Portrait" : "Landscape", seconds ? `${seconds} seconds` : null, tier ? `${tier[0]!.toUpperCase()}${tier.slice(1)} level` : null, recipe?.label ?? null].filter(Boolean).join(", ");
      return [{ id: "make", title: "Make this video", summary, prompt, orientation, seconds, tier, recipe: recipe?.id ?? "" }];
    }
    case "making": {
      const newest = db.select({ id: videoJobs.id }).from(videoJobs).where(and(eq(videoJobs.personId, person.id), isNull(videoJobs.conversationId))).orderBy(desc(videoJobs.createdAt)).get();
      const job = newest ? getVideoJobFor(person, newest.id) : null;
      if (!job || job.state === "done" || job.state === "cancelled") return [];
      return [{ id: job.id, title: job.prompt, status: statusLine(job.state, job.percent, job.error), state: job.state, percent: job.percent }];
    }
    default: return null;
  }
});
