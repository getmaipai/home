// ADULT-LOCK-07: the picture card's mark controls follow the video card's confirm and ticket flow (useAdultMark).
import type { ReactNode } from "react";
import type { GalleryAction } from "@maipai/ui/src/elements/image-gallery";
import { picturesApi, type PictureCard } from "@/lib/picturesApi";
import { useAdultMark } from "@/apps/chat/useAdultMark";

export function usePictureAdultMark(card: Pick<PictureCard, "id" | "adult">, refresh: () => void): { actions: GalleryAction[]; dialog: ReactNode; stateLine: string | null } {
  return useAdultMark<GalleryAction>(picturesApi, card, refresh, (action) => action);
}
