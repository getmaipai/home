import { i18n } from "@lingui/core";
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
import { MediaPickerBody, StudioPickerBody, type PickKind, type PickedMedia } from "@/shell/MediaPickerDialog";
import { makingAvailability } from "@/apps/chat/useMakingAvailability";
import { useHealthQuery } from "@/apps/chat/useChatAvailability";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@maipai/ui/src/ui/dialog";
import type Hls from "hls.js";
import { nextMusicQueueId, useMusicDj } from "@/shell/musicDj";
import type { PlayerVoiceover } from "@maipai/ui/src/primitives/Player";
import { chooseNext, getPlayMode, nextRepeat, setPlayMode, usePlayMode } from "@/shell/media/playMode";
import { requestStage } from "@/shell/media/stageRequest";
import { attachCrossfade, crossfadeSeconds, handedOff } from "@/shell/media/crossfade";
import { analyserFor, eqSupported, isIos } from "@/lib/media/audioGraph";
import { offlineIdOf, reportKeptSongs, toggleKeptSong } from "@/shell/media/keptTracks";
import { seedEqPreset, setEqWriter, useEqPreset } from "@/shell/media/eqPreset";
import { useQuery, useQueryClient } from "@tanstack/react-query";

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
  voiceover?: PlayerVoiceover;
  /** Stop and unload the item (the mini bar's Close). */
  clear(): void;
  /** Play the next song of the music queue (the mini bar's Next); does nothing when there is none. */
  next(): Promise<void>;
  /** Go back: restart the song when it has played a few seconds (or nothing came before it), else play the one before. */
  previous?(): Promise<void>;
  /** Play a song of the music queue by id (the stage's Up next list). */
  play?(id: string): Promise<void>;
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
  // MEDIA-PARITY-02: a crossfade starts the next song in its own element before the held one ends; `elementFor` for that same song takes
  // that element (already playing) instead of making a new one, so the song carries on without a restart.
  let primed: { id: string; src: string; el: HTMLMediaElement } | null = null;
  const listeners = new Set<() => void>();
  const notify = () => queueMicrotask(() => listeners.forEach((listener) => listener()));
  const playback = {
    subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); },
    isPlaying(id: string) { return current?.id === id && !current.el.paused && !current.el.ended; },
    pause(id: string) { if (current?.id === id) current.el.pause(); },
  };
  const drop = (entry: HoistedMedia) => {
    entry.el.pause();
    entry.el.removeAttribute("src");
    entry.el.load();
    entry.el.remove();
  };
  return {
    get: (): HoistedMedia | null => current,
    playback,
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
      const taken = primed && primed.id === ref.id && primed.src === ref.src && ref.kind === "audio" ? primed.el : null;
      if (primed && !taken) { primed.el.pause(); primed.el.removeAttribute("src"); primed.el.load(); primed.el.remove(); }
      primed = null;
      const el = taken ?? document.createElement(ref.kind === "audio" ? "audio" : "video");
      if (!taken) {
        if (wasClosed) el.preload = "none";
        el.setAttribute("src", ref.src);
        el.autoplay = appId === "music" && !wasClosed;
      }
      // The Player that asked for it adopts it in the same commit, and parks it in the kit's hidden spot when it goes. This file does
      // not import the Player (it stays out of the shell's main chunk; PackageAppPage loads it on demand).
      el.addEventListener("play", () => {
        if (current?.el === el) closedId = null;
        if (current?.el === el && !current.started) {
          current = { ...current, started: true };
          notify();
        }
      });
      for (const event of ["play", "pause", "ended", "emptied"] as const) el.addEventListener(event, notify);
      // A live station is asked for by the person's press on Play, so its bar opens at once and shows Connecting until sound arrives.
      current = { ...ref, appId, el, started: taken ? !el.paused : el.autoplay && liveStationIdOf(ref.src) !== null };
      notify();
      return el;
    },
    /** MEDIA-PARITY-02: hold an element that is already playing this song until `elementFor` asks for it. A second call replaces the first. */
    prime(ref: Pick<MediaItemRef, "id" | "src">, el: HTMLMediaElement) {
      if (primed && primed.el !== el) { primed.el.pause(); primed.el.removeAttribute("src"); primed.el.load(); primed.el.remove(); }
      primed = { id: ref.id, src: ref.src, el };
    },
    /** Drop a primed element nobody took (the fade was cancelled). */
    unprime(el: HTMLMediaElement) {
      if (primed?.el !== el) return;
      el.pause(); el.removeAttribute("src"); el.load(); el.remove();
      primed = null;
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
export const MediaDockContext = createContext<MediaDock>({ current: null, clear: () => {}, next: async () => {}, previous: async () => {}, play: async () => {} });

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
  const [pick, setPick] = useState<{ kind: PickKind | "audio" | "video"; start: "voice" | "music"; resolve: (picked: PickedMedia | null) => void } | null>(null);
  const pickRef = useRef(pick);
  pickRef.current = pick;
  const pickMedia = useCallback((kind: PickKind | "audio" | "video") => new Promise<PickedMedia | null>((resolve) => {
    pickRef.current?.resolve(null);
    // VIDEO-STUDIO-07: the Studio's Add a clip (`video`) and Add a voice or Add music (`audio`; the kit does not say which, so the button that was pressed
    // chooses the side of the box that opens first). A prompt bar's reference slots still take pictures only.
    const label = typeof document !== "undefined" ? document.activeElement?.textContent ?? "" : "";
    setPick({ kind, start: /voice/i.test(label) ? "voice" : "music", resolve });
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
      playback: store.playback,
      async onPlay(mediaId, item) {
        if (mediaId === "story" && typeof item.story_id === "string") return listener.listen(item.story_id);
        // MEDIA-PARITY-02: a Library row's Save for offline arrives as a play with the media id `offline:<song id>`; it keeps or removes the copy and says which.
        const offline = offlineIdOf(mediaId);
        if (offline !== null) { pushRef.current(await toggleKeptSong(offline)); return; }
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
  const djFor = useMusicDj(current ? { id: current.id, appId: current.appId, live: liveStationIdOf(current.src) !== null } : null);
  const voiceoverFor = useCallback((ref: MediaItemRef) => ref.id === djFor?.id ? djFor?.voiceover : undefined, [djFor]);
  // NOW-PLAYING-01: on the Music app's pages the kit's Now Playing draws shuffle, repeat and the Up next button from the same play mode the
  // stage uses (media/playMode.ts, kept on this device) and opens the same Up next view the stage has. Other apps' players get neither.
  const playMode = usePlayMode();
  const inMusic = mediaAppOfPath(location.pathname) === "music";
  const hostWithDj = useMemo<MediaHost>(() => ({
    ...host,
    voiceoverFor,
    ...(inMusic ? {
      playMode: { shuffle: playMode.shuffle, repeat: playMode.repeat, onShuffle: () => setPlayMode({ shuffle: !getPlayMode().shuffle }), onRepeat: () => setPlayMode({ repeat: nextRepeat(getPlayMode().repeat) }) },
      openQueue: () => requestStage("queue"),
    } : {}),
  }), [host, voiceoverFor, inMusic, playMode.shuffle, playMode.repeat]);
  // MEDIA-VIZ-03: the next song of the music queue, for the mini bar's Next and the Media Session's next track (and, when a song ends
  // away from Now playing, the host keeps the same queue moving with it). Null when there is no queue or no next song.
  // MUSIC-STAGE-01: songs played this session, newest last, so Previous can go back.
  const history = useRef<string[]>([]);
  const playQueued = useCallback(async (wanted: string, held: HoistedMedia, remember: boolean) => {
    const queued = await request<{ id: string }>("/api/plugins/music/queue", { method: "POST", body: JSON.stringify({ id: wanted }) });
    type NextItem = { id: string; src: string; title: string; subtitle?: string; poster?: string };
    const next = await api.appData<NextItem | []>("music", "item", { id: queued.id });
    if (Array.isArray(next) || store.get()?.id !== held.id) return;
    if (remember) history.current.push(held.id);
    const { parkMedia } = await import("@maipai/ui/src/primitives/Player");
    const el = store.elementFor({ id: next.id, src: next.src, kind: "audio", title: next.title, subtitle: next.subtitle, poster: next.poster }, "music");
    parkMedia(el);
    await el.play();
  }, [store]);
  /** The song that follows `heldId`: the queue's own next song, or any later one with shuffle; null when there is none. */
  const nextAfter = useCallback(async (heldId: string): Promise<string | null> => {
    const mode = getPlayMode();
    const nextId = await nextMusicQueueId(heldId);
    const ahead = mode.shuffle ? (await api.appData<Array<{ id: string }>>("music", "up-next", { id: heldId })).map((row) => row.id) : [];
    return chooseNext({ nextId, ahead, currentId: heldId, first: history.current[0], mode });
  }, []);
  const advance = useCallback(async () => {
    const held = store.get();
    if (!held || held.appId !== "music") return;
    try {
      const queuedId = await nextAfter(held.id);
      if (!queuedId || store.get()?.id !== held.id) return;
      await playQueued(queuedId, held, true);
    } catch {
      // Keep the last item available for Play when a queue read or browser autoplay fails.
    }
  }, [store, playQueued, nextAfter]);
  const previous = useCallback(async () => {
    const held = store.get();
    if (!held || held.appId !== "music") return;
    const before = history.current[history.current.length - 1];
    if (!before || held.el.currentTime > 3) { held.el.currentTime = 0; return; }
    try {
      history.current.pop();
      await playQueued(before, held, false);
    } catch { history.current.push(before); }
  }, [store, playQueued]);
  const playId = useCallback(async (id: string) => {
    const held = store.get();
    if (!held || held.appId !== "music" || held.id === id) return;
    try { await playQueued(id, held, true); } catch { /* the song stays as it was */ }
  }, [store, playQueued]);
  // Repeat "one" loops the held song, whichever page is open.
  useEffect(() => {
    if (!current || current.appId !== "music") return;
    current.el.loop = playMode.repeat === "one" && liveStationIdOf(current.src) === null;
  }, [current, playMode.repeat]);
  // The schema Player advances on Now playing. Away from that page, the host keeps the same queue moving.
  useEffect(() => {
    if (!current || current.appId !== "music") return;
    const ended = () => { if (handedOff.has(current.el)) return; if (pathRef.current !== "/apps/music/play") void advance(); };
    current.el.addEventListener("ended", ended);
    return () => current.el.removeEventListener("ended", ended);
  }, [current, advance]);
  // MEDIA-PARITY-02: tell the hub which songs this device keeps for offline play, once per start and whenever the browser comes back online.
  useEffect(() => {
    if (!personId) return;
    void reportKeptSongs();
    const again = () => { void reportKeptSongs(); };
    window.addEventListener("online", again);
    return () => window.removeEventListener("online", again);
  }, [personId]);
  // MEDIA-PARITY-02: the person's Music sound settings. Crossfade is read here; the Equalizer preset is seeded into its store (which the menu and the
  // audio graph read) and its writer saves a choice back to the setting.
  const queryClient = useQueryClient();
  const soundScope = personId ? `person:${personId}` : null;
  const sound = useQuery({ queryKey: ["settings-values", soundScope], queryFn: () => api.settingsValues(soundScope!), enabled: soundScope !== null });
  const soundRows = Array.isArray(sound.data) ? sound.data : null;
  const crossfadeS = crossfadeSeconds(soundRows?.find((entry) => entry.key === "music.crossfade_s")?.value);
  const savedEq = soundRows?.find((entry) => entry.key === "music.eq_preset")?.value;
  const haveSound = soundRows !== null;
  useEffect(() => { if (haveSound) seedEqPreset(savedEq); }, [haveSound, savedEq]);
  useEffect(() => {
    if (!soundScope) return;
    setEqWriter((preset) => { api.setSetting(soundScope, "music.eq_preset", preset).then(() => queryClient.invalidateQueries({ queryKey: ["settings-values", soundScope] })).catch(() => {}); });
    return () => setEqWriter(null);
  }, [soundScope, queryClient]);
  const eq = useEqPreset();
  const heldEl = current?.el ?? null;
  const heldMusic = current?.appId === "music" && current.kind === "audio" && current.src ? current : null;
  const heldLive = heldMusic ? liveStationIdOf(heldMusic.src) !== null : false;
  // A tone preset needs the element routed through Web Audio (tapped once, when it plays). Not on iOS, where that would end background playback.
  useEffect(() => {
    if (!heldEl || !heldMusic || heldLive || eq === "flat" || !eqSupported()) return;
    const tap = () => { analyserFor(heldEl); };
    const events = ["play", "playing", "timeupdate"] as const;
    events.forEach((name) => heldEl.addEventListener(name, tap));
    if (!heldEl.paused) tap();
    return () => events.forEach((name) => heldEl.removeEventListener(name, tap));
  }, [heldEl, heldMusic?.id, heldLive, eq]);
  // Crossfade: the end of this song fades into the start of the next (never a station, podcast or audiobook, and never when no next song is there).
  useEffect(() => {
    if (!heldMusic || heldLive || crossfadeS <= 0) return;
    const readNext = async (id: string) => {
      const item = await api.appData<{ id: string; src: string; title: string; subtitle?: string; poster?: string } | []>("music", "item", { id });
      return Array.isArray(item) ? null : item;
    };
    return attachCrossfade({ id: heldMusic.id, appId: heldMusic.appId, kind: heldMusic.kind, src: heldMusic.src, el: heldMusic.el, live: false }, {
      seconds: crossfadeS, ios: isIos(), store,
      pickNext: (held) => nextAfter(held.id),
      readNext,
      makeElement: () => document.createElement("audio"),
      afterHandOff: ({ from, next, el }) => {
        history.current.push(from.id);
        void import("@maipai/ui/src/primitives/Player").then(({ parkMedia }) => parkMedia(el));
        void request("/api/plugins/music/queue", { method: "POST", body: JSON.stringify({ id: next.id }) }).catch(() => undefined);
        const to = pathRef.current === "/apps/music/play" ? playRoute("track", next.id) : null;
        if (to) navigate(to, { state: { pageState: { id: next.id } } });
      },
    });
  }, [heldMusic?.id, heldMusic?.el, heldLive, crossfadeS, store, nextAfter, navigate]);
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
  const dock = useMemo<MediaDock>(() => ({ current, voiceover: current?.id === djFor?.id ? djFor?.voiceover : undefined, clear: store.clear, next: advance, previous, play: playId, retry }), [current, djFor, store, advance, previous, playId, retry]);
  // The element is unloaded when the person signs out or the shell goes away.
  useEffect(() => () => store.clear(), [store]);
  return (
    <MediaHostContext.Provider value={hostWithDj}>
      <MediaDockContext.Provider value={dock}>
       <ListenStatusContext.Provider value={speech}>
        {current ? <MediaPlayerRegistration adultOnly={refuseAdultOnly(current)} appId={current.appId} mediaId={current.id} element={current.el} {...(liveId !== null ? { liveSubtitle: current.subtitle ?? "" } : {})} next={current.appId === "music" ? () => { void advance(); } : undefined} /> : null}
        {children}
        {pick ? (
          <Dialog open onOpenChange={(open) => { if (!open) { pick.resolve(null); setPick(null); } }}>
            <DialogContent scroll="viewport">
              <DialogHeader>
                <DialogTitle>{pick.kind === "video" ? i18n._({ id: "Choose a clip", message: "Choose a clip" }) : pick.kind === "audio" ? "Add a voice or music" : "Choose a picture"}</DialogTitle>
                <DialogDescription>{pick.kind === "video" ? i18n._({ id: "Pick one of your own clips to put after this one.", message: "Pick one of your own clips to put after this one." }) : pick.kind === "audio" ? "Type a line for Home to say, or pick one of your songs." : "The video starts from this picture. Choose one from your Library or add a new one."}</DialogDescription>
              </DialogHeader>
              {pick.kind === "video" || pick.kind === "audio"
                ? <StudioPickerBody kind={pick.kind} start={pick.start} personId={personId} onDone={(picked) => { pick.resolve(picked); setPick(null); }} />
                : <MediaPickerBody kind={pick.kind} personId={personId} onDone={(picked) => { pick.resolve(picked); setPick(null); }} />}
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
