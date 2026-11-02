// VIDEO-CREATE-01, VIDEO-UI-06: the Videos package's Create data, added to the shared media host. The manifest's `contributes.data` is at the spec's
// cap of 16 ids, so one id, `recipes`, answers by `scope`: none = the recipe list (lib/videos/recipes.ts), "feed" = the person's own Create clips
// as result_feed rows (newest first, with the Favorites only and Type filters), "job" = one of those rows by id (what the feed's `poll_while`
// re-reads while a clip is made), "clips" = My clips (Library files made at home, own and shared, or the person's uploaded pictures, by `view`).
// Only the two Create pages bind it and both have an adult floor, so appRouteAllowed refuses the rest.
import { doneVideoJobsFor } from "@/lib/videos/jobs";
import { feedRowById, feedRowOf, feedRows, levelOfJob } from "@/lib/videos/feed";
import { favoriteFileIds } from "@/lib/videos/favorites";
import { listLibrary } from "@/lib/library";
import { DEFAULT_VIDEO_VOICES, VIDEO_LOOKS, VIDEO_RECIPES, VIDEO_STARTERS, VIDEO_VOICES } from "@/lib/videos/recipes";
import { speakerAgeBand } from "@/lib/ageBand";
import { allowedQuality, maxOffered } from "@/lib/tiers";
import { QUICK_MAX_SECONDS, DETAILED_MAX_SECONDS, ltx25MaxReady, ltx25VideoReady, maxSecondsFor } from "@/lib/videos/quality";
import { peekVideoEngineStatus, videoEngineStatus, videoMaxNotReadyReason } from "@/lib/videos/ready";
import { registerAppPageFill, registerAppPageWarm } from "@/lib/apps";
import { packageAssetFile } from "@/lib/packageAssets";
import type { PersonRow } from "@/types";
import { madeFiles, registerMediaAppData } from "./appHost";

/** LTX25-MAX-01: the Max entry of the level segment. Offered only when the Stack reports the Max model ready AND this person holds Max (an adult, by grant or role). A person who holds Max, on a Stack that has the Max engine but not its pack ready, sees it
 * disabled with the one status line (`videoMaxNotReadyReason`; the pack installs from Settings, Models and storage, which carries the size and the licence prompt). A Stack without the engine, or a person who does not hold Max, sees nothing. */
function maxTierEntry(person: PersonRow, band: ReturnType<typeof speakerAgeBand>, engine: ReturnType<typeof peekVideoEngineStatus>): Array<Record<string, unknown>> {
  const holds = band === "adult" && maxOffered(person, "video", band, true);
  if (!holds) return [];
  if (ltx25MaxReady(engine)) return [{ id: "max", label: "Max", hint: `Up to ${maxSecondsFor("detailed", "ltx25max", engine)} seconds, sharpest picture, with sound` }];
  if (engine?.qualities?.ltx25max) return [{ id: "max", label: "Max", disabled_reason: videoMaxNotReadyReason(engine) }];
  return [];
}

