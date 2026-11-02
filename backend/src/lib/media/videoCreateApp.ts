// VIDEO-CREATE-01: the Videos package's Create data, added to the shared media host. The manifest's `contributes.data` is at the spec's cap of
// 16 ids, so one id, `recipes`, answers three ways by `scope`: none = the recipe list (lib/videos/recipes.ts), "starters" = three ideas for the
// Create home, "making" = the person's newest Create job while it waits, runs or has failed, "newest" = the newest finished Create clip as a player item for the stage (a finished clip moves to the shelves; the
// creations shelf is `made-at-home` with a larger `limit`). Only the Create pages bind it and they have an adult floor, so appRouteAllowed refuses the rest.
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { videoJobs } from "@/db/schema";
import { getVideoJobFor } from "@/lib/videos/jobs";
import { DEFAULT_VIDEO_VOICES, VIDEO_LOOKS, VIDEO_RECIPES, VIDEO_STARTERS, VIDEO_VOICES } from "@/lib/videos/recipes";
import { speakerAgeBand } from "@/lib/ageBand";
import { allowedQuality, maxOffered } from "@/lib/tiers";
import { QUICK_MAX_SECONDS, DETAILED_MAX_SECONDS, ltx25MaxReady, ltx25VideoReady, maxSecondsFor } from "@/lib/videos/quality";
import { peekVideoEngineStatus, videoEngineStatus, videoMaxNotReadyReason } from "@/lib/videos/ready";
import { videoWaitLine } from "@/lib/videos/waitLine";
import { registerAppPageFill, registerAppPageWarm } from "@/lib/apps";
import { packageAssetFile } from "@/lib/packageAssets";
import type { PersonRow } from "@/types";
import { madeFileFor, madeFileItemView, registerMediaAppData } from "./appHost";

/** One plain line for what a Create job is doing now. */
function statusLine(state: string, percent: number, error: string | null, note?: string, phase?: string | null): string {
  const held = state === "running" ? videoWaitLine(phase, "adult") : null;
  const line = held ?? (state === "queued" ? "Waiting for its turn" : state === "running" ? (percent > 0 ? `Making your video, ${percent}% done` : "Making your video") : state === "done" ? "Ready" : error ?? "It did not finish. Try again.");
  return note ? `${line} ${note}` : line;
}

/** LTX25-MAX-01: the Max entry of the level segment. Offered only when the Stack reports the Max model ready AND this person holds Max (an adult, by grant or role). A person who holds Max, on a Stack that has the Max engine but not its pack ready, sees it
 * disabled with the one status line (`videoMaxNotReadyReason`; the pack installs from Settings, Models and storage, which carries the size and the licence prompt). A Stack without the engine, or a person who does not hold Max, sees nothing. */
function maxTierEntry(person: PersonRow, band: ReturnType<typeof speakerAgeBand>, engine: ReturnType<typeof peekVideoEngineStatus>): Array<Record<string, unknown>> {
  const holds = band === "adult" && maxOffered(person, "video", band, true);
  if (!holds) return [];
  if (ltx25MaxReady(engine)) return [{ id: "max", label: "Max", hint: `Up to ${maxSecondsFor("detailed", "ltx25max", engine)} seconds, sharpest picture, with sound` }];
  if (engine?.qualities?.ltx25max) return [{ id: "max", label: "Max", disabled_reason: videoMaxNotReadyReason(engine) }];
  return [];
}

/** The levels this person may use (Boost needs the Boost model and their say; Max needs the Max slot and their say). Standard alone is no choice, so no segment. */
export function videoTierSegment(person: PersonRow): Record<string, unknown> | null {
  const band = speakerAgeBand(person, new Date());
  // VIDEO-TIERS-01: with LTX-2.5 serving an adult (the page is adult-only), Standard is up to 10 seconds with sound and Boost up to 5 seconds with sound;
  // otherwise today's words. The ceilings come from `maxSecondsFor` (quality.ts), the one definition.
  const engine = peekVideoEngineStatus();
  const ltx25 = ltx25VideoReady(engine);
  const boostOffered = allowedQuality(person, "video", "detailed", band) === "detailed";
  const tiers = [
    { id: "standard", label: "Standard", hint: ltx25 ? `Up to ${maxSecondsFor("quick", "ltx25", engine)} seconds, with sound` : `Up to ${QUICK_MAX_SECONDS} seconds` },
    ...(boostOffered ? [{ id: "boost", label: "Boost", hint: `Up to ${ltx25 ? maxSecondsFor("detailed", "ltx25", engine) : DETAILED_MAX_SECONDS} seconds, with sound` }] : []),
    ...maxTierEntry(person, band, engine),
  ];
  return tiers.length > 1 ? { state: "tier", label: "Level", default: "standard", tiers } : null;
}

