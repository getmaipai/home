// ROUTER-BUILD-01h: the Stack's real embedding model, for the search assist's
// identity check. The embed role's name ("embed") and the model name on its
// responses are role aliases, not a model; the model file the embed process
// is actually running is `identity.actual` on GET /stack/v1/roles. The weights
// manifest names that file without its extension.
import { getStackClient } from "@/lib/stackEngine";

const TTL_MS = 60_000;
const ROLES_TIMEOUT_MS = 1500;

const UNKNOWN_RETRY_MS = 10_000;
let cache: { at: number; model: string | null } | null = null;
let reader: (() => Promise<string | null>) | null = null;

/** "nomic-embed-text-v1.5.Q4_K_M.gguf" -> "nomic-embed-text-v1.5.Q4_K_M". */
export function embedModelFromFile(file: string): string | null {
  const name = file.replace(/\.gguf$/i, "").trim();
  return name === "" ? null : name;
}

async function readFromStack(): Promise<string | null> {
  const res = await getStackClient().roles({ signal: AbortSignal.timeout(ROLES_TIMEOUT_MS) });
  const actual = res.roles.find((r) => r.id === "embed")?.identity?.actual;
  return typeof actual === "string" ? embedModelFromFile(actual) : null;
}

/** The model the Stack's embed role is running, or null when it cannot be
 * told (Stack unreachable or an older Stack). Never throws. */
export async function stackEmbedModel(): Promise<string | null> {
  // An unknown answer is remembered briefly so a down or older Stack costs one lookup per 10 s, not one per turn.
  if (cache && Date.now() - cache.at < (cache.model ? TTL_MS : UNKNOWN_RETRY_MS)) return cache.model;
  try {
    const model = await (reader ?? readFromStack)();
    cache = { at: Date.now(), model };
    return model;
  } catch {
    cache = { at: Date.now(), model: null };
    return null;
  }
}

export function __setStackEmbedModelReaderForTests(fn: (() => Promise<string | null>) | null): void {
  reader = fn;
  cache = null;
}