/** Whether Make it Max can be offered to this person now: an adult who holds Max, on a Stack that reports the Max model ready. */
function maxOfferedNow(person: PersonRow): boolean {
  const band = speakerAgeBand(person, new Date());
  return band === "adult" && maxOffered(person, "video", band, true) && ltx25MaxReady(peekVideoEngineStatus());
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

/** The Create page's lists, each from its one source: lengths from the engine ceilings (quality.ts), Look and Camera cards (with each card's loop)
 * from recipes.ts, levels from tiers.ts, the idea chips from VIDEO_STARTERS. The page JSON holds none of them. */
/** The level segment reads the Stack's video status without waiting (`peekVideoEngineStatus`), which is empty on the first page after Home starts and
 * left Max out of the segment until a reload. The page awaits one real read first, for at most this long, so a slow Stack costs the page a moment, never the page. */
export const VIDEO_STATUS_WARM_MS = 1500;
registerAppPageWarm("videos", "create", async () => {
  await Promise.race([videoEngineStatus().then(() => undefined), new Promise<void>((resolve) => setTimeout(resolve, VIDEO_STATUS_WARM_MS))]);
});

/** The time under Generate, in plain words per level (docs/design/video-tiers-2026-11-02.md section 3: Standard 10 s about 43 s, Boost 5 s 42 to 74 s,
 * Max 10 s 205 s). Never credits, memory or model names. */
export const VIDEO_TIME_WORDS = { standard: "Standard, under a minute", boost: "Boost, about a minute", max: "Max, about four minutes" } as const;

registerAppPageFill("videos", "create", (person, page) => {
  // A card whose loop is not in the package (not made yet, or removed) is a plain tile with its label, never a broken video.
  const media = (loop: string): { media?: string } => (packageAssetFile("videos", loop) ? { media: loop } : {});
  const bar = findNode(page.body, "prompt_bar");
  if (!bar) return;
  const chips = Array.isArray(bar.chips) ? bar.chips as unknown[] : [];
  const lengths = lengthOptions();
  // Look, Camera (and Voices, folded under More settings) are the Style control: two thumbnails that open one popover (a sheet on a phone).
  bar.chips = [
    ...chips,
    { state: "seconds", label: "Length", default: QUICK_MAX_SECONDS, options: lengths.map((value) => ({ value, label: `${value} seconds` })) },
    { state: "look", label: "Look", variant: "cards", presentation: "popover", group: "Style", default: VIDEO_LOOKS[0]!.id, options: VIDEO_LOOKS.map(({ id, label, loop }) => ({ value: id, label, ...media(loop) })) },
    // No camera move is the start: "none" is not a card, so no card is chosen until the person picks one (the route reads "none" as not given).
    { state: "camera", label: "Camera", variant: "cards", presentation: "popover", group: "Style", default: "none", options: VIDEO_RECIPES.map(({ id, label, loop }) => ({ value: id, label, ...media(loop) })) },
    { state: "voices", label: "Voices", fold: true, default: DEFAULT_VIDEO_VOICES, options: VIDEO_VOICES.map(({ id, label }) => ({ value: id, label })) },
  ];
  // Make it Max shows only when this person holds Max and the Stack reports the Max model ready (the same offer the level segment makes); otherwise the
  // action is not drawn, so nobody presses a button whose answer is a refusal.
  const feed = findNode(page.body, "result_feed");
  if (feed && Array.isArray(feed.actions) && !maxOfferedNow(person)) feed.actions = (feed.actions as Array<{ action?: { call?: { target?: string } } }>).filter((entry) => !entry.action?.call?.target?.endsWith("/actions/max"));
  bar.suggestions = VIDEO_STARTERS.map(({ title, prompt }) => ({ label: title, text: prompt }));
  const tier = videoTierSegment(person);
  if (tier) {
    bar.tier = tier;
    const ids = (tier.tiers as Array<{ id: keyof typeof VIDEO_TIME_WORDS }>).map((entry) => entry.id);
    bar.submit_detail = { state: "tier", labels: Object.fromEntries(ids.map((id) => [id, VIDEO_TIME_WORDS[id]])) };
  } else {
    // Standard alone: no segment, so the line follows the length.
    bar.submit_detail = { state: "seconds", labels: Object.fromEntries(lengths.map((value) => [String(value), VIDEO_TIME_WORDS.standard])) };
  }
});

/** The My clips rows: Library clips made at home (the person's own and the ones shared with them, as the Library lists them), or the pictures the
 * person uploaded (what a Start frame can be). Each row carries its day and its Favorite mark. */
function clipRows(person: PersonRow, view: string | undefined, limit: number): Array<Record<string, unknown>> {
  if (view === "uploaded") {
    const rows: Array<Record<string, unknown>> = [];
    let cursor: string | undefined;
    do {
      const page = listLibrary(person, { type: "image", owner: "me", sort: "newest", limit: 60, ...(cursor ? { cursor } : {}) });
      for (const file of page.items) if (file.origin === "sent") rows.push({ id: file.id, title: file.name, subtitle: "Picture you added", thumbnail: file.thumb_url, duration_s: null, created_at: file.created_at, favorite: false, kind: "image" });
      cursor = rows.length >= limit ? undefined : page.next_cursor ?? undefined;
    } while (cursor);
    return rows.slice(0, limit);
  }
  const files = madeFiles(person, "videos");
  const favorites = favoriteFileIds(person, files.map((file) => file.id));
  // The person's own jobs say the level and length of a clip they made; a clip shared by someone else shows its maker's name.
  const jobOf = new Map(doneVideoJobsFor(person, null, false).flatMap((job) => (job.files[0] ? [[job.files[0].id, job] as const] : [])));
  const rows = files.filter((file) => view !== "favorites" || favorites.has(file.id)).slice(0, limit).map((file) => {
    const job = jobOf.get(file.id);
    const seconds = job?.files[0]?.seconds ?? file.duration_seconds;
    const level = job ? levelWords(job) : null;
    return { id: file.id, title: file.name, subtitle: job ? [level, seconds ? `${Math.round(seconds)} s` : null].filter(Boolean).join(", ") : file.owner.display_name || "Made at home", thumbnail: file.thumb_url, duration_s: file.duration_seconds, created_at: file.created_at, favorite: favorites.has(file.id), kind: "video" };
  });
  return rows;
}

const levelWords = (job: Parameters<typeof feedRowOf>[1]): string => ({ standard: "Standard", boost: "Boost", max: "Max" })[levelOfJob(job)];

registerMediaAppData("videos", (person, dataId, params) => {
  if (dataId !== "recipes") return null;
  switch (params.scope) {
    case undefined: return VIDEO_RECIPES.map(({ id, label, hint }) => ({ id, label, hint }));
    case "feed": return feedRows(person, { favorites: params.favorites === true, type: params.type, limit: params.limit });
    case "job": return feedRowById(person, params.id);
    case "clips": return clipRows(person, params.view, Math.min(params.limit ?? 200, 200));
    // A scope this page does not know (the three old pages' scopes are gone) answers nothing.
    default: return [];
  }
});
