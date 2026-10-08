// ANSWER-IMG-06: a replay bench's turns must not overlap the hub's own
// background engine requests (a conversation title, a summary refresh, a
// memory judge). In production those wait for a 20 s idle window, so a person
// never has one running under their next message. A bench sends the next row
// a few seconds after the last, so a title for the previous row ran beside it
// and the first real-turn run saw replies with another row's text spliced in
// ("... I named the conversation \"Celebrity Biography\" ..." inside a
// Michael Jackson answer). The bench counts every engine request that passes
// through its stand-in and waits, before each row, until none is in flight and
// none has started or ended for `quietMs`.

export interface EngineActivity {
  /** An engine request began. */
  begin(): void;
  /** An engine request finished (its body fully read, or it failed). */
  end(): void;
  /** Requests in flight right now. */
  inFlight(): number;
  /** Resolves once nothing is in flight and nothing has started or ended for
   * `quietMs`; gives up after `maxMs` and says so by returning false. */
  settle(quietMs: number, maxMs: number): Promise<boolean>;
}

export function createEngineActivity(now: () => number = () => performance.now(), sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): EngineActivity {
  let inflight = 0;
  let lastChange = now();
  return {
    begin() {
      inflight++;
      lastChange = now();
    },
    end() {
      inflight = Math.max(0, inflight - 1);
      lastChange = now();
    },
    inFlight: () => inflight,
    async settle(quietMs, maxMs) {
      const deadline = now() + maxMs;
      for (;;) {
        if (inflight === 0 && now() - lastChange >= quietMs) return true;
        if (now() >= deadline) return false;
        await sleep(inflight === 0 ? Math.max(1, quietMs - (now() - lastChange)) : 50);
      }
    },
  };
}
