// The seven job cards for the AI and models page, and the one
// "set everything to recommended" plan. Pure and side-effect free: the tier's
// disk plan, the Stack component list, three household settings and the free
// disk bytes in, the cards, the Always on line and the recommended plan out.
// Home's backend and the setup wizard share it, so it imports only
// ./diskPlanMath and nothing from backend/ or frontend/.

import { sizeGb, needGb, freeGb, selectionTotals, type DiskPlan, type DiskRow } from "./diskPlanMath";

export type AiJobId = "chat" | "pictures" | "videos" | "music" | "voice" | "coding";
export interface AiComponentLike { id: string; label: string; state: "installed"|"installing"|"notInstalled"|"failed"; size_bytes: number|null; download_bytes: number; requirement: "required"|"optional"|"unsupported"; requirement_reason: string|null; percent: number|null; job: string|null; failure: string|null; can_install: boolean; can_uninstall: boolean; last_used_at: string|null; used_by: string[] }
export interface AiSettingsInput { pictureQuality: "quick"|"detailed"; videoQuality: "quick"|"detailed"; musicEnabled: boolean }
/** The words of the cards, read from the spec's card and key copy (rule S5): this file holds none of its own. */
export interface AiCopy {
  card(job: AiJobId): { title: string; summary: string };
  choice(id: string): { label: string; description: string };
}
export interface AiChoicesInput { copy: AiCopy; plan: DiskPlan; components: AiComponentLike[] | null; settings: AiSettingsInput; freeBytes: number | null }
export interface AiChoice {
  id: string;
  job: AiJobId; kind: "radio" | "switch" | "fixed";
  label: string; description: string;
  name: string;
  rowIds: string[];
  recommended: boolean; current: boolean;
  state: "installed"|"installing"|"notInstalled"|"failed"; percent: number|null; failure: string|null;
  downloadBytes: number; installedBytes: number;
  stateText: string;
  blockedReason: string|null;
  action: "none" | "use" | "get" | "remove";
  setting: { key: string; value: unknown } | null;
  chosenNotReady: boolean;
  details: Array<{ name: string; sizeBytes: number }>;
}
export interface AiCard { id: AiJobId; title: string; summary: string; chip: string; choices: AiChoice[]; notReady: boolean; unavailable: string | null }
export interface AiAlwaysOn { bytes: number; rowIds: string[] }
export interface AiChoicesResult { cards: AiCard[]; alwaysOn: AiAlwaysOn }
export interface AiRecommendedPlan {
  changes: Array<{ job: AiJobId; from: string; to: string; setting: { key: string; value: unknown } | null }>;
  installRowIds: string[]; installComponentIds: string[];
  skipped: Array<{ rowId: string; label: string; reason: string }>;
  downloadBytes: number; fits: "all" | "some" | "none"; nothingToDo: boolean;
  text: string;
}

type AiCopyKey = "chat.standard" | "chat.mlx" | "chat.pictures" | "pictures.quick" | "pictures.detailed" | "pictures.edit" | "pictures.tools" | "pictures.look" | "videos.quick" | "videos.detailed" | "music.make" | "voice.standard" | "voice.better" | "coding.helper";

// The rows each job card draws.
const CARDS: Array<{ id: AiJobId; rows: string[] }> = [
  { id: "chat", rows: ["chat", "chat-mlx", "reads-pictures"] },
  { id: "pictures", rows: ["pictures", "pictures-ernie", "pictures-zimage", "image-tools", "tool-look"] },
  { id: "videos", rows: ["video", "video-detailed"] },
  { id: "music", rows: ["music"] },
  { id: "voice", rows: ["voice", "voice-better"] },
  { id: "coding", rows: ["coding"] },
];

function byRowId(plan: DiskPlan): Map<string, DiskRow> {
  return new Map(plan.rows.map((row) => [row.id, row] as const));
}

function engineRowsOf(plan: DiskPlan, row: DiskRow): DiskRow[] {
  const ids = new Set(row.engines);
  return plan.rows.filter((candidate) => candidate.kind === "engine" && ids.has(candidate.id));
}

function matchingComponents(components: AiComponentLike[] | null, row: DiskRow): AiComponentLike[] {
  if (!components) return [];
  return components.filter((component) => component.id === row.id || row.model_ids.includes(component.id));
}

