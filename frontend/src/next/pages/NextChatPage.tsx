import { createContext, useContext, useEffect, useMemo, useRef, useState, type FocusEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ActionBarMorePrimitive, AssistantRuntimeProvider, useAssistantToolUI, useAui, useAuiState, useLocalRuntime, useRemoteThreadListRuntime, type ToolCallMessagePartComponent } from "@assistant-ui/react";
import { Thread } from "@maipai/ui/src/elements/thread.aui";
import { ThreadListItems, ThreadListNew, ThreadListRoot, ThreadListSearch } from "@maipai/ui/src/elements/thread-list.aui";
import { SpecSheet } from "@maipai/ui/src/elements/spec-sheet";
import { ArtifactCard } from "@maipai/ui/src/elements/artifact-card";
import { Sources } from "@maipai/ui/src/elements/sources";
import { CanvasSplit, CanvasSplitBody, CanvasSplitDocument, CanvasSplitHeader, CanvasSplitLine, CanvasSplitMessage, CanvasSplitThread } from "@maipai/ui/src/elements/canvas-split";
import { Alert, AlertDescription } from "@maipai/ui/src/dashboard/components/ui/alert";
import { Button } from "@maipai/ui/src/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@maipai/ui/src/ui/sheet";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { getIcon } from "@maipai/ui/src/icons";
import { cn } from "@maipai/ui/src/utils";
import { api, ApiError, isOwnerOrAdminRole, readBareCompareStream, type BareCompareTrace, type Roster, type StructuredPart } from "@/lib/api";
import type { Source } from "@maipai/spec/gen/ts/source.js";
import { createChatModelAdapter } from "@/apps/chat/chatModelAdapter";
import { createChatThreadListAdapter } from "@/apps/chat/chatThreadListAdapter";
import { createChatFeedbackAdapter } from "@/apps/chat/chatActionBar";
import { createChatSpeechAdapter } from "@/apps/chat/chatSpeechAdapter";
import { messageText } from "@/apps/chat/chatMessageText";
import type { SentenceSpeechScheduler } from "@/lib/sentenceSpeechScheduler";

const HistoryIcon = getIcon("history");
const PanelLeftIcon = getIcon("panel-left");
// ADMIN-COMPARE-01: no icon in the kit's own registry reads as "compare"
// specifically - grid-2x2 (a two-pane split) is the closest already-
// registered fit, chosen over adding a new one to keep this item to the
// one kit tag it already needed for the action bars themselves.
const CompareIcon = getIcon("grid-2x2");

// SHELL-02 slice 3, the wiring table's "spec-sheet" row: weather's and
// almanac-date's own structured result (chatModelAdapter.ts's own
// tool-call part, built from `structured_part`) renders through the
// shipped Element, never Home-drawn prose. `useAssistantToolUI` is
// `@assistant-ui/react`'s own deprecated-but-supported render-only
// registration (its replacement, a client toolkit's own `render`, is
// shaped for a tool the FRONTEND can invoke - `parameters`, `execute` -
// which nothing here is: every package these results come from already
// ran, server-side, before this reply ever streamed). `visibleCount`
// is the whole row set - `SpecSheet`'s own progressive-reveal knob has
// nothing to progress against on an already-complete result. Any tool
// call whose name isn't registered here still renders through Thread's
// own built-in `ToolFallback` (thread.aui.tsx's default), unchanged.
const SpecSheetToolRender: ToolCallMessagePartComponent<Record<string, never>, StructuredPart> = ({ result }) => {
  if (!result) return null;
  return <SpecSheet title={result.title} subtitle={result.subtitle} rows={result.rows} visibleCount={result.rows.length} />;
};

function StructuredResultTools() {
  // `display: "standalone"` (AssistantToolUIProps's own option): without
  // it, Thread's own chain-of-thought grouping tucks a tool-call part
  // behind a collapsed "1 tool call" trigger by default (found live -
  // a weather card nobody can see without an extra click is a real
  // regression for a family hub, not a cosmetic nit).
  useAssistantToolUI({ toolName: "weather", render: SpecSheetToolRender, display: "standalone" });
  useAssistantToolUI({ toolName: "almanac-date", render: SpecSheetToolRender, display: "standalone" });
  return null;
}

// SHELL-02 slice 4: the artifact-card row of the wiring table.
// `useAssistantToolUI`'s own `result` is only ever `{id, version}`
// (chatModelAdapter.ts/chatHistoryAdapter.ts's own comment on why: the
// wire and the reload row both name a version, never carry its body) -
// the card fetches the CURRENT version itself (`api.artifactCurrent`,
// not the bare per-version read) so its own title/kind stay fresh the
// same way the open canvas does, if a later turn updates this exact
// artifact before the card is ever clicked.
const ArtifactOpenContext = createContext<(id: string) => void>(() => {});

// ADMIN-COMPARE-01: the same two-context shape as the artifact panel
// above (an "open" callback threaded down through context, since
// AssistantMoreItems is a bare ComponentType slot with no props of its
// own) - `AdminContext` for the one gate this whole action needs, so it
// never shows for anyone who'd just get a 403 from the route.
const AdminContext = createContext(false);
type CompareTarget = { turnId: string; conversationId: string; ourText: string };
const CompareOpenContext = createContext<(target: CompareTarget) => void>(() => {});