/** The lengths the Length chip offers: five seconds and the longest any level makes here now (10 s: Standard on LTX-2.5, or Boost on LTX-2.3). A level that makes less is cut to fit and says so. */
function lengthOptions(): number[] {
  const engine = peekVideoEngineStatus();
  const longest = Math.max(
    ltx25VideoReady(engine) ? maxSecondsFor("quick", "ltx25", engine) : QUICK_MAX_SECONDS,
    ltx25VideoReady(engine) ? maxSecondsFor("detailed", "ltx25", engine) : DETAILED_MAX_SECONDS,
  );
  return [...new Set([QUICK_MAX_SECONDS, longest])];
}

/** The first node of one type anywhere in a page's body (the prompt bar sits inside the page's split view). */
function findNode(nodes: unknown, type: string): Record<string, unknown> | undefined {
  if (Array.isArray(nodes)) {
    for (const node of nodes) { const hit = findNode(node, type); if (hit) return hit; }
    return undefined;
  }
  if (typeof nodes !== "object" || nodes === null) return undefined;
  const node = nodes as Record<string, unknown>;
  if (node.type === type) return node;
  return findNode(node.main, type) ?? findNode(node.aside, type) ?? findNode(node.children, type);
}

/** The Make page's lists, each from its one source: lengths from the engine ceilings (quality.ts), Look and Camera cards (with each card's loop)
 * from recipes.ts, levels from tiers.ts. VIDEO-CREATE-02 (U3): Look and Camera are card grids; their options and each card's loop (a path in the
 * package's assets/ folder) come from the one list each (VIDEO_LOOKS, VIDEO_RECIPES); the page JSON holds neither. */
/** The level segment reads the Stack's video status without waiting (`peekVideoEngineStatus`), which is empty on the first page after Home starts and
 * left Max out of the segment until a reload. The page awaits one real read first, for at most this long, so a slow Stack costs the page a moment, never the page. */
export const VIDEO_STATUS_WARM_MS = 1500;
registerAppPageWarm("videos", "make-video", async () => {
  await Promise.race([videoEngineStatus().then(() => undefined), new Promise<void>((resolve) => setTimeout(resolve, VIDEO_STATUS_WARM_MS))]);
});

registerAppPageFill("videos", "make-video", (person, page) => {
  // A card whose loop is not in the package (not made yet, or removed) is a plain tile with its label, never a broken video.
  const media = (loop: string): { media?: string } => (packageAssetFile("videos", loop) ? { media: loop } : {});
  const bar = findNode(page.body, "prompt_bar");
  if (!bar) return;
  const chips = Array.isArray(bar.chips) ? bar.chips as unknown[] : [];
  bar.chips = [
    ...chips,
    { state: "seconds", label: "Length", default: QUICK_MAX_SECONDS, options: lengthOptions().map((value) => ({ value, label: `${value} seconds` })) },
    { state: "look", label: "Look", variant: "cards", default: VIDEO_LOOKS[0]!.id, options: VIDEO_LOOKS.map(({ id, label, loop }) => ({ value: id, label, ...media(loop) })) },
    // No camera move is the start: "none" is not a card, so no card is chosen until the person picks one (the route reads "none" as not given).
    { state: "camera", label: "Camera", variant: "cards", default: "none", options: VIDEO_RECIPES.map(({ id, label, loop }) => ({ value: id, label, ...media(loop) })) },
    { state: "voices", label: "Voices", default: DEFAULT_VIDEO_VOICES, options: VIDEO_VOICES.map(({ id, label }) => ({ value: id, label })) },
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
      return [{ id: job.id, title: job.prompt, status: statusLine(job.state, job.percent, job.error, job.request.create?.note, job.phase), state: job.state, percent: job.percent }];
    }
    // The newest Create clip once it has finished or stopped, so the person can ask for Another take (same words, new seed).
    case "last": {
      const newest = db.select({ id: videoJobs.id }).from(videoJobs).where(and(eq(videoJobs.personId, person.id), isNull(videoJobs.conversationId))).orderBy(desc(videoJobs.createdAt)).get();
      const job = newest ? getVideoJobFor(person, newest.id) : null;
      if (!job || job.state === "queued" || job.state === "running") return [];
      return [{ id: job.id, title: job.prompt, status: statusLine(job.state, job.percent, job.error, job.request.create?.note), state: job.state }];
    }
    // VIDEO-CREATE-02 (U3): the stage's player: the newest Create clip that finished, as a player item (the Library file; Another take takes that file id).
    case "newest": {
      const recent = db.select({ id: videoJobs.id }).from(videoJobs).where(and(eq(videoJobs.personId, person.id), isNull(videoJobs.conversationId))).orderBy(desc(videoJobs.createdAt)).limit(10).all();
      for (const { id } of recent) {
        const job = getVideoJobFor(person, id);
        const fileId = job?.state === "done" ? job.files[0]?.id : undefined;
        const file = fileId ? madeFileFor(person, "videos", fileId) : null;
        if (job && file) return [madeFileItemView(file, "videos")];
      }
      return [];
    }
    default: return null;
  }
});