interface RowState { state: AiChoice["state"]; percent: number | null; failure: string | null; unsupported: AiComponentLike | null }

// The state a row reads from its Stack components: installed only when every
// matching part is installed, installing when any is, failed when any is.
// With no component list or no match, the plan row's own installed flag rules.
function rowState(row: DiskRow, components: AiComponentLike[] | null): RowState {
  const matches = matchingComponents(components, row);
  const unsupported = matches.find((component) => component.requirement === "unsupported") ?? null;
  if (matches.length === 0) {
    return { state: row.installed ? "installed" : "notInstalled", percent: null, failure: null, unsupported: null };
  }
  const failed = matches.find((component) => component.state === "failed");
  if (failed) return { state: "failed", percent: null, failure: failed.failure, unsupported };
  const installing = matches.find((component) => component.state === "installing");
  if (installing) return { state: "installing", percent: installing.percent, failure: null, unsupported };
  if (matches.every((component) => component.state === "installed")) {
    return { state: "installed", percent: null, failure: null, unsupported };
  }
  return { state: "notInstalled", percent: null, failure: null, unsupported };
}

// The plan with each row's installed flag read from the Stack's component list when it answers, so the sizes of what is
// still missing (and the engine environments that come with a part) are measured against what is really on this computer.
function withLiveInstalled(plan: DiskPlan, components: AiComponentLike[] | null): DiskPlan {
  if (!components) return plan;
  const modelRows = plan.rows.map((row) => (row.kind === "engine" ? row : { ...row, installed: rowState(row, components).state === "installed" || (matchingComponents(components, row).length === 0 && row.installed) }));
  const engineInstalled = new Set(modelRows.filter((row) => row.kind !== "engine" && row.installed).flatMap((row) => row.engines));
  return { ...plan, rows: modelRows.map((row) => (row.kind === "engine" ? { ...row, installed: row.installed || engineInstalled.has(row.id) } : row)) };
}

// The free space this choice needs to install: the row and the engine rows it
// names that are not yet on the computer, each with its 20 percent margin and
// its temporary space.
function needBytesForRow(plan: DiskPlan, row: DiskRow): number {
  const rows = [row, ...engineRowsOf(plan, row)].filter((candidate) => !candidate.installed);
  return rows.reduce((total, candidate) => total + Math.ceil(candidate.installed_bytes * 1.2) + candidate.peak_temp_bytes, 0);
}

function blockedReasonFor(plan: DiskPlan, row: DiskRow, state: RowState, freeBytes: number | null): string | null {
  if (state.unsupported) return state.unsupported.requirement_reason ?? "This computer does not have the memory for it.";
  if (freeBytes === null || state.state === "installed" || state.state === "installing") return null;
  const need = needBytesForRow(plan, row);
  if (need > freeBytes) return `Needs about ${needGb(need)} GB free. This computer has ${freeGb(freeBytes)} GB free.`;
  return null;
}

// The size a person reads on a state line, never an MB figure.
function stateSize(bytes: number): string {
  const size = sizeGb(bytes);
  return size.endsWith(" MB") ? "under 1 GB" : size;
}

interface ChoiceSpec {
  id: AiCopyKey;
  job: AiJobId;
  kind: AiChoice["kind"];
  row: DiskRow;
  current: boolean;
  recommended: boolean;
  setting: { key: string; value: unknown } | null;
}

function buildChoice(copyOf: AiCopy, plan: DiskPlan, components: AiComponentLike[] | null, freeBytes: number | null, spec: ChoiceSpec): AiChoice {
  const rows = [spec.row, ...engineRowsOf(plan, spec.row)];
  const state = rowState(spec.row, components);
  const blockedReason = blockedReasonFor(plan, spec.row, state, freeBytes);
  const downloadBytes = rows.reduce((total, row) => total + row.download_bytes, 0);
  const installedBytes = rows.reduce((total, row) => total + row.installed_bytes, 0);
  const stateText = state.state === "installed" ? "Installed" : state.state === "installing" ? "Installing" : state.state === "failed" ? "Did not finish. Try again." : `Not installed, ${stateSize(downloadBytes)}`;
  let action: AiChoice["action"];
  if (blockedReason !== null) action = "none";
  else if (state.state === "installing") action = "none";
  else if (state.state === "installed") action = spec.current ? (spec.kind === "switch" ? "remove" : "none") : "use";
  else action = "get";
  const copy = copyOf.choice(spec.id);
  return {
    id: spec.id,
    job: spec.job,
    kind: spec.kind,
    label: copy.label,
    description: copy.description,
    name: copy.label,
    rowIds: rows.map((row) => row.id),
    recommended: spec.recommended,
    current: spec.current,
    state: state.state,
    percent: state.percent,
    failure: state.failure,
    downloadBytes,
    installedBytes,
    stateText,
    blockedReason,
    action,
    setting: spec.setting,
    chosenNotReady: spec.current && state.state !== "installed",
    details: rows.map((row) => ({ name: row.label, sizeBytes: row.installed_bytes })),
  };
}

