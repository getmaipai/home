// Drag files anywhere on the chat page to attach them. The kit's composer
// already accepts a drop on the composer bar itself (AttachmentDropzone); this
// covers the rest of the page and routes through the same call the "+" menu's
// "Add files" uses (`aui.composer().addAttachment`), so the adapter's accept
// list, size limits, age and surface gates and plain error messages (the
// `composer.attachmentAddError` toast in composerAddMenu.tsx) are one
// definition. A drag that carries no files (text, links, page elements) is
// ignored. Mounted only while the chat page is, so a file dropped elsewhere in
// the app keeps the browser's own behavior; here it never navigates away.
import { useEffect } from "react";
import { useAui } from "@assistant-ui/react";
import { toast } from "sonner";

export const DROP_HINT_ID = "chat-file-drop-hint";
export const DROP_HINT = "Drop files to add them";
const COMPOSER_SHELL = '[data-slot="aui_composer-shell"]';

export function dragHasFiles(dataTransfer: DataTransfer | null | undefined): boolean {
  return Array.from(dataTransfer?.types ?? []).includes("Files");
}

/** Pure drag state, so the flicker rule is testable: dragenter/dragleave fire
 * for every child element, so only the count returning to zero (or the drag
 * leaving the window) hides the hint. */
export function createDragTracker(show: () => void, hide: () => void) {
  let depth = 0;
  return {
    enter() { depth += 1; if (depth === 1) show(); },
    leave(leftWindow: boolean) { depth = leftWindow ? 0 : Math.max(0, depth - 1); if (depth === 0) hide(); },
    reset() { depth = 0; hide(); },
  };
}

export function useChatFileDrop(): void {
  const aui = useAui();
  useEffect(() => {
    const tracker = createDragTracker(
      () => { toast.message(DROP_HINT, { id: DROP_HINT_ID, duration: Infinity }); },
      () => { toast.dismiss(DROP_HINT_ID); },
    );
    const files = (e: DragEvent) => dragHasFiles(e.dataTransfer);
    const onEnter = (e: DragEvent) => { if (files(e)) tracker.enter(); };
    const onOver = (e: DragEvent) => {
      if (!files(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const onLeave = (e: DragEvent) => { if (files(e)) tracker.leave(e.relatedTarget === null); };
    const onDrop = (e: DragEvent) => {
      if (!files(e)) return;
      e.preventDefault();
      tracker.reset();
      // The composer's own dropzone already handled a drop on the bar.
      if ((e.target as Element | null)?.closest?.(COMPOSER_SHELL)) return;
      for (const file of Array.from(e.dataTransfer?.files ?? [])) {
        // A refused file reports through composer.attachmentAddError (toast).
        void Promise.resolve(aui.composer().addAttachment(file)).catch(() => {});
      }
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") tracker.reset(); };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    window.addEventListener("keydown", onKey);
    window.addEventListener("dragend", tracker.reset);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("dragend", tracker.reset);
      tracker.reset();
    };
  }, [aui]);
}
