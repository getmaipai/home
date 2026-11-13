// COMPOSER (one composer, 2026-11-13): the Music mode of the shared composer, as DATA. This file builds the kit's mode record
// (`PromptBarMode` and the Quality chip) from the form state; it draws nothing. COMPOSER-03 will serve the same record from the
// package's Create page JSON; until then the Music page builds it here, so moving it is a swap of the source, not of the shape.
import { i18n } from "@lingui/core";
import type { PromptBarMode } from "@maipai/ui/src/elements/prompt-bar";
import type { ComposerChipData, ComposerQualityData } from "@maipai/ui/src/elements/composer-parts";
import {
  LANGUAGES, SOUND_SECONDS, STARTER_STYLE_CHIPS, createLabel, setStarter, soundLabel, starterOf,
  type CreateForm, type SoundForm, type Takes, type Tier,
} from "./musicCreateForm";

/** What the person is making. Song and Sound are made from the composer's field; the rest open their own form under it. */
export type Make = "song" | "band" | "album" | "song_style" | "sound" | "voice";
export const MAKES: () => Array<{ id: Make; label: string }> = () => ([
  { id: "song", label: i18n._({ id: "Song", message: "Song" }) }, { id: "band", label: i18n._({ id: "Band", message: "Band" }) }, { id: "album", label: i18n._({ id: "Album", message: "Album" }) },
  { id: "song_style", label: i18n._({ id: "Style", message: "Style" }) }, { id: "sound", label: i18n._({ id: "Sound", message: "Sound" }) }, { id: "voice", label: i18n._({ id: "Voice", message: "Voice" }) },
]);
/** The makes whose own form shows under the composer; the composer's field and button wait with a reason. */
export const FORM_MAKES: readonly Make[] = ["band", "album", "song_style", "voice"];

export interface MusicComposerInput {
  make: Make;
  form: CreateForm;
  sound: SoundForm;
  /** The person's saved song styles and bands (their own come first in Presets). */
  styles: ReadonlyArray<{ id: string; title?: string }>;
  bands: ReadonlyArray<{ id: string; name?: string }>;
  /** The levels this person may ask for now; Standard only when the hub does not say. */
  tiers: readonly Tier[];
  /** A song brought to change (bring-a-song); null when none. */
  reference: { id: string; name: string } | null;
  /** Why attaching a song is off right now, or "". */
  referenceReason: string;
  setMake: (make: Make) => void;
  setForm: (patch: Partial<CreateForm>) => void;
  setSound: (patch: Partial<SoundForm>) => void;
  onPickReference: () => void;
  onClearReference: () => void;
  onTags: (tags: string[]) => void;
  onClear: () => void;
}

const NONE = "";
const placeholderOf = (make: Make, restyle: boolean): string => {
  if (restyle) return i18n._({ id: "Say how the song should sound instead, like soft jazz with a slow piano.", message: "Say how the song should sound instead, like soft jazz with a slow piano." });
  if (make === "sound") return i18n._({ id: "Describe the sound you want, like a door creaking or rain on a tin roof.", message: "Describe the sound you want, like a door creaking or rain on a tin roof." });
  if (make === "song") return i18n._({ id: "Describe the song you want. Add details like instruments or the kind of voice.", message: "Describe the song you want. Add details like instruments or the kind of voice." });
  return i18n._({ id: "Fill in the form below to make this.", message: "Fill in the form below to make this." });
};
const detailOf = (make: Make, takes: number): string | undefined => {
  if (make === "song") return takes > 1 ? i18n._({ id: "About {count} minutes", message: "About {count} minutes", values: { count: takes } }) : i18n._({ id: "About a minute", message: "About a minute" });
  if (make === "sound") return i18n._({ id: "A few seconds", message: "A few seconds" });
  return undefined;
};

