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
import { QUICK_MAX_SECONDS, DETAILED_MAX_SECONDS } from "@/lib/videos/quality";
import { registerAppPageFill } from "@/lib/apps";
import type { PersonRow } from "@/types";
import { registerMediaAppData } from "./appHost";

/** One plain line for what a Create job is doing now. */
function statusLine(state: string, percent: number, error: string | null): string {
  if (state === "queued") return "Waiting for its turn";
  if (state === "running") return percent > 0 ? `Making your video, ${percent}% done` : "Making your video";
  return error ?? "It did not finish. Try again.";
}

/** The levels this person may use (Boost needs the Boost model and their say; Max needs the Max slot and their say). Standard alone is no choice, so no segment. */
export function videoTierSegment(person: PersonRow): Record<string, unknown> | null {
  const band = speakerAgeBand(person, new Date());
  const tiers = [
    { id: "standard", label: "Standard", hint: `Up to ${QUICK_MAX_SECONDS} seconds` },
    ...(allowedQuality(person, "video", "detailed", band) === "detailed" ? [{ id: "boost", label: "Boost", hint: `Up to ${DETAILED_MAX_SECONDS} seconds, with sound` }] : []),
    ...(maxOffered(person, "video", band) ? [{ id: "max", label: "Max", hint: "The best the home can make" }] : []),
  ];
  return tiers.length > 1 ? { state: "tier", label: "Level", default: "standard", tiers } : null;
}

/** The Make page's lists, each from its one source: lengths from the engine ceilings (quality.ts), camera moves from recipes.ts, levels from tiers.ts. */
registerAppPageFill("videos", "make-video", (person, page) => {
  const body = Array.isArray(page.body) ? page.body as Array<Record<string, unknown>> : [];
  const bar = body.find((node) => node.type === "prompt_bar");
  if (!bar) return;
  const chips = Array.isArray(bar.chips) ? bar.chips as unknown[] : [];
  bar.chips = [
    ...chips,
    { state: "seconds", label: "Length", default: QUICK_MAX_SECONDS, options: [3, QUICK_MAX_SECONDS, DETAILED_MAX_SECONDS].map((value) => ({ value, label: `${value} seconds` })) },
    { state: "recipe", label: "Camera move", default: "none", options: [{ value: "none", label: "No camera move" }, ...VIDEO_RECIPES.map(({ id, label }) => ({ value: id, label }))] },
  ];
  const tier = videoTierSegment(person);
  if (tier) bar.tier = tier;
});

registerMediaAppData("videos", (person, dataId, params) => {
  if (dataId !== "recipes") return null;
  switch (params.scope) {
    case undefined: return VIDEO_RECIPES.map(({ id, label, hint }) => ({ id, label, hint }));
    case "starters": return VIDEO_STARTERS.map((idea) => ({ ...idea }));
    case "making": {
      const newest = db.select({ id: videoJobs.id }).from(videoJobs).where(and(eq(videoJobs.personId, person.id), isNull(videoJobs.conversationId))).orderBy(desc(videoJobs.createdAt)).get();
      const job = newest ? getVideoJobFor(person, newest.id) : null;
      if (!job || job.state === "done" || job.state === "cancelled") return [];
      return [{ id: job.id, title: job.prompt, status: statusLine(job.state, job.percent, job.error), state: job.state, percent: job.percent }];
    }
    default: return null;
  }
});
