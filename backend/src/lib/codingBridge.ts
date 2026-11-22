// CODE-AGENT-01 (slice two): the bridge between the agent's events and Home. The real OpenCode process and the sandbox call stay behind the
// `CodingAgent` interface (lib/codingTurns.ts); this file is everything Home does with what the agent reports:
//   - events become message parts in the transcript (redacted on the way in) and lines of the person's audit trail (lib/codingEvents.ts);
//   - every action the agent wants to take passes the tool brake (CODE-BRAKE-01: effect class, then do, ask or never) and an "ask" is a held host request
//     the person answers (there is no second ask flow: it is the brake's own ask, shown as the approval card);
//   - a session that has read content from outside the house is tainted, which only ever makes the brake stricter.
// Rule 6a: household log lines written here carry ids, counts and reason codes only; the text, command, path and host stay in the person's own records.
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people } from "@/db/schema";
import { audienceBand } from "@/lib/audience";
import { brakeFor, type BrakeMode, type CodeEffect } from "@/lib/toolBrake";
import { appendLogLine } from "@/lib/log";
import { newCodingRequestId } from "@/lib/id";
import { appendCodingMessage, replaceCodingMessageParts, type CodingPart } from "@/lib/codingTranscript";
import { recordCodingEvent } from "@/lib/codingEvents";
import { CodingSessionError, getSessionRow, requireCodingAccess, updateSession } from "@/lib/codingSessions";
import type { PersonRow } from "@/types";

/** What the agent reports while it works. The OpenCode adapter (later) maps its own event stream onto these. */
export type AgentEvent =
  | { kind: "text"; text: string }
  | { kind: "plan"; items: { text: string; done: boolean }[] }
  | { kind: "command"; command: string; exit_code: number; duration_ms: number }
  | { kind: "file_write"; path: string }
  | { kind: "external_read" }
  | { kind: "checkpoint"; id: string; label: string; files: number };

/** One thing the agent asks to do. `detail` is what the approval card names; it stays in the person's own records. */
export interface PermissionRequest { effect: CodeEffect; detail?: { host?: string; branch?: string; path?: string; command?: string } }
export type PermissionAnswer = "allow" | "deny";
/** What the bridge gives the agent for one turn. */
export interface CodingHost { emit(event: AgentEvent): void; permit(request: PermissionRequest): Promise<PermissionAnswer> }

interface Pending { requestId: string; sessionId: string; personId: string; effect: CodeEffect; detail: PermissionRequest["detail"]; messageId: string; parts: CodingPart[]; resolve: (a: PermissionAnswer) => void }
const pending = new Map<string, Pending>();
const tainted = new Set<string>();

/** Session mode to the brake's mode: plan never writes, ask asks, auto_edit does (reads always run; push, host and pull request always ask). */
const brakeModeOf = (mode: string): BrakeMode => (mode === "auto_edit" ? "do" : mode === "plan" ? "never" : "ask");

export const isSessionTainted = (sessionId: string): boolean => tainted.has(sessionId);
export function markSessionTainted(sessionId: string): void { tainted.add(sessionId); }
/** A repository from a git host is content from outside the house: its text is data, never instructions, and the session starts tainted. */
export function startTaint(sessionId: string, repoKind: string): void { if (repoKind === "github" || repoKind === "gitea") tainted.add(sessionId); }

/** Held host requests for a session, for the approval card. Ids and the effect class only. */
export function pendingRequestsFor(personId: string, sessionId: string): { request_id: string; effect: CodeEffect }[] {
  return [...pending.values()].filter((p) => p.personId === personId && p.sessionId === sessionId).map((p) => ({ request_id: p.requestId, effect: p.effect }));
}

function settleRequest(p: Pending, answer: PermissionAnswer): void {
  pending.delete(p.requestId);
  const status = answer === "allow" ? "allowed" : "denied";
  replaceCodingMessageParts(p.personId, p.messageId, p.parts.map((part) => (part.type === "approval" && part.request_id === p.requestId ? { ...part, status } : part)));
  recordCodingEvent({ sessionId: p.sessionId, personId: p.personId, kind: "approval", detail: { what: p.effect, answer } });
  if (p.effect === "host_new" && p.detail?.host) recordCodingEvent({ sessionId: p.sessionId, personId: p.personId, kind: answer === "allow" ? "host_allowed" : "host_blocked", detail: { host: p.detail.host } });
  if (getSessionRow(p.personId, p.sessionId)?.state === "needs_you") updateSession(p.sessionId, { state: "working" });
  appendLogLine(`coding request_${status} request=${p.requestId} session=${p.sessionId} effect=${p.effect}`);
  p.resolve(answer);
}