/** slice 5(e): the "..." menu's second entry (Details, the stats reveal,
 * is a separate, later item - COORDINATOR named both for this same menu
 * so it's touched once, but Details has nothing to show yet). Admin-only
 * on both sides: hidden here for anyone else, and POST /api/turn/bare
 * itself 403s regardless, so this is convenience, not the real gate. */
function CompareWithBareModelMenuItem() {
  const isAdmin = useContext(AdminContext);
  const openCompare = useContext(CompareOpenContext);
  const turnId = useAuiState((s) => s.message.metadata?.custom?.turnId as string | undefined);
  const conversationId = useAuiState((s) => s.message.metadata?.custom?.conversationId as string | undefined);
  const text = useAuiState((s) => messageText(s.message));
  if (!isAdmin) return null;
  return (
    <ActionBarMorePrimitive.Item
      className="aui-action-bar-more-item hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm outline-none select-none disabled:pointer-events-none disabled:opacity-50"
      disabled={!turnId || !conversationId}
      onSelect={(e) => {
        e.preventDefault();
        if (!turnId || !conversationId) return;
        openCompare({ turnId, conversationId, ourText: text });
      }}
    >
      <CompareIcon className="size-4" />
      {!turnId || !conversationId ? "Compare (available once saved)" : "Compare with the bare model"}
    </ActionBarMorePrimitive.Item>
  );
}

function AssistantMoreItems() {
  return <CompareWithBareModelMenuItem />;
}

const ArtifactCardToolRender: ToolCallMessagePartComponent<Record<string, never>, { id: string; version: number }> = ({ result }) => {
  const openArtifact = useContext(ArtifactOpenContext);
  const query = useQuery({
    queryKey: ["artifact-current", result?.id],
    queryFn: () => api.artifactCurrent(result!.id),
    enabled: result !== undefined,
  });
  if (!result) return null;
  const data = query.data;
  // A code review caught this: on a failed fetch (the artifact later
  // deleted, a transient network error), `isLoading` settles to false
  // with `data` still undefined - without this branch the card was
  // stuck reading a non-spinning "Loading..." forever, never an error.
  const meta = data ? `${data.kind} · v${data.version}` : query.isError ? "Not available right now" : "Loading…";
  return (
    <ArtifactCard
      title={data?.title ?? "Document"}
      meta={meta}
      generating={query.isLoading}
      onClick={() => openArtifact(result.id)}
    />
  );
};

function ArtifactTool() {
  useAssistantToolUI({ toolName: "write_document", render: ArtifactCardToolRender, display: "standalone" });
  return null;
}

// Slice 5(a): the kit's own `Sources` (elements/sources.tsx), used exactly
// as it ships - never the retired page's `blocks/chat/SourcesCard`, the
// pre-2026-09-21 kit block this shell rebuild is retiring page by page.
// Its own `Source` shape (`{domain, title}`) is narrower than spec's real
// citation record - `domain` reads spec's `site` field (source.schema.json's
// own description of `site`: "the hostname a citation chip shows," exactly
// what `domain` means here); `url`/`snippet`/`kind`/`id` have nowhere to go
// in the shipped card. Two real gaps in the shipped Element itself, named
// in docs/dev.md rather than reached around: its rows are `<div>`s with no
// `href` (a source can't be opened - filed as a kit ask), and it keys each
// row by `domain` (`elements/sources.tsx:53`), which collides when a reply
// cites two different pages on the same site - not deduped here (that
// would drop a real citation), filed as a kit ask (key by index instead).
const SourcesToolRender: ToolCallMessagePartComponent<Record<string, never>, Source[]> = ({ result }) => {
  const [open, setOpen] = useState(false);
  if (!result?.length) return null;
  return <Sources sources={result.map((source) => ({ domain: source.site, title: source.title }))} open={open} onOpenChange={setOpen} />;
};

function SourcesTool() {
  useAssistantToolUI({ toolName: "sources", render: SourcesToolRender, display: "standalone" });
  return null;
}

/** canvas-split's own acceptance: opens beside the thread, closing
 * keeps the thread, a later turn's update to the same artifact
 * replaces the pane's content. The last one comes free of any id
 * bookkeeping: `api.artifactCurrent()` always resolves through the
 * artifact's own key server-side (routes/artifacts.ts's `/current`),
 * so re-fetching the SAME `openArtifactId` after a new turn completes
 * is enough - `NextChatPage`'s own effect invalidates the query
 * whenever the thread's message count changes, the simplest real
 * signal "a turn just finished." No mini transcript reconstruction
 * (`CanvasSplitThread`/`CanvasSplitMessage`, used exactly as shipped
 * below): fetching the triggering turn's own user message would be a
 * second round trip this slice doesn't need yet, so this shows the
 * document's own title as the one assistant-side line instead of
 * inventing dialogue. */
