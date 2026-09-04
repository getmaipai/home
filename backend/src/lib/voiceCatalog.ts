// The full community voice catalog (2026-09-04, item 3 of the Pocket TTS
// follow-ups note in docs/dev.md): every real file in `kyutai/tts-voices`
// on Hugging Face (confirmed live: a non-gated model repo, `gated:
// false`, distinct from the gated cloning checkpoint), not just the 26
// names Pocket TTS bundles as built-in presets
// (backend/src/settings/voiceKeys.ts). 2,069 real files across 3 pages,
// confirmed live via HF's own cursor-paginated tree API - small enough
// (a few hundred KB of path strings) to cache the whole thing in memory
// rather than build server-side search/pagination for it.
//
// This never downloads any actual audio: only the file LISTING (paths),
// metadata a household browses before picking one. Picking a voice
// doesn't fetch it here either - Pocket TTS's own server resolves and
// caches the real `hf://` file itself, the same way it already does for
// the 26 built-in presets (spec/voice/README.md).
// Overridable for tests only (MAIPAI_VOICE_CATALOG_URL, tests/preload.ts) -
// the same "point the real fetch logic at a local fixture instead of the
// real internet" shape MAIPAI_LLAMA_SERVER_URL/MAIPAI_TTS_URL already use,
// since this repo's own testing standard is "deterministic and offline by
// default," and pagination (fetchFullCatalog()'s `Link`-header following)
// is real logic worth exercising against a real HTTP server, not just
// unit-tested in isolation.
function hfTreeUrl(): string {
  return process.env.MAIPAI_VOICE_CATALOG_URL ?? "https://huggingface.co/api/models/kyutai/tts-voices/tree/main?recursive=true";
}

// Only these are real, Pocket-TTS-resolvable voice sources - excludes
// the repo's own .py/.md/.gitattributes/.gitignore housekeeping files.
const VOICE_FILE_EXTENSIONS = new Set(["wav", "mp3", "safetensors"]);

export interface VoiceCatalogEntry {
  /** The path relative to the repo root, e.g. "vctk/p228_023_enhanced.wav" -
   * exactly what follows `hf://kyutai/tts-voices/` for Pocket TTS's own
   * `voice_url`. */
  path: string;
  /** The top-level collection this file belongs to (its first path
   * segment - "vctk", "expresso", etc.), for grouping in a browser UI. */
  collection: string;
}

interface HfTreeEntry {
  type: string;
  path: string;
}

function extensionOf(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? "" : path.slice(dot + 1).toLowerCase();
}

async function fetchOnePage(url: string): Promise<{ entries: HfTreeEntry[]; next: string | null }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} returned ${res.status}`);
  const entries = (await res.json()) as HfTreeEntry[];
  const link = res.headers.get("link") ?? res.headers.get("Link");
  const match = link ? /<([^>]+)>;\s*rel="next"/.exec(link) : null;
  return { entries, next: match ? match[1]! : null };
}

async function fetchFullCatalog(): Promise<VoiceCatalogEntry[]> {
  const result: VoiceCatalogEntry[] = [];
  let url: string | null = hfTreeUrl();
  // A hard page cap, not just trusting HF to eventually stop: an
  // unexpected pagination loop (a `next` link that never terminates)
  // would otherwise hang this fetch forever rather than failing loudly.
  // 2,069 real files paged 1000 at a time is 3 pages today; 50 is a
  // generous multiple of that, not a number this catalog is expected to
  // ever approach.
  for (let page = 0; url && page < 50; page++) {
    const { entries, next } = await fetchOnePage(url);
    for (const e of entries) {
      if (e.type !== "file") continue;
      const ext = extensionOf(e.path);
      if (!VOICE_FILE_EXTENSIONS.has(ext)) continue;
      result.push({ path: e.path, collection: e.path.split("/")[0] ?? e.path });
    }
    url = next;
  }
  return result;
}

interface CatalogCache {
  entries: VoiceCatalogEntry[];
  fetchedAt: number;
}

let cache: CatalogCache | null = null;
let fetching: Promise<VoiceCatalogEntry[]> | null = null;
// A household session's own cache, not a background refresh job: this
// list changes rarely (a fixed upstream dataset), so "refetch once per
// hour of active use" is already generous, the same "cache like a
// client" posture the org's third-party-service rules ask for.
const CACHE_TTL_MS = 60 * 60 * 1000;

/** The full catalog, fetched live on first use (or once the cache goes
 * stale) and shared by every concurrent caller in the meantime - the
 * same in-flight-promise-dedup shape llmSupervisor.ts's getChatClient()
 * and wakewordAssets.ts's ensureWakewordAssets() already use, so three
 * browser tabs opening the voice browser at once don't triple-fetch it. */
export async function getVoiceCatalog(): Promise<VoiceCatalogEntry[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.entries;
  if (!fetching) {
    fetching = fetchFullCatalog()
      .then((entries) => {
        cache = { entries, fetchedAt: Date.now() };
        return entries;
      })
      .finally(() => {
        fetching = null;
      });
  }
  return fetching;
}

/** True only once a live catalog fetch has actually succeeded once -
 * used to give a real 503 instead of a slow, request-blocking fetch when
 * checking whether a specific path is real (routes/voice.ts's select
 * endpoint always calls getVoiceCatalog() itself first, so this is only
 * ever read after that). */
export function isVoiceCatalogPath(entries: VoiceCatalogEntry[], path: string): boolean {
  return entries.some((e) => e.path === path);
}

/** Test-only: the cache and in-flight fetch are module state. */
export function __resetVoiceCatalogForTests(): void {
  cache = null;
  fetching = null;
}
