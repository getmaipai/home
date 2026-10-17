// Streaming mono resampler to 16 kHz for mic capture. Box-average
// decimation (each output sample is the mean of the input span it covers,
// fractional edges weighted), which low-passes while it decimates and keeps
// phase across chunks. Safari and Firefox cannot always open a 16 kHz
// AudioContext over a 44.1 or 48 kHz microphone, so capture runs at the
// device rate and this converts.
export class StreamResampler {
  private readonly ratio: number;
  private pos = 0; // input position (in input samples) of the next output's span start, relative to the next chunk
  private carry: Float32Array = new Float32Array(0);

  constructor(inputRate: number, readonly outputRate = 16_000) {
    this.ratio = inputRate / outputRate;
  }

  process(chunk: Float32Array): Float32Array {
    if (Math.abs(this.ratio - 1) < 1e-6) return chunk;
    const input = this.carry.length ? concat(this.carry, chunk) : chunk;
    const out: number[] = [];
    let start = this.pos;
    while (start + this.ratio <= input.length) {
      const end = start + this.ratio;
      let sum = 0;
      let i = Math.floor(start);
      while (i < end) {
        const lo = Math.max(i, start);
        const hi = Math.min(i + 1, end);
        sum += (input[i] ?? 0) * (hi - lo);
        i++;
      }
      out.push(sum / this.ratio);
      start = end;
    }
    const keep = Math.floor(start);
    this.carry = input.slice(keep);
    this.pos = start - keep;
    return Float32Array.from(out);
  }
}

function concat(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}