export function makeChip(input: Pick<MusicComposerInput, "make" | "setMake">): ComposerChipData {
  return { id: "make", label: i18n._({ id: "Make", message: "Make" }), group: i18n._({ id: "Make", message: "Make" }), options: MAKES().map((one) => ({ value: one.id, label: one.label })), value: input.make, onValueChange: (next) => input.setMake(String(next) as Make) };
}

const takesChip = (takes: number, set: (next: Takes) => void, label: string, group: string): ComposerChipData => ({
  id: "takes", label, group, value: String(takes), onValueChange: (next) => set(Number(next) as Takes),
  options: [1, 2, 3].map((count) => ({ value: String(count), label: i18n._({ id: "{count, plural, one {# take} other {# takes}}", message: "{count, plural, one {# take} other {# takes}}", values: { count } }) })),
});

/** The Quality chip: Standard, Boost, Max (tier), only the levels this person may use. */
export function musicQuality(input: Pick<MusicComposerInput, "form" | "tiers" | "setForm">): ComposerQualityData {
  const detail: Record<Tier, { label: string; detail: string }> = {
    standard: { label: i18n._({ id: "Standard", message: "Standard" }), detail: i18n._({ id: "Fast", message: "Fast" }) },
    boost: { label: i18n._({ id: "Boost", message: "Boost" }), detail: i18n._({ id: "More detail", message: "More detail" }) },
    max: { label: i18n._({ id: "Max", message: "Max" }), detail: i18n._({ id: "Best quality", message: "Best quality" }) },
  };
  const offered: Tier[] = input.tiers.length ? [...input.tiers] : ["standard"];
  return { value: input.form.tier, band: "adult", options: offered.map((tier) => ({ value: tier, ...detail[tier], kind: "tier" as const })), onValueChange: (next) => input.setForm({ tier: next as Tier }) };
}

