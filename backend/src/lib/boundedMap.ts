// AUDIT-PERF-01: the one cap for in-process per-conversation and per-person maps (the pattern turnMachine/toolGates.ts uses for its latches).
export const MAX_REMEMBERED_KEYS = 500;

/** Sets a key as the most recently used and drops the oldest key when the map passes `max`. */
export function setBounded<K, V>(map: Map<K, V>, key: K, value: V, max: number = MAX_REMEMBERED_KEYS): void {
  map.delete(key);
  map.set(key, value);
  if (map.size > max) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
}
