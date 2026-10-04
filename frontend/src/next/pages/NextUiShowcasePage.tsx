import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AssistantRuntimeProvider, useAui, useLocalRuntime } from "@assistant-ui/react";
import { Thread } from "@maipai/ui/src/elements/thread.aui";
import { Alert, AlertDescription } from "@maipai/ui/src/dashboard/components/ui/alert";
import { Badge } from "@maipai/ui/src/ui/badge";
import { Button } from "@maipai/ui/src/ui/button";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { Page } from "@maipai/ui/src/primitives/Page";
import { List } from "@maipai/ui/src/primitives/List";
import { Select } from "@maipai/ui/src/primitives/Select";
import { SplitView } from "@maipai/ui/src/primitives/SplitView";
import { ElementsAdoptionPanel } from "@/dev/ElementsAdoptionPanel";
import { AdminGatedContent } from "@/apps/settings/AdminGatedContent";
import { createChatModelAdapter } from "@/apps/chat/chatModelAdapter";
import { AdminContext, AssistantMoreItems, ChatThinkingIndicator, MessageFooterExtra, NextReasoningGroup, SourcesActionBarTrigger, SourcesOpenContext, StructuredResultTools, SuppressSourcesFallback, ToolTimelineTool } from "@/next/pages/NextChatPage";
import { listShowcaseScenarios, openShowcaseStream, type ShowcasePace, type ShowcaseScenario } from "@/lib/uiFixturesApi";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import type { Roster } from "@/lib/api";

// UI-SHOWCASE (/dev/ui, admin only, not in any menu): deterministic buttons
// that play canned turns through the REAL chat UI, because a small model
// cannot be made to produce a table, a formula or an error on demand. Each
// button sends one user message; the real chat adapter (createChatModelAdapter)
// opens the stream at /api/dev/ui-fixtures/<id>/stream instead of
// /api/turn/stream and reads it with the same DataStreamDecoder reader, and
// the kit's Thread renders it with the chat page's own reasoning, sources
// and tool parts. Nothing is stored.
const PACES: ShowcasePace[] = ["instant", "normal", "slow"];
const PACE_LABELS: Record<string, string> = { instant: "Instant", normal: "Normal pace", slow: "Slow pace" };
type Settle = "ready" | "error" | "idle" | "waiting" | "responding";

