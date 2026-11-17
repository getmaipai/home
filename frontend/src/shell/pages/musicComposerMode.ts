// COMPOSER (one composer, 2026-11-13): the modes of the Music composer, as DATA. This file builds the kit's mode records
// (`PromptBarMode` and the Quality chip) from the page's state; it draws nothing. COMPOSER-03 will serve the same records from the
// package's Create page JSON; until then the Music page builds them here, so moving them is a swap of the source, not of the shape.
// The mode pill picks what is made (Song, Sound effect, Voiceover, Band, Album, Style); each mode brings its own words, chips and button.
import { i18n } from "@lingui/core";
import type { PromptBarMode } from "@maipai/ui/src/elements/prompt-bar";
import type { ComposerChipData, ComposerQualityData } from "@maipai/ui/src/elements/composer-parts";
import {
  EDIT_CHANGES, createLabel, setStarter, soundLabel, starterOf,
  type CreateForm, type EditChange, type SoundForm, type Takes, type Tier,
} from "./musicCreateForm";
import { kitChipsOf, type ComposerModeRecord } from "@/shell/composer/composerModes";
import { tagsOf, withTag, type VoiceMode, type VoiceOption } from "./MusicVoiceCreate";

/** What the person is making: the composer's modes. */
export type Make = "song" | "sound" | "voice" | "band" | "album" | "song_style";
const MAKE_ORDER: readonly Make[] = ["song", "sound", "voice", "band", "album", "song_style"];
export const MAKES: () => Array<{ id: Make; label: string }> = () => ([
  { id: "song", label: i18n._({ id: "Song", message: "Song" }) }, { id: "sound", label: i18n._({ id: "Sound effect", message: "Sound effect" }) },
  { id: "voice", label: i18n._({ id: "Voiceover", message: "Voiceover" }) }, { id: "band", label: i18n._({ id: "Band", message: "Band" }) },
  { id: "album", label: i18n._({ id: "Album", message: "Album" }) }, { id: "song_style", label: i18n._({ id: "Style", message: "Style" }) },
]);
export const isMake = (value: string | null | undefined): value is Make => MAKE_ORDER.includes(value as Make);
/** The makes that start a saved record from a name (the editor opens on it for the rest). */
export const RECORD_MAKES: readonly Make[] = ["band", "album", "song_style"];
const ICONS = { song: "music", sound: "audio-waveform", voice: "mic", band: "users", album: "disc-3", song_style: "palette" } as const;

export interface MusicComposerInput {
  make: Make;
  /** The hub's mode records (`GET /api/composer/modes`): the Song and Sound effect chips are theirs. Absent until the list has loaded. */
  records?: readonly ComposerModeRecord[] | undefined;
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
  /** What to do with the brought song, and the household voices that can sing it (adults only; empty otherwise). */
  change: EditChange;
  householdVoices: ReadonlyArray<{ id: string; label: string }>;
  householdVoice: string;
  setChange: (change: EditChange) => void;
  setHouseholdVoice: (id: string) => void;
  /** The voiceover state (the Voiceover mode); absent when the page has not loaded it. */
  voice?: VoiceMode;
  setForm: (patch: Partial<CreateForm>) => void;
  setSound: (patch: Partial<SoundForm>) => void;
  onPickReference: () => void;
  /** Opens the picker for the file whose voice is changed (audio or video). */
  onPickSource: () => void;
  onClearReference: () => void;
  onTags: (tags: string[]) => void;
  onClear: () => void;
}

const NONE = "";
/** The longest My styles or My bands list a popover shows; the rest are in My creations. */
export const PRESET_LIMIT = 12;

const placeholderOf = (make: Make, input: Pick<MusicComposerInput, "reference" | "voice">): string => {
  if (make === "song" && input.reference) {
    return i18n._({ id: "Say how the song should sound instead, like soft jazz with a slow piano.", message: "Say how the song should sound instead, like soft jazz with a slow piano." });
  }
  if (make === "sound") return i18n._({ id: "Describe the sound you want, like a door creaking or rain on a tin roof.", message: "Describe the sound you want, like a door creaking or rain on a tin roof." });
  if (make === "voice") return input.voice?.operation === "change" ? i18n._({ id: "Add an audio or video file with the plus button, then pick the new voice.", message: "Add an audio or video file with the plus button, then pick the new voice." }) : i18n._({ id: "Type what you want said. Add a tag like [sighs] where the voice should.", message: "Type what you want said. Add a tag like [sighs] where the voice should." });
  if (make === "band") return i18n._({ id: "Name your band. You add the sound and the story next.", message: "Name your band. You add the sound and the story next." });
  if (make === "album") return i18n._({ id: "Name your album. You add the sound and the cover next.", message: "Name your album. You add the sound and the cover next." });
  if (make === "song_style") return i18n._({ id: "Name your style. You say how it sounds next.", message: "Name your style. You say how it sounds next." });
  return i18n._({ id: "Describe the song you want. Add details like instruments or the kind of voice.", message: "Describe the song you want. Add details like instruments or the kind of voice." });
};
const detailOf = (make: Make, takes: number): string | undefined => {
  if (make === "song") return takes > 1 ? i18n._({ id: "About {count} minutes", message: "About {count} minutes", values: { count: takes } }) : i18n._({ id: "About a minute", message: "About a minute" });
  if (make === "sound") return i18n._({ id: "A few seconds", message: "A few seconds" });
  return undefined;
};
const EDIT_LABEL: () => Record<EditChange, string> = () => ({
  restyle: i18n._({ id: "Change the style", message: "Change the style" }), parts: i18n._({ id: "Remove the vocals", message: "Remove the vocals" }),
  stems: i18n._({ id: "Split into stems", message: "Split into stems" }), voice_swap: i18n._({ id: "Sing it in another voice", message: "Sing it in another voice" }),
});