/** The Music mode. One mode, one popover per chip group; what the Make chip says decides the placeholder, the chips and the button. */
export function musicMode(input: MusicComposerInput): PromptBarMode {
  const { make, form, sound, setForm, setSound } = input;
  const restyle = make === "song" && input.reference !== null;
  const make_ = makeChip(input);
  const vocalsGroup = i18n._({ id: "Vocals", message: "Vocals" });
  const lengthGroup = i18n._({ id: "Length", message: "Length" });
  const soundGroup = i18n._({ id: "Sound", message: "Sound" });
  let chips: ComposerChipData[] = [make_];
  if (make === "song" && !restyle) {
    chips = [make_,
      { id: "vocals", label: i18n._({ id: "Singing", message: "Singing" }), group: vocalsGroup, value: form.instrumental ? "instrumental" : "vocals", onValueChange: (next) => setForm({ instrumental: next === "instrumental" }),
        options: [{ value: "vocals", label: i18n._({ id: "With vocals", message: "With vocals" }) }, { value: "instrumental", label: i18n._({ id: "Instrumental", message: "Instrumental" }), detail: i18n._({ id: "No singing, just the music.", message: "No singing, just the music." }) }] },
      { id: "language", label: i18n._({ id: "Vocal language", message: "Vocal language" }), group: vocalsGroup, value: form.language, onValueChange: (next) => setForm({ language: String(next) }),
        disabledReason: form.instrumental ? i18n._({ id: "Instrumental is on, so there are no words to sing.", message: "Instrumental is on, so there are no words to sing." }) : undefined,
        options: LANGUAGES.map((one) => ({ value: one.id, label: one.label() })) },
      { id: "length", label: lengthGroup, group: lengthGroup, value: form.length, onValueChange: (next) => setForm({ length: next === "quick" || next === "full" ? next : "" }),
        options: [{ value: NONE, label: i18n._({ id: "Auto", message: "Auto" }) }, { value: "quick", label: i18n._({ id: "Quick", message: "Quick" }), detail: i18n._({ id: "About 45 seconds", message: "About 45 seconds" }) }, { value: "full", label: i18n._({ id: "Full", message: "Full" }), detail: i18n._({ id: "A whole song", message: "A whole song" }) }] }];
  } else if (make === "sound") {
    chips = [make_,
      { id: "seconds", label: i18n._({ id: "Length", message: "Length" }), group: soundGroup, value: sound.seconds, onValueChange: (next) => setSound({ seconds: String(next) }), options: SOUND_SECONDS.map((one) => ({ value: one, label: i18n._({ id: "{count} seconds", message: "{count} seconds", values: { count: one } }) })) },
      { id: "loop", label: i18n._({ id: "Loop it", message: "Loop it" }), group: soundGroup, value: sound.loop ? "on" : "off", onValueChange: (next) => setSound({ loop: next === "on" }), options: [{ value: "off", label: i18n._({ id: "Once", message: "Once" }) }, { value: "on", label: i18n._({ id: "Loop it", message: "Loop it" }) }] },
      { id: "stick", label: i18n._({ id: "Words", message: "Words" }), group: i18n._({ id: "Words", message: "Words" }), value: sound.stick, onValueChange: (next) => setSound({ stick: next === "surprise" ? "surprise" : "words" }), options: [{ value: "words", label: i18n._({ id: "Stick to my words", message: "Stick to my words" }) }, { value: "surprise", label: i18n._({ id: "Surprise me", message: "Surprise me" }) }] },
      takesChip(form.takes, (next) => setForm({ takes: next }), i18n._({ id: "Takes", message: "Takes" }), i18n._({ id: "Takes", message: "Takes" }))];
  }
  // Presets: the person's saved styles and bands first, then a short built-in starter list (Home's data, not another app's files).
  const presets: ComposerChipData[] = make === "song" ? [
    ...(input.styles.length ? [{ id: "song-style", label: i18n._({ id: "My styles", message: "My styles" }), value: form.styleId ?? NONE, onValueChange: (next: string | number) => setForm({ styleId: next === NONE ? null : String(next) }),
      options: [{ value: NONE, label: i18n._({ id: "None", message: "None" }) }, ...input.styles.map((row) => ({ value: row.id, label: row.title ?? i18n._({ id: "Untitled style", message: "Untitled style" }) }))] }] : []),
    ...(input.bands.length ? [{ id: "band", label: i18n._({ id: "My bands", message: "My bands" }), value: form.bandId ?? NONE, onValueChange: (next: string | number) => setForm({ bandId: next === NONE ? null : String(next) }),
      options: [{ value: NONE, label: i18n._({ id: "None", message: "None" }) }, ...input.bands.map((row) => ({ value: row.id, label: row.name ?? i18n._({ id: "Untitled band", message: "Untitled band" }) }))] }] : []),
    { id: "starter", label: i18n._({ id: "Starter styles", message: "Starter styles" }), value: starterOf(form.tags), onValueChange: (next) => input.onTags(setStarter(form.tags, String(next))),
      options: [{ value: NONE, label: i18n._({ id: "None", message: "None" }) }, ...STARTER_STYLE_CHIPS.map((name) => ({ value: name, label: name }))] },
  ] : [];
  const label = make === "song" ? (restyle ? i18n._({ id: "Change the style", message: "Change the style" }) : createLabel(form.takes)) : make === "sound" ? soundLabel(form.takes) : i18n._({ id: "Use the form below", message: "Use the form below" });
  return {
    id: "music", label: i18n._({ id: "Music", message: "Music" }), icon: "music", placeholder: placeholderOf(make, restyle),
    references: make === "song" ? [{ id: "song", label: input.reference?.name ?? i18n._({ id: "Song to change", message: "Song to change" }), kind: "audio", value: input.reference?.id ?? null, disabledReason: input.referenceReason || undefined, onPick: input.onPickReference, onRemove: input.onClearReference }] : [],
    chips, presets: presets.length ? { label: i18n._({ id: "Presets", message: "Presets" }), chips: presets } : undefined,
    tools: ["clear"], primaryLabel: label, primary: { label, detail: detailOf(make, form.takes) }, onTool: () => input.onClear(),
  };
}
