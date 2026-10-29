import { useCallback, useEffect, useState } from "react";
import type { CompanionStateTake } from "@/lib/api";

const AV1_CODEC = 'video/mp4; codecs="av01.0.05M.08"';

/** Picks the clip file this browser can play (AV1 when it says "probably", else H.264) and honours reduced motion. */
export function useClipPreview(urls: CompanionStateTake["urls"], label: string) {
  const [source, setSource] = useState(urls.h264);
  const [failed, setFailed] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [playAnyway, setPlayAnyway] = useState(false);
  useEffect(() => {
    const video = document.createElement("video");
    setSource(urls.av1 && video.canPlayType?.(AV1_CODEC) === "probably" ? urls.av1 : urls.h264);
    setFailed(false);
  }, [urls.av1, urls.h264]);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => { setReduced(query.matches); setPlayAnyway(false); };
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);
  const onError = useCallback(() => setFailed(true), []);
  const play = useCallback(() => setPlayAnyway(true), []);
  return { source, failed, reduced: reduced && !playAnyway, label, onError, play };
}
