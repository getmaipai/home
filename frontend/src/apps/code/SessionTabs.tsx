// CODE-APP-01: the tabs of the session's right pane: Changes, Files, Terminal, Plan. Changes and Files read the workspace through the hub (a diff of the
// committed branch against its base, the file tree, one text file); Terminal reads the commands and their output the transcript keeps; Plan reads the plan.
import { i18n } from "@lingui/core";
import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { AgentPlan } from "@maipai/ui/src/elements/agent-plan";
import { CodeDiff } from "@maipai/ui/src/elements/code-diff";
import { CodeView } from "@maipai/ui/src/elements/code-view";
import { Confirmation } from "@maipai/ui/src/elements/confirmation";
import { FileTree, type FileTreeNode } from "@maipai/ui/src/elements/file-tree";
import { TerminalBlock } from "@maipai/ui/src/elements/terminal-block";
import { Button } from "@maipai/ui/src/ui/button";
import { EmptyState } from "@maipai/ui/src/primitives/EmptyState";
import { errorLine } from "@/lib/hubReachability";
import { codeApi, type CodeContext, type CodeSession } from "./codeApi";
import { ContextRing } from "./Composer";
import { Stack } from "./layout";
import { fileTreeOf, languageOf, parseDiff, repoLine, type SessionActivity } from "./codeTranscript";

const empty = (icon: string, text: string) => <EmptyState icon={icon} text={text} />;

export function ChangesTab({ session, activity, context, onUndo, onPush, onPullRequest, busy }: { session: CodeSession; context: CodeContext | undefined; activity: SessionActivity; onUndo: (checkpointId: string) => void; onPush: () => void; onPullRequest: () => void; busy: boolean }) {
  const [confirming, setConfirming] = useState<"push" | "pr" | null>(null);
  const changes = useQuery({ queryKey: ["code-changes", session.id, session.last_activity_at], queryFn: () => codeApi.changes(session.id), retry: false });
  const { files, additions, deletions } = session.changes;
  const hosted = session.repo.kind === "github" || session.repo.kind === "gitea";
  const byFile = parseDiff(changes.data?.diff ?? "");
  const listed = changes.data?.available ? changes.data.files : activity.files.map((path) => ({ path, additions: 0, deletions: 0, binary: false }));
  const ask = (what: "push" | "pr", label: string, run: () => void): ReactNode => confirming === what
    ? <span className="flex items-center gap-2"><Button size="sm" disabled={busy} onClick={() => { setConfirming(null); run(); }}>{i18n._({ id: "Confirm", message: "Confirm" })}</Button><Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>{i18n._({ id: "Cancel", message: "Cancel" })}</Button></span>
    : <Button size="sm" variant="outline" disabled={busy || files === 0} onClick={() => setConfirming(what)}>{label}</Button>;
  return <Stack data-slot="code-changes">
    <Stack gap="tight" data-slot="code-environment">
      <h3 className="text-body font-semibold">{i18n._({ id: "Environment", message: "Environment" })}</h3>
      <p className="truncate font-mono text-body text-muted-foreground">{repoLine(session.repo)}</p>
      {session.repo.kind !== "none" ? <p className="truncate font-mono text-body text-muted-foreground">{session.repo.base_branch}</p> : null}
    </Stack>
    <Stack gap="tight" data-slot="code-context-block">
      <h3 className="text-body font-semibold">{i18n._({ id: "Context", message: "Context" })}</h3>
      {context ? <ContextRing context={context} /> : <p className="text-body text-muted-foreground">{i18n._({ id: "Not measured yet.", message: "Not measured yet." })}</p>}
    </Stack>
    <h3 className="text-body font-semibold">{i18n._({ id: "Changes", message: "Changes" })}</h3>
    <p className="text-body text-muted-foreground">{files === 0 && listed.length === 0 ? i18n._({ id: "No changes yet.", message: "No changes yet." }) : i18n._({ id: "{files} files changed, +{additions} -{deletions}", message: "{files} files changed, +{additions} -{deletions}", values: { files: files || listed.length, additions, deletions } })}</p>
    {changes.isError ? <p role="alert" className="text-body text-muted-foreground">{errorLine(changes.error, i18n._({ id: "Could not read the changes. Try again.", message: "Could not read the changes. Try again." }))}</p> : null}
    {listed.map((file) => byFile[file.path] && byFile[file.path]!.length > 0
      ? <div key={file.path}><CodeDiff filename={file.path} additions={file.additions} deletions={file.deletions} lines={byFile[file.path]!} compareLabel={i18n._({ id: "vs {branch}", message: "vs {branch}", values: { branch: session.repo.base_branch } })} /></div>
      : <p key={file.path} className="truncate font-mono text-body">{file.path}{file.binary ? ` (${i18n._({ id: "binary file", message: "binary file" })})` : ""}</p>)}
    {changes.data?.truncated ? <p className="text-body text-muted-foreground">{i18n._({ id: "The diff is long, so only the first part is shown.", message: "The diff is long, so only the first part is shown." })}</p> : null}
    {hosted ? <div className="flex flex-wrap items-center gap-2">
      {ask("push", i18n._({ id: "Push branch", message: "Push branch" }), onPush)}
      {session.pull_request ? <a className="text-body underline" href={session.pull_request.url} target="_blank" rel="noreferrer">{i18n._({ id: "Pull request #{number}", message: "Pull request #{number}", values: { number: session.pull_request.number } })}</a> : ask("pr", i18n._({ id: "Open pull request", message: "Open pull request" }), onPullRequest)}
    </div> : null}
    {(session.checkpoints ?? []).slice().reverse().map((checkpoint) => <div key={checkpoint.id}><Confirmation icon="clock" sentence={i18n._({ id: "{label}: {files} files saved", message: "{label}: {files} files saved", values: { label: checkpoint.label, files: checkpoint.files } })} undo={{ label: "Undo", action: "undo" }} onUndo={() => onUndo(checkpoint.id)} /></div>)}
  </Stack>;
}

