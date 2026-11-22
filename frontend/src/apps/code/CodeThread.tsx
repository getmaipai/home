// CODE-COMPOSER: the session's transcript and composer are the kit's shared Thread (the one chat, Create and projects mount), on an external-store runtime fed by
// the hub's transcript. The kit draws the composer, the + files menu, drag and drop, attachment chips and the Quality chip (the level control); this file only
// passes data and fills the kit's own slots: ComposerQueue (held request cards, the waiting line, failures), ComposerNotice (the status line), ComposerFooterEnd
// (the context ring) and ToolFallback (commands, file changes, approvals). Nothing is wrapped or restyled.
import { i18n } from "@lingui/core";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { AssistantRuntimeProvider, ComposerPrimitive, unstable_defaultDirectiveFormatter, useExternalStoreRuntime, type AppendMessage, type AttachmentAdapter, type ThreadMessageLike, type ToolCallMessagePartComponent } from "@assistant-ui/react";
import { Thread, type ThreadComposerModes } from "@maipai/ui/src/elements/thread.aui";
import { ComposerMentions } from "@maipai/ui/src/elements/composer-mentions.aui";
import { ApprovalCard } from "@maipai/ui/src/elements/approval-card";
import { MessageQueue } from "@maipai/ui/src/elements/message-queue";
import { PendingActions, type PendingAction } from "@maipai/ui/src/elements/pending-actions";
import { DraftRestore } from "@maipai/ui/src/elements/draft-restore";
import { ErrorState } from "@maipai/ui/src/elements/error-state";
import { useComposerDraftRestore } from "@/apps/chat/composerDraftRestore";
import { StatusCard } from "@maipai/ui/src/elements/status-card";
import { TerminalBlock } from "@maipai/ui/src/elements/terminal-block";
import { ThinkingIndicator } from "@maipai/ui/src/elements/thinking-indicator";
import type { ComposerModeData, ComposerQualityData } from "@maipai/ui/src/elements/composer-parts";
import { getIcon } from "@maipai/ui/src/icons";
import { codeApi, type CodeContext, type CodeMessage, type CodeSession, type CodeTier, type TreeEntry } from "./codeApi";
import { approvalWords, outputLines, stopWords, tierWord } from "./codeTranscript";
import { THREAD_SLOTS } from "@/apps/chat/elementBindings";
import { ChatComposerNotice, ComposerEngage } from "@/apps/chat/chatThreadSlots";
import { ChatComposerNoticeContext } from "@/apps/chat/chatThreadContexts";
import { ContextRing } from "./ContextRing";
import { CodeComposerContexts } from "./codeShared";
import { ChatShortcutReference } from "@/shell/pages/ChatShortcutReference";

const ShieldIcon = getIcon("shield-check");

/** What the Thread's slots read: the session's live bits the host owns. */
export interface CodeThreadState {
  session: CodeSession;
  context: CodeContext | undefined;
  statusLine: string;
  busy: boolean;
  stage: { label: string; elapsed: string } | null;
  held: readonly PendingAction[];
  queued: readonly { id: string; text: string }[];
  failure: string | null;
  /** CODE-FIX-01: run the last message again (the failure card's Retry). */
  onRetry: () => void;
  problem: string;
  notices: readonly string[];
  /** TIER-LEASE-04: the composer was used (the shared lease hook renews the lease; throttled there). */
  onEngage?: () => void;
  onAnswer: (requestId: string, answer: "allow" | "deny") => void;
  onCancelQueued: (id: string) => void;
  onMode: (mode: CodeSession["mode"]) => void;
}
const StateContext = createContext<CodeThreadState | null>(null);
const useState_ = (): CodeThreadState => { const s = useContext(StateContext); if (!s) throw new Error("CodeThread slots render inside CodeThread"); return s; };

