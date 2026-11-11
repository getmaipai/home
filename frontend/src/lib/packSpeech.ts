// PACK-06b: builds the kit player's `speech` input for one reply from what the voice says (the approved spoken text) and the
// samples it plays. Pure: no audio, no DOM. A sentence gets provisional cues from its text the moment its audio starts and
// final cues (aligned to its real samples) once its audio is complete; `joinAt` tells the player where they were swapped.
import { buildCues, buildLoud, detectEvents, emotionFor, joinCues, provisionalCues, splitTags } from "@maipai/ui/src/elements/companion-pack";
import type { CompanionPackPlayerProps, Cue, PhonesFor } from "@maipai/ui/src/elements/companion-pack";

export type PackSpeechInput = NonNullable<CompanionPackPlayerProps["speech"]>;
type Emotion = PackSpeechInput["emotion"];

type Line = {
  plain: string; tags: string[]; tagList: ReturnType<typeof splitTags>["tags"];
  at?: number; rate: number; parts: Float32Array[]; done: boolean; joinAt: number;
  cues?: Cue[]; events?: PackSpeechInput["events"];
};

export type PackSpeechOptions = {
  /** Words to phonemes; a word it does not know falls back to letter shapes inside the kit builder. */
  phonesFor: () => PhonesFor;
  /** Seconds since the first sample of the reply played. */
  clock: () => number;
  /** The companion's own emotion setting; it wins over the guess from the words. */
  emotion?: Emotion;
};

export class PackSpeechBuilder {
  private readonly lines = new Map<number, Line>();
  private joinAt: number | undefined;
  constructor(private readonly options: PackSpeechOptions) {}

  sentence(id: number, text: string): void {
    const { plain, tags } = splitTags(text);
    this.lines.set(id, { plain, tags: tags.map((tag) => tag.type), tagList: tags, rate: 0, parts: [], done: false, joinAt: 0 });
  }

  /** Returns true when the first audio of a sentence arrived (its provisional cues now exist). */
  audio(id: number, samples: Float32Array, rate: number, at: number): boolean {
    const line = this.lines.get(id);
    if (!line) return false;
    line.parts.push(samples);
    if (line.at !== undefined) return false;
    line.at = at; line.rate = rate;
    line.cues = provisionalCues(line.plain, this.options.phonesFor());
    return true;
  }

  end(id: number): void {
    const line = this.lines.get(id);
    if (!line || line.at === undefined || line.done) return;
    line.done = true;
    line.joinAt = Math.max(0, this.options.clock() - line.at);
    this.finish(line);
  }

  /** The dictionary arrived after some cues were made: remake them from the same samples. */
  rebuild(): void {
    for (const line of this.lines.values()) {
      if (line.at === undefined) continue;
      if (line.done) this.finish(line); else line.cues = provisionalCues(line.plain, this.options.phonesFor());
    }
  }

  private finish(line: Line): void {
    const samples = concat(line.parts);
    const phonesFor = this.options.phonesFor();
    const final = buildCues({ text: line.plain, samples, sampleRate: line.rate, phonesFor });
    const provisional = provisionalCues(line.plain, phonesFor);
    const joined = line.joinAt > 0.02 ? joinCues(provisional, final, line.joinAt) : final;
    line.cues = joined;
    line.events = detectEvents(samples, line.rate, line.plain, line.tagList, phonesFor);
    if (line.joinAt > 0.02) this.joinAt = (line.at ?? 0) + line.joinAt;
  }

  /** The player input for everything started so far, or undefined before any audio. */
  build(): PackSpeechInput | undefined {
    const started = [...this.lines.entries()].sort((a, b) => a[0] - b[0]).map(([, line]) => line).filter((line) => line.at !== undefined && line.cues);
    if (!started.length) return undefined;
    const cues: Cue[] = [];
    const events: PackSpeechInput["events"] = [];
    for (const line of started) {
      const at = line.at!;
      for (const cue of line.cues!) cues.push({ ...cue, t0: cue.t0 + at, t1: cue.t1 + at });
      for (const event of line.events ?? []) events.push({ ...event, t0: event.t0 + at, t1: event.t1 + at });
    }
    const rate = started[0]!.rate;
    const total = Math.max(...started.map((line) => (line.at ?? 0) + line.parts.reduce((sum, part) => sum + part.length, 0) / line.rate));
    const timeline = new Float32Array(Math.ceil(total * rate));
    for (const line of started) timeline.set(concat(line.parts), Math.round((line.at ?? 0) * rate));
    const text = started.map((line) => line.plain).join(" ");
    const tags = started.flatMap((line) => line.tags);
    const emotion = this.options.emotion !== undefined ? this.options.emotion : emotionFor(text, tags, false);
    return {
      cues, loudness: buildLoud(timeline, rate, 1e-4, false), events, emotion, voiceMode: "normal", clock: this.options.clock, text, tags,
      ...(this.joinAt !== undefined ? { joinAt: this.joinAt } : {}),
    };
  }
}

function concat(parts: Float32Array[]): Float32Array {
  if (parts.length === 1) return parts[0]!;
  const out = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

let dictionary: Record<string, string[]> | null = null;
let loading: Promise<void> | null = null;
/** Loads the pronouncing dictionary once, the first time a pack companion speaks; every later call shares it. */
export function loadPronouncing(fetchDictionary: () => Promise<Record<string, string>>): Promise<void> {
  loading ??= fetchDictionary().then((raw) => {
    const next: Record<string, string[]> = {};
    for (const [word, phones] of Object.entries(raw)) next[word] = phones.split(" ");
    dictionary = next;
  }).catch(() => { loading = null; });
  return loading;
}
export const phonesFor: PhonesFor = (word) => dictionary?.[word] ?? null;
export const pronouncingReady = (): boolean => dictionary !== null;
export function __resetPronouncingForTests(): void { dictionary = null; loading = null; }
