// MEDIA-VIDEOS-01: what the schema `play` action means in Home. A package page never plays anything itself: it hands an item to the
// host (kit `MediaHostContext`), and this provider opens the owning app's play page. Also `/media/<id>` (the Pick up shelf's link):
// resolved to the owning app from the item's kind.
// MEDIA-POLISH-01: the host also owns the element a media app's player plays in (kit `MediaHost.mediaFor`). It outlives the page, so
// leaving the watch page while a video plays keeps it playing: the media app's area shows it in the docked mini bar (the kit Player's
// `mini` layout, placed by PackageAppPage), and any other app's area draws nothing while the sound carries on (RULES S2 and S6, design
// note section 6). The element is registered with the shell's one audio session for as long as it is loaded.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { ADULT_ONLY_PAGE_ONLY, MediaHostContext, refuseAdultOnly, type MediaHost, type MediaItemRef } from "@maipai/ui/src/schema/mediaHost";
import { api, request, type Roster } from "@/lib/api";
import { mediaAppOfPath, playIsAlreadyOpen, playRoute } from "@/shell/mediaApps";
import { MediaPlayerRegistration } from "@/shell/MediaPlayerRegistration";
import { useToast } from "@maipai/ui/src/primitives/Toast";
import { BUDGET_CHECK_MS, guardMediaBudget, intervalEvery } from "@/shell/mediaBudgetGuard";
import { NotFoundPage } from "@/shell/pages/NotFoundPage";
import { createListenStatus, createStoryListener, type ListenStatus } from "@/shell/newsListen";
import { watchLiveReconnect } from "@/lib/media/liveReconnect";
import { fetchNowPlaying, liveStationIdOf, NOW_FIRST_MS, NOW_POLL_MS, rejoinLiveOnResume } from "@/shell/radioLive";
import { MediaPickerBody, type PickKind, type PickedMedia } from "@/shell/MediaPickerDialog";
import { makingAvailability } from "@/apps/chat/useMakingAvailability";
import { useHealthQuery } from "@/apps/chat/useChatAvailability";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@maipai/ui/src/ui/dialog";
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
  /** Start a live station's stream again after it failed to start (the bar's Retry). */
  retry?(): void;
}

/** One element at a time: a new item replaces the old one (paused and unloaded first). Changes are published after the render
 * that asked for the element, since `mediaFor` runs during a page's render. */
