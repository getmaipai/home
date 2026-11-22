// CODE-APP-01: the transcript, drawn with shipped parts: markdown for the agent's words, a terminal block per command, an approval card for a held
// request, the stopped-run line and quiet notices. Host-request approvals are the kit ApprovalCard; there is no second ask flow.
import { i18n } from "@lingui/core";
import { ApprovalCard } from "@maipai/ui/src/elements/approval-card";
import { LightMarkdown } from "@maipai/ui/src/elements/light-markdown";
import { TerminalBlock } from "@maipai/ui/src/elements/terminal-block";
import { getIcon } from "@maipai/ui/src/icons";
import type { CodeMessage, CodePart } from "./codeApi";
import { approvalWords, outputLines, stopWords } from "./codeTranscript";

const ShieldIcon = getIcon("shield-check");

function partNode(part: CodePart, onAnswer: (requestId: string, answer: "allow" | "deny") => void) {
  switch (part.type) {
    case "text": return <LightMarkdown text={part.text} />;
    case "plan": return <p className="text-body text-muted-foreground">{i18n._({ id: "Plan updated: {done} of {total} steps done.", message: "Plan updated: {done} of {total} steps done.", values: { done: part.items.filter((i) => i.done).length, total: part.items.length } })}</p>;
    case "tool":
      if (part.tool === "command") return <div><TerminalBlock command={part.summary} lines={outputLines(part.output).lines} truncated={outputLines(part.output).truncated} done={part.status !== "running"} streaming={part.status === "running"} exitCode={part.exit_code ?? (part.status === "failed" ? 1 : 0)} /></div>;
      return <p className="truncate font-mono text-body text-muted-foreground">{part.tool === "file_write" ? i18n._({ id: "Changed {path}", message: "Changed {path}", values: { path: part.summary } }) : part.summary}</p>;
    case "approval": {
      const words = approvalWords(part.effect);
      return <div><ApprovalCard state={part.status === "pending" ? "request" : part.status === "allowed" ? "done" : "denied"} icon={<ShieldIcon aria-hidden />} title={words.title} subtitle={words.subtitle}
        statusLabels={{ done: i18n._({ id: "You said yes", message: "You said yes" }), denied: i18n._({ id: "You said no", message: "You said no" }) }}
        {...(part.status === "pending" ? { onAllowOnce: () => onAnswer(part.request_id, "allow"), onDeny: () => onAnswer(part.request_id, "deny") } : {})} /></div>;
    }
    case "stopped": return <p role="status" className="text-body text-muted-foreground">{stopWords(part.reason, part.code)}</p>;
    case "usage": return null;
    case "notice": return <p className="text-body text-muted-foreground">{part.text}</p>;
  }
}

export interface LocalNotice { afterSeq: number; text: string }

export function Transcript({ messages, notices, quietFailure = false, onAnswer }: { messages: readonly CodeMessage[]; notices: readonly LocalNotice[]; /** The latest failure is explained by the card under the transcript, so its line is not repeated. */ quietFailure?: boolean; onAnswer: (requestId: string, answer: "allow" | "deny") => void }) {
  const noticeAt = (seq: number) => notices.filter((n) => n.afterSeq === seq).map((n, i) => <p key={`n${seq}-${i}`} role="status" className="text-center text-body text-muted-foreground">{n.text}</p>);
  return <ol data-slot="code-transcript" aria-label={i18n._({ id: "Conversation", message: "Conversation" })} className="mx-auto flex w-full max-w-3xl flex-col divide-y divide-border/40 px-3 py-2">
    {noticeAt(0)}
    {messages.map((message) => <li key={message.id} className="flex flex-col gap-1.5 py-2.5">
      {message.role === "user"
        ? <div className="ms-auto max-w-[85%] rounded-lg bg-muted px-3 py-1.5 text-body whitespace-pre-wrap">{message.parts.map((p) => p.type === "text" ? p.text : "").join("")}</div>
        : message.parts.map((part, index) => quietFailure && message === messages[messages.length - 1] && part.type === "stopped" && part.reason === "error" ? null : <div key={index}>{partNode(part, onAnswer)}</div>)}
      {noticeAt(message.seq)}
    </li>)}
  </ol>;
}
