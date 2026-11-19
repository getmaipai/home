export class LocalDuckDetector {
  floor = 0.0001;
  history = [];
  hotFrames = 0;

  frame(samples, { playing, enabled = true } = {}) {
    let power = 0;
    for (const sample of samples) power += sample * sample;
    const rms = Math.sqrt(power / Math.max(1, samples.length));
    const priorMean = this.history.length ? this.history.reduce((a, b) => a + b, 0) / this.history.length : 0;
    const floorDb = 20 * Math.log10(Math.max(this.floor, 1e-8));
    const rmsDb = 20 * Math.log10(Math.max(rms, 1e-8));
    const priorDb = 20 * Math.log10(Math.max(priorMean, 1e-8));
    if (!playing) {
      this.floor = this.floor * 0.98 + rms * 0.02;
      this.history.push(rms);
      while (this.history.length > 7) this.history.shift();
      this.hotFrames = 0;
      return false;
    }
    const hot = enabled && rmsDb >= floorDb + 8 && rmsDb >= priorDb + 4;
    this.hotFrames = hot ? this.hotFrames + 1 : 0;
    this.history.push(rms);
    while (this.history.length > 7) this.history.shift();
    return this.hotFrames >= 2;
  }
}
