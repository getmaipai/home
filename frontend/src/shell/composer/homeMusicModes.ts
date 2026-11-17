import { i18n } from "@lingui/core";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ComposerQualityData } from "@maipai/ui/src/elements/composer-parts";
import { request } from "@/lib/api";
import { musicApi } from "@/lib/musicApi";
import type { PromptBarMode } from "@maipai/ui/src/elements/prompt-bar";
import { EMPTY_FORM, EMPTY_SOUND, type CreateForm, type SoundForm, type Tier } from "@/shell/pages/musicCreateForm";
import { musicMode, musicQuality, type Make, type MusicComposerInput } from "@/shell/pages/musicComposerMode";

// ONE-COMPOSER: the Song and Sound effect fields on Home are the Song page's own (musicMode), not a second copy. Home shows every
// type in one bar; the Create page shows one. Same chips, same wording, same state shape; the values travel to the page in the address.

export interface HomeMusic {
  /** The kit mode for "song" or "sound", or null for any other mode id. */
  modeFor: (id: string) => PromptBarMode | null;
  /** The Quality chip of the Song mode (the levels this person may ask for), else undefined. */
  qualityFor: (id: string) => ComposerQualityData | undefined;
  /** The address values this mode's chips add (nothing for a mode this does not own). */
  settingsFor: (id: string) => Record<string, string | number>;
}

/** `pickAudio` opens the host's audio picker; `clear` empties the words. */
export function useHomeMusic(pickAudio: () => Promise<{ id: string } | null>, clear: () => void, adult: boolean): HomeMusic {
  const [form, setFormState] = useState<CreateForm>(EMPTY_FORM);
  const [sound, setSoundState] = useState<SoundForm>(EMPTY_SOUND);
  const [reference, setReference] = useState<{ id: string; name: string } | null>(null);
  // The same reads the Song page makes (same keys, so one fetch serves both): the levels, and the saved styles and bands for Presets.
  const status = useQuery({ queryKey: ["music-status"], queryFn: () => musicApi.status(), staleTime: 10_000, retry: false });
  const styles = useQuery({ queryKey: ["music-made", "song_style"], queryFn: () => request<Array<{ id: string; title?: string }>>("/api/music/styles?scope=all"), staleTime: 15_000, enabled: adult });
  const bands = useQuery({ queryKey: ["music-made", "band"], queryFn: () => request<Array<{ id: string; name?: string }>>("/api/music/bands"), staleTime: 15_000, enabled: adult });
  const tiers: readonly Tier[] = status.data?.tiers ?? ["standard"];
  const setForm = (patch: Partial<CreateForm>) => setFormState((current) => ({ ...current, ...patch }));
  const inputFor = (make: Make): MusicComposerInput => ({
    make, form, sound, styles: styles.data ?? [], bands: bands.data ?? [], tiers, reference, referenceReason: "",
    change: "restyle", householdVoices: [], householdVoice: "", setChange: () => {}, setHouseholdVoice: () => {},
    setForm, setSound: (patch) => setSoundState((current) => ({ ...current, ...patch })),
    onPickReference: () => { void pickAudio().then((got) => { if (got) setReference({ id: got.id, name: i18n._({ id: "Your song", message: "Your song" }) }); }, () => {}); },
    onPickSource: () => {}, onClearReference: () => setReference(null),
    onTags: (tags) => setForm({ tags }), onClear: clear,
  });
  return {
    modeFor: (id) => (id === "song" || id === "sound" ? musicMode(inputFor(id)) : null),
    qualityFor: (id) => (id === "song" && !reference ? musicQuality({ form, tiers, setForm }) : undefined),
    settingsFor: (id): Record<string, string | number> => {
      if (id === "sound") return { make: "sound", seconds: sound.seconds, loop: sound.loop ? 1 : 0, stick: sound.stick };
      if (id !== "song") return {};
      const out: Record<string, string | number> = {
        tier: form.tier, ...(form.instrumental ? { instrumental: 1 } : {}), ...(form.language ? { language: form.language } : {}), ...(form.length ? { length: form.length } : {}),
        ...(form.tags.length ? { tags: form.tags.join(",") } : {}), ...(reference ? { reference: reference.id } : {}),
      };
      return out;
    },
  };
}
