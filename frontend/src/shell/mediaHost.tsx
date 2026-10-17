// MEDIA-VIDEOS-01: what the schema `play` action means in Home. A package page never plays anything itself: it hands an item to the
// host (kit `MediaHostContext`), and this provider opens the owning app's play page. Also `/media/<id>` (the Pick up shelf's link):
// resolved to the owning app from the item's kind.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Navigate, useParams, useNavigate } from "react-router-dom";
import { MediaHostContext, type MediaHost } from "@maipai/ui/src/schema/mediaHost";
import { api } from "@/lib/api";
import { playRoute } from "@/shell/mediaApps";
import { NotFoundPage } from "@/shell/pages/NotFoundPage";

export function MediaHostProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const host = useMemo<MediaHost>(
    () => ({
      async onPlay(mediaId, item) {
        // A row from a media app carries its kind; any other caller names only the id, and the hub says what it is.
        const kind = typeof item.kind === "string" ? item.kind : (await api.mediaItem(mediaId)).item.kind;
        const to = playRoute(kind, mediaId);
        if (!to) throw new Error("This item cannot be played from here. Open it from its app.");
        navigate(to, { state: { pageState: { id: mediaId } } });
      },
    }),
    [navigate],
  );
  return <MediaHostContext.Provider value={host}>{children}</MediaHostContext.Provider>;
}

/** `/media/<id>`: opens the item in the app that owns its kind. An item the person may not read, or that is gone, is "not found". */
export function MediaLinkRedirect() {
  const { id = "" } = useParams();
  const [to, setTo] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    api.mediaItem(id).then((found) => live && setTo(playRoute(found.item.kind, id)), () => live && setTo(null));
    return () => { live = false; };
  }, [id]);
  if (to === undefined) return null;
  return to ? <Navigate to={to} replace state={{ pageState: { id } }} /> : <NotFoundPage />;
}
