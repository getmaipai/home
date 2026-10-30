// MEDIA-VIDEOS-01: what the schema `play` action means in Home. A package page never plays anything itself: it hands an item to the
// host (kit `MediaHostContext`), and this provider opens the owning app's play page. Also `/media/<id>` (the Pick up shelf's link):
// resolved to the owning app from the item's kind.
// MEDIA-POLISH-01: the host also owns the element a media app's player plays in (kit `MediaHost.mediaFor`). It outlives the page, so
// leaving the watch page while a video plays keeps it playing: the media app's area shows it in the docked mini bar (the kit Player's
// `mini` layout, placed by PackageAppPage), and any other app's area draws nothing while the sound carries on (RULES S2 and S6, design
// note section 6). The element is registered with the shell's one audio session for as long as it is loaded.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { MediaHostContext, type MediaHost, type MediaItemRef } from "@maipai/ui/src/schema/mediaHost";
import { api, request } from "@/lib/api";
import { mediaAppOfPath, playRoute } from "@/shell/mediaApps";
import { MediaPlayerRegistration } from "@/shell/MediaPlayerRegistration";
import { useToast } from "@maipai/ui/src/primitives/Toast";
import { BUDGET_CHECK_MS, guardMediaBudget, intervalEvery } from "@/shell/mediaBudgetGuard";
import { NotFoundPage } from "@/shell/pages/NotFoundPage";
import { createListenStatus, createStoryListener, type ListenStatus } from "@/shell/newsListen";
import { fetchNowPlaying, liveStationIdOf, NOW_FIRST_MS, NOW_POLL_MS, rejoinLiveOnResume } from "@/shell/radioLive";
import type Hls from "hls.js";

