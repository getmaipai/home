// CODE-APP-01: the Code app's calls to /api/code/sessions (backend/src/routes/codingSessions.ts). Thin: every rule lives on the hub.
import { request } from "@/lib/api";

export type CodeTier = "standard" | "boost" | "max";
export type CodeState = "queued" | "starting" | "working" | "needs_you" | "idle" | "paused" | "done" | "failed" | "archived";

export interface CodeSession {
  id: string;
  title: string;
  repo: { kind: "github" | "gitea" | "hub_folder" | "none"; full_name?: string; base_branch: string; work_branch: string };
  mode: "plan" | "ask" | "auto_edit";
  state: CodeState;
  tier?: CodeTier;
  changes: { files: number; additions: number; deletions: number };
  pull_request?: { url: string; number: number; draft: boolean } | null;
  checkpoints?: { id: string; at: string; label: string; files: number }[];
  last_activity_at: string;
}

export interface CodeView {
  session: CodeSession;
  waiting: { turn_id: string; line: string | null; offers_standard: boolean } | null;
  requests: { request_id: string; effect: string }[];
  queued_messages: string[];
}

export type CodePart =
  | { type: "text"; text: string }
  | { type: "plan"; items: { text: string; done: boolean }[] }
  | { type: "tool"; tool: "command" | "file_write" | "read" | "fetch"; status: "running" | "done" | "failed"; summary: string; exit_code?: number }
  | { type: "approval"; request_id: string; effect: string; status: "pending" | "allowed" | "denied" }
  | { type: "stopped"; reason: "user" | "wall_clock" | "error" | "denied" }
  | { type: "notice"; text: string };

export interface CodeMessage { id: string; seq: number; role: "user" | "agent" | "system"; parts: CodePart[]; created_at: string }

/** Environments and git connections have no picker yet; a session starts in the household's default environment with no repository. */
export const DEFAULT_ENVIRONMENT_ID = "cenv-default";

const base = "/api/code/sessions";
const json = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

export const codeApi = {
  list: () => request<CodeSession[]>(base),
  tiers: () => request<{ tiers: CodeTier[]; last: CodeTier }>(`${base}/tiers`),
  view: (id: string) => request<CodeView>(`${base}/${id}`),
  messages: (id: string) => request<CodeMessage[]>(`${base}/${id}/messages`),
  create: (title: string, tier: CodeTier) => request<CodeSession>(base, json({ title, tier, repo: { kind: "none", base_branch: "main", work_branch: "code/session" }, environment_id: DEFAULT_ENVIRONMENT_ID })),
  send: (id: string, text: string) => request<{ turn_id?: string; queued_message_id?: string }>(`${base}/${id}/messages`, json({ text })),
  setTier: (id: string, tier: CodeTier) => request<CodeSession>(`${base}/${id}/tier`, { method: "PUT", body: JSON.stringify({ tier }) }),
  stop: (id: string) => request<{ ok: true }>(`${base}/${id}/stop`, json({})),
  answer: (id: string, requestId: string, answer: "allow" | "deny") => request<{ ok: true }>(`${base}/${id}/requests/${requestId}`, json({ answer })),
  useStandard: (id: string, turn: string) => request<{ ok: true }>(`${base}/${id}/turns/${turn}/use-standard`, json({})),
  cancelQueued: (id: string, messageId: string) => request<{ ok: true }>(`${base}/${id}/queue/${messageId}`, { method: "DELETE" }),
  push: (id: string) => request<{ ok: true }>(`${base}/${id}/push`, json({ confirm: true })),
  pullRequest: (id: string) => request<{ url: string; number: number; draft: boolean }>(`${base}/${id}/pull-request`, json({ confirm: true })),
  undo: (id: string, checkpointId: string) => request<{ ok: true }>(`${base}/${id}/undo`, json({ checkpoint_id: checkpointId })),
};
