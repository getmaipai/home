// CODE-APP-01, CODE-TIER-04 and CODE-UI-02: the New session page, a quiet centred welcome on the kit's own Thread, so the composer is the one Chat and the session
// view use (same density, the mode and level inside the pill) and cannot drift. The first message creates the session; a new session starts on the tier the
// person used last (the hub says which). Beneath the composer: the repository and branch where a git connection exists, then a few starting ideas.
import { i18n } from "@lingui/core";
import { createContext, useContext, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { AssistantRuntimeProvider, useAui, useExternalStoreRuntime, type AppendMessage, type ThreadMessageLike } from "@assistant-ui/react";
import { type TierOptionDef } from "@maipai/ui/src/elements/tier-segment";
import { Thread } from "@maipai/ui/src/elements/thread.aui";
import { EmptyState, EmptyStateGreeting, EmptyStateSuggestion, EmptyStateSuggestions } from "@maipai/ui/src/elements/empty-state";
import { Input } from "@maipai/ui/src/ui/input";
import { Select } from "@maipai/ui/src/primitives/Select";
import { StatusCard } from "@maipai/ui/src/elements/status-card";
import { errorLine } from "@/lib/hubReachability";
import { THREAD_SLOTS } from "@/apps/chat/elementBindings";
import { Stack } from "./layout";
import { codeApi, type CodeSession, type CodeTier } from "./codeApi";
import { tierWord } from "./codeTranscript";
import { codeComposerModes } from "./CodeThread";

export const CODE_TIERS_KEY = ["code-tiers"];
export const CODE_SESSIONS_KEY = ["code-sessions"];

/** The kit's tier options for the tiers the hub offers (a tier left out is not drawn). */
export const tierOptions = (tiers: readonly CodeTier[]): TierOptionDef[] => tiers.map((id) => ({ id, label: tierWord(id) }));

const ProblemContext = createContext("");
const NO_MESSAGES: ThreadMessageLike[] = [];

/** Above the composer: why the start failed, in the kit's problem card. */
const Problem = () => { const problem = useContext(ProblemContext); return <>{problem ? <StatusCard kind="problem" title={i18n._({ id: "That did not work", message: "That did not work" })} line={problem} /> : null}</>; };
/** CODE-UX-09 fills this line (a notice under the composer). It draws nothing until then. */
const NoticeSlot = () => null;
/** CODE-UX-02 puts the environment chip here, in the row of choices beneath the composer. */
const EnvironmentSlot = () => null;

const ideas = () => [
  { title: i18n._({ id: "Fix a failing test", message: "Fix a failing test" }), prompt: i18n._({ id: "Find the failing test, work out why it fails, and fix it.", message: "Find the failing test, work out why it fails, and fix it." }) },
  { title: i18n._({ id: "Explain this code", message: "Explain this code" }), prompt: i18n._({ id: "Walk me through how this project is laid out and where to start.", message: "Walk me through how this project is laid out and where to start." }) },
  { title: i18n._({ id: "Add a small feature", message: "Add a small feature" }), prompt: i18n._({ id: "Add a small feature: ", message: "Add a small feature: " }) },
];
/** A starting idea fills the composer; it never sends, so the person reads and edits it first. */
function StartingIdeas() {
  const aui = useAui();
  return <>
    <EmptyStateSuggestions data-slot="code-ideas">
      {ideas().map((idea, index) => <EmptyStateSuggestion key={idea.title} index={index} className="text-supporting" onClick={() => aui.composer().setText(idea.prompt)}>{idea.title}</EmptyStateSuggestion>)}
    </EmptyStateSuggestions>
  </>;
}

export function NewSession() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const tiers = useQuery({ queryKey: CODE_TIERS_KEY, queryFn: codeApi.tiers, retry: false });
  const [tier, setTier] = useState<CodeTier | null>(null);
  const [mode, setMode] = useState<CodeSession["mode"]>("ask");
  const [problem, setProblem] = useState("");
  const connections = useQuery({ queryKey: ["git-connections"], queryFn: codeApi.connections, retry: false });
  const active = (connections.data?.connections ?? []).filter((c) => c.status === "active");
  const [connectionId, setConnectionId] = useState("none");
  const [fullName, setFullName] = useState("");
  const [baseBranch, setBaseBranch] = useState("main");
  const chosen = active.find((c) => c.id === connectionId);
  const repoOk = !chosen || /^[\w.-]+\/[\w.-]+$/.test(fullName.trim());
  const offered = tiers.data?.tiers ?? [];
  const value: CodeTier = tier && offered.includes(tier) ? tier : tiers.data?.last ?? "standard";

  async function start(message: string): Promise<boolean> {
    if (!message) return false;
    if (!repoOk) { setProblem(i18n._({ id: "Type the repository as owner/name, for example willow/thermostat, then send again.", message: "Type the repository as owner/name, for example willow/thermostat, then send again." })); return false; }
    setProblem("");
    try {
      const session = await codeApi.create(message.split("\n")[0]!.slice(0, 100), value, chosen ? { kind: chosen.kind, connectionId: chosen.id, fullName: fullName.trim(), baseBranch: baseBranch.trim() || "main" } : undefined);
      if (mode !== "ask") await codeApi.setMode(session.id, mode);
      await codeApi.send(session.id, message);
      await queryClient.invalidateQueries({ queryKey: CODE_SESSIONS_KEY });
      navigate(`/apps/code/${session.id}`);
      return true;
    } catch (error) {
      setProblem(errorLine(error, i18n._({ id: "Could not start the session. Try again.", message: "Could not start the session. Try again." })));
      return false;
    }
  }
  const runtime = useExternalStoreRuntime<ThreadMessageLike>({
    messages: NO_MESSAGES,
    isRunning: false,
    convertMessage: (m) => m,
    onNew: async (message: AppendMessage) => {
      const text = message.content.map((p) => (p.type === "text" ? p.text : "")).join("").trim();
      // The composer clears on send; a failed start puts the words back so nothing is lost.
      if (!(await start(text)) && text) runtime.thread.composer.setText(text);
    },
  });
  const composerModes = codeComposerModes({ mode, onMode: setMode, tier: value, tiers: offered.length > 0 ? offered : ["standard"], onTier: setTier });

  const choices = <Stack data-slot="code-choices" className="items-center">
    {active.length > 0 ? <Stack row className="flex-wrap items-center justify-center" data-slot="code-repo">
      <Select aria-label={i18n._({ id: "Repository", message: "Repository" })} value={connectionId} onValueChange={setConnectionId} options={["none", ...active.map((c) => c.id)]}
        getLabel={(id) => { const c = active.find((x) => x.id === id); return c ? `${c.kind === "github" ? "GitHub" : "Gitea"}: ${c.account}` : i18n._({ id: "No repository", message: "No repository" }); }} />
      {chosen ? <>
        <Input value={fullName} onChange={(event) => { setFullName(event.target.value); setProblem(""); }} aria-label={i18n._({ id: "Repository name, for example owner/name", message: "Repository name, for example owner/name" })} placeholder={i18n._({ id: "owner/name", message: "owner/name" })} aria-invalid={fullName !== "" && !repoOk} />
        <Input value={baseBranch} onChange={(event) => setBaseBranch(event.target.value)} aria-label={i18n._({ id: "Starting branch", message: "Starting branch" })} placeholder={i18n._({ id: "main", message: "main" })} />
      </> : null}
    </Stack> : null}
    <EnvironmentSlot />
    <StartingIdeas />
  </Stack>;
  const welcome = <>
    <EmptyState><EmptyStateGreeting size="lg" className="text-title">{i18n._({ id: "What should we build?", message: "What should we build?" })}</EmptyStateGreeting></EmptyState>
    {/* The same room between the heading and the composer as Chat's welcome. */}
    <div aria-hidden className="h-8" />
  </>;
  // Each click of New session is a new navigation key: the Thread remounts empty and takes focus again.
  return <>
    <AssistantRuntimeProvider runtime={runtime} key={location.key}>
      <ProblemContext.Provider value={problem}>
        <Thread tourId="code.new" composerTourId="code.new-composer" components={{ composerDensity: THREAD_SLOTS.composerDensity, WelcomeContent: welcome, BelowComposerContent: choices, ComposerQueue: Problem, ComposerNotice: NoticeSlot, composerNoticeReserve: true, composerPlaceholder: i18n._({ id: "Describe the task, for example: fix the failing test in the thermostat code.", message: "Describe the task, for example: fix the failing test in the thermostat code." }), composerModes }} />
      </ProblemContext.Provider>
    </AssistantRuntimeProvider>
  </>;
}
