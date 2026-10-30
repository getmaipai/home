export type AlarmSoundId = "none" | "bell" | "chime" | "digital" | "rise" | "gentle";
export type AlarmVolume = "low" | "medium" | "high";
export interface AlarmNote { frequency: number; start: number; duration: number; type: OscillatorType; endFrequency?: number; gain?: number; }
export interface AlarmSound { id: AlarmSoundId; label: string; notes: readonly AlarmNote[]; }
export const ALARM_LOOP_MAX_MS = 120_000;
export const ALARM_VOLUME_GAIN: Readonly<Record<AlarmVolume, number>> = { low: 0.25, medium: 0.5, high: 0.9 };

export const ALARM_SOUNDS: readonly AlarmSound[] = [
  { id: "none", label: "None", notes: [] },
  { id: "bell", label: "Bell", notes: [
    { frequency: 880, start: 0, duration: 1.35, type: "sine", gain: 0.45 }, { frequency: 1320, start: 0, duration: 0.95, type: "sine", gain: 0.28 },
    { frequency: 880, start: 1.8, duration: 1.35, type: "sine", gain: 0.45 }, { frequency: 1320, start: 1.8, duration: 0.95, type: "sine", gain: 0.28 },
  ] },
  { id: "chime", label: "Chime", notes: [440, 554.37, 659.25].map((frequency, index) => ({ frequency, start: index * 0.42, duration: 0.62, type: "sine" as const, gain: 0.42 })) },
  { id: "digital", label: "Digital", notes: [0, 0.46, 1.35, 1.81].map((start) => ({ frequency: 740, start, duration: 0.17, type: "square" as const, gain: 0.22 })) },
  { id: "rise", label: "Rise", notes: [{ frequency: 360, endFrequency: 1040, start: 0, duration: 2.2, type: "sine", gain: 0.38 }] },
  { id: "gentle", label: "Gentle", notes: [{ frequency: 330, start: 0, duration: 1.25, type: "sine", gain: 0.19 }, { frequency: 392, start: 0.68, duration: 1.25, type: "sine", gain: 0.16 }] },
];

export function alarmSoundNotes(id: AlarmSoundId): readonly AlarmNote[] { return ALARM_SOUNDS.find((sound) => sound.id === id)?.notes ?? []; }
export interface AlarmPlayback { blocked: boolean; stop(): void; }
type AudioContextLike = AudioContext;
let context: AudioContextLike | undefined;
function getContext(): AudioContextLike | undefined {
  if (typeof window === "undefined") return undefined;
  const Constructor = window.AudioContext;
  if (!Constructor) return undefined;
  context ??= new Constructor();
  return context;
}

export async function unlockAlarmAudio(): Promise<boolean> {
  const audio = getContext();
  if (!audio) return false;
  if (audio.state === "suspended") {
    if (typeof audio.resume !== "function") return false;
    try { await audio.resume(); } catch { return false; }
  }
  return audio.state === "running";
}

export function playAlarmSound(id: AlarmSoundId, volume: AlarmVolume): AlarmPlayback {
  const audio = getContext();
  let stopped = false;
  const stopNodes: OscillatorNode[] = [];
  if (id === "none") return { blocked: false, stop() {} };
  if (!audio || audio.state === "suspended" || typeof audio.createOscillator !== "function" || typeof audio.createGain !== "function") return { blocked: true, stop() {} };
  const notes = alarmSoundNotes(id);
  const now = audio.currentTime;
  for (const note of notes) {
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    const begin = now + note.start;
    const end = begin + note.duration;
    oscillator.type = note.type;
    oscillator.frequency.setValueAtTime(note.frequency, begin);
    if (note.endFrequency) oscillator.frequency.linearRampToValueAtTime(note.endFrequency, end);
    gain.gain.setValueAtTime(0.0001, begin);
    gain.gain.linearRampToValueAtTime(ALARM_VOLUME_GAIN[volume] * (note.gain ?? 0.4), begin + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    oscillator.connect(gain); gain.connect(audio.destination); oscillator.start(begin); oscillator.stop(end + 0.02); stopNodes.push(oscillator);
  }
  return { blocked: false, stop() { if (stopped) return; stopped = true; for (const node of stopNodes) { try { node.stop(); } catch { /* already ended */ } } } };
}

export function startAlarmLoop(id: AlarmSoundId, volume: AlarmVolume, options: { maxMs?: number } = {}): AlarmPlayback {
  const maxMs = Math.max(0, Math.min(options.maxMs ?? ALARM_LOOP_MAX_MS, ALARM_LOOP_MAX_MS));
  if (id === "none" || maxMs === 0) return { blocked: false, stop() {} };
  const first = playAlarmSound(id, volume);
  if (first.blocked) return first;
  const notes = alarmSoundNotes(id);
  const cycleMs = Math.max(...notes.map((note) => (note.start + note.duration) * 1000)) + 180;
  let stopped = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const started = Date.now();
  const schedule = () => {
    if (stopped || Date.now() - started + cycleMs > maxMs) return;
    const timer = setTimeout(() => { timers.delete(timer); if (!stopped) { const playback = playAlarmSound(id, volume); if (!playback.blocked) schedule(); } }, cycleMs);
    timers.add(timer);
  };
  schedule();
  return { blocked: false, stop() { stopped = true; first.stop(); for (const timer of timers) clearTimeout(timer); timers.clear(); } };
}
