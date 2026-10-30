import { connect } from "node:net";
import { homedir } from "node:os";

/** MEM-SPACE-09/03: the one reader of running apps is the Mac app helper (native/app-helper). This only asks it to list; closing and reopening belong to the live-fit step. */
export interface HelperApp { bundleId: string; name: string; bytes: number; frontmost: boolean }
export type HelperListing = { installed: false; apps: [] } | { installed: true; apps: HelperApp[] };

export const helperSocketPath = () => process.env.MAIPAI_APP_HELPER_SOCKET ?? `${homedir()}/Library/Application Support/MaiPai/app-helper.sock`;

/** Asks the helper for the running apps. Anything that stops the helper answering (no socket, a refusal, a slow reply) reads as "not installed", so the page falls back to the Stack reading. App names are returned to the caller and never stored or logged. */
export function listHelperApps(path = helperSocketPath(), timeoutMs = 2000): Promise<HelperListing> {
  return new Promise((resolve) => {
    let done = false;
    let buffer = "";
    const socket = connect(path);
    const finish = (value: HelperListing) => { if (done) return; done = true; clearTimeout(timer); socket.destroy(); resolve(value); };
    const timer = setTimeout(() => finish({ installed: false, apps: [] }), timeoutMs);
    socket.on("connect", () => socket.write(`${JSON.stringify({ op: "list" })}\n`));
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const end = buffer.indexOf("\n");
      if (end < 0) return;
      try {
        const reply = JSON.parse(buffer.slice(0, end)) as { ok?: boolean; apps?: unknown };
        if (reply.ok !== true || !Array.isArray(reply.apps)) return finish({ installed: false, apps: [] });
        const apps = reply.apps.flatMap((raw): HelperApp[] => {
          const a = raw as Partial<HelperApp>;
          return typeof a.bundleId === "string" && typeof a.name === "string" ? [{ bundleId: a.bundleId, name: a.name, bytes: Number(a.bytes) || 0, frontmost: a.frontmost === true }] : [];
        });
        finish({ installed: true, apps });
      } catch { finish({ installed: false, apps: [] }); }
    });
    socket.on("error", () => finish({ installed: false, apps: [] }));
    socket.on("close", () => finish({ installed: false, apps: [] }));
  });
}

/** Sends one request to the helper and returns its reply object, or null when nothing answered in time. */
export function askHelper(request: Record<string, unknown>, path = helperSocketPath(), timeoutMs = 2000): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    let done = false;
    let buffer = "";
    const socket = connect(path);
    const finish = (value: Record<string, unknown> | null) => { if (done) return; done = true; clearTimeout(timer); socket.destroy(); resolve(value); };
    const timer = setTimeout(() => finish(null), timeoutMs);
    socket.on("connect", () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const end = buffer.indexOf("\n");
      if (end < 0) return;
      try { finish(JSON.parse(buffer.slice(0, end)) as Record<string, unknown>); } catch { finish(null); }
    });
    socket.on("error", () => finish(null));
    socket.on("close", () => finish(null));
  });
}
