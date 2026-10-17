// IMGTOOLS-05: the data side of the chat canvas's picture editor. The kit's
// ImageEditor Element draws everything (rule 9); this hook only knows which
// picture is open and turns Home's `/api/image-edit` answers into the
// Element's props. No JSX here.
import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ImageEditContextValue, ImageEditTarget } from "@maipai/ui/src/elements/attachment.aui";
import type { ImageEditorOperation, ImageEditorPending, ImageEditorProps, ImageEditorVersion } from "@maipai/ui/src/elements/image-editor";
import { imageEditApi, type EditRequest, type ImageEditStatus, type PictureVersion } from "@/lib/imageEditApi";

export interface OpenImage { id: string; conversationId: string; name: string }

/** A picture Home can edit: a chat attachment or a version the editor saved, addressed with its conversation. Anything else (a web picture an answer shows, with its own licence) is not the person's picture and gets no Edit button. */
export function editTargetFrom(target: ImageEditTarget): OpenImage | null {
  let url: URL;
  try { url = new URL(target.src, "http://home.invalid"); } catch { return null; }
  const conversationId = url.searchParams.get("conversation_id");
  if (!conversationId) return null;
  if (!url.pathname.startsWith("/api/attachments/") && !url.pathname.startsWith("/api/image-edit/pictures/")) return null;
  return { id: target.id, conversationId, name: target.name };
}

function toVersion(version: PictureVersion): ImageEditorVersion {
  return { id: version.id, url: version.url, label: version.label, createdAt: version.created_at, ...(version.width ? { width: version.width } : {}), ...(version.height ? { height: version.height } : {}) };
}
function toRequest(op: ImageEditorOperation): EditRequest { return op; }
function pictureUrl(open: OpenImage, id: string): string { return `/api/image-edit/pictures/${encodeURIComponent(id)}?conversation_id=${encodeURIComponent(open.conversationId)}`; }

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException("Cancelled", "AbortError")); return; }
    const timer = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(timer); reject(new DOMException("Cancelled", "AbortError")); };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export interface UseImageEditor {
  /** The open picture, or null. */
  open: OpenImage | null;
  /** For the kit's attachment Edit button (ImageEditContext). */
  editContext: ImageEditContextValue;
  /** Same handler for an answer block's pictures (kit AnswerBlock onImageEdit). */
  editFromSrc: (target: ImageEditTarget) => void;
  close: () => void;
  /** The Element's props, or null while nothing is open. */
  props: ImageEditorProps | null;
}

