// CODE-APP-01: the transcript, drawn with shipped parts: markdown for the agent's words, a terminal block per command, an approval card for a held
// request, the stopped-run line and quiet notices. Host-request approvals are the kit ApprovalCard; there is no second ask flow.
import { i18n } from "@lingui/core";
import { ApprovalCard } from "@maipai/ui/src/elements/approval-card";
import { LightMarkdown } from "@maipai/ui/src/elements/light-markdown";
import { TerminalBlock } from "@maipai/ui/src/elements/terminal-block";
import { getIcon } from "@maipai/ui/src/icons";
import type { CodeMessage, CodePart } from "./codeApi";
import { approvalWords } from "./codeTranscript";

const ShieldIcon = getIcon("shield-check");

const stopWords = (reason: "user" | "wall_clock" | "error" | "denied"): string => ({
  user: i18n._({ id: "Stopped. Nothing more is running.", message: "Stopped. Nothing more is running." }),
  wall_clock: i18n._({ id: "Stopped: this step took too long. Send a message to carry on.", message: "Stopped: this step took too long. Send a message to carry on." }),
  error: i18n._({ id: "Stopped by a problem. Send a message to try again.", message: "Stopped by a problem. Send a message to try again." }),
  denied: i18n._({ id: "Stopped because you said no. Send a message to carry on another way.", message: "Stopped because you said no. Send a message to carry on another way." }),
})[reason];

function partNode(part: CodePart, onAnswer: (requestId: string, answer: "allow" | "deny") => void) {
  switch (part.type) {
    case "text": return <LightMarkdown text={part.text} />;
    case "plan": return <p className="text-body text-muted-foreground">{i18n._({ id: "Plan updated: {done} of {total} steps done.", message: "Plan updated: {done} of {total} steps done.", values: { done: part.items.filter((i) => i.done).length, total: part.items.length } })}</p>;
    case "tool":
      if (part.tool === "command") return <div><TerminalBlock command={part.summary} lines={[]} done={part.status !== "running"} streaming={part.status === "running"} exitCode={part.exit_code ?? (part.status === "failed" ? 1 : 0)} /></div>;
      return <p className="truncate font-mono text-body text-muted-foreground">{part.tool === "file_write" ? i18n._({ id: "Changed {path}", message: "Changed {path}", values: { path: part.summary } }) : part.summary}</p>;
    case "approval": {
      const words = approvalWords(part.effect);
      return <div><ApprovalCard state={part.status === "pending" ? "request" : part.status === "allowed" ? "done" : "denied"} icon={<ShieldIcon aria-hidden />} title={words.title} subtitle={words.subtitle}
        statusLabels={{ done: i18n._({ id: "You said yes", message: "You said yes" }), denied: i18n._({ id: "You said no", message: "You said no" }) }}
        {...(part.status === "pending" ? { onAllowOnce: () => onAnswer(part.request_id, "allow"), onDeny: () => onAnswer(part.request_id, "deny") } : {})} /></div>;
    }
    case "stopped": return <p role="status" className="text-body text-muted-foreground">{stopWords(part.reason)}</p>;
    case "notice": return <p className="text-body text-muted-foreground">{part.text}</p>;
  }
}

export interface LocalNotice { afterSeq: number; text: string }

export function Transcript({ messages, notices, onAnswer }: { messages: readonly CodeMessage[]; notices: readonly LocalNotice[]; onAnswer: (requestId: string, answer: "allow" | "deny") => void }) {
  const noticeAt = (seq: number) => notices.filter((n) => n.afterSeq === seq).map((n, i) => <p key={`n${seq}-${i}`} role="status" className="text-center text-body text-muted-foreground">{n.text}</p>);
  return <ol data-slot="code-transcript" aria-label={i18n._({ id: "Conversation", message: "Conversation" })} className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-4">
    {noticeAt(0)}
    {messages.map((message) => <li key={message.id} className="flex flex-col gap-2">
      {message.role === "user"
        ? <div className="ms-auto max-w-[85%] rounded-2xl bg-muted px-3.5 py-2 text-body whitespace-pre-wrap">{message.parts.map((p) => p.type === "text" ? p.text : "").join("")}</div>
        : message.parts.map((part, index) => <div key={index}>{partNode(part, onAnswer)}</div>)}
      {noticeAt(message.seq)}
    </li>)}
  </ol>;
}
