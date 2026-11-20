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
import { laneOfPerson } from "@/lib/pictures/laneGate";
import { styleChips, type StyleTier } from "@/lib/videos/createStyles";
import { syncLoras } from "@/lib/loras/sync";
import { allowedQuality, maxOffered } from "@/lib/tiers";
import { QUICK_MAX_SECONDS, DETAILED_MAX_SECONDS, h3EndPictureReady, h3VideoReady, ltx25EndPictureReady, ltx25MaxReady, ltx25VideoReady, maxSecondsFor } from "@/lib/videos/quality";
import { peekVideoEngineStatus, videoEngineStatus, videoMaxNotReadyReason, videoStatusReady } from "@/lib/videos/ready";
import { MAX_TAKE_SECONDS } from "@/lib/videos/longTake";
import { estimateVideoMinutes } from "@/lib/videos/estimate";
import { householdActiveVideoJobs } from "@/lib/videos/jobs";
import { registerAppPageFill, registerAppPageWarm } from "@/lib/apps";
import { readCreationByFile } from "@/lib/creations/store";
import { backfillCreationForFile } from "@/lib/creations/backfill";
import { getVideoJobFor } from "@/lib/videos/jobs";
import { getLoraRecord } from "@/lib/loras/store";
import { listFragments, listTemplates, templateBlanks } from "@/lib/media/templates";
import { templateCoverUrl } from "@/lib/templateCovers";
import { packageAssetFile } from "@/lib/packageAssets";
import { meetsMinRole } from "@/lib/plugins";
import { fillFilmMakerPage, filmRows, filmShotRows } from "@/lib/films/pageFilm";
import { allowed as filmAllowed } from "@/lib/films/background";
import { listFilmRunsInStates, type FilmRunState } from "@/lib/films/store";
import { renderPlanRows, storyboardRows } from "@/lib/films/storyboardRows";
import { getMediaProduction } from "@/lib/mediaProductions";
import type { PersonRow } from "@/types";
import { captionEditRows, captionLineRows, captionMakeRows } from "@/lib/videos/captionsPage";
import { MIX_LEVEL_IDS } from "@/lib/videos/editPlan";
import { listClonedVoices } from "@/lib/clonedVoices";
import { getOfferedVoices, peekOfferedVoices } from "@/lib/voiceResolve";
import { madeFiles, registerMadeFileView, registerMediaAppData } from "./appHost";

/** LTX25-MAX-01: the Max entry of the level segment. Offered only when the Stack reports the Max model ready AND this person holds Max (an adult, by grant or role). A person who holds Max, on a Stack that has the Max engine but not its pack ready, sees it
 * disabled with the one status line (`videoMaxNotReadyReason`; the pack installs from Settings, Models and storage, which carries the size and the licence prompt). A Stack without the engine, or a person who does not hold Max, sees nothing. */
function maxTierEntry(person: PersonRow, engine: ReturnType<typeof peekVideoEngineStatus>): Array<Record<string, unknown>> {
  // `maxOffered` reads the pass and the lane: a person outside the adult lane, or whose pass lacks Max, is not offered it.
  const holds = maxOffered(person, "video", undefined, true);
  if (!holds) return [];
  if (ltx25MaxReady(engine)) return [{ id: "max", label: "Max", hint: "Sharpest picture, with sound" }];
  if (engine?.qualities?.ltx25max) return [{ id: "max", label: "Max", disabled_reason: videoMaxNotReadyReason(engine) }];
  return [];
}

/** Whether Make it Max can be offered to this person now: an adult who holds Max, on a Stack that reports the Max model ready. */
function maxOfferedNow(person: PersonRow): boolean {
  return maxOffered(person, "video", undefined, true) && ltx25MaxReady(peekVideoEngineStatus());
}

