import { getStackClient } from "@/lib/stackEngine";
import { getSetupState } from "@/lib/setupState";
import type { StackInstallPlan } from "@/lib/stack/client";

type DownloadPin = { id: string; role: string; repo?: string; license?: string; licence?: string; revision: string; engine?: string; component?: string; download?: { url: string; sha256: string; approx_bytes?: number; archive?: boolean; hub_file?: string } };
export interface SetupDownloadClient {
  modelCatalog(): Promise<Record<string, unknown>>;
  /** The Stack's own plan for this computer; absent on a Stack too old to have one. */
  installPlan?(query?: { vramGb?: number }): Promise<StackInstallPlan>;
  pullModel(body: { id: string; role: string; repo?: string; url: string; sha256: string; approx_bytes?: number; licence: string; revision: string; engine?: string; archive?: boolean; hub_file?: string; component?: string }): Promise<Record<string, unknown>>;
}

const MAX_PARALLEL = 4;
const PLAN_ROLES: Record<string, readonly string[]> = {
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

/** The Stack's plan wins: it knows the hardware level and the pinned model
 * for each role. A Stack without a plan route falls back to the role list. */
async function plannedPulls(client: SetupDownloadClient, vramGb?: number): Promise<PullBody[]> {
  if (client.installPlan) {
    try {
      const plan = await client.installPlan(vramGb ? { vramGb } : undefined);
      if (plan.level) {
        return plan.models.filter((model) => !model.installed).map(({ starter: _starter, installed: _installed, ...body }) => body as PullBody);
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

export async function startSetupDownloads(client: SetupDownloadClient = getStackClient(), options: { vramGb?: number } = {}): Promise<number> {
  const pulls = await plannedPulls(client, options.vramGb);
  let cursor = 0;
  const worker = async () => {
    while (cursor < pulls.length) {
      const body = pulls[cursor++];
      if (!body) continue;
      try { await client.pullModel(body); } catch { /* Each plan item owns its failure; start the rest. */ }
    }
  };
  await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL, pulls.length) }, worker));
  return pulls.length;
}