function ArtifactCanvasPanel({ artifactId, onClose }: { artifactId: string; onClose: () => void }) {
  const query = useQuery({ queryKey: ["artifact-current", artifactId], queryFn: () => api.artifactCurrent(artifactId) });
  return (
    <CanvasSplit>
      <CanvasSplitThread>
        <CanvasSplitMessage speaker="assistant">{query.data ? `Wrote "${query.data.title}."` : "Wrote the document."}</CanvasSplitMessage>
      </CanvasSplitThread>
      <CanvasSplitDocument>
        <AsyncState
          data={query.data}
          error={query.isError}
          isFetching={query.isFetching}
          onRetry={() => void query.refetch()}
          errorMessage={query.error instanceof ApiError ? query.error.message : "Could not load this document."}
          loadingLabel="Loading document"
        >
          {(artifact) => (
            <>
              <CanvasSplitHeader title={artifact.title} version={artifact.version} saved onCopy={() => void navigator.clipboard.writeText(artifact.body)} onClose={onClose} />
              <CanvasSplitBody>
                {artifact.body.split("\n").map((line, index) => (
                  // No stable id in a plain-text body: index is fine,
                  // this list never reorders itself, only refetches as
                  // a whole.
                  <CanvasSplitLine key={index}>{line || " "}</CanvasSplitLine>
                ))}
              </CanvasSplitBody>
            </>
          )}
        </AsyncState>
      </CanvasSplitDocument>
    </CanvasSplit>
  );
}

/** ADMIN-COMPARE-01: "Compare with the bare model" opens this beside the
 * thread, the same `CanvasSplit` the artifact panel above uses - a bare
 * container (`flex ... md:flex-row`, nothing hardwired to one document)
 * composed TWICE here, ours and the bare model's own reply side by side,
 * rather than forked or given a second Element. `version`/`saved` on
 * `CanvasSplitHeader` are the artifact shape's own fields (no real
 * "version" concept for either side of a compare) - both panes read
 * `version={1} saved` so the shipped header renders its normal "saved"
 * state instead of a half-finished "editing" one neither pane is ever
 * actually in. */
function BareCompareCanvasPanel({ target, onClose }: { target: CompareTarget; onClose: () => void }) {
  const [trace, setTrace] = useState<BareCompareTrace | null>(null);
  const [bareText, setBareText] = useState("");
  const [refused, setRefused] = useState(false);
  const [status, setStatus] = useState<"loading" | "streaming" | "done" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setTrace(null);
    setBareText("");
    setRefused(false);
    setStatus("loading");
    setErrorMessage(null);
    (async () => {
      try {
        const response = await api.compareTurnBare(target.conversationId, target.turnId, controller.signal);
        for await (const event of readBareCompareStream(response)) {
          if (event.type === "trace") {
            setTrace(event.trace);
            setStatus("streaming");
          } else if (event.type === "delta") {
            setBareText((text) => text + event.text);
            setStatus("streaming");
          } else if (event.type === "refused") {
            setRefused(true);
          } else if (event.type === "done") {
            setStatus("done");
          }
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        setStatus("error");
        setErrorMessage(err instanceof ApiError ? err.message : "Could not compare with the bare model.");
      }
    })();
    return () => controller.abort();
  }, [target.conversationId, target.turnId]);

  return (
    <CanvasSplit>
      <CanvasSplitDocument>
        <CanvasSplitHeader title="Ours" version={1} saved onCopy={() => void navigator.clipboard.writeText(target.ourText)} onClose={onClose} />
        <CanvasSplitBody>
          <CanvasSplitLine>{target.ourText}</CanvasSplitLine>
          {trace ? (
            <>
              <CanvasSplitLine heading>Trace</CanvasSplitLine>
              <CanvasSplitLine>Rung: {trace.rung ?? "none"}</CanvasSplitLine>
              <CanvasSplitLine>
                Route: {trace.routing_tier ?? "model"}
                {trace.routing_score !== null ? ` (${trace.routing_score.toFixed(2)})` : ""}
              </CanvasSplitLine>
              <CanvasSplitLine>Rules fired: {trace.rules.length > 0 ? trace.rules.join(", ") : "none"}</CanvasSplitLine>
              <CanvasSplitLine>Guard: {trace.guard_reason ?? "none"}</CanvasSplitLine>
              <CanvasSplitLine>Thinking: {trace.stats?.thinking ? "on" : "off"}</CanvasSplitLine>
              <CanvasSplitLine>Model: {trace.stats?.engine ?? "unknown"}</CanvasSplitLine>
              <CanvasSplitLine>Persona in effect: {trace.persona_fragments || "none"}</CanvasSplitLine>
            </>
          ) : null}
        </CanvasSplitBody>
      </CanvasSplitDocument>
      <CanvasSplitDocument>
        <CanvasSplitHeader title="Bare model" version={1} saved onCopy={() => void navigator.clipboard.writeText(bareText)} onClose={onClose} />
        <CanvasSplitBody writing={status === "streaming"}>
          {status === "loading" ? <CanvasSplitLine>Asking the bare model…</CanvasSplitLine> : null}
          {status === "error" ? <CanvasSplitLine>{errorMessage}</CanvasSplitLine> : null}
          {bareText ? <CanvasSplitLine>{bareText}</CanvasSplitLine> : null}
          {refused ? <CanvasSplitLine>The bare reply was refused by the same safety pass a real turn uses.</CanvasSplitLine> : null}
        </CanvasSplitBody>
      </CanvasSplitDocument>
    </CanvasSplit>
  );
}