/** The person answers a held request (their click). Only the owner of the session can. */
export function answerHostRequest(person: PersonRow, sessionId: string, requestId: string, answer: PermissionAnswer): void {
  requireCodingAccess(person);
  const p = pending.get(requestId);
  if (!p || p.sessionId !== sessionId || p.personId !== person.id) throw new CodingSessionError("not_found", "That request is no longer waiting. It may have been answered or the session stopped.");
  settleRequest(p, answer);
}
/** Stop or delete: every held request of the session is denied, so the agent's wait ends. */
export function denyPendingFor(sessionId: string): number {
  const mine = [...pending.values()].filter((p) => p.sessionId === sessionId);
  for (const p of mine) settleRequest(p, "deny");
  return mine.length;
}

/** The host object for one turn. `signal` ends any wait: an aborted turn denies what it was waiting for. */
export function createTurnHost(input: { sessionId: string; personId: string; signal: AbortSignal }): CodingHost {
  const { sessionId, personId, signal } = input;
  let messageId: string | null = null;
  const parts: CodingPart[] = [];
  const flush = (): void => {
    if (!messageId) messageId = appendCodingMessage({ sessionId, personId, role: "agent", parts }).id;
    else replaceCodingMessageParts(personId, messageId, parts);
  };
  const write = (part: CodingPart, replaceLast = false): void => { if (replaceLast) parts.splice(-1, 1, part); else parts.push(part); flush(); };
  const owner = (): PersonRow | undefined => db.select().from(people).where(eq(people.id, personId)).get() as PersonRow | undefined;

  return {
    emit(event) {
      switch (event.kind) {
        case "text": {
          const last = parts[parts.length - 1];
          if (last?.type === "text") write({ type: "text", text: last.text + event.text }, true); else write({ type: "text", text: event.text });
          return;
        }
        case "plan": {
          const at = parts.findIndex((p) => p.type === "plan");
          if (at >= 0) { parts[at] = { type: "plan", items: event.items }; flush(); }
          else write({ type: "plan", items: event.items });
          return;
        }
        case "command":
          write({ type: "tool", tool: "command", status: event.exit_code === 0 ? "done" : "failed", summary: event.command, exit_code: event.exit_code });
          recordCodingEvent({ sessionId, personId, kind: "command", detail: { command: event.command, exit_code: event.exit_code, duration_ms: event.duration_ms } });
          return;
        case "file_write":
          write({ type: "tool", tool: "file_write", status: "done", summary: event.path });
          recordCodingEvent({ sessionId, personId, kind: "file_write", detail: { path: event.path } });
          return;
        case "external_read":
          tainted.add(sessionId);
          return;
        case "checkpoint":
          // The checkpoint store is a later slice; the transcript shows a notice with the label.
          write({ type: "notice", text: `Checkpoint: ${event.label}` });
          return;
      }
    },
    async permit(request) {
      const person = owner(); const session = getSessionRow(personId, sessionId);
      if (!person || !session || signal.aborted) return "deny";
      const verdict = brakeFor({ tool: "code", action: request.effect, args: {}, actor: { id: person.id, role: person.role, band: audienceBand(person) }, tainted: tainted.has(sessionId), mode: brakeModeOf(session.mode) });
      appendLogLine(`coding brake session=${sessionId} effect=${request.effect} decision=${verdict.decision} reason=${verdict.reason ?? "none"}`);
      if (verdict.decision === "do") return "allow";
      if (verdict.decision === "never") {
        if (request.effect === "host_new" && request.detail?.host) recordCodingEvent({ sessionId, personId, kind: "host_blocked", detail: { host: request.detail.host } });
        return "deny";
      }
      // ask: a held host request. The approval card is the transcript part; the session reads "needs you" until the person answers.
      const requestId = newCodingRequestId();
      write({ type: "approval", request_id: requestId, effect: request.effect, status: "pending" });
      updateSession(sessionId, { state: "needs_you" });
      return await new Promise<PermissionAnswer>((resolve) => {
        const held: Pending = { requestId, sessionId, personId, effect: request.effect, detail: request.detail, messageId: messageId!, parts, resolve };
        pending.set(requestId, held);
        signal.addEventListener("abort", () => { if (pending.has(requestId)) settleRequest(held, "deny"); }, { once: true });
      });
    },
  };
}

/** Test and shutdown helper. */
export function __resetBridgeForTests(): void { pending.clear(); tainted.clear(); }
