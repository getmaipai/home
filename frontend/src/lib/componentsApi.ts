// COMPONENTS-01: Settings, Models and storage. Data only; nothing here draws. The routes are owner and admin only.
import { ApiError } from "@/lib/api";

export type ComponentGroup = "chat" | "voice" | "pictures" | "video" | "music" | "tools" | "loras";
export interface ComponentRow {
  id: string; label: string; summary: string; group: ComponentGroup; kind: "model" | "lora";
  state: "installed" | "installing" | "notInstalled" | "failed";
  size_bytes: number | null; download_bytes: number; full_bytes: number; required_free_bytes: number;
  plan_need: "required" | "recommended" | "optional" | null;
  requirement: "required" | "optional" | "unsupported"; requirement_reason: string | null;
  last_used_at: string | null; used_by: string[]; depends_on: string[];
  job: string | null; percent: number | null; failure: string | null;
  /** VIDEO-LTX-01: a licence with terms of its own, accepted once by an admin before the first install (null for every other part). */
  licence?: { id: string; name: string; url: string; summary: string[]; accepted_at: string | null } | null;
  can_install: boolean; install_block: string | null; can_uninstall: boolean; uninstall_block: string | null;
}
export interface ComponentsOverview {
  stack: "ok" | "unreachable"; message: string | null; tier: string | null;
  free_disk_bytes: number | null; disk_margin_bytes: number; installed_bytes: number; components: ComponentRow[];
}

async function send<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { credentials: "include", ...init });
  const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!res.ok) throw new ApiError(body.error ?? res.statusText, res.status, body.code);
  return body as T;
}

export const componentsApi = {
  list: () => send<ComponentsOverview>("/api/components"),
  install: (id: string, acceptedLicence?: string) => send<{ job: string | null; component: string }>(`/api/components/${encodeURIComponent(id)}/install`, { method: "POST", ...(acceptedLicence ? { headers: { "content-type": "application/json" }, body: JSON.stringify({ accepted_licence: acceptedLicence }) } : {}) }),
  uninstall: (id: string) => send<{ component: string; freed_bytes: number; removed: boolean }>(`/api/components/${encodeURIComponent(id)}`, { method: "DELETE" }),
};
