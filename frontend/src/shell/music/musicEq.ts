import { EQ_PRESETS, setPlayerEq, type EqPreset } from "@/lib/media/audioGraph";

export const EQ_FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;
export const EQ_STORAGE_KEY = "music.player.eq";
export const LIMITER_SETTINGS = { threshold: -1, knee: 2, ratio: 20, attack: 0.0015, release: 0.1 } as const;
export const clampLoudnessGainDb = (gain: number): number => Math.min(9, Math.max(-9, Number.isFinite(gain) ? gain : 0));
export const loudnessGainDb = (lufs: number | undefined, target = -14): number => typeof lufs === "number" && Number.isFinite(lufs) ? clampLoudnessGainDb(target - lufs) : 0;
export const boundedBandGains = (gains: readonly number[]): number[] => EQ_FREQUENCIES.map((_, index) => Math.min(12, Math.max(-12, Number.isFinite(gains[index]) ? gains[index]! : 0)));
export const presetGains = (preset: EqPreset): number[] => boundedBandGains(EQ_PRESETS[preset]);

export interface EqSettings { preset: EqPreset; gains: number[]; preampDb: number }
const initial: EqSettings = { preset: "flat", gains: presetGains("flat"), preampDb: 0 };
export function loadEqSettings(): EqSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(EQ_STORAGE_KEY) ?? "null") as Partial<EqSettings> | null;
    if (!stored) return initial;
    const preset = stored.preset && stored.preset in EQ_PRESETS ? stored.preset : "flat";
    return { preset, gains: boundedBandGains(Array.isArray(stored.gains) ? stored.gains : presetGains(preset)), preampDb: Math.min(12, Math.max(-12, Number(stored.preampDb) || 0)) };
  } catch { return initial; }
}
export function saveEqSettings(settings: EqSettings): void {
  try { localStorage.setItem(EQ_STORAGE_KEY, JSON.stringify(settings)); } catch { /* Settings last until this page closes. */ }
}
export function applyEqSettings(settings: EqSettings, trackLufs?: number): void {
  setPlayerEq(settings.gains, settings.preampDb + loudnessGainDb(trackLufs));
}

