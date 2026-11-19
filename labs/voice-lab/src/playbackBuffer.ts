export class PlaybackBuffer {
  private samples: number[] = [];
  cursor = 0;
  pausedAt = 0;
  append(chunk: ArrayLike<number>) { for (let i = 0; i < chunk.length; i++) this.samples.push(chunk[i]!); }
  read(count: number): Float32Array {
    const end = Math.min(this.samples.length, this.cursor + Math.round(count));
    const out = Float32Array.from(this.samples.slice(this.cursor, end));
    this.cursor = end;
    return out;
  }
  pause() { this.pausedAt = this.cursor; }
  resume(sampleRate: number, wordBoundary?: number) {
    this.cursor = Math.floor(Math.max(0, Math.min(this.pausedAt, wordBoundary ?? this.pausedAt - Math.round(sampleRate * 0.12))));
    return this.cursor;
  }
  reset() { this.samples = []; this.cursor = 0; this.pausedAt = 0; }
  get length() { return this.samples.length; }
}
