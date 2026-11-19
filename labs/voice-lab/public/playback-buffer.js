export class PlaybackBuffer {
  samples = [];
  cursor = 0;
  pausedAt = 0;
  chunkStarts = [];
  paused = false;
  ducked = false;

  append(chunk) {
    this.chunkStarts.push(this.samples.length);
    for (let i = 0; i < chunk.length; i++) this.samples.push(Number(chunk[i]));
  }

  read(count) {
    const end = Math.min(this.samples.length, this.cursor + Math.max(0, Math.round(count)));
    const result = Float32Array.from(this.samples.slice(this.cursor, end));
    this.cursor = end;
    return result;
  }

  pause() { this.paused = true; this.pausedAt = this.cursor; }

  resume(sampleRate, chunkBoundary = null) {
    const rewind = this.pausedAt - Math.round(sampleRate * 0.12);
    const nearestChunk = this.chunkStarts.filter((start) => start <= this.pausedAt).at(-1);
    const chunkStart = Number.isFinite(chunkBoundary) ? chunkBoundary : nearestChunk;
    this.cursor = Math.max(0, chunkStart !== undefined && chunkStart > rewind ? chunkStart : rewind);
    this.paused = false;
    return this.cursor;
  }

  duck() { this.ducked = true; }
  restore() { this.ducked = false; }
  stop() { this.samples = []; this.chunkStarts = []; this.cursor = 0; this.pausedAt = 0; this.paused = false; this.ducked = false; }
  get length() { return this.samples.length; }
}