function chipFor(card: { id: AiJobId; rows: string[] }, present: boolean, choices: AiChoice[]): string {
  if (!present) return "Not on this computer";
  switch (card.id) {
    case "chat":
      return "Using Standard";
    case "pictures":
    case "videos": {
      const current = choices.find((choice) => choice.kind === "radio" && choice.current);
      if (!current) return choices.some((choice) => choice.state === "installed") ? "On" : "Off";
      if (current.state !== "installed") return "Chosen, not ready";
      const quickId = card.id === "pictures" ? "pictures.quick" : "videos.quick";
      return current.id === quickId ? "Using Quick" : "Using Detailed";
    }
    case "voice": {
      const better = choices.find((choice) => choice.id === "voice.better");
      if (better && better.current) return better.state === "installed" ? "Using Better" : "Chosen, not ready";
      return "Using Standard";
    }
    case "music":
    case "coding": {
      const toggle = choices.find((choice) => choice.kind === "switch");
      if (!toggle || !toggle.current) return "Off";
      return toggle.state === "installed" ? "On" : "Chosen, not ready";
    }
  }
}

export function buildAiCards(input: AiChoicesInput): AiChoicesResult {
  const { components, settings, freeBytes, copy } = input;
  const plan = withLiveInstalled(input.plan, components);
  const rows = byRowId(plan);
  const has = (id: string): boolean => rows.has(id);
  const need = (id: string): DiskNeedLike => rows.get(id)?.need ?? "optional";

  const cards: AiCard[] = [];
  for (const meta of CARDS) {
    const present = meta.rows.some((id) => has(id));
    const words = copy.card(meta.id);
    if (!present) {
      cards.push({ id: meta.id, title: words.title, summary: words.summary, chip: "Not on this computer", choices: [], notReady: false, unavailable: `${words.title} is not on this computer. It needs more memory.` });
      continue;
    }
    const specs: ChoiceSpec[] = [];
    switch (meta.id) {
      case "chat": {
        if (has("chat")) specs.push({ id: "chat.standard", job: "chat", kind: "fixed", row: rows.get("chat")!, current: true, recommended: true, setting: null });
        if (has("chat-mlx")) specs.push({ id: "chat.mlx", job: "chat", kind: "switch", row: rows.get("chat-mlx")!, current: rowIsInstalled(rows.get("chat-mlx")!, components), recommended: need("chat-mlx") === "recommended", setting: null });
        if (has("reads-pictures")) specs.push({ id: "chat.pictures", job: "chat", kind: "switch", row: rows.get("reads-pictures")!, current: rowIsInstalled(rows.get("reads-pictures")!, components), recommended: need("reads-pictures") === "recommended", setting: null });
        break;
      }
      case "pictures": {
        const quickRowId = has("pictures-ernie") ? "pictures-ernie" : has("pictures") ? "pictures" : null;
        const hasDetailed = has("pictures-zimage");
        const preferDetailed = settings.pictureQuality === "detailed" && hasDetailed;
        if (quickRowId) specs.push({ id: "pictures.quick", job: "pictures", kind: "radio", row: rows.get(quickRowId)!, current: !preferDetailed, recommended: true, setting: { key: "generation.picture_quality", value: "quick" } });
        if (hasDetailed) specs.push({ id: "pictures.detailed", job: "pictures", kind: "radio", row: rows.get("pictures-zimage")!, current: preferDetailed, recommended: quickRowId === null, setting: { key: "generation.picture_quality", value: "detailed" } });
        if (has("pictures") && quickRowId === "pictures-ernie") specs.push({ id: "pictures.edit", job: "pictures", kind: "fixed", row: rows.get("pictures")!, current: true, recommended: false, setting: null });
        if (has("image-tools")) specs.push({ id: "pictures.tools", job: "pictures", kind: "switch", row: rows.get("image-tools")!, current: rowIsInstalled(rows.get("image-tools")!, components), recommended: need("image-tools") === "recommended", setting: null });
        if (has("tool-look")) specs.push({ id: "pictures.look", job: "pictures", kind: "switch", row: rows.get("tool-look")!, current: rowIsInstalled(rows.get("tool-look")!, components), recommended: need("tool-look") === "recommended", setting: null });
        break;
      }
      case "videos": {
        const hasQuick = has("video");
        const hasDetailed = has("video-detailed");
        const preferDetailed = settings.videoQuality === "detailed" && hasDetailed;
        if (hasQuick) specs.push({ id: "videos.quick", job: "videos", kind: "radio", row: rows.get("video")!, current: !preferDetailed, recommended: true, setting: { key: "generation.video_quality", value: "quick" } });
        if (hasDetailed) specs.push({ id: "videos.detailed", job: "videos", kind: "radio", row: rows.get("video-detailed")!, current: preferDetailed, recommended: !hasQuick, setting: { key: "generation.video_quality", value: "detailed" } });
        break;
      }
      case "music": {
        if (has("music")) specs.push({ id: "music.make", job: "music", kind: "switch", row: rows.get("music")!, current: settings.musicEnabled && rowIsInstalled(rows.get("music")!, components), recommended: need("music") === "recommended", setting: { key: "generation.music.enabled", value: true } });
        break;
      }
      case "voice": {
        const betterInstalled = has("voice-better") && rowIsInstalled(rows.get("voice-better")!, components);
        if (has("voice")) specs.push({ id: "voice.standard", job: "voice", kind: "fixed", row: rows.get("voice")!, current: !betterInstalled, recommended: !has("voice-better") || need("voice-better") !== "recommended", setting: null });
        if (has("voice-better")) specs.push({ id: "voice.better", job: "voice", kind: "radio", row: rows.get("voice-better")!, current: betterInstalled, recommended: need("voice-better") === "recommended", setting: null });
        break;
      }
      case "coding": {
        if (has("coding")) specs.push({ id: "coding.helper", job: "coding", kind: "switch", row: rows.get("coding")!, current: rowIsInstalled(rows.get("coding")!, components), recommended: need("coding") === "recommended", setting: null });
        break;
      }
    }
    const choices = specs.map((spec) => buildChoice(copy, plan, components, freeBytes, spec));
    cards.push({
      id: meta.id,
      title: words.title,
      summary: words.summary,
      chip: chipFor(meta, present, choices),
      choices,
      notReady: choices.some((choice) => choice.chosenNotReady),
      unavailable: null,
    });
  }

  const alwaysOnIds = ["home", "judge", "stt", "voice", "embed", "search"];
  const base = alwaysOnIds.map((id) => rows.get(id)).filter((row): row is DiskRow => row !== undefined);
  const engineIds = new Set<string>();
  for (const row of base) for (const engine of row.engines) if (rows.has(engine)) engineIds.add(engine);
  const alwaysOnRows = [...base, ...[...engineIds].map((id) => rows.get(id)!).filter((row) => row !== undefined)];
  const alwaysOn: AiAlwaysOn = {
    bytes: alwaysOnRows.reduce((total, row) => total + row.installed_bytes, 0),
    rowIds: alwaysOnRows.map((row) => row.id),
  };
  return { cards, alwaysOn };
}

