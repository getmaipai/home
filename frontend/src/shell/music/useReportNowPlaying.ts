import { useEffect } from "react";
import { musicPlayer, type MusicPlayerStore } from "./musicPlayer";

type Payload = { state: "playing" | "stopped"; song_id?: string; key?: string; title?: string };
type Timers = { setTimeout(fn: () => void, ms: number): ReturnType<typeof setTimeout>; clearTimeout(id: ReturnType<typeof setTimeout>): void; setInterval(fn: () => void, ms: number): ReturnType<typeof setInterval>; clearInterval(id: ReturnType<typeof setInterval>): void; pagehide(fn: () => void): () => void };
const defaultTimers: Timers = { setTimeout, clearTimeout, setInterval, clearInterval, pagehide(fn) { window.addEventListener("pagehide", fn); return () => window.removeEventListener("pagehide", fn); } };
async function post(payload: Payload, keepalive = false): Promise<void> {
  try { await fetch("/api/music/now-playing", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), keepalive }); } catch { /* player reporting is best effort */ }
}
export function createNowPlayingReporter(store: MusicPlayerStore, send: (payload: Payload, keepalive?: boolean) => Promise<unknown> | unknown = post, timers: Timers = defaultTimers): () => void {
  let debounce: ReturnType<typeof setTimeout> | undefined, heartbeat: ReturnType<typeof setInterval> | undefined;
  let signature = "";
  const snapshotPayload = (): Payload => { const { track, playing } = store.get(); return track && playing ? { state: "playing", song_id: track.songId ?? undefined, key: track.key, title: track.title } : { state: "stopped" }; };
  const stopHeartbeat = () => { if (heartbeat !== undefined) timers.clearInterval(heartbeat); heartbeat = undefined; };
  const beginHeartbeat = () => { stopHeartbeat(); heartbeat = timers.setInterval(() => { const payload = snapshotPayload(); if (payload.state === "playing") void Promise.resolve(send(payload)).catch(() => {}); }, 60_000); };
  const changed = () => {
    const { track, playing } = store.get(); const next = `${track?.key ?? ""}|${playing}`;
    if (next === signature) return;
    signature = next;
    if (debounce !== undefined) timers.clearTimeout(debounce);
    stopHeartbeat();
    debounce = timers.setTimeout(() => { const payload = snapshotPayload(); void Promise.resolve(send(payload)).catch(() => {}); if (payload.state === "playing") beginHeartbeat(); }, 600);
  };
  const unsubscribe = store.subscribe(changed);
  changed();
  const removePagehide = timers.pagehide(() => { void Promise.resolve(send({ state: "stopped" }, true)).catch(() => {}); });
  return () => { unsubscribe(); removePagehide(); if (debounce !== undefined) timers.clearTimeout(debounce); stopHeartbeat(); };
}
export function useReportNowPlaying(): void { useEffect(() => createNowPlayingReporter(musicPlayer), []); }