/** The hub's transcript as assistant-ui messages: the agent's text as text, each command, file change, plan, request and stop as a tool-call part the fallback draws. */
export function toThreadMessages(messages: readonly CodeMessage[], running: boolean, hideErrorStop = false): ThreadMessageLike[] {
  const out: ThreadMessageLike[] = [];
  const lastReal = messages.reduce((at, m, i) => (m.role === "system" ? at : i), -1);
  messages.forEach((m, mi) => {
    if (m.role === "system" || m.parts.every((p) => p.type === "usage")) return;
    const createdAt = new Date(m.created_at);
    if (m.role === "user") { out.push({ id: m.id, role: "user", createdAt, content: [{ type: "text", text: m.parts.map((p) => (p.type === "text" ? p.text : "")).join("") }] }); return; }
    const content: Exclude<ThreadMessageLike["content"], string> extends readonly (infer P)[] ? P[] : never = [];
    m.parts.forEach((p, i) => {
      const id = `${m.id}:${i}`;
      if (p.type === "text") content.push({ type: "text", text: p.text });
      else if (p.type === "tool") content.push({ type: "tool-call", toolCallId: id, toolName: p.tool, args: { summary: p.summary }, ...(p.status === "running" ? {} : { result: { exit_code: p.exit_code ?? (p.status === "failed" ? 1 : 0), output: p.output ?? "" } }) });
      else if (p.type === "plan") content.push({ type: "tool-call", toolCallId: id, toolName: "plan", args: { done: p.items.filter((x) => x.done).length, total: p.items.length }, result: {} });
      else if (p.type === "approval") content.push({ type: "tool-call", toolCallId: id, toolName: "approval", args: { request_id: p.request_id, effect: p.effect }, result: { status: p.status } });
      else if (p.type === "stopped") { if (!(hideErrorStop && p.reason === "error" && mi === lastReal)) content.push({ type: "tool-call", toolCallId: id, toolName: "stopped", args: { reason: p.reason, code: p.code ?? "" }, result: {} }); }
      else if (p.type === "notice") content.push({ type: "tool-call", toolCallId: id, toolName: "notice", args: { text: p.text }, result: {} });
    });
    if (content.length === 0) return;
    out.push({ id: m.id, role: "assistant", createdAt, content, status: running && mi === messages.length - 1 ? { type: "running" } : { type: "complete", reason: "stop" } });
  });
  return out;
}

const toolNode = (name: string, args: Record<string, unknown>, result: Record<string, unknown> | undefined, onAnswer: CodeThreadState["onAnswer"]): ReactNode => {
  switch (name) {
    case "command": {
      const lines = outputLines(typeof result?.output === "string" ? result.output : undefined);
      return <TerminalBlock command={String(args.summary ?? "")} lines={lines.lines} truncated={lines.truncated} done={result !== undefined} streaming={result === undefined} exitCode={typeof result?.exit_code === "number" ? result.exit_code : 0} />;
    }
    case "file_write": return <p className="truncate font-mono text-body text-muted-foreground">{i18n._({ id: "Changed {path}", message: "Changed {path}", values: { path: String(args.summary ?? "") } })}</p>;
    case "read": case "fetch": return <p className="truncate font-mono text-body text-muted-foreground">{String(args.summary ?? "")}</p>;
    case "plan": return <p className="text-body text-muted-foreground">{i18n._({ id: "Plan updated: {done} of {total} steps done.", message: "Plan updated: {done} of {total} steps done.", values: { done: Number(args.done ?? 0), total: Number(args.total ?? 0) } })}</p>;
    case "approval": {
      const words = approvalWords(String(args.effect ?? ""));
      const status = String(result?.status ?? "pending");
      return <ApprovalCard state={status === "pending" ? "request" : status === "allowed" ? "done" : "denied"} icon={<ShieldIcon aria-hidden />} title={words.title} subtitle={words.subtitle}
        statusLabels={{ done: i18n._({ id: "You said yes", message: "You said yes" }), denied: i18n._({ id: "You said no", message: "You said no" }) }}
        {...(status === "pending" ? { onAllowOnce: () => onAnswer(String(args.request_id), "allow"), onDeny: () => onAnswer(String(args.request_id), "deny") } : {})} />;
    }
    case "stopped": return <p role="status" className="text-body text-muted-foreground">{stopWords(args.reason as "user" | "wall_clock" | "error" | "denied", String(args.code ?? "") || undefined)}</p>;
    case "notice": return <p className="text-body text-muted-foreground">{String(args.text ?? "")}</p>;
    default: return null;
  }
};

