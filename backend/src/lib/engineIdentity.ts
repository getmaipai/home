// ENGINE-HOST-01: what an engine is, read from the engine itself, for
// the [turn] line, the bench header and the health page. A supervisor's
// URL tier (MAIPAI_LLAMA_SERVER_URL, MAIPAI_BACKGROUND_URL,
// MAIPAI_EMBED_URL) spawns nothing; this is how it still says which
// engine answered: the build and the model file from llama-server's own
// /props, the health probe's answer, and the host as a label only. The
// host itself never appears in a log, a header or a doc (an engine on
// the household's LAN is the household's own machine; its address is
// not the repo's to print): a loopback URL reads "local", anything else
// "external". llama-server exposes no model hash on /props; the model is
// its file name, and the bench hashes the file only when it is local.

export type EngineHost = "local" | "external" | "stub";

export interface EngineIdentity {
  host: EngineHost;
  /** llama-server's build_info ("b10797-832fd6f17"), when /props answered. */
  build: string | null;
  /** The model file's name, never its directory. */
  model: string | null;
  /** The /health probe's answer at the time of reading; null when not probed. */
  healthy: boolean | null;
}

const LOOPBACK_RE = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\]|::1|0\.0\.0\.0)$/i;

/** "local" for a loopback URL, "external" for any other, never the host. */
export function hostLabel(url: string): "local" | "external" {
  try {
    return LOOPBACK_RE.test(new URL(url).hostname) ? "local" : "external";
  } catch {
    return "external";
  }
}

/** The URL as a log or a header may show it: a loopback URL as is, any
 * other reduced to its label. */
export function sanitizeEngineUrl(url: string | undefined): string {
  if (!url) return "n/a";
  return hostLabel(url) === "local" ? url : "external";
}

interface Props {
  build_info?: unknown;
  model_path?: unknown;
}

/** Reads /health and /props from an engine by URL, each bounded, never
 * throwing: an engine that answers neither reads as unhealthy with no
 * build and no model. */
/** The model file's own name from either separator: an engine on a
 * Windows machine reports `C:\\models\\x.gguf` (a review). */
export function modelFileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

export async function readEngineIdentity(url: string, timeoutMs = 3_000): Promise<EngineIdentity> {
  const base = url.replace(/\/$/, "");
  // Both reads at once (a review: a hung engine cost their sum).
  const [healthy, props] = await Promise.all([
    fetch(`${base}/health`, { signal: AbortSignal.timeout(timeoutMs) })
      .then(async (res) => res.ok && ((await res.json()) as { status?: string }).status === "ok")
      .catch(() => false),
    fetch(`${base}/props`, { signal: AbortSignal.timeout(timeoutMs) })
      .then(async (res) => (res.ok ? ((await res.json()) as Props) : {}))
      .catch((): Props => ({})), // a stub or an older build without /props: identity stays partial
  ]);
  const build = typeof props.build_info === "string" && props.build_info ? props.build_info : null;
  const model = typeof props.model_path === "string" && props.model_path ? modelFileName(props.model_path) : null;
  return { host: hostLabel(url), build, model, healthy };
}

/** One short string for a log line: "external b10797-832fd6f17
 * qwen3-8b-instruct-q4-k-m.gguf", "local qwen3-8b", "stub". Health is
 * the probe's to report at the time asked, never this string's (a
 * review: a reading taken while the engine loaded would have said
 * "unhealthy" on every turn after). */
export function formatEngineIdentity(identity: EngineIdentity | null | undefined): string {
  if (!identity) return "none";
  return [identity.host, identity.build, identity.model].filter((p): p is string => !!p).join(" ");
}

/** Whether a reading is worth taking again: the engine answered neither
 * probe (it was loading, or down) and may be up now. */
export function identityIncomplete(identity: EngineIdentity): boolean {
  return identity.build === null && identity.model === null;
}
