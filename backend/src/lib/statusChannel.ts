import type { TurnStreamEvent } from "@/wire";

export type StatusEvent = Extract<TurnStreamEvent, { type: "status" }>;

/** The turn's status lines beside its deltas. `emit()` queues; `drain()`
 * takes what is queued, synchronously, so a consumer can put a status
 * emitted before a delta ahead of that delta on the wire (K6: the
 * `composing` line before the composition's first token); `wait()`
 * resolves when something is queued or the channel closes; `next()` is
 * the one-at-a-time read the tests use. */
export class StatusChannel {
  private readonly queue: StatusEvent[] = [];
  private waiters: (() => void)[] = [];
  closed = false;

  emit(event: StatusEvent): void {
    if (this.closed) return;
    this.queue.push(event);
    this.wake();
  }

  /** Every queued event, in order; empty when nothing is waiting. */
  drain(): StatusEvent[] {
    return this.queue.splice(0, this.queue.length);
  }

  /** Resolves at once when something is queued or the channel is closed,
   * else when the next emit or close happens. */
  wait(): Promise<void> {
    if (this.queue.length > 0 || this.closed) return Promise.resolve();
    return new Promise((resolve) => { this.waiters.push(resolve); });
  }

  async next(): Promise<StatusEvent | null> {
    await this.wait();
    return this.queue.shift() ?? null;
  }

  close(): void {
    this.closed = true;
    this.wake();
  }

  private wake(): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const waiter of waiters) waiter();
  }
}
