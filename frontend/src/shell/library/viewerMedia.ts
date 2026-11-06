// Reaches the video or audio element the kit MediaViewer draws.
//
// Why this exists: MediaViewer (kit ui-v0.5.505) draws its own Player and offers no `tracks`, `mediaRef`, time or seek
// props, and the kit is a separate repo. Until it does, these three small helpers are the only place Home touches the
// viewer's media element. Drop them when the kit gains those props.
import { useEffect, useState } from "react";

const VIEWER_MEDIA = "[role=dialog] video, [role=dialog] audio";

export function viewerMedia(): HTMLMediaElement | null {
  return document.querySelector<HTMLMediaElement>(VIEWER_MEDIA);
}

export function seekViewerMedia(seconds: number): void {
  const media = viewerMedia();
  if (!media) return;
  media.currentTime = seconds;
  void media.play()?.catch(() => undefined);
}

// timeupdate does not bubble, so one capture listener on the document follows whichever element the viewer draws.
export function useViewerMediaTime(active: boolean): number {
  const [time, setTime] = useState(0);
  useEffect(() => {
    if (!active) return;
    const onTime = (event: Event) => {
      const target = event.target;
      if (target instanceof HTMLMediaElement && target.closest("[role=dialog]")) setTime(target.currentTime);
    };
    document.addEventListener("timeupdate", onTime, true);
    return () => document.removeEventListener("timeupdate", onTime, true);
  }, [active]);
  return time;
}

// Shows a WebVTT file as captions on the viewer's media element. Returns a function that removes them.
export function addCaptionTrack(url: string, language: string, label: string): () => void {
  const media = viewerMedia();
  if (!media) return () => undefined;
  const track = document.createElement("track");
  track.kind = "captions";
  track.srclang = language;
  track.label = label;
  track.default = true;
  track.src = url;
  media.append(track);
  track.addEventListener("load", () => {
    if (track.track) track.track.mode = "showing";
  });
  return () => track.remove();
}
