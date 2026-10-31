// AUDIO-SESSION-01: React access to the shell's audio session (audioSession.ts). The provider wires the signed-in
// person's `audio.speed.<kind>` settings in and out; the hooks are what a media app uses. Nothing here draws: a media
// app places the kit Player's `mini` layout from `useMiniBar()` inside its own area (RULES S2, S6).
import { createContext, useContext, useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
  audioSession,
  SPEED_KINDS,
  speedSettingKey,
  type AudioHandle,
  type AudioItem,
  type AudioKind,
  type AudioSession,
  type AudioSnapshot,
  type MiniBarState,
  type SpeedKind,
} from "@/shell/audioSession";

const AudioSessionContext = createContext<AudioSession>(audioSession);

export function AudioSessionProvider({ personId, session = audioSession, children }: { personId: string; session?: AudioSession; children: ReactNode }) {
  const scope = `person:${personId}`;
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["settings-values", scope], queryFn: () => api.settingsValues(scope) });

  useEffect(() => {
    session.setSpeedWriter((kind, rate) => {
      api.setSetting(scope, speedSettingKey(kind), rate)
        .then(() => queryClient.invalidateQueries({ queryKey: ["settings-values", scope] }))
        .catch(() => {});
    });
    return () => session.setSpeedWriter(null);
  }, [session, scope, queryClient]);

  useEffect(() => {
    if (!query.data) return;
    const speeds: Partial<Record<SpeedKind, number>> = {};
    for (const kind of SPEED_KINDS) {
      const found = query.data.find((item) => item.key === speedSettingKey(kind))?.value;
      if (typeof found === "number" && Number.isFinite(found)) speeds[kind] = found;
    }
    session.setSpeeds(speeds);
  }, [session, query.data]);

  return <AudioSessionContext.Provider value={session}>{children}</AudioSessionContext.Provider>;
}

/** The session itself: `controls`, `startSleepTimer(option)`, `cancelSleepTimer()`, `registerElement`, `registerVoice`. */
export function useAudioSession(): AudioSession {
  return useContext(AudioSessionContext);
}

/** Re-renders when what plays, its play state or rate, or the sleep timer changes (not on every second of playback). */
export function useAudioSessionState(): AudioSnapshot {
  const session = useAudioSession();
  return useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
}

/** The state and controls a media app needs to place the kit Player's `mini` layout. `state` is null when nothing is
 * loaded or only chat voice plays: draw nothing then. */
export function useMiniBar(): { state: MiniBarState | null; controls: AudioSession["controls"]; sleep: AudioSnapshot["sleep"]; startSleepTimer: AudioSession["startSleepTimer"]; cancelSleepTimer: AudioSession["cancelSleepTimer"] } {
  const session = useAudioSession();
  const snapshot = useAudioSessionState();
  return { state: snapshot.miniBar, controls: session.controls, sleep: snapshot.sleep, startSleepTimer: session.startSleepTimer, cancelSleepTimer: session.cancelSleepTimer };
}

export interface UseAudioRegistrationOptions {
  kind: AudioKind;
  item: AudioItem;
  previous?: () => void;
  next?: () => void;
}

/** Registers a media element with the session for as long as it is mounted. Pass the element (from a callback ref or
 * state), not a ref object, so the effect runs when it appears. Returns the handle (null until registered). */
export function useAudioRegistration(element: HTMLMediaElement | null, options: UseAudioRegistrationOptions): { current: AudioHandle | null } {
  const session = useAudioSession();
  const handle = useRef<AudioHandle | null>(null);
  const latest = useRef(options);
  latest.current = options;
  const { kind } = options;
  const hasPrevious = Boolean(options.previous);
  const hasNext = Boolean(options.next);
  useEffect(() => {
    if (!element) return;
    const registered = session.registerElement(element, {
      kind,
      item: latest.current.item,
      ...(hasPrevious ? { previous: () => latest.current.previous?.() } : {}),
      ...(hasNext ? { next: () => latest.current.next?.() } : {}),
    });
    handle.current = registered;
    return () => {
      registered.release();
      handle.current = null;
    };
  }, [session, element, kind, hasPrevious, hasNext]);
  const { item } = options;
  useEffect(() => { handle.current?.updateItem(item); }, [item]);
  return handle;
}
