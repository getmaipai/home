// CODE-SANDBOX-01 (Home side): the client for the Stack's sandbox service, /stack/v1/sandboxes. Home asks, the Stack owns the machines. It uses the one Stack
// client (loopback only, Home's token, caller header; lib/stack/client.ts `sandboxCall`), so the pinned Stack is the only door.
//
// What the Stack serves today (read from its routes/sandboxes.ts): create, list, get, stop, delete, one machine per session id on a host-only network with no
// resolver, a start that fails when the network lock does not load, and network policy `none` only. EXEC AND SNAPSHOT ARE NOT SERVED YET: `exec`, `snapshot` and
// `restoreCheckpoint` here speak a proposed contract (below) that the Stack slice must add. A Stack that answers 404 or 405 for them gives a plain "not
// available" error and nothing runs. Fail closed everywhere: a start that is not clearly `running` behind its lock is an error, never a guess.
//   POST /stack/v1/sandboxes/{id}/exec        {argv, cwd?, env?}                   -> 200 application/x-ndjson: {"stream":"stdout"|"stderr","text":"..."} lines, then {"exit":N}
//   POST /stack/v1/sandboxes/{id}/snapshots   {label}                              -> 201 {id, files}
//   POST /stack/v1/sandboxes/{id}/snapshots/{snapshot}/restore                     -> 200 {ok:true}
// Rule 6a: errors and logs name ids and reason codes; the Stack's own sentence (plain words, no paths) is passed through to the person.
import { mkdir } from "node:fs/promises";
import { StackError } from "@/lib/stack/errors";
import type { StackClient } from "@/lib/stack/client";
import { appendLogLine } from "@/lib/log";
import { sandboxGatewayUrl } from "@/lib/codingGatewayAddress";
import { codingWorkspace } from "@/lib/codingShare";
import { db } from "@/db";
import { codingSessions } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import type { CodingSandbox } from "@/lib/codingTurns";

export type SandboxFailure = "unavailable" | "lock_not_ready" | "bad_request" | "feature_missing" | "failed";
export class SandboxClientError extends Error {
  constructor(readonly reason: SandboxFailure, message: string) { super(message); this.name = "SandboxClientError"; }
}
export type ExecChunk = { stream: "stdout" | "stderr"; text: string } | { exit: number };
export interface ExecInput { sessionId: string; argv: string[]; cwd?: string; env?: Record<string, string>; signal: AbortSignal }
/** The sandbox the OpenCode driver needs: the interface of lib/codingTurns.ts plus exec and snapshot. */
export interface ExecSandbox extends CodingSandbox {
  exec(input: ExecInput): AsyncIterable<ExecChunk>;
  snapshot(input: { sessionId: string; label: string }): Promise<{ id: string; files: number }>;
}

/** The Stack's sandbox id for a session. The session id already fits the Stack's pattern (lowercase letters, digits, dashes, 6 to 40 long). */
/** Home's own gateway port, sent at create so the Stack's network lock lets the machine reach /code/v1 with no per-machine STACK_SANDBOX_ALLOWED_PORTS. */
export function gatewayPortBody(url: string = sandboxGatewayUrl()): { gateway_ports?: number[] } {
  try { const port = Number(new URL(url).port); return Number.isInteger(port) && port > 0 && port < 65536 ? { gateway_ports: [port] } : {}; } catch { return {}; }
}
export const sandboxIdOf = (sessionId: string): string => sessionId;
const base = (id: string) => `/stack/v1/sandboxes/${encodeURIComponent(id)}`;

async function readError(res: { body: ReadableStream<Uint8Array> | null }): Promise<string> {
  try { const text = await new Response(res.body).text(); const parsed = JSON.parse(text) as { error?: unknown }; return typeof parsed.error === "string" ? parsed.error : ""; } catch { return ""; }
}