type DiskNeedLike = "required" | "recommended" | "optional";

function rowIsInstalled(row: DiskRow, components: AiComponentLike[] | null): boolean {
  return rowState(row, components).state === "installed";
}

export function recommendedPlan(input: AiChoicesInput): AiRecommendedPlan {
  const { components, freeBytes } = input;
  const plan = withLiveInstalled(input.plan, components);
  const rows = byRowId(plan);
  const { cards } = buildAiCards(input);

  // The radio cards whose current choice differs from the recommended one.
  const changes: AiRecommendedPlan["changes"] = [];
  for (const card of cards) {
    if (card.id !== "pictures" && card.id !== "videos" && card.id !== "voice") continue;
    const target = card.choices.find((choice) => choice.recommended);
    if (!target) continue;
    const current = card.choices.find((choice) => choice.kind === "radio" && choice.current) ?? (card.id === "voice" ? card.choices.find((choice) => choice.id === "voice.standard") : undefined);
    if (!current || current.id === target.id) continue;
    changes.push({ job: card.id, from: current.label, to: target.label, setting: target.setting });
  }

  // The rows the recommended plan ends with: every required row and every row
  // the recommended choices and recommended switches turn on. Optional rows are
  // left as they are, and nothing installed is removed.
  // Rows with no model of their own (Home itself, the search helper) are never a download here.
  const candidates = plan.rows.filter((row) => row.kind === "model" && row.model_ids.length > 0 && !row.installed && (row.need === "required" || row.need === "recommended"));
  const ordered = [...candidates].sort((a, b) => (a.need === b.need ? a.download_bytes - b.download_bytes : a.need === "required" ? -1 : 1));
  const accepted: DiskRow[] = [];
  const skipped: AiRecommendedPlan["skipped"] = [];
  if (freeBytes !== null) {
    for (const row of ordered) {
      const totals = selectionTotals(plan, [...accepted.map((r) => r.id), row.id], { missingOnly: true });
      if (totals.required_free_bytes <= freeBytes) accepted.push(row);
      else {
        // The reason a skipped row says is the space left after the choices
        // that did fit, since the row's own need is measured against that.
        const taken = selectionTotals(plan, accepted.map((r) => r.id), { missingOnly: true }).required_free_bytes;
        const left = Math.max(0, freeBytes - taken);
        for (const rest of ordered.slice(ordered.indexOf(row))) {
          if (rest.installed) continue;
          skipped.push({ rowId: rest.id, label: rest.label, reason: blockedReasonFor(plan, rest, { state: "notInstalled", percent: null, failure: null, unsupported: null }, left) ?? "It does not fit on this computer." });
        }
        break;
      }
    }
  } else {
    accepted.push(...ordered);
  }

  // The engine environments come with the parts that name them (selectionTotals counts them once), so only model rows are installed.
  const installRows = [...accepted].sort((a, b) => (a.need === b.need ? a.download_bytes - b.download_bytes : a.need === "required" ? -1 : 1));
  const installRowIds = installRows.map((row) => row.id);
  const installComponentIds = installRows.map((row) => {
    const match = components?.find((component) => component.id === row.id || row.model_ids.includes(component.id));
    if (match) return match.id;
    return row.model_ids[0] ?? row.id;
  });

  const totals = selectionTotals(plan, installRowIds, { missingOnly: true });
  const downloadBytes = totals.download_bytes;
  const kept = accepted.length;
  const total = ordered.length;
  const fits: AiRecommendedPlan["fits"] = skipped.length === 0 ? "all" : kept > 0 ? "some" : "none";
  const nothingToDo = changes.length === 0 && installRowIds.length === 0;

  let text: string;
  if (nothingToDo) text = "Everything recommended is already here.";
  else if (freeBytes === null) text = `Download ${needGb(downloadBytes)} GB. The free space could not be read.`;
  else if (fits === "all") text = `Everything recommended is ${needGb(downloadBytes)} GB to download.`;
  else if (fits === "some") {
    const words = skipped.map((item) => {
      const row = rows.get(item.rowId);
      const name = cards.flatMap((card) => card.choices).find((choice) => choice.rowIds.includes(item.rowId))?.label ?? item.label;
      return `The ${name} (${row ? stateSizeSafe(row.download_bytes) : "?"})`;
    });
    text = `This computer has room for ${kept} of the ${total} recommended choices. ${joinWords(words)} will be skipped.`;
  } else {
    text = `No room for the ${total} recommended choices. Free up space first.`;
  }

  return { changes, installRowIds, installComponentIds, skipped, downloadBytes, fits, nothingToDo, text };
}

// A size word for the skipped line, where MB figures are allowed.
function stateSizeSafe(bytes: number): string {
  return sizeGb(bytes);
}

function joinWords(words: string[]): string {
  if (words.length === 0) return "";
  if (words.length === 1) return words[0] ?? "";
  const last = words[words.length - 1] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${last}`;
}
