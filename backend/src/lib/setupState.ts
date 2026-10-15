import { eq } from "drizzle-orm";
import { SetupState, type SetupState as SetupStateRecord } from "@maipai/spec/gen/ts/setup-state.js";
import { db } from "@/db";
import { setupState } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import { randomSuffix } from "@/lib/id";

export const SETUP_STEP_IDS = [
  "welcome", "engine_location", "storage", "checks", "plan", "away",
  "owner", "face", "profile", "hello", "done",
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

function splitRow(value: string): { record: SetupStateRecord; storageChoice: StorageChoice | undefined } {
  const { [STORAGE_CHOICE_KEY]: storageChoice, ...rest } = JSON.parse(value) as Record<string, unknown>;
  return { record: SetupState.parse(rest), storageChoice: storageChoice as StorageChoice | undefined };
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
  db.update(setupState).set({ value: JSON.stringify(storageChoice ? { ...next, [STORAGE_CHOICE_KEY]: storageChoice } : next) }).where(eq(setupState.slot, 1)).run();
  return next;
}
