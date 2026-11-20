// "Warming up" gate: no conversation opens until the server reports that the chosen voice is loaded. Never falls back silently: while waiting the page says so in one plain line.
export class WarmGate {
  constructor(now = 0) { this.reset(now); }
  reset(now = 0) { this.ready = false; this.since = now; }
  /** Feed every server message; returns true when this one made the gate ready. */
  onMessage(m) { if (!this.ready && m && m.t === 'warm' && m.part === 'voice') { this.ready = true; return true; } return false; }
  /** Microphone frames are sent only when this is true. */
  get open() { return this.ready; }
  line(now = 0) { return now - this.since > 20000 ? 'The voice is taking longer than usual to load. Keep this page open: it starts by itself.' : 'Warming up the voice, one moment.'; }
}
