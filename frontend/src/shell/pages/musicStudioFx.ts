// MP-04: the pure parts of the Music Studio. What the TrackStudio is given (the full song and its stems as lanes) and what an effect request says. No React, no DOM.
import { i18n } from "@lingui/core";
import type { EffectBody, MusicCard } from "@/lib/musicApi";
import type { StudioEffects, StudioSelection } from "@maipai/ui/src/elements/track-studio";

const STEM_NAMES = ["vocals", "drums", "bass", "other"] as const;

/** The song version on show: the one the card calls current, else the newest. */
export function currentVersion(song: MusicCard | undefined) {
  return song?.versions.find((version) => version.id === song.current_id) ?? song?.versions.at(-1) ?? null;
}

/** The TrackStudio's raw lanes: the full song in its Music lane, then a stem lane for each finished stem. A piece with no length is not drawn, so a song of unknown length has none. */
export function studioLanes(song: MusicCard | undefined, stems: MusicCard | undefined, durationS: number): unknown[] {
  const full = currentVersion(song);
  if (!song || !full || !(durationS > 0)) return [];
  const piece = (id: string, url: string, label: string) => ({ id: `piece-${id}`, ref: id, src: url, label, in_s: 0, out_s: durationS, source_s: durationS });
  const lanes: unknown[] = [{ id: "music", label: i18n._({ id: "Full song", message: "Full song" }), pieces: [piece(full.id, full.url, song.title ?? i18n._({ id: "Full song", message: "Full song" }))] }];
  if (stems?.state === "done") {
    for (const version of stems.versions) {
      const name = STEM_NAMES.find((stem) => stem === version.label.toLowerCase());
      if (name) lanes.push({ id: `stem-${name}`, pieces: [piece(version.id, version.url, version.label)] });
    }
  }
  return lanes;
}

export type EffectChoice = "gain" | "speed" | "pitch" | "eq_preset" | "reverse" | "remove_silence" | "limit" | "echo" | "reverb" | "denoise";
export const EQ_PRESET_CHOICES = ["bass_boost", "treble_boost", "vocal_clarity", "warm"] as const;
export interface EffectSlider { min: number; max: number; step: number; unit: string; start: number }
/** Effects that take a number have a slider; the rest are one press. */
export const EFFECT_SLIDERS: Partial<Record<EffectChoice, EffectSlider>> = {
  gain: { min: -24, max: 24, step: 1, unit: " dB", start: 3 },
  speed: { min: 0.5, max: 2, step: 0.05, unit: "x", start: 1.25 },
  pitch: { min: -12, max: 12, step: 1, unit: "", start: 2 },
};
export const EFFECT_CHOICES: readonly EffectChoice[] = ["gain", "speed", "pitch", "eq_preset", "reverse", "remove_silence", "limit", "echo", "reverb", "denoise"];

export interface EffectValue { amount?: number; preset?: (typeof EQ_PRESET_CHOICES)[number] }
/** The request for one chosen effect on a selection (or the whole song when there is none). */
export function effectBody(choice: EffectChoice, value: EffectValue, selection: StudioSelection | null): EffectBody {
  const range = selection ? { from_s: selection.start_s, to_s: selection.end_s } : {};
  if (choice === "eq_preset") return { change: "eq", preset: value.preset ?? "warm", ...range };
  if (EFFECT_SLIDERS[choice]) return { change: choice as "gain" | "speed" | "pitch", amount: value.amount ?? EFFECT_SLIDERS[choice]!.start, ...range };
  return { change: choice as EffectBody["change"], ...range };
}

/** The Studio's EQ panel applied: its six bands go to the `eq` effect. */
export const eqBody = (effects: StudioEffects, selection: StudioSelection | null): EffectBody => ({ change: "eq", bands: effects.eq.slice(0, 6), ...(selection ? { from_s: selection.start_s, to_s: selection.end_s } : {}) });
/** The Studio's compressor panel applied: its five settings go to the `compress` effect. */
export const compressBody = (effects: StudioEffects, selection: StudioSelection | null): EffectBody => ({ change: "compress", compressor: { ...effects.compressor }, ...(selection ? { from_s: selection.start_s, to_s: selection.end_s } : {}) });

/** The version before the one on show, for Undo; null on the first version. */
export function previousVersionId(song: MusicCard | undefined): string | null {
  if (!song || song.versions.length < 2) return null;
  const at = song.versions.findIndex((version) => version.id === (song.current_id ?? song.versions.at(-1)?.id));
  return at > 0 ? song.versions[at - 1]?.id ?? null : null;
}
/** The version after the one on show, for Redo; null on the newest. */
export function nextVersionId(song: MusicCard | undefined): string | null {
  if (!song) return null;
  const at = song.versions.findIndex((version) => version.id === (song.current_id ?? song.versions.at(-1)?.id));
  return at >= 0 && at < song.versions.length - 1 ? song.versions[at + 1]?.id ?? null : null;
}
