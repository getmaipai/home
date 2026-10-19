// Upload cards: one JobProgress per file, up to three at once. A failure shows the hub's plain sentence and a Try again.
import { Fragment, useCallback, useRef, useState } from "react";
import { JobProgress } from "@maipai/ui/src/elements/job-progress";
import { Button } from "@maipai/ui/src/ui/button";
import { uploadLibraryFile } from "@/lib/libraryUpload";

export interface UploadCard { key: number; file: File; sent: number; state: "waiting" | "running" | "failed" | "done"; error?: string }
const PARALLEL = 3;
const STAGES = [{ name: "Uploading", weight: 1 }] as const;

export function useLibraryUploads(onFinished: () => void) {
  const [cards, setCards] = useState<UploadCard[]>([]);
  const counter = useRef(0);
  const controllers = useRef(new Map<number, AbortController>());
  const queue = useRef<number[]>([]);
  const running = useRef(0);
  const filesByKey = useRef(new Map<number, File>());

  const patch = useCallback((key: number, change: Partial<UploadCard>) => setCards((current) => current.map((card) => card.key === key ? { ...card, ...change } : card)), []);
  const pump = useCallback(() => {
    while (running.current < PARALLEL && queue.current.length > 0) {
      const key = queue.current.shift()!;
      const file = filesByKey.current.get(key);
      if (!file) continue;
      running.current += 1;
      const controller = new AbortController();
      controllers.current.set(key, controller);
      patch(key, { state: "running", sent: 0 });
      uploadLibraryFile(file, { signal: controller.signal, onProgress: (sent) => patch(key, { sent }) })
        .then(() => { patch(key, { state: "done", sent: file.size }); onFinished(); })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") setCards((current) => current.filter((card) => card.key !== key));
          else patch(key, { state: "failed", error: error instanceof Error && error.message ? error.message : "Home could not add that file. Check your connection and try again." });
        })
        .finally(() => { running.current -= 1; controllers.current.delete(key); pump(); });
    }
  }, [onFinished, patch]);

  const add = useCallback((files: readonly File[]) => {
    const fresh = files.map((file) => { counter.current += 1; filesByKey.current.set(counter.current, file); return { key: counter.current, file, sent: 0, state: "waiting" as const }; });
    if (fresh.length === 0) return;
    setCards((current) => [...current, ...fresh]);
    queue.current.push(...fresh.map((card) => card.key));
    pump();
  }, [pump]);
  const cancel = useCallback((key: number) => {
    const controller = controllers.current.get(key);
    if (controller) controller.abort();
    else { queue.current = queue.current.filter((entry) => entry !== key); setCards((current) => current.filter((card) => card.key !== key)); }
  }, []);
  const retry = useCallback((key: number) => { patch(key, { state: "waiting", error: undefined }); queue.current.push(key); pump(); }, [patch, pump]);
  const dismiss = useCallback((key: number) => { filesByKey.current.delete(key); setCards((current) => current.filter((card) => card.key !== key)); }, []);
  return { cards, add, cancel, retry, dismiss };
}

export function UploadTray({ cards, onCancel, onRetry, onDismiss }: { cards: readonly UploadCard[]; onCancel: (key: number) => void; onRetry: (key: number) => void; onDismiss: (key: number) => void }) {
  return (
    <>
      {cards.map((card) => (
        <Fragment key={card.key}>
          <JobProgress
            title={card.file.name}
            stages={STAGES}
            stageIndex={card.state === "done" ? 1 : 0}
            stageProgress={card.file.size ? card.sent / card.file.size : 0}
            completedBytes={card.sent}
            totalBytes={card.file.size}
            variant="compact"
            cancelLabel={`Cancel adding ${card.file.name}`}
            onCancel={() => onCancel(card.key)}
            doneLabel="Added"
            {...(card.state === "failed" ? { outcome: { status: "failed" as const, summary: card.error ?? "" } } : {})}
          />
          {card.state === "failed" ? <div className="flex gap-2"><Button type="button" variant="secondary" onClick={() => onRetry(card.key)}>Try again</Button><Button type="button" variant="ghost" onClick={() => onDismiss(card.key)}>Dismiss</Button></div> : null}
          {card.state === "done" ? <div><Button type="button" variant="ghost" onClick={() => onDismiss(card.key)}>Dismiss</Button></div> : null}
        </Fragment>
      ))}
    </>
  );
}
