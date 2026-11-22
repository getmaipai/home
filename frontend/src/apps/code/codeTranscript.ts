// CODE-APP-01: what the session view's tabs show, read from the transcript the hub already sends (no second source). Pure, so it is tested alone.
import { i18n } from "@lingui/core";
import type { FileTreeNode } from "@maipai/ui/src/elements/file-tree";
import type { DiffLine } from "@maipai/ui/src/elements/code-diff";
import type { CodeMessage, CodePart, CodeState } from "./codeApi";

export interface CommandRun { key: string; command: string; status: "running" | "done" | "failed"; exitCode: number; lines: string[]; truncated: boolean }

const CUT = "[earlier output cut]";
/** A command's stored output as terminal lines. */
export function outputLines(output: string | undefined): { lines: string[]; truncated: boolean } {
  if (!output) return { lines: [], truncated: false };
  const truncated = output.startsWith(CUT);
  return { lines: (truncated ? output.slice(CUT.length) : output).replace(/\n$/, "").split("\n").filter((l, i) => !(i === 0 && truncated && l === "")), truncated };
}

export interface SessionActivity {
  commands: CommandRun[];
  /** Files the agent wrote, newest write last, each once. */
  files: string[];
  /** The latest plan: its steps and how many are done. */
  plan: { steps: string[]; done: number } | null;
}

export function activityOf(messages: readonly CodeMessage[]): SessionActivity {
  const commands: CommandRun[] = [];
  const files: string[] = [];
  let plan: SessionActivity["plan"] = null;
  for (const message of messages) {
    message.parts.forEach((part, index) => {
      if (part.type === "tool" && part.tool === "command") commands.push({ key: `${message.id}:${index}`, command: part.summary, status: part.status, exitCode: part.exit_code ?? (part.status === "failed" ? 1 : 0), ...outputLines(part.output) });
      if (part.type === "tool" && part.tool === "file_write") { const at = files.indexOf(part.summary); if (at >= 0) files.splice(at, 1); files.push(part.summary); }
      if (part.type === "plan") plan = { steps: part.items.map((item) => item.text), done: part.items.filter((item) => item.done).length };
    });
  }
  return { commands, files, plan };
}

/** The Files tab's rows: folders then files, from the paths the agent wrote. */
export function fileTreeOf(paths: readonly string[]): FileTreeNode[] {
  const nodes: FileTreeNode[] = [];
  const seen = new Set<string>();
  for (const path of [...paths].sort()) {
    const parts = path.split("/").filter(Boolean);
    parts.forEach((name, depth) => {
      const at = parts.slice(0, depth + 1).join("/");
      if (seen.has(at)) return;
      seen.add(at);
      nodes.push({ path: at, name, depth, kind: depth === parts.length - 1 ? "file" : "folder" });
    });
  }
  return nodes;
}

export const stateWord = (state: CodeState): string => ({
  queued: i18n._({ id: "Waiting its turn", message: "Waiting its turn" }),
  starting: i18n._({ id: "Starting", message: "Starting" }),
  working: i18n._({ id: "Working", message: "Working" }),
  needs_you: i18n._({ id: "Needs you", message: "Needs you" }),
  idle: i18n._({ id: "Ready", message: "Ready" }),
  paused: i18n._({ id: "Paused", message: "Paused" }),
  done: i18n._({ id: "Done", message: "Done" }),
  failed: i18n._({ id: "The agent stopped", message: "The agent stopped" }),
  archived: i18n._({ id: "Archived", message: "Archived" }),
})[state];

/** A session the agent is on right now (poll fast) or waits on you. */
export const isBusy = (state: CodeState): boolean => state === "queued" || state === "starting" || state === "working" || state === "needs_you";

/** What a held request asks, in the words a person reads (the four actions only the person starts, design section 8). */
export function approvalWords(effect: string): { title: string; subtitle: string } {
  switch (effect) {
    case "push": return { title: i18n._({ id: "Push this branch?", message: "Push this branch?" }), subtitle: i18n._({ id: "The agent wants to send its work to your git host.", message: "The agent wants to send its work to your git host." }) };
    case "pull_request": return { title: i18n._({ id: "Open a pull request?", message: "Open a pull request?" }), subtitle: i18n._({ id: "The agent wants to open a pull request for its branch.", message: "The agent wants to open a pull request for its branch." }) };
    case "host_new": return { title: i18n._({ id: "Reach a new website?", message: "Reach a new website?" }), subtitle: i18n._({ id: "The agent wants to open a connection to a site it has not used in this session.", message: "The agent wants to open a connection to a site it has not used in this session." }) };
    case "delete_session": return { title: i18n._({ id: "Delete this session?", message: "Delete this session?" }), subtitle: i18n._({ id: "The agent wants to delete this session.", message: "The agent wants to delete this session." }) };
    case "command": return { title: i18n._({ id: "Run a command?", message: "Run a command?" }), subtitle: i18n._({ id: "The agent wants to run a command in its workspace.", message: "The agent wants to run a command in its workspace." }) };
    case "file_write": return { title: i18n._({ id: "Change a file?", message: "Change a file?" }), subtitle: i18n._({ id: "The agent wants to write to a file in its workspace.", message: "The agent wants to write to a file in its workspace." }) };
    default: return { title: i18n._({ id: "The agent is asking first", message: "The agent is asking first" }), subtitle: i18n._({ id: "It will wait until you answer.", message: "It will wait until you answer." }) };
  }
}

