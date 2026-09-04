// Wake-word model id -> asset path registry (2026-09-04, phase 1 of the
// wake-word plan in docs/dev.md). Ported from `home-legacy.git`'s own
// `frontend/src/lib/voice/wake-word-models.ts`, narrowed to this phase's
// real scope: one stock detector (openWakeWord's "hey jarvis"), fetched
// from the backend's own discovery route
// (backend/src/routes/voice.ts's GET /api/voice/wakewords) rather than
// hand-duplicating that list here - the backend already owns the
// canonical set of pinned assets (backend/src/lib/wakewordAssets.ts).
//
// All detectors share two upstream ONNX stages (mel + embedding); only
// the per-wake-word detector swaps.
export const WAKE_WORD_ASSET_BASE = "/api/voice/wakeword";

export const SHARED_MEL_PATH = `${WAKE_WORD_ASSET_BASE}/melspectrogram.onnx`;
export const SHARED_EMBEDDING_PATH = `${WAKE_WORD_ASSET_BASE}/embedding_model.onnx`;

export interface WakeWordModelEntry {
  readonly id: string;
  readonly displayName: string;
  readonly assetPath: string;
  readonly defaultThreshold: number;
}

// A built-in fallback so the pipeline has something real to load even
// before loadInstalledWakewords() below ever runs (e.g. a direct
// loadPipeline() call in a test) - the same entry the backend's registry
// currently returns, kept here too rather than left to only ever exist
// server-side, since a caller with no network yet (this module's own
// default) still needs a real default id.
//
// The Map is the ONLY source of truth (a code review, 2026-09-04, found
// an earlier version also kept a parallel ENTRIES array that only ever
// grew, never updated in place: re-registering an id already present
// updated the Map but left listWakeWordModels() returning the old,
// stale object for that id forever - two copies of the same state
// drifting apart, exactly what the "one definition, one place" principle
// exists to prevent).
const REGISTRY: Map<string, WakeWordModelEntry> = new Map([
  [
    "hey_jarvis",
    {
      id: "hey_jarvis",
      displayName: 'openWakeWord "hey jarvis"',
      assetPath: `${WAKE_WORD_ASSET_BASE}/hey_jarvis_v0.1.onnx`,
      defaultThreshold: 0.5,
    },
  ],
]);

export function registerWakeWordModels(entries: WakeWordModelEntry[]): void {
  for (const e of entries) REGISTRY.set(e.id, e);
}

export function listWakeWordModels(): readonly WakeWordModelEntry[] {
  return [...REGISTRY.values()];
}

export function getWakeWordModel(id: string): WakeWordModelEntry {
  const entry = REGISTRY.get(id);
  if (!entry) throw new Error(`unknown wake-word model id: ${id}`);
  return entry;
}

export const DEFAULT_WAKE_WORD_MODEL_ID = "hey_jarvis";

let loaded = false;

/** Fetches the detectors actually available from the backend and
 * registers them, so the wake loop reflects what's really there rather
 * than only this module's own built-in default. Safe to call
 * repeatedly; a network failure (offline, signed out) just keeps the
 * built-in default. */
export async function loadInstalledWakewords(force = false): Promise<readonly WakeWordModelEntry[]> {
  if (loaded && !force) return listWakeWordModels();
  try {
    const res = await fetch("/api/voice/wakewords", { credentials: "include" });
    if (res.ok) {
      const data = (await res.json()) as { detectors: { id: string; label: string; file: string }[] };
      registerWakeWordModels(
        data.detectors.map((d) => ({
          id: d.id,
          displayName: d.label,
          assetPath: `${WAKE_WORD_ASSET_BASE}/${d.file}`,
          defaultThreshold: 0.5,
        })),
      );
      loaded = true;
    }
  } catch {
    /* offline -> keep the built-in default */
  }
  return listWakeWordModels();
}
