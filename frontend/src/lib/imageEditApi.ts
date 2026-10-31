// IMGTOOLS-05: the picture editor's calls to Home (`/api/image-edit`). Only
// the data the kit's ImageEditor Element is given; nothing here draws.
import { requestJson } from "@/lib/api";

export type EditToolState = { enabled: boolean; reason?: string };
export interface ImageEditStatus {
  state: "ready" | "preparing" | "not_installed" | "unavailable" | "off";
  note: string | null;
  tools: Record<"markup" | "comment" | "remove_background" | "erase" | "resize", EditToolState>;
  limits: Record<string, number>;
}
export interface PictureVersion { id: string; url: string; label: string; created_at: string; op: string; width: number | null; height: number | null; media_type: string; source: string | null; source_sha256: string | null }
export interface EditPreview { token: string; url: string; width: number; height: number; operation: string; engine: string | null; model: string | null; ms: number | null; transparent: boolean }
export type EditProgress =
  | { state: "done"; preview: EditPreview }
  | { state: "queued" | "running"; job: string; percent: number | null; label: string }
  | { state: "failed" | "cancelled"; error: string; code: string };
export type EditRequest =
  | { operation: "remove_background" }
  | { operation: "erase"; mask: Blob }
  | { operation: "upscale"; scale: 2 | 4 }
  | { operation: "resize"; width: number; height: number };

const json = (value: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });

export const imageEditApi = {
  status: () => requestJson<ImageEditStatus>("/api/image-edit/status"),
  versions: (conversationId: string, id: string) => requestJson<{ versions: PictureVersion[] }>(`/api/image-edit/pictures/${encodeURIComponent(id)}/versions?conversation_id=${encodeURIComponent(conversationId)}`).then((body) => body.versions),
  run(conversationId: string, id: string, request: EditRequest, signal?: AbortSignal): Promise<EditProgress> {
    const form = new FormData();
    form.append("conversation_id", conversationId);
    form.append("operation", request.operation);
    if (request.operation === "erase") form.append("mask", request.mask, "mask.png");
    if (request.operation === "upscale") form.append("scale", String(request.scale));
    if (request.operation === "resize") { form.append("width", String(request.width)); form.append("height", String(request.height)); }
    return requestJson<EditProgress>(`/api/image-edit/pictures/${encodeURIComponent(id)}/edit`, { method: "POST", body: form, signal });
  },
  poll: (job: string, signal?: AbortSignal) => requestJson<EditProgress>(`/api/image-edit/jobs/${encodeURIComponent(job)}`, { signal }),
  cancel: (job: string) => requestJson<{ ok: true }>(`/api/image-edit/jobs/${encodeURIComponent(job)}`, { method: "DELETE" }),
  apply: (token: string, label: string) => requestJson<{ version: PictureVersion }>(`/api/image-edit/previews/${encodeURIComponent(token)}/apply`, json({ label })).then((body) => body.version),
  saveMarkup(conversationId: string, id: string, png: Blob): Promise<PictureVersion> {
    const form = new FormData();
    form.append("conversation_id", conversationId);
    form.append("label", "Markup");
    form.append("image", png, "markup.png");
    return requestJson<{ version: PictureVersion }>(`/api/image-edit/pictures/${encodeURIComponent(id)}/versions`, { method: "POST", body: form }).then((body) => body.version);
  },
  /** A change in words (IMGGEN-EDITOR-01): starts the picture engine's edit; poll `poll()` with the job it names, then apply the preview. */
  comment: (conversationId: string, id: string, request: { prompt: string; region: { x: number; y: number; width: number; height: number } | null }, signal?: AbortSignal) =>
    requestJson<EditProgress>(`/api/image-edit/pictures/${encodeURIComponent(id)}/comment`, { ...json({ conversation_id: conversationId, ...request }), ...(signal ? { signal } : {}) }),
};
