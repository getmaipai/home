// VIDEO-CREATE-01, VIDEO-UI-06: the Video package's Create data, added to the shared media host. The manifest's `contributes.data` is at the spec's
// cap of 16 ids, so one id, `recipes`, answers by `scope`: none = the recipe list (lib/videos/recipes.ts), "showcase" = the Try this rail (VIDEO-UI-11), "feed" = the person's own Create clips
// as result_feed rows (newest first, with the Favorites only and Type filters), "job" = one of those rows by id (what the feed's `poll_while`
// re-reads while a clip is made), "clips" = My clips (Library files made at home, own and shared, or the person's uploaded pictures, by `view`).
// Only the two Create pages bind it and both have an adult floor, so appRouteAllowed refuses the rest.
import { doneVideoJobsFor } from "@/lib/videos/jobs";
import { lockedVideoTile } from "@/lib/videos/lock";
import { feedRowById, feedRowOf, feedRows, levelOfJob } from "@/lib/videos/feed";
import { favoriteFileIds } from "@/lib/videos/favorites";
import { studioHeaderRows, studioLevelSteps, studioLimits, studioReadiness, studioRows } from "@/lib/videos/studio";
import { listLibrary } from "@/lib/library";
import { suggestStyles } from "@/lib/loras/suggest";
import { requestProof } from "@/lib/adultLock";
import { adultStateOf } from "@/lib/adultMarks";
import { DEFAULT_VIDEO_VOICES, VIDEO_LOOKS, VIDEO_RECIPES, VIDEO_SHOWCASE, VIDEO_VOICES, videoLookFor, videoRecipeFor } from "@/lib/videos/recipes";
import { speakerAgeBand } from "@/lib/ageBand";
import { styleChips, type StyleTier } from "@/lib/videos/createStyles";
import { syncLoras } from "@/lib/loras/sync";
import { allowedQuality, maxOffered } from "@/lib/tiers";
import { QUICK_MAX_SECONDS, DETAILED_MAX_SECONDS, ltx25MaxReady, ltx25VideoReady, maxSecondsFor } from "@/lib/videos/quality";
import { peekVideoEngineStatus, videoEngineStatus, videoMaxNotReadyReason } from "@/lib/videos/ready";
import { registerAppPageFill, registerAppPageWarm } from "@/lib/apps";
import { listFragments } from "@/lib/media/templates";
import { packageAssetFile } from "@/lib/packageAssets";
import { meetsMinRole } from "@/lib/plugins";
import type { PersonRow } from "@/types";
import { madeFiles, registerMediaAppData } from "./appHost";

/** LTX25-MAX-01: the Max entry of the level segment. Offered only when the Stack reports the Max model ready AND this person holds Max (an adult, by grant or role). A person who holds Max, on a Stack that has the Max engine but not its pack ready, sees it
 * disabled with the one status line (`videoMaxNotReadyReason`; the pack installs from Settings, Models and storage, which carries the size and the licence prompt). A Stack without the engine, or a person who does not hold Max, sees nothing. */
function maxTierEntry(person: PersonRow, band: ReturnType<typeof speakerAgeBand>, engine: ReturnType<typeof peekVideoEngineStatus>): Array<Record<string, unknown>> {
  const holds = band === "adult" && maxOffered(person, "video", band, true);
  if (!holds) return [];
  if (ltx25MaxReady(engine)) return [{ id: "max", label: "Max", hint: "Sharpest picture, with sound" }];
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
    { id: "standard", label: "Standard", hint: ltx25 ? `Fast · sound · up to ${maxSecondsFor("quick", "ltx25", engine)} seconds` : engine === null ? "Fast · sound · up to 10 seconds when available" : `Silent · up to ${QUICK_MAX_SECONDS} seconds · fastest` },
    ...(boostOffered ? [{ id: "boost", label: "Boost", hint: ltx25 ? `Sharper picture · sound · up to ${maxSecondsFor("detailed", "ltx25", engine)} seconds` : "Needs a video engine for sharper picture and sound", ...(!ltx25 ? { disabled_reason: "Boost's sharper picture and sound require an optional video engine. Ask an admin to enable it in Settings." } : {}) }] : []),
    ...maxTierEntry(person, band, engine),
  ];
  return tiers.length > 1 ? { state: "tier", label: "Level", default: "standard", tiers } : null;
}

/** VIDEO-COMPOSER-04: the levels that make sound. Where the engine makes sound at every level the Sound chip is always open; where Standard is silent the chip is
 * disabled (and shows no sound) at Standard, so choosing a level turns the choice on or off. */
