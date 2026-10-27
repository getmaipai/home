import { createContext, useContext, useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";

export type AmbientRing = "listening" | "thinking" | "speaking" | null;
export type AmbientWakeIndicator = { listening: string; onTurnOff: () => void } | null;
export function ambientRingFromWake(indicator: Pick<NonNullable<AmbientWakeIndicator>, "listening"> | null): AmbientRing {
  return indicator ? "listening" : null;
}
const noopRing: Dispatch<SetStateAction<AmbientRing>> = () => {};
const noopWake: Dispatch<SetStateAction<AmbientWakeIndicator>> = () => {};
const AmbientRingContext = createContext<[AmbientRing, Dispatch<SetStateAction<AmbientRing>>]>([null, noopRing]);
const AmbientWakeContext = createContext<[AmbientWakeIndicator, Dispatch<SetStateAction<AmbientWakeIndicator>>]>([null, noopWake]);

export function AmbientRingProvider({ children, initial = null, value, onChange, wake, onWakeChange }: { children: ReactNode; initial?: AmbientRing; value?: AmbientRing; onChange?: Dispatch<SetStateAction<AmbientRing>>; wake?: AmbientWakeIndicator; onWakeChange?: Dispatch<SetStateAction<AmbientWakeIndicator>> }) {
  const localState = useState<AmbientRing>(initial);
  const state: [AmbientRing, Dispatch<SetStateAction<AmbientRing>>] = [value ?? localState[0], onChange ?? localState[1]];
  const localWake = useState<AmbientWakeIndicator>(null);
  const wakeState: [AmbientWakeIndicator, Dispatch<SetStateAction<AmbientWakeIndicator>>] = [wake ?? localWake[0], onWakeChange ?? localWake[1]];
  return <AmbientRingContext.Provider value={state}><AmbientWakeContext.Provider value={wakeState}>{children}</AmbientWakeContext.Provider></AmbientRingContext.Provider>;
}

export function useAmbientRing(): Dispatch<SetStateAction<AmbientRing>> {
  return useContext(AmbientRingContext)[1];
}

export function useAmbientRingValue(): AmbientRing {
  return useContext(AmbientRingContext)[0];
}

export function useAmbientWake(): AmbientWakeIndicator {
  return useContext(AmbientWakeContext)[0];
}

export function useSetAmbientWake(wake: AmbientWakeIndicator): void {
  const setWake = useContext(AmbientWakeContext)[1];
  const listening = wake?.listening;
  const onTurnOff = wake?.onTurnOff;
  useEffect(() => {
    setWake(listening && onTurnOff ? { listening, onTurnOff } : null);
    return () => setWake(null);
  }, [listening, onTurnOff, setWake]);
}

export function useSetAmbientRing(ring: AmbientRing): void {
  const setRing = useAmbientRing();
  useEffect(() => { setRing(ring); return () => setRing(null); }, [ring, setRing]);
}
