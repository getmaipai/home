// MEDIA-PARITY-02: the Equalizer preset (setting `music.eq_preset`, flat | bass | treble | vocal). The media host seeds it from the person's
// setting and registers the writer that saves a choice; the menu and the audio graph read and set it here, so there is one value.
import { useSyncExternalStore } from "react";
import { eqPresetOf, setEqPresetOnGraph, type EqPreset } from "@/lib/media/audioGraph";

let preset: EqPreset = "flat";
let writer: ((next: EqPreset) => void) | null = null;
const listeners = new Set<() => void>();
const publish = (next: EqPreset) => {
  if (next === preset) return;
  preset = next;
  setEqPresetOnGraph(next);
  listeners.forEach((listener) => listener());
};

export const getEqPresetChoice = (): EqPreset => preset;
/** The person chose a preset: it applies at once and is saved to their setting. */
export function chooseEqPreset(next: EqPreset): void {
  publish(next);
  writer?.(next);
}
/** The saved setting arrived (or changed elsewhere): apply it without writing it back. */
export const seedEqPreset = (value: unknown): void => publish(eqPresetOf(value));
export function setEqWriter(next: ((preset: EqPreset) => void) | null): void { writer = next; }
export function useEqPreset(): EqPreset {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, getEqPresetChoice, getEqPresetChoice);
}
