import type { TurnStreamEvent } from "@/wire";

export type StatusEvent = Extract<TurnStreamEvent, { type: "status" }>;
/** THIN-5B: the live `reasoning` events ride the same ordered channel as
 * status lines, so they reach the wire ahead of the answer's first delta. */
export type TurnSideEvent = StatusEvent | Extract<TurnStreamEvent, { type: "reasoning" }>;

/** A push-now-pull-later queue: `emit()` is called eagerly, from
 * anywhere, independent of whether a consumer is reading yet; `drain()`
 * takes what is queued, synchronously, so a consumer can put an item
 * emitted before another one ahead of it on the wire (K6: the
 * `composing` line before the composition's first token); `wait()`
 * resolves when something is queued or the channel closes; `next()` is
 * the one-at-a-time read a consumer loop drains with. Generic so a
 * second, distinct payload shape (turnMachine/turnNext.ts's own live
 * text delivery, STREAM-NEXT-01) reuses the identical wait/wake shape
 * rather than a second, hand-rolled copy of it - "one definition, one
 * place" (a code review) - the turn's own status/tool-event channel
 * (the default `T`) is unaffected, still `StatusChannel` with no type
 * argument. */
export class StatusChannel<T = TurnSideEvent> {
  private readonly queue: T[] = [];
  private waiters: (() => void)[] = [];
  closed = false;

  emit(event: T): void {
    if (this.closed) return;
    this.queue.push(event);
    this.wake();
  }

  /** Every queued event, in order; empty when nothing is waiting. */
  drain(): T[] {
    return this.queue.splice(0, this.queue.length);
  }

  /** Resolves at once when something is queued or the channel is closed,
   * else when the next emit or close happens. */
  wait(): Promise<void> {
    if (this.queue.length > 0 || this.closed) return Promise.resolve();
    return new Promise((resolve) => { this.waiters.push(resolve); });
  }

  async next(): Promise<T | null> {
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
