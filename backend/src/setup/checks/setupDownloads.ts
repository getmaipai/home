import { getStackClient } from "@/lib/stackEngine";
import { getSetupState } from "@/lib/setupState";

type DownloadPin = { id: string; role: string; repo?: string; license?: string; licence?: string; revision: string; engine?: string; component?: string; download?: { url: string; sha256: string; approx_bytes?: number; archive?: boolean; hub_file?: string } };
export interface SetupDownloadClient {
  modelCatalog(): Promise<Record<string, unknown>>;
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

export async function startSetupDownloads(client: SetupDownloadClient = getStackClient()): Promise<void> {
  const catalog = await client.modelCatalog();
  const pins = Array.isArray(catalog.models) ? catalog.models as DownloadPin[] : [];
  const roles = new Set(planRoles());
  const plannedPins = pins.filter((pin) => pin.component !== "projector" && pin.download?.url && pin.download.sha256 && pin.revision);
  const selected = plannedPins.filter((pin) => roles.has(pin.role));
  selected.sort((a, b) => Number(b.role === STARTER_ROLE) - Number(a.role === STARTER_ROLE));
  let cursor = 0;
  const worker = async () => {
    while (cursor < selected.length) {
      const pin = selected[cursor++];
      if (!pin?.download) continue;
      try {
        await client.pullModel({ id: pin.id, role: pin.role, ...(pin.repo ? { repo: pin.repo } : {}), url: pin.download.url, sha256: pin.download.sha256, ...(pin.download.approx_bytes !== undefined ? { approx_bytes: pin.download.approx_bytes } : {}), licence: pin.license ?? pin.licence ?? "", revision: pin.revision, ...(pin.engine ? { engine: pin.engine } : {}), ...(pin.download.archive ? { archive: true } : {}), ...(pin.download.hub_file ? { hub_file: pin.download.hub_file } : {}), ...(pin.component ? { component: pin.component } : {}) });
      } catch { /* Each plan item owns its failure; start the rest. */ }
    }
  };
  await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL, selected.length) }, worker));
}