export const tierWord = (tier: string): string => tier === "max" ? i18n._({ id: "Max", message: "Max" }) : tier === "boost" ? i18n._({ id: "Boost", message: "Boost" }) : i18n._({ id: "Standard", message: "Standard" });

export type { CodePart };

/** A unified diff split per file into the kit diff's lines (hunk headers become the line numbers, not rows). */
export function parseDiff(diff: string): Record<string, DiffLine[]> {
  const files: Record<string, DiffLine[]> = {};
  let current: DiffLine[] | null = null; let oldAt = 0; let newAt = 0; let inHunk = false;
  for (const row of diff.split("\n")) {
    const head = /^diff --git a\/.* b\/(.*)$/.exec(row);
    if (head) { current = files[head[1]!] = []; inHunk = false; continue; }
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(row);
    if (hunk) { oldAt = Number(hunk[1]); newAt = Number(hunk[2]); inHunk = true; continue; }
    if (!current || !inHunk) continue;
    if (row.startsWith("+")) current.push({ kind: "added", text: row.slice(1), line: newAt++ });
    else if (row.startsWith("-")) current.push({ kind: "removed", text: row.slice(1), line: oldAt++ });
    else if (row.startsWith(" ")) { current.push({ kind: "context", text: row.slice(1), line: newAt }); oldAt++; newAt++; }
  }
  return files;
}

