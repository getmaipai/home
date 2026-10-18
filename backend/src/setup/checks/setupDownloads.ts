import { getStackClient } from "@/lib/stackEngine";
import { installStackComponent } from "@/lib/stackComponents";
import { getInstallSelection, getSetupState, resolveMemoryGb } from "@/lib/setupState";
import type { StackInstallPlan } from "@/lib/stack/client";

type DownloadPin = { id: string; role: string; repo?: string; license?: string; licence?: string; revision: string; engine?: string; component?: string; download?: { url: string; sha256: string; approx_bytes?: number; archive?: boolean; hub_file?: string } };
export interface SetupDownloadClient {
  modelCatalog(): Promise<Record<string, unknown>>;
  /** The Stack's own plan for this computer; absent on a Stack too old to have one. */
  installPlan?(query?: { vramGb?: number }): Promise<StackInstallPlan>;
  /** Installs a pinned engine build (POST /stack/v1/engines/{name}/install). */
  engineAction?(name: string, action: "install"): Promise<Record<string, unknown>>;
  pullModel(body: { id: string; role: string; repo?: string; url: string; sha256: string; approx_bytes?: number; licence: string; revision: string; engine?: string; archive?: boolean; hub_file?: string; component?: string }): Promise<Record<string, unknown>>;
}

const MAX_PARALLEL = 4;
export const PLAN_ROLES: Record<string, readonly string[]> = {
  minimal: ["chat", "judge", "stt", "tts", "embed", "wakeword"],
  moderate: ["chat", "judge", "stt", "tts", "embed", "rerank", "wakeword"],
  recommended: ["chat", "judge", "stt", "tts", "embed", "rerank", "image", "wakeword"],
};
const STARTER_ROLE = "chat";

function planRoles(): string[] {
  const state = getSetupState();
  return state.plan.roles.length ? state.plan.roles.map((key) => key.slice("engines.".length, -".choice".length)) : [...(PLAN_ROLES[state.plan.tier] ?? PLAN_ROLES.minimal!)];
}

type PullBody = Parameters<SetupDownloadClient["pullModel"]>[0];

/** The pull bodies of the plan's rows the person kept on (the disk plan's row ids): the first-run models of those rows and the
 * picture and video files of those rows. A model no row names is kept, so a Stack newer than this Home never loses a file. */
export function selectedPulls(plan: StackInstallPlan, selected?: readonly string[]): StackInstallPlan["models"] {
  const rows = plan.disk?.rows ?? [];
  const chosen = new Set(selected ?? []);
  const keep = (id: string) => {
    if (!selected || rows.length === 0) return true;
    const row = rows.find((candidate) => candidate.model_ids.includes(id));
    return !row || chosen.has(row.id);
  };
  const first = plan.models.filter((model) => !model.installed && keep(model.id));
  // The picture and video rows only when the person turned them on (they are not part of the first-run set).
  const extra = selected ? (plan.optional_models ?? []).filter((model) => !model.installed && rows.some((row) => chosen.has(row.id) && row.model_ids.includes(model.id))) : [];
  return [...first, ...extra];
}

/** The Stack's plan wins: it knows the hardware level and the pinned model
 * for each role. A Stack without a plan route falls back to the role list. */
async function plannedPulls(client: SetupDownloadClient, vramGb?: number, rowIds?: readonly string[]): Promise<PullBody[]> {
  if (client.installPlan) {
    try {
      const plan = await client.installPlan(vramGb ? { vramGb } : undefined);
      if (plan.level) {
        return selectedPulls(plan, rowIds).map(({ starter: _starter, installed: _installed, ...body }) => body as PullBody);
      }
    } catch { /* An older Stack has no plan route; use the role list below. */ }
  }
  const catalog = await client.modelCatalog();
  const pins = Array.isArray(catalog.models) ? catalog.models as DownloadPin[] : [];
  const roles = new Set(planRoles());
  const selected = pins.filter((pin) => pin.component !== "projector" && pin.download?.url && pin.download.sha256 && pin.revision && roles.has(pin.role));
  selected.sort((a, b) => Number(b.role === STARTER_ROLE) - Number(a.role === STARTER_ROLE));
  return selected.map((pin) => ({ id: pin.id, role: pin.role, ...(pin.repo ? { repo: pin.repo } : {}), url: pin.download!.url, sha256: pin.download!.sha256, ...(pin.download!.approx_bytes !== undefined ? { approx_bytes: pin.download!.approx_bytes } : {}), licence: pin.license ?? pin.licence ?? "", revision: pin.revision, ...(pin.engine ? { engine: pin.engine } : {}), ...(pin.download!.archive ? { archive: true } : {}), ...(pin.download!.hub_file ? { hub_file: pin.download!.hub_file } : {}), ...(pin.component ? { component: pin.component } : {}) }) as PullBody);
}

/** `selected`: the disk plan's row ids to install. Without it, the choice saved at the plan step; without that, the first-run set. */
export async function startSetupDownloads(client: SetupDownloadClient = getStackClient(), options: { vramGb?: number; selected?: readonly string[]; /** Licensed parts (Detailed video) the person kept on and accepted: installed through the Stack's component route, which records the acceptance. Nothing else installs them. */ licensed?: ReadonlyArray<{ component: string; licence: string }>; installComponent?: typeof installStackComponent } = {}): Promise<number> {
  // No number given: use the memory answer saved when the plan was chosen.
  const pulls = await plannedPulls(client, resolveMemoryGb(options.vramGb), options.selected ?? getInstallSelection());
  // Models are useless without the engine build that runs them: the Stack
  // never fetches one on its own, so install each named engine first. The
  // picture engine (mflux) has no download of its own: the Stack builds it
  // when the first picture is made.
  const engines = [...new Set(pulls.map((pull) => pull.engine).filter((name): name is string => Boolean(name) && name !== "mflux"))];
  if (client.engineAction) {
    for (const name of engines) {
      try { await client.engineAction(name, "install"); }
      catch (error) { console.error(`Could not install the ${name} engine build. Chat stays paused until it is installed: press Try again in Settings, Engines. ${error instanceof Error ? error.message : String(error)}`); }
    }
  }
  let cursor = 0;
  const worker = async () => {
    while (cursor < pulls.length) {
      const body = pulls[cursor++];
      if (!body) continue;
      try { await client.pullModel(body); } catch { /* Each plan item owns its failure; start the rest. */ }
    }
  };
  await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL, pulls.length) }, worker));
  const install = options.installComponent ?? installStackComponent;
  for (const part of options.licensed ?? []) {
    try { await install(part.component, { acceptedLicence: part.licence }); } catch (error) { console.error(`Could not start installing ${part.component}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  return pulls.length + (options.licensed?.length ?? 0);
}
