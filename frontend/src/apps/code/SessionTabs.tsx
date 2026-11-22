// CODE-APP-01: the tabs of the session's right pane: Changes, Files, Terminal, Plan. Each reads what the transcript and the session record already carry.
import { i18n } from "@lingui/core";
import { useState, type ReactNode } from "react";
import { AgentPlan } from "@maipai/ui/src/elements/agent-plan";
import { Confirmation } from "@maipai/ui/src/elements/confirmation";
import { FileTree } from "@maipai/ui/src/elements/file-tree";
import { TerminalBlock } from "@maipai/ui/src/elements/terminal-block";
import { Button } from "@maipai/ui/src/ui/button";
import { EmptyState } from "@maipai/ui/src/primitives/EmptyState";
import { Stack } from "./layout";
import type { CodeSession } from "./codeApi";
import { fileTreeOf, type SessionActivity } from "./codeTranscript";

const empty = (icon: string, text: string) => <EmptyState icon={icon} text={text} />;

export function ChangesTab({ session, activity, onUndo, onPush, onPullRequest, busy }: { session: CodeSession; activity: SessionActivity; onUndo: (checkpointId: string) => void; onPush: () => void; onPullRequest: () => void; busy: boolean }) {
  const [confirming, setConfirming] = useState<"push" | "pr" | null>(null);
  const { files, additions, deletions } = session.changes;
  const hosted = session.repo.kind === "github" || session.repo.kind === "gitea";
  const ask = (what: "push" | "pr", label: string, run: () => void): ReactNode => confirming === what
    ? <span className="flex items-center gap-2"><Button size="sm" disabled={busy} onClick={() => { setConfirming(null); run(); }}>{i18n._({ id: "Confirm", message: "Confirm" })}</Button><Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>{i18n._({ id: "Cancel", message: "Cancel" })}</Button></span>
    : <Button size="sm" variant="outline" disabled={busy || files === 0} onClick={() => setConfirming(what)}>{label}</Button>;
  return <Stack data-slot="code-changes">
    <p className="text-body text-muted-foreground">{files === 0 ? i18n._({ id: "No changes yet.", message: "No changes yet." }) : i18n._({ id: "{files} files changed, +{additions} -{deletions}", message: "{files} files changed, +{additions} -{deletions}", values: { files, additions, deletions } })}</p>
    {activity.files.length > 0 ? <ul className="flex flex-col gap-1 text-body">{activity.files.map((path) => <li key={path} className="truncate font-mono text-body">{path}</li>)}</ul> : null}
    {hosted ? <div className="flex flex-wrap items-center gap-2">
      {ask("push", i18n._({ id: "Push branch", message: "Push branch" }), onPush)}
      {session.pull_request ? <a className="text-body underline" href={session.pull_request.url} target="_blank" rel="noreferrer">{i18n._({ id: "Pull request #{number}", message: "Pull request #{number}", values: { number: session.pull_request.number } })}</a> : ask("pr", i18n._({ id: "Open pull request", message: "Open pull request" }), onPullRequest)}
    </div> : null}
    {(session.checkpoints ?? []).slice().reverse().map((checkpoint) => <div key={checkpoint.id}><Confirmation icon="clock" sentence={i18n._({ id: "{label}: {files} files saved", message: "{label}: {files} files saved", values: { label: checkpoint.label, files: checkpoint.files } })} undo={{ label: "Undo", action: "undo" }} onUndo={() => onUndo(checkpoint.id)} /></div>)}
  </Stack>;
}

export function FilesTab({ activity }: { activity: SessionActivity }) {
  const [selected, setSelected] = useState<string | undefined>();
  if (activity.files.length === 0) return empty("file-text", i18n._({ id: "The files the agent changes show here.", message: "The files the agent changes show here." }));
  return <Stack data-slot="code-files"><FileTree nodes={fileTreeOf(activity.files)} live selectedPath={selected} onSelect={setSelected} totalAdditions={0} totalDeletions={0} /></Stack>;
}

export function TerminalTab({ activity }: { activity: SessionActivity }) {
  if (activity.commands.length === 0) return empty("terminal", i18n._({ id: "Commands the agent runs show here.", message: "Commands the agent runs show here." }));
  return <Stack data-slot="code-terminal">{activity.commands.map((run) => <TerminalBlock key={run.key} command={run.command} lines={[]} done={run.status !== "running"} streaming={run.status === "running"} exitCode={run.exitCode} />)}</Stack>;
}

export function PlanTab({ activity }: { activity: SessionActivity }) {
  if (!activity.plan) return empty("layout-list", i18n._({ id: "The agent's plan shows here when it makes one.", message: "The agent's plan shows here when it makes one." }));
  return <Stack data-slot="code-plan"><AgentPlan steps={activity.plan.steps} activeIndex={activity.plan.done} title={i18n._({ id: "Plan", message: "Plan" })} /></Stack>;
}