export function FilesTab({ session, activity }: { session: CodeSession; activity: SessionActivity }) {
  const [selected, setSelected] = useState<string | undefined>();
  const tree = useQuery({ queryKey: ["code-tree", session.id, session.last_activity_at], queryFn: () => codeApi.tree(session.id), retry: false });
  const file = useQuery({ queryKey: ["code-file", session.id, selected, session.last_activity_at], queryFn: () => codeApi.file(session.id, selected!), enabled: selected !== undefined, retry: false });
  const nodes: FileTreeNode[] = tree.data && tree.data.entries.length > 0 ? tree.data.entries : fileTreeOf(activity.files);
  if (nodes.length === 0) return empty("file-text", i18n._({ id: "The files in the workspace show here.", message: "The files in the workspace show here." }));
  return <Stack data-slot="code-files">
    <FileTree nodes={nodes} live selectedPath={selected} onSelect={(path) => setSelected(nodes.find((n) => n.path === path)?.kind === "file" ? path : undefined)} totalAdditions={session.changes.additions} totalDeletions={session.changes.deletions} />
    {tree.data?.truncated ? <p className="text-body text-muted-foreground">{i18n._({ id: "Only the first files are listed.", message: "Only the first files are listed." })}</p> : null}
    {file.isError ? <p role="alert" className="text-body text-muted-foreground">{errorLine(file.error, i18n._({ id: "Could not open that file. Try again.", message: "Could not open that file. Try again." }))}</p> : null}
    {file.data && selected ? <div><CodeView code={file.data.content} language={languageOf(selected)} filename={selected} /></div> : null}
  </Stack>;
}

export function TerminalTab({ activity }: { activity: SessionActivity }) {
  if (activity.commands.length === 0) return empty("terminal", i18n._({ id: "Commands the agent runs show here.", message: "Commands the agent runs show here." }));
  return <Stack data-slot="code-terminal">{activity.commands.map((run) => <TerminalBlock key={run.key} command={run.command} lines={run.lines} truncated={run.truncated} done={run.status !== "running"} streaming={run.status === "running"} exitCode={run.exitCode} />)}</Stack>;
}

export function PlanTab({ activity }: { activity: SessionActivity }) {
  if (!activity.plan) return empty("layout-list", i18n._({ id: "The agent's plan shows here when it makes one.", message: "The agent's plan shows here when it makes one." }));
  return <Stack data-slot="code-plan"><AgentPlan steps={activity.plan.steps} activeIndex={activity.plan.done} title={i18n._({ id: "Plan", message: "Plan" })} /></Stack>;
}
