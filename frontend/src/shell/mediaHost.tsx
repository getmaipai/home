// MEDIA-VIDEOS-01: what the schema `play` action means in Home. A package page never plays anything itself: it hands an item to the
// host (kit `MediaHostContext`), and this provider opens the owning app's play page. Also `/media/<id>` (the Pick up shelf's link):
// resolved to the owning app from the item's kind.
// MEDIA-POLISH-01: the host also owns the element a media app's player plays in (kit `MediaHost.mediaFor`). It outlives the page, so
// leaving the watch page while a video plays keeps it playing: the media app's area shows it in the docked mini bar (the kit Player's
// `mini` layout, placed by PackageAppPage), and any other app's area draws nothing while the sound carries on (RULES S2 and S6, design
// note section 6). The element is registered with the shell's one audio session for as long as it is loaded.
import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { MediaHostContext, type MediaHost, type MediaItemRef } from "@maipai/ui/src/schema/mediaHost";
import { api, request } from "@/lib/api";
import { mediaAppOfPath, playRoute } from "@/shell/mediaApps";
import { MediaPlayerRegistration } from "@/shell/MediaPlayerRegistration";
import { toast } from "sonner";
import { BUDGET_CHECK_MS, guardMediaBudget, intervalEvery } from "@/shell/mediaBudgetGuard";
import { NotFoundPage } from "@/shell/pages/NotFoundPage";

/** The item loaded in the host's element: what it is, which app played it, and whether the person has started it. */
export interface HoistedMedia extends MediaItemRef {
  appId: string;
  el: HTMLMediaElement;
  started: boolean;
}

export interface MediaDock {
  current: HoistedMedia | null;
  /** Stop and unload the item (the mini bar's Close). */
  clear(): void;
}

/** One element at a time: a new item replaces the old one (paused and unloaded first). Changes are published after the render
 * that asked for the element, since `mediaFor` runs during a page's render. */
export function createMediaStore() {
  let current: HoistedMedia | null = null;
  const listeners = new Set<() => void>();
  const notify = () => queueMicrotask(() => listeners.forEach((listener) => listener()));
  const drop = (entry: HoistedMedia) => {
    entry.el.pause();
    entry.el.removeAttribute("src");
    entry.el.load();
    entry.el.remove();
  };
  return {
    get: (): HoistedMedia | null => current,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    elementFor(ref: MediaItemRef, appId: string): HTMLMediaElement {
      if (current && current.id === ref.id && current.src === ref.src && current.appId === appId) {
        if (current.title !== ref.title || current.subtitle !== ref.subtitle || current.poster !== ref.poster) {
          current = { ...current, title: ref.title, subtitle: ref.subtitle, poster: ref.poster };
          notify();
        }
        return current.el;
      }
      if (current) drop(current);
      const el = document.createElement(ref.kind === "audio" ? "audio" : "video");
      el.setAttribute("src", ref.src);
      el.autoplay = appId === "music";
      // The Player that asked for it adopts it in the same commit, and parks it in the kit's hidden spot when it goes. This file does
      // not import the Player (it stays out of the shell's main chunk; PackageAppPage loads it on demand).
      el.addEventListener("play", () => {
        if (current?.el === el && !current.started) {
          current = { ...current, started: true };
          notify();
        }
      });
      current = { ...ref, appId, el, started: false };
      notify();
      return el;
    },
    clear() {
      if (!current) return;
      drop(current);
      current = null;
      notify();
    },
  };
}

const MediaDockContext = createContext<MediaDock>({ current: null, clear: () => {} });

/** The item the host holds, for the media app's docked mini bar. */
export function useMediaDock(): MediaDock {
  return useContext(MediaDockContext);
}

export function MediaHostProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [store] = useState(createMediaStore);
  const pathRef = useRef(location.pathname);
  pathRef.current = location.pathname;
  const appRef = useRef<string | null>(null);
  appRef.current = mediaAppOfPath(location.pathname);
  const host = useMemo<MediaHost>(
    () => ({
      async onPlay(mediaId, item) {
        // A row from a media app carries its kind; any other caller names only the id, and the hub says what it is.
        const kind = typeof item.kind === "string" ? item.kind : (await api.mediaItem(mediaId)).item.kind;
        if (kind === "track") {
          const queued = await request<{ id: string }>("/api/plugins/music/queue", { method: "POST", body: JSON.stringify({ id: mediaId, mode: item.queue_mode ?? "track", shuffle: item.shuffle, seed_kind: item.seed_kind }) });
          mediaId = queued.id;
        }
        const to = playRoute(kind, mediaId);
        if (!to) throw new Error("This item cannot be played from here. Open it from its app.");
        navigate(to, { state: { pageState: { id: mediaId } } });
      },
      // Only a media app's player plays in the host's element; anywhere else the Player keeps its own.
      mediaFor: (ref) => (appRef.current && typeof document !== "undefined" ? store.elementFor(ref, appRef.current) : null),
    }),
    [navigate, store],
  );
  const current = useSyncExternalStore(store.subscribe, store.get, store.get);
  // The schema Player advances on Now playing. Away from that page, the host keeps the same queue moving.
  useEffect(() => {
    if (!current || current.appId !== "music") return;
    let live = true;
    const ended = async () => {
      if (pathRef.current === "/apps/music/play") return;
      try {
        type NextItem = { id: string; src: string; title: string; subtitle?: string; poster?: string; up_next?: { id: string } };
        const item = await api.appData<NextItem | []>("music", "item", { id: current.id });
        if (Array.isArray(item) || !item.up_next || !live || store.get()?.id !== current.id) return;
        const queued = await request<{ id: string }>("/api/plugins/music/queue", { method: "POST", body: JSON.stringify({ id: item.up_next.id }) });
        const next = await api.appData<NextItem | []>("music", "item", { id: queued.id });
        if (Array.isArray(next) || !live || store.get()?.id !== current.id) return;
        const { parkMedia } = await import("@maipai/ui/src/primitives/Player");
        if (!live) return;
        const el = store.elementFor({ id: next.id, src: next.src, kind: "audio", title: next.title, subtitle: next.subtitle, poster: next.poster }, "music");
        parkMedia(el);
        await el.play();
      } catch {
        // Keep the last item available for Play when a queue read or browser autoplay fails.
      }
    };
    current.el.addEventListener("ended", ended);
    return () => { live = false; current.el.removeEventListener("ended", ended); };
  }, [current, store]);
  // MEDIA-KID-01: the daily media minutes pause the host's element (every media app, the mini bar, audio and video alike).
  const element = current?.el ?? null;
  useEffect(() => {
    if (!element) return;
    return guardMediaBudget(element, { fetchBudget: () => api.mediaBudget(), notify: (line) => toast(line), every: intervalEvery(BUDGET_CHECK_MS) });
  }, [element]);
  const dock = useMemo<MediaDock>(() => ({ current, clear: store.clear }), [current, store]);
  // The element is unloaded when the person signs out or the shell goes away.
  useEffect(() => () => store.clear(), [store]);
  return (
    <MediaHostContext.Provider value={host}>
      <MediaDockContext.Provider value={dock}>
        {current ? <MediaPlayerRegistration appId={current.appId} mediaId={current.id} element={current.el} /> : null}
        {children}
      </MediaDockContext.Provider>
    </MediaHostContext.Provider>
  );
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