const CodeToolFallback: ToolCallMessagePartComponent = ({ toolName, args, result }) => <>{toolNode(toolName, args as Record<string, unknown>, result as Record<string, unknown> | undefined, useState_().onAnswer)}</>;
const Plain = ({ children }: { children?: ReactNode }) => <>{children}</>;
const Welcome = () => <p className="p-6 text-center text-body text-muted-foreground">{i18n._({ id: "Nothing yet. Tell the agent what to do.", message: "Nothing yet. Tell the agent what to do." })}</p>;

/** Above the composer: what the agent is doing, held requests, the waiting messages, a failure, a problem. */
const Queue = () => {
  const s = useState_();
  const draft = useComposerDraftRestore();
  return <>
    {s.notices.map((n, i) => <p key={i} role="status" className="text-center text-body text-muted-foreground">{n}</p>)}
    {s.stage ? <ThinkingIndicator label={s.stage.label} elapsed={s.stage.elapsed} /> : null}
    {s.held.length > 0 ? <PendingActions actions={[...s.held]} /> : null}
    {s.queued.length > 0 ? <MessageQueue running={s.statusLine} queued={s.queued} onCancel={s.onCancelQueued} /> : null}
    {s.failure ? <StatusCard kind="problem" title={i18n._({ id: "The agent stopped", message: "The agent stopped" })} line={s.failure} action={{ label: i18n._({ id: "Retry", message: "Retry" }), onSelect: s.onRetry }} /> : null}
    {s.problem ? <ErrorState title={s.problem} retrying={false} layout="inline" /> : null}
    {draft ? <DraftRestore {...draft} /> : null}
  </>;
};
/** The composer line: Chat's notice while Code cannot run a message (CODE-FIX-02), else the session's own status line. */
const Notice = () => { const s = useState_(); const readiness = useContext(ChatComposerNoticeContext); return readiness ? <ChatComposerNotice /> : <span data-slot="code-status">{s.statusLine}{s.onEngage ? <ComposerEngage onEngage={s.onEngage} /> : null}</span>; };
const ExtraEnd = () => { const s = useState_(); return <span data-slot="code-statusbar" className="flex shrink-0 items-center gap-2 text-body text-muted-foreground"><ContextRing context={s.context} /></span>; };

// The density is Chat's, read from its one definition (THREAD_SLOTS), so a change there moves both. The mode, level and context ring sit in the quiet footer row below the composer (owner reversal, 2026-11-22).
const THREAD_COMPONENTS = { composerDensity: THREAD_SLOTS.composerDensity, ToolFallback: CodeToolFallback, ToolGroup: Plain, ReasoningGroup: Plain, Welcome, ComposerQueue: Queue, ComposerNotice: Notice, composerNoticeReserve: true, composerNoticeLayout: "wrap" as const, ComposerFooterEnd: ExtraEnd, viewport: { turnAnchor: "bottom" as const, autoScroll: true, scrollToBottomOnRunStart: true, scrollToBottomOnInitialize: true } };

/** The composer's mode pill and level chip, one definition for the session view and the New session page so they cannot drift. */
export function codeComposerModes({ mode, onMode, tier, tiers, onTier }: { mode: CodeSession["mode"]; onMode: (mode: CodeSession["mode"]) => void; tier: CodeTier; tiers: readonly CodeTier[]; onTier: (tier: CodeTier) => void }): ThreadComposerModes {
  const placeholder = i18n._({ id: "Message the agent. Type @ to point at a file.", message: "Message the agent. Type @ to point at a file." });
  const modes: ComposerModeData[] = [
    { id: "ask", label: i18n._({ id: "Ask before changes", message: "Ask before changes" }), icon: "shield-check", placeholder },
    { id: "auto_edit", label: i18n._({ id: "Auto edit", message: "Auto edit" }), icon: "pencil", placeholder },
    { id: "plan", label: i18n._({ id: "Plan", message: "Plan" }), icon: "square-pen", placeholder },
  ];
  const quality: ComposerQualityData = { value: tier, onValueChange: (v) => onTier(v as CodeTier), options: tiers.map((t) => ({ value: t, label: tierWord(t) })), band: "adult", label: i18n._({ id: "Level", message: "Level" }) };
  // One tier on offer is no choice, so the chip is left out.
  return { modes, mode, placement: "footer" as const, onModeChange: (id) => onMode(id as CodeSession["mode"]), ...(tiers.length > 1 ? { quality } : {}) };
}

