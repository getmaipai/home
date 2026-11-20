// The Features tab of Settings, AI and models (owner, 2026-11-17): the models behind each feature, in the order the Stack would try them,
// drawn only from what the Stack sent. Home knows a category, a part id it was given, a rank, and the household's own order (rules E1, E2,
// E5): no name, description or size here. For a child or teen the Stack's minor list is read instead, so a label is already neutral (E6).
//
// A model is offered on a feature's Change sheet when its part serves one of the feature's generic jobs in the jobs catalog (it has a pack
// for the feature), or when the household already runs it (installed, installing, or in the household's own order). A feature with no
// generic job yet (music, chat) offers the category's models. The household's order, when set, puts its ids first; the rest follow the
// Stack's priority.
import type { StackPartView } from "@maipai/spec/stack/ts/stack-part-view.js";
import { getStackClient } from "@/lib/stackEngine";
import { getHouseholdSettingValue, setHouseholdSettingValue } from "@/lib/settings";

export type FeatureModelState = StackPartView["state"];
export interface FeatureModel { id: string; label: string; description: string; rank: number; state: FeatureModelState; size_bytes: number; download_bytes: number; percent: number | null; running: boolean; failure: string | null; install_block: string | null;
  /** WAN-DEFAULT-01: a model only the household's children and teens use, listed for an admin of a home that has one so it can be installed here; never part of the adult order. */
  for_minors?: true }
export interface FeatureModelsRow { id: "pictures" | "videos" | "music"; ordered: true; order: string[]; models: FeatureModel[] }
export interface FeatureModelsView { audience: "adult" | "minor"; features: FeatureModelsRow[] }

/** Home's own knowledge: which Stack category a feature draws from, and which generic jobs it asks for (E7). */
const FEATURES = [
  { id: "pictures", category: "pictures", jobs: ["picture", "picture_edit"] },
  { id: "videos", category: "video", jobs: ["clip"] },
  { id: "music", category: "music", jobs: [] },
] as const;
const orderKeyOf = (category: string) => `engines.${category}.order`;
const storedOrder = (category: string): string[] => { const raw = getHouseholdSettingValue(orderKeyOf(category)); return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : []; };
const alreadyRuns = (part: StackPartView, order: readonly string[]) => part.state !== "missing" && part.state !== "unsupported" || order.includes(part.id);

export async function featureModels(audience: "adult" | "minor", options: { alsoMinors?: boolean } = {}): Promise<FeatureModelsView> {
  const stack = getStackClient();
  if (!stack.parts) return { audience, features: FEATURES.map((feature) => ({ id: feature.id, ordered: true, order: storedOrder(feature.category), models: [] })) };
  const [list, catalog] = await Promise.all([stack.parts({ audience, kind: "model" }), stack.jobsCatalog ? stack.jobsCatalog(audience).catch(() => null) : Promise.resolve(null)]);
  // WAN-DEFAULT-01: for an admin of a home with a child or teen, the models the Stack lists only for minors are added to the Videos line, after the adult order, marked for_minors.
  const minorsOnly = audience === "adult" && options.alsoMinors === true ? await stack.parts({ audience: "minor", kind: "model" }).then((minor) => minor.parts.filter((part) => !list.parts.some((adult) => adult.id === part.id))).catch(() => []) : [];
  const features = FEATURES.map((feature): FeatureModelsRow => {
    const order = storedOrder(feature.category);
    const inCategory = list.parts.filter((part) => part.category === feature.category);
    const serving = new Set<string>();
    for (const job of catalog?.jobs ?? []) if ((feature.jobs as readonly string[]).includes(job.job)) { if (job.part) serving.add(job.part.id); for (const alt of job.alternatives ?? []) serving.add(alt.part); }
    const hasJobs = feature.jobs.length > 0 && catalog !== null;
    const offered = inCategory.filter((part) => !hasJobs || serving.has(part.id) || alreadyRuns(part, order));
    // A minor never reads the household's order (E6): the Stack's priority only.
    const rankOf = (part: StackPartView) => { const at = audience === "adult" ? order.indexOf(part.id) : -1; return at >= 0 ? at - 1000 : part.priority; };
    const models = [...offered].sort((a, b) => rankOf(a) - rankOf(b) || a.id.localeCompare(b.id)).map((part, index): FeatureModel => ({
      id: part.id, label: part.label, description: part.description, rank: index + 1, state: part.state, size_bytes: part.size_bytes, download_bytes: part.download_bytes, percent: part.percent,
      running: part.enabled && part.state === "ready", failure: part.state === "failed" ? part.install_block : null, install_block: part.can_install ? null : part.install_block,
    }));
    const forMinors = feature.id === "videos" ? minorsOnly.filter((part) => part.category === feature.category).map((part, index): FeatureModel => ({
      id: part.id, label: part.label, description: part.description, rank: models.length + index + 1, state: part.state, size_bytes: part.size_bytes, download_bytes: part.download_bytes, percent: part.percent,
      running: part.enabled && part.state === "ready", failure: part.state === "failed" ? part.install_block : null, install_block: part.can_install ? null : part.install_block, for_minors: true,
    })) : [];
    return { id: feature.id, ordered: true, order: audience === "adult" ? order : [], models: [...models, ...forMinors] };
  });
  return { audience, features };
}

const CATEGORY_OF = Object.fromEntries(FEATURES.map((feature) => [feature.id, feature.category])) as Record<string, string>;
export const isOrderedFeature = (id: string): id is FeatureModelsRow["id"] => id in CATEGORY_OF;

/** Writes the household's order for one feature (empty = the Stack's own order) and pushes every category's order to the Stack (rule E5: Home stores it once and sends it). */
export async function setFeatureOrder(id: FeatureModelsRow["id"], order: string[]): Promise<{ ok: true } | { ok: false; error: string }> {
  const written = setHouseholdSettingValue(orderKeyOf(CATEGORY_OF[id]!), order);
  if (!written.ok) return { ok: false, error: written.error };
  const stack = getStackClient();
  if (stack.setPartChoices) {
    try { await stack.setPartChoices(Object.fromEntries(FEATURES.map((feature) => [feature.category, { order: storedOrder(feature.category), off: [] as string[] }]))); }
    catch { return { ok: false, error: "Home saved the order, but could not tell the AI engine yet. It will use it once the engine answers." }; }
  }
  return { ok: true };
}
