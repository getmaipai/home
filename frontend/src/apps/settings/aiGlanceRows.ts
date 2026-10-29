// AIMODELS-GLANCE-2026-10-26: the pure side of the "AI and models, at a glance" page. The seven rows, the staged changes (client
// state until Apply) and the Memory and Storage projections are derived here from /api/ai/choices, so the page only draws them.
import type { AiCard, AiChoice, AiJobId } from "../../../../shared/aiChoices";

export const JOB_ORDER: AiJobId[] = ["chat", "pictures", "picturesdetailed", "videos", "music", "voice", "wakeword", "vision", "coding"];
/** The icon name of each job, shared by Settings and the setup wizard. */
export const JOB_ICONS: Record<AiJobId, string> = { chat: "message-circle", pictures: "palette", picturesdetailed: "sparkles", videos: "film", music: "music", voice: "mic-vocal", wakeword: "ear", vision: "eye", coding: "code" };
/** The engine role whose `engines.<role>.choice` key is the job's On/Off switch (`off` or `auto`). */
export const ENGINE_ROLE: Record<AiJobId, string> = { chat: "chat", pictures: "image", picturesdetailed: "image", videos: "video", music: "music", voice: "tts", wakeword: "wakeword", vision: "vision", coding: "coding" };
export const OFF = "__off";

/** One staged change for a job: the model picked in the dialog and/or the switch flipped. Nothing is written until Apply. */
export interface Staged { choiceId?: string; enabled?: boolean }
export type StagedMap = Partial<Record<AiJobId, Staged>>;
export type Badge = "custom" | "recommended" | "disabled";

export interface GlanceRow {
  job: AiJobId; title: string; summary: string;
  /** False when this computer has no model for the job. */
  offered: boolean;
  options: AiChoice[];
  live: AiChoice | null; liveEnabled: boolean;
  shown: AiChoice | null; shownEnabled: boolean;
  recommended: AiChoice | null;
  badge: Badge; staged: boolean;
  /** Chosen and on, but not on this computer yet. */
  missing: boolean;
}

const HIDDEN = new Set(["pictures.edit"]);

/** The models a person picks between for a job: the radio and fixed choices (plus the Apple-chip chat engine), or the job's own switch. */
export function optionsOf(card: AiCard): AiChoice[] {
  const picks = card.choices.filter((choice) => (choice.kind === "radio" || choice.kind === "fixed" || choice.id === "chat.mlx") && !HIDDEN.has(choice.id));
  return picks.length > 0 ? picks : card.choices.filter((choice) => choice.kind === "switch" && !HIDDEN.has(choice.id)).slice(0, 1);
}

const isSwitchOnly = (options: AiChoice[]) => options.length === 1 && options[0]!.kind === "switch";

export function buildRows(cards: AiCard[], offJobs: ReadonlySet<AiJobId>, staged: StagedMap): GlanceRow[] {
  return JOB_ORDER.flatMap((job) => {
    const card = cards.find((candidate) => candidate.id === job);
    if (!card) return [];
    const options = optionsOf(card);
    const offered = options.length > 0;
    const switchOnly = isSwitchOnly(options);
    const live = options.filter((option) => option.current).at(-1) ?? (switchOnly ? options[0]! : null);
    const liveEnabled = offered && (switchOnly ? options[0]!.current : !offJobs.has(job));
    const change = staged[job];
    const picked = change?.choiceId ? options.find((option) => option.id === change.choiceId) ?? null : null;
    const shown = picked ?? live;
    const shownEnabled = offered && (change?.enabled ?? (picked ? true : liveEnabled));
    const recommended = options.find((option) => option.recommended) ?? null;
    const badge: Badge = !shownEnabled ? "disabled" : shown && (shown.recommended || options.length === 1) ? "recommended" : "custom";
    return [{
      job, title: card.title, summary: card.summary, offered, options, live, liveEnabled, shown, shownEnabled, recommended, badge,
      staged: change !== undefined,
      missing: liveEnabled && !switchOnly && live !== null && live.state !== "installed" && live.state !== "installing",
    }];
  });
}

/** The staged entry that makes `row` read `pick` (an option id, or OFF), or null when that is what it already is. */
export function stageFor(row: GlanceRow, pick: string): Staged | null {
  if (pick === OFF) return row.liveEnabled ? { enabled: false } : null;
  if (row.live?.id === pick && row.liveEnabled) return null;
  return { choiceId: pick, enabled: true };
}

export function counts(rows: GlanceRow[]): { custom: number; recommended: number; disabled: number } {
  const total = { custom: 0, recommended: 0, disabled: 0 };
  for (const row of rows) total[row.badge] += 1;
  return total;
}

export interface Projection {
  /** The most memory Home's models can hold at once, now and after the staged changes: the always-loaded ones plus what loads when used. */
  ramNow: number; ramAfter: number;
  /** Of that, what stays loaded all the time (chat, voice, the wake word). */
  alwaysNow: number; alwaysAfter: number;
  /** Bytes the staged choices still have to download. */
  downloadBytes: number;
}

// The engine's memory classes (docs/design/memory-management-2026-10-25.md section 3): chat and voice stay loaded; pictures, the
// coding model and vision load on first use and give way when something else needs the room; video and music run one at a time.
// Adding every model's memory together shows a computer that can never hold them, which is not how the engine runs them.
const ALWAYS_LOADED = new Set<AiJobId>(["chat", "voice", "wakeword"]);
const ONE_AT_A_TIME = new Set<AiJobId>(["videos", "music"]);

function memoryOf(rows: GlanceRow[], pick: (row: GlanceRow) => AiChoice | null): { always: number; peak: number } {
  let always = 0; let loadsWhenUsed = 0; let largestTurn = 0; let picturePool = 0;
  for (const row of rows) {
    const choice = pick(row);
    if (!choice) continue;
    if (ALWAYS_LOADED.has(row.job)) always += choice.ramBytes;
    else if (ONE_AT_A_TIME.has(row.job)) largestTurn = Math.max(largestTurn, choice.ramBytes);
    // Quick and detailed pictures are the same pool: one create model is resident at a time.
    else if (row.job === "pictures" || row.job === "picturesdetailed") picturePool = Math.max(picturePool, choice.ramBytes);
    else loadsWhenUsed += choice.ramBytes;
  }
  return { always, peak: always + Math.max(loadsWhenUsed + picturePool, largestTurn) };
}

export function project(rows: GlanceRow[]): Projection {
  let downloadBytes = 0;
  for (const row of rows) if (row.shownEnabled && row.shown && row.staged && row.shown.state !== "installed") downloadBytes += row.shown.downloadBytes;
  const now = memoryOf(rows, (row) => (row.liveEnabled ? row.live : null));
  const after = memoryOf(rows, (row) => (row.shownEnabled ? row.shown : null));
  return { ramNow: now.peak, ramAfter: after.peak, alwaysNow: now.always, alwaysAfter: after.always, downloadBytes };
}

/** The choices Download missing (and Apply) must fetch: chosen and on, not on the computer. */
export function missingRows(rows: GlanceRow[]): GlanceRow[] {
  return rows.filter((row) => row.missing);
}

/** Replace {name} tokens in spec copy. */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => (key in vars ? String(vars[key]) : whole));
}
