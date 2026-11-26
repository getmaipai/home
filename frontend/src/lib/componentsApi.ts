// COMPONENTS-01: Settings, Models and storage. Data only; nothing here draws. The routes are owner and admin only.
import { requestJson } from "@/lib/api";

export type ComponentGroup = "chat" | "voice" | "pictures" | "video" | "music" | "stems" | "tools" | "loras";
export interface ComponentRow {
  id: string; label: string; summary: string; group: ComponentGroup; kind: "model" | "lora";
  state: "installed" | "installing" | "notInstalled" | "failed";
  size_bytes: number | null; download_bytes: number; full_bytes: number; required_free_bytes: number;
  plan_need: "required" | "recommended" | "optional" | null;
  requirement: "required" | "optional" | "unsupported"; requirement_reason: string | null;
  last_used_at: string | null; used_by: string[]; depends_on: string[];
  /** MP-09: the licence a part ships under when there is nothing to accept (ffmpeg: GPL 3 or later). */
  licence_name?: string | null;
  job: string | null; percent: number | null; failure: string | null;
  can_install: boolean; install_block: string | null; can_uninstall: boolean; uninstall_block: string | null;
}
export interface ComponentsOverview {
  stack: "ok" | "unreachable"; message: string | null; tier: string | null;
  free_disk_bytes: number | null; disk_margin_bytes: number; installed_bytes: number; components: ComponentRow[];
  /** VIDEO-SETTINGS-02: some adult-only styles are locked; one tile stands for them, never a count. */
  locked_styles?: boolean;
}
export interface CleanupItem { id: string; kind: "superseded" | "orphan_folder" | "partial_download" | "package_cache" | "previews"; label: string; bytes: number; reversible: boolean; how: string; blocked: string | null }


export const componentsApi = {
  cleanup: () => requestJson<CleanupItem[]>("/api/storage/cleanup"),
  clearCleanup: (ids: string[]) => requestJson<{ bytes_freed: number }>("/api/storage/cleanup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids }) }),
  list: () => requestJson<ComponentsOverview>("/api/components"),
  install: (id: string) => requestJson<{ job: string | null; component: string }>(`/api/components/${encodeURIComponent(id)}/install`, { method: "POST" }),
  uninstall: (id: string) => requestJson<{ component: string; freed_bytes: number; removed: boolean }>(`/api/components/${encodeURIComponent(id)}`, { method: "DELETE" }),
};
