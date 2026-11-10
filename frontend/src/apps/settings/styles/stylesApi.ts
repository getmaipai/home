// VIDEO-LORA-08: the Styles tab's calls to Home (`/api/loras`, docs/dev/loras.md and docs/dev/lora-sources.md). Data only; nothing here draws.
// The unlock proof rides on every same-origin `/api/` call by itself (`installAdultFetch`), so none of these functions touch it.
import { i18n } from "@lingui/core";
import { requestJson } from "@/lib/api";

export type StyleKind = "style" | "character" | "motion" | "other";
export type AdultCheckState = "normal" | "unknown" | "adult";
export type StyleWho = "admins" | "adults" | "people";
export type BaseModelId = "ltx-2.3" | "ltx-2.5" | "wan2.2-ti2v-5b" | "unknown";

export interface StyleStrength { default: number; min: number; max: number }
/** One style as an owner or admin sees it once the lock is open (the server sends a locked style as nothing but the list's `locked` flag). */
export interface StyleRow {
  id: string; name: string; kind: StyleKind; description: string; media: "video" | "picture"; base_model: BaseModelId; compatible_with: string[]; usable: boolean; /** LTXD-18B: the library line for an old-base style that is not offered; null otherwise. */ base_note?: string | null; tested_on_25?: "tested" | "no_effect" | null;
  trigger_words: string[]; trigger_position: "start" | "end"; positive_addins: string[]; negative_addins: string[]; avoid_as_positive: string[];
  strength: StyleStrength; audience: "all-ages" | "adult-only"; availability: { who: StyleWho; people: string[] };
  needs_confirmation: boolean; adult_check: AdultCheckState; licence: { id: string | null; commercial_use: string };
  file: { sha256: string; bytes: number; rank: number | null }; source: { site: string; url: string | null };
  preview_file_id: string | null; added_at: string; removed_at: string | null; trash_until: string | null;
}
export interface StyleList { items: StyleRow[]; locked: boolean }

export type BrowseSource = "huggingface" | "civitai" | "both";
export interface BrowseQuery {
  source: BrowseSource; q: string; media: "video" | "picture"; kind: "any" | "style" | "character"; base: "default" | "ltx-2.5" | "wan" | "flux2-klein-4b" | "z-image-turbo" | "ernie-image-turbo" | "all";
  installed: "any" | "not_installed" | "installed"; sort: "downloads" | "rating" | "newest"; cursor: string | null; adult: boolean;
}
/** A hit the caller may see. Adult and unknown hits never appear here: they are the response's one `locked` flag. */
export interface BrowseHit {
  key: string; site: "huggingface" | "civitai"; remote_id: string; version_id: string | null; title: string; creator: string | null; page_url: string | null; preview: string | null;
  base_label: string; base_model: BaseModelId; /** A generic LTX 2 label with no version stated: install only after the admin picks the version. */ base_unstated?: boolean; kind: string; bytes: number | null; sha256: string | null;
  licence: { id: string | null; class: "open" | "non_commercial" | "custom" | "unknown"; commercial_use: string };
  downloads: number; rating: number | null; created_at: string | null; trigger_words: string[]; also_on: string[]; gated: boolean;
  adult_check: AdultCheckState; installed: { id: string; name: string } | null; reason: string | null; line: string; confirm_item: string;
}
export interface BrowsePage { items: BrowseHit[]; locked: boolean; next_cursor: string | null; notes: string[] }

export interface SourcesState { huggingface: { on: true; token_saved: boolean }; civitai: { on: boolean; key_saved: boolean } }
export interface InstallJob { job: string; state: string; title: string; percent: number | null }

export interface InstallBody {
  source: "huggingface" | "civitai"; remote_id?: string; version_id?: string | null; url?: string; name?: string; kind?: "style" | "character";
  media?: "video" | "picture";
  audience: "all-ages" | "adult-only"; licence_confirmed: boolean; base_model?: "ltx-2.5" | "wan2.2-ti2v-5b"; confirm_ticket?: string; as_separate?: boolean;
}
export interface StylePatch {
  name?: string; description?: string; kind?: StyleKind; availability?: { who: StyleWho; people?: string[] };
  strength?: Partial<StyleStrength>; trigger_words?: string[]; trigger_position?: "start" | "end";
  positive_addins?: string[]; negative_addins?: string[]; avoid_as_positive?: string[]; base_model?: BaseModelId;
}

const post = <T>(path: string, body?: unknown) => requestJson<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

export const stylesApi = {
  list: (removed = false) => requestJson<StyleList>(`/api/loras${removed ? "?removed=true" : ""}`),
  patch: (id: string, patch: StylePatch) => requestJson<StyleRow>(`/api/loras/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) }),
  confirmLicence: (id: string) => post<StyleRow>(`/api/loras/${encodeURIComponent(id)}/confirm`),
  markAdultOnly: (id: string) => post<StyleRow>(`/api/loras/${encodeURIComponent(id)}/nsfw`),
  markAllAges: (id: string, ticket?: string) => post<StyleRow>(`/api/loras/${encodeURIComponent(id)}/all-ages`, { confirm: true, ...(ticket ? { ticket } : {}) }),
  remove: (id: string) => post<StyleRow>(`/api/loras/${encodeURIComponent(id)}/remove`),
  restore: (id: string) => post<StyleRow>(`/api/loras/${encodeURIComponent(id)}/restore`),
  browse: (query: BrowseQuery) => post<BrowsePage>("/api/loras/browse", query),
  hit: (site: string, id: string, version: string | null) => requestJson<BrowseHit>(`/api/loras/browse/${site}/${encodeURIComponent(id)}${version ? `?version=${encodeURIComponent(version)}` : ""}`),
  install: (body: InstallBody) => post<{ job: string }>("/api/loras/install", body),
  installs: () => requestJson<{ items: InstallJob[] }>("/api/loras/install"),
  sources: () => requestJson<SourcesState>("/api/loras/sources"),
  setCivitai: (on: boolean) => requestJson<SourcesState>("/api/loras/sources/civitai", { method: "PUT", body: JSON.stringify({ on }) }),
  saveCivitaiKey: (key: string) => post<SourcesState>("/api/loras/sources/civitai-key", { key }),
  removeCivitaiKey: () => post<SourcesState>("/api/loras/sources/civitai-key/remove"),
  saveHuggingFaceToken: (token: string) => post<SourcesState>("/api/loras/sources/huggingface-token", { token }),
  removeHuggingFaceToken: () => post<SourcesState>("/api/loras/sources/huggingface-token/remove"),
  /** The fresh passcode ticket of the Adult lock (single use, 30 seconds, bound to `item`); the host's `confirm` dialog supplies the secret. */
  confirmTicket: (secret: string, item: string) => post<{ ticket: string; expires_in: number }>("/api/adult-lock/confirm", { secret, action: "unmark", item }),
  /** "Add from a file": the existing multipart add (the route answers the Stack's view). */
  addFile: (form: FormData) => requestJson<{ id: string }>("/api/videos/adapters", { method: "POST", body: form }),
};

export const baseWords = (): Record<BaseModelId, string> => ({ "ltx-2.5": "LTX-2.5", "ltx-2.3": i18n._({ id: "Retired video model, no longer available", message: "Retired video model, no longer available" }), "wan2.2-ti2v-5b": "Wan", unknown: i18n._({ id: "an unknown base", message: "an unknown base" }) });
