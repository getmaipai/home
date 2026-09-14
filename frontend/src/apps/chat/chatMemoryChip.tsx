import { useAuiState } from "@assistant-ui/react";
import { Link } from "react-router-dom";
import { getIcon } from "@/kit/icons";
import { useMemoryState } from "@/apps/chat/chatMemoryState";

const Brain = getIcon("brain");

// `bg-secondary`/`text-secondary-foreground`, not `bg-muted`/
// `text-muted-foreground`: found live regenerating lane 9's screenshots
// (a real exercised chat reply, not a fixture) - axe's color-contrast
// rule flagged the muted pairing in light theme (`badge.tsx`'s own
// `secondary` variant is the kit's proven-contrast pairing for a
// compact pill like this, not the deliberately low-emphasis muted one).
const CHIP_CLASS = "mt-1 inline-flex w-fit items-center gap-1 self-start rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground";

/** Rendered per assistant message (thread.aui.tsx). Reads
 * chatMemoryState.ts's own store, the one place a turn's memory ids and
 * status live now (CHAT-20) - seeded once per message, from a loaded
 * row's real `memory_ids`/`judge_status` or a live reply's `source`
 * alone (the judge hasn't run yet), then kept current by
 * `useMemoryStatusPoll` (mounted once at the chat page's own top level)
 * while anything in the open conversation is still pending. */
export function MemoryUpdatedChip() {
  const turnId = useAuiState((s) => s.message.metadata?.custom?.turnId as string | undefined);
  const conversationId = useAuiState((s) => s.message.metadata?.custom?.conversationId as string | undefined);
  const source = useAuiState((s) => s.message.metadata?.custom?.source as string | undefined);
  const judgeStatus = useAuiState((s) => s.message.metadata?.custom?.judgeStatus as string | null | undefined);
  const rowMemoryIds = useAuiState((s) => (s.message.metadata?.custom?.memoryIds as string[] | undefined) ?? undefined);

  const state = useMemoryState(
    turnId,
    turnId && conversationId && source !== undefined ? { conversationId, source, judgeStatus, memoryIds: rowMemoryIds ?? [] } : undefined,
  );

  if (!state) return null;

  if (state.status === "saved") {
    return (
      // Deliberate type-floor exception (docs/UI.md, lane 7 item 3,
      // 2026-09-13): a compact rounded-full chip, the same category as a
      // badge count, not a line of body text.
      <Link to={`/memory?ids=${state.memoryIds.map(encodeURIComponent).join(",")}`} className={`${CHIP_CLASS} hover:bg-accent`}>
        <Brain className="size-3" />
        Memory updated
      </Link>
    );
  }

  if (state.status === "failed") {
    return (
      <Link to="/memory" className={`${CHIP_CLASS} hover:bg-accent`}>
        <Brain className="size-3" />
        Memory wasn't saved
      </Link>
    );
  }

  // Jesse, 2026-09-13: a person should see this chip only when something
  // actually happened - "pending" (the judge hasn't run yet) and
  // "stalled" (ten minutes with no answer) are both process, not an
  // outcome, and showing "Checking for memories" for every ordinary
  // reply read as chatter rather than information. The state machine
  // itself is untouched (chatMemoryState.ts's own polling, the stall
  // timer, `refreshTurnMemoryStatus`) - this chip still appears the
  // moment the judge finishes late, exactly as before; only the
  // in-between text is gone.
  return null; // pending, stalled, not_saved: no chip
}
