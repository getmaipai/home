export type NetSim = {
  delayMs: number;
  jitterMs: number;
  lossPercent?: number;
  burstEveryMs: number;
  burstStallMs: number;
};

export type LinkMessage<T> = { value: T; deliverAt: number; dropped: boolean };

export class LinkModel {
  private startedAt: number | null = null;
  private lastDeliveryAt = 0;
  private index = 0;

  constructor(private random: () => number = Math.random) {}

  schedule<T>(value: T, sendAt: number, sim: NetSim, control = false): LinkMessage<T> {
    this.startedAt ??= sendAt;
    const jitter = (this.random() * 2 - 1) * sim.jitterMs;
    const elapsed = sendAt - this.startedAt;
    const inStall = sim.burstEveryMs > 0 && Math.floor(elapsed / sim.burstEveryMs) > 0 && elapsed % sim.burstEveryMs < sim.burstStallMs;
    const deliverAt = Math.max(this.lastDeliveryAt, sendAt + Math.max(0, sim.delayMs + jitter) + (inStall ? sim.burstStallMs : 0));
    this.lastDeliveryAt = deliverAt;
    const dropped = !control && (this.random() * 100 < (sim.lossPercent ?? 0));
    this.index++;
    return { value, deliverAt, dropped };
  }
}

export function delayFor(index: number, sim: NetSim): number {
  const jitter = index % 2 ? sim.jitterMs : -sim.jitterMs;
  return Math.max(0, sim.delayMs + jitter);
}