function ShowcaseWorkspace({ scenarios, pace, setPace, banner, setScenario, settleRef }: {
  scenarios: ShowcaseScenario[];
  pace: ShowcasePace;
  setPace: (pace: ShowcasePace) => void;
  banner: string | null;
  setScenario: (id: string) => void;
  settleRef: React.MutableRefObject<((state: Settle) => void) | null>;
}) {
  const aui = useAui();
  const [current, setCurrent] = useState<string | null>(null);
  const [playingAll, setPlayingAll] = useState(false);
  const stopAll = useRef(false);

  const send = useCallback((scenario: ShowcaseScenario) => {
    setCurrent(scenario.id);
    setScenario(scenario.id);
    // Through the composer, as a person's own send goes: a failure scenario
    // rejects its run by design and the thread shows it as the message's error.
    aui.composer().setText(`Show: ${scenario.title}`);
    aui.composer().send();
  }, [aui, setScenario]);

  const playAll = async () => {
    stopAll.current = false;
    setPlayingAll(true);
    aui.thread().reset();
    for (const scenario of scenarios) {
      if (stopAll.current) break;
      const done = new Promise<void>((resolve) => { settleRef.current = (state) => { if (state === "ready" || state === "error" || state === "idle") resolve(); }; });
      send(scenario);
      await done;
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
    settleRef.current = null;
    setPlayingAll(false);
  };

  const stop = () => {
    stopAll.current = true;
    aui.thread().cancelRun();
  };

  const scenarioIds = useMemo(() => new Set(scenarios.map((scenario) => scenario.id)), [scenarios]);
  return (
    <div className="flex h-full min-h-0 flex-col">
    <p className="px-4 text-sm text-muted-foreground" data-slot="live-in-chat-count">Live in chat: {scenarios.filter((scenario) => scenario.live_in_chat === "yes").length} of {scenarios.length} scenarios</p>
    <ElementsAdoptionPanel scenarioIds={scenarioIds} liveByScenario={Object.fromEntries(scenarios.map((scenario) => [scenario.id, scenario.live_in_chat]))} onPlay={(id) => { const scenario = scenarios.find((entry) => entry.id === id); if (scenario) send(scenario); }} />
    <div className="min-h-0 flex-1">
    <SplitView
      detailOpen={current !== null}
      listLabel="Scenarios"
      detailLabel="Chat"
      list={
        <div className="flex flex-col gap-2 p-2">
          <div className="flex flex-wrap items-center gap-2 px-2">
            <Select value={pace} onValueChange={(value) => setPace(value as ShowcasePace)} options={PACES} getLabel={(value) => PACE_LABELS[value] ?? value} aria-label="Streaming pace" />
            <Button onClick={() => void playAll()} disabled={playingAll}>Play all</Button>
            <Button variant="outline" onClick={stop}>Stop</Button>
            <Button variant="outline" onClick={() => { stop(); aui.thread().reset(); setCurrent(null); }}>Clear</Button>
          </div>
          <List
            label="Scenarios"
            items={scenarios}
            getKey={(scenario) => scenario.id}
            isSelected={(scenario) => scenario.id === current}
            getLabel={(scenario) => `${scenario.title}. ${scenario.description}`}
            onSelect={send}
            renderItem={(scenario) => (
              <span className="flex min-w-0 flex-col py-1">
                <span className="font-medium">{scenario.title}</span>
                <span className="text-sm text-muted-foreground">{scenario.description}</span>
                <span className="pt-1"><Badge variant={scenario.live_in_chat === "yes" ? "default" : "outline"}>{scenario.live_in_chat === "yes" ? "Live in chat" : `Needs: ${scenario.live_in_chat.replace(/^needs: /, "")}`}</Badge></span>
              </span>
            )}
          />
        </div>
      }
      detail={
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex items-center gap-2 border-b border-border px-2 py-1 sm:hidden">
            <Button variant="ghost" onClick={() => setCurrent(null)}>Scenarios</Button>
          </div>
          {banner ? (
            <Alert className="mx-4 mt-2 mb-2">
              <AlertDescription>{banner}</AlertDescription>
            </Alert>
          ) : null}
          <div className="min-h-0 flex-1">
            <Thread
              components={{
                AssistantMoreItems,
                AssistantActionBarExtra: SourcesActionBarTrigger,
                AssistantMessageFooterExtra: MessageFooterExtra,
                Indicator: ChatThinkingIndicator,
                ReasoningGroup: NextReasoningGroup,
              }}
            />
          </div>
        </div>
      }
    />
    </div>
    </div>
  );
}

export function NextUiShowcasePage({ person }: { person: Roster }) {
  useDocumentTitle("Chat showcase");
  const query = useQuery({ queryKey: ["dev-ui-fixtures"], queryFn: listShowcaseScenarios, retry: false });
  const [pace, setPace] = useState<ShowcasePace>("normal");
  const paceRef = useRef(pace);
  useEffect(() => { paceRef.current = pace; }, [pace]);
  const [banner, setBanner] = useState<string | null>(null);
  const [openSources, setOpenSources] = useState<ReadonlySet<string>>(new Set());
  const settleRef = useRef<((state: Settle) => void) | null>(null);
  const scenarioRef = useRef<string>("table");
  const sourcesValue = useMemo(() => ({
    isOpen: (turnId: string) => openSources.has(turnId),
    toggle: (turnId: string) => setOpenSources((prev) => { const next = new Set(prev); if (next.has(turnId)) next.delete(turnId); else next.add(turnId); return next; }),
    close: (turnId: string) => setOpenSources((prev) => { const next = new Set(prev); next.delete(turnId); return next; }),
  }), [openSources]);

  const adapter = useMemo(() => createChatModelAdapter({
    consumeSupersedes: () => undefined,
    onCrisisResources: setBanner,
    turnSchedulerRef: { current: null },
    speakReplies: false,
    onReplyState: (state) => {
      if (state === "waiting") setBanner(null);
      settleRef.current?.(state);
    },
    openStream: (_text, signal) => openShowcaseStream(scenarioRef.current, paceRef.current, signal),
  }), []);
  const runtime = useLocalRuntime(adapter);

  return (
    <AdminGatedContent title="Chat showcase" person={person} deniedText="The Chat showcase is for owners and admins.">
      {/* The chat page's own full-height slot (tokens.css keys its rules on this
          data-slot), so the thread scrolls inside the viewport instead of the page. */}
      <div data-slot="next-chat-shell" className="flex h-full flex-col overflow-hidden">
      <Page title="Chat showcase">
        <AsyncState data={query.isError ? null : query.data} error={query.isError} isFetching={query.isFetching} onRetry={() => void query.refetch()} errorMessage={query.error?.message}>
          {(scenarios) => (
            <AssistantRuntimeProvider runtime={runtime}>
              <AdminContext.Provider value>
                <SourcesOpenContext.Provider value={sourcesValue}>
                  <StructuredResultTools />
                  <ToolTimelineTool />
                  <SuppressSourcesFallback />
                  <ShowcaseWorkspace scenarios={scenarios} pace={pace} setPace={setPace} banner={banner} setScenario={(id) => { scenarioRef.current = id; }} settleRef={settleRef} />
                </SourcesOpenContext.Provider>
              </AdminContext.Provider>
            </AssistantRuntimeProvider>
          )}
        </AsyncState>
      </Page>
      </div>
    </AdminGatedContent>
  );
}
