import { useState } from "react";
import { ActionBarMorePrimitive, useAuiState } from "@assistant-ui/react";
import { getIcon } from "@/kit/icons";
import { TooltipIconButton } from "@/kit/assistant-ui/tooltip-icon-button";
import { messageText } from "@/apps/chat/chatMessageText";
import { useChatListenStore } from "@/apps/chat/chatListenStore";
import { forgetMessage, rememberMessage, useChatActorId, useRememberedMemoryId } from "@/apps/chat/chatMemoryActions";

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
// `metadata.custom.turnId`, populated only for a message already loaded
// from GET /api/conversations - a message from the CURRENT live session
// has none yet, since session-a-intelligence.md's turn_meta/done.turn_id
// hasn't landed). Disabled rather than hidden on such a message: the
// action exists, it just isn't attributable yet, the same honest gap the
// plan's own "swap to the real routes when they merge" calls for.
function useRememberThis(): {
  turnId: string | undefined;
  alreadySaved: boolean;
  isSaving: boolean;
  isError: boolean;
  trigger(): void;
} {
  const text = useAuiState((s) => messageText(s.message));
  const turnId = useAuiState((s) => (s.message.metadata?.custom?.turnId as string | undefined) ?? undefined);
  const actorId = useChatActorId();
  const alreadySaved = useRememberedMemoryId(turnId) !== undefined;
  const [state, setState] = useState<"idle" | "saving" | "error">("idle");

  return {
    turnId,
    alreadySaved,
    isSaving: state === "saving",
    isError: state === "error",
    trigger() {
      if (!turnId || alreadySaved) return;
      setState("saving");
      rememberMessage({ text, turnId, actorId })
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
  const [state, setState] = useState<"idle" | "forgetting" | "error">("idle");
  const memoryId = useRememberedMemoryId(turnId);

  if (!turnId || !memoryId) return null;

  return (
    <ActionBarMorePrimitive.Item
      className={MENU_ITEM_CLASS}
      disabled={state === "forgetting"}
      onSelect={(e) => {
        e.preventDefault();
        setState("forgetting");
        forgetMessage(turnId)
          .then(() => setState("idle"))
          .catch(() => setState("error"));
      }}
    >
      <Archive className="size-4" />
      {state === "error" ? "Couldn't forget - try again" : "Forget this"}
    </ActionBarMorePrimitive.Item>
  );
}
