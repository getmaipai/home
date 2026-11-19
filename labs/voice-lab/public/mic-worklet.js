// Mic capture: brings the device's sample rate down to 16 kHz (averaging the samples that fall in each output
// step, so high frequencies do not fold back), and posts 32 ms frames with a sequence number and capture time.
// Frame layout: uint32 sequence, float64 capture time in ms (audio clock), then 512 samples of 16-bit PCM.
class MicProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.step = sampleRate / 16000; // input samples per output sample (3 at 48 kHz)
    this.position = 0;              // how far into the current output step we are, in input samples
    this.sum = 0;
    this.count = 0;
    this.frame = new Int16Array(512);
    this.filled = 0;
    this.seq = 0;
    this.frameStartMs = 0;
  }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    for (let i = 0; i < input.length; i++) {
      this.sum += input[i];
      this.count++;
      this.position++;
      if (this.position >= this.step) {
        this.position -= this.step;
        const value = this.sum / this.count;
        this.sum = 0;
        this.count = 0;
        if (this.filled === 0) this.frameStartMs = (currentTime + i / sampleRate) * 1000;
        this.frame[this.filled++] = Math.max(-32768, Math.min(32767, Math.round(value * 32767)));
        if (this.filled === 512) {
          const buffer = new ArrayBuffer(12 + 1024);
          const view = new DataView(buffer);
          view.setUint32(0, this.seq++, true);
          view.setFloat64(4, this.frameStartMs, true);
          for (let j = 0; j < 512; j++) view.setInt16(12 + j * 2, this.frame[j], true);
          this.port.postMessage(buffer, [buffer]);
          this.filled = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('voice-mic', MicProcessor);
