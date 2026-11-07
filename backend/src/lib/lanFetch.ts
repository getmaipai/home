// AUDIT-DUP-NET-01: this is a LAN-only fetch (private addresses are the point), so it is not the public-internet path in `lib/outbound.ts` (`guardedGet`).
export type LanFetchFailure = { ok: false; kind: "unreachable" | "refused" | "timeout" };
export type LanFetchSuccess = { ok: true; status: number; text: string; truncated: boolean };
export type LanFetchResult = LanFetchSuccess | LanFetchFailure;

export type LanFetchInit = {
  method?: "GET" | "POST" | "DELETE";
  headers?: Record<string, string> | [string, string][];
  body?: string | Uint8Array | null;
};

export type LanFetchOptions = { timeoutMs?: number; maxBytes?: number };
export type LanFetchDeps = { fetch?: (input: string, init: RequestInit) => Promise<Response> } & LanFetchOptions;

const BAD_ADDRESS = "This address is not on your home network. Use the device's local address, for example 192.0.2.10.";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 1024 * 1024;
const DROPPED_HEADERS = new Set(["host", "content-length", "connection", "transfer-encoding", "upgrade", "te", "keep-alive", "expect"]);
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

// The caller picks credentials and content type, never the target: framing and routing headers are dropped.
function safeHeaders(headers: LanFetchInit["headers"]): Headers {
  const out = new Headers();
  const pairs = Array.isArray(headers) ? headers : Object.entries(headers ?? {});
  for (const [name, value] of pairs) {
    const lower = name.toLowerCase();
    if (DROPPED_HEADERS.has(lower) || lower.startsWith("proxy-")) continue;
    out.set(name, value);
  }
  return out;
}

function isAllowedAddress(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some(part => !/^(0|[1-9]\d{0,2})$/.test(part) || Number(part) > 255)) return false;
  const [a, b] = parts.map(Number);
  if (a === undefined || b === undefined) return false;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/** `allowDelete` (default false) lets this connection send DELETE; only a caller that removes things it made on that host (the automation client) passes true. */
export function createLanFetch(allowed: { host: string; port: number; allowDelete?: boolean }, deps: LanFetchDeps = {}) {
  if (!isAllowedAddress(allowed.host) || !Number.isInteger(allowed.port) || allowed.port < 1 || allowed.port > 65535) {
    throw new Error(BAD_ADDRESS);
  }
  const fetcher = deps.fetch ?? globalThis.fetch;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = deps.maxBytes ?? DEFAULT_MAX_BYTES;

  return async function lanFetch(path: string, init: LanFetchInit = {}): Promise<LanFetchResult> {
    if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//") || path.includes("@") || /^[a-z][a-z\d+.-]*:/i.test(path)) {
      return { ok: false, kind: "refused" };
    }
    const method = init.method ?? "GET";
    // DELETE is off unless the connection was made with allowDelete (SCHED-02 removes an automation Home made); callers choose the path, never the host.
    if (method !== "GET" && method !== "POST" && !(method === "DELETE" && allowed.allowDelete === true)) return { ok: false, kind: "refused" };
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    try {
      const response = await fetcher(`http://${allowed.host}:${allowed.port}${path}`, {
        method, headers: safeHeaders(init.headers), body: method === "POST" ? init.body : undefined,
        redirect: "manual", signal: controller.signal, proxy: "",
      } as RequestInit);
      if (REDIRECTS.has(response.status)) return { ok: false, kind: "refused" };
      if (!response.body) return { ok: true, status: response.status, text: "", truncated: false };
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      let truncated = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const remaining = maxBytes - size;
        if (value.byteLength > remaining) {
          if (remaining > 0) chunks.push(value.subarray(0, remaining));
          size += Math.max(remaining, 0);
          truncated = true;
          await reader.cancel();
          break;
        }
        chunks.push(value);
        size += value.byteLength;
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      return { ok: true, status: response.status, text: new TextDecoder().decode(bytes), truncated };
    } catch {
      return { ok: false, kind: timedOut ? "timeout" : "unreachable" };
    } finally {
      clearTimeout(timer);
    }
  };
}