/** The levels this person may use (Boost needs the Boost model and their say; Max needs the Max slot and their say). Standard alone is no choice, so no segment. */
export function videoTierSegment(person: PersonRow): Record<string, unknown> | null {
  // VIDEO-TIERS-01: with LTX-2.5 serving an adult (the page is adult-only), Standard is up to 10 seconds with sound and Boost up to 5 seconds with sound;
  // otherwise today's words. The ceilings come from `maxSecondsFor` (quality.ts), the one definition.
  const engine = peekVideoEngineStatus();
  const ltx25 = ltx25VideoReady(engine);
  const boostOffered = allowedQuality(person, "video", "detailed") === "detailed";
  const tiers = [
    { id: "standard", label: "Standard", hint: ltx25 ? `Fast · sound · up to ${maxSecondsFor("quick", "ltx25", engine)} seconds` : engine === null ? "Fast · sound · up to 10 seconds when available" : `Silent · up to ${QUICK_MAX_SECONDS} seconds · fastest` },
    ...(boostOffered ? [{ id: "boost", label: "Boost", hint: ltx25 ? `Sharper picture · sound · up to ${maxSecondsFor("detailed", "ltx25", engine)} seconds` : "Needs a video engine for sharper picture and sound", ...(!ltx25 ? { disabled_reason: "Boost's sharper picture and sound require an optional video engine. Ask an admin to enable it in Settings." } : {}) }] : []),
    ...maxTierEntry(person, engine),
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

/** One Shot (LONGTAKE-02 in part): Create's Length also lists whole multiples of the longest single piece up to the longest unbroken take (`MAX_TAKE_SECONDS`).
 * Those lengths are made as parts that continue from each other (lib/videos/longTake.ts) and say so on the option. Only when LTX-2.5 serves, as the chain needs it. */
export function createLengthOptions(): Array<{ value: number; label: string }> {
  const single = lengthOptions();
  const options = single.map((value) => ({ value, label: `${value} seconds` }));
  const engine = peekVideoEngineStatus();
  if (engine === null || !ltx25VideoReady(engine)) return options;
  const piece = Math.max(...single);
  for (let n = 2; piece * n <= MAX_TAKE_SECONDS; n += 1) options.push({ value: piece * n, label: `${piece * n} seconds, made in parts` });
  return options;
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

/** TAKES-02: the plain line under Generate for one level: the time (this home's own finished clips when there are enough, else the fixed words above) and where the engine stands.
 * The kit has no read-only status chip, so the engine's state rides in this one line. Never memory, credits or model names. */
export function videoEngineLine(): string | null {
  const engine = peekVideoEngineStatus();
  if (engine === null) return null;
  if (!videoStatusReady(engine, true)) return "Video is not set up on this computer yet";
  if (engine.memory?.fits === false) return "Too big for this computer right now";
  const ahead = householdActiveVideoJobs();
  return ahead === 0 ? "Ready" : `Busy: ${ahead} ahead of you`;
}
export function videoTimeLine(tier: "standard" | "boost" | "max", seconds: number): string {
  const { minutes } = estimateVideoMinutes({ tier, seconds });
  const time = minutes === null ? VIDEO_TIME_WORDS[tier] : `About ${minutes} ${minutes === 1 ? "minute" : "minutes"} on this computer`;
  const engine = videoEngineLine();
  return (engine ? `${time} · ${engine}` : time).slice(0, 80);
}

/** The kit page schema allows at most 16 chips on a prompt bar. When styles, characters and strength all show beside the seven shot cards the set is over, so the last shot cards (Grade, then Film stock) give way. */
export function capChips(chips: Array<Record<string, unknown>>, max = 16): Array<Record<string, unknown>> {
  const out = [...chips];
  for (const state of ["card_grade", "card_film_stock", "card_light"]) {
    if (out.length <= max) break;
    const at = out.findIndex((chip) => chip.state === state);
    if (at >= 0) out.splice(at, 1);
  }
  return out.slice(0, max);
}

registerAppPageFill("video", "create", (person, page) => {
  // A card whose loop is not in the package (not made yet, or removed) is a plain tile with its label, never a broken video.
  const media = (loop: string): { media?: string } => (packageAssetFile("video", loop) ? { media: loop } : {});
  const bar = findNode(page.body, "prompt_bar");
  if (!bar) return;
  const chips = Array.isArray(bar.chips) ? bar.chips as unknown[] : [];
  const templates = listTemplates({ actor: person, kind: "video" });
  const templateChip = { state: "template", label: "Template", group: "Template", icon: "sparkles", icon_only: true, presentation: "popover", default: "none", quiet_value: "none", options: [{ value: "none", label: "No template" }, ...templates.map((row) => ({ value: row.id, label: row.title }))] };
  const selectedTemplate = templates.find((row) => row.id === (page.state as Record<string, unknown> | undefined)?.template);
  if (selectedTemplate) {
    templateChip.default = selectedTemplate.id;
    const state = page.state as Record<string, unknown> | undefined;
    if (state) state.template = selectedTemplate.id;
  }
  const call = (bar.submit as { call?: { args?: Record<string, unknown> } } | undefined)?.call;
  if (call?.args) call.args.template = "{template}";
  // A template is a recipe (same shape as Images): each plain blank is a labelled field above the box, shown only while that template is chosen, and the values ride as `blanks`.
  const blankFields: Array<{ state: string; label: string; placeholder: string; max_length: number; when: { state: string; equals: string } }> = [];
  const blankNames = new Set<string>();
  for (const template of templates) for (const blank of templateBlanks(template.prompt)) {
    if (blank.name.startsWith("cast_") || blank.name.startsWith("photo_")) continue;
    blankNames.add(blank.name);
    blankFields.push({ state: `blank_${blank.name}`, label: blank.label.slice(0, 40), placeholder: blank.example.slice(0, 120), max_length: 300, when: { state: "template", equals: template.id } });
  }
  if (blankFields.length) (bar as Record<string, unknown>).fields = blankFields;
  if (selectedTemplate) bar.placeholder = "Fill in the field above, add any extra direction here, or just press Make video to use the example.";
  // The page fills `{state}` only in top-level arguments, so each blank rides as its own `blank_<name>` argument and the server gathers them.
  if (call?.args) for (const name of blankNames) call.args[`blank_${name}`] = `{blank_${name}}`;
  const lengths = lengthOptions();
  // Look, Camera (and Voices, folded under More settings) are the Style control: two thumbnails that open one popover (a sheet on a phone).
  // Owner rule (2026-11-13): every chip is icon-only (the dropdown names the choices, the tooltip says "Label: value"). Orientation comes from the page JSON, so it gets its icons here.
  for (const item of chips) {
    const chip = item as Record<string, unknown>;
    if (chip?.state !== "orientation") continue;
    chip.icon = "rectangle-horizontal";
    chip.icon_only = true;
    const icons: Record<string, string> = { landscape: "rectangle-horizontal", portrait: "rectangle-vertical" };
    if (Array.isArray(chip.options)) for (const option of chip.options as Array<Record<string, unknown>>) if (icons[String(option.value)]) option.icon = icons[String(option.value)];
  }
  const allChips = [
    templateChip,
    ...chips,
    { state: "seconds", label: "Length", group: "Settings", icon: "clock", icon_only: true, presentation: "popover", default: QUICK_MAX_SECONDS, options: createLengthOptions() },
    // TAKES-01: how many takes of the prompt one press makes (different seeds, one queue). The most a level allows is checked when Generate runs.
    { state: "takes", label: "Takes", group: "Settings", icon: "layers", icon_only: true, presentation: "popover", default: 1, quiet_value: 1, options: [1, 2, 3, 4].map((value) => ({ value, label: value === 1 ? "1 take" : `${value} takes` })) },
    { state: "look", label: "Look", icon: "palette", icon_only: true, variant: "cards", presentation: "popover", group: "Style", default: VIDEO_LOOKS[0]!.id, quiet_value: VIDEO_LOOKS[0]!.id, options: VIDEO_LOOKS.map(({ id, label, loop }) => ({ value: id, label: id === VIDEO_LOOKS[0]!.id ? "Auto" : label, ...media(loop) })) },
    // Auto is the start for both: Look's Auto is `natural` (adds no words; a clip's tag still says "Natural"), Camera's Auto is "none" (the route reads it as not given).
    { state: "camera", label: "Camera", icon: "clapperboard", icon_only: true, variant: "cards", presentation: "popover", group: "Style", default: "none", quiet_value: "none", options: [{ value: "none", label: "Auto" }, ...VIDEO_RECIPES.map(({ id, label, loop }) => ({ value: id, label, ...media(loop) }))] },
    { state: "voices", label: "Sound", align: "end", icon: "volume-2", icon_only: true, default: DEFAULT_VIDEO_VOICES, quiet_value: DEFAULT_VIDEO_VOICES, ...soundTiers(), options: VIDEO_VOICES.map(({ id }) => id === "clean" ? ({ value: id, label: "No music or effects", icon: "volume-x" }) : ({ value: id, label: "Music and effects", icon: "volume-2" })) },
    // VIDEO-LORA-09: Styles, Characters and Strength join the Style popover; the person's own access and the Stack's LoRA report decide what shows and when it is disabled.
    ...styleChips({ person, engine: peekVideoEngineStatus(), offered: ((videoTierSegment(person)?.tiers as Array<{ id: StyleTier }> | undefined)?.map((t) => t.id)) ?? ["standard"] }),
    ...shotCardChips(person),
  ];
  bar.chips = capChips(allChips as Array<Record<string, unknown>>);
  // VIDEO-INPUTS-03: a second picture slot (the clip ends on it) only where the maker reports `end_image`; the kit's `row` slot sits beside the Start picture's field slot.
  const engineNow = peekVideoEngineStatus();
  const refs = Array.isArray(bar.references) ? (bar.references as Array<Record<string, unknown>>).filter((ref) => ref.state !== "end_frame") : [];
  if (h3EndPictureReady(engineNow) || ltx25EndPictureReady(engineNow) || ltx25EndPictureReady(engineNow, true)) refs.push({ state: "end_frame", label: "End image", kind: "picture" });
  bar.references = refs;
  // Make it Max shows only when this person holds Max and the Stack reports the Max model ready (the same offer the level segment makes); otherwise the
  // action is not drawn, so nobody presses a button whose answer is a refusal.
  const feed = findNode(page.body, "result_feed");
  if (feed && Array.isArray(feed.actions) && !maxOfferedNow(person)) feed.actions = (feed.actions as Array<{ action?: { call?: { target?: string } } }>).filter((entry) => !entry.action?.call?.target?.endsWith("/actions/max"));
  const tier = videoTierSegment(person);
  // TAKES-02: the time and the engine's state under Generate, per level (by length when Standard is the only level).
  if (tier) {
    bar.tier = { ...tier, label: "Quality", presentation: "dropdown" };
    const labels: Record<string, string> = {};
    for (const entry of tier.tiers as Array<{ id: "standard" | "boost" | "max" }>) labels[entry.id] = videoTimeLine(entry.id, QUICK_MAX_SECONDS);
    bar.submit_detail = { state: "tier", labels };
  } else {
    const labels: Record<string, string> = {};
    for (const { value } of createLengthOptions()) labels[String(value)] = videoTimeLine("standard", value);
    bar.submit_detail = { state: "seconds", labels };
  }
});

// VOICEOVER-PAGE: the voices the Voiceover page offers are the ones the edit tool accepts (voiceChoice): the person's usual voice, the household's own voices, then the
// voices the engine in use offers. The engine's list is read in the warm-up (cached 30 s); the fill only peeks.
registerAppPageWarm("video", "voiceover", async () => { await getOfferedVoices(); });

const LEVEL_WORDS: Record<(typeof MIX_LEVEL_IDS)[number], string> = { quiet: "Quiet", soft: "Soft", balanced: "Balanced", loud: "Loud", very_loud: "Very loud" };
const clip40 = (text: string): string => text.length > 40 ? `${text.slice(0, 39).trimEnd()}\u2026` : text;

export function voiceoverVoiceOptions(): Array<{ value: string; label: string; icon: string }> {
  const seen = new Set<string>(["default"]);
  const options = [{ value: "default", label: "My usual voice", icon: "mic" }];
  for (const voice of listClonedVoices()) if (!seen.has(voice.id)) { seen.add(voice.id); options.push({ value: voice.id, label: clip40(voice.label), icon: "mic" }); }
  for (const voice of peekOfferedVoices() ?? []) if (!seen.has(voice.id)) { seen.add(voice.id); options.push({ value: voice.id, label: clip40(voice.name), icon: "mic" }); }
  return options.slice(0, 24);
}

registerAppPageFill("video", "voiceover", (_person, page) => {
  const bar = findNode(page.body, "prompt_bar");
  if (!bar) return;
  bar.chips = [
    { state: "voice", label: "Voice", icon: "mic", icon_only: true, presentation: "popover", group: "Voice", default: "default", quiet_value: "default", options: voiceoverVoiceOptions() },
    { state: "level", label: "Loudness", icon: "volume-2", icon_only: true, presentation: "popover", group: "Voice", default: "balanced", quiet_value: "balanced", options: MIX_LEVEL_IDS.map((id) => ({ value: id, label: LEVEL_WORDS[id] })) },
  ];
});

// CREATOR-26: reuse Create's own Shape and Quality fill so the option lists and icons have one definition.
// FILM-PAGE-01: the Film maker page's style and shot choices.
registerAppPageFill("video", "film-maker", fillFilmMakerPage);

registerAppPageFill("video", "talking-avatar", (person, page) => {
  const bar = findNode(page.body, "prompt_bar");
  if (!bar) return;
  const chips = Array.isArray(bar.chips) ? bar.chips as Array<Record<string, unknown>> : [];
  for (const chip of chips) {
    if (chip.state === "orientation") {
      chip.icon = "rectangle-horizontal";
      chip.icon_only = true;
      const icons: Record<string, string> = { landscape: "rectangle-horizontal", portrait: "rectangle-vertical" };
      if (Array.isArray(chip.options)) for (const option of chip.options as Array<Record<string, unknown>>) if (icons[String(option.value)]) option.icon = icons[String(option.value)];
    }
  }
  const tier = videoTierSegment(person);
  bar.chips = [...chips, { state: "seconds", label: "Length", group: "Settings", icon: "clock", icon_only: true, presentation: "popover", default: QUICK_MAX_SECONDS, options: lengthOptions().map((value) => ({ value, label: `${value} seconds` })) }, ...(tier ? [{ state: "tier", label: "Quality", icon: "sparkles", icon_only: true, presentation: "popover", default: tier.default, options: (tier.tiers as Array<{ id: string; label: string }>).map((entry) => ({ value: entry.id, label: entry.label })) }] : [])];
});

/** CREATOR-20b: the Video composer reads the all-ages shot-card vocabulary from the fragment catalog. */
function shotCardChips(person: PersonRow): Array<Record<string, unknown>> {
  // The kit page schema allows at most 16 chips on a prompt bar.
  const groups = [["framing", "Framing"], ["camera", "Camera"], ["lens", "Lens"], ["light", "Light"], ["film_stock", "Film stock"], ["look", "Look"], ["grade", "Grade"]] as const;
  return groups.flatMap(([group, label]) => {
    const rows = listFragments({ actor: person, group });
    return rows.length ? [{ state: `card_${group}`, label, group: "Shot", icon: "camera", icon_only: true, presentation: "popover", default: "none", quiet_value: "none", options: [{ value: "none", label: "None" }, ...rows.map((row) => ({ value: row.id, label: row.title }))] }] : [];
  });
}

/** CLIPS-FEED-01: Make another opens the Create page, which is for adults; a person below that floor gets the feed without the button. */
registerAppPageFill("video", "clips-feed", (person, page) => {
  if (meetsMinRole(person.role, "adult")) return;
  const feed = findNode(page.body, "clip_feed");
  const actions = feed?.actions as Record<string, unknown> | undefined;
  if (actions) delete actions.remake;
});

/** Words for a clip's frame shape; pixel dimensions stay internal. */
export function videoShape(width: number, height: number): "wide" | "tall" | "square" {
  return width > height ? "wide" : height > width ? "tall" : "square";
}

/** Only labels and values already held by the maker's guarded creation record are returned. */
export function creationDetailsFor(person: PersonRow, fileId: string): Array<{ label: string; value: string }> {
  // The feed row id is the job id; a file id also works.
  const job = getVideoJobFor(person, fileId);
  const fileOf = job ? (job.files.find((f) => f.id && !f.poster_id) ?? job.files[0])?.id ?? fileId : fileId;
  const read = readCreationByFile(person, fileOf, undefined, backfillCreationForFile);
  if (read.state !== "ok" || read.creation.kind !== "video") return [];
  const creation = read.creation;
  const rows: Array<{ label: string; value: string }> = [];
  const add = (label: string, value: string | null | undefined) => { if (value) rows.push({ label, value }); };
  add("Prompt", creation.words?.written ?? creation.words?.composed);
  add("Length", creation.generation?.duration_s ? `${creation.generation.duration_s} seconds` : creation.settings?.seconds ? `${creation.settings.seconds} seconds` : null);
  const { width, height } = creation.settings ?? {};
  add("Shape", width && height ? videoShape(width, height) : null);
  const seed = creation.generation?.seed;
  add("Seed", seed === null || seed === undefined ? null : String(seed));
  const styles = (creation.settings?.styles ?? []).map((style) => getLoraRecord(style.style_id)?.name).filter((name): name is string => Boolean(name));
  if (styles.length) add("LoRAs and styles", styles.join(", "));
  if (creation.sources.length) add("Started from", creation.sources.map((source) => source.role === "start" ? "source picture" : source.role === "sheet" ? "reference sheet" : source.role === "reference" ? "reference picture" : source.role === "edit_source" ? "source clip" : "source clip").join(", "));
  if (creation.cast.length) add("Cast", creation.cast.length === 1 ? "1 person or character" : `${creation.cast.length} people or characters`);
  if (creation.parent_id) add("Made from", "another clip (a take or an edit)");
  const checks = creation.checks;
  if (checks && typeof checks === "object") {
    const findings = (checks as { findings?: unknown }).findings;
    if (Array.isArray(findings) && findings.length) add("Clip checks", findings.filter((item): item is string => typeof item === "string").join("; ") || null);
  }
  return rows;
}

/** Shot notes on the watch page: the maker's own clip adds its engine, length, size, seed and styles under the facts line. The same rows as How it was made;
 * a clip made by someone else, or one with no record, adds nothing. */
registerMadeFileView("video", (person, file, view) => {
  const notes = creationDetailsFor(person, file.id).filter((row) => row.label !== "Prompt" && row.label !== "Clip checks");
  if (notes.length === 0) return view;
  const lines = notes.map((row) => `${row.label}: ${row.value}`).join(" · ");
  const existing = (view as { facts?: string }).facts;
  return { ...view, facts: existing ? `${existing} · ${lines}` : lines } as typeof view;
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
  if (rows.length > 0 && laneOfPerson(person) === "child") rows[0] = { ...rows[0], autoplay: false };
  return rows;
}

/** VF-UI-02: the viewer's own top-level film runs for the two library shelves. */
export function filmShelfRows(person: PersonRow, states: FilmRunState[]): Array<Record<string, unknown>> {
  if (!filmAllowed(person)) return [];
  return listFilmRunsInStates(states).filter((run) => run.person_id === person.id && !run.parent_id).map((run) => {
    const production = run.production_id ? getMediaProduction(person, run.production_id) : null;
    const still = production?.episodes.flatMap((episode) => episode.scenes.flatMap((scene) => scene.shots)).find((shot) => shot.picture_file_id)?.picture_file_id;
    const words = run.idea.trim().split(/\s+/).filter(Boolean);
    const title = run.plan?.title || (words.length > 6 ? `${words.slice(0, 6).join(" ")}…` : words.join(" ")) || "Your film";
    const subtitles: Record<string, string> = { planning: "Planning the film", running: "Making the shots", waiting_for_go: "Waiting for your go", failed: "Did not finish", cancelled: "Stopped" };
    return { id: run.id, title, subtitle: subtitles[run.state], ...(still ? { thumbnail: `/api/files/${encodeURIComponent(still)}/thumb?w=320` } : {}) };
  });
}

/** VF-UI-03b: the newest take of the Create feed as the one row of the page's media_stage: a finished take loops, a take being made waits with its progress, a failed take shows
 * its plain error with Try again. Nothing here names a model or a pixel size; the facts line is the shape word and the length. A locked take (the feed's lock tile) makes no stage. */
export function stageRows(person: PersonRow): Array<Record<string, unknown>> {
  const row = feedRows(person, { limit: 1 })[0];
  if (!row || typeof row.id !== "string" || row.locked === true || row.status === "locked" || row.status === "cancelled") return [];
  const words = String(row.prompt ?? "").trim().split(/\s+/).filter(Boolean);
  const title = words.length > 8 ? `${words.slice(0, 8).join(" ")}…` : words.join(" ");
  const job = getVideoJobFor(person, row.id);
  const [width, height] = (job?.request.size ?? "").split("x").map(Number);
  const seconds = job?.files[0]?.seconds ?? job?.request.seconds ?? null;
  const shape = width && height ? videoShape(width, height) : null;
  const facts = [shape ? `${shape[0]!.toUpperCase()}${shape.slice(1)}` : null, seconds ? `${seconds} seconds` : null].filter(Boolean).join(" · ");
  const made = row.state === "done";
  const waiting = row.state === "queued" || row.state === "running";
  const failed = row.state === "failed";
  const still = typeof row.still === "string" ? row.still : null;
  return [{
    ...row,
    still, loop: made && typeof row.src === "string" ? row.src : null, position: null,
    description: title ? `The clip: ${title}` : "Your latest clip",
    stage_state: failed ? "error" : waiting ? "waiting" : made ? (typeof row.src === "string" ? "looping" : "idle") : "paused",
    eyebrow: failed ? "Did not finish" : waiting ? (typeof row.phase === "string" && row.phase ? row.phase : "Waiting for its turn") : "Latest take",
    title, subtitle: facts || null,
    progress: waiting && typeof row.percent === "number" ? row.percent : null,
    error_message: failed ? String(row.error ?? "It did not finish. Try again.") : null,
  }];
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
  if (!["short", "making-films", "unfinished-films"].includes(String(params.scope)) && !meetsMinRole(person.role, "adult")) return null; // the film shelves answer no rows below an adult (filmShelfRows)
  switch (params.scope) {
    case "templates": return listTemplates({ actor: person, kind: "video" }).slice(0, Math.min(params.limit ?? 100, 100)).map((row) => ({ id: row.id, title: row.title, subtitle: row.summary, thumbnail: templateCoverUrl(row.id) }));
    case "short": return shortClipRows(person);
    case "stage": return stageRows(person);
    case "storyboard": return storyboardRows(person, params.id);
    case "render-plan": return renderPlanRows(person, params.id);
    case "making-films": return filmShelfRows(person, ["planning", "running"]);
    case "unfinished-films": return filmShelfRows(person, ["waiting_for_go", "failed", "cancelled"]);
    case undefined: return VIDEO_RECIPES.map(({ id, label, hint }) => ({ id, label, hint }));
    case "showcase": return showcaseRows(params.limit);
    // VIDEO-STUDIO-08: shared header data for the Studio surface. The same for everyone who may open the page.
    case "header": return [{ title: "Make any video" }];
    // STYLES-04: up to two styles for the words typed so far. The matcher reads the person's own access (a locked or minor list never holds an adult style).
    case "style-suggestions": return suggestStyles({ person, media: "video", text: params.query ?? "", surface: "own_written", proof: requestProof() }).items.map((l) => ({ id: l.id, name: l.name, kind: l.kind === "character" ? "character" : "style" }));
    case "feed": {
      const rows = feedRows(person, { favorites: params.favorites === true, hidden: params.hidden === true, type: params.type, limit: params.limit });
      // VF-UI-03b: the stage above the feed shows the newest take, so the unfiltered feed starts at the second newest (one take, one place). A locked newest take makes no stage and stays in the feed.
      const plain = params.favorites !== true && params.hidden !== true && (!params.type || params.type === "all");
      // A failed take stays in the feed too: the stage's error strip can clip its words on a phone, and the feed row always shows them in full.
      const onStage = params.view === "after-stage" && plain ? stageRows(person)[0] : undefined;
      return onStage && onStage.stage_state !== "error" ? rows.slice(1) : rows;
    }
    case "job": return feedRowById(person, params.id);
    // FILM-PAGE-01: the Film maker page (lib/films/pageFilm.ts): the newest film, and its shots as cards.
    case "film": return filmRows(person, params.id);
    case "film-shots": return filmShotRows(person, params.id);
    case "how-made": return params.id ? creationDetailsFor(person, params.id) : [];
    case "clips": return clipRows(person, params.view, Math.min(params.limit ?? 200, 200));
    // VIDEO-STUDIO-07: the Studio page. `studio` is the opened clip as the TrackStudio's row, `studio-header` its header row, `studio-picker` the clips to
    // pick from while none is open (no rows once one is, so the shelf under the Studio is not drawn).
    case "studio": return studioRows(person, params.id);
    case "studio-header": return studioHeaderRows(person, params.id);
    case "studio-picker": return params.id && !params.id.startsWith("$") ? [] : clipRows(person, "all", 60);
    // CAPTIONS-PAGE-01: the Captions page: the clip's caption lines, the one row that opens them as text, and the one row that makes them.
    case "caption-lines": return captionLineRows(person, params.id);
    case "caption-edit": return captionEditRows(person, params.id);
    case "caption-make": return captionMakeRows(person, params.id);
    // A scope this page does not know (the three old pages' scopes are gone) answers nothing.
    default: return [];
  }
});
