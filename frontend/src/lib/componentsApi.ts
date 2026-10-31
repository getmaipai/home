// COMPONENTS-01: Settings, Models and storage. Data only; nothing here draws. The routes are owner and admin only.
import { requestJson } from "@/lib/api";

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
  licence?: { id: string; name: string; url: string; summary: string[]; accepted_at: string | null; covered?: boolean } | null;
  can_install: boolean; install_block: string | null; can_uninstall: boolean; uninstall_block: string | null;
}
export interface LicenceEntry { component: string; label: string; id: string; name: string; url: string; summary: string[]; accepted_at: string | null; covered: boolean }
/** LICENCE-ACK-01: the household's licence acknowledgement, the one admin prompt and the recommended extras. */
export interface LicenceOverview {
  stack: "ok" | "unreachable"; terms_version: string; acknowledged: { by: string; at: string; terms_version: string } | null;
  needs_prompt: boolean; licences: LicenceEntry[]; extras: { ids: string[]; labels: string[]; bytes: number; size: string } | null;
}
export interface ComponentsOverview {
  stack: "ok" | "unreachable"; message: string | null; tier: string | null;
  free_disk_bytes: number | null; disk_margin_bytes: number; installed_bytes: number; components: ComponentRow[];
}


export const componentsApi = {
  list: () => requestJson<ComponentsOverview>("/api/components"),
  install: (id: string, acceptedLicence?: string) => requestJson<{ job: string | null; component: string }>(`/api/components/${encodeURIComponent(id)}/install`, { method: "POST", ...(acceptedLicence ? { headers: { "content-type": "application/json" }, body: JSON.stringify({ accepted_licence: acceptedLicence }) } : {}) }),
  licences: () => requestJson<LicenceOverview>("/api/install/licences"),
  acceptLicences: () => requestJson<{ accepted: true; auto_install: boolean }>("/api/install/licences/accept", { method: "POST" }),
  installExtras: () => requestJson<{ started: true; models: number }>("/api/install/licences/install-extras", { method: "POST" }),
  uninstall: (id: string) => requestJson<{ component: string; freed_bytes: number; removed: boolean }>(`/api/components/${encodeURIComponent(id)}`, { method: "DELETE" }),
};
