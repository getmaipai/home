export async function* withTicks<T>(source: AsyncIterable<T>, intervalMs: number): AsyncGenerator<{ event: T } | { tick: true }> {
  const iterator = source[Symbol.asyncIterator]();
  let pending: Promise<IteratorResult<T>> | undefined;
  let finished = false;
  try {
    while (!finished) {
      pending ??= iterator.next();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const tick = new Promise<"tick">((resolve) => { timer = setTimeout(() => resolve("tick"), intervalMs); });
      const result = await Promise.race([pending.then((value) => ({ kind: "event" as const, value })), tick]);
      if (timer !== undefined) clearTimeout(timer);
      if (result === "tick") {
        yield { tick: true };
      } else {
        pending = undefined;
        finished = result.value.done === true;
        if (!finished) yield { event: result.value.value };
      }
    }
  } finally {
    if (!finished) { void iterator.return?.(); }
  }
}
