// CODE-STACK-01 H1: the pieces local coding needs (the engine, the coding model, the model's Splash draft), shown to an
// admin with their state and disk size, installed and removed one at a time. Home owns none of it: the Stack's engine
// install route, its component routes and its role record are the sources, and a Stack sentence is passed on as it is.
// Progress rides the existing install strip (installStatus.ts reads the Stack's job list), a failed engine install is a
// Repairs item (raiseIssue), and the Stack's own health items (coding.engine-fallback) already reach Repairs through
// stackHealthSync. Nothing here is a new status surface.
//
// The first-run path needs nothing from this file: the Stack's install plan lists the coding model (and, where Splash can
// run, its draft, which names the splash engine), and setup/checks/setupDownloads.ts installs each named engine before
// the pulls. `missingCodingPiece()` is the one fact the key store reads to hold coding keys suspended.
import type { StackJob } from "@maipai/spec/stack/ts/stack-job.js";
import { chatLeaseHeld } from "@/lib/chatLease";
import { getHouseholdSettingValue } from "@/lib/settings";
import { getStackClient, isStackConfigured } from "@/lib/stackEngine";
import { StackError } from "@/lib/stack/errors";
import { classifyStackError } from "@/lib/stack/httpErrors";
import type { EngineInfo, RoleInfo } from "@/lib/stack/types";
import { installStackComponent, listStackComponents, StackComponentError, uninstallStackComponent, type StackComponent } from "@/lib/stackComponents";
import { raiseIssue, registerFixHandler, resolveIssue } from "@/lib/issues";
import { resetInstallStatusCache } from "@/lib/installStatus";

export type CodingPieceId = "engine" | "model" | "draft" | "heavy_model" | "heavy_draft";
export interface CodingPiece {
  id: CodingPieceId;
  /** What the Stack runs or stores: `splash`, `llama-server` or the model id. */
  name: string;
  label: string;
  summary: string;
  state: "installed" | "installing" | "notInstalled" | "failed" | "unsupported";
  /** Bytes on disk when installed, the pinned download size otherwise; null when the Stack states none. */
  size_bytes: number | null;
  percent: number | null;
  failure: string | null;
  can_install: boolean;
  install_block: string | null;
  can_remove: boolean;
  remove_block: string | null;
}
export interface CodingPieces {
  stack: "ok" | "unreachable";
  message: string | null;
  coding_enabled: boolean;
  /** The engine the Stack chose for coding on this computer; null while the Stack cannot be read. */
  engine: "splash" | "llama-server" | null;
  /** A sentence naming the first piece coding cannot run without, or null when coding has what it needs. */
  missing: string | null;
  pieces: CodingPiece[];
}

export class CodingPieceError extends Error {
  constructor(readonly status: 400 | 404 | 409 | 503, readonly code: string, message: string) { super(message); this.name = "CodingPieceError"; }
}

export const CODING_ON_REFUSAL = "Coding is on, so this piece cannot be removed yet. Turn Coding off in Settings, then remove it.";
const NOT_REACHABLE = "The engine isn't answering. Check that the engine is running, then try again.";

/** The calls this module makes to the Stack. The default goes through Home's Stack client and the components module; a test supplies a fake. */
export interface CodingStack {
  roles(): Promise<RoleInfo[]>;
  engines(): Promise<EngineInfo[]>;
  models(): Promise<Array<{ id: string; state?: string; sizeBytes?: number | null }>>;
  catalog(): Promise<Array<{ id: string; role: string; component?: string; download?: { approx_bytes?: number } }>>;
  jobs(): Promise<StackJob[]>;
  components(): Promise<StackComponent[]>;
  tier?(): Promise<string | null>;
  installEngine(name: string): Promise<{ job: string | null }>;
  removeEngineBuild(name: string, tag: string): Promise<void>;
  installComponent(id: string): Promise<{ job: string | null }>;
  uninstallComponent(id: string): Promise<void>;
}

function asPieceError(error: unknown): never {
  if (error instanceof CodingPieceError) throw error;
  if (error instanceof StackComponentError) throw new CodingPieceError(error.status === 404 ? 404 : error.status === 409 ? 409 : 503, error.code, error.message);
  if (error instanceof StackError) { const failure = classifyStackError(error); throw new CodingPieceError(failure.status === 400 ? 400 : failure.status === 409 ? 409 : 503, "stack", failure.body.error); }
  throw error;
}

