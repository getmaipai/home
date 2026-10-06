// The chat thread's lifted contexts, moved verbatim out of NextChatPage.tsx (SHARED-THREAD-01).
// Every slot and tool UI reads these with a safe default, so the same
// composition renders in the chat page and in the /dev/ui showcase.
import { createContext } from "react";
// APPROVE-CARD-01: the same vendored Element `thread.aui.tsx`'s own
// default `ToolFallback` renders (its own `import { ToolFallback } from
// "@maipai/ui/src/assistant-ui/tool-fallback.aui"`) - used here directly
// so a "confirm" card renders through `ToolFallback.Approval` exactly as
// it ships, never a hand-built card (the kit's own `approval-card.tsx`
// is built for a terminal command and can't be relabeled, per the org's
// "no hand-built UI" rule).
import { type ModelOption } from "@maipai/ui/src/elements/model-selector";
import type { ConnectionPhase } from "@maipai/ui/src/elements/connection-state";
// The Elements' own smaller `Button` (not the dashboard `Button` this
// file otherwise uses), because this one renders as a sibling of Copy/
// Reload/etc INSIDE the assistant-ui action bar itself (matching what
// TooltipIconButton, thread.aui.tsx's own action-bar button, wraps) -
// the dashboard Button belongs to the surrounding page chrome, not this
// row.
import { type Roster } from "@/lib/api";

// SHELL-02 slice 4: the artifact-card row of the wiring table.
// `useAssistantToolUI`'s own `result` is only ever `{id, version}`
// (chatModelAdapter.ts/chatHistoryAdapter.ts's own comment on why: the
// wire and the reload row both name a version, never carry its body) -
// the card fetches the CURRENT version itself (`api.artifactCurrent`,
// not the bare per-version read) so its own title/kind stay fresh the
// same way the open canvas does, if a later turn updates this exact
// artifact before the card is ever clicked.
export const ArtifactOpenContext = createContext<(id: string) => void>(() => {});

// Jesse, live-found 2026-09-27: "the canvas shows, and its about 3-5
// seconds until you change the message to 'Bedtime storybook is
// ready.' - that should happen exactly with the canvas opening - same
// event." Before this, the two updates rode two entirely different
// polls: ProjectFinishedArtifact's own live poll (2s, PROJECT_POLL_MS)
// opened the canvas the moment it saw a posted artifact, while the
// surrounding reply text only ever corrected once ProjectResultReload's
// SEPARATE notification poll (up to 15s) caught up and reloaded the
// thread - two events, not one, for what reads as a single "it's done"
// moment. `ProjectFinishedArtifact` now triggers the same reload right
// where it opens the canvas, so both come from the identical poll tick.
// The same "useAui() inside a tool-call renderer resolves to that
// message's own part-scoped client, not the thread-level one" gotcha
// `ConfirmAskAnswerContext` below already exists for - a plain function,
// never a raw `aui` handle, provided from the root by
// ReloadMainThreadProvider below.
export const ReloadMainThreadContext = createContext<() => void>(() => {});

// APPROVE-CARD-01: the same lifted-context shape as `ArtifactOpenContext`
// above - `ConfirmToolRender` (below) needs a way to send the tapped
// answer, and a bare `ComponentType` slot with no props of its own
// (`useAssistantToolUI`'s own `render`) is exactly why `ArtifactOpenContext`
// exists too. Carries the actual send callback, never a raw `aui` handle:
// a code review (live, this item) found `useAui()` called from INSIDE a
// tool-call renderer resolves to that message's own part-scoped client
// (assistant-ui's per-message/part context), not the thread-level
// composer - `aui.composer.send()` there threw "Composer is not
// available" every time. `ConfirmAskAnswerProvider` (below, mounted at
// the same root level `LiveVoiceSession` already proves works for this
// exact same "send from outside the composer's own click handler"
// need - ChatPage.tsx's own `SttAutoSend` comment has the fuller
// reasoning) calls `useAui()` once, correctly scoped, and hands down the
// closure instead.
export const ConfirmAskAnswerContext = createContext<(turnId: string, approved: boolean) => void>(() => {});

// ADMIN-COMPARE-01: the same two-context shape as the artifact panel
// above (an "open" callback threaded down through context, since
// AssistantMoreItems is a bare ComponentType slot with no props of its
// own) - `AdminContext` for the one gate this whole action needs, so it
// never shows for anyone who'd just get a 403 from the route.
export const AdminContext = createContext(false);
/** ELEMENTS-ADOPT-02: the signed-in person's age band, for the reply
 * controls that differ by band (the "What went wrong?" form is never shown
 * to a child). The default is the strictest band, so a mount without the
 * chat page's provider never shows an adult-only control. */