const LANGS: Record<string, string> = { ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx", json: "json", py: "python", md: "markdown", css: "css", html: "html", sh: "bash", rs: "rust", go: "go", yml: "yaml", yaml: "yaml" };
export const languageOf = (path: string): string => LANGS[path.split(".").pop()?.toLowerCase() ?? ""] ?? "text";

/** What the agent is doing right now, in plain words, for the live line under the transcript. */
export function stageOf(state: CodeState, waitingLine: string | null | undefined, messages: readonly CodeMessage[]): string {
  if (state === "queued") return waitingLine ?? i18n._({ id: "Waiting in line", message: "Waiting in line" });
  if (state === "starting") return i18n._({ id: "Starting the sandbox", message: "Starting the sandbox" });
  if (state === "needs_you") return i18n._({ id: "Waiting for your answer", message: "Waiting for your answer" });
  // Only what the agent has done since the person's latest message counts.
  const lastUser = messages.map((m) => m.role).lastIndexOf("user");
  const last = [...messages.slice(lastUser + 1)].reverse().find((m) => m.role === "agent");
  const part = last?.parts[last.parts.length - 1];
  if (part?.type === "tool" && part.tool === "command") return i18n._({ id: "Running a command", message: "Running a command" });
  if (part?.type === "tool" && part.tool === "file_write") return i18n._({ id: "Writing a file", message: "Writing a file" });
  if (part?.type === "tool" && part.tool === "read") return i18n._({ id: "Reading the code", message: "Reading the code" });
  if (part?.type === "text") return i18n._({ id: "Writing the answer", message: "Writing the answer" });
  // Nothing from the agent yet: the workspace is ready and the model has not said a word.
  if (!last || !part) return i18n._({ id: "Waiting for the model's first words", message: "Waiting for the model's first words" });
  return i18n._({ id: "Thinking", message: "Thinking" });
}

/** "12 s" or "1 min 05 s". */
export function elapsedWords(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
}

/** The header's second line: a session with no repository says so plainly; one with a repository names it and its branch. No ids. */
export function repoLine(repo: { kind: string; full_name?: string; work_branch: string; path?: string }): string {
  if (repo.kind === "none") return i18n._({ id: "Scratch folder", message: "Scratch folder" });
  if (repo.kind === "hub_folder") return repo.path ? i18n._({ id: "Folder {path}", message: "Folder {path}", values: { path: repo.path } }) : i18n._({ id: "Home folder", message: "Home folder" });
  return `${repo.full_name ?? i18n._({ id: "Repository", message: "Repository" })} · ${repo.work_branch}`;
}

/** Why a turn stopped, in plain words with the next step. `code` is the reason code the hub kept (never error text); `reason` is the part's own kind. */
export function stopWords(reason: "user" | "wall_clock" | "error" | "denied", code?: string): string {
  if (reason === "user") return i18n._({ id: "You stopped this. Nothing more is running. Send a message to carry on.", message: "You stopped this. Nothing more is running. Send a message to carry on." });
  if (reason === "denied") return i18n._({ id: "Stopped because you said no. Send a message to carry on another way.", message: "Stopped because you said no. Send a message to carry on another way." });
  if (reason === "wall_clock") return i18n._({ id: "This step used up its time. Send a message to carry on, or break the task into smaller parts.", message: "This step used up its time. Send a message to carry on, or break the task into smaller parts." });
  const c = (code ?? "").toLowerCase();
  if (c === "feature_missing" || c.includes("old")) return i18n._({ id: "The coding engine is too old for this. Ask an admin to update it in Settings, then send your message again.", message: "The coding engine is too old for this. Ask an admin to update it in Settings, then send your message again." });
  if (c === "lock_not_ready" || c.includes("sandbox")) return i18n._({ id: "The sandbox is not ready yet. Wait a minute, then send your message again.", message: "The sandbox is not ready yet. Wait a minute, then send your message again." });
  if (c === "gateway_port_in_use") return i18n._({ id: "Another program is using the port the coding gateway needs (3100 unless changed). Ask an admin to close it or change the gateway port in Settings, Coding, then send your message again.", message: "Another program is using the port the coding gateway needs (3100 unless changed). Ask an admin to close it or change the gateway port in Settings, Coding, then send your message again." });
  if (c === "gateway_unreachable") return i18n._({ id: "The sandbox could not reach the coding gateway. Ask an admin to check Settings, Coding, then send your message again.", message: "The sandbox could not reach the coding gateway. Ask an admin to check Settings, Coding, then send your message again." });
  if (c === "agent_exit") return i18n._({ id: "The coding agent quit unexpectedly. Send your message again.", message: "The coding agent quit unexpectedly. Send your message again." });
  if (c === "unavailable" || c.includes("unreach")) return i18n._({ id: "Home could not reach the AI engine. Check that it is running, then send your message again.", message: "Home could not reach the AI engine. Check that it is running, then send your message again." });
  if (c.includes("model") || c.includes("load")) return i18n._({ id: "The coding model is not loaded. Give it a minute to start, then send your message again.", message: "The coding model is not loaded. Give it a minute to start, then send your message again." });
  if (c.includes("budget") || c.includes("quota") || c.includes("limit")) return i18n._({ id: "This session ran out of its budget. Start a new session to carry on.", message: "This session ran out of its budget. Start a new session to carry on." });
  if (c.includes("not_allowed") || c.includes("access") || c.includes("forbidden")) return i18n._({ id: "Your coding access changed, so this stopped. Ask an admin to check your Coding access in Settings.", message: "Your coding access changed, so this stopped. Ask an admin to check your Coding access in Settings." });
  return i18n._({ id: "The agent stopped because of a problem on this computer. Send your message again, or ask an admin to check Settings, Coding.", message: "The agent stopped because of a problem on this computer. Send your message again, or ask an admin to check Settings, Coding." });
}

/** How full the context is, as a fraction; null when the window is not known. */
export const contextFraction = (used: number, window: number | null): number | null => window && window > 0 ? Math.min(1, used / window) : null;
/** calm, then warning, then critical as the window fills; tokens of the kit's status palette. */
export function contextInk(fraction: number | null): string {
  if (fraction === null || fraction < 0.6) return "var(--status-done-ink)";
  return fraction < 0.85 ? "var(--status-attention-ink)" : "var(--tint-problem-border)";
}
/** The kit ring has two tones: quiet while the window has room, the strong one once it is 60% full (the number beside it carries the warning and problem inks). */
export const contextTone = (fraction: number | null): "muted" | "primary" => (fraction === null || fraction < 0.6 ? "muted" : "primary");
export const tokenWords = (n: number): string => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 || n % 1000 === 0 ? 0 : 1)}K` : String(n);

/** The sessions rail's two groups. */
export function groupSessions<T extends { last_activity_at: string }>(rows: readonly T[], now = Date.now()): { today: T[]; previous: T[] } {
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const today: T[] = []; const previous: T[] = [];
  for (const row of rows) (Date.parse(row.last_activity_at) >= start.getTime() ? today : previous).push(row);
  return { today, previous };
}