/** /next/chat: SHELL-02's slice 2 (docs/plans/shell-on-shadcndashboard-
 * 2026-09-21.md's own wiring table) - the Elements thread LIST
 * (ui/src/elements/thread-list.aui.tsx, self-contained: New Thread,
 * search, grouped items, rename, delete) joins slice 1's thread on
 * Home's existing thread-list adapter (chatThreadListAdapter.ts,
 * already proven by ChatPage.tsx): open a past conversation, continue
 * it, start a new one, delete one. `getConversationId` is real now
 * (`useRemoteThreadListRuntime`'s own `runtimeHook`, ChatPage.tsx's
 * exact pattern) - slice 1's "no thread list, so no id to resolve"
 * comment no longer applies.
 *
 * No Pin here: the shipped Element's own "more" menu is Rename /
 * Archive / Delete, not Rename / Pin / Delete - the OLD shell's own
 * `assistant-ui/thread-list.aui.tsx` (Home's own product composition,
 * outside the vendored path) added Pin by hand against
 * `updateCustom({pinned})`; the vendored Elements version never grew
 * that action, and forking it to add one would be exactly what "the
 * kit wraps and composes, it does not fork" forbids. Archive itself
 * stays wired to `chatThreadListAdapter.ts`'s own deliberate refusal
 * ("the shared record has no archive state") - that decision predates
 * this slice and isn't this slice's call to revisit.
 *
 * Slice 3 (tools and generative UI): weather's and almanac-date's own
 * structured result renders through the shipped `SpecSheet` Element
 * (`StructuredResultTools` above), keyed on the producing package's
 * real name - a package with a plain-text result is unaffected, and
 * every other tool call still renders through Thread's own built-in
 * `ToolFallback` (running/complete/fallback states, already shipped,
 * no wiring needed). Known gap, found in review, not this slice's own
 * call to fix (getmaipai/home#130): `structured_part` is computed
 * fresh on the live `done` event (chatModelAdapter.ts) but never
 * persisted - `conversation_turns` has no column for it, so
 * chatHistoryAdapter.ts's own reload path has nothing to rebuild a
 * tool-call part from. A spec-sheet card renders for the live turn,
 * then reverts to plain text the moment the page reloads or the
 * thread is reopened.
 *
 * Slice 4 (artifacts): the `write_document` package's own record
 * (`TurnValue.artifact`/the reload row's own `artifact` field, both
 * `{id, version}` only) renders as `ArtifactCard` inline
 * (`ArtifactTool` below), keyed on the one bundled package that
 * writes this record today. Clicking it opens `ArtifactCanvasPanel`
 * beside the thread on desktop, as a bottom Sheet on phone/tablet
 * (mirroring the retired `chatDocumentPane.tsx`'s own split); closing
 * it clears `openArtifactId`, never touches the thread. Unlike
 * `structured_part` (getmaipai/home#130), this survives reload: the
 * artifact record is really stored, so `api.artifactCurrent()`
 * resolves it fresh every time, live turn or history alike.
 *
 * Suggestions and attachments are each their own follow-up slice (the
 * wiring table's remaining rows). `speakReplies: false` still holds -
 * no "stop speaking" control on screen yet. */
// The shipped `<ThreadList>` (thread-list.aui.tsx's own default export)
// hardcodes its own `<ThreadListNew>` with no way to hand it a click
// handler - composed here instead from that same file's other exported
// pieces (its own implementation, mirrored exactly) so New Thread can
// also close the phone/tablet Sheet, the same way selecting an
// existing thread already does. `ThreadListPrimitive.New`'s own onClick
// is composed with (not replaced by) the one passed here
// (radix-ui's composeEventHandlers, confirmed in the installed
// package) - both fire, so this changes nothing about starting a new
// thread itself.
// CHAT-UI-02: the desktop rail-collapse toggle rides in this row,
// beside New Thread, rather than a row of its own above the column.
// Jesse's own literal spec (22:22, after 22:04's "no floating placement"
// landed the column itself but left the toggle floating and oversized):
// in the open and peeked states the toggle is an INLINE element of this
// row, in normal flow, the same size as the row's other icon buttons -
// never absolutely positioned, never painted over New Thread or
// anything else. Only the collapsed state (this row isn't rendered at
// all - the column is `hidden`) gets a second, identically-sized
// floating button at the row's own former top-left, since there's
// nothing left in flow to place it inline with. The mobile Sheet's own
// instance passes no `collapseToggle` (it has no collapse of its own),
// so nothing renders there.
function NextThreadList({ onNewThread, collapseToggle }: { onNewThread: () => void; collapseToggle?: ReactNode }) {
  const [search, setSearch] = useState("");
  const hasThreads = useAuiState((s) => s.threads.threadIds.length > 0);
  return (
    <ThreadListRoot>
      <div className="flex items-center gap-1">
        {collapseToggle}
        <ThreadListNew onClick={onNewThread} className="flex-1" />
      </div>
      {hasThreads && <ThreadListSearch value={search} onValueChange={setSearch} />}
      <ThreadListItems searchQuery={hasThreads ? search : ""} />
    </ThreadListRoot>
  );
}