const EDIT_ICON: Record<EditChange, "palette" | "scissors" | "layers" | "mic-vocal"> = { restyle: "palette", parts: "scissors", stems: "layers", voice_swap: "mic-vocal" };

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

/** Where each Song or Sound chip's value lives in this page's state. The chips themselves (labels, options, icons) are the hub's record,
 * `GET /api/composer/modes`, drawn by the same `kitChipsOf` Home and Chat use: one definition, drawn the same everywhere. */
const recordChips = (input: MusicComposerInput): ComposerChipData[] => {
  const { form, sound, setForm, setSound } = input;
  const get: Record<string, string | number> = {
    vocals: form.instrumental ? "instrumental" : "vocals", language: form.language, length: form.length, starter: starterOf(form.tags),
    seconds: sound.seconds, loop: sound.loop ? "on" : "off", stick: sound.stick, takes: String(form.takes),
  };
  const put = (id: string, next: string | number): void => {
    if (id === "vocals") setForm({ instrumental: next === "instrumental" });
    else if (id === "language") setForm({ language: String(next) });
    else if (id === "length") setForm({ length: next === "quick" || next === "full" ? next : "" });
    else if (id === "starter") input.onTags(setStarter(form.tags, String(next)));
    else if (id === "seconds") setSound({ seconds: String(next) });
    else if (id === "loop") setSound({ loop: next === "on" });
    else if (id === "stick") setSound({ stick: next === "surprise" ? "surprise" : "words" });
    else if (id === "takes") setForm({ takes: Number(next) as Takes });
  };
  return kitChipsOf(input.records?.find((record) => record.id === input.make)?.chips ?? [], (chip) => get[chip.id] ?? chip.default, (chip, next) => put(chip.id, next));
};

/** What can be done with a brought song, and which household voice sings it. */
const editChips = (input: MusicComposerInput): ComposerChipData[] => {
  const group = i18n._({ id: "Change", message: "Change" });
  const noVoices = input.householdVoices.length === 0 ? i18n._({ id: "Household voices are made on the Voices page. Make one first.", message: "Household voices are made on the Voices page. Make one first." }) : undefined;
  const chips: ComposerChipData[] = [{
    id: "change", label: group, group, icon: "wand-sparkles", iconOnly: true, value: input.change, quietValue: "restyle", onValueChange: (next) => input.setChange(String(next) as EditChange),
    options: EDIT_CHANGES.map((one) => ({ value: one, icon: EDIT_ICON[one], label: EDIT_LABEL()[one] })),
  }];
  if (input.change === "voice_swap") chips.push({
    id: "household-voice", label: i18n._({ id: "Household voice", message: "Household voice" }), group, icon: "user", iconOnly: true, value: input.householdVoice, quietValue: NONE, onValueChange: (next) => input.setHouseholdVoice(String(next)), disabledReason: noVoices,
    options: [{ value: NONE, label: i18n._({ id: "Choose a voice", message: "Choose a voice" }) }, ...input.householdVoices.map((one) => ({ value: one.id, label: one.label }))],
  });
  return chips;
};

const voiceChips = (voice: VoiceMode): ComposerChipData[] => {
  const group = i18n._({ id: "Voice", message: "Voice" });
  const options = voice.voices.map((item: VoiceOption) => ({ value: item.id, label: item.label }));
  const tags = voice.operation === "voiceover" ? tagsOf(voice.voices, voice.selectedId) : [];
  const chips: ComposerChipData[] = [
    { id: "operation", label: i18n._({ id: "What to do", message: "What to do" }), group, icon: "sliders-horizontal", iconOnly: true, value: voice.operation, quietValue: "voiceover", onValueChange: (next) => voice.setOperation(next === "change" ? "change" : "voiceover"),
      options: [{ value: "voiceover", icon: "mic", label: i18n._({ id: "Speak my words", message: "Speak my words" }) }, { value: "change", icon: "refresh-cw", label: i18n._({ id: "Change a voice", message: "Change a voice" }), detail: i18n._({ id: "The video's own sound is replaced. The original file is not changed.", message: "The video's own sound is replaced. The original file is not changed." }) }] },
    { id: "voice", label: group, group, icon: "mic-vocal", iconOnly: true, value: voice.selectedId, onValueChange: (next) => voice.setVoice(String(next)), options,
      disabledReason: options.length === 0 ? i18n._({ id: "No voices are ready yet.", message: "No voices are ready yet." }) : undefined },
  ];
  if (tags.length) {
    const label = i18n._({ id: "Add a tag", message: "Add a tag" });
    chips.push({ id: "tag", label, group: label, icon: "captions", iconOnly: true, value: NONE, onValueChange: (next) => { if (next) voice.setScript(withTag(voice.script, String(next))); }, options: tags.map((tag) => ({ value: tag, label: `[${tag}]` })) });
  }
  return chips;
};