export function useImageEditor(options: { canShare: boolean; onShare: (versionId: string) => void; onOpen?: () => void }): UseImageEditor {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState<OpenImage | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const { canShare, onShare, onOpen } = options;

  const statusQuery = useQuery<ImageEditStatus>({
    queryKey: ["image-edit", "status"],
    queryFn: () => imageEditApi.status(),
    enabled: open !== null,
    refetchInterval: (query) => (query.state.data?.state === "preparing" ? 4000 : false),
    staleTime: 10_000,
  });
  const versionsKey = useMemo(() => ["image-edit", "versions", open?.conversationId, open?.id] as const, [open]);
  const versionsQuery = useQuery<PictureVersion[]>({
    queryKey: versionsKey,
    queryFn: () => imageEditApi.versions(open!.conversationId, open!.id),
    enabled: open !== null,
    staleTime: 0,
  });

  const editFromSrc = useCallback((target: ImageEditTarget) => {
    const next = editTargetFrom(target);
    if (!next) return;
    setOpen(next);
    setCurrentId(next.id);
    onOpen?.();
  }, [onOpen]);
  const editContext = useMemo<ImageEditContextValue>(() => ({
    canEdit: (target) => editTargetFrom(target) !== null,
    onEdit: editFromSrc,
    label: "Edit picture",
  }), [editFromSrc]);
  const close = useCallback(() => { setOpen(null); setCurrentId(null); }, []);

  const props = useMemo<ImageEditorProps | null>(() => {
    if (!open || !currentId) return null;
    const loaded = versionsQuery.data?.map(toVersion);
    const fallback: ImageEditorVersion[] = [{ id: open.id, url: pictureUrl(open, open.id), label: "Original" }];
    const versions = loaded && loaded.length > 0 ? loaded : fallback;
    const status = statusQuery.data;
    const loadingReason = "Checking the editing tools.";
    const tool = (key: keyof ImageEditStatus["tools"]) => status?.tools[key] ?? { enabled: false, reason: statusQuery.isError ? "The editing tools aren't reachable right now. Close the editor and try again." : loadingReason };
    const sourceId = currentId;
    const downloadBase = open.name.replace(/\.[^.]+$/, "") || "picture";
    return {
      variant: "pane",
      title: open.name,
      versions,
      currentVersionId: versions.some((version) => version.id === currentId) ? currentId : versions[0]!.id,
      onSelectVersion: setCurrentId,
      tools: { markup: tool("markup"), comment: tool("comment"), remove_background: tool("remove_background"), erase: tool("erase"), resize: tool("resize") },
      statusNote: status?.note ?? null,
      downloadName: `${downloadBase}-edited.png`,
      onClose: close,
      ...(canShare ? { onShare: (version: ImageEditorVersion) => onShare(version.id) } : {}),
      onRunOperation: async (operation, ctl): Promise<ImageEditorPending> => {
        ctl.onProgress({ percent: null, label: "Starting" });
        let progress = await imageEditApi.run(open.conversationId, sourceId, toRequest(operation), ctl.signal);
        while (progress.state === "queued" || progress.state === "running") {
          ctl.onProgress({ percent: progress.percent, label: progress.label });
          try { await wait(700, ctl.signal); } catch (error) { void imageEditApi.cancel(progress.job).catch(() => undefined); throw error; }
          progress = await imageEditApi.poll(progress.job, ctl.signal);
        }
        if (progress.state === "done") {
          const { token, url, width, height, transparent } = progress.preview;
          return { token, previewUrl: url, width, height, transparent };
        }
        throw new Error(progress.state === "failed" || progress.state === "cancelled" ? progress.error : "The edit did not finish. Try again.");
      },
      onApplyPending: async (pending, label) => {
        const version = toVersion(await imageEditApi.apply(pending.token, label));
        queryClient.setQueryData<PictureVersion[]>(versionsKey, (old) => [...(old ?? []), { id: version.id, url: version.url, label: version.label, created_at: version.createdAt ?? new Date().toISOString(), op: "edit", width: version.width ?? null, height: version.height ?? null, media_type: "image/png", source: sourceId, source_sha256: null }]);
        setCurrentId(version.id);
        return version;
      },
      onSaveMarkup: async (png) => {
        const version = toVersion(await imageEditApi.saveMarkup(open.conversationId, sourceId, png));
        queryClient.setQueryData<PictureVersion[]>(versionsKey, (old) => [...(old ?? []), { id: version.id, url: version.url, label: version.label, created_at: version.createdAt ?? new Date().toISOString(), op: "markup", width: version.width ?? null, height: version.height ?? null, media_type: "image/png", source: sourceId, source_sha256: null }]);
        setCurrentId(version.id);
        return version;
      },
      onComment: async (request, ctl): Promise<{ message: string; pending?: ImageEditorPending }> => {
        ctl.onProgress({ percent: null, label: "Sending your change" });
        let progress = await imageEditApi.comment(open.conversationId, sourceId, request, ctl.signal);
        while (progress.state === "queued" || progress.state === "running") {
          ctl.onProgress({ percent: progress.percent, label: progress.label });
          try { await wait(700, ctl.signal); } catch (error) { void imageEditApi.cancel(progress.job).catch(() => undefined); throw error; }
          progress = await imageEditApi.poll(progress.job, ctl.signal);
        }
        if (progress.state === "done") {
          const { token, url, width, height } = progress.preview;
          return { message: "Here is the change. Apply it to keep it as a new version, or discard it.", pending: { token, previewUrl: url, width, height } };
        }
        throw new Error(progress.state === "failed" || progress.state === "cancelled" ? progress.error : "The change did not finish. Try again.");
      },
    };
  }, [open, currentId, versionsQuery.data, statusQuery.data, statusQuery.isError, canShare, onShare, close, queryClient, versionsKey]);

  return { open, editContext, editFromSrc, close, props };
}
