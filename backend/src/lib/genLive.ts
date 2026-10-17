// GENPREVIEW-01: what a picture or video job is doing right now, beyond the percent the job row keeps: the stage in
// words, the steps, the ETA and the latest preview picture. It lives in memory only (it is a live view of one running
// job, rebuilt by the next poll after a restart), is dropped when the job settles, and is served to the job's owner
// through the job's own card routes: no new status surface. The preview bytes are fetched from the engine by Home's
// own watcher, so the browser never reaches the engine and the engine's address never leaves the server.
export interface StackLiveFields {
  progress_fraction?: number | null;
  stage?: string | null;
  stage_label?: string | null;
  step?: number | null;
  steps?: number | null;
  eta_seconds?: number | null;
  preview_url?: string | null;
  preview_step?: number | null;
}

export interface LiveProgress {
  stageLabel: string | null;
  etaSeconds: number | null;
  step: number | null;
  steps: number | null;
  fraction: number | null;
  previewVersion: number;
  previewStep: number | null;
  preview: Uint8Array | null;
}

const live = new Map<string, LiveProgress>();
const MAX_LIVE = 200;

export function getLive(id: string): LiveProgress | null { return live.get(id) ?? null; }
export function clearLive(id: string): void { live.delete(id); }
export function __clearLiveForTests(): void { live.clear(); }

/** The version number in the engine's `preview_url` (`?v=3`), or 0 when there is none. */
export function previewVersionOf(url: string | null | undefined): number {
  const match = url ? /[?&]v=(\d+)/.exec(url) : null;
  return match ? Number(match[1]) : 0;
}

/**
 * Records one poll's live fields. When the engine shows a newer preview than the one held, `fetchPreview` is asked
 * for its bytes; a failed fetch keeps the previous preview and is tried again on the next poll.
 */
export async function updateLive(id: string, status: StackLiveFields, fetchPreview: () => Promise<Uint8Array>): Promise<void> {
  const before = live.get(id) ?? null;
  const version = previewVersionOf(status.preview_url);
  const next: LiveProgress = {
    stageLabel: status.stage_label ?? null,
    etaSeconds: typeof status.eta_seconds === "number" ? status.eta_seconds : null,
    step: typeof status.step === "number" ? status.step : null,
    steps: typeof status.steps === "number" ? status.steps : null,
    fraction: typeof status.progress_fraction === "number" ? status.progress_fraction : null,
    previewVersion: before?.previewVersion ?? 0,
    previewStep: before?.previewStep ?? null,
    preview: before?.preview ?? null,
  };
  if (!live.has(id)) while (live.size >= MAX_LIVE) live.delete(live.keys().next().value as string);
  live.set(id, next);
  if (version > next.previewVersion) {
    try {
      const bytes = await fetchPreview();
      const current = live.get(id);
      // The job may have settled while the bytes were coming.
      if (current === next) { current.preview = bytes; current.previewVersion = version; current.previewStep = status.preview_step ?? null; }
    } catch { /* the next poll tries again */ }
  }
}

/** The card's fields for a job (all null when nothing live is known). */
export function liveCardFields(id: string, urlFor: (version: number) => string) {
  const progress = live.get(id) ?? null;
  return {
    stage_label: progress?.stageLabel ?? null,
    eta_seconds: progress?.etaSeconds ?? null,
    step: progress?.step ?? null,
    steps: progress?.steps ?? null,
    preview_url: progress?.preview ? urlFor(progress.previewVersion) : null,
    preview_step: progress?.preview ? progress.previewStep : null,
  };
}
