import { eq } from "drizzle-orm";
import { SetupState, type SetupState as SetupStateRecord } from "@maipai/spec/gen/ts/setup-state.js";
import { db } from "@/db";
import { setupState } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import { randomSuffix } from "@/lib/id";

export const SETUP_STEP_IDS = [
  "welcome", "engine_location", "storage", "checks", "plan", "away",
  "owner", "face", "profile", "hello", "backup_key", "done",
] as const;
export type SetupStepId = (typeof SETUP_STEP_IDS)[number];
export const PRE_OWNER_STEPS = new Set<SetupStepId>([
  "welcome", "engine_location", "storage", "checks", "plan", "away",
]);

const timestamp = () => new Date().toISOString();

/** The folders the owner picked on the storage screen (WIZ-STORAGE-03). It
 * lives in the same row as the setup record but beside it, because the
 * SetupState spec shape is strict and has no field for it. Nothing reads it
 * yet: DATA-LOCATION-01a writes the location record from it. */
export type StorageChoice = { models?: string; records?: string };
const STORAGE_CHOICE_KEY = "storage_choice";

/** The memory the owner typed on the plan screen when Home could not read
 * it (a graphics card it cannot size). Kept beside the record for the same
 * reason as the storage choice, so a retry, a re-check and Home settings
 * size the plan from the same answer. An Apple silicon Mac never needs it:
 * the Stack reads its unified memory itself. */
const MEMORY_ANSWER_KEY = "memory_answer_gb";

/** The disk plan's rows the person left turned on at the plan step (ids such as "pictures"), kept beside the record so a retry,
 * a re-check and the downloads that start after the checks install the same set. Absent until the plan step is used. */
const INSTALL_SELECTION_KEY = "install_selection";
const CODING_CHOICE_KEY = "coding_choice";
export type SetupCodingChoice = "set_up" | "later";
export function setupCodingChoice(): SetupCodingChoice | undefined {
  const row = db.select().from(setupState).limit(1).get();
  const choice = row ? (JSON.parse(row.value) as Record<string, unknown>)[CODING_CHOICE_KEY] : undefined;
  return choice === "set_up" || choice === "later" ? choice : undefined;
}
export function setSetupCodingChoice(choice: SetupCodingChoice): void {
  ensureSetupState();
  const row = db.select().from(setupState).limit(1).get();
  if (!row) return;
  const rest = JSON.parse(row.value) as Record<string, unknown>;
  db.update(setupState).set({ value: JSON.stringify({ ...rest, [CODING_CHOICE_KEY]: choice }) }).where(eq(setupState.slot, 1)).run();
}
export function codingClientLater(): boolean {
  return setupCodingChoice() === "later";
}
/** Compatibility alias for code written against the earlier setup helper name. */
function splitRow(value: string): { record: SetupStateRecord; storageChoice: StorageChoice | undefined; memoryAnswerGb: number | undefined; installSelection: string[] | undefined; codingChoice: SetupCodingChoice | undefined } {
  const { [STORAGE_CHOICE_KEY]: storageChoice, [MEMORY_ANSWER_KEY]: memoryAnswerGb, [INSTALL_SELECTION_KEY]: installSelection, [CODING_CHOICE_KEY]: rawCodingChoice, ...rest } = JSON.parse(value) as Record<string, unknown>;
  return {
    record: SetupState.parse(rest),
    installSelection: Array.isArray(installSelection) && installSelection.every((id) => typeof id === "string") ? installSelection as string[] : undefined,
    storageChoice: storageChoice as StorageChoice | undefined,
    memoryAnswerGb: typeof memoryAnswerGb === "number" && memoryAnswerGb > 0 ? memoryAnswerGb : undefined,
    codingChoice: rawCodingChoice === "set_up" || rawCodingChoice === "later" ? rawCodingChoice : undefined,
  };
}

export function getMemoryAnswerGb(): number | undefined {
  const row = db.select().from(setupState).limit(1).get();
  return row ? splitRow(row.value).memoryAnswerGb : undefined;
}

/** Saves the typed memory answer beside the record; `undefined` clears it. */
export function setMemoryAnswerGb(memoryGb: number | undefined): void {
  ensureSetupState();
  const row = db.select().from(setupState).limit(1).get();
  if (!row) return;
  const { [MEMORY_ANSWER_KEY]: _old, ...rest } = JSON.parse(row.value) as Record<string, unknown>;
  db.update(setupState).set({ value: JSON.stringify(memoryGb ? { ...rest, [MEMORY_ANSWER_KEY]: memoryGb } : rest) }).where(eq(setupState.slot, 1)).run();
}

