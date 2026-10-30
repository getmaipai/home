// COMPONENTS-01: Home's calls to the Stack's component list (GET /stack/v1/components, POST /{id}/install,
// DELETE /{id}). One module, loopback only. The Stack's `error` is already a sentence for the person (it says
// what to do first), so it is passed through; nothing here words a refusal itself. A test replaces `fetch`
// with `__setComponentsFetchForTests`.
import { getStackUrl } from "@/lib/stackEngine";
import { ackCovers, currentLicenceAck } from "@/lib/licenceAcceptance";

export type ComponentGroup = "chat" | "voice" | "pictures" | "video" | "music" | "tools" | "loras";
export interface StackComponent {
  id: string; label: string; summary: string; group: ComponentGroup; kind: "model" | "lora";
  state: "installed" | "installing" | "notInstalled" | "failed";
  size_bytes: number | null; download_bytes: number; full_bytes: number; required_free_bytes: number;
  plan_need: "required" | "recommended" | "optional" | null;
  requirement: "required" | "optional" | "unsupported"; requirement_reason: string | null;
  last_used_at: string | null; used_by: string[]; depends_on: string[];
  job: string | null; percent: number | null; failure: string | null;
  /** A licence with terms of its own (the Detailed video model): accepted once by an admin before the first install. null for every other part. */
  licence?: { id: string; name: string; url: string; summary: string[]; accepted_at: string | null; covered?: boolean } | null;
  can_install: boolean; install_block: string | null; can_uninstall: boolean; uninstall_block: string | null;
}
export interface StackComponentList { tier: string | null; free_disk_bytes: number | null; disk_margin_bytes: number; installed_bytes: number; components: StackComponent[] }

/** TIER-HOME-04: the Stack's tier catalog for one category (GET /stack/v1/tiers/candidates): every candidate under each level with its family, peak, fit and plain refusal. */
export type TierStackCategory = "chat" | "pictures" | "video" | "music" | "voice";
export interface TierCandidatePick { id: string; label: string; family: string; peak_bytes: number; verified: boolean; fits: boolean; refusal: string | null }
export interface TierCandidateLevel { tier: "standard" | "boost" | "max"; cap_bytes: number; recommended: string | null; candidates: TierCandidatePick[] }
export interface TierCandidates { category: string; profile: string | null; room_bytes: number; levels: TierCandidateLevel[] }

export class StackComponentError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); this.name = "StackComponentError"; }
}

let fetchForTests: typeof fetch | null = null;
export function __setComponentsFetchForTests(fn: typeof fetch | null): void { fetchForTests = fn; }

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const url = fetchForTests ? "http://127.0.0.1:1" : getStackUrl();
  if (!url) throw new StackComponentError(503, "no_stack", "The engine isn't set up on this computer yet. Ask an admin to check Settings, Engine.");
  try {
    return await (fetchForTests ?? globalThis.fetch)(url.replace(/\/$/, "") + path, { ...init, signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new StackComponentError(503, "unreachable", "The engine isn't answering. Check that the engine is running, then try again.");
  }
}

async function failure(res: Response): Promise<never> {
  let body: { error?: unknown; code?: unknown } = {};
  try { body = await res.json() as typeof body; } catch { /* no detail */ }
  throw new StackComponentError(res.status, typeof body.code === "string" ? body.code : `http_${res.status}`, typeof body.error === "string" && body.error ? body.error : `The engine answered ${res.status}. Try again in a moment.`);
}

export async function listStackComponents(): Promise<StackComponentList> {
  const res = await call("/stack/v1/components");
  if (!res.ok) return failure(res);
  return await res.json() as StackComponentList;
}

/** LICENCE-ACK-01: a part whose licence the household record covers installs with no click: the Stack still gets the notice id it requires. Null when nothing is covered or the list cannot be read. */
async function coveredConsent(id: string): Promise<{ acceptedLicence: string; acceptedBy?: string } | null> {
  const ack = currentLicenceAck();
  if (!ack) return null;
  try {
    const licence = (await listStackComponents()).components.find((component) => component.id === id)?.licence;
    if (!licence || licence.accepted_at || !ackCovers(ack, licence.id)) return null;
    return { acceptedLicence: licence.id, ...(ack.by !== "setup" ? { acceptedBy: ack.by } : {}) };
  } catch { return null; }
}

export async function installStackComponent(id: string, givenConsent: { acceptedLicence?: string; acceptedBy?: string } = {}): Promise<{ job: string | null; component: string; joined?: boolean; already_installed?: boolean }> {
  const consent = givenConsent.acceptedLicence ? givenConsent : (await coveredConsent(id)) ?? givenConsent;
  const body = consent.acceptedLicence ? { accepted_licence: consent.acceptedLicence, ...(consent.acceptedBy ? { accepted_by: consent.acceptedBy } : {}) } : null;
  const res = await call(`/stack/v1/components/${encodeURIComponent(id)}/install`, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : { method: "POST" });
  if (!res.ok) return failure(res);
  return await res.json() as { job: string | null; component: string; joined?: boolean; already_installed?: boolean };
}

export async function uninstallStackComponent(id: string): Promise<{ component: string; freed_bytes: number; removed: boolean }> {
  const res = await call(`/stack/v1/components/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) return failure(res);
  return await res.json() as { component: string; freed_bytes: number; removed: boolean };
}

export async function listTierCandidates(category: TierStackCategory): Promise<TierCandidates> {
  const res = await call(`/stack/v1/tiers/candidates?category=${encodeURIComponent(category)}`);
  if (!res.ok) return failure(res);
  return await res.json() as TierCandidates;
}