export const ChatAgeBandContext = createContext<"child" | "teen" | "adult">("child");
export type CompareTarget = { turnId: string; conversationId: string; ourText: string };
export const CompareOpenContext = createContext<(target: CompareTarget) => void>(() => {});

/** Shared by `SourcesActionBarTrigger` and `SourcesFooterContent` below -
 * the lifted open/closed state, keyed by `turnId` (see `NextChatPage`'s
 * own `sourcesOpenValue`). `close` (not just `toggle`) exists for
 * `SourcesActionBarTrigger`'s own unmount cleanup: `AssistantActionBar`
 * sits inside `ActionBarPrimitive.Root`'s `autohide="not-last"`
 * (thread.aui.tsx), which truly unmounts the whole bar - trigger
 * included - on any earlier message once the pointer/focus leaves it.
 * Without closing on that unmount, `SourcesFooterContent` (a plain
 * sibling outside the bar, so it doesn't autohide) would keep the panel
 * open with its own trigger gone - a review-caught orphaned-open state. */
export const SourcesOpenContext = createContext<{
  isOpen: (turnId: string) => boolean;
  toggle: (turnId: string) => void;
  close: (turnId: string) => void;
}>({ isOpen: () => false, toggle: () => {}, close: () => {} });

/** Slice 5(d): the "..." menu's second entry, Details (the stats
 * reveal) - the same lifted-by-turnId shape `SourcesOpenContext` above
 * already uses, simpler here since the trigger lives inside the "More"
 * menu itself, not the bar's own row, so it isn't exposed to that
 * menu's own autohide unmount risk. */
export const DetailsOpenContext = createContext<{
  isOpen: (turnId: string) => boolean;
  toggle: (turnId: string) => void;
}>({ isOpen: () => false, toggle: () => {} });

/** RESP-04, item (f): the composer's own response-mode control -
 * `ComposerExtra` (thread.aui.tsx) is a bare `ComponentType` slot with
 * no props, the same reason `ArtifactOpenContext`/`AdminContext` above
 * exist. PERSIST-CONV-01 hydrates this mode from the active conversation
 * and saves changes on selection; changing threads loads that thread's
 * own mode, while an unset value means Instant. */
export const ThinkingModeContext = createContext<{
  mode: "instant" | "thinking";
  setMode: (mode: "instant" | "thinking") => void;
}>({ mode: "instant", setMode: () => {} });

export const ModelPickerContext = createContext<{
  models: readonly ModelOption[];
  value: string | undefined;
  setValue: (model: string) => void;
}>({ models: [], value: undefined, setValue: () => {} });

/** ADMIN-COMPARE-01 (b): the compare-with-bare-model switch, a
 * conversation-wide sibling to feature (a)'s one-message
 * `CompareOpenContext` above - same menu, same concept family
 * (COORDINATOR, 2026-09-22: "(a) is 'compare this one message', (b) is
 * 'compare everything from here on'"). Session-local only; see
 * `useNextChatRuntime`'s own `bareMode` state for why. */
export const BareModeContext = createContext<{ on: boolean; toggle: () => void }>({ on: false, toggle: () => {} });

/** Carries the session-wide Incognito state into the kit's bare Welcome
 * slot, which uses it only to show the matching temporary-chat heading. */
export const TemporaryChatContext = createContext<{ on: boolean }>({ on: false });
export const DraftConversationContext = createContext<string | undefined>(undefined);
export type ConnectionState = { phase: ConnectionPhase; attempt?: number; resumedTokens?: number };
export const ConnectionStateContext = createContext<ConnectionState & { setConnection?(state: ConnectionState): void }>({ phase: "online" });
export const WakeWordPersonContext = createContext<Roster | null>(null);

/** CHAT-CALM-ERRORS-01d (design section 7): the one quiet line under the
 * composer while chat cannot answer, already chosen for this person's band
 * (the words come from the health row, backend failureCopy.ts), plus the
 * Repairs link words for an owner or admin. Null when chat is ready; the
 * showcase mounts without the chat page's providers, so null is the safe
 * default. */
export type ChatComposerNoticeValue = { text: string; repairsLink: string | null };
export const ChatComposerNoticeContext = createContext<ChatComposerNoticeValue | null>(null);
