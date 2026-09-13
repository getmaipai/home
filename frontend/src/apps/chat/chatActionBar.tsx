import { useState } from "react";
import { ActionBarMorePrimitive, useAuiState } from "@assistant-ui/react";
import { getIcon } from "@/kit/icons";
import { TooltipIconButton } from "@/kit/assistant-ui/tooltip-icon-button";
import { messageText } from "@/apps/chat/chatMessageText";
import { useChatListenStore } from "@/apps/chat/chatListenStore";
import { forgetMessage, rememberMessage, useChatActorId } from "@/apps/chat/chatMemoryActions";
import { useMemoryState } from "@/apps/chat/chatMemoryState";

const Volume2 = getIcon("volume-2");
const Loader = getIcon("loader");
const Brain = getIcon("brain");
const Archive = getIcon("archive");

// The manual "Listen" replay (chatListenStore.ts), on every assistant
// message's action bar - a live reply already speaks itself as it
// streams (chatModelAdapter.ts); this is for replaying an EARLIER one.
export function ListenButton() {
  const id = useAuiState((s) => s.message.id);
  const text = useAuiState((s) => messageText(s.message));
  const { loadingId, playingId, errorId, play } = useChatListenStore();
  const isLoading = loadingId === id;
  const isPlaying = playingId === id;
  const isError = errorId === id;

  return (
    <TooltipIconButton
      tooltip={isError ? "Couldn't play - try again" : isPlaying ? "Playing…" : isLoading ? "Loading…" : "Listen"}
      disabled={isLoading}
      onClick={() => play(id, text)}
    >
      {isLoading ? <Loader className="animate-spin" /> : <Volume2 />}
    </TooltipIconButton>
  );
}

// "Remember this" / "forget this" (docs/plans/session-b-ui.md step 4), on
// both the household member's own messages and MaiPai's replies (a
// recommendation or a stated fact from MaiPai is just as worth saving).
// Both need a real turn id to attribute to (chatHistoryAdapter.ts's
// `metadata.custom.turnId`, and getmaipai/home#60's live `done.turn_id`
// for the assistant side of a message sent this session) - the user
// message's own live object never gets one (assistant-ui's runtime never
// retrofits a reply's turn id onto its sibling user message), so it stays
// disabled there until a reload. Disabled rather than hidden on such a
// message: the action exists, it just isn't attributable yet.
function useRememberThis(): {
  turnId: string | undefined;
  alreadySaved: boolean;
  isSaving: boolean;
  isError: boolean;
  trigger(): void;
} {
  const text = useAuiState((s) => messageText(s.message));
  const turnId = useAuiState((s) => (s.message.metadata?.custom?.turnId as string | undefined) ?? undefined);
  const conversationId = useAuiState((s) => s.message.metadata?.custom?.conversationId as string | undefined);
  const source = useAuiState((s) => s.message.metadata?.custom?.source as string | undefined);
  const judgeStatus = useAuiState((s) => s.message.metadata?.custom?.judgeStatus as string | null | undefined);
  const rowMemoryIds = useAuiState((s) => (s.message.metadata?.custom?.memoryIds as string[] | undefined) ?? undefined);
  const actorId = useChatActorId();
  const memoryState = useMemoryState(
    turnId,
    turnId && conversationId && source !== undefined ? { conversationId, source, judgeStatus, memoryIds: rowMemoryIds ?? [] } : undefined,
  );
  const alreadySaved = (memoryState?.memoryIds.length ?? 0) > 0;
  const [state, setState] = useState<"idle" | "saving" | "error">("idle");

  return {
    turnId,
    alreadySaved,
    isSaving: state === "saving",
    isError: state === "error",
    trigger() {
      if (!turnId || !conversationId || alreadySaved) return;
      setState("saving");
      rememberMessage({ text, turnId, conversationId, actorId })
        .then(() => setState("idle"))
        .catch(() => setState("error"));
    },
  };
}

/** Inline icon-button variant, for the user message row (no "More" menu
 * exists there today - UserActionBar, thread.aui.tsx). */
export function RememberThisButton() {
  const { turnId, alreadySaved, isSaving, isError, trigger } = useRememberThis();

  return (
    <TooltipIconButton
      tooltip={
        !turnId
          ? "Remember this (available once saved)"
          : alreadySaved
            ? "Remembered"
            : isError
              ? "Couldn't remember - try again"
              : "Remember this"
      }
      disabled={!turnId || isSaving || alreadySaved}
      onClick={trigger}
    >
      {isSaving ? <Loader className="animate-spin" /> : <Brain />}
    </TooltipIconButton>
  );
}

const MENU_ITEM_CLASS =
  "aui-action-bar-more-item hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm outline-none select-none disabled:pointer-events-none disabled:opacity-50";

/** Dropdown-menu variant, for the assistant message's "More" menu
 * (AssistantActionBar, thread.aui.tsx), alongside "Export as Markdown". */
export function RememberThisMenuItem() {
  const { turnId, alreadySaved, isSaving, isError, trigger } = useRememberThis();

  return (
    <ActionBarMorePrimitive.Item
      className={MENU_ITEM_CLASS}
      disabled={!turnId || isSaving || alreadySaved}
      onSelect={(e) => {
        e.preventDefault(); // keep the menu open until the request settles
        trigger();
      }}
    >
      <Brain className="size-4" />
      {!turnId
        ? "Remember this (available once saved)"
        : alreadySaved
          ? "Remembered"
          : isError
            ? "Couldn't remember - try again"
            : "Remember this"}
    </ActionBarMorePrimitive.Item>
  );
}

export function ForgetThisMenuItem() {
  const turnId = useAuiState((s) => (s.message.metadata?.custom?.turnId as string | undefined) ?? undefined);
  const conversationId = useAuiState((s) => s.message.metadata?.custom?.conversationId as string | undefined);
  const source = useAuiState((s) => s.message.metadata?.custom?.source as string | undefined);
  const judgeStatus = useAuiState((s) => s.message.metadata?.custom?.judgeStatus as string | null | undefined);
  const rowMemoryIds = useAuiState((s) => (s.message.metadata?.custom?.memoryIds as string[] | undefined) ?? undefined);
  const [state, setState] = useState<"idle" | "forgetting" | "error">("idle");
  const memoryState = useMemoryState(
    turnId,
    turnId && conversationId && source !== undefined ? { conversationId, source, judgeStatus, memoryIds: rowMemoryIds ?? [] } : undefined,
  );
  const memoryIds = memoryState?.memoryIds ?? [];

  if (!turnId || memoryIds.length === 0) return null;

  return (
    <ActionBarMorePrimitive.Item
      className={MENU_ITEM_CLASS}
      disabled={state === "forgetting"}
      onSelect={(e) => {
        e.preventDefault();
        setState("forgetting");
        forgetMessage(turnId, memoryIds)
          .then(() => setState("idle"))
          .catch(() => setState("error"));
      }}
    >
      <Archive className="size-4" />
      {state === "error" ? "Couldn't forget - try again" : "Forget this"}
    </ActionBarMorePrimitive.Item>
  );
}