export const hlsPathFor = (src: string, canPlayNative: boolean): "native" | "hls" | "direct" => {
  if (!/[?&]hls=1(?:&|$)/i.test(src) && !/\.m3u8(?:[?#]|$)/i.test(src)) return "direct";
  return canPlayNative ? "native" : "hls";
};

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
  /** Play the next song of the music queue (the mini bar's Next); does nothing when there is none. */
  next(): Promise<void>;
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
        // A live station's subtitle is the song the hub last reported; the page's own copy (fetched earlier) must not put it back.
        const subtitle = liveStationIdOf(current.src) !== null && current.subtitle ? current.subtitle : ref.subtitle;
        if (current.title !== ref.title || current.subtitle !== subtitle || current.poster !== ref.poster) {
          current = { ...current, title: ref.title, subtitle, poster: ref.poster };
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
    /** RADIO-03: the song a live station reports replaces the bar's subtitle (the element and the source stay as they are). */
    setSubtitle(el: HTMLMediaElement, subtitle: string) {
      if (!current || current.el !== el || current.subtitle === subtitle) return;
      current = { ...current, subtitle };
      notify();
    },
    /** Point the held element at the next piece of the same item (Listen reads a story paragraph by paragraph) without a new element. */
    retarget(el: HTMLMediaElement, patch: { src?: string; subtitle?: string; title?: string; poster?: string; started?: boolean }) {
      if (!current || current.el !== el) return;
      current = { ...current, ...patch };
      if (patch.src !== undefined) el.setAttribute("src", patch.src);
      notify();
    },
    clear() {
      if (!current) return;
      drop(current);
      current = null;
      notify();
    },
  };
}

/** What the shell's Listen is doing right now (which story, starting or speaking, how far). The package app page hands it to the news
 * reader's own context: the reader and the host cannot share one object by package path in the dev server, so the page is the bridge. */
export const ListenStatusContext = createContext<ListenStatus>({ storyId: null, phase: null, progress: 0 });
export const MediaDockContext = createContext<MediaDock>({ current: null, clear: () => {}, next: async () => {} });

/** The item the host holds, for the media app's docked mini bar. */
export function useMediaDock(): MediaDock {
  return useContext(MediaDockContext);
}

export function MediaHostProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [store] = useState(createMediaStore);
  const hlsRef = useRef<Hls | null>(null);
  const pathRef = useRef(location.pathname);
  pathRef.current = location.pathname;
  const appRef = useRef<string | null>(null);
  appRef.current = mediaAppOfPath(location.pathname);
  const { push } = useToast();
  const pushRef = useRef(push);
  pushRef.current = push;
  // NEWS-04: Listen on an article reads it into the host's element, which the global mini player then shows.
  const [status] = useState(createListenStatus);
  const listener = useMemo(() => createStoryListener(store, (line) => pushRef.current(line), status), [store, status]);
  const speech = useSyncExternalStore(status.subscribe, status.get, status.get);
  const host = useMemo<MediaHost>(
    () => ({
      async onPlay(mediaId, item) {
        if (mediaId === "story" && typeof item.story_id === "string") return listener.listen(item.story_id);
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
    [navigate, store, listener],
  );
  const current = useSyncExternalStore(store.subscribe, store.get, store.get);
  // MEDIA-VIZ-03: the next song of the music queue, for the mini bar's Next and the Media Session's next track (and, when a song ends
  // away from Now playing, the host keeps the same queue moving with it). Null when there is no queue or no next song.
  const advance = useCallback(async () => {
    const held = store.get();
    if (!held || held.appId !== "music") return;
    try {
      type NextItem = { id: string; src: string; title: string; subtitle?: string; poster?: string; up_next?: { id: string } };
      const item = await api.appData<NextItem | []>("music", "item", { id: held.id });
      if (Array.isArray(item) || !item.up_next || store.get()?.id !== held.id) return;
      const queued = await request<{ id: string }>("/api/plugins/music/queue", { method: "POST", body: JSON.stringify({ id: item.up_next.id }) });
      const next = await api.appData<NextItem | []>("music", "item", { id: queued.id });
      if (Array.isArray(next) || store.get()?.id !== held.id) return;
      const { parkMedia } = await import("@maipai/ui/src/primitives/Player");
      const el = store.elementFor({ id: next.id, src: next.src, kind: "audio", title: next.title, subtitle: next.subtitle, poster: next.poster }, "music");
      parkMedia(el);
      await el.play();
    } catch {
      // Keep the last item available for Play when a queue read or browser autoplay fails.
    }
  }, [store]);
  // The schema Player advances on Now playing. Away from that page, the host keeps the same queue moving.
  useEffect(() => {
    if (!current || current.appId !== "music") return;
    const ended = () => { if (pathRef.current !== "/apps/music/play") void advance(); };
    current.el.addEventListener("ended", ended);
    return () => current.el.removeEventListener("ended", ended);
  }, [current, advance]);
  // MEDIA-KID-01: the daily media minutes pause the host's element (every media app, the mini bar, audio and video alike).
  // The words go through the shell's one toast (the kit ToastProvider in App.tsx, the same one the notification bell uses).
  const element = current?.el ?? null;
  const liveId = current ? liveStationIdOf(current.src) : null;
  // RADIO-06: attach hls.js to this same host-owned element only when the browser lacks native HLS.
  useEffect(() => {
    if (!element || liveId === null) return;
    const src = current?.src ?? "";
    const mode = hlsPathFor(src, element.canPlayType("application/vnd.apple.mpegurl") !== "");
    if (mode !== "hls") return;
    // hls.js is loaded only when a station needs it, so the main bundle stays under the PWA precache limit (BUNDLE-SPLIT-01).
    let cancelled = false;
    let hls: Hls | null = null;
    void import("hls.js").then(({ default: HlsClass }) => {
      if (cancelled) return;
      hls = new HlsClass({ enableWorker: true, lowLatencyMode: true });
      hlsRef.current = hls;
      hls.loadSource(src.replace(/[?&]hls=1(?:&|$)/, ""));
      hls.attachMedia(element);
    }).catch(() => undefined);
    return () => { cancelled = true; if (hls) { hls.destroy(); if (hlsRef.current === hls) hlsRef.current = null; } };
  }, [element, current?.src, liveId]);
  const budgetState = useRef({ told: false });
  useEffect(() => {
    if (!element) return;
    return guardMediaBudget(element, { fetchBudget: () => api.mediaBudget(), notify: (line) => pushRef.current(line), every: intervalEvery(BUDGET_CHECK_MS), state: budgetState.current });
  }, [element]);
  // Tell the person when a station or other media item cannot be decoded or fetched.
  useEffect(() => {
    if (!element || liveId === null) return;
    const onError = () => pushRef.current("This station could not be played. Try again or choose another station.");
    element.addEventListener("error", onError);
    return () => element.removeEventListener("error", onError);
  }, [element, liveId]);
  // RADIO-03: a live station. Pause then Play loads the stream again (the live edge, not a stale buffer); the song the station reports is
  // read from the hub a few seconds after sound starts and then every 15 s, only while it plays and this tab is visible.
  useEffect(() => {
    if (!element || liveId === null) return;
    const stopRejoin = rejoinLiveOnResume(element, () => {
      if (hlsRef.current) { hlsRef.current.stopLoad(); hlsRef.current.startLoad(-1); }
    });
    let first: ReturnType<typeof setTimeout> | null = null;
    let busy = false;
    const look = async () => {
      if (busy || element.paused || document.visibilityState !== "visible") return;
      busy = true;
      const title = await fetchNowPlaying(liveId);
      busy = false;
      if (title !== null && store.get()?.el === element) store.setSubtitle(element, title);
    };
    const onPlaying = () => { if (first) clearTimeout(first); first = setTimeout(() => void look(), NOW_FIRST_MS); };
    element.addEventListener("playing", onPlaying);
    const every = setInterval(() => void look(), NOW_POLL_MS);
    return () => { stopRejoin(); element.removeEventListener("playing", onPlaying); clearInterval(every); if (first) clearTimeout(first); };
  }, [element, liveId, store]);
  const dock = useMemo<MediaDock>(() => ({ current, clear: store.clear, next: advance }), [current, store, advance]);
  // The element is unloaded when the person signs out or the shell goes away.
  useEffect(() => () => store.clear(), [store]);
  return (
    <MediaHostContext.Provider value={host}>
      <MediaDockContext.Provider value={dock}>
       <ListenStatusContext.Provider value={speech}>
        {current ? <MediaPlayerRegistration appId={current.appId} mediaId={current.id} element={current.el} {...(liveId !== null ? { liveSubtitle: current.subtitle ?? "" } : {})} next={current.appId === "music" ? () => { void advance(); } : undefined} /> : null}
        {children}
       </ListenStatusContext.Provider>
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
