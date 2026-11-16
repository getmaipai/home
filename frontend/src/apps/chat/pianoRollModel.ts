export interface PianoNote { start: number; end: number; pitch: number; velocity: number }
export interface PianoRollNote extends PianoNote { x: number; y: number; width: number; height: number }
export function pianoRollModel(notes: PianoNote[], width = 640, height = 128, cap = 2000): PianoRollNote[] {
  const valid = notes.filter((note) => Number.isFinite(note.start) && Number.isFinite(note.end) && Number.isFinite(note.pitch) && note.end > note.start).slice(0, cap);
  if (!valid.length) return [];
  const start = Math.min(...valid.map((note) => note.start)); const end = Math.max(...valid.map((note) => note.end));
  const low = Math.min(...valid.map((note) => note.pitch)); const high = Math.max(...valid.map((note) => note.pitch));
  const span = Math.max(end - start, .001); const pitchSpan = Math.max(high - low + 1, 1);
  return valid.map((note) => ({ ...note, x: ((note.start - start) / span) * width, y: height - ((note.pitch - low + 1) / pitchSpan) * height, width: Math.max(1, ((note.end - note.start) / span) * width), height: Math.max(1, height / pitchSpan) }));
}
