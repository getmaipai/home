// MP-U1 and MP-05: the logic of the Music composer, with nothing drawn here. The composer (MusicComposer.tsx), its mode data
// (musicComposerMode.ts) and the chat tool (`generate_music`) take the same fields: description, words, title, instrumental, vocal
// language, tier, takes, seed, length, tempo and key. The sound maker's fields live here too (`soundBody`).
import { i18n } from "@lingui/core";
import type { FileEditBody, MakeSongBody, MakeSoundBody } from "@/lib/musicApi";

export type Takes = 1 | 2 | 3;
export type Tier = "standard" | "boost" | "max";
export interface CreateForm {
  /** What the song is about and how it sounds: the composer's field. */
  idea: string;
  lyrics: string; title: string; instrumental: boolean;
  /** A language code, or "" to let the model choose. */
  language: string;
  tier: Tier;
  takes: Takes;
  /** The seed as typed; empty means a fresh one. */
  seed: string;
  length: "quick" | "full" | "";
  /** 0 means Auto. */
  bpm: number;
  /** "" means Auto. */
  key: string;
  styleId: string | null; bandId: string | null;
  /** Style chips picked (the built-in starters and the person's own words). */
  tags: string[];
}

export const EMPTY_FORM: CreateForm = { idea: "", lyrics: "", title: "", instrumental: false, language: "", tier: "standard", takes: 1, seed: "", length: "", bpm: 0, key: "", styleId: null, bandId: null, tags: [] };
export const MAX_TAGS = 8;
export const SEED_MAX = 2_147_483_646;
export const BPM_MIN = 40;
export const BPM_MAX = 240;

/** The structure tags the lyrics box offers; each one goes in at the cursor on a line of its own. */
export const STRUCTURE_TAGS = ["Intro", "Verse", "Chorus", "Bridge", "Outro"] as const;

/** A short starter list for the style presets. Home's own data: the person's saved styles and bands come first. */
export const STARTER_STYLE_CHIPS = ["Dreamy indie pop", "Lo-fi beats", "Cinematic score", "Upbeat funk", "Acoustic folk", "Synthwave", "Jazz ballad", "Epic orchestral",
  "Bedroom pop", "Soul", "Bossa nova", "Classic rock", "Ambient", "Hip hop", "Reggae", "Country"] as const;

export const LANGUAGES: Array<{ id: string; label: () => string }> = [
  { id: "", label: () => i18n._({ id: "Auto", message: "Auto" }) },
  { id: "en", label: () => i18n._({ id: "English", message: "English" }) }, { id: "es", label: () => i18n._({ id: "Spanish", message: "Spanish" }) },
  { id: "fr", label: () => i18n._({ id: "French", message: "French" }) }, { id: "de", label: () => i18n._({ id: "German", message: "German" }) },
  { id: "it", label: () => i18n._({ id: "Italian", message: "Italian" }) }, { id: "pt", label: () => i18n._({ id: "Portuguese", message: "Portuguese" }) },
  { id: "ja", label: () => i18n._({ id: "Japanese", message: "Japanese" }) }, { id: "ko", label: () => i18n._({ id: "Korean", message: "Korean" }) },
  { id: "zh", label: () => i18n._({ id: "Chinese", message: "Chinese" }) }, { id: "ru", label: () => i18n._({ id: "Russian", message: "Russian" }) },
];

const ROOTS = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
/** The keys the tool accepts (`^[A-G][#b]?\s?(major|minor)`): twelve roots in major and minor. */
export const KEYS: string[] = ROOTS.flatMap((root) => [`${root} major`, `${root} minor`]);

/** Put `[Tag]` into `text` at the cursor (or over the selection), on a line of its own. Returns the new text and where the cursor goes. */
export function insertStructureTag(text: string, start: number, end: number, tag: string): { text: string; caret: number } {
  const before = text.slice(0, start), after = text.slice(end);
  const lead = before.length === 0 || before.endsWith("\n") ? "" : "\n";
  const trail = after.startsWith("\n") ? "" : "\n";
  return { text: `${before}${lead}[${tag}]${trail}${after}`, caret: before.length + lead.length + tag.length + 2 + trail.length };
}

/** Pick a chip, or put it back. The list never grows past eight. */
export function toggleTag(tags: string[], name: string): string[] {
  if (tags.includes(name)) return tags.filter((one) => one !== name);
  return tags.length < MAX_TAGS ? [...tags, name] : tags;
}

const isStarter = (name: string) => (STARTER_STYLE_CHIPS as readonly string[]).includes(name);
/** The Starter preset: one built-in style at a time. It replaces the starter picked before and leaves the person's own chips alone; "" takes it out. */
export function setStarter(tags: string[], name: string): string[] {
  const own = tags.filter((one) => !isStarter(one));
  return name ? [...own, name].slice(-MAX_TAGS) : own;
}
/** The built-in style on show in the Starter preset, or "". */
export function starterOf(tags: string[]): string { return tags.find(isStarter) ?? ""; }

/** What the song is described by: the idea with the picked style chips after it. */
export function describeSong(form: Pick<CreateForm, "idea" | "tags">): string {
  const base = form.idea.trim();
  return form.tags.length ? `${base ? `${base} ` : ""}Style: ${form.tags.join(", ")}.` : base;
}

/** The seed as a number when it is a whole number from 1 up; null when empty or not usable. */
export function parseSeed(text: string): number | null {
  const value = Number(text.trim());
  return text.trim() !== "" && Number.isInteger(value) && value >= 1 && value <= SEED_MAX ? value : null;
}

