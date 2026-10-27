// MEDIA-VIZ-01: the one mini player for all media (music, videos, podcasts, books), pinned to the bottom of everything right of the rail
// on every page, not only inside a media app. It shows what the media host holds once the person has started it, except on the page that
// is playing that same item. Audio gets a soft audio-reactive strip and a Now playing stage; video gets Picture in picture and Full screen.
// The kit Player's `mini` layout is the bar itself, as shipped; this file only places it and adds the actions.
import { useCallback, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Player } from "@maipai/ui/src/primitives/Player";
import { Button } from "@maipai/ui/src/dashboard/components/ui/button";
import { getIcon } from "@maipai/ui/src/icons";
import { api } from "@/lib/api";
import { isMediaPlayPage, mediaAppOfPath, playPageOf } from "@/shell/mediaApps";
import { useMediaDock, type HoistedMedia } from "@/shell/mediaHost";
import { AudioVisualizer, useVisualizerPref } from "@/shell/media/AudioVisualizer";
import { NowPlayingStage } from "@/shell/media/NowPlayingStage";
import { useIsPlaying, useMediaAnalyser } from "@/shell/media/useMediaAnalyser";
import { useArtPalette } from "@/lib/media/artPalette";

/** True when the person is on the page that plays `held` right now (its watch, play, listen or read page). */
export function onPlayPageOf(held: HoistedMedia, pathname: string, search: string, stateId: string | undefined): boolean {
  const app = mediaAppOfPath(pathname);
  if (app !== held.appId) return false;
  const page = pathname.split("/")[3] || "index";
  if (!isMediaPlayPage(app, page)) return false;
  const id = new URLSearchParams(search).get("id") ?? stateId;
  return id === held.id || (app === "books" && page === "listen");
}

/** Video plays in a hidden element under the mini layout; for Picture in picture or Full screen it is shown for as long as the browser holds it. */
async function withVideoShown(el: HTMLMediaElement, enter: () => Promise<unknown>, leaveEvent: "leavepictureinpicture" | "fullscreenchange") {
  const before = el.style.display;
  el.style.display = "";
  const restore = () => {
    if (leaveEvent === "fullscreenchange" && document.fullscreenElement) return;
    el.style.display = before;
    el.removeEventListener(leaveEvent, restore);
    if (leaveEvent === "fullscreenchange") document.removeEventListener("fullscreenchange", restore);
  };
  try {
    await enter();
    if (leaveEvent === "fullscreenchange") document.addEventListener("fullscreenchange", restore);
    else el.addEventListener(leaveEvent, restore);
  } catch {
    el.style.display = before;
  }
}

export function GlobalMiniPlayer() {
  const dock = useMediaDock();
  const held = dock.current;
  const { pathname, search, state } = useLocation();
  const navigate = useNavigate();
  const [stage, setStage] = useState(false);
  const variant = useVisualizerPref();
  const isAudio = held?.kind === "audio";
  const palette = useArtPalette(isAudio ? held?.poster ?? null : null);
  const getAnalyser = useMediaAnalyser(held?.el ?? null, isAudio);
  const playing = useIsPlaying(held?.el ?? null);
  const closeStage = useCallback(() => setStage(false), []);
  const stateId = (state as { pageState?: { id?: string } } | null)?.pageState?.id;
  if (!held || !held.started || onPlayPageOf(held, pathname, search, stateId)) return null;

  const CloseIcon = getIcon("x"), WaveIcon = getIcon("audio-waveform"), PipIcon = getIcon("picture-in-picture"), FullIcon = getIcon("maximize");
  const el = held.el;
  const pictureInPicture = typeof document !== "undefined" && "pictureInPictureEnabled" in document && document.pictureInPictureEnabled && el instanceof HTMLVideoElement;
  const openPlayPage = () => navigate(`/apps/${held.appId}/${playPageOf(held.appId)}?id=${encodeURIComponent(held.id)}`, { state: { pageState: { id: held.id } } });

  return (
    <div data-slot="global-mini-player" data-testid="global-mini-player" className="pointer-events-none fixed inset-x-0 bottom-0 z-40 md:start-14 print:hidden">
      <div className="pointer-events-auto relative">
        <Player
          key={held.id}
          media={el}
          src={held.src}
          kind={held.kind}
          layout="mini"
          placement="dock"
          title={held.title}
          subtitle={held.subtitle}
          poster={held.poster}
          mediaSession={false}
          onExpand={openPlayPage}
          onProgress={(p) => {
            api.mediaProgress(held.appId, { media_id: held.id, position_s: p.position_s, duration_s: p.duration_s, reason: p.reason }, p.reason === "unload").catch(() => {});
          }}
          actionsSlot={
            <>
              {isAudio ? <Button variant="ghost" size="icon" aria-label="Open Now playing with visualizer" onClick={() => setStage(true)}><WaveIcon aria-hidden="true" /></Button> : null}
              {pictureInPicture ? <Button variant="ghost" size="icon" aria-label="Picture in picture" onClick={() => void withVideoShown(el, () => (el as HTMLVideoElement).requestPictureInPicture(), "leavepictureinpicture")}><PipIcon aria-hidden="true" /></Button> : null}
              {held.kind === "video" ? <Button variant="ghost" size="icon" aria-label="Full screen" onClick={() => void withVideoShown(el, () => el.requestFullscreen(), "fullscreenchange")}><FullIcon aria-hidden="true" /></Button> : null}
              <Button variant="ghost" size="icon" aria-label={`Close the player: ${held.title}`} onClick={dock.clear}><CloseIcon aria-hidden="true" /></Button>
            </>
          }
        />
        {isAudio ? <AudioVisualizer variant={variant} mode="strip" getAnalyser={getAnalyser} palette={palette} active={playing} opacity={0.35} fade className="pointer-events-none absolute inset-0 size-full" /> : null}
      </div>
      {stage ? <NowPlayingStage media={held} onClose={closeStage} /> : null}
    </div>
  );
}