function useNextChatRuntime(person: Roster, closeSheet: () => void) {
  const turnSchedulerRef = useRef<SentenceSpeechScheduler | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  const threadListAdapter = useMemo(() => createChatThreadListAdapter(person.display_name), [person.display_name]);

  // A named, `use`-prefixed function, not an inline arrow - ChatPage.tsx's
  // own comment on why: `useRemoteThreadListRuntime` calls `runtimeHook`
  // from inside its own render, so react-hooks/rules-of-hooks needs the
  // naming convention to recognize this as a real hook call.
  function useChatRuntimeHook() {
    const aui = useAui();
    const chatModelAdapter = useMemo(
      () =>
        createChatModelAdapter({
          getConversationId: async () => {
            const { remoteId } = await aui.threadListItem().initialize();
            await api.resumeConversation(remoteId);
            return remoteId;
          },
          consumeThinking: () => true,
          consumeSupersedes: () => undefined,
          onCrisisResources: setBanner,
          turnSchedulerRef,
          speakReplies: false,
        }),
      [aui],
    );
    // slice 5(e): thumbs and read-aloud both ride the shipped
    // capability/adapter mechanism (`s.thread.capabilities.feedback`/
    // `.speech`), the reason the kit's own AssistantActionBar can just
    // render ActionBarPrimitive.FeedbackPositive/Negative and .Speak/
    // .StopSpeaking with no Home-side plumbing beyond these two - the
    // feedback adapter is the old chat's own (chatActionBar.tsx, its
    // real POST /api/conversations/turns/:id/feedback route), unchanged;
    // the speech adapter is new (chatSpeechAdapter.ts), the identical
    // POST /api/tts pieces chatListenStore.ts's own "Listen" replay
    // already uses, wired through the runtime instead of a second store.
    const adapters = useMemo(() => ({ feedback: createChatFeedbackAdapter(), speech: createChatSpeechAdapter() }), []);
    return useLocalRuntime(chatModelAdapter, { adapters });
  }

  const runtime = useRemoteThreadListRuntime({
    runtimeHook: useChatRuntimeHook,
    adapter: threadListAdapter,
    threadId: searchParams.get("conversation") ?? undefined,
    onThreadIdChange: (id) => {
      setSearchParams(id ? { conversation: id } : {}, { replace: true });
      closeSheet();
    },
  });

  return { runtime, banner };
}

/** Mounted inside AssistantRuntimeProvider only for its side effect: a
 * later turn's own message lands in the thread, and that is the signal
 * ("a turn just finished") that any open artifact-canvas query should
 * refetch, since a reply may have updated the exact artifact id it's
 * showing. No thread-id bookkeeping needed - `api.artifactCurrent()`
 * resolves through the artifactKey server-side either way. */
function ArtifactCacheInvalidator() {
  const queryClient = useQueryClient();
  const messageCount = useAuiState((s) => s.thread.messages.length);
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: ["artifact-current"] });
  }, [messageCount, queryClient]);
  return null;
}

