// ADULT-LOCK-06 (docs/design/video-loras-2026-11-02.md 3.10): the item's "Unmark as NSFW" and "Mark as NSFW" actions for a clip's creator, and the confirm
// dialog before the lock is removed (useAdultMark: the kit's AdultLockDialog with a FRESH passcode for this one clip, never the page's unlock).
import type { ReactNode } from "react";
import { Button } from "@maipai/ui/src/ui/button";
import { videosApi, type VideoItem } from "@/lib/videosApi";
import { useAdultMark } from "@/apps/chat/useAdultMark";

export { UNMARK_EXPLAINER, unmarkExplainer } from "@/apps/chat/useAdultMark";

export function useVideoAdultMark(item: VideoItem | null, refresh: () => void): { actions: ReactNode[]; dialog: ReactNode; stateLine: string | null } {
  return useAdultMark<ReactNode>(videosApi, item, refresh, (action) => (
    <Button key={action.id} type="button" variant="ghost" size="sm" disabled={action.disabled} onClick={action.onSelect}>{action.label}</Button>
  ));
}
