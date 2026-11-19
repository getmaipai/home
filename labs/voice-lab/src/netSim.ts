export type NetSim = { delayMs: number; jitterMs: number; burstEveryMs: number; burstStallMs: number };
export class OrderedNetSim {
  private nextAt = 0;
  private startedAt = 0;
  constructor(private now: () => number, private wait: (ms: number) => Promise<void>) {}
  async pass<T>(value: T, sim: NetSim): Promise<T> {
    const now = this.now();
    if (!this.startedAt) this.startedAt = now;
    const elapsed = now - this.startedAt;
    const burst = sim.burstEveryMs > 0 && Math.floor(elapsed / sim.burstEveryMs) > Math.floor((elapsed - 1) / sim.burstEveryMs);
    const jitter = sim.jitterMs ? ((Math.floor(now) % 2001) / 2000 * 2 - 1) * sim.jitterMs : 0;
    const at = Math.max(now, this.nextAt) + Math.max(0, sim.delayMs + jitter) + (burst ? sim.burstStallMs : 0);
    this.nextAt = at;
    await this.wait(Math.max(0, at - now));
    return value;
  }
}
export function delayFor(index: number, sim: NetSim): number {
  const burst = sim.burstEveryMs > 0 && index > 0 && index % sim.burstEveryMs === 0 ? sim.burstStallMs : 0;
  return Math.max(0, sim.delayMs + (index % 2 ? sim.jitterMs : -sim.jitterMs)) + burst;
}