const realStack: CodingStack = {
  roles: async () => (await getStackClient().roles()).roles,
  engines: async () => (await getStackClient().engines()).engines,
  models: async () => { const body = await getStackClient().models(); return Array.isArray(body.models) ? body.models as never : []; },
  catalog: async () => { const body = await getStackClient().modelCatalog(); return Array.isArray(body.models) ? body.models as never : []; },
  jobs: () => getStackClient().jobs(),
  components: async () => (await listStackComponents()).components,
  tier: async () => (await listStackComponents()).tier,
  installEngine: async (name) => { const res = await getStackClient().engineAction(name, "install"); return { job: typeof res.job === "string" ? res.job : null }; },
  removeEngineBuild: async (name, tag) => {
    const client = getStackClient();
    if (!client.removeEngineBuild) throw new CodingPieceError(503, "stack_old", "This engine is too old to remove an engine build. Update the engine, then try again.");
    await client.removeEngineBuild(name, tag);
  },
  installComponent: async (id) => ({ job: (await installStackComponent(id)).job }),
  uninstallComponent: async (id) => { await uninstallStackComponent(id); },
};
let stack: CodingStack = realStack;
export function __setCodingStackForTests(fake: CodingStack | null): void { stack = fake ?? realStack; knownMissing = null; }

const SPLASH = "splash";
const LLAMA = "llama-server";

function codingEnabled(): boolean { return getHouseholdSettingValue("coding.enabled") === true; }