export function createStackSandbox(getClient: () => Pick<StackClient, "sandboxCall">): ExecSandbox {
  const call = async (method: "GET" | "POST" | "DELETE", path: string, body?: unknown, signal?: AbortSignal) => {
    const client = getClient();
    if (!client.sandboxCall) throw new SandboxClientError("unavailable", "The coding sandbox is not available on this engine yet. Update the engine, then try again.");
    try { return await client.sandboxCall(method, path, body, { signal }); }
    catch (e) {
      if (e instanceof StackError && (e.kind === "offline" || e.kind === "unreachable" || e.kind === "timeout")) throw new SandboxClientError("unavailable", "Home could not reach the engine that runs coding sandboxes. Check that the engine is running, then try again.");
      throw e;
    }
  };
  /** Maps a non-2xx reply to a typed error with the Stack's own plain sentence. */
  const refuse = async (res: Awaited<ReturnType<typeof call>>, what: string): Promise<never> => {
    const said = await readError(res);
    if (res.status === 404 || res.status === 405) throw new SandboxClientError(what === "exec" || what === "snapshot" || what === "restore" ? "feature_missing" : "failed", said || `The engine does not support ${what} yet. Update the engine, then try again.`);
    if (res.status === 400) throw new SandboxClientError("bad_request", said || "The engine refused the sandbox request.");
    if (res.status === 503) throw new SandboxClientError("unavailable", said || "The sandbox system is not running. Start it from the engine's page, then try again.");
    // 500 on create: the machine did not start or its network lock did not load. Nothing ran in it; fail closed.
    throw new SandboxClientError(res.status === 500 ? "lock_not_ready" : "failed", said || "The sandbox failed. Try again; if it repeats, check the engine's log.");
  };

  return {
    async start({ sessionId, environmentId }) {
      void environmentId; // The environment's setup script is a later slice; the machine starts from the pinned image.
      const row = db_row(sessionId);
      if (row.network.policy !== "none") throw new SandboxClientError("bad_request", "Allowing hosts is not available in Code sessions yet. Start the session with no network.");
      const id = sandboxIdOf(sessionId);
      const existing = await call("GET", base(id));
      if (existing.status === 200) {
        const info = await new Response(existing.body).json() as { state?: string };
        if (info.state === "running") return;
        // The Stack has no "start" for a stopped machine: remove it and make a fresh one on the same workspace folder (background processes do not survive, by design).
        const gone = await call("DELETE", base(id)); if (!gone.status.toString().startsWith("2")) await refuse(gone, "delete");
        await gone.body?.cancel().catch(() => undefined);
      } else if (existing.status !== 404) await refuse(existing, "get");
      else await existing.body?.cancel().catch(() => undefined);
      const workspace = codingWorkspace(row.personId, sessionId);
      await mkdir(workspace, { recursive: true });
      const created = await call("POST", "/stack/v1/sandboxes", { id, workspace, network: { policy: "none", hosts: [] }, ...gatewayPortBody() });
      if (created.status !== 201) await refuse(created, "create");
      const info = await new Response(created.body).json() as { state?: string };
      if (info.state !== "running") throw new SandboxClientError("lock_not_ready", "The sandbox did not report that it is running behind its network lock, so nothing was started. Try again.");
      appendLogLine(`coding sandbox_started session=${sessionId}`);
    },
    async stop(sessionId) { const res = await call("POST", `${base(sandboxIdOf(sessionId))}/stop`); if (res.status !== 200 && res.status !== 404) await refuse(res, "stop"); await res.body?.cancel().catch(() => undefined); },
    async destroy(sessionId) { const res = await call("DELETE", base(sandboxIdOf(sessionId))); if (res.status !== 200 && res.status !== 404) await refuse(res, "delete"); await res.body?.cancel().catch(() => undefined); },
    async *exec(input) {
      const res = await call("POST", `${base(sandboxIdOf(input.sessionId))}/exec`, { argv: input.argv, ...(input.cwd ? { cwd: input.cwd } : {}), ...(input.env ? { env: input.env } : {}) }, input.signal);
      if (res.status !== 200 || !res.body) return await refuse(res, "exec");
      const reader = res.body.getReader(); const decoder = new TextDecoder(); let buffer = ""; let exited = false;
      // Stop kills the exec: the caller's signal aborts the request, which ends the Stack's process, and the reader is released here.
      const onAbort = () => { void reader.cancel().catch(() => undefined); };
      input.signal.addEventListener("abort", onAbort, { once: true });
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let at: number;
          while ((at = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, at).trim(); buffer = buffer.slice(at + 1);
            if (!line) continue;
            let parsed: unknown; try { parsed = JSON.parse(line); } catch { continue; }
            const o = parsed as { stream?: unknown; text?: unknown; exit?: unknown };
            if (typeof o.exit === "number") { exited = true; yield { exit: o.exit }; }
            else if ((o.stream === "stdout" || o.stream === "stderr") && typeof o.text === "string") yield { stream: o.stream, text: o.text };
          }
        }
        if (!exited && !input.signal.aborted) throw new SandboxClientError("failed", "The sandbox command ended without an exit code. Try the message again.");
      } finally { input.signal.removeEventListener("abort", onAbort); await reader.cancel().catch(() => undefined); }
    },
    async snapshot({ sessionId, label }) {
      const res = await call("POST", `${base(sandboxIdOf(sessionId))}/snapshots`, { label });
      if (res.status !== 201) return await refuse(res, "snapshot");
      const body = await new Response(res.body).json() as { id?: unknown; files?: unknown };
      if (typeof body.id !== "string" || !/^[A-Za-z0-9_.-]{1,80}$/.test(body.id)) throw new SandboxClientError("failed", "The sandbox returned a snapshot Home cannot use. Try again.");
      return { id: body.id, files: typeof body.files === "number" && body.files >= 0 ? Math.floor(body.files) : 0 };
    },
    async restoreCheckpoint({ sessionId, checkpointId }) {
      const res = await call("POST", `${base(sandboxIdOf(sessionId))}/snapshots/${encodeURIComponent(checkpointId)}/restore`);
      if (res.status !== 200) await refuse(res, "restore");
      await res.body?.cancel().catch(() => undefined);
    },
  };
}

function db_row(sessionId: string): { personId: string; network: { policy: "none" | "hosts"; hosts: string[] } } {
  // The sandbox seam receives only a session id, so the owner is read from the record (deleted sessions have none: nothing starts for them).
  const row = sessionRowById(sessionId);
  if (!row) throw new SandboxClientError("bad_request", "That session no longer exists, so no sandbox was started.");
  return { personId: row.personId, network: row.network };
}
const sessionRowById = (id: string) => db.select().from(codingSessions).where(and(eq(codingSessions.id, id), isNull(codingSessions.deletedAt))).get();