export function getInstallSelection(): string[] | undefined {
  const row = db.select().from(setupState).limit(1).get();
  return row ? splitRow(row.value).installSelection : undefined;
}

/** Saves the rows chosen at the plan step beside the record; `undefined` clears it. */
export function setInstallSelection(ids: string[] | undefined): void {
  ensureSetupState();
  const row = db.select().from(setupState).limit(1).get();
  if (!row) return;
  const { [INSTALL_SELECTION_KEY]: _old, ...rest } = JSON.parse(row.value) as Record<string, unknown>;
  db.update(setupState).set({ value: JSON.stringify(ids ? { ...rest, [INSTALL_SELECTION_KEY]: ids } : rest) }).where(eq(setupState.slot, 1)).run();
}

/** The memory to size a plan from: the number asked for now, else the saved answer. */
export function resolveMemoryGb(requested?: number): number | undefined {
  return requested ?? getMemoryAnswerGb();
}

export function getStorageChoice(): StorageChoice | undefined {
  const row = db.select().from(setupState).limit(1).get();
  return row ? splitRow(row.value).storageChoice : undefined;
}

export function createSetupState(source: "wizard" | "restore" = "wizard"): SetupStateRecord {
  const now = timestamp();
  return SetupState.parse({
    id: `setup-${randomSuffix(10)}`,
    source,
    steps: SETUP_STEP_IDS.map((id) => ({ id, status: "pending", at: now })),
    phase: "computers",
    engine: { where: "this_computer", hardware: {} },
    away: "later",
    plan: { option: "recommended", tier: "minimal", roles: [] },
    checks: [],
    started_at: now,
    completed_at: null,
    hlc: nextHlc(),
  });
}

export function getSetupState(): SetupStateRecord {
  const row = db.select().from(setupState).limit(1).get();
  if (!row) return ensureSetupState();
  // A corrupt row fails closed and is surfaced as a typed server error;
  // never log setup payloads or step error contents.
  return splitRow(row.value).record;
}

export function ensureSetupState(source: "wizard" | "restore" = "wizard"): SetupStateRecord {
  const existing = db.select().from(setupState).limit(1).get();
  if (existing) return splitRow(existing.value).record;
  const created = createSetupState(source);
  db.insert(setupState).values({ slot: 1, value: JSON.stringify(created) }).onConflictDoNothing().run();
  const row = db.select().from(setupState).limit(1).get();
  if (!row) throw new Error("Setup state initialization failed.");
  return splitRow(row.value).record;
}

export function replaceSetupStep(
  stepId: SetupStepId,
  result: {
    status: SetupStateRecord["steps"][number]["status"];
    error?: SetupStateRecord["steps"][number]["error"];
    engine?: SetupStateRecord["engine"];
    away?: SetupStateRecord["away"];
    plan?: SetupStateRecord["plan"];
    checks?: SetupStateRecord["checks"];
    phase?: SetupStateRecord["phase"];
    completed_at?: string | null;
    /** Only the storage step sets this; any other call keeps what is saved. */
    storageChoice?: StorageChoice;
  },
): SetupStateRecord {
  const current = getSetupState();
  const storageChoice = result.storageChoice ?? getStorageChoice();
  const memoryAnswerGb = getMemoryAnswerGb();
  const installSelection = getInstallSelection();
  const codingChoice = setupCodingChoice();
  const at = timestamp();
  const steps = current.steps.map((step) => {
    if (step.id !== stepId) return step;
    return { id: stepId, status: result.status, at, ...(result.error ? { error: result.error } : {}) };
  });
  const done = stepId === "done" && result.status === "done";
  const next = SetupState.parse({
    ...current,
    steps,
    ...(result.engine ? { engine: result.engine } : {}),
    ...(result.away ? { away: result.away } : {}),
    ...(result.plan ? { plan: result.plan } : {}),
    ...(result.checks ? { checks: result.checks } : {}),
    phase: result.phase ?? (done ? "done" : current.phase),
    completed_at: result.completed_at ?? (done ? at : current.completed_at),
    hlc: nextHlc(),
  });
  db.update(setupState).set({ value: JSON.stringify({ ...next, ...(storageChoice ? { [STORAGE_CHOICE_KEY]: storageChoice } : {}), ...(memoryAnswerGb ? { [MEMORY_ANSWER_KEY]: memoryAnswerGb } : {}), ...(installSelection ? { [INSTALL_SELECTION_KEY]: installSelection } : {}), ...(codingChoice ? { [CODING_CHOICE_KEY]: codingChoice } : {}) }) }).where(eq(setupState.slot, 1)).run();
  // The wizard just finished installing: have the models loaded before the first message.
  if (done) void import("@/lib/stackWarmup").then((module) => module.warmStack()).catch(() => {});
  return next;
}