function soundTiers(): Record<string, unknown> {
  const engine = peekVideoEngineStatus();
  if (engine === null || ltx25VideoReady(engine)) return {};
  return { enabled_tiers: ["boost", "max"], disabled_reason: "This level makes silent clips. Choose Boost or Max for sound." };
}

/** The lengths the Length chip offers: five seconds and the longest available level makes here now. A level that makes less is cut to fit and says so. */
function lengthOptions(): number[] {
  const engine = peekVideoEngineStatus();
  // With no Stack answer yet, show the Standard ceiling as a choice instead of trapping the draft at Quick's five seconds.
  // Once a Stack answers, its real installed model limits the list.
  if (engine === null) return [QUICK_MAX_SECONDS, 10];
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
 * from recipes.ts, levels from tiers.ts, the look, camera, length and tier choices from the one lists. The page JSON holds none of them. */
/** The level segment reads the Stack's video status without waiting (`peekVideoEngineStatus`), which is empty on the first page after Home starts and
 * left Max out of the segment until a reload. The page awaits one real read first, for at most this long, so a slow Stack costs the page a moment, never the page. */
export const VIDEO_STATUS_WARM_MS = 1500;
registerAppPageWarm("video", "create", async () => {
  await Promise.race([Promise.all([videoEngineStatus(), syncLoras()]).then(() => undefined), new Promise<void>((resolve) => setTimeout(resolve, VIDEO_STATUS_WARM_MS))]);
});

/** The time under Generate, in plain words per level (docs/design/video-tiers-2026-11-02.md section 3: Standard 10 s about 43 s, Boost 5 s 42 to 74 s,
 * Max 10 s 205 s). Never credits, memory or model names. */
export const VIDEO_TIME_WORDS = { standard: "Standard, under a minute", boost: "Boost, about a minute", max: "Max, about four minutes" } as const;

registerAppPageFill("video", "create", (person, page) => {
  // A card whose loop is not in the package (not made yet, or removed) is a plain tile with its label, never a broken video.
  const media = (loop: string): { media?: string } => (packageAssetFile("video", loop) ? { media: loop } : {});
  const bar = findNode(page.body, "prompt_bar");
  if (!bar) return;
  const chips = Array.isArray(bar.chips) ? bar.chips as unknown[] : [];
  const lengths = lengthOptions();
  // Look, Camera (and Voices, folded under More settings) are the Style control: two thumbnails that open one popover (a sheet on a phone).
  bar.chips = [
    ...chips,
    { state: "seconds", label: "Length", group: "Settings", presentation: "popover", default: QUICK_MAX_SECONDS, options: lengths.map((value) => ({ value, label: `${value} seconds` })) },
    { state: "look", label: "Look", variant: "cards", presentation: "popover", group: "Style", default: VIDEO_LOOKS[0]!.id, quiet_value: VIDEO_LOOKS[0]!.id, options: VIDEO_LOOKS.map(({ id, label, loop }) => ({ value: id, label: id === VIDEO_LOOKS[0]!.id ? "Auto" : label, ...media(loop) })) },
    // Auto is the start for both: Look's Auto is `natural` (adds no words; a clip's tag still says "Natural"), Camera's Auto is "none" (the route reads it as not given).
    { state: "camera", label: "Camera", variant: "cards", presentation: "popover", group: "Style", default: "none", quiet_value: "none", options: [{ value: "none", label: "Auto" }, ...VIDEO_RECIPES.map(({ id, label, loop }) => ({ value: id, label, ...media(loop) }))] },
    { state: "voices", label: "Sound", align: "end", icon_only: true, default: DEFAULT_VIDEO_VOICES, quiet_value: DEFAULT_VIDEO_VOICES, ...soundTiers(), options: VIDEO_VOICES.map(({ id }) => id === "clean" ? ({ value: id, label: "No music or effects", icon: "volume-x" }) : ({ value: id, label: "Music and effects", icon: "volume-2" })) },
    // VIDEO-LORA-09: Styles, Characters and Strength join the Style popover; the person's own access and the Stack's LoRA report decide what shows and when it is disabled.
    ...styleChips({ person, engine: peekVideoEngineStatus(), offered: ((videoTierSegment(person)?.tiers as Array<{ id: StyleTier }> | undefined)?.map((t) => t.id)) ?? ["standard"] }),
    ...shotCardChips(person),
  ];
  // Make it Max shows only when this person holds Max and the Stack reports the Max model ready (the same offer the level segment makes); otherwise the
  // action is not drawn, so nobody presses a button whose answer is a refusal.
  const feed = findNode(page.body, "result_feed");
  if (feed && Array.isArray(feed.actions) && !maxOfferedNow(person)) feed.actions = (feed.actions as Array<{ action?: { call?: { target?: string } } }>).filter((entry) => !entry.action?.call?.target?.endsWith("/actions/max"));
  const tier = videoTierSegment(person);
  if (tier) {
    bar.tier = { ...tier, label: "Quality", presentation: "dropdown" };
    delete bar.submit_detail;
  } else {
    delete bar.submit_detail;
  }
});

/** CREATOR-20b: the Video composer reads the all-ages shot-card vocabulary from the fragment catalog. */
function shotCardChips(person: PersonRow): Array<Record<string, unknown>> {
  const groups = [["framing", "Framing"], ["camera", "Camera"], ["lens", "Lens"], ["light", "Light"], ["film_stock", "Film stock"], ["look", "Look"], ["grade", "Grade"]] as const;
  return groups.flatMap(([group, label]) => {
    const rows = listFragments({ actor: person, group });
    return rows.length ? [{ state: `card_${group}`, label, group: "Shot card", presentation: "popover", default: "none", quiet_value: "none", options: [{ value: "none", label: "None" }, ...rows.map((row) => ({ value: row.id, label: row.title }))] }] : [];
  });
}

/** CLIPS-FEED-01: Make another opens the Create page, which is for adults; a person below that floor gets the feed without the button. */
registerAppPageFill("video", "clips-feed", (person, page) => {
  if (meetsMinRole(person.role, "adult")) return;
  const feed = findNode(page.body, "clip_feed");
  const actions = feed?.actions as Record<string, unknown> | undefined;
  if (actions) delete actions.remake;
});

/** VIDEO-STUDIO-07: Export is offered only where the Stack can take an edit job: Home runs the AI on this computer and the Stack is set up. One plain line
 * where the person acts (the page shows it beside the button), never a raw error after a press. */
registerAppPageFill("video", "studio", (person, page) => {
  const studio = findNode(page.body, "studio");
  if (!studio) return;
  studio.limits = studioLimits;
  studio.level_steps = studioLevelSteps;
  const { tool_reasons, export_disabled_reason } = studioReadiness(person);
  if (Object.keys(tool_reasons).length > 0) studio.tool_reasons = tool_reasons;
  if (export_disabled_reason) studio.export_disabled_reason = export_disabled_reason;
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
  const files = madeFiles(person, "video");
  const favorites = favoriteFileIds(person, files.map((file) => file.id));
  // The person's own jobs say the level and length of a clip they made; a clip shared by someone else shows its maker's name.
  const jobOf = new Map(doneVideoJobsFor(person, null, false).flatMap((job) => job.files.map((file) => [file.id, job] as const)));  // SPATIAL-04: every file of a clip, so its 5.1 sibling reads as the same clip
  const rows = files.filter((file) => view !== "favorites" || favorites.has(file.id)).slice(0, limit).map((file) => {
    const job = jobOf.get(file.id);
    const seconds = job?.files[0]?.seconds ?? file.duration_seconds;
    const level = job ? levelWords(job) : null;
    const adult = adultStateOf(person, file.id);
    const actionFlags = file.owner.id === person.id ? { can_unmark: adult?.can_clear ?? false, can_mark: adult?.can_mark ?? false } : {};
    return { id: file.id, title: file.name, subtitle: job ? [level, seconds ? `${Math.round(seconds)} s` : null].filter(Boolean).join(", ") : file.owner.display_name || "Made at home", thumbnail: file.thumb_url, duration_s: file.duration_seconds, created_at: file.created_at, favorite: favorites.has(file.id), kind: "video", ...actionFlags, ...(file.audience === "adult-only" ? { adult_only: true } : {}) };
  });
  // ADULT-LOCK-02: locked clips are not in the list (the Library query leaves them out); one tile stands for all of them, leading the list.
  const locked = lockedVideoTile(person);
  // The All tab is the whole list; Favorites and Uploaded are narrower lists a locked clip is not part of (the tile would count it in).
  return locked && (!view || view === "all") ? [locked, ...rows] : rows;
}

/** CLIPS-FEED-01: a short clip is one of 60 seconds or less (a clip with no known length is not drawn in the feed). */
export const SHORT_CLIP_MAX_S = 60;
export const isShortClip = (seconds: number | null | undefined): boolean => typeof seconds === "number" && seconds > 0 && seconds <= SHORT_CLIP_MAX_S;
/** The most clips one Clips feed loads. */
const SHORT_CLIP_LIMIT = 60;

/** CLIPS-FEED-01: the Clips view's rows (`recipes` scope `short`): the short Library clips made at home that this person sees, newest first, exactly as the
 * Library lists them (own and shared; a locked or age-held clip is not in the list, so it is not here). No new store: the heart is the Favorite mark.
 * `prompt` (the clip's own words, for Make another on the Create page) goes only to a person who may open Create and only for their own jobs. A child's first
 * row says `autoplay: false`, so nothing plays or scrolls on its own for a child (docs/design/kid-mode-app-voice-2026-10-17.md section 8). */
export function shortClipRows(person: PersonRow): Array<Record<string, unknown>> {
  const files = madeFiles(person, "video").filter((file) => isShortClip(file.duration_seconds)).slice(0, SHORT_CLIP_LIMIT);
  const favorites = favoriteFileIds(person, files.map((file) => file.id));
  const mayCreate = meetsMinRole(person.role, "adult");
  const jobOf = mayCreate ? new Map(doneVideoJobsFor(person, null, false).flatMap((job) => job.files.map((file) => [file.id, job] as const))) : new Map<string, never>();
  const rows = files.map((file) => {
    const prompt = jobOf.get(file.id)?.prompt;
    return { id: file.id, title: file.name, subtitle: file.owner.display_name || "Made at home", src: `/api/files/${encodeURIComponent(file.id)}/content`, poster: file.thumb_url, duration_s: file.duration_seconds, liked: favorites.has(file.id), ...(prompt ? { prompt } : {}) } as Record<string, unknown>;
  });
  if (rows.length > 0 && speakerAgeBand(person, new Date()) === "child") rows[0] = { ...rows[0], autoplay: false };
  return rows;
}

const levelWords = (job: Parameters<typeof feedRowOf>[1]): string => ({ standard: "Standard", boost: "Boost", max: "Max" })[levelOfJob(job)];

/** VIDEO-UI-11: the "Try this" rail rows. A tile whose poster is not in the package is left out, never a broken picture. `look` and `camera` are the ids the Create panel's chips use
 * (a camera of "none" is the Auto card). Never a clip of the person's, so the rows are the same for everyone who may open the page (adults; appRouteAllowed refuses the rest). */
function showcaseRows(limit = VIDEO_SHOWCASE.length): Array<Record<string, unknown>> {
  return VIDEO_SHOWCASE.slice(0, Math.min(Math.max(limit, 1), VIDEO_SHOWCASE.length)).flatMap((tile) => {
    const poster = tile.poster.replace(/\.mp4$/, ".jpg");
    if (!packageAssetFile("video", poster)) return [];
    const look = videoLookFor(tile.look)!;
    const camera = videoRecipeFor(tile.camera);
    return [{ id: tile.id, title: tile.title, subtitle: [look.id === "natural" ? null : look.label, camera?.label ?? null].filter(Boolean).join(", ") || "Auto", thumbnail: `/api/plugins/video/assets/${poster}`, loop: `/api/plugins/video/assets/${tile.poster}`, prompt: tile.prompt, look: look.id, camera: camera?.id ?? "none" }];
  });
}

registerMediaAppData("video", (person, dataId, params) => {
  if (dataId !== "recipes") return null;
  // CLIPS-FEED-01: the Clips page is open to every role, and it binds `recipes`, so the page-level gate no longer keeps a child or teen out of the other scopes
  // (the Create pages' feed, jobs, Studio): they answer nothing unless the person holds the Create pages' adult floor.
  if (params.scope !== "short" && !meetsMinRole(person.role, "adult")) return null;
  switch (params.scope) {
    case "short": return shortClipRows(person);
    case undefined: return VIDEO_RECIPES.map(({ id, label, hint }) => ({ id, label, hint }));
    case "showcase": return showcaseRows(params.limit);
    // VIDEO-STUDIO-08: shared header data for the Studio surface. The same for everyone who may open the page.
    case "header": return [{ title: "Make any video" }];
    // STYLES-04: up to two styles for the words typed so far. The matcher reads the person's own access (a locked or minor list never holds an adult style).
    case "style-suggestions": return suggestStyles({ person, media: "video", text: params.query ?? "", surface: "own_written", proof: requestProof() }).items.map((l) => ({ id: l.id, name: l.name, kind: l.kind === "character" ? "character" : "style" }));
    case "feed": return feedRows(person, { favorites: params.favorites === true, type: params.type, limit: params.limit });
    case "job": return feedRowById(person, params.id);
    case "clips": return clipRows(person, params.view, Math.min(params.limit ?? 200, 200));
    // VIDEO-STUDIO-07: the Studio page. `studio` is the opened clip as the TrackStudio's row, `studio-header` its header row, `studio-picker` the clips to
    // pick from while none is open (no rows once one is, so the shelf under the Studio is not drawn).
    case "studio": return studioRows(person, params.id);
    case "studio-header": return studioHeaderRows(person, params.id);
    case "studio-picker": return params.id && !params.id.startsWith("$") ? [] : clipRows(person, "all", 60);
    // A scope this page does not know (the three old pages' scopes are gone) answers nothing.
    default: return [];
  }
});