export function CodeThread({ state, messages, tiers, onTier, onSend, onStop, tree }: {
  state: CodeThreadState; messages: readonly CodeMessage[]; tiers: readonly CodeTier[]; onTier: (tier: CodeTier) => void;
  onSend: (text: string) => Promise<void>; onStop: () => void; tree: readonly TreeEntry[];
}) {
  const { session } = state;
  const sessionId = session.id;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const attachments = useMemo<AttachmentAdapter>(() => ({
    accept: ".txt,.md,.json,.csv,.log,.yml,.yaml,.toml,.xml,.html,.css,.js,.jsx,.ts,.tsx,.py,.rb,.go,.rs,.java,.kt,.swift,.c,.h,.cpp,.cs,.php,.sh,.sql,.png,.jpg,.jpeg,.gif,.webp,.pdf",
    add: async ({ file }) => { const done = await codeApi.upload(sessionId, file); return { id: done.path, type: file.type.startsWith("image/") ? "image" : "document", name: file.name, contentType: file.type || "text/plain", file, status: { type: "requires-action", reason: "composer-send" } }; },
    remove: async () => undefined,
    send: async (attachment) => ({ ...attachment, status: { type: "complete" }, content: [{ type: "text", text: attachment.id }] }),
  }), [sessionId]);
  const runtime = useExternalStoreRuntime<ThreadMessageLike>({
    messages: useMemo(() => toThreadMessages(messages, state.busy, state.failure !== null), [messages, state.busy, state.failure]),
    isRunning: state.busy,
    convertMessage: (m) => m,
    onNew: async (message: AppendMessage) => {
      const text = message.content.map((p) => (p.type === "text" ? p.text : "")).join("").replace(/:file\[[^\]]*\]\{name=([^}]*)\}/g, "@$1").trim();
      const files = (message.attachments ?? []).map((a) => a.id);
      if (!text && files.length === 0) return;
      await onSend(files.length ? `${text}\n\n${i18n._({ id: "Files I added:", message: "Files I added:" })} ${files.join(", ")}`.trim() : text);
    },
    onCancel: async () => onStop(),
    adapters: { attachments },
  });
  const composerModes = codeComposerModes({ mode: session.mode, onMode: state.onMode, tier: session.tier ?? "standard", tiers, onTier });
  const mentions = tree.filter((e) => e.kind === "file").slice(0, 400).map((e) => ({ id: e.path, type: "file", label: e.path }));
  return <AssistantRuntimeProvider runtime={runtime}>
    <StateContext.Provider value={state}>
      <CodeComposerContexts draftId={`code-${sessionId}`} onRetry={() => { void queryClient.invalidateQueries({ queryKey: ["code-session", sessionId] }); void queryClient.invalidateQueries({ queryKey: ["code-messages", sessionId] }); }}>
      <ChatShortcutReference onNew={() => navigate("/apps/code")} newLabel={i18n._({ id: "New session", message: "New session" })} description={i18n._({ id: "Shortcuts for coding and navigation.", message: "Shortcuts for coding and navigation." })} />
      <ComposerPrimitive.Unstable_TriggerPopoverRoot>
        <Thread tourId="code.thread" composerTourId="code.composer" components={{ ...THREAD_COMPONENTS, composerModes }} />
        {mentions.length > 0 ? <ComposerMentions items={mentions} formatter={unstable_defaultDirectiveFormatter} /> : null}
      </ComposerPrimitive.Unstable_TriggerPopoverRoot>
      </CodeComposerContexts>
    </StateContext.Provider>
  </AssistantRuntimeProvider>;
}
