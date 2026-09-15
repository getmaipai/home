import type { TurnStreamEvent } from "@/wire";

export type StatusEvent = Extract<TurnStreamEvent, { type: "status" }>;

export class StatusChannel {
  private readonly queue: StatusEvent[] = [];
  private waiter: ((event: StatusEvent | null) => void) | null = null;
  private closed = false;

  emit(event: StatusEvent): void {
    if (this.closed) return;
    if (this.waiter) { const waiter = this.waiter; this.waiter = null; waiter(event); }
    else this.queue.push(event);
  }

  next(): Promise<StatusEvent | null> {
    if (this.queue.length) return Promise.resolve(this.queue.shift()!);
    if (this.closed) return Promise.resolve(null);
    return new Promise((resolve) => { this.waiter = resolve; });
  }

  close(): void {
    this.closed = true;
    if (this.waiter && this.queue.length === 0) { const waiter = this.waiter; this.waiter = null; waiter(null); }
  }
}
