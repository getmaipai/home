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

  constructor(private random: () => number = Math.random) {}

  schedule<T>(value: T, sendAt: number, sim: NetSim, control = false): LinkMessage<T> {
    this.startedAt ??= sendAt;
    const jitter = (this.random() * 2 - 1) * sim.jitterMs;
    const elapsed = sendAt - this.startedAt;
    const stallPosition = sim.burstEveryMs > 0 && elapsed > 0 ? elapsed % sim.burstEveryMs : -1;
    const stallWait = stallPosition >= 0 && stallPosition < sim.burstStallMs ? sim.burstStallMs - stallPosition : 0;
    const nominal = sendAt + sim.delayMs + jitter + stallWait;
    const deliverAt = Math.max(this.lastDeliveryAt, Math.max(sendAt, nominal));
    this.lastDeliveryAt = deliverAt;
    const dropped = !control && (this.random() * 100 < (sim.lossPercent ?? 0));
    return { value, deliverAt, dropped };
  }
}

export function delayFor(index: number, sim: NetSim): number {
  const jitter = index % 2 ? sim.jitterMs : -sim.jitterMs;
  return Math.max(0, sim.delayMs + jitter);
}