function activeJob(jobs: StackJob[], kind: string, matches: (job: StackJob) => boolean): StackJob | undefined {
  return jobs.filter((job) => job.kind === kind && matches(job)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

/** Everything the coding pieces say, read live from the Stack. Throws what the Stack throws. */
async function readPieces(): Promise<{ engine: "splash" | "llama-server"; pieces: CodingPiece[] }> {
  const [roles, engines, models, catalog, jobs, components, tier] = await Promise.all([stack.roles(), stack.engines(), stack.models(), stack.catalog(), stack.jobs().catch(() => [] as StackJob[]), stack.components(), stack.tier?.().catch(() => null) ?? Promise.resolve(null)]);
  const coding = roles.find((role) => role.id === "coding")?.coding;
  const splash = engines.find((engine) => engine.name === SPLASH && engine.matchesThisMachine);
  const llama = engines.find((engine) => engine.name === LLAMA && engine.matchesThisMachine) ?? engines.find((engine) => engine.name === LLAMA);
  const wantsSplash = coding?.engine === SPLASH || splash?.installed === true || (Boolean(splash) && Boolean(coding?.engine_reason) && coding?.engine_requested !== LLAMA);
  const on = codingEnabled();
  const pieces: CodingPiece[] = [];

  // The engine: Splash where the Stack can use it, the shared llama-server otherwise.
  const engineJob = activeJob(jobs, "engine.install", (job) => typeof job.input?.engine === "string" && job.input.engine.startsWith(SPLASH));
  const engineRunning = engineJob !== undefined && ["queued", "running", "stalled", "paused"].includes(engineJob.state);
  if (wantsSplash && splash) {
    const installed = splash.installed;
    pieces.push({
      id: "engine", name: SPLASH, label: "Coding engine: Splash", summary: "The faster engine for coding on this Mac. Without it coding runs on the slower engine chat uses.",
      state: installed ? "installed" : engineRunning ? "installing" : engineJob?.state === "failed" ? "failed" : "notInstalled",
      size_bytes: engineJob?.totalBytes || null, percent: engineRunning ? engineJob!.percent : null, failure: !installed && engineJob?.state === "failed" ? engineJob.reason : null,
      can_install: !installed && !engineRunning, install_block: installed ? "It is already installed." : engineRunning ? "It is downloading now." : null,
      can_remove: installed && !on && Boolean(splash.currentTag), remove_block: !installed ? "It is not installed." : on ? CODING_ON_REFUSAL : null,
    });
  } else {
    const reason = coding?.engine_reason ?? null;
    pieces.push({
      id: "engine", name: LLAMA, label: "Coding engine: llama-server", summary: reason ?? "The engine chat already uses. This computer runs coding on it.",
      state: llama?.installed ? "installed" : "notInstalled", size_bytes: null, percent: null, failure: null,
      can_install: false, install_block: llama?.installed ? "It is already installed." : "Chat installs this engine with the rest of Home's AI. Finish the AI setup first.",
      can_remove: false, remove_block: "Chat uses this engine as well, so it stays.",
    });
  }

  // The model, with the draft that installs and goes with it.
  const modelPin = catalog.find((pin) => pin.role === "coding" && !pin.component && pin.id !== "ornith-1-5-122b-mlx-4bit");
  const draftPin = catalog.find((pin) => pin.role === "coding" && pin.component === "draft" && pin.id !== "ornith-1-5-122b-dflash2-draft");
  const component = modelPin ? components.find((row) => row.id === modelPin.id) : undefined;
  const record = (id: string | undefined) => (id ? models.find((model) => model.id === id) : undefined);
  const modelRecord = record(modelPin?.id);
  if (!modelPin || !component) {
    pieces.push({
      id: "model", name: modelPin?.id ?? "coding-model", label: "Coding model", summary: "The model that writes code for the coding tools people connect.",
      state: "unsupported", size_bytes: null, percent: null, failure: null,
      can_install: false, install_block: "This computer does not have enough memory to run a coding model.", can_remove: false, remove_block: "It is not installed.",
    });
  } else {
    const installed = component.state === "installed";
    pieces.push({
      id: "model", name: modelPin.id, label: component.label, summary: component.summary,
      state: component.requirement === "unsupported" && !installed ? "unsupported" : component.state,
      size_bytes: modelRecord?.sizeBytes ?? modelPin.download?.approx_bytes ?? component.size_bytes ?? component.download_bytes ?? null,
      percent: component.state === "installing" ? component.percent : null, failure: component.state === "failed" ? component.failure : null,
      can_install: component.can_install, install_block: component.install_block,
      can_remove: component.can_uninstall && !on, remove_block: on && component.can_uninstall ? CODING_ON_REFUSAL : component.uninstall_block,
    });
  }
  if (draftPin) {
    const draftRecord = record(draftPin.id);
    const installed = draftRecord?.state === "installed";
    const modelRow = pieces.find((piece) => piece.id === "model")!;
    pieces.push({
      id: "draft", name: draftPin.id, label: "Coding draft for Splash", summary: "A small helper model that lets Splash write faster. It installs and is removed with the coding model.",
      state: !wantsSplash || !splash ? "unsupported" : installed ? "installed" : modelRow.state === "installing" ? "installing" : modelRow.state === "unsupported" ? "unsupported" : "notInstalled",
      size_bytes: draftRecord?.sizeBytes ?? draftPin.download?.approx_bytes ?? null, percent: modelRow.state === "installing" ? modelRow.percent : null, failure: null,
      can_install: false, install_block: !wantsSplash || !splash ? "This computer uses llama-server, which does not use a coding draft." : "It installs with the coding model.", can_remove: false, remove_block: "It is removed with the coding model.",
    });
  }
  const heavyAvailable = tier === "p128";
  if (heavyAvailable) {
    const heavyModelPin = catalog.find((pin) => pin.id === "ornith-1-5-122b-mlx-4bit");
    const heavyDraftPin = catalog.find((pin) => pin.id === "ornith-1-5-122b-dflash2-draft");
    const heavyDraftComponent = heavyDraftPin && components.find((row) => row.id === heavyDraftPin.id);
    const heavyComponent = heavyModelPin && components.find((row) => row.id === heavyModelPin.id);
    const heavyRecord = record(heavyModelPin?.id);
    if (!heavyModelPin || !heavyComponent) {
      pieces.push({ id: "heavy_model", name: "ornith-1-5-122b-mlx-4bit", label: "Heavy coding model", summary: "The larger model for coding on a 128 GB Home.", state: "unsupported", size_bytes: heavyModelPin?.download?.approx_bytes ?? null, percent: null, failure: null, can_install: false, install_block: "The Stack does not offer this coding model on this computer.", can_remove: false, remove_block: "It is not installed." });
    } else {
      const installed = heavyComponent.state === "installed";
      pieces.push({ id: "heavy_model", name: heavyModelPin.id, label: heavyComponent.label, summary: heavyComponent.summary,
        state: heavyComponent.requirement === "unsupported" && !installed ? "unsupported" : heavyComponent.state,
        size_bytes: heavyRecord?.sizeBytes ?? heavyModelPin.download?.approx_bytes ?? heavyComponent.size_bytes ?? heavyComponent.download_bytes ?? null,
        percent: heavyComponent.state === "installing" ? heavyComponent.percent : null, failure: heavyComponent.state === "failed" ? heavyComponent.failure : null,
        can_install: heavyComponent.can_install, install_block: heavyComponent.install_block,
        can_remove: heavyComponent.can_uninstall && !on, remove_block: on && heavyComponent.can_uninstall ? CODING_ON_REFUSAL : heavyComponent.uninstall_block });
    }
    if (heavyDraftPin && !heavyDraftComponent) {
      // The Stack installs this draft with the large model, so it has no component row of its own: read its model record.
      const draftRecord = record(heavyDraftPin.id);
      const modelRow = pieces.find((piece) => piece.id === "heavy_model")!;
      pieces.push({ id: "heavy_draft", name: heavyDraftPin.id, label: "Heavy coding draft", summary: "A small helper model that lets the larger coding model write faster. It installs and is removed with the heavy coding model.",
        state: draftRecord?.state === "installed" ? "installed" : modelRow.state === "installing" ? "installing" : modelRow.state === "unsupported" ? "unsupported" : "notInstalled",
        size_bytes: draftRecord?.sizeBytes ?? heavyDraftPin.download?.approx_bytes ?? null, percent: modelRow.state === "installing" ? modelRow.percent : null, failure: null,
        can_install: false, install_block: "It installs with the heavy coding model.", can_remove: false, remove_block: "It is removed with the heavy coding model." });
    } else if (heavyDraftPin && heavyDraftComponent) {
      const heavyDraftRecord = record(heavyDraftPin.id);
      pieces.push({ id: "heavy_draft", name: heavyDraftPin.id, label: "Heavy coding draft", summary: "A small helper model that lets the larger coding model write faster.",
        state: heavyDraftComponent.requirement === "unsupported" && heavyDraftComponent.state !== "installed" ? "unsupported" : heavyDraftComponent.state,
        size_bytes: heavyDraftRecord?.sizeBytes ?? heavyDraftPin.download?.approx_bytes ?? heavyDraftComponent.size_bytes ?? heavyDraftComponent.download_bytes ?? null,
        percent: heavyDraftComponent.state === "installing" ? heavyDraftComponent.percent : null, failure: heavyDraftComponent.state === "failed" ? heavyDraftComponent.failure : null,
        can_install: heavyDraftComponent.can_install, install_block: heavyDraftComponent.install_block,
        can_remove: heavyDraftComponent.can_uninstall && !on, remove_block: on && heavyDraftComponent.can_uninstall ? CODING_ON_REFUSAL : heavyDraftComponent.uninstall_block });
    } else {
      pieces.push({ id: "heavy_draft", name: "ornith-1-5-122b-dflash2-draft", label: "Heavy coding draft", summary: "A small helper model that lets the larger coding model write faster.", state: "unsupported", size_bytes: heavyDraftPin?.download?.approx_bytes ?? null, percent: null, failure: null, can_install: false, install_block: "The Stack does not offer this coding draft on this computer.", can_remove: false, remove_block: "It is not installed." });
    }
  }
  return { engine: wantsSplash && splash ? SPLASH : LLAMA, pieces };
}

/** The first piece coding cannot run without: the engine it would start, then the model. The draft is optional (the Stack falls back to llama-server without it). */
export function missingFrom(pieces: readonly CodingPiece[]): string | null {
  const engine = pieces.find((piece) => piece.id === "engine");
  const model = pieces.find((piece) => piece.id === "model");
  // In coding mode the large model is the only coding model; the small one need not be there.
  if (chatLeaseHeld() && pieces.find((piece) => piece.id === "heavy_model")?.state === "installed" && engine?.state === "installed") return null;
  if (model && model.state !== "installed" && model.state !== "installing") return "The coding model is not installed. An admin can install it in Settings, Coding.";
  if (model && model.state === "installing") return "The coding model is still downloading.";
  if (engine && engine.name === LLAMA && engine.state !== "installed") return "The coding engine is not installed. An admin can finish the AI setup in Settings.";
  return null;
}

// Sync memory of the last read, for the key store (mayHoldKey is synchronous). Unknown reads as nothing missing: a Stack that
// is briefly away never suspends every key.
let knownMissing: { at: number; value: string | null } | null = null;
export function missingCodingPiece(): string | null { return knownMissing?.value ?? null; }
export function __setMissingCodingPieceForTests(value: string | null): void { knownMissing = { at: Date.now(), value }; }
function remember(pieces: readonly CodingPiece[]): void { knownMissing = { at: Date.now(), value: missingFrom(pieces) }; }

const FIX_ACTION = "coding_engine_install";
async function syncEngineIssue(piece: CodingPiece | undefined): Promise<void> {
  if (!piece || piece.name !== SPLASH) return;
  try {
    if (piece.state === "failed") {
      registerFixHandler(FIX_ACTION, async () => { await installCodingPiece("engine"); });
      await raiseIssue({ source: "coding", key: "engine_install", severity: "warning", title: "The coding engine did not install", detail: `${piece.failure ?? "The download did not finish."} Coding runs on the slower engine until Splash installs. Press Try again; the part already downloaded is kept.`, fix: { label: "Try again", action: FIX_ACTION } });
    } else if (piece.state === "installed") resolveIssue("coding", "engine_install");
  } catch { /* Repairs is a courtesy here; the list still answers. */ }
}

export async function listCodingPieces(): Promise<CodingPieces> {
  const enabled = codingEnabled();
  if (!isStackConfigured() && stack === realStack) return { stack: "unreachable", message: "The engine isn't set up on this computer yet. Ask an admin to check Settings, Engine.", coding_enabled: enabled, engine: null, missing: null, pieces: [] };
  try {
    const { engine, pieces } = await readPieces();
    remember(pieces);
    await syncEngineIssue(pieces.find((piece) => piece.id === "engine"));
    return { stack: "ok", message: null, coding_enabled: enabled, engine, missing: missingFrom(pieces), pieces };
  } catch (error) {
    if (error instanceof StackComponentError || error instanceof StackError) return { stack: "unreachable", message: error instanceof StackComponentError ? error.message : NOT_REACHABLE, coding_enabled: enabled, engine: null, missing: null, pieces: [] };
    throw error;
  }
}

/** Refreshes the sync memory when Coding is on and the last read is older than `maxAgeMs`. Never throws; a Stack that does not answer leaves the last reading. */
export async function ensureCodingPiecesFresh(maxAgeMs = 30_000): Promise<void> {
  if (!codingEnabled()) return;
  if (knownMissing && Date.now() - knownMissing.at < maxAgeMs) return;
  try { const { pieces } = await readPieces(); remember(pieces); } catch { /* keep the last reading */ }
}

async function pieceNamed(id: string): Promise<CodingPiece> {
  let read;
  try { read = await readPieces(); } catch (error) { return asPieceError(error); }
  remember(read.pieces);
  const piece = read.pieces.find((candidate) => candidate.id === id);
  if (!piece) throw new CodingPieceError(404, "no_such_piece", "There is no such coding piece on this computer. Open Settings, Coding to see the pieces it has.");
  return piece;
}

export async function installCodingPiece(id: string): Promise<{ job: string | null; piece: CodingPieceId }> {
  const piece = await pieceNamed(id);
  if (!piece.can_install) throw new CodingPieceError(409, "cannot_install", piece.install_block ?? "This piece cannot be installed right now.");
  try {
    const started = piece.id === "engine" ? await stack.installEngine(piece.name) : await stack.installComponent(piece.name);
    resetInstallStatusCache();
    knownMissing = null;
    return { job: started.job, piece: piece.id };
  } catch (error) { return asPieceError(error); }
}

export async function removeCodingPiece(id: string): Promise<{ piece: CodingPieceId; removed: true }> {
  if (codingEnabled() && ["engine", "model", "draft", "heavy_model", "heavy_draft"].includes(id)) throw new CodingPieceError(409, "coding_on", CODING_ON_REFUSAL);
  const piece = await pieceNamed(id);
  if (!piece.can_remove) throw new CodingPieceError(409, "cannot_remove", piece.remove_block ?? "This piece cannot be removed right now.");
  try {
    if (piece.id === "engine") {
      const tag = (await stack.engines()).find((engine) => engine.name === piece.name && engine.matchesThisMachine)?.currentTag;
      if (!tag) throw new CodingPieceError(409, "cannot_remove", "That engine has no installed build to remove.");
      await stack.removeEngineBuild(piece.name, tag);
    } else await stack.uninstallComponent(piece.name);
    resetInstallStatusCache();
    knownMissing = null;
    return { piece: piece.id, removed: true };
  } catch (error) { return asPieceError(error); }
}