export function createMediaStore() {
  let current: HoistedMedia | null = null;
  // The item the person closed. The page they closed it on may still show that same item and ask the host for its element again on
  // the next render; that element must not start by itself (it would restart the station they just stopped). It plays only when the
  // person presses Play (`allowAutoplay`, or the element's own play event), and the mark ends when another item is requested.
  let closedId: string | null = null;
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
      // ADULT-LOCK-05: the one rule point. An adult-only item is never registered and never given an element here: it plays only inside its own
      // page's player (no mini bar, no audio session, no Media Session). The kit already keeps it away (`adult_only` rows); this refuses a caller that did not.
      if (refuseAdultOnly(ref)) throw new Error(ADULT_ONLY_PAGE_ONLY);
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
      const wasClosed = closedId === ref.id;
      if (!wasClosed) closedId = null;
      const el = document.createElement(ref.kind === "audio" ? "audio" : "video");
      if (wasClosed) el.preload = "none";
      el.setAttribute("src", ref.src);
      el.autoplay = appId === "music" && !wasClosed;
      // The Player that asked for it adopts it in the same commit, and parks it in the kit's hidden spot when it goes. This file does
      // not import the Player (it stays out of the shell's main chunk; PackageAppPage loads it on demand).
      el.addEventListener("play", () => {
        if (current?.el === el) closedId = null;
        if (current?.el === el && !current.started) {
          current = { ...current, started: true };
          notify();
        }
      });
      // A live station is asked for by the person's press on Play, so its bar opens at once and shows Connecting until sound arrives.
      current = { ...ref, appId, el, started: el.autoplay && liveStationIdOf(ref.src) !== null };
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
    /** The person asked to play this item (a Play button): it may start by itself again. */
    allowAutoplay(id: string) {
      if (closedId === id) closedId = null;
    },
    clear() {
      if (!current) return;
      closedId = current.id;
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

/** VIDEO-UI-06 (K8): the line a control that starts a picture or a clip shows while that engine is not ready. Used when the health row says "not ready" but carries no words. */
export const MAKING_NOT_READY_LINE = { picture: "Pictures are not ready yet. Try again in a minute.", video: "Video is not ready yet. Try again in a minute." } as const;

/** `personId` lets the picker (VIDEO-CREATE-02: `pickMedia`) list only the signed-in person's own Library pictures; without it no picker is offered.
 * `ageBand` picks the words of the not-ready line (K8 `makingNotice`, read from the same ["health"] query `useMakingAvailability` reads). */
export function MediaHostProvider({ children, personId, ageBand }: { children: ReactNode; personId?: string; ageBand?: Roster["age_band"] }) {
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
  // VIDEO-CREATE-02 (U3): one picker at a time; a second request while one is open resolves the first with null.
  const [pick, setPick] = useState<{ kind: PickKind; resolve: (picked: PickedMedia | null) => void } | null>(null);
  const pickRef = useRef(pick);
  pickRef.current = pick;
  const pickMedia = useCallback((kind: PickKind | "audio" | "video") => new Promise<PickedMedia | null>((resolve) => {
    pickRef.current?.resolve(null);
    // Only pictures can be picked until a voice clip or a source clip has passed its bench (VIDEO-INPUTS-05, -06): the slots are not drawn, and a stray ask is refused.
    if (kind === "audio" || kind === "video") { resolve(null); return; }
    setPick({ kind, resolve });
  }), []);
  // VIDEO-UI-06 (K8): the one line a Start button shows while pictures or video are not ready. Same ["health"] query and same words as `useMakingAvailability`.
  const health = useHealthQuery().data;
  const makingNotice = useCallback((kind: "picture" | "video"): string | undefined => {
    const reading = makingAvailability(health?.engines?.[kind === "picture" ? "image" : "video"], ageBand ? { age_band: ageBand } : null);
    return reading.disabled ? reading.reason ?? MAKING_NOT_READY_LINE[kind] : undefined;
  }, [health, ageBand]);
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
        // A second press on what is already open resumes it; it never navigates again (that stacked history and re-ran the page).
        store.allowAutoplay(mediaId);
        const held = store.get();
        if (held && playIsAlreadyOpen(held.id, pathRef.current, to, mediaId)) {
          if (held.el.paused) void held.el.play().catch(() => undefined);
          return;
        }
        navigate(to, { state: { pageState: { id: mediaId } } });
      },
      // Only a media app's player plays in the host's element; anywhere else the Player keeps its own.
      ...(personId ? { pickMedia } : {}),
      makingNotice,
      mediaFor: (ref) => (!refuseAdultOnly(ref) && appRef.current && typeof document !== "undefined" ? store.elementFor(ref, appRef.current) : null),
    }),
    [navigate, store, listener, personId, pickMedia, makingNotice],
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
  // A dropped live stream is retried with backoff; the person hears about it only after the last retry fails (liveReconnect.ts).
  useEffect(() => {
    if (!element || liveId === null) return;
    return watchLiveReconnect(
      element,
      () => { if (hlsRef.current) { hlsRef.current.stopLoad(); hlsRef.current.startLoad(-1); } else element.load(); },
      () => pushRef.current("This station could not be played. Try again or choose another station."),
    );
  }, [element, liveId, current?.src]);
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
  const retry = useCallback(() => {
    const held = store.get();
    if (!held) return;
    store.allowAutoplay(held.id);
    if (hlsRef.current) { hlsRef.current.stopLoad(); hlsRef.current.startLoad(-1); } else held.el.load();
    void held.el.play().catch(() => undefined);
  }, [store]);
  const dock = useMemo<MediaDock>(() => ({ current, clear: store.clear, next: advance, retry }), [current, store, advance, retry]);
  // The element is unloaded when the person signs out or the shell goes away.
  useEffect(() => () => store.clear(), [store]);
  return (
    <MediaHostContext.Provider value={host}>
      <MediaDockContext.Provider value={dock}>
       <ListenStatusContext.Provider value={speech}>
        {current ? <MediaPlayerRegistration adultOnly={refuseAdultOnly(current)} appId={current.appId} mediaId={current.id} element={current.el} {...(liveId !== null ? { liveSubtitle: current.subtitle ?? "" } : {})} next={current.appId === "music" ? () => { void advance(); } : undefined} /> : null}
        {children}
        {pick ? (
          <Dialog open onOpenChange={(open) => { if (!open) { pick.resolve(null); setPick(null); } }}>
            <DialogContent scroll="viewport">
              <DialogHeader>
                <DialogTitle>Choose a picture</DialogTitle>
                <DialogDescription>The video starts from this picture. Choose one from your Library or add a new one.</DialogDescription>
              </DialogHeader>
              <MediaPickerBody kind={pick.kind} personId={personId} onDone={(picked) => { pick.resolve(picked); setPick(null); }} />
            </DialogContent>
          </Dialog>
        ) : null}
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