/** One mode: its words, its chips, its song or file slot and its button. */
export function musicMode(input: MusicComposerInput): PromptBarMode {
  const { make, form, setForm } = input;
  const restyle = make === "song" && input.reference !== null;
  let chips: ComposerChipData[] = [];
  if (make === "song") chips = restyle ? editChips(input) : recordChips(input);
  else if (make === "sound") chips = recordChips(input);
  else if (make === "voice" && input.voice) chips = voiceChips(input.voice);
  // Presets: the person's saved styles and bands (a short list each). The built-in starters are the Style chip.
  const presets: ComposerChipData[] = make === "song" && !restyle ? [
    ...(input.styles.length ? [{ id: "song-style", label: i18n._({ id: "My styles", message: "My styles" }), icon: "palette" as const, iconOnly: true, value: form.styleId ?? NONE, onValueChange: (next: string | number) => setForm({ styleId: next === NONE ? null : String(next) }),
      options: [{ value: NONE, label: i18n._({ id: "None", message: "None" }) }, ...input.styles.slice(0, PRESET_LIMIT).map((row) => ({ value: row.id, label: row.title ?? i18n._({ id: "Untitled style", message: "Untitled style" }) }))] }] : []),
    ...(input.bands.length ? [{ id: "band", label: i18n._({ id: "My bands", message: "My bands" }), icon: "users" as const, iconOnly: true, value: form.bandId ?? NONE, onValueChange: (next: string | number) => setForm({ bandId: next === NONE ? null : String(next) }),
      options: [{ value: NONE, label: i18n._({ id: "None", message: "None" }) }, ...input.bands.slice(0, PRESET_LIMIT).map((row) => ({ value: row.id, label: row.name ?? i18n._({ id: "Untitled band", message: "Untitled band" }) }))] }] : []),
  ] : [];
  const label = make === "song" ? (restyle ? EDIT_LABEL()[input.change] : createLabel(form.takes)) : make === "sound" ? soundLabel(form.takes)
    : make === "voice" ? (input.voice?.operation === "change" ? i18n._({ id: "Change voice", message: "Change voice" }) : i18n._({ id: "Make voiceover", message: "Make voiceover" }))
      : make === "band" ? i18n._({ id: "Make a band", message: "Make a band" }) : make === "album" ? i18n._({ id: "Make an album", message: "Make an album" }) : i18n._({ id: "Make a style", message: "Make a style" });
  const voiceChange = make === "voice" && input.voice?.operation === "change";
  const references: PromptBarMode["references"] = make === "song"
    ? [{ id: "song", label: input.reference?.name ?? i18n._({ id: "Song to change", message: "Song to change" }), kind: "audio", value: input.reference?.id ?? null, disabledReason: input.referenceReason || undefined, onPick: input.onPickReference, onRemove: input.onClearReference }]
    : voiceChange && input.voice ? [{ id: "source", label: input.voice.source?.name ?? i18n._({ id: "Audio or video", message: "Audio or video" }), kind: "audio", value: input.voice.source?.id ?? null, disabledReason: input.voice.uploading ? i18n._({ id: "Adding your file…", message: "Adding your file…" }) : undefined, onPick: input.onPickSource, onRemove: input.voice.clearSource }] : [];
  const mode = MAKES().find((one) => one.id === make)!;
  return {
    id: make, label: mode.label, icon: ICONS[make], placeholder: placeholderOf(make, input), references, chips,
    presets: presets.length ? { label: i18n._({ id: "Presets", message: "Presets" }), chips: presets } : undefined,
    tools: ["clear"], primaryLabel: label, primary: { label, detail: detailOf(make, form.takes) }, onTool: () => input.onClear(),
  };
}

/** Every mode of the composer, in the order the pill lists them. */
export function musicModes(input: MusicComposerInput): PromptBarMode[] {
  return MAKE_ORDER.map((make) => musicMode({ ...input, make }));
}

/** The words in the field. The kit sends only a field with words in it, so a change that needs no words (remove the vocals, split into stems,
 * another voice) says what it does in the field, and typing there changes nothing. `typed` is false for those. */
export function fieldOf(input: Pick<MusicComposerInput, "make" | "form" | "reference" | "change" | "voice">): { value: string; typed: boolean } {
  if (input.make === "voice") {
    if (input.voice?.operation === "change") return { value: input.voice.source ? i18n._({ id: "Change the voice of {name}", message: "Change the voice of {name}", values: { name: input.voice.source.name } }) : "", typed: false };
    return { value: input.voice?.script ?? "", typed: true };
  }
  if (input.make === "song" && input.reference && input.change !== "restyle") return { value: EDIT_LABEL()[input.change], typed: false };
  return { value: input.form.idea, typed: true };
}
