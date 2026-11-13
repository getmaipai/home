import { useEffect, useMemo, useRef, useState } from "react";
import type { PlayerVoiceover } from "@maipai/ui/src/primitives/Player";
import { api } from "@/lib/api";

export interface MusicDjCurrent { id: string; appId: string; live?: boolean }
export interface MusicDjVoice { id: string; voiceover: PlayerVoiceover }
type Item = { id: string; up_next?: { id: string } };

/** The same first queue lookup used by mediaHost's Next action. */
export async function nextMusicQueueId(after: string): Promise<string | null> {
  const item = await api.appData<Item | []>("audio", "item", { id: after });
  return Array.isArray(item) ? null : item.up_next?.id ?? null;
}

/** The next songs after `after`, read from each song's `up_next`. Read only: the queue route moves the queue's pointer, so it is never called here. */
export async function nextMusicIds(after: string, count = 2): Promise<string[]> {
  const ids: string[] = [];
  let cursor = after;
  for (let i = 0; i < count; i += 1) {
    try {
      const nextId = await nextMusicQueueId(cursor);
      if (!nextId || nextId === after || ids.includes(nextId)) break;
      ids.push(nextId);
      cursor = nextId;
    } catch { break; }
  }
  return ids;
}

/** Fetches the already prepared voiceover and quietly warms the next two queue entries. */
export function useMusicDj(current: MusicDjCurrent | null): MusicDjVoice | undefined {
  const [line, setLine] = useState<{ id: string; src: string }>();
  const lineRef = useRef<{ id: string; src: string } | undefined>(undefined);
  lineRef.current = line;
  const previousMusicId = useRef<string | null>(null);
  const track = current?.appId === "audio" && !current.live ? current : null;
  const id = track?.id ?? null;

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    const position = previousMusicId.current ? "transition" : "intro";
    previousMusicId.current = id;
    const oldLine = lineRef.current;
    if (oldLine && oldLine.id !== id) { URL.revokeObjectURL(oldLine.src); lineRef.current = undefined; setLine(undefined); }

    void (async () => {
      try {
        const response = await fetch(`/api/music/dj/line?before=${encodeURIComponent(id)}&position=${position}`);
        if (response.status !== 200) return;
        const src = URL.createObjectURL(await response.blob());
        if (cancelled) { URL.revokeObjectURL(src); return; }
        const oldLine = lineRef.current;
        if (oldLine?.src && oldLine.src !== src) URL.revokeObjectURL(oldLine.src);
        lineRef.current = { id, src };
        setLine({ id, src });
      } catch { /* DJ playback is optional; keep the song silent. */ }
    })();

    void nextMusicIds(id).then((next) => {
      if (cancelled) return;
      return fetch("/api/music/dj/prepare", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ after: id, next }) }).catch(() => undefined);
    }).catch(() => undefined);

    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => () => { if (lineRef.current?.src) URL.revokeObjectURL(lineRef.current.src); }, []);
  const voiceover = useMemo<PlayerVoiceover | undefined>(() => {
    if (!id || line?.id !== id) return undefined;
    return { src: line.src, onDone: () => setLine((old) => old?.src === line.src ? undefined : old) };
  }, [id, line]);
  return voiceover ? { id: id!, voiceover } : undefined;
}