export function NextChatPage({ person }: { person: Roster }) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [openArtifactId, setOpenArtifactId] = useState<string | null>(null);
  // ADMIN-COMPARE-01: the identical desktop-pane/mobile-sheet split
  // openArtifactId already has, one state slot instead of a whole second
  // "which panel is open" enum - only ever one of the two is non-null in
  // practice (comparing a message closes the artifact view and vice
  // versa would be reasonable too, but nothing forces it; both panels
  // rendering at once on a wide enough screen is a fine, harmless state).
  const [compareTarget, setCompareTarget] = useState<CompareTarget | null>(null);
  // CHAT-UI-01 finding 4 / CHAT-UI-02: a ChatGPT-style collapse for the
  // desktop thread-list column. The shipped Sidebar primitive's own
  // collapsible modes (threadlist-sidebar.aui.tsx's own composition)
  // render `position: fixed` against the viewport's own left edge -
  // built for being the page's ONE top-level sidebar, not a second
  // column nested beside one that's already there (it would render
  // under or over the app rail, not after it). Nothing here forks that
  // primitive or hand-builds a new one: this toggles the same plain
  // column this file already had, the identical pattern `sheetOpen`
  // already uses for the phone/tablet Sheet.
  //
  // Jesse's literal spec for the peek (22:04), after floating-placement
  // attempts against the kit's HoverCard (Base UI's PreviewCard, whose
  // own floating-ui portal never lands on a DIFFERENT sibling element's
  // box in general - tried side/align/offset math against the trigger,
  // then overriding the portal's own Positioner element directly, both
  // measured live and wrong): no floating placement at all. The column
  // is one node that always lives in this page's own layout at its own
  // slot - open is normal flow, collapsed is `hidden` (width 0, out of
  // the accessibility tree, same as before CHAT-UI-02), peeked is the
  // SAME node repositioned with `position: absolute; inset-y-0; left-0`
  // inside the row below (`relative`, sitting below the app header, so
  // the overlay can never leave the chat area), at its normal open
  // width, layered above the thread. No JS-measured rect, no portal, no
  // effect: plain Tailwind classes keyed off two booleans, so the peeked
  // box is pixel-identical to the open box by construction rather than
  // by measurement.
  //
  // The toggle itself, refined again (22:22): a first pass floated one
  // button over the column's own top-left in every state, which read as
  // an oversized control painted on top of New Thread instead of
  // belonging to the row. Open and peeked now render an INLINE toggle
  // (`NextThreadList`'s own `collapseToggle` slot, first cell of its
  // header row, the same icon-button size as its other controls) - true
  // flow, not absolute, so it never floats over anything. Only the
  // collapsed state has no row to be inline WITH (the column is
  // `hidden`), so that state alone gets a second, identically-styled
  // button positioned at the row's own former top-left. Exactly one of
  // the two is ever mounted. Closing the peek keys off pointer-leave of
  // the column itself (`next-chat-rail`): the inline toggle is now a
  // real DESCENDANT of it (not a `display: contents` sibling, the
  // approach a review on an earlier draft found never received the
  // browser's own pointerleave - `display: contents` drops an element
  // from the rendered box tree Chromium's own hover-tracking hit-tests
  // against), so the ancestor-chain firing native pointerleave already
  // does works with no dead zone and no manual relatedTarget check
  // needed for this pair.
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [railPeeked, setRailPeeked] = useState(false);
  const closeRailPeek = (relatedTarget: EventTarget | null) => {
    if (!railCollapsed) return;
    const rail = document.getElementById("next-chat-rail");
    if (relatedTarget instanceof Node && rail?.contains(relatedTarget)) return;
    setRailPeeked(false);
  };
  // A review caught this: since the inline and collapsed toggles are two
  // separate `Button` instances (never both mounted at once), a keyboard
  // user who Tabs onto whichever one is visible and triggers the state
  // change that swaps them (focus opens the peek, same as hover) loses
  // focus outright when the DOM node they were on unmounts - the browser
  // has nothing to transfer it to on its own, so it reverts to `<body>`,
  // and the next Tab restarts from the top of the document instead of
  // continuing into the now-visible column.
  // A first fix (`document.activeElement === document.body` as the
  // signal that focus was just lost) went back on re-review: that check
  // can't tell "a focused node just unmounted" apart from "nothing has
  // ever been focused," true for both the initial mount and every
  // mouse-only interaction (`onPointerEnter` shares the same
  // peek-opening logic as `onFocus`) - a mouse user hovering the
  // collapsed toggle to peek, then moving the pointer away, would have
  // had keyboard focus silently forced onto them, and the very first
  // render would have stolen it on load. Fixed with an explicit intent
  // flag instead of inferring one: only `onFocus` and `onClick` (real
  // interactions with the toggle itself, never the passive
  // `onPointerEnter` a hover also fires) set it, so the effect only ever
  // follows focus after a person actually interacted with the specific
  // node that's about to unmount.
  // A second bug, found only by actually running this: the effect's own
  // `target.focus()` call fires that button's real `onFocus` handler
  // too (a programmatic `.focus()` dispatches the same event a person
  // tabbing in would), so `handleToggleFocus` immediately re-armed
  // `pendingToggleFocusRef` and re-ran `handleToggleEnter()` - on a
  // COLLAPSED toggle, that opened the peek as a side effect of merely
  // restoring focus to it, which flipped `railPeeked` again, which
  // re-ran this same effect: a real cascade, live and in the test suite
  // both. A transient boolean guard around the `.focus()` call was tried
  // first and dropped: it assumes the resulting `focus` event dispatches
  // synchronously, which happy-dom doesn't do, so the guard was already
  // cleared by the time the handler ran. Fixed with identity instead of
  // timing: `programmaticFocusTargetRef` records WHICH node the effect
  // is about to focus, and `handleToggleFocus` ignores an event whose
  // `currentTarget` is that exact node - correct no matter when the
  // event actually fires, since nothing else in this component calls
  // `.focus()` in between.
  // A re-review caught one more gap: if `target.focus()` never actually
  // moves focus (below the `lg` breakpoint, `collapsedToggle` is
  // `hidden`, so calling `.focus()` on it is a no-op in every real
  // browser - no `focus` event ever fires), nothing ever clears
  // `programmaticFocusTargetRef`, so a LATER genuine Tab onto that same
  // node (the viewport grown back past `lg`) would be silently
  // swallowed as "my own doing." A `requestAnimationFrame` fallback
  // clears it a frame later if the real focus event hasn't already done
  // so first - long enough for any real dispatch (sync or the next
  // microtask, either one lands well within a frame), short enough that
  // a node that was never actually focusable doesn't stay masked.
  // `target` itself is never null in practice: it's read from the same
  // conditional this effect's own dependencies mirror, and React
  // attaches refs during commit, strictly before effects run in that
  // same pass - by the time this runs, whichever toggle the condition
  // names has already mounted.
  const inlineToggleRef = useRef<HTMLButtonElement>(null);
  const collapsedToggleRef = useRef<HTMLButtonElement>(null);
  const pendingToggleFocusRef = useRef(false);
  const programmaticFocusTargetRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!pendingToggleFocusRef.current) return;
    pendingToggleFocusRef.current = false;
    const target = railCollapsed && !railPeeked ? collapsedToggleRef.current : inlineToggleRef.current;
    if (!target) return;
    programmaticFocusTargetRef.current = target;
    target.focus();
    const raf = requestAnimationFrame(() => {
      if (programmaticFocusTargetRef.current === target) programmaticFocusTargetRef.current = null;
    });
    return () => cancelAnimationFrame(raf);
  }, [railCollapsed, railPeeked]);
  // A code review caught this: switching threads (onThreadIdChange,
  // inside useNextChatRuntime) left a previous thread's artifact
  // canvas open over the newly-loaded one - the panel has to close on
  // the same signal the phone/tablet Sheet already does.
  const { runtime, banner } = useNextChatRuntime(person, () => {
    setSheetOpen(false);
    setOpenArtifactId(null);
    setCompareTarget(null);
  });
  // One base element, rendered at the phone/tablet Sheet and the
  // collapsed rail's own peek overlay - ChatPage.tsx's own fix for
  // exactly this (a code review caught two call sites drifting once one
  // grew props the other didn't). The persistent desktop rail gets its
  // own instance below, since it alone carries the collapse toggle.
  const threadList = <NextThreadList onNewThread={() => setSheetOpen(false)} />;
  const closeArtifact = () => setOpenArtifactId(null);
  const closeCompare = () => setCompareTarget(null);
  // The toggle (see the CHAT-UI-02 comment above the state
  // declarations): open and peeked render it inline, in
  // `NextThreadList`'s own header row; collapsed alone falls back to a
  // second, identically-styled instance positioned at that row's own
  // former top-left, since there's no row left to be inline with. Same
  // aria-label/expanded/handlers either way. Hover/focus opens the peek
  // while collapsed; the click always pins the rail fully open
  // (independent of hover) and clears `railPeeked` so a later collapse
  // never mounts already "peeked" from a stale hover.
  // A real defect Jesse found (Firefox, hard reload): clicking the open
  // toggle to collapse it left the pointer sitting over the exact spot
  // where the collapsed toggle instance now mounts - a browser
  // recomputes what's under a stationary pointer whenever the DOM
  // changes there, so it fired a "phantom" pointerenter on the new node
  // with no real mouse movement, which `handleToggleEnter` read as a
  // hover and immediately re-opened the peek, undoing the collapse's own
  // visible effect in the same frame (from Jesse's own eyes, the click
  // did nothing). `suppressHoverPeekRef` closes this: every click (either
  // direction, collapsing or pinning open - the SAME phantom-enter risk
  // exists for the inline/collapsed instance swap either way) sets it,
  // and only a REAL pointer-leave of whichever toggle instance is
  // currently mounted clears it, so the peek stays suppressed until the
  // pointer genuinely leaves and a later hover is a real one again. Only
  // `onPointerEnter` is gated by it - a genuine keyboard Tab onto the
  // toggle right after that same click (`handleToggleFocus` below) has
  // no phantom-recomputation risk analogous to a stationary mouse, and
  // must still open the peek immediately.
  const suppressHoverPeekRef = useRef(false);
  const openPeekIfCollapsed = () => {
    if (railCollapsed) setRailPeeked(true);
  };
  const handleToggleEnter = () => {
    if (suppressHoverPeekRef.current) return;
    openPeekIfCollapsed();
  };
  const handleToggleLeave = () => {
    suppressHoverPeekRef.current = false;
  };
  // Only a genuine interaction with the toggle itself - focusing it or
  // clicking it - ever sets the pending-focus flag the effect above
  // reads; `onPointerEnter` (a passive hover) shares `openPeekIfCollapsed`
  // for opening the peek but never touches the flag, exactly the
  // distinction the re-review's two false-positive cases needed.
  const handleToggleFocus = (e: FocusEvent<HTMLButtonElement>) => {
    if (programmaticFocusTargetRef.current === e.currentTarget) {
      programmaticFocusTargetRef.current = null;
      return;
    }
    pendingToggleFocusRef.current = true;
    openPeekIfCollapsed();
  };
  const handleToggleClick = () => {
    suppressHoverPeekRef.current = true;
    pendingToggleFocusRef.current = true;
    if (railCollapsed) {
      setRailCollapsed(false);
      setRailPeeked(false);
    } else {
      setRailCollapsed(true);
    }
  };
  const toggleLabel = railCollapsed ? "Show conversations" : "Hide conversations";
  const toggleExpanded = !railCollapsed || railPeeked;
  const inlineToggle = (
    <Button
      ref={inlineToggleRef}
      variant="ghost"
      size="icon"
      aria-label={toggleLabel}
      aria-expanded={toggleExpanded}
      aria-controls="next-chat-rail"
      onPointerEnter={handleToggleEnter}
      onPointerLeave={handleToggleLeave}
      onFocus={handleToggleFocus}
      onClick={handleToggleClick}
    >
      <PanelLeftIcon className="size-4" />
    </Button>
  );
  const collapsedToggle = (
    <Button
      ref={collapsedToggleRef}
      variant="ghost"
      size="icon"
      aria-label={toggleLabel}
      aria-expanded={toggleExpanded}
      aria-controls="next-chat-rail"
      className="absolute top-0 left-0 z-20 hidden lg:flex"
      onPointerEnter={handleToggleEnter}
      onPointerLeave={handleToggleLeave}
      onFocus={handleToggleFocus}
      onClick={handleToggleClick}
    >
      <PanelLeftIcon className="size-4" />
    </Button>
  );

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ArtifactOpenContext.Provider value={setOpenArtifactId}>
      <AdminContext.Provider value={isOwnerOrAdminRole(person.role)}>
      <CompareOpenContext.Provider value={setCompareTarget}>
        <StructuredResultTools />
        <ArtifactTool />
        <SourcesTool />
        <ArtifactCacheInvalidator />
        {/* CHAT-UI-01 finding 3: `overflow-hidden` keeps this box's own
            height a hard ceiling, not a floor a growing composer or a
            streaming reply could push past - FullLayout.tsx's own
            wrapper around Outlet used to be `min-h-*`, not `h-*`, so any
            overflow here became real extra page height, and the page
            gaining and losing scroll range as content settled read as
            the composer bouncing. The thread viewport (Thread's own
            child) stays the only real scroller on this page.
            `h-full`, not a guessed `h-[calc(100vh-Npx)]`: tokens.css's
            own full-height rule block (keyed on this element's own
            `data-slot`) turns FullLayout.tsx's entire chain above this
            div into a real flex conduit down to the true available
            height, so this just reads it off that chain instead of
            re-deriving the same number a second, guessable way. */}
        <div data-slot="next-chat-shell" className="flex h-full flex-col overflow-hidden">
          {/* CHAT-UI-02: the desktop collapse toggle used to live in this
              row on its own, above the column, wasting a full row that
              only ever showed one button (this row's OTHER button, the
              mobile Sheet trigger, is `lg:hidden` - nothing here has ever
              been visible on desktop). It now floats over the column's own
              first cell at a fixed spot in every state (`railToggle`,
              below), so this row is mobile-only. */}
          <div className="flex items-center gap-1 border-b border-border pb-2 lg:hidden">
            <Button variant="ghost" size="icon" aria-label={sheetOpen ? "Hide threads" : "Show threads"} aria-expanded={sheetOpen} aria-controls="next-chat-threads" onClick={() => setSheetOpen((open) => !open)}>
              <HistoryIcon className="size-4" />
            </Button>
          </div>
          {banner ? (
            <Alert className="mx-4 mt-2 mb-2">
              <AlertDescription>{banner}</AlertDescription>
            </Alert>
          ) : null}
          <div className="relative flex min-h-0 flex-1 gap-4">
            {/* `lg:` not `sm:` - tokens.css's own --breakpoint-lg note
                (the kit's 960px default reopens a squeeze at tablet
                width), the same reason ChatPage.tsx's own persistent
                column uses it. This row is `relative`: the peeked
                rail's own `absolute inset-y-0 left-0` (below) resolves
                against IT, not the chat area, so the peeked box starts
                at this row's own left edge - exactly where the open
                rail sits - by construction, with nothing measured. */}
            {/* A code review caught this: `railCollapsed ? null : ...`
                unmounted the div entirely, so the toggle button's own
                `aria-controls="next-chat-rail"` pointed at an id absent
                from the DOM the moment it mattered most - the instant a
                screen reader announces the new collapsed state. Hidden
                via CSS instead (the same `hidden`/`lg:block` pattern
                already used for the phone/tablet breakpoint split), so
                the id always exists.
                Peeked: the SAME node, repositioned in place (Jesse's
                literal spec, 22:04) - `absolute inset-y-0 left-0` at its
                normal open width, inside this row's own `relative` box,
                above the thread (`z-20`). No portal, no measured rect:
                the peeked box is the open box's own CSS, so it's
                pixel-identical by construction. The toggle inside its
                header row is a real descendant now (22:22's inline
                fix), so `onPointerLeave`/`onBlur` here need no dead-zone
                handling beyond checking that the pointer/focus actually
                left this element altogether. */}
            <div
              id="next-chat-rail"
              className={cn(
                "overflow-y-auto border-r border-border bg-background pr-2",
                railCollapsed ? (railPeeked ? "absolute inset-y-0 left-0 z-20 block w-64 shadow-lg" : "hidden") : "hidden w-64 shrink-0 lg:block",
              )}
              onPointerLeave={(e) => closeRailPeek(e.relatedTarget)}
              onBlur={(e) => closeRailPeek(e.relatedTarget)}
            >
              <NextThreadList onNewThread={() => { setSheetOpen(false); setRailPeeked(false); }} collapseToggle={inlineToggle} />
            </div>
            {railCollapsed && !railPeeked ? collapsedToggle : null}
            <div className="min-w-0 flex-1">
              <Thread components={{ AssistantMoreItems }} />
            </div>
            {openArtifactId !== null ? (
              // Desktop only - the phone/tablet Sheet below covers the
              // same panel under `lg:hidden`, mirroring
              // chatDocumentPane.tsx's own split.
              <div className="hidden w-full max-w-xl shrink-0 overflow-y-auto lg:block">
                <ArtifactCanvasPanel artifactId={openArtifactId} onClose={closeArtifact} />
              </div>
            ) : null}
            {compareTarget !== null ? (
              <div className="hidden w-full max-w-3xl shrink-0 overflow-y-auto lg:block">
                <BareCompareCanvasPanel target={compareTarget} onClose={closeCompare} />
              </div>
            ) : null}
          </div>
        </div>
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetContent id="next-chat-threads" side="left" className="w-80 max-w-[calc(100vw-2rem)] gap-0 p-2 lg:hidden">
            <SheetHeader className="sr-only">
              <SheetTitle>Conversations</SheetTitle>
              <SheetDescription>Past conversations</SheetDescription>
            </SheetHeader>
            {threadList}
          </SheetContent>
        </Sheet>
        <Sheet open={openArtifactId !== null} onOpenChange={(next) => { if (!next) closeArtifact(); }}>
          <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto lg:hidden">
            <SheetHeader className="sr-only">
              <SheetTitle>Document</SheetTitle>
              <SheetDescription>The document from this reply</SheetDescription>
            </SheetHeader>
            {openArtifactId !== null ? <ArtifactCanvasPanel artifactId={openArtifactId} onClose={closeArtifact} /> : null}
          </SheetContent>
        </Sheet>
        <Sheet open={compareTarget !== null} onOpenChange={(next) => { if (!next) closeCompare(); }}>
          <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto lg:hidden">
            <SheetHeader className="sr-only">
              <SheetTitle>Compare with the bare model</SheetTitle>
              <SheetDescription>Our reply beside the same model with no routing, packages, persona or guards</SheetDescription>
            </SheetHeader>
            {compareTarget !== null ? <BareCompareCanvasPanel target={compareTarget} onClose={closeCompare} /> : null}
          </SheetContent>
        </Sheet>
      </CompareOpenContext.Provider>
      </AdminContext.Provider>
      </ArtifactOpenContext.Provider>
    </AssistantRuntimeProvider>
  );
}
