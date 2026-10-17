import { useEffect, useRef, type RefObject } from "react";
import { useSurface } from "@maipai/ui/src/useSurface";

const OPEN_LAYERS = "[role='dialog'], [role='alertdialog'], [role='menu'], [role='listbox'], [data-radix-popper-content-wrapper]";

/** True when the person is typing in a field other than the composer (a rename box, the search box). */
function typingElsewhere(composer: HTMLElement): boolean {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || active === composer) return false;
  return active.matches("input, textarea, select, [contenteditable='true']");
}

/**
 * CHAT-FOCUS-01: the composer takes focus when the person arrives on Chat (a click on Chat in the rail, New chat, an
 * opened conversation, coming back from another page: `entryKey` changes on each) and when a menu or dialog that was
 * opened from the composer closes. The kit composer already focuses itself on mount, a thread switch and a run start;
 * this adds the cases where nothing remounts. It never takes focus from another field, while a dialog or menu is
 * open, or on a touch screen (no surprise keyboard), and never scrolls.
 */
export function useComposerFocus(rootRef: RefObject<HTMLElement | null>, entryKey: string | undefined): void {
  const fine = useSurface().pointer === "fine";
  const fineRef = useRef(fine);
  fineRef.current = fine;

  useEffect(() => {
    if (!fine) return;
    const composer = () => rootRef.current?.querySelector<HTMLElement>("textarea.aui-composer-input") ?? null;
    const focusComposer = (afterClose: boolean) => {
      const field = composer();
      if (!field || field === document.activeElement || (field as HTMLTextAreaElement).disabled) return;
      if (typingElsewhere(field)) return;
      if (document.querySelector(OPEN_LAYERS)) return;
      if (afterClose) {
        const active = document.activeElement;
        const home = active === document.body || active === null || (active instanceof HTMLElement && !!field.closest("[data-slot='aui_composer-shell']")?.contains(active));
        if (!home) return;
      }
      field.focus({ preventScroll: true });
    };
    const timers = new Set<number>();
    const later = (fn: () => void, ms: number) => {
      const id = window.setTimeout(() => { timers.delete(id); fn(); }, ms);
      timers.add(id);
    };
    // Arrival: the composer may mount a beat after the route does; the late retry only claims a focus nobody holds.
    focusComposer(false);
    later(() => focusComposer(true), 120);
    // A menu or dialog closing hands focus back to its trigger a tick later; the composer wins from there.
    const observer = new MutationObserver((records) => {
      const closed = records.some((record) => Array.from(record.removedNodes).some((node) => node instanceof Element && (node.matches(OPEN_LAYERS) || node.querySelector(OPEN_LAYERS))));
      if (closed) later(() => focusComposer(true), 60);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      timers.forEach((id) => window.clearTimeout(id));
    };
  }, [fine, entryKey, rootRef]);
}
