// CODE-APP-01: what the session view's tabs show, read from the transcript the hub already sends (no second source). Pure, so it is tested alone.
import { i18n } from "@lingui/core";
import type { FileTreeNode } from "@maipai/ui/src/elements/file-tree";
import type { CodeMessage, CodePart, CodeState } from "./codeApi";

export interface CommandRun { key: string; command: string; status: "running" | "done" | "failed"; exitCode: number }

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
      if (part.type === "tool" && part.tool === "command") commands.push({ key: `${message.id}:${index}`, command: part.summary, status: part.status, exitCode: part.exit_code ?? (part.status === "failed" ? 1 : 0) });
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
  failed: i18n._({ id: "Stopped by a problem", message: "Stopped by a problem" }),
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