/** The label of the primary button: it says how many songs it makes. */
export function createLabel(takes: Takes): string {
  return i18n._({ id: "{count, plural, one {Make a song} other {Make # songs}}", message: "{count, plural, one {Make a song} other {Make # songs}}", values: { count: takes } });
}
export function soundLabel(takes: number): string {
  return i18n._({ id: "{count, plural, one {Make a sound} other {Make # sounds}}", message: "{count, plural, one {Make a sound} other {Make # sounds}}", values: { count: takes } });
}

export interface CreateState { engineMissing: boolean; statusPending: boolean; making: boolean; adult: boolean; blocked: string }
/** Why the primary button is off, in a plain line, or "" when it is on. The order is the order a person can fix them. */
export function createBlocker(form: CreateForm, state: CreateState, lines: { adult: string; engine: string }, noun: "song" | "sound" = "song"): string {
  if (!state.adult) return lines.adult;
  if (state.blocked) return state.blocked;
  if (state.engineMissing) return lines.engine;
  if (state.statusPending) return noun === "song" ? i18n._({ id: "Checking that this computer can make songs.", message: "Checking that this computer can make songs." }) : i18n._({ id: "Checking that this computer can make sounds.", message: "Checking that this computer can make sounds." });
  if (state.making) return noun === "song" ? i18n._({ id: "Your song is being started.", message: "Your song is being started." }) : i18n._({ id: "Your sound is being started.", message: "Your sound is being started." });
  if (noun === "sound") return form.idea.trim().length < 3 ? i18n._({ id: "Describe the sound in at least 3 characters to start.", message: "Describe the sound in at least 3 characters to start." }) : "";
  if (describeSong(form).length < 3) return i18n._({ id: "Say what the song is about to start.", message: "Say what the song is about to start." });
  if (form.seed.trim() !== "" && parseSeed(form.seed) === null) return i18n._({ id: "The seed is a whole number from 1 up, or leave it empty.", message: "The seed is a whole number from 1 up, or leave it empty." });
  return "";
}

/** The body the composer sends: only what the person filled in; nothing is sent for an empty optional field or for Standard. */
export function createBody(form: CreateForm): MakeSongBody {
  const seed = parseSeed(form.seed);
  return {
    idea: describeSong(form),
    ...(!form.instrumental && form.lyrics.trim() ? { lyrics: form.lyrics } : {}),
    ...(form.instrumental ? { instrumental: true } : {}),
    ...(form.title.trim() ? { title: form.title.trim() } : {}),
    ...(form.language ? { language: form.language } : {}),
    ...(form.length ? { length: form.length } : {}),
    ...(form.bpm > 0 ? { bpm: Math.round(form.bpm) } : {}),
    ...(form.key ? { key: form.key } : {}),
    ...(form.takes > 1 ? { takes: form.takes } : {}),
    ...(seed !== null ? { seed } : {}),
    ...(form.tier !== "standard" ? { tier: form.tier } : {}),
    ...(form.styleId ? { song_style: form.styleId } : {}),
    ...(form.bandId ? { band: form.bandId } : {}),
  };
}

export interface SoundForm { seconds: string; loop: boolean; stick: "words" | "surprise" }
export const EMPTY_SOUND: SoundForm = { seconds: "3", loop: false, stick: "words" };
export const SOUND_SECONDS = ["3", "5", "10", "20", "30", "60"] as const;
/** The body for a sound: the composer's words plus the sound chips; takes ride only above one. */
export function soundBody(description: string, sound: SoundForm, takes: number): MakeSoundBody {
  const seconds = Number(sound.seconds);
  return { description: description.trim(), ...(sound.seconds.trim() && Number.isFinite(seconds) && seconds > 0 ? { seconds } : {}), loop: sound.loop, stick_to_words: sound.stick === "words", ...(takes > 1 ? { takes } : {}) };
}

/** "Make another like this": the form filled from a made song, with its seed, so the same seed with changed words keeps the feel. */
export function formLikeSong(card: { title: string | null; description: string | null; lyrics: string | null; seed?: number | null }): CreateForm {
  return { ...EMPTY_FORM, idea: card.description ?? "", lyrics: card.lyrics ?? "", title: card.title ?? "", seed: card.seed ? String(card.seed) : "" };
}

/** What a brought song can become (the Change chip). Restyle is the composer's own words; the others need no words. */
export type EditChange = "restyle" | "parts" | "stems" | "voice_swap";
export const EDIT_CHANGES: readonly EditChange[] = ["restyle", "parts", "stems", "voice_swap"];

/** The request for a brought song. `style` is the words the person typed (and the picked style chips); `voice` a household voice id. */
export function editBody(fileId: string, change: EditChange, style: string, voice: string): FileEditBody {
  return { file_id: fileId, change, ...(change === "voice_swap" ? { voice } : {}), ...(change === "restyle" ? { style: style.trim() } : {}), ...(change === "parts" ? { parts: { drop: ["vocals"] } } : {}) };
}
/** Why the button is off for a brought song, or "". Restyle needs a few words; a voice swap needs a household voice. */
export function editBlocker(change: EditChange, style: string, voice: string): string {
  if (change === "restyle" && style.trim().length < 3) return i18n._({ id: "Say how the song should sound instead, in at least 3 characters.", message: "Say how the song should sound instead, in at least 3 characters." });
  if (change === "voice_swap" && !voice) return i18n._({ id: "Choose a voice to sing it.", message: "Choose a voice to sing it." });
  return "";
}

/** A band, an album or a style starts from its name; the editor opens on it for the rest. */
export type RecordKind = "band" | "album" | "song_style";
export function recordBlocker(kind: RecordKind, name: string): string {
  if (name.trim()) return "";
  return kind === "band" ? i18n._({ id: "Name your band to start.", message: "Name your band to start." }) : kind === "album" ? i18n._({ id: "Name your album to start.", message: "Name your album to start." }) : i18n._({ id: "Name your style to start.", message: "Name your style to start." });
}
